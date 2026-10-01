package httpapi

import "testing"

func TestSafeCSVCell(t *testing.T) {
	tests := map[string]string{
		"=HYPERLINK(\"https://example.test\")": "'=HYPERLINK(\"https://example.test\")",
		" +SUM(1,2)":                           "' +SUM(1,2)",
		"\t@cmd":                               "'\t@cmd",
		"-1+2":                                 "'-1+2",
		"plain text":                           "plain text",
		"":                                     "",
	}
	for input, want := range tests {
		if got := safeCSVCell(input); got != want {
			t.Fatalf("safeCSVCell(%q) = %q, want %q", input, got, want)
		}
	}
}
