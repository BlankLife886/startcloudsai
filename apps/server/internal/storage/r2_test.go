package storage

import (
	"errors"
	"fmt"
	"testing"

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
