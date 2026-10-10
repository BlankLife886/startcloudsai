package platformlog

import (
	"context"
	"encoding/json"
	"log"
	"log/slog"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/google/uuid"
)

const configRefreshInterval = 10 * time.Second

type Config struct {
	Enabled           bool  `json:"enabled"`
	SecurityEnabled   bool  `json:"securityEnabled"`
	OperationsEnabled bool  `json:"operationsEnabled"`
	UserEnabled       bool  `json:"userEnabled"`
	RetentionDays     int64 `json:"retentionDays"`
	MaxMB             int64 `json:"maxMb"`
}

func (c Config) CategoryEnabled(category string) bool {
	if !c.Enabled {
		return false
	}
	switch category {
	case "security":
		return c.SecurityEnabled
	case "operations":
		return c.OperationsEnabled
	case "user":
		return c.UserEnabled
	default:
		return false
	}
}

func LoadConfig(ctx context.Context, q store.Q) (Config, error) {
	all, err := settings.GetAll(ctx, q)
	if err != nil {
		return Config{}, err
	}
	config := Config{
		SecurityEnabled: true, OperationsEnabled: true,
		RetentionDays: 7, MaxMB: 256,
	}
	readBool := func(key string, target *bool) {
		if raw := all[key]; raw != nil {
			_ = json.Unmarshal(raw, target)
		}
	}
	readInt := func(key string, target *int64) {
		if raw := all[key]; raw != nil {
			_ = json.Unmarshal(raw, target)
		}
	}
	readBool("platform_logging_enabled", &config.Enabled)
	readBool("platform_log_security_enabled", &config.SecurityEnabled)
	readBool("platform_log_operations_enabled", &config.OperationsEnabled)
	readBool("platform_log_user_enabled", &config.UserEnabled)
	readInt("platform_log_retention_days", &config.RetentionDays)
	readInt("platform_log_max_mb", &config.MaxMB)
	config.RetentionDays = min(max(config.RetentionDays, 1), 90)
	config.MaxMB = min(max(config.MaxMB, 32), 4096)
	return config, nil
}

type Event struct {
	Category   string
	Level      string
	Event      string
	Message    string
	RequestID  string
	UserID     *uuid.UUID
	AdminID    *uuid.UUID
	TaskID     *uuid.UUID
	ClientIP   string
	StatusCode *int
	DurationMs *int64
	Metadata   map[string]any
}

// Recorder has no queue or background goroutine. When disabled it retains only
// a small immutable config snapshot and returns before allocating log payloads
// or writing to PostgreSQL.
type Recorder struct {
	q       store.Q
	service string
	config  atomic.Pointer[Config]
	loaded  atomic.Int64
	mu      sync.Mutex
}

func New(q store.Q, service string) *Recorder {
	return &Recorder{q: q, service: cleanText(service, 40)}
}

func (r *Recorder) Invalidate() {
	if r != nil {
		r.loaded.Store(0)
	}
}

func (r *Recorder) Current(ctx context.Context) Config {
	if r == nil || r.q == nil {
		return Config{}
	}
	now := time.Now().UnixNano()
	if cached := r.config.Load(); cached != nil && now-r.loaded.Load() < configRefreshInterval.Nanoseconds() {
		return *cached
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if cached := r.config.Load(); cached != nil && now-r.loaded.Load() < configRefreshInterval.Nanoseconds() {
		return *cached
	}
	config, err := LoadConfig(ctx, r.q)
	if err != nil {
		// Fail closed: a settings/database problem must never create an
		// unbounded logging path.
		slog.Warn("platform_log_config_load_failed", "service", r.service, "error", err)
		config = Config{}
	}
	r.config.Store(&config)
	r.loaded.Store(now)
	return config
}

func (r *Recorder) Enabled(ctx context.Context, category string) bool {
	return r != nil && r.Current(ctx).CategoryEnabled(category)
}

func (r *Recorder) Record(ctx context.Context, event Event) {
	if r == nil || r.q == nil || !r.Enabled(ctx, event.Category) {
		return
	}
	if !store.Contains(store.PlatformLogLevels, event.Level) {
		event.Level = "info"
	}
	if ctx == nil || ctx.Err() != nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
	}
	item := store.NewPlatformLog{
		Category:   event.Category,
		Level:      event.Level,
		Service:    r.service,
		Event:      cleanText(event.Event, 120),
		Message:    cleanText(event.Message, 1000),
		UserID:     event.UserID,
		AdminID:    event.AdminID,
		TaskID:     event.TaskID,
		StatusCode: event.StatusCode,
		DurationMs: event.DurationMs,
		Metadata:   sanitizeMetadata(event.Metadata, 0),
	}
	if value := cleanText(event.RequestID, 100); value != "" {
		item.RequestID = &value
	}
	if event.Category == "security" {
		if value := cleanText(event.ClientIP, 64); value != "" {
			item.ClientIP = &value
		}
	}
	if err := store.InsertPlatformLog(ctx, r.q, item); err != nil {
		slog.Warn("platform_log_write_failed", "service", r.service, "category", event.Category, "event", event.Event, "error", err)
	}
}

func cleanText(value string, maxRunes int) string {
	value = strings.TrimSpace(value)
	if value == "" || maxRunes <= 0 {
		return value
	}
	if utf8.RuneCountInString(value) <= maxRunes {
		return value
	}
	runes := []rune(value)
	return string(runes[:maxRunes])
}

func sensitiveKey(key string) bool {
	key = strings.ToLower(strings.TrimSpace(key))
	for _, part := range []string{"password", "secret", "token", "cookie", "authorization", "api_key", "apikey", "prompt", "content", "base64", "image_data"} {
		if strings.Contains(key, part) {
			return true
		}
	}
	return false
}

func sanitizeMetadata(input map[string]any, depth int) map[string]any {
	if len(input) == 0 || depth > 2 {
		return map[string]any{}
	}
	out := make(map[string]any, min(len(input), 32))
	count := 0
	for key, value := range input {
		if count >= 32 {
			break
		}
		key = cleanText(key, 80)
		if key == "" || sensitiveKey(key) {
			continue
		}
		switch typed := value.(type) {
		case nil, bool, int, int32, int64, uint, uint32, uint64, float32, float64:
			out[key] = typed
		case string:
			out[key] = cleanText(typed, 500)
		case uuid.UUID:
			out[key] = typed.String()
		case time.Time:
			out[key] = typed.UTC().Format(time.RFC3339Nano)
		case map[string]any:
			out[key] = sanitizeMetadata(typed, depth+1)
		default:
			// Unknown structs and byte slices are intentionally excluded. This
			// prevents request bodies and binary data from entering logs.
			continue
		}
		count++
	}
	return out
}

func ConfigureConsole(service string) {
	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
	logger := slog.New(handler).With("service", cleanText(service, 40))
	slog.SetDefault(logger)
	bridge := slog.NewLogLogger(logger.Handler(), slog.LevelInfo)
	log.SetFlags(0)
	log.SetOutput(bridge.Writer())
}
