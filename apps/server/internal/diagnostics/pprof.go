package diagnostics

import (
	"context"
	"log"
	"net"
	"net/http"
	"net/http/pprof"
	"strings"
	"time"
)

// StartPprof starts an explicitly routed profiler on a loopback-only address.
// It is intentionally separate from the public Gin router.
func StartPprof(addr, process string) func() {
	if strings.TrimSpace(addr) == "" {
		return func() {}
	}
	if !loopbackAddress(addr) {
		log.Printf("%s pprof disabled: API_PPROF_ADDR/WORKER_PPROF_ADDR must use a loopback address", process)
		return func() {}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
	for _, profile := range []string{"allocs", "block", "goroutine", "heap", "mutex", "threadcreate"} {
		mux.Handle("/debug/pprof/"+profile, pprof.Handler(profile))
	}
	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       30 * time.Second,
		MaxHeaderBytes:    64 << 10,
	}
	go func() {
		log.Printf("%s private pprof listening on %s", process, addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("%s pprof stopped: %v", process, err)
		}
	}()
	return func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}
}

func loopbackAddress(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	host = strings.Trim(host, "[]")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
