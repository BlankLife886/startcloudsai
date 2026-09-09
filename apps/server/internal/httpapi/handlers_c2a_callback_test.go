package httpapi

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const testC2ACallbackSecret = "test-c2a-callback-secret-long-enough"

func signedC2ACallbackRequest(t *testing.T, secret, timestamp, body string) *http.Request {
	t.Helper()
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp + "." + body))
	req := httptest.NewRequest(http.MethodPost, "/internal/c2a/image-task-events", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-C2A-Timestamp", timestamp)
	req.Header.Set("X-C2A-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
	return req
}

func callbackTestServer(secret string) *Server {
	return &Server{
		Cfg: &config.Config{AppEnv: "test", C2ACallbackSecret: secret},
		c2aCallbackRoutes: func(context.Context, uuid.UUID) ([]store.AsyncPendingRoute, error) {
			return nil, nil
		},
		enqueueImagePoll: func(context.Context, string, string, string, int, time.Duration) error {
			return nil
		},
	}
}

func TestC2AImageTaskEventValidSignatureEnqueuesActiveRoutes(t *testing.T) {
	taskID := uuid.New()
	now := time.Now().UTC().Unix()
	body := fmt.Sprintf(`{"id":%q,"status":"success","updated_at":"","duration_ms":1,"image_count":2,"error_code":"","error":""}`, taskID)
	s := callbackTestServer(testC2ACallbackSecret)
	s.c2aCallbackRoutes = func(_ context.Context, id uuid.UUID) ([]store.AsyncPendingRoute, error) {
		if id != taskID {
			t.Fatalf("resolved task id = %s, want %s", id, taskID)
		}
		return []store.AsyncPendingRoute{{ProviderID: "provider", RouteID: "route", RouteKey: "provider/route"}}, nil
	}
	var enqueued int
	s.enqueueImagePoll = func(_ context.Context, providerID, routeID, routeKey string, generation int, delay time.Duration) error {
		enqueued++
		if providerID != "provider" || routeID != "route" || routeKey != "provider/route" || generation != int(now%2) || delay != 0 {
			t.Fatalf("unexpected enqueue: %q %q %q generation=%d delay=%s", providerID, routeID, routeKey, generation, delay)
		}
		return nil
	}
	recorder := httptest.NewRecorder()
	s.Router().ServeHTTP(recorder, signedC2ACallbackRequest(t, testC2ACallbackSecret, fmt.Sprint(now), body))
	if recorder.Code != http.StatusAccepted || enqueued != 1 {
		t.Fatalf("status=%d enqueued=%d body=%s", recorder.Code, enqueued, recorder.Body.String())
	}
}

func TestC2AImageTaskEventRejectsInvalidOrStaleSignature(t *testing.T) {
	taskID := uuid.New()
	body := fmt.Sprintf(`{"id":%q,"status":"error"}`, taskID)
	tests := []struct {
		name      string
		secret    string
		timestamp int64
	}{
		{name: "invalid signature", secret: "wrong-secret", timestamp: time.Now().Unix()},
		{name: "stale timestamp", secret: testC2ACallbackSecret, timestamp: time.Now().Add(-6 * time.Minute).Unix()},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := callbackTestServer(testC2ACallbackSecret)
			recorder := httptest.NewRecorder()
			s.Router().ServeHTTP(recorder, signedC2ACallbackRequest(t, tt.secret, fmt.Sprint(tt.timestamp), body))
			if recorder.Code != http.StatusUnauthorized {
				t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
			}
		})
	}
}

func TestC2AImageTaskEventRejectsMissingTaskID(t *testing.T) {
	now := time.Now().Unix()
	body := `{"id":"","status":"success"}`
	s := callbackTestServer(testC2ACallbackSecret)
	recorder := httptest.NewRecorder()
	s.Router().ServeHTTP(recorder, signedC2ACallbackRequest(t, testC2ACallbackSecret, fmt.Sprint(now), body))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestC2AImageTaskEventIgnoresUnknownOrTerminalTask(t *testing.T) {
	now := time.Now().Unix()
	body := fmt.Sprintf(`{"id":%q,"status":"success"}`, uuid.New())
	s := callbackTestServer(testC2ACallbackSecret)
	called := false
	s.enqueueImagePoll = func(context.Context, string, string, string, int, time.Duration) error {
		called = true
		return nil
	}
	recorder := httptest.NewRecorder()
	s.Router().ServeHTTP(recorder, signedC2ACallbackRequest(t, testC2ACallbackSecret, fmt.Sprint(now), body))
	if recorder.Code != http.StatusAccepted || called {
		t.Fatalf("status=%d enqueue_called=%v body=%s", recorder.Code, called, recorder.Body.String())
	}
}

func TestC2AImageTaskEventDisabledWithoutSecret(t *testing.T) {
	now := time.Now().Unix()
	body := fmt.Sprintf(`{"id":%q,"status":"success"}`, uuid.New())
	s := callbackTestServer("")
	recorder := httptest.NewRecorder()
	s.Router().ServeHTTP(recorder, signedC2ACallbackRequest(t, testC2ACallbackSecret, fmt.Sprint(now), body))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}
