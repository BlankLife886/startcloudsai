package c2a

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptrace"
	"strings"
	"sync"
	"time"
)

// submitTrace 记录图片任务提交请求在连接层的关键时间点。提交超时时仅凭
// "context deadline exceeded" 无法区分是请求体没发完、还是上游收完请求后不响应；
// 每次提交输出一行耗时日志，出问题时可直接对照（本地端口可与代理/网关日志关联）。
type submitTrace struct {
	mu            sync.Mutex
	start         time.Time
	gotConn       time.Duration
	wroteRequest  time.Duration
	firstByte     time.Duration
	reused        bool
	wasIdle       bool
	idleTime      time.Duration
	localAddr     string
	remoteAddr    string
	tlsDone       time.Duration
	wroteErr      error
	connAttempted bool
	observe       func(SubmitTrace)
}

func submitObserver(ctx context.Context) func(SubmitTrace) {
	observe, _ := ctx.Value(submitObserverKey{}).(func(SubmitTrace))
	return observe
}

// SubmitTrace 是一次图片任务提交在连接层的耗时摘要；毫秒字段为 -1 表示该事件未发生。
type SubmitTrace struct {
	Path           string `json:"path"`
	ClientTaskID   string `json:"clientTaskId"`
	BodyBytes      int    `json:"bodyBytes"`
	ConnReused     bool   `json:"connReused"`
	ConnWasIdle    bool   `json:"connWasIdle"`
	ConnIdleMs     int64  `json:"connIdleMs"`
	LocalAddr      string `json:"localAddr,omitempty"`
	RemoteAddr     string `json:"remoteAddr,omitempty"`
	GotConnMs      int64  `json:"gotConnMs"`
	WroteRequestMs int64  `json:"wroteRequestMs"`
	FirstByteMs    int64  `json:"firstByteMs"`
	TotalMs        int64  `json:"totalMs"`
	StatusCode     int    `json:"statusCode,omitempty"`
	Error          string `json:"error,omitempty"`
}

// Map 供任务时间线 meta 使用。
func (t SubmitTrace) Map() map[string]any {
	return map[string]any{
		"path": t.Path, "clientTaskId": t.ClientTaskID, "bodyBytes": t.BodyBytes,
		"connReused": t.ConnReused, "connWasIdle": t.ConnWasIdle, "connIdleMs": t.ConnIdleMs,
		"localAddr": t.LocalAddr, "remoteAddr": t.RemoteAddr,
		"gotConnMs": t.GotConnMs, "wroteRequestMs": t.WroteRequestMs, "firstByteMs": t.FirstByteMs,
		"totalMs": t.TotalMs, "statusCode": t.StatusCode, "error": t.Error,
	}
}

type submitObserverKey struct{}

// WithSubmitObserver 让调用方拿到本 context 下每次图片提交的耗时摘要（如写入任务时间线）。
func WithSubmitObserver(ctx context.Context, observe func(SubmitTrace)) context.Context {
	return context.WithValue(ctx, submitObserverKey{}, observe)
}

func withSubmitTrace(ctx context.Context) (context.Context, *submitTrace) {
	trace := &submitTrace{start: time.Now(), observe: submitObserver(ctx)}
	since := func() time.Duration { return time.Since(trace.start) }
	return httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{
		GotConn: func(info httptrace.GotConnInfo) {
			trace.mu.Lock()
			defer trace.mu.Unlock()
			trace.connAttempted = true
			trace.gotConn = since()
			trace.reused = info.Reused
			trace.wasIdle = info.WasIdle
			trace.idleTime = info.IdleTime
			if info.Conn != nil {
				trace.localAddr = info.Conn.LocalAddr().String()
				trace.remoteAddr = info.Conn.RemoteAddr().String()
			}
		},
		TLSHandshakeDone: func(_ tls.ConnectionState, _ error) {
			trace.mu.Lock()
			defer trace.mu.Unlock()
			trace.tlsDone = since()
		},
		WroteRequest: func(info httptrace.WroteRequestInfo) {
			trace.mu.Lock()
			defer trace.mu.Unlock()
			trace.wroteRequest = since()
			trace.wroteErr = info.Err
		},
		GotFirstResponseByte: func() {
			trace.mu.Lock()
			defer trace.mu.Unlock()
			trace.firstByte = since()
		},
	}), trace
}

func (t *submitTrace) log(path, clientTaskID string, bodyBytes int, resp *http.Response, err error) {
	t.mu.Lock()
	summary := SubmitTrace{
		Path: path, ClientTaskID: clientTaskID, BodyBytes: bodyBytes,
		ConnReused: t.reused, ConnWasIdle: t.wasIdle, ConnIdleMs: t.idleTime.Milliseconds(),
		LocalAddr: t.localAddr, RemoteAddr: t.remoteAddr,
		GotConnMs: traceMs(t.gotConn), WroteRequestMs: traceMs(t.wroteRequest), FirstByteMs: traceMs(t.firstByte),
		TotalMs: time.Since(t.start).Milliseconds(),
	}
	if !t.connAttempted {
		summary.GotConnMs = -1
	}
	if resp != nil {
		summary.StatusCode = resp.StatusCode
	}
	var errs []string
	if err != nil {
		errs = append(errs, strings.ReplaceAll(err.Error(), "\n", " "))
	}
	if t.wroteErr != nil {
		errs = append(errs, "write: "+t.wroteErr.Error())
	}
	summary.Error = strings.Join(errs, "; ")
	tlsMs := traceMs(t.tlsDone)
	observe := t.observe
	t.mu.Unlock()

	ms := func(v int64) string {
		if v < 0 {
			return "-"
		}
		return fmt.Sprintf("%d", v)
	}
	outcome := "status=-"
	if summary.StatusCode != 0 {
		outcome = fmt.Sprintf("status=%d", summary.StatusCode)
	}
	if summary.Error != "" {
		outcome += " err=" + summary.Error
	}
	conn := "conn=none"
	if summary.GotConnMs >= 0 {
		conn = fmt.Sprintf("conn_reused=%t was_idle=%t idle_ms=%d local=%s remote=%s",
			summary.ConnReused, summary.ConnWasIdle, summary.ConnIdleMs, summary.LocalAddr, summary.RemoteAddr)
	}
	log.Printf("c2a submit trace path=%s client_task_id=%s body_bytes=%d %s got_conn_ms=%s tls_ms=%s wrote_request_ms=%s first_byte_ms=%s total_ms=%d %s",
		path, clientTaskID, bodyBytes, conn, ms(summary.GotConnMs), ms(tlsMs), ms(summary.WroteRequestMs), ms(summary.FirstByteMs),
		summary.TotalMs, outcome)
	if observe != nil {
		observe(summary)
	}
}

// traceMs 把未发生的事件（零值）记为 -1，与"0 毫秒内完成"区分开。
func traceMs(d time.Duration) int64 {
	if d <= 0 {
		return -1
	}
	return d.Milliseconds()
}

// countingReader 统计已读取的响应字节数（轮询诊断用）。
type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	if c.r == nil {
		return 0, io.EOF
	}
	n, err := c.r.Read(p)
	c.n += int64(n)
	return n, err
}
