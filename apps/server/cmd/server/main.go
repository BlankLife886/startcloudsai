// 入口：serve / worker / create-admin 子命令。
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/auth"
	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/httpapi"
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

	stg, err := storage.New(cfg)
	if err != nil {
		return err
	}
	queue, err := taskflow.NewQueue(cfg.RedisURL, cfg.C2ATimeoutSecs)
	if err != nil {
		return err
	}
	defer queue.Close()

	c2aClient := c2a.New(cfg.C2ABaseURL, cfg.C2AAPIKey, cfg.C2ATimeoutSecs)
	server := httpapi.New(cfg, st, stg, c2aClient, queue)
	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}

	// H2 优雅停机：SIGTERM/SIGINT 后 30s 内完成在途请求
	notifyCtx, stop := signal.NotifyContext(ctx, syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	srv := &http.Server{Addr: ":" + port, Handler: server.Router()}
	errCh := make(chan error, 1)
	go func() {
		log.Println("serving on :" + port)
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

	c2aClient := c2a.New(cfg.C2ABaseURL, cfg.C2AAPIKey, cfg.C2ATimeoutSecs)
	return worker.New(cfg, st, stg, c2aClient, queue).Run()
}

// runCreateAdmin 创建或提升管理员（存在则提升 role 并重置密码，建钱包）。
func runCreateAdmin(cfg *config.Config, args []string) error {
	fs := flag.NewFlagSet("create-admin", flag.ExitOnError)
	email := fs.String("email", "", "管理员邮箱")
	password := fs.String("password", "", "管理员密码")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *email == "" || *password == "" {
		return fmt.Errorf("create-admin: --email 与 --password 必填")
	}
	normalized := strings.ToLower(strings.TrimSpace(*email))

	ctx := context.Background()
	st, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer st.Close()

	passwordHash, err := auth.HashPassword(*password)
	if err != nil {
		return err
	}

	var action string
	var user *store.User
	err = st.Tx(ctx, func(tx pgx.Tx) error {
		existing, terr := store.GetUserByEmail(ctx, tx, normalized)
		if terr != nil {
			return terr
		}
		if existing == nil {
			username := normalized
			if at := strings.Index(normalized, "@"); at > 0 {
				username = normalized[:at]
			}
			user, terr = store.InsertUser(ctx, tx, normalized, username, passwordHash, "admin", nil)
			if terr != nil {
				return terr
			}
			action = "created"
		} else {
			user = existing
			if terr = store.PromoteAdmin(ctx, tx, user.ID, passwordHash); terr != nil {
				return terr
			}
			action = "promoted"
		}
		return store.InsertWallet(ctx, tx, user.ID)
	})
	if err != nil {
		return err
	}
	fmt.Printf("admin %s: %s (id=%s)\n", action, normalized, user.ID)
	return nil
}
