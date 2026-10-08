package httpapi

import (
	"context"
	"math"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// The public status page reports every public model's stability, latency and
// speed from real traffic only. It never exposes call volumes, providers or
// routes: rates, percentiles and speeds are all it returns.
const (
	modelStatusCacheTTL      = time.Hour
	modelStatusRecentWindow  = 30 * time.Minute
	modelStatusWideWindow    = 2 * time.Hour
	modelStatusMinSamples    = 3
	modelStatusSlowSamples   = 5
	modelStatusOutageRate    = 0.5
	modelStatusDegradedRate  = 0.15
	modelStatusSlowFactor    = 2.0
	modelStatusHourlyPoints  = 24
	modelStatusDailyPoints   = 7
	modelStatusPriceDays     = 30
	modelStatusOperational   = "operational"
	modelStatusDegraded      = "degraded"
	modelStatusOutage        = "outage"
	modelStatusMaintenance   = "maintenance"
	modelStatusNoData        = "no_data"
	modelStatusReasonErrors  = "errors"
	modelStatusReasonSlow    = "slow"
	modelStatusSpeedImages   = "images_per_minute"
	modelStatusSpeedTokens   = "tokens_per_second"
	modelStatusPricePerImage = "per_image"
	modelStatusPricePerTurn  = "per_turn"
	modelStatusDayDateLayout = "2006-01-02"
)

// Days on the status page are China calendar days, like the rest of the product.
var modelStatusZone = time.FixedZone("Asia/Shanghai", 8*3600)

type modelStatusCache struct {
	mu        sync.Mutex
	body      *modelStatusResponse
	expiresAt time.Time
}

type modelStatusResponse struct {
	GeneratedAt time.Time         `json:"generatedAt"`
	Overall     string            `json:"overall"`
	Models      []modelStatusItem `json:"models"`
}

type modelStatusItem struct {
	ID        string             `json:"id"`
	Name      string             `json:"name"`
	Kind      string             `json:"kind"`
	IconURL   string             `json:"iconUrl,omitempty"`
	Status    string             `json:"status"`
	Reason    string             `json:"reason,omitempty"`
	SpeedUnit string             `json:"speedUnit"`
	Recent    modelStatusMetrics `json:"recent"`
	Day       modelStatusMetrics `json:"day"`
	Uptime7d  *float64           `json:"uptime7d"`
	Hourly    []modelStatusPoint `json:"hourly"`
	Daily     []modelStatusDay   `json:"daily"`
	Price     modelStatusPrice   `json:"price"`
}

// modelStatusPrice is the unit price history in credits: the median price
// recorded on each hour's calls, ending with the price configured right now.
// Hours without calls are omitted; the client carries the last price forward.
type modelStatusPrice struct {
	CurrentCents int64                   `json:"currentCents"`
	Unit         string                  `json:"unit"`
	Points       []modelStatusPricePoint `json:"points"`
	Days         []modelStatusPriceDay   `json:"days"`
}

// modelStatusPriceDay is the price in effect at the end of a China calendar
// day; null before the first recorded call in the window.
type modelStatusPriceDay struct {
	Date  string `json:"date"`
	Cents *int64 `json:"cents"`
}

type modelStatusPricePoint struct {
	Time  time.Time `json:"time"`
	Cents int64     `json:"cents"`
}

type modelStatusMetrics struct {
	SuccessRate  *float64 `json:"successRate"`
	LatencyP50Ms *int     `json:"latencyP50Ms"`
	LatencyP95Ms *int     `json:"latencyP95Ms"`
	LatencyAvgMs *int     `json:"latencyAvgMs"`
	// PerImageAvgMs is generation time divided by the images returned; image models only.
	PerImageAvgMs *int     `json:"perImageAvgMs"`
	TTFTP50Ms     *int     `json:"ttftP50Ms"`
	TTFTP95Ms     *int     `json:"ttftP95Ms"`
	Speed         *float64 `json:"speed"`
}

type modelStatusPoint struct {
	Time         time.Time `json:"time"`
	SuccessRate  *float64  `json:"successRate"`
	LatencyP50Ms *int      `json:"latencyP50Ms"`
	TTFTP50Ms    *int      `json:"ttftP50Ms"`
	Speed        *float64  `json:"speed"`
}

type modelStatusDay struct {
	Date        string   `json:"date"`
	SuccessRate *float64 `json:"successRate"`
}

func (s *Server) publicModelStatus(c *gin.Context) {
	body, err := s.resolveModelStatus(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	c.Header("Cache-Control", "public, max-age=60")
	ok(c, body)
}

func (s *Server) resolveModelStatus(ctx context.Context) (*modelStatusResponse, error) {
	now := time.Now()
	s.modelStatus.mu.Lock()
	defer s.modelStatus.mu.Unlock()
	if s.modelStatus.body != nil && now.Before(s.modelStatus.expiresAt) {
		return s.modelStatus.body, nil
	}
	body, err := s.buildModelStatus(ctx, now.UTC())
	if err != nil {
		return nil, err
	}
	s.modelStatus.body = body
	s.modelStatus.expiresAt = now.Add(modelStatusCacheTTL)
	return body, nil
}

func (s *Server) buildModelStatus(ctx context.Context, now time.Time) (*modelStatusResponse, error) {
	cfg, err := modelconfig.Load(ctx, s.St.Pool)
	if err != nil {
		return nil, err
	}
	recent, err := store.ModelHealthWindow(ctx, s.St.Pool, now.Add(-modelStatusRecentWindow), now)
	if err != nil {
		return nil, err
	}
	wide, err := store.ModelHealthWindow(ctx, s.St.Pool, now.Add(-modelStatusWideWindow), now)
	if err != nil {
		return nil, err
	}
	day, err := store.ModelHealthWindow(ctx, s.St.Pool, now.Add(-24*time.Hour), now)
	if err != nil {
		return nil, err
	}
	today := modelStatusDayStart(now)
	firstDay := today.AddDate(0, 0, -(modelStatusDailyPoints - 1))
	priceFirstDay := today.AddDate(0, 0, -(modelStatusPriceDays - 1))
	buckets, err := store.ListModelHealthHourly(ctx, s.St.Pool, priceFirstDay)
	if err != nil {
		return nil, err
	}
	byModel := map[string][]store.ModelHealthAgg{}
	for _, bucket := range buckets {
		byModel[bucket.ModelID] = append(byModel[bucket.ModelID], bucket)
	}

	body := &modelStatusResponse{GeneratedAt: now, Models: []modelStatusItem{}}
	for _, selection := range modelconfig.PublicModels(cfg, "") {
		model := selection.Model
		window := recent[model.ID]
		if modelStatusCounted(window) < modelStatusMinSamples {
			window = wide[model.ID]
		}
		status, reason := modelHealthStatus(!model.Available(), window, day[model.ID])
		item := modelStatusItem{
			ID: model.ID, Name: model.Name, Kind: model.Kind, IconURL: model.IconURL,
			Status: status, Reason: reason, SpeedUnit: modelStatusSpeedUnit(model.Kind),
			Recent: modelStatusMetricsOf(window),
			Day:    modelStatusMetricsOf(day[model.ID]),
		}
		item.Hourly = modelStatusHourly(byModel[model.ID], now)
		item.Daily, item.Uptime7d = modelStatusDaily(byModel[model.ID], firstDay)
		item.Price = modelStatusPriceHistory(byModel[model.ID], model, now)
		item.Price.Days = modelStatusPriceDaily(byModel[model.ID], item.Price.CurrentCents, priceFirstDay)
		body.Models = append(body.Models, item)
	}
	body.Overall = modelStatusOverall(body.Models)
	return body, nil
}

// modelHealthStatus decides a model's badge. With enough recent traffic the
// failure rate (and a sharp slowdown against the 24-hour median) decides it;
// with only a handful of recent calls a single failure is not an outage, so
// it falls back to the 24-hour picture.
func modelHealthStatus(maintenance bool, recent, day store.ModelHealthAgg) (string, string) {
	if maintenance {
		return modelStatusMaintenance, ""
	}
	if counted := modelStatusCounted(recent); counted >= modelStatusMinSamples {
		rate := float64(recent.Failed) / float64(counted)
		switch {
		case rate >= modelStatusOutageRate:
			return modelStatusOutage, modelStatusReasonErrors
		case rate >= modelStatusDegradedRate:
			return modelStatusDegraded, modelStatusReasonErrors
		}
		if recent.Succeeded >= modelStatusSlowSamples && recent.LatencyP50Ms != nil && day.LatencyP50Ms != nil &&
			*day.LatencyP50Ms > 0 && float64(*recent.LatencyP50Ms) > modelStatusSlowFactor*float64(*day.LatencyP50Ms) {
			return modelStatusDegraded, modelStatusReasonSlow
		}
		return modelStatusOperational, ""
	}
	dayCounted := modelStatusCounted(day)
	if dayCounted == 0 {
		return modelStatusNoData, ""
	}
	if modelStatusCounted(recent) > 0 && recent.Succeeded == 0 {
		return modelStatusDegraded, modelStatusReasonErrors
	}
	// Nothing succeeded all day: however few the calls, that is not "operational".
	if day.Succeeded == 0 {
		return modelStatusDegraded, modelStatusReasonErrors
	}
	if dayCounted >= modelStatusMinSamples && float64(day.Failed)/float64(dayCounted) >= modelStatusOutageRate {
		return modelStatusDegraded, modelStatusReasonErrors
	}
	return modelStatusOperational, ""
}

func modelStatusOverall(models []modelStatusItem) string {
	withData, down, troubled := 0, 0, 0
	for _, model := range models {
		switch model.Status {
		case modelStatusNoData, modelStatusMaintenance:
			continue
		case modelStatusOutage:
			down++
			troubled++
		case modelStatusDegraded:
			troubled++
		}
		withData++
	}
	switch {
	case withData > 0 && down == withData:
		return modelStatusOutage
	case troubled > 0:
		return modelStatusDegraded
	default:
		return modelStatusOperational
	}
}

func modelStatusCounted(agg store.ModelHealthAgg) int {
	return agg.Succeeded + agg.Failed
}

func modelStatusSuccessRate(agg store.ModelHealthAgg) *float64 {
	counted := modelStatusCounted(agg)
	if counted == 0 {
		return nil
	}
	rate := math.Round(float64(agg.Succeeded)/float64(counted)*10000) / 10000
	return &rate
}

func modelStatusMetricsOf(agg store.ModelHealthAgg) modelStatusMetrics {
	return modelStatusMetrics{
		SuccessRate:  modelStatusSuccessRate(agg),
		LatencyP50Ms: agg.LatencyP50Ms, LatencyP95Ms: agg.LatencyP95Ms,
		LatencyAvgMs: agg.LatencyAvgMs, PerImageAvgMs: agg.PerImageAvgMs,
		TTFTP50Ms: agg.TTFTP50Ms, TTFTP95Ms: agg.TTFTP95Ms,
		Speed: modelStatusRoundSpeed(agg.SpeedP50),
	}
}

func modelStatusRoundSpeed(speed *float64) *float64 {
	if speed == nil {
		return nil
	}
	rounded := math.Round(*speed*100) / 100
	return &rounded
}

func modelStatusSpeedUnit(kind string) string {
	if kind == modelconfig.ModelKindChat {
		return modelStatusSpeedTokens
	}
	return modelStatusSpeedImages
}

// modelStatusHourly returns the last 24 whole hours plus the current one,
// with empty hours kept so the chart has a continuous time axis.
func modelStatusHourly(buckets []store.ModelHealthAgg, now time.Time) []modelStatusPoint {
	start := now.Truncate(time.Hour).Add(-modelStatusHourlyPoints * time.Hour)
	byHour := map[int64]store.ModelHealthAgg{}
	for _, bucket := range buckets {
		if !bucket.Bucket.Before(start) {
			byHour[bucket.Bucket.Unix()] = bucket
		}
	}
	points := make([]modelStatusPoint, 0, modelStatusHourlyPoints+1)
	for hour := start; !hour.After(now); hour = hour.Add(time.Hour) {
		bucket := byHour[hour.Unix()]
		points = append(points, modelStatusPoint{
			Time: hour, SuccessRate: modelStatusSuccessRate(bucket),
			LatencyP50Ms: bucket.LatencyP50Ms, TTFTP50Ms: bucket.TTFTP50Ms,
			Speed: modelStatusRoundSpeed(bucket.SpeedP50),
		})
	}
	return points
}

// modelStatusDaily folds hourly buckets into 7 China calendar days and the
// overall success rate across them. Days without traffic stay null rather
// than counting as 100%.
func modelStatusDaily(buckets []store.ModelHealthAgg, firstDay time.Time) ([]modelStatusDay, *float64) {
	type tally struct{ succeeded, failed int }
	byDay := map[string]tally{}
	var total store.ModelHealthAgg
	for _, bucket := range buckets {
		if bucket.Bucket.Before(firstDay) {
			continue
		}
		key := bucket.Bucket.In(modelStatusZone).Format(modelStatusDayDateLayout)
		day := byDay[key]
		day.succeeded += bucket.Succeeded
		day.failed += bucket.Failed
		byDay[key] = day
		total.Succeeded += bucket.Succeeded
		total.Failed += bucket.Failed
	}
	days := make([]modelStatusDay, 0, modelStatusDailyPoints)
	for index := 0; index < modelStatusDailyPoints; index++ {
		key := firstDay.AddDate(0, 0, index).Format(modelStatusDayDateLayout)
		day := byDay[key]
		days = append(days, modelStatusDay{
			Date:        key,
			SuccessRate: modelStatusSuccessRate(store.ModelHealthAgg{Succeeded: day.succeeded, Failed: day.failed}),
		})
	}
	return days, modelStatusSuccessRate(total)
}

func modelStatusDayStart(now time.Time) time.Time {
	local := now.In(modelStatusZone)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, modelStatusZone)
}

// modelStatusPriceHistory keeps only the hours where the price changed, so
// the response stays small, and appends the configured price as of now.
func modelStatusPriceHistory(buckets []store.ModelHealthAgg, model modelconfig.Model, now time.Time) modelStatusPrice {
	price := modelStatusPrice{CurrentCents: modelconfig.EffectivePrice(model), Unit: modelStatusPricePerImage, Points: []modelStatusPricePoint{}}
	if model.Kind == modelconfig.ModelKindChat {
		price.Unit = modelStatusPricePerTurn
	}
	for _, bucket := range buckets {
		if bucket.PriceCents == nil {
			continue
		}
		if count := len(price.Points); count > 0 && price.Points[count-1].Cents == *bucket.PriceCents {
			continue
		}
		price.Points = append(price.Points, modelStatusPricePoint{Time: bucket.Bucket, Cents: *bucket.PriceCents})
	}
	price.Points = append(price.Points, modelStatusPricePoint{Time: now, Cents: price.CurrentCents})
	return price
}

// modelStatusPriceDaily turns the hourly price record into one price per China
// day for the last 30 days: the last price charged that day, carried forward
// over days without calls, and today's configured price on the last day.
func modelStatusPriceDaily(buckets []store.ModelHealthAgg, current int64, firstDay time.Time) []modelStatusPriceDay {
	lastOfDay := map[string]int64{}
	for _, bucket := range buckets {
		if bucket.PriceCents == nil || bucket.Bucket.Before(firstDay) {
			continue
		}
		// Buckets arrive oldest first, so the last write per day wins.
		lastOfDay[bucket.Bucket.In(modelStatusZone).Format(modelStatusDayDateLayout)] = *bucket.PriceCents
	}
	days := make([]modelStatusPriceDay, 0, modelStatusPriceDays)
	var carried *int64
	for index := 0; index < modelStatusPriceDays; index++ {
		key := firstDay.AddDate(0, 0, index).Format(modelStatusDayDateLayout)
		if cents, ok := lastOfDay[key]; ok {
			carried = &cents
		}
		if index == modelStatusPriceDays-1 {
			carried = &current
		}
		days = append(days, modelStatusPriceDay{Date: key, Cents: carried})
	}
	return days
}
