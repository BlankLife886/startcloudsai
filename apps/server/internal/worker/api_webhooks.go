package worker

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/hibiken/asynq"

	"github.com/BlankLife886/startcloudsai/server/internal/netguard"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const webhookMaxAttempts = 8

var webhookRetryDelays = []time.Duration{
	30 * time.Second, 2 * time.Minute, 10 * time.Minute, 30 * time.Minute,
	2 * time.Hour, 6 * time.Hour, 12 * time.Hour, 24 * time.Hour,
}

func webhookSignature(secret, timestamp string, payload []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write(payload)
	return "v1=" + hex.EncodeToString(mac.Sum(nil))
}

func webhookResponsePreview(body io.Reader) string {
	data, _ := io.ReadAll(io.LimitReader(body, 2048))
	return strings.TrimSpace(string(data))
}

func webhookRetryDelay(attempt int) time.Duration {
	if attempt < 0 {
		attempt = 0
	}
	if attempt >= len(webhookRetryDelays) {
		return webhookRetryDelays[len(webhookRetryDelays)-1]
	}
	return webhookRetryDelays[attempt]
}

func (w *Worker) handleDispatchAPIWebhooks(ctx context.Context, _ *asynq.Task) error {
	now := time.Now().UTC()
	deliveries, err := store.ClaimAPIWebhookDeliveries(ctx, w.St.Pool, w.workerID, now, 45*time.Second, 20)
	if err != nil {
		return err
	}
	client := netguard.NewHTTPClient(15*time.Second, false, true)
	for _, delivery := range deliveries {
		if err := netguard.ValidateURL(delivery.URL, false, true); err != nil {
			_ = store.FailAPIWebhookDelivery(ctx, w.St.Pool, delivery.ID, w.workerID,
				"webhook URL is no longer allowed", 0, now, now, 1)
			continue
		}
		secret, err := settings.DecryptSecret(delivery.SecretEncrypted, w.Cfg.AppSecret)
		if err != nil {
			_ = store.FailAPIWebhookDelivery(ctx, w.St.Pool, delivery.ID, w.workerID,
				"webhook secret cannot be decrypted", 0, now, now, 1)
			continue
		}
		timestamp := strconv.FormatInt(now.Unix(), 10)
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, delivery.URL, bytes.NewReader(delivery.Payload))
		if err == nil {
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("User-Agent", "StarClouds-Webhook/1.0")
			req.Header.Set("X-StarCloud-Event", delivery.EventType)
			req.Header.Set("X-StarCloud-Delivery", delivery.ID.String())
			req.Header.Set("X-StarCloud-Timestamp", timestamp)
			req.Header.Set("X-StarCloud-Signature", webhookSignature(secret, timestamp, delivery.Payload))
		}
		var response *http.Response
		if err == nil {
			response, err = client.Do(req)
		}
		if err == nil && response != nil {
			preview := webhookResponsePreview(response.Body)
			_ = response.Body.Close()
			if response.StatusCode >= 200 && response.StatusCode < 300 {
				if finishErr := store.CompleteAPIWebhookDelivery(ctx, w.St.Pool, delivery.ID, w.workerID, response.StatusCode, preview, time.Now().UTC()); finishErr != nil {
					return finishErr
				}
				continue
			}
			err = fmt.Errorf("webhook returned HTTP %d%s", response.StatusCode, func() string {
				if preview == "" {
					return ""
				}
				return ": " + preview
			}())
		}
		status := 0
		if response != nil {
			status = response.StatusCode
		}
		message := "webhook request failed"
		if err != nil {
			message = err.Error()
		}
		if len([]rune(message)) > 2000 {
			message = string([]rune(message)[:2000])
		}
		retryable := status == 0 || status == 408 || status == 425 || status == 429 || status >= 500
		maxAttempts := webhookMaxAttempts
		if !retryable {
			maxAttempts = 1
		}
		failedAt := time.Now().UTC()
		if failErr := store.FailAPIWebhookDelivery(ctx, w.St.Pool, delivery.ID, w.workerID, message, status,
			failedAt, failedAt.Add(webhookRetryDelay(delivery.Attempts)), maxAttempts); failErr != nil {
			return failErr
		}
	}
	return nil
}
