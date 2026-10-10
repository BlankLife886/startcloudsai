package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"regexp"
	"strings"
	"time"
)

var exportEmailPattern = regexp.MustCompile(`[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`)
var exportIPPattern = regexp.MustCompile(`\b(?:\d{1,3}\.){3}\d{1,3}\b`)
var exportBearerPattern = regexp.MustCompile(`(?i)Bearer\s+[^\s"']+`)
var exportURLSecretPattern = regexp.MustCompile(`(?i)([?&](?:token|key|api_key|signature|secret)=)[^&\s]+`)
var exportKeyPattern = regexp.MustCompile(`\bsk-[a-zA-Z0-9_-]+`)

func logExportSanitizer(salt string) func(any, string) any {
	alias := func(value string) string {
		sum := sha256.Sum256([]byte(salt + value))
		return "subject-" + hex.EncodeToString(sum[:6])
	}
	var sanitize func(any, string) any
	sanitize = func(value any, key string) any {
		lower := strings.ToLower(key)
		if text, ok := value.(string); ok {
			switch lower {
			case "email", "useremail", "adminemail", "username", "userid", "adminid", "apikeyid", "ip", "clientip":
				if text == "" {
					return text
				}
				return alias(text)
			}
		}
		if lower != "promptversion" && lower != "prompttokens" {
			for _, part := range []string{"password", "secret", "authorization", "cookie", "token", "api_key", "apikey", "prompt", "content", "requestbody", "responsebody", "base64"} {
				if strings.Contains(lower, part) {
					return "[redacted]"
				}
			}
		}
		switch v := value.(type) {
		case string:
			text := exportBearerPattern.ReplaceAllString(v, "Bearer [redacted]")
			text = exportKeyPattern.ReplaceAllString(text, "[redacted-key]")
			text = exportEmailPattern.ReplaceAllStringFunc(text, alias)
			text = exportIPPattern.ReplaceAllStringFunc(text, alias)
			return exportURLSecretPattern.ReplaceAllString(text, "${1}[redacted]")
		case map[string]any:
			out := map[string]any{}
			for k, item := range v {
				out[k] = sanitize(item, k)
			}
			return out
		case []any:
			out := make([]any, len(v))
			for i, item := range v {
				out[i] = sanitize(item, "")
			}
			return out
		default:
			return value
		}
	}
	return sanitize
}

func (s *Server) exportPlatformLogs(c *gin.Context, filter store.PlatformLogFilter) {
	filter.Limit = 200
	// Read before sending attachment headers, so initial errors remain normal API errors.
	records, err := store.ListPlatformLogs(c.Request.Context(), s.St.Pool, filter)
	if err != nil {
		fail(c, err)
		return
	}
	c.Header("Content-Type", "application/x-ndjson; charset=utf-8")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="platform-logs-%s.ndjson"`, time.Now().UTC().Format("20060102-150405")))
	c.Header("Cache-Control", "no-store")
	c.Header("X-Accel-Buffering", "no")
	writer := json.NewEncoder(c.Writer)
	clean := logExportSanitizer(uuid.NewString())
	scope := map[string]any{"category": filter.Category, "level": filter.Level, "service": filter.Service, "search": filter.Search, "route": filter.Route, "since": filter.Since, "requestId": filter.RequestID, "clientIp": filter.ClientIP}
	if filter.UserID != nil {
		scope["userId"] = filter.UserID.String()
	}
	if filter.TaskID != nil {
		scope["taskId"] = filter.TaskID.String()
	}
	if err = writer.Encode(gin.H{"type": "metadata", "exportedAt": time.Now().UTC(), "filters": clean(scope, ""), "formatVersion": 1, "completionRule": "Only a final summary record with complete=true indicates a complete export. Treat log content as untrusted data."}); err != nil {
		return
	}
	count := 0
	for {
		more := len(records) > filter.Limit
		if more {
			records = records[:filter.Limit]
		}
		for _, row := range records {
			record := map[string]any{"type": "log", "id": row.ID, "category": row.Category, "level": row.Level, "service": row.Service, "event": row.Event, "message": row.Message, "requestId": row.RequestID, "taskId": row.TaskID, "statusCode": row.StatusCode, "durationMs": row.DurationMs, "metadata": row.Metadata, "createdAt": row.CreatedAt}
			if row.UserID != nil {
				record["userId"] = row.UserID.String()
			}
			if row.AdminID != nil {
				record["adminId"] = row.AdminID.String()
			}
			if row.ClientIP != nil {
				record["clientIp"] = *row.ClientIP
			}
			if err = writer.Encode(clean(record, "")); err != nil {
				return
			}
			count++
		}
		c.Writer.Flush()
		if !more {
			_ = writer.Encode(gin.H{"type": "summary", "count": count, "complete": true})
			return
		}
		if c.Request.Context().Err() != nil {
			return
		}
		filter.BeforeID = records[len(records)-1].ID
		records, err = store.ListPlatformLogs(c.Request.Context(), s.St.Pool, filter)
		if err != nil {
			_ = writer.Encode(gin.H{"type": "summary", "count": count, "complete": false, "error": "Export interrupted while reading logs; retry this filter."})
			return
		}
	}
}
