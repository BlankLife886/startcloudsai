package decision

import (
	"testing"
	"time"
)

func TestThresholdTimeoutDefaultsAndBounds(t *testing.T) {
	if (Thresholds{}).Timeout() != DefaultTimeout || (Thresholds{TimeoutMs: 6000}).Timeout() != 6*time.Second {
		t.Fatal("timeout not applied")
	}
	for _, ms := range []int{500, 20000} {
		if err := (Override{Thresholds: map[string]Thresholds{"m": {Intent: 0.6, Clarify: 0.7, TimeoutMs: ms}}}).Validate(); err == nil {
			t.Fatalf("timeout %d accepted", ms)
		}
	}
	if err := (Override{Thresholds: map[string]Thresholds{"m": {Intent: 0.6, Clarify: 0.7, TimeoutMs: 6000}}}).Validate(); err != nil {
		t.Fatal(err)
	}
}
