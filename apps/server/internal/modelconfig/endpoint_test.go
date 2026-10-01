package modelconfig

import "testing"

func TestProviderEndpoint(t *testing.T) {
	for _, tc := range []struct{ input, want string }{
		{" https://images.example.com/v1/ ", "https://images.example.com/v1"},
		{"https://user:secret@images.example.com:8443/v1/?api_key=secret#token", "https://images.example.com:8443/v1"},
		{"http://localhost:8080/?", "http://localhost:8080"},
		{"", ""},
		{"invalid?api_key=secret", ""},
		{"https://user:%zz@example.com", ""},
		{"file:///secret", ""},
	} {
		if got := ProviderEndpoint(tc.input); got != tc.want {
			t.Errorf("ProviderEndpoint(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}
