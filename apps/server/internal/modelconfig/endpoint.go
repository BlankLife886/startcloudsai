package modelconfig

import (
	"net/url"
	"strings"
)

// ProviderEndpoint returns the selected route's address without credentials.
// Invalid addresses are omitted rather than persisting potentially secret input.
func ProviderEndpoint(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" {
		return ""
	}
	parsed.User = nil
	parsed.RawQuery = ""
	parsed.ForceQuery = false
	parsed.Fragment = ""
	parsed.RawFragment = ""
	return strings.TrimRight(parsed.String(), "/")
}
