package httpapi

import "testing"

func TestNormalizedExternalCoverCacheLimit(t *testing.T) {
	tests := []struct {
		input int
		want  int
	}{
		{input: 0, want: externalCoverCacheDefaultLimit},
		{input: -1, want: externalCoverCacheDefaultLimit},
		{input: 7, want: 7},
		{input: 100, want: externalCoverCacheMaxLimit},
	}
	for _, test := range tests {
		if got := normalizedExternalCoverCacheLimit(test.input); got != test.want {
			t.Fatalf("normalizedExternalCoverCacheLimit(%d) = %d, want %d", test.input, got, test.want)
		}
	}
}
