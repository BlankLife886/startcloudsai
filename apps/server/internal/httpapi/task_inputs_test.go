package httpapi

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/google/uuid"
)

func TestValidateTaskInputKeys(t *testing.T) {
	userID := uuid.New()
	key := func(n int) string { return fmt.Sprintf("uploads/%s/%d.png", userID, n) }
	sizes := map[string]int64{}
	objectSize := func(_ context.Context, value string) (int64, error) {
		size, ok := sizes[value]
		if !ok {
			return 0, errors.New("not found")
		}
		return size, nil
	}

	for i := 0; i < 5; i++ {
		sizes[key(i)] = 1
	}
	if err := validateTaskInputKeys(context.Background(), userID, []string{key(0), key(1), key(2), key(3), key(4)}, 16<<20, objectSize); err == nil {
		t.Fatal("five input images unexpectedly accepted")
	}
	if err := validateTaskInputKeys(context.Background(), userID, []string{key(0), key(0)}, 16<<20, objectSize); err == nil {
		t.Fatal("duplicate input image unexpectedly accepted")
	}
	if err := validateTaskInputKeys(context.Background(), userID, []string{"uploads/" + uuid.NewString() + "/x.png"}, 16<<20, objectSize); err == nil {
		t.Fatal("another user's input image unexpectedly accepted")
	}

	sizes[key(0)] = 16 << 20
	sizes[key(1)] = (16 << 20) + 1
	if err := validateTaskInputKeys(context.Background(), userID, []string{key(0), key(1)}, 17<<20, objectSize); err == nil {
		t.Fatal("input images over the cumulative limit unexpectedly accepted")
	}
	sizes[key(1)] = 16 << 20
	if err := validateTaskInputKeys(context.Background(), userID, []string{key(0), key(1)}, 16<<20, objectSize); err != nil {
		t.Fatalf("valid input images rejected: %v", err)
	}
}
