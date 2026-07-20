// Package testdb 在本机真实 Postgres 上创建/销毁临时测试库。
//
// TEST_DATABASE_URL 指向管理连接（默认 postgres://localhost:5432/postgres），
// 每次 Setup 派生一个唯一命名的临时库并跑全部 goose 迁移。
package testdb

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func adminURL() string {
	if v := os.Getenv("TEST_DATABASE_URL"); v != "" {
		return v
	}
	return "postgres://localhost:5432/postgres"
}

func withDatabase(baseURL, dbName string) string {
	u, err := url.Parse(baseURL)
	if err != nil {
		panic(fmt.Sprintf("bad TEST_DATABASE_URL: %v", err))
	}
	u.Path = "/" + dbName
	return u.String()
}

// Setup 建临时库 + 迁移，返回 store；测试结束自动删库。
func Setup(t *testing.T) *store.Store {
	t.Helper()
	ctx := context.Background()

	dbName := fmt.Sprintf("sc_test_%d_%s", time.Now().UnixNano(),
		strings.ToLower(strings.NewReplacer("/", "_", " ", "_", "#", "_").Replace(t.Name())))
	if len(dbName) > 60 {
		dbName = dbName[:60]
	}

	admin, err := pgx.Connect(ctx, adminURL())
	if err != nil {
		t.Fatalf("connect admin database (set TEST_DATABASE_URL?): %v", err)
	}
	if _, err := admin.Exec(ctx, fmt.Sprintf(`CREATE DATABASE %q`, dbName)); err != nil {
		_ = admin.Close(ctx)
		t.Fatalf("create temp database: %v", err)
	}
	_ = admin.Close(ctx)

	dbURL := withDatabase(adminURL(), dbName)
	if err := store.Migrate(dbURL); err != nil {
		dropDatabase(t, dbName)
		t.Fatalf("migrate temp database: %v", err)
	}
	st, err := store.New(ctx, dbURL)
	if err != nil {
		dropDatabase(t, dbName)
		t.Fatalf("connect temp database: %v", err)
	}
	t.Cleanup(func() {
		st.Close()
		dropDatabase(t, dbName)
	})
	return st
}

func dropDatabase(t *testing.T, dbName string) {
	t.Helper()
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, adminURL())
	if err != nil {
		t.Logf("connect admin for drop: %v", err)
		return
	}
	defer admin.Close(ctx)
	if _, err := admin.Exec(ctx, fmt.Sprintf(`DROP DATABASE IF EXISTS %q WITH (FORCE)`, dbName)); err != nil {
		t.Logf("drop temp database %s: %v", dbName, err)
	}
}
