// Package store 提供 pgx 连接池、事务帮助函数与各表数据访问（手写 SQL）。
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql pgx driver（goose 迁移用）
	"github.com/pressly/goose/v3"

	"github.com/BlankLife886/startcloudsai/server/migrations"
)

// Q 是 *pgxpool.Pool 与 pgx.Tx 的公共查询接口。
type Q interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type Store struct {
	Pool *pgxpool.Pool
}

type PoolConfig struct {
	MaxConns          int32
	MinConns          int32
	MaxConnLifetime   time.Duration
	MaxConnIdleTime   time.Duration
	HealthCheckPeriod time.Duration
}

func New(ctx context.Context, databaseURL string) (*Store, error) {
	return NewWithPoolConfig(ctx, databaseURL, PoolConfig{})
}

func NewWithPoolConfig(ctx context.Context, databaseURL string, tuning PoolConfig) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse pgx pool config: %w", err)
	}
	if tuning.MaxConns > 0 {
		cfg.MaxConns = tuning.MaxConns
	}
	if tuning.MinConns > 0 {
		cfg.MinConns = tuning.MinConns
	}
	if tuning.MaxConnLifetime > 0 {
		cfg.MaxConnLifetime = tuning.MaxConnLifetime
	}
	if tuning.MaxConnIdleTime > 0 {
		cfg.MaxConnIdleTime = tuning.MaxConnIdleTime
	}
	if tuning.HealthCheckPeriod > 0 {
		cfg.HealthCheckPeriod = tuning.HealthCheckPeriod
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pgx pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return &Store{Pool: pool}, nil
}

func (s *Store) Close() { s.Pool.Close() }

// Tx 在一个事务内执行 fn，出错回滚。
func (s *Store) Tx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// IsUniqueViolation 判断是否为唯一约束冲突（SQLSTATE 23505），可按约束名过滤。
func IsUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		return false
	}
	return constraint == "" || pgErr.ConstraintName == constraint
}

// Migrate 用 embed 的 goose 迁移把数据库升级到最新。
func Migrate(databaseURL string) error {
	sqlDB, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return fmt.Errorf("open database for migration: %w", err)
	}
	defer sqlDB.Close()
	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	goose.SetLogger(goose.NopLogger())
	return goose.Up(sqlDB, ".")
}
