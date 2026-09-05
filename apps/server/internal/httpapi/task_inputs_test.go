package httpapi

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/png"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/media"
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

	for i := 0; i < 7; i++ {
		sizes[key(i)] = 1
	}
	if err := validateTaskInputKeys(context.Background(), userID, []string{key(0), key(1), key(2), key(3), key(4), key(5), key(6)}, 16<<20, objectSize); err == nil {
		t.Fatal("seven input images unexpectedly accepted")
	}
	if err := validateTaskInputKeys(context.Background(), userID, []string{key(0), key(1), key(2), key(3), key(4), key(5)}, 16<<20, objectSize); err != nil {
		t.Fatalf("six input images rejected: %v", err)
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

func TestValidateTaskInputImagesChecksStoredContent(t *testing.T) {
	userID := uuid.New()
	validKey := fmt.Sprintf("uploads/%s/original/valid.png", userID)
	outputKey := fmt.Sprintf("tasks/%s/%s/original/0.png", userID, uuid.New())
	invalidKey := fmt.Sprintf("uploads/%s/original/not-image.png", userID)
	shortKey := fmt.Sprintf("uploads/%s/original/short.png", userID)
	legacyShapeKey := fmt.Sprintf("uploads/%s/legacy.png", userID)

	var valid bytes.Buffer
	if err := png.Encode(&valid, image.NewRGBA(image.Rect(0, 0, 8, 6))); err != nil {
		t.Fatal(err)
	}
	objects := map[string][]byte{
		validKey:   valid.Bytes(),
		outputKey:  valid.Bytes(),
		invalidKey: []byte("not an image"),
		shortKey:   []byte("\x89PNG\r\n\x1a\n"),
	}
	inspect := func(_ context.Context, key string, maxBytes int64) (int64, error) {
		data, ok := objects[key]
		if !ok || int64(len(data)) > maxBytes {
			return 0, errors.New("missing or too large")
		}
		if _, _, err := media.Dimensions(data); err != nil {
			return 0, err
		}
		return int64(len(data)), nil
	}

	if err := validateTaskInputImages(context.Background(), userID, []string{validKey, outputKey}, 16<<20, inspect); err != nil {
		t.Fatalf("valid stored images rejected: %v", err)
	}
	catalogKey := "ecommerce-catalog/" + uuid.NewString() + ".png"
	objects[catalogKey] = valid.Bytes()
	if err := validateTaskInputImages(context.Background(), userID, []string{catalogKey}, 16<<20, inspect); err != nil {
		t.Fatalf("catalog image rejected: %v", err)
	}
	if err := validateTaskInputImages(context.Background(), userID, []string{"prompt-covers/cover.png"}, 16<<20, inspect); err == nil {
		t.Fatal("unrelated public object unexpectedly accepted as task input")
	}
	for _, key := range []string{invalidKey, shortKey, legacyShapeKey} {
		if err := validateTaskInputImages(context.Background(), userID, []string{key}, 16<<20, inspect); err == nil {
			t.Fatalf("invalid task input %q unexpectedly accepted", key)
		}
	}
}

func TestValidateTaskInputImagesInspectErrorMessage(t *testing.T) {
	userID := uuid.New()
	key := fmt.Sprintf("uploads/%s/original/missing.png", userID)
	tests := []struct {
		name string
		err  error
		want string
	}{
		{name: "missing", err: fmt.Errorf("%w: NoSuchKey", errTaskImageMissing), want: "图片不存在或尚未写入完成"},
		{name: "timeout", err: fmt.Errorf("%w: context deadline exceeded", errTaskImageTimeout), want: "参考图读取超时"},
		{name: "format", err: fmt.Errorf("%w: gif", errTaskImageFormat), want: "图片格式不支持"},
		{name: "content", err: fmt.Errorf("%w: decode", errTaskImageContent), want: "图片内容无法读取"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			inspect := func(context.Context, string, int64) (int64, error) {
				return 0, test.err
			}
			err := validateTaskInputImages(context.Background(), userID, []string{key}, 16<<20, inspect)
			if err == nil {
				t.Fatal("invalid image unexpectedly accepted")
			}
			if !strings.Contains(err.Error(), test.want) {
				t.Fatalf("got %q, want substring %q", err.Error(), test.want)
			}
		})
	}
}

func TestTaskMaskImageKeys(t *testing.T) {
	keys, err := taskMaskImageKeys(map[string]any{
		"maskKey":     "uploads/user/original/mask.png",
		"maskBaseKey": "uploads/user/original/base.png",
		"maskRect":    "1,2,30,40",
	})
	if err != nil || len(keys) != 2 {
		t.Fatalf("valid mask params rejected: keys=%v err=%v", keys, err)
	}
	for _, params := range []map[string]any{
		{"maskKey": "uploads/user/original/mask.png"},
		{"maskRect": "1,2,0,40"},
		{"maskKey": "uploads/user/original/mask.png", "maskBaseKey": "uploads/user/original/base.png", "maskRect": 42},
	} {
		if _, err := taskMaskImageKeys(params); err == nil {
			t.Fatalf("invalid mask params unexpectedly accepted: %#v", params)
		}
	}
}
