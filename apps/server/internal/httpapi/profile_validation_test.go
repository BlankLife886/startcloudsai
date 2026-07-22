package httpapi

import "testing"

func TestNormalizeProfileWebsite(t *testing.T) {
	cases := []struct {
		input string
		want  string
		ok    bool
	}{
		{"", "", true},
		{"  https://example.com/works  ", "https://example.com/works", true},
		{"http://localhost:3000/profile", "http://localhost:3000/profile", true},
		{"javascript:alert(1)", "", false},
		{"example.com", "", false},
		{"ftp://example.com/file", "", false},
	}
	for _, tc := range cases {
		got, ok := normalizeProfileWebsite(tc.input)
		if got != tc.want || ok != tc.ok {
			t.Errorf("normalizeProfileWebsite(%q) = (%q, %v), want (%q, %v)", tc.input, got, ok, tc.want, tc.ok)
		}
	}
}
