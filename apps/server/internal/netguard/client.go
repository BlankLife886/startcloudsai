package netguard

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

func blockedAddress(ip netip.Addr) bool {
	ip = ip.Unmap()
	return ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsMulticast()
}

func ValidateURL(raw string, allowPrivate, httpsOnly bool) error {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || u.User != nil {
		return fmt.Errorf("invalid outbound URL")
	}
	if httpsOnly && u.Scheme != "https" {
		return fmt.Errorf("outbound URL must use https")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("unsupported outbound URL scheme")
	}
	if ip, err := netip.ParseAddr(u.Hostname()); err == nil && !allowPrivate && blockedAddress(ip) {
		return fmt.Errorf("private network address is not allowed")
	}
	return nil
}

func NewHTTPClient(timeout time.Duration, allowPrivate, httpsOnly bool) *http.Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		if allowPrivate {
			return dialer.DialContext(ctx, network, address)
		}
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, err
		}
		if len(ips) == 0 {
			return nil, fmt.Errorf("host resolved to no addresses")
		}
		for _, ip := range ips {
			if blockedAddress(ip) {
				return nil, fmt.Errorf("private network address is not allowed")
			}
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			if err := ValidateURL(req.URL.String(), allowPrivate, httpsOnly); err != nil {
				return err
			}
			if len(via) > 0 && strings.EqualFold(via[0].URL.Scheme, "https") && req.URL.Scheme != "https" {
				return fmt.Errorf("https redirect downgrade is not allowed")
			}
			return nil
		},
	}
}
