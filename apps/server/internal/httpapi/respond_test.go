package httpapi

import (
	"context"
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestFailIgnoresCanceledRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)

	requestContext, cancel := context.WithCancel(context.Background())
	cancel()
	c.Request = httptest.NewRequest("GET", "/api/v1/runtime-config", nil).WithContext(requestContext)

	fail(c, fmt.Errorf("query runtime config: %w", context.Canceled))

	if !c.IsAborted() {
		t.Fatal("expected canceled request to abort the handler chain")
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("expected no response body for a disconnected client, got %q", recorder.Body.String())
	}
}
