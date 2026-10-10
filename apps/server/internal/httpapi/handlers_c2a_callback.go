package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	c2aCallbackBodyLimit = 16 << 10
	c2aCallbackMaxSkew   = 5 * time.Minute
)

type c2aImageTaskEvent struct {
	ID         string `json:"id"`
	Status     string `json:"status"`
	UpdatedAt  string `json:"updated_at"`
	DurationMS int64  `json:"duration_ms"`
	ImageCount int    `json:"image_count"`
	ErrorCode  string `json:"error_code"`
	Error      string `json:"error"`
}

func (s *Server) c2aImageTaskEvent(c *gin.Context) {
	secret := strings.TrimSpace(s.Cfg.C2ACallbackSecret)
	if secret == "" || s.c2aCallbackRoutes == nil || s.enqueueImagePoll == nil {
		c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"success": false, "code": "not_found", "error": "Not Found"})
		return
	}
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, c2aCallbackBodyLimit+1))
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"success": false, "code": "bad_request", "error": "Invalid callback"})
		return
	}
	if len(body) > c2aCallbackBodyLimit {
		c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, gin.H{"success": false, "code": "payload_too_large", "error": "Payload too large"})
		return
	}
	timestamp, ok := validC2ACallbackSignature(
		secret,
		c.GetHeader("X-C2A-Timestamp"),
		c.GetHeader("X-C2A-Signature"),
		body,
		time.Now().UTC(),
	)
	if !ok {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "code": "unauthorized", "error": "Unauthorized"})
		return
	}
	var event c2aImageTaskEvent
	if err := json.Unmarshal(body, &event); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"success": false, "code": "bad_request", "error": "Invalid callback"})
		return
	}
	taskID, err := uuid.Parse(strings.TrimSpace(event.ID))
	if err != nil || (event.Status != "success" && event.Status != "error") {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"success": false, "code": "bad_request", "error": "Invalid callback"})
		return
	}
	routes, err := s.c2aCallbackRoutes(c.Request.Context(), taskID)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"success": false, "code": "temporarily_unavailable", "error": "Temporarily unavailable"})
		return
	}
	for _, route := range routes {
		if err := s.enqueueImagePoll(
			c.Request.Context(),
			route.ProviderID,
			route.RouteID,
			route.RouteKey,
			int(timestamp%2),
			0,
		); err != nil {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"success": false, "code": "temporarily_unavailable", "error": "Temporarily unavailable"})
			return
		}
	}
	c.JSON(http.StatusAccepted, gin.H{"success": true})
}

func validC2ACallbackSignature(secret, timestampText, signatureText string, body []byte, now time.Time) (int64, bool) {
	timestamp, err := strconv.ParseInt(strings.TrimSpace(timestampText), 10, 64)
	if err != nil || timestamp <= 0 {
		return 0, false
	}
	callbackAt := time.Unix(timestamp, 0)
	if callbackAt.Before(now.Add(-c2aCallbackMaxSkew)) || callbackAt.After(now.Add(c2aCallbackMaxSkew)) {
		return 0, false
	}
	const prefix = "sha256="
	signatureText = strings.TrimSpace(signatureText)
	if !strings.HasPrefix(signatureText, prefix) {
		return 0, false
	}
	provided, err := hex.DecodeString(strings.TrimPrefix(signatureText, prefix))
	if err != nil || len(provided) != sha256.Size {
		return 0, false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(strconv.FormatInt(timestamp, 10)))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write(body)
	return timestamp, hmac.Equal(provided, mac.Sum(nil))
}
