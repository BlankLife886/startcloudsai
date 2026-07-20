// Package config 加载环境变量配置（与仓库根 .env.example 对齐）。
package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	AppEnv         string
	AppSecret      string
	AllowedOrigins string

	DatabaseURL string
	RedisURL    string

	C2ABaseURL     string
	C2AAPIKey      string
	C2ATimeoutSecs int

	R2Endpoint          string
	R2AccessKeyID       string
	R2SecretAccessKey   string
	R2Bucket            string
	R2PresignExpireSecs int

	WorkerConcurrency   int
	UserMaxRunningTasks int

	SessionCookieName string
	SessionTTLDays    int
	UploadMaxBytes    int64
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getenvInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
			return n
		}
	}
	return def
}

func Load() *Config {
	return &Config{
		AppEnv:         getenv("APP_ENV", "development"),
		AppSecret:      getenv("APP_SECRET", "dev-secret-change-me"),
		AllowedOrigins: getenv("ALLOWED_ORIGINS", "http://localhost:8080"),

		DatabaseURL: getenv("DATABASE_URL", "postgres://starclouds:starclouds@localhost:5432/starclouds"),
		RedisURL:    getenv("REDIS_URL", "redis://localhost:6379/0"),

		C2ABaseURL:     getenv("C2A_BASE_URL", "http://localhost:3000"),
		C2AAPIKey:      getenv("C2A_API_KEY", ""),
		C2ATimeoutSecs: getenvInt("C2A_TIMEOUT_SECS", 180),

		R2Endpoint:          getenv("R2_ENDPOINT", ""),
		R2AccessKeyID:       getenv("R2_ACCESS_KEY_ID", ""),
		R2SecretAccessKey:   getenv("R2_SECRET_ACCESS_KEY", ""),
		R2Bucket:            getenv("R2_BUCKET", "starcloudsai"),
		R2PresignExpireSecs: getenvInt("R2_PRESIGN_EXPIRE_SECS", 3600),

		WorkerConcurrency:   getenvInt("WORKER_CONCURRENCY", 8),
		UserMaxRunningTasks: getenvInt("USER_MAX_RUNNING_TASKS", 3),

		SessionCookieName: "sc_session",
		SessionTTLDays:    30,
		UploadMaxBytes:    15 * 1024 * 1024,
	}
}

// AllowedOriginsList 返回去掉尾部斜杠的 Origin 白名单。
func (c *Config) AllowedOriginsList() []string {
	var out []string
	for _, o := range strings.Split(c.AllowedOrigins, ",") {
		o = strings.TrimRight(strings.TrimSpace(o), "/")
		if o != "" {
			out = append(out, o)
		}
	}
	return out
}
