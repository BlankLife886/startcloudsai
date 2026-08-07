package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"

	appconfig "github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/aws/smithy-go"
)

type statusError int

func (e statusError) Error() string       { return "response error" }
func (e statusError) HTTPStatusCode() int { return int(e) }

func TestIsNotFound(t *testing.T) {
	missing := &smithy.GenericAPIError{Code: "NoSuchKey", Message: "missing"}
	if !IsNotFound(missing) {
		t.Fatal("NoSuchKey must map to not found")
	}
	if !IsNotFound(fmt.Errorf("wrapped: %w", missing)) {
		t.Fatal("wrapped NoSuchKey must map to not found")
	}
	if !IsNotFound(fmt.Errorf("wrapped: %w", statusError(404))) {
		t.Fatal("wrapped HTTP 404 must map to not found")
	}
	if IsNotFound(statusError(500)) {
		t.Fatal("HTTP 500 must not map to not found")
	}
	if IsNotFound(&smithy.GenericAPIError{Code: "AccessDenied"}) {
		t.Fatal("AccessDenied must not map to not found")
	}
	if IsNotFound(errors.New("plain error")) {
		t.Fatal("plain errors must not map to not found")
	}
}

func TestTransientObjectReadError(t *testing.T) {
	for _, err := range []error{
		context.DeadlineExceeded,
		io.EOF,
		io.ErrUnexpectedEOF,
		statusError(503),
		errors.New("remote error: tls handshake timeout"),
	} {
		if !transientObjectReadError(err) {
			t.Fatalf("expected transient error: %v", err)
		}
	}
	for _, err := range []error{
		context.Canceled,
		statusError(404),
		errors.New("access denied"),
	} {
		if transientObjectReadError(err) {
			t.Fatalf("expected permanent error: %v", err)
		}
	}
}

func TestValidateConfigRejectsIncompleteConfig(t *testing.T) {
	err := ValidateConfig(&appconfig.Config{R2Bucket: "starcloudsai"})
	if err == nil {
		t.Fatal("incomplete object storage configuration must be rejected")
	}
	for _, key := range []string{"R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"} {
		if !strings.Contains(err.Error(), key) {
			t.Fatalf("error %q does not mention %s", err, key)
		}
	}
}
