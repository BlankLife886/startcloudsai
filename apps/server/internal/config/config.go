// Package config 加载环境变量配置（与仓库根 .env.example 对齐）。
package config

import (
	"log"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	AppEnv         string
	AppSecret      string
	AllowedOrigins string
	TrustedProxies string
	PublicBaseURL  string
	// Historical handlers keep these zero-valued; no environment loads payment settings.
	PaymentMockEnabled   bool
	PaymentWebhookSecret string

	GitHubClientID     string
	GitHubClientSecret string
	SMTPAddr           string
	SMTPUser           string
	SMTPPassword       string
	SMTPFrom           string

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

// weakSecrets 已知的弱默认密钥（模板/示例值），生产环境禁止使用。
var weakSecrets = map[string]bool{
	"":                          true,
	"dev-secret-change-me":      true,
	"change-me-random-64-chars": true,
}

// validateSecret 生产环境弱密钥直接拒绝启动；开发环境仅告警。
func validateSecret(appEnv, secret string) {
	weak := weakSecrets[secret] || len(secret) < 32
	if !weak {
		return
	}
	if appEnv == "production" {
		log.Fatal("APP_SECRET 未设置或过弱（须为 ≥32 位随机字符串且非模板默认值），生产环境拒绝启动")
	}
	log.Printf("警告：APP_SECRET 过弱（仅开发环境允许），上线前请设置 ≥32 位随机字符串")
}

func Load() *Config {
	appEnv := strings.ToLower(strings.TrimSpace(getenv("APP_ENV", "development")))
	if appEnv != "development" && appEnv != "test" && appEnv != "production" {
		log.Fatalf("APP_ENV 必须为 development、test 或 production，当前为 %q", appEnv)
	}
	cfg := &Config{
		AppEnv:         appEnv,
		AppSecret:      getenv("APP_SECRET", "dev-secret-change-me"),
		AllowedOrigins: getenv("ALLOWED_ORIGINS", "http://localhost:8080"),
		// compose 内网网段：只信任内网反代设置的 X-Forwarded-For
		TrustedProxies: getenv("TRUSTED_PROXIES", "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"),
		PublicBaseURL:  getenv("PUBLIC_BASE_URL", "http://localhost:8080"),

		GitHubClientID:     getenv("GITHUB_CLIENT_ID", ""),
		GitHubClientSecret: getenv("GITHUB_CLIENT_SECRET", ""),
		SMTPAddr:           getenv("SMTP_ADDR", ""),
		SMTPUser:           getenv("SMTP_USER", ""),
		SMTPPassword:       getenv("SMTP_PASSWORD", ""),
		SMTPFrom:           getenv("SMTP_FROM", ""),

		DatabaseURL: getenv("DATABASE_URL", "postgres://starclouds:starclouds@localhost:5432/starclouds"),
		RedisURL:    getenv("REDIS_URL", "redis://localhost:6379/0"),

		C2ABaseURL:     getenv("C2A_BASE_URL", "http://localhost:3000"),
		C2AAPIKey:      getenv("C2A_API_KEY", ""),
		C2ATimeoutSecs: getenvInt("C2A_TIMEOUT_SECS", 600),

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
	validateSecret(cfg.AppEnv, cfg.AppSecret)
	if cfg.AppEnv == "production" {
		for _, origin := range cfg.AllowedOriginsList() {
			if !strings.HasPrefix(origin, "https://") {
				log.Fatalf("生产环境 ALLOWED_ORIGINS 只允许 HTTPS Origin，当前包含 %q", origin)
			}
		}
	}
	return cfg
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

// TrustedProxiesList 返回可信代理 CIDR 列表（空串 = 不信任任何代理）。
func (c *Config) TrustedProxiesList() []string {
	var out []string
	for _, p := range strings.Split(c.TrustedProxies, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
