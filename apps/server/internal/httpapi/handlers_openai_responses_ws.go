package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var openAIResponsesWebSocketUpgrader = websocket.Upgrader{
	ReadBufferSize:  64 << 10,
	WriteBufferSize: 64 << 10,
	// The connection is authenticated with the API Bearer token. Cockpit may
	// send an app Origin that is not in the browser Origin allowlist, so the
	// bearer check remains the CSRF boundary for this non-browser API client.
	CheckOrigin: func(*http.Request) bool { return true },
}

// openAIResponsesWebSocket accepts the Cockpit Responses-WebSocket transport
// and delegates every request to the canonical HTTP Responses implementation.
// This keeps model routing, task creation, billing, idempotency, and limits in
// one code path. The wire payload is JSON text in both directions.
func (s *Server) openAIResponsesWebSocket(c *gin.Context) {
	authorization := strings.TrimSpace(c.GetHeader("Authorization"))
	if len(authorization) < 8 || !strings.EqualFold(authorization[:7], "Bearer ") || !strings.HasPrefix(strings.TrimSpace(authorization[7:]), "sk-sc-") {
		c.Header("WWW-Authenticate", "Bearer")
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": gin.H{"message": "请使用 Authorization: Bearer <API_KEY>", "type": "authentication_error", "param": nil, "code": "invalid_api_key"}})
		return
	}
	connection, err := openAIResponsesWebSocketUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer connection.Close()
	connection.SetReadLimit(2 << 20)
	for {
		messageType, payload, readErr := connection.ReadMessage()
		if readErr != nil {
			return
		}
		if messageType != websocket.TextMessage && messageType != websocket.BinaryMessage {
			_ = connection.WriteJSON(gin.H{"type": "error", "error": gin.H{"code": "invalid_message", "message": "Responses WebSocket accepts JSON messages only."}})
			continue
		}
		if !json.Valid(payload) {
			_ = connection.WriteJSON(gin.H{"type": "error", "error": gin.H{"code": "invalid_request", "message": "Responses WebSocket accepts one JSON request per message."}})
			continue
		}
		requestPayload, streamID, normalizeErr := normalizeOpenAIResponsesWebSocketRequest(payload)
		if normalizeErr != nil {
			_ = connection.WriteJSON(gin.H{"type": "error", "error": gin.H{"code": "invalid_request", "message": normalizeErr.Error()}})
			continue
		}
		responsePayload, status, responseHeaders := s.executeOpenAIResponsesWebSocket(c.Request, requestPayload)
		addOpenAIResponsesWebSocketStreamID := func(value any) any {
			if streamID == "" {
				return value
			}
			if object, ok := value.(map[string]any); ok {
				object["stream_id"] = streamID
			}
			return value
		}
		if taskID := responseHeaders.Get("X-Task-ID"); taskID != "" {
			_ = connection.WriteJSON(addOpenAIResponsesWebSocketStreamID(gin.H{"type": "response.task", "task_id": taskID}))
		}
		if status >= http.StatusBadRequest {
			var value any
			if json.Unmarshal(responsePayload, &value) == nil {
				_ = connection.WriteJSON(addOpenAIResponsesWebSocketStreamID(value))
			} else {
				_ = connection.WriteJSON(gin.H{"type": "error", "error": gin.H{"code": "responses_error", "message": string(responsePayload)}})
			}
			continue
		}
		if strings.Contains(responseHeaders.Get("Content-Type"), "text/event-stream") {
			for _, line := range strings.Split(string(responsePayload), "\n") {
				line = strings.TrimSpace(line)
				if !strings.HasPrefix(line, "data: ") {
					continue
				}
				data := strings.TrimSpace(strings.TrimPrefix(line, "data: "))
				if data == "[DONE]" {
					continue
				}
				var value any
				if json.Unmarshal([]byte(data), &value) == nil {
					_ = connection.WriteJSON(addOpenAIResponsesWebSocketStreamID(value))
				}
			}
			continue
		}
		var value any
		if json.Unmarshal(responsePayload, &value) != nil {
			_ = connection.WriteJSON(gin.H{"type": "error", "error": gin.H{"code": "invalid_response", "message": "The Responses API returned invalid JSON."}})
			continue
		}
		if err := connection.WriteJSON(addOpenAIResponsesWebSocketStreamID(value)); err != nil {
			return
		}
	}
}

func normalizeOpenAIResponsesWebSocketRequest(payload []byte) ([]byte, string, error) {
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return nil, "", err
	}
	streamID := ""
	if raw, ok := envelope["stream_id"]; ok {
		_ = json.Unmarshal(raw, &streamID)
	}
	if rawType, ok := envelope["type"]; ok {
		var eventType string
		if json.Unmarshal(rawType, &eventType) != nil || eventType != "response.create" {
			return nil, streamID, fmt.Errorf("only response.create client events are supported")
		}
		delete(envelope, "type")
		delete(envelope, "event_id")
		delete(envelope, "stream_id")
		// WebSocket responses are event-driven; always request the canonical
		// streaming response from the shared HTTP implementation.
		envelope["stream"] = json.RawMessage("true")
	} else {
		// Accept the earlier raw request shape for simple WebSocket clients.
		envelope["stream"] = json.RawMessage("true")
	}
	encoded, err := json.Marshal(envelope)
	return encoded, streamID, err
}

func (s *Server) executeOpenAIResponsesWebSocket(original *http.Request, payload []byte) ([]byte, int, http.Header) {
	request := original.Clone(original.Context())
	request.Method = http.MethodPost
	request.URL = cloneURL(request.URL)
	request.URL.Path = "/v1/responses"
	request.Body = io.NopCloser(bytes.NewReader(payload))
	request.ContentLength = int64(len(payload))
	request.Header = original.Header.Clone()
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	inner, _ := gin.CreateTestContext(recorder)
	inner.Request = request
	s.openAPIOnly("tasks:write", s.openAIResponses)(inner)
	return recorder.Body.Bytes(), recorder.Code, recorder.Header()
}

func cloneURL(urlValue *url.URL) *url.URL {
	if urlValue == nil {
		return &url.URL{}
	}
	copy := *urlValue
	return &copy
}
