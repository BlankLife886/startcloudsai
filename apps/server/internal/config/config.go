// Package config 加载环境变量配置（与仓库根 .env.example 对齐）。
package config

import (
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var assistantOCRLanguagesRE = regexp.MustCompile(`^[A-Za-z0-9_.+-]+$`)

type Config struct {
	AppEnv         string
	AppSecret      string
	AllowedOrigins string
	TrustedProxies string
	// DevLoginCodeEcho 显式开启后，本地无 SMTP 时登录接口才会在响应中回显
	// 验证码（developmentCode）。缺省关闭：即使 APP_ENV=development 也不回显，
	// 避免 APP_ENV 缺省值把验证码泄露变成 fail-open 行为。生产环境强制关闭。
	DevLoginCodeEcho bool
	// Historical mock payment fields remain zero-valued. Real payments use the
	// LanjingPay settings below and are enabled only when the secret and public
	// notification URL are both configured.
	PaymentMockEnabled    bool
	PaymentWebhookSecret  string
	LanjingPayBaseURL     string
	LanjingPaySecret      string
	LanjingPayNotifyURL   string
	LanjingPayTimeoutSecs int

	SMTPAddr     string
	SMTPUser     string
	SMTPPassword string
	SMTPFrom     string
	// TrialApplicationEmail 接收体验资格申请通知；为空时回退到 SMTPFrom。
	TrialApplicationEmail string

	DatabaseURL         string
	RedisURL            string
	DBMaxConns          int32
	DBMinConns          int32
	DBMaxConnLifetime   time.Duration
	DBMaxConnIdleTime   time.Duration
	DBHealthCheckPeriod time.Duration

	C2ABaseURL     string
	C2AAPIKey      string
	C2ATimeoutSecs int

	Sub2APIBaseURL     string
	Sub2APIAPIKey      string
	Sub2APIChatModel   string
	Sub2APIImageModel  string
	Sub2APITimeoutSecs int

	CRUNBaseURL     string
	CRUNAPIKey      string
	CRUNTimeoutSecs int

	R2Endpoint          string
	R2AccessKeyID       string
	R2SecretAccessKey   string
	R2Bucket            string
	R2PresignExpireSecs int

	WorkerConcurrency      int
	WorkerPollConcurrency  int
	UserMaxRunningTasks    int
	WorkerImageMemoryMiB   int64
	APIPprofAddr           string
	WorkerPprofAddr        string
	AssistantOCREnabled    bool
	AssistantPDFToPPMPath  string
	AssistantTesseractPath string
	AssistantOCRLanguages  string
	AssistantOCRMaxPages   int
	AssistantOCRTimeout    time.Duration

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

func getenvInt32(key string, def int32) int32 {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		if parsed, err := strconv.ParseInt(value, 10, 32); err == nil {
			return int32(parsed)
		}
	}
	return def
}

func getenvBool(key string, def bool) bool {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		if parsed, err := strconv.ParseBool(value); err == nil {
			return parsed
		}
	}
	return def
}

func getenvDuration(key string, def time.Duration) time.Duration {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		if parsed, err := time.ParseDuration(value); err == nil && parsed > 0 {
			return parsed
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
		AppEnv:           appEnv,
		DevLoginCodeEcho: getenvBool("DEV_LOGIN_CODE_ECHO", false),
		AppSecret:        getenv("APP_SECRET", "dev-secret-change-me"),
		AllowedOrigins:   getenv("ALLOWED_ORIGINS", "http://localhost:8080,http://localhost:3102,http://localhost:3105,http://localhost:3200,http://127.0.0.1:8080,http://127.0.0.1:3102,http://127.0.0.1:3105,http://127.0.0.1:3200"),
		// compose 内网网段：只信任内网反代设置的 X-Forwarded-For
		TrustedProxies: getenv("TRUSTED_PROXIES", "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"),
		SMTPAddr:       getenv("SMTP_ADDR", ""),
		SMTPUser:       getenv("SMTP_USER", ""),
		SMTPPassword:   getenv("SMTP_PASSWORD", ""),
		SMTPFrom:       getenv("SMTP_FROM", ""),
		TrialApplicationEmail: strings.TrimSpace(getenv(
			"TRIAL_APPLICATION_EMAIL",
			getenv("SMTP_FROM", ""),
		)),
		LanjingPayBaseURL:     strings.TrimRight(strings.TrimSpace(getenv("LANJING_PAY_BASE_URL", "https://2347537.pay.lanjingzf.com")), "/"),
		LanjingPaySecret:      strings.TrimSpace(getenv("LANJING_PAY_SECRET", "")),
		LanjingPayNotifyURL:   strings.TrimSpace(getenv("LANJING_PAY_NOTIFY_URL", "")),
		LanjingPayTimeoutSecs: getenvInt("LANJING_PAY_TIMEOUT_SECS", 10),

		DatabaseURL:         getenv("DATABASE_URL", "postgres://starclouds:starclouds@localhost:5432/starclouds"),
		RedisURL:            getenv("REDIS_URL", "redis://localhost:6379/0"),
		DBMaxConns:          getenvInt32("DB_MAX_CONNS", 0),
		DBMinConns:          getenvInt32("DB_MIN_CONNS", 0),
		DBMaxConnLifetime:   getenvDuration("DB_MAX_CONN_LIFETIME", 30*time.Minute),
		DBMaxConnIdleTime:   getenvDuration("DB_MAX_CONN_IDLE_TIME", 5*time.Minute),
		DBHealthCheckPeriod: getenvDuration("DB_HEALTH_CHECK_PERIOD", time.Minute),

		C2ABaseURL:     getenv("C2A_BASE_URL", "http://localhost:3000"),
		C2AAPIKey:      getenv("C2A_API_KEY", ""),
		C2ATimeoutSecs: getenvInt("C2A_TIMEOUT_SECS", 600),

		Sub2APIBaseURL:     getenv("SUB2API_BASE_URL", "http://localhost:8080"),
		Sub2APIAPIKey:      getenv("SUB2API_API_KEY", ""),
		Sub2APIChatModel:   getenv("SUB2API_CHAT_MODEL", "gpt-5.4"),
		Sub2APIImageModel:  getenv("SUB2API_IMAGE_MODEL", "gpt-image-2"),
		Sub2APITimeoutSecs: getenvInt("SUB2API_TIMEOUT_SECS", 300),

		CRUNBaseURL:     getenv("CRUN_BASE_URL", "https://api.crun.ai"),
		CRUNAPIKey:      getenv("CRUN_API_KEY", ""),
		CRUNTimeoutSecs: getenvInt("CRUN_TIMEOUT_SECS", 1200),

		R2Endpoint:          getenv("R2_ENDPOINT", ""),
		R2AccessKeyID:       getenv("R2_ACCESS_KEY_ID", ""),
		R2SecretAccessKey:   getenv("R2_SECRET_ACCESS_KEY", ""),
		R2Bucket:            getenv("R2_BUCKET", "starcloudsai"),
		R2PresignExpireSecs: getenvInt("R2_PRESIGN_EXPIRE_SECS", 3600),

		WorkerConcurrency:      getenvInt("WORKER_CONCURRENCY", 32),
		WorkerPollConcurrency:  getenvInt("WORKER_POLL_CONCURRENCY", 0),
		UserMaxRunningTasks:    getenvInt("USER_MAX_RUNNING_TASKS", 100),
		WorkerImageMemoryMiB:   int64(getenvInt("WORKER_IMAGE_MEMORY_MIB", 1024)),
		APIPprofAddr:           strings.TrimSpace(getenv("API_PPROF_ADDR", "")),
		WorkerPprofAddr:        strings.TrimSpace(getenv("WORKER_PPROF_ADDR", "")),
		AssistantOCREnabled:    getenvBool("ASSISTANT_OCR_ENABLED", false),
		AssistantPDFToPPMPath:  strings.TrimSpace(getenv("ASSISTANT_OCR_PDFTOPPM_PATH", "/usr/bin/pdftoppm")),
		AssistantTesseractPath: strings.TrimSpace(getenv("ASSISTANT_OCR_TESSERACT_PATH", "/usr/bin/tesseract")),
		AssistantOCRLanguages:  strings.TrimSpace(getenv("ASSISTANT_OCR_LANGUAGES", "chi_sim+eng")),
		AssistantOCRMaxPages:   getenvInt("ASSISTANT_OCR_MAX_PAGES", 20),
		AssistantOCRTimeout:    getenvDuration("ASSISTANT_OCR_TIMEOUT", 90*time.Second),

		SessionCookieName: "sc_session",
		SessionTTLDays:    30,
		UploadMaxBytes:    15 * 1024 * 1024,
	}
	if cfg.DBMaxConns < 0 || cfg.DBMinConns < 0 || (cfg.DBMaxConns == 0 && cfg.DBMinConns > 0) || (cfg.DBMaxConns > 0 && cfg.DBMinConns > cfg.DBMaxConns) {
		log.Fatal("数据库连接池配置无效：须满足 0 <= DB_MIN_CONNS <= DB_MAX_CONNS")
	}
	if cfg.WorkerImageMemoryMiB < 64 {
		log.Fatal("WORKER_IMAGE_MEMORY_MIB 不能小于 64")
	}
	if cfg.AssistantOCREnabled {
		if !filepath.IsAbs(cfg.AssistantPDFToPPMPath) || !filepath.IsAbs(cfg.AssistantTesseractPath) {
			log.Fatal("ASSISTANT_OCR_PDFTOPPM_PATH 与 ASSISTANT_OCR_TESSERACT_PATH 必须是绝对路径")
		}
		if cfg.AssistantOCRLanguages == "" || len(cfg.AssistantOCRLanguages) > 100 || !assistantOCRLanguagesRE.MatchString(cfg.AssistantOCRLanguages) ||
			cfg.AssistantOCRMaxPages < 1 || cfg.AssistantOCRMaxPages > 20 || cfg.AssistantOCRTimeout > 5*time.Minute {
			log.Fatal("OCR 配置无效：语言不能为空，页数须为 1-20，超时不能超过 5 分钟")
		}
	}
	if (cfg.LanjingPaySecret != "" || cfg.LanjingPayNotifyURL != "") && !cfg.LanjingPayEnabled() {
		log.Fatal("蓝鲸支付配置不完整：LANJING_PAY_SECRET 与 LANJING_PAY_NOTIFY_URL 必须同时设置")
	}
	if cfg.LanjingPayTimeoutSecs <= 0 {
		log.Fatal("LANJING_PAY_TIMEOUT_SECS 必须为正整数")
	}
	validateSecret(cfg.AppEnv, cfg.AppSecret)
	if cfg.AppEnv == "production" {
		for _, origin := range cfg.AllowedOriginsList() {
			if !strings.HasPrefix(origin, "https://") {
				log.Fatalf("生产环境 ALLOWED_ORIGINS 只允许 HTTPS Origin，当前包含 %q", origin)
			}
		}
		if cfg.DevLoginCodeEcho {
			log.Printf("警告：生产环境忽略 DEV_LOGIN_CODE_ECHO=true，验证码不会回显")
			cfg.DevLoginCodeEcho = false
		}
	} else {
		log.Printf("========================================================")
		log.Printf("警告：APP_ENV=%s（非生产环境）：Cookie 不带 Secure、SSRF 防护"+
			"放开内网地址。生产部署必须显式设置 APP_ENV=production", cfg.AppEnv)
		log.Printf("========================================================")
	}
	return cfg
}

func (c *Config) LanjingPayEnabled() bool {
	return strings.TrimSpace(c.LanjingPayBaseURL) != "" &&
		strings.TrimSpace(c.LanjingPaySecret) != "" &&
		strings.TrimSpace(c.LanjingPayNotifyURL) != ""
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
