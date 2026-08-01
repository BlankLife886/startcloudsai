package diagnostics

import "testing"

func TestLoopbackAddress(t *testing.T) {
	for _, addr := range []string{"127.0.0.1:6060", "[::1]:6060", "localhost:6060"} {
		if !loopbackAddress(addr) {
			t.Errorf("loopback address rejected: %s", addr)
		}
	}
	for _, addr := range []string{"0.0.0.0:6060", ":6060", "10.0.0.2:6060", "invalid"} {
		if loopbackAddress(addr) {
			t.Errorf("non-loopback address accepted: %s", addr)
		}
	}
}
