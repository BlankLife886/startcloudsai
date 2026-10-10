package modelconfig

import (
	"net/url"
	"strings"
)

// CRUNOpenAICompatibleBaseURL returns the OpenAI-compatible endpoint of a
// CRUN provider base URL (".../api/v1"), whatever form it was entered in.
func CRUNOpenAICompatibleBaseURL(raw string) string {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return strings.TrimSuffix(raw, "/api/v1") + "/api/v1"
	}
	path := strings.TrimRight(parsed.Path, "/")
	path = strings.TrimSuffix(path, "/api/v1")
	parsed.Path = strings.TrimRight(path, "/") + "/api/v1"
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return strings.TrimRight(parsed.String(), "/")
}
