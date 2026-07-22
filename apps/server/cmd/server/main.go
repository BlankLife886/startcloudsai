// 入口：serve / worker / create-admin 子命令。
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/mail"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/httpapi"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/storage"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/BlankLife886/startcloudsai/server/internal/worker"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: server <serve|worker|create-admin> [flags]")
		os.Exit(2)
	}
	cfg := config.Load()

	var err error
	switch os.Args[1] {
	case "serve":
		err = runServe(cfg)
	case "worker":
		err = runWorker(cfg)
	case "create-admin":
		err = runCreateAdmin(cfg, os.Args[2:])
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\nusage: server <serve|worker|create-admin> [flags]\n", os.Args[1])
		os.Exit(2)
	}
	if err != nil {
		log.Fatal(err)
	}
}

func runServe(cfg *config.Config) error {
	if err := store.Migrate(cfg.DatabaseURL); err != nil {
		return fmt.Errorf("run migrations: %w", err)
	}
	ctx := context.Background()
	st, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer st.Close()
	if err := settings.EncryptStoredSecrets(ctx, st.Pool, cfg.AppSecret); err != nil {
		return fmt.Errorf("encrypt stored settings: %w", err)
	}

	stg, err := storage.New(cfg)
	if err != nil {
		return err
	}
	queue, err := taskflow.NewQueue(cfg.RedisURL, cfg.C2ATimeoutSecs)
	if err != nil {
		return err
	}
	defer queue.Close()

	c2aClient := c2a.NewWithPolicy(cfg.C2ABaseURL, cfg.C2AAPIKey, cfg.C2ATimeoutSecs, cfg.AppEnv == "development")
	server, err := httpapi.New(cfg, st, stg, c2aClient, queue)
	if err != nil {
		return fmt.Errorf("initialize HTTP server: %w", err)
	}
	defer server.Close()
	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		return fmt.Errorf("PORT 必须为 1-65535 之间的整数")
	}

	// H2 优雅停机：SIGTERM/SIGINT 后 30s 内完成在途请求
	notifyCtx, stop := signal.NotifyContext(ctx, syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", portNumber),
		Handler:           server.Router(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      310 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	errCh := make(chan error, 1)
	go func() {
		log.Printf("serving on :%d", portNumber)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-notifyCtx.Done():
		log.Println("shutdown signal received, draining requests (30s max)")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}

func runWorker(cfg *config.Config) error {
	ctx := context.Background()
	st, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer st.Close()

	stg, err := storage.New(cfg)
	if err != nil {
		return err
	}
	queue, err := taskflow.NewQueue(cfg.RedisURL, cfg.C2ATimeoutSecs)
	if err != nil {
		return err
	}
	defer queue.Close()

	c2aClient := c2a.NewWithPolicy(cfg.C2ABaseURL, cfg.C2AAPIKey, cfg.C2ATimeoutSecs, cfg.AppEnv == "development")
	return worker.New(cfg, st, stg, c2aClient, queue).Run()
}

// runCreateAdmin 创建或更新独立管理员账号，不写 users/wallets。
func runCreateAdmin(cfg *config.Config, args []string) error {
	fs := flag.NewFlagSet("create-admin", flag.ExitOnError)
	email := fs.String("email", "", "管理员邮箱")
	passwordStdin := fs.Bool("password-stdin", false, "从标准输入读取管理员密码")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *email == "" || !*passwordStdin {
		return fmt.Errorf("create-admin: --email 与 --password-stdin 必填")
	}
	normalized := strings.ToLower(strings.TrimSpace(*email))
	addr, err := mail.ParseAddress(normalized)
	if err != nil || addr.Address != normalized || !strings.Contains(normalized[strings.LastIndex(normalized, "@")+1:], ".") {
		return fmt.Errorf("create-admin: 管理员邮箱格式不正确")
	}
	passwordBytes, err := io.ReadAll(io.LimitReader(os.Stdin, auth.MaxPasswordBytes+2))
	if err != nil {
		return fmt.Errorf("create-admin: 读取密码: %w", err)
	}
	password := strings.TrimRight(string(passwordBytes), "\r\n")
	if err := auth.ValidateAdminPassword(password); err != nil {
		return fmt.Errorf("create-admin: 密码须为 12-72 字节")
	}

	ctx := context.Background()
	st, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer st.Close()

	passwordHash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}

	var action string
	var admin *store.AdminAccount
	err = st.Tx(ctx, func(tx pgx.Tx) error {
		existing, terr := store.GetAdminAccountByEmail(ctx, tx, normalized)
		if terr != nil {
			return terr
		}
		username := normalized
		if at := strings.Index(normalized, "@"); at > 0 {
			username = normalized[:at]
		}
		if existing == nil {
			action = "created"
		} else {
			action = "updated"
		}
		admin, terr = store.UpsertAdminAccount(ctx, tx, normalized, username, passwordHash)
		if terr != nil {
			return terr
		}
		if terr = store.DeleteAdminSessionsByAdmin(ctx, tx, admin.ID); terr != nil {
			return terr
		}
		return nil
	})
	if err != nil {
		return err
	}
	fmt.Printf("admin %s: %s (id=%s)\n", action, normalized, admin.ID)
	return nil
}
