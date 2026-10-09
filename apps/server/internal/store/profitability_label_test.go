package store

import "testing"

func TestProfitModelFallbackLabel(t *testing.T) {
	cases := map[string]string{
		"model-c026d33c-54ce-42c1-a074-abfda9d94183": "已删除的模型 · c026d33c",
		"gpt-image-2": "gpt-image-2",
		"model-a":     "model-a",
		"":            "",
	}
	for input, want := range cases {
		if got := ProfitModelFallbackLabel(input); got != want {
			t.Errorf("ProfitModelFallbackLabel(%q) = %q, want %q", input, got, want)
		}
	}
}
