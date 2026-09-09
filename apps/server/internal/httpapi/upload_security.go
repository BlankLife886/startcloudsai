package httpapi

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/netguard"
)

const uploadReviewResponseMaxBytes = 64 << 10

func scanWithClamAV(ctx context.Context, address string, data []byte, timeout time.Duration) error {
	dialer := net.Dialer{Timeout: timeout}
	conn, err := dialer.DialContext(ctx, "tcp", strings.TrimSpace(address))
	if err != nil {
		return fmt.Errorf("connect malware scanner: %w", err)
	}
	defer conn.Close()
	deadline := time.Now().Add(timeout)
	_ = conn.SetDeadline(deadline)
	if _, err := conn.Write([]byte("zINSTREAM\x00")); err != nil {
		return fmt.Errorf("start malware scan: %w", err)
	}
	for offset := 0; offset < len(data); {
		end := min(offset+(64<<10), len(data))
		var size [4]byte
		// #nosec G115 -- every chunk is capped at 64 KiB above.
		binary.BigEndian.PutUint32(size[:], uint32(end-offset))
		if _, err := conn.Write(size[:]); err != nil {
			return fmt.Errorf("stream malware scan: %w", err)
		}
		if _, err := conn.Write(data[offset:end]); err != nil {
			return fmt.Errorf("stream malware scan: %w", err)
		}
		offset = end
	}
	if _, err := conn.Write([]byte{0, 0, 0, 0}); err != nil {
		return fmt.Errorf("finish malware scan: %w", err)
	}
	response, err := io.ReadAll(io.LimitReader(conn, 4096))
	if err != nil {
		return fmt.Errorf("read malware scan: %w", err)
	}
	result := strings.TrimSpace(strings.TrimRight(string(response), "\x00"))
	switch {
	case strings.HasSuffix(result, "OK"):
		return nil
	case strings.Contains(result, "FOUND"):
		return fmt.Errorf("malware detected")
	default:
		return fmt.Errorf("malware scanner returned an invalid result")
	}
}

type uploadReviewResponse struct {
	Allowed *bool  `json:"allowed"`
	Reason  string `json:"reason"`
}

func reviewUploadContent(ctx context.Context, endpoint, apiKey, contentType, hash string, data []byte, timeout time.Duration, allowPrivate bool) error {
	if err := netguard.ValidateURL(endpoint, allowPrivate, !allowPrivate); err != nil {
		return fmt.Errorf("upload review URL: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("X-Content-SHA256", hash)
	request.Header.Set("X-Content-Length", fmt.Sprintf("%d", len(data)))
	if strings.TrimSpace(apiKey) != "" {
		request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}
	client := netguard.NewHTTPClient(timeout, allowPrivate, !allowPrivate)
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("upload content review: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, uploadReviewResponseMaxBytes))
		return fmt.Errorf("upload content review: HTTP %d", response.StatusCode)
	}
	var result uploadReviewResponse
	if err := json.NewDecoder(io.LimitReader(response.Body, uploadReviewResponseMaxBytes)).Decode(&result); err != nil || result.Allowed == nil {
		return fmt.Errorf("upload content review returned an invalid response")
	}
	if !*result.Allowed {
		if strings.TrimSpace(result.Reason) == "" {
			return fmt.Errorf("content rejected by safety review")
		}
		return fmt.Errorf("content rejected by safety review: %s", strings.TrimSpace(result.Reason))
	}
	return nil
}
