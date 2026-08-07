package httpapi

import (
	"context"
	"math"
	"runtime"
	"runtime/debug"
	runtimemetrics "runtime/metrics"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const requestMetricsWindow = 60

var requestLatencyBounds = [...]time.Duration{
	10 * time.Millisecond,
	25 * time.Millisecond,
	50 * time.Millisecond,
	100 * time.Millisecond,
	250 * time.Millisecond,
	500 * time.Millisecond,
	time.Second,
	2 * time.Second,
	5 * time.Second,
}

type requestMetricSlot struct {
	mu          sync.Mutex
	second      int64
	requests    uint64
	status2xx   uint64
	status4xx   uint64
	status5xx   uint64
	durationNs  int64
	maxLatency  int64
	latencyBins [len(requestLatencyBounds) + 1]uint64
}

type requestMetrics struct {
	startedAt time.Time
	inFlight  atomic.Int64
	total     atomic.Uint64
	slots     [requestMetricsWindow]requestMetricSlot
}

type requestMetricsSnapshot struct {
	InFlight      int64   `json:"inFlight"`
	Total         uint64  `json:"total"`
	WindowSeconds int     `json:"windowSeconds"`
	Requests      uint64  `json:"requests"`
	RequestsPerS  float64 `json:"requestsPerSecond"`
	Status2xx     uint64  `json:"status2xx"`
	Status4xx     uint64  `json:"status4xx"`
	Status5xx     uint64  `json:"status5xx"`
	AverageMs     float64 `json:"averageLatencyMs"`
	P95Ms         float64 `json:"p95LatencyMs"`
	MaximumMs     float64 `json:"maximumLatencyMs"`
}

func newRequestMetrics(now time.Time) *requestMetrics {
	return &requestMetrics{startedAt: now}
}

func (m *requestMetrics) begin() {
	m.inFlight.Add(1)
	m.total.Add(1)
}

func (m *requestMetrics) finish(status int, elapsed time.Duration, now time.Time) {
	m.inFlight.Add(-1)

	second := now.Unix()
	slot := &m.slots[second%requestMetricsWindow]
	slot.mu.Lock()
	defer slot.mu.Unlock()
	if slot.second != second {
		slot.second = second
		slot.requests = 0
		slot.status2xx = 0
		slot.status4xx = 0
		slot.status5xx = 0
		slot.durationNs = 0
		slot.maxLatency = 0
		slot.latencyBins = [len(requestLatencyBounds) + 1]uint64{}
	}
	slot.requests++
	switch {
	case status >= 500:
		slot.status5xx++
	case status >= 400:
		slot.status4xx++
	case status >= 200 && status < 300:
		slot.status2xx++
	}
	duration := max(elapsed.Nanoseconds(), 0)
	slot.durationNs += duration
	if duration > slot.maxLatency {
		slot.maxLatency = duration
	}
	bin := len(requestLatencyBounds)
	for index, upper := range requestLatencyBounds {
		if elapsed <= upper {
			bin = index
			break
		}
	}
	slot.latencyBins[bin]++
}

func (m *requestMetrics) snapshot(now time.Time) requestMetricsSnapshot {
	windowSeconds := requestMetricsWindow
	if uptime := int(now.Sub(m.startedAt).Seconds()) + 1; uptime > 0 && uptime < windowSeconds {
		windowSeconds = uptime
	}
	out := requestMetricsSnapshot{
		InFlight:      m.inFlight.Load(),
		Total:         m.total.Load(),
		WindowSeconds: windowSeconds,
	}

	var durationNs int64
	var bins [len(requestLatencyBounds) + 1]uint64
	for index := range m.slots {
		slot := &m.slots[index]
		slot.mu.Lock()
		if age := now.Unix() - slot.second; slot.second > 0 && age >= 0 && age < requestMetricsWindow {
			out.Requests += slot.requests
			out.Status2xx += slot.status2xx
			out.Status4xx += slot.status4xx
			out.Status5xx += slot.status5xx
			durationNs += slot.durationNs
			out.MaximumMs = max(out.MaximumMs, float64(slot.maxLatency)/float64(time.Millisecond))
			for bin, count := range slot.latencyBins {
				bins[bin] += count
			}
		}
		slot.mu.Unlock()
	}
	if out.Requests > 0 {
		out.RequestsPerS = roundMetric(float64(out.Requests)/float64(windowSeconds), 3)
		out.AverageMs = roundMetric(float64(durationNs)/float64(out.Requests)/float64(time.Millisecond), 2)
		out.P95Ms = histogramPercentile(bins, 0.95)
		out.MaximumMs = roundMetric(out.MaximumMs, 2)
	}
	return out
}

func histogramPercentile(bins [len(requestLatencyBounds) + 1]uint64, percentile float64) float64 {
	var total uint64
	for _, count := range bins {
		total += count
	}
	if total == 0 {
		return 0
	}
	target := uint64(math.Ceil(float64(total) * percentile))
	var seen uint64
	for index, count := range bins {
		seen += count
		if seen < target {
			continue
		}
		if index < len(requestLatencyBounds) {
			return float64(requestLatencyBounds[index]) / float64(time.Millisecond)
		}
		return float64(requestLatencyBounds[len(requestLatencyBounds)-1]) / float64(time.Millisecond)
	}
	return 0
}

type systemMetrics struct {
	startedAt time.Time
	requests  *requestMetrics
	cpuMu     sync.Mutex
	lastCPUAt time.Time
	lastTotal float64
	lastIdle  float64
	cpuPct    float64
}

func newSystemMetrics(now time.Time) *systemMetrics {
	return &systemMetrics{startedAt: now, requests: newRequestMetrics(now)}
}

func (s *Server) requestMetricsMiddleware(c *gin.Context) {
	path := c.Request.URL.Path
	if path == "/api/v1/health" || path == "/api/v1/admin/system/metrics" || strings.HasSuffix(path, "/events") {
		c.Next()
		return
	}
	start := time.Now()
	s.Metrics.requests.begin()
	defer func() {
		s.Metrics.requests.finish(c.Writer.Status(), time.Since(start), time.Now())
	}()
	c.Next()
}

func (s *Server) adminSystemMetrics(c *gin.Context, _ *store.User) {
	now := time.Now()
	mem, cpu := s.Metrics.runtimeSnapshot(now)
	pool := s.St.Pool.Stat()
	queue := s.Queue.Metrics()
	pressure, pressureErr := store.GetTaskPressure(c.Request.Context(), s.St.Pool)
	globalLimit, globalLimitErr := settings.GetInt(c.Request.Context(), s.St.Pool, "global_max_active_tasks")
	globalImageLimit, globalImageLimitErr := settings.GetInt(c.Request.Context(), s.St.Pool, "global_max_active_images")
	globalConcurrency, globalConcurrencyErr := settings.GetInt(c.Request.Context(), s.St.Pool, "global_max_concurrent_tasks")
	userConcurrency, userConcurrencyErr := settings.GetInt(c.Request.Context(), s.St.Pool, "user_max_concurrent_tasks")
	workerCeiling := int64(s.workerConcurrencyCeiling())
	profilingEnabled := s.Cfg.APIPprofAddr != "" || s.Cfg.WorkerPprofAddr != ""
	providerCapacity := s.providerCapacityMetrics(c.Request.Context())

	ok(c, gin.H{
		"sampledAt": now.UTC().Format(time.RFC3339Nano),
		"process": gin.H{
			"goVersion":       runtime.Version(),
			"uptimeSeconds":   int64(now.Sub(s.Metrics.startedAt).Seconds()),
			"cpuUsagePercent": cpu,
			"logicalCPUs":     runtime.NumCPU(),
			"goMaxProcs":      runtime.GOMAXPROCS(0),
			"goroutines":      runtime.NumGoroutine(),
			"memory":          mem,
		},
		"http": s.Metrics.requests.snapshot(now),
		"database": gin.H{
			"maxConnections":          pool.MaxConns(),
			"totalConnections":        pool.TotalConns(),
			"acquiredConnections":     pool.AcquiredConns(),
			"idleConnections":         pool.IdleConns(),
			"constructingConnections": pool.ConstructingConns(),
			"utilizationPercent":      roundMetric(percentOf(pool.AcquiredConns(), pool.MaxConns()), 2),
			"acquireCount":            pool.AcquireCount(),
			"emptyAcquireCount":       pool.EmptyAcquireCount(),
			"canceledAcquireCount":    pool.CanceledAcquireCount(),
			"acquireDurationMs":       roundMetric(float64(pool.AcquireDuration())/float64(time.Millisecond), 2),
		},
		"queue":        queue,
		"taskPressure": taskPressureSnapshot(now, pressure, pressureErr, globalLimit, globalLimitErr, globalImageLimit, globalImageLimitErr, globalConcurrency, globalConcurrencyErr, userConcurrency, userConcurrencyErr, workerCeiling),
		"providers":    providerCapacity,
		"profiling":    gin.H{"enabled": profilingEnabled},
	})
}

func (s *Server) providerCapacityMetrics(ctx context.Context) []gin.H {
	cfg, err := modelconfig.Runtime(ctx, s.St.Pool, s.Cfg.AppSecret)
	if err != nil {
		return []gin.H{}
	}
	providerIDs := make([]string, 0, len(cfg.Providers))
	for _, provider := range cfg.Providers {
		for _, route := range modelconfig.ExecutionRoutes(provider) {
			providerIDs = append(providerIDs, modelconfig.ExecutionRouteKey(route))
		}
	}
	running, err := store.RunningTasksByProvider(ctx, s.St.Pool, providerIDs)
	if err != nil {
		return []gin.H{}
	}
	out := make([]gin.H, 0, len(providerIDs))
	for _, provider := range cfg.Providers {
		for _, route := range modelconfig.ExecutionRoutes(provider) {
			key := modelconfig.ExecutionRouteKey(route)
			current := running[key]
			out = append(out, gin.H{
				"id": key, "name": provider.Name + " / " + route.RouteName, "adapter": provider.Adapter,
				"running": current, "limit": route.MaxConcurrency,
				"utilizationPercent": roundMetric(percentOf64(current, int64(route.MaxConcurrency)), 2),
			})
		}
	}
	return out
}

func taskPressureSnapshot(now time.Time, pressure store.TaskPressure, pressureErr error,
	globalLimit int64, globalLimitErr error, globalImageLimit int64, globalImageLimitErr error,
	globalConcurrency int64, globalConcurrencyErr error, userConcurrency int64, userConcurrencyErr error,
	workerCeiling int64) gin.H {
	out := gin.H{
		"queued":                     pressure.Queued,
		"running":                    pressure.Running,
		"active":                     pressure.Queued + pressure.Running,
		"activeImageUnits":           pressure.ActiveUnits,
		"globalLimit":                globalLimit,
		"globalImageLimit":           globalImageLimit,
		"imageUtilizationPercent":    roundMetric(percentOf64(pressure.ActiveUnits, globalImageLimit), 2),
		"userConcurrencyLimit":       userConcurrency,
		"globalConcurrencyLimit":     globalConcurrency,
		"workerConcurrencyCeiling":   workerCeiling,
		"effectiveGlobalConcurrency": max(globalConcurrency, 1),
		"utilizationPercent":         roundMetric(percentOf64(pressure.Queued+pressure.Running, globalLimit), 2),
	}
	if pressure.OldestQueuedAt != nil {
		out["oldestQueuedSeconds"] = max(int64(now.Sub(*pressure.OldestQueuedAt).Seconds()), 0)
	} else {
		out["oldestQueuedSeconds"] = int64(0)
	}
	if pressureErr != nil || globalLimitErr != nil || globalImageLimitErr != nil || globalConcurrencyErr != nil || userConcurrencyErr != nil {
		out["error"] = "task_pressure_unavailable"
	}
	return out
}

func (m *systemMetrics) runtimeSnapshot(now time.Time) (gin.H, float64) {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	limit := debug.SetMemoryLimit(-1)
	memory := gin.H{
		"usedBytes":       mem.Sys - mem.HeapReleased,
		"limitBytes":      limit,
		"heapAllocBytes":  mem.HeapAlloc,
		"heapInUseBytes":  mem.HeapInuse,
		"heapObjects":     mem.HeapObjects,
		"stackInUseBytes": mem.StackInuse,
		"nextGCBytes":     mem.NextGC,
		"gcCycles":        mem.NumGC,
		"gcPauseTotalMs":  roundMetric(float64(mem.PauseTotalNs)/float64(time.Millisecond), 2),
		"gcCPUFraction":   roundMetric(mem.GCCPUFraction*100, 3),
	}

	samples := []runtimemetrics.Sample{
		{Name: "/cpu/classes/total:cpu-seconds"},
		{Name: "/cpu/classes/idle:cpu-seconds"},
	}
	runtimemetrics.Read(samples)
	total := samples[0].Value.Float64()
	idle := samples[1].Value.Float64()
	m.cpuMu.Lock()
	defer m.cpuMu.Unlock()
	if !m.lastCPUAt.IsZero() && total > m.lastTotal {
		m.cpuPct = clamp((1-(idle-m.lastIdle)/(total-m.lastTotal))*100, 0, 100)
	}
	m.lastCPUAt, m.lastTotal, m.lastIdle = now, total, idle
	return memory, roundMetric(m.cpuPct, 2)
}

func percentOf(value, total int32) float64 {
	if total <= 0 {
		return 0
	}
	return float64(value) / float64(total) * 100
}

func percentOf64(value, total int64) float64 {
	if total <= 0 {
		return 0
	}
	return float64(value) / float64(total) * 100
}

func roundMetric(value float64, places int) float64 {
	factor := math.Pow10(places)
	return math.Round(value*factor) / factor
}

func clamp(value, low, high float64) float64 {
	return math.Min(max(value, low), high)
}
