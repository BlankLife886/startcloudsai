package usermetrics

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	maxMetrics       = 6
	maxDimensions    = 2
	maxRows          = 500
	maxFilledBuckets = 400
	statementTimeout = "5s"
)

// ErrInvalid marks a request the caller should fix (bad metric, range, …).
var ErrInvalid = errors.New("invalid metrics request")

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

// Filters narrow the facts before grouping. Empty fields are ignored.
type Filters struct {
	Workspace string `json:"workspace,omitempty"`
	Model     string `json:"model,omitempty"`
	Status    string `json:"status,omitempty"`
	Source    string `json:"source,omitempty"`
}

// Request is one statistical question.
type Request struct {
	Metrics    []Metric    `json:"metrics"`
	Dimensions []Dimension `json:"dimensions,omitempty"`
	Filters    Filters     `json:"filters,omitempty"`
	TimeRange  TimeRange   `json:"timeRange,omitempty"`
	// Timezone is an IANA name; invalid or empty falls back to Asia/Shanghai,
	// matching the profile page.
	Timezone string `json:"timezone,omitempty"`
	// CompareToPrevious adds the same query over the preceding period.
	CompareToPrevious bool `json:"compareToPrevious,omitempty"`
}

// Row is one group of the result.
type Row struct {
	Keys     map[Dimension]string `json:"keys"`
	Labels   map[Dimension]string `json:"labels"`
	Values   map[Metric]float64   `json:"values"`
	Previous map[Metric]float64   `json:"previous,omitempty"`
}

// Result is the answer to a Request.
type Result struct {
	Timezone       string             `json:"timezone"`
	Range          ResolvedRange      `json:"range"`
	PreviousRange  *ResolvedRange     `json:"previousRange,omitempty"`
	Metrics        []MetricInfo       `json:"metrics"`
	Dimensions     []DimensionInfo    `json:"dimensions"`
	Rows           []Row              `json:"rows"`
	Totals         map[Metric]float64 `json:"totals"`
	PreviousTotals map[Metric]float64 `json:"previousTotals,omitempty"`
	Truncated      bool               `json:"truncated,omitempty"`
}

// TxRunner is the subset of *store.Store needed to run a query.
type TxRunner interface {
	Tx(ctx context.Context, fn func(tx pgx.Tx) error) error
}

// sums holds the base aggregates every metric is derived from.
type sums struct {
	creations, images, succeeded, failed, timed, seconds int64
	spend, deduct, refund, income                        int64
}

func (s *sums) add(other sums) {
	s.creations += other.creations
	s.images += other.images
	s.succeeded += other.succeeded
	s.failed += other.failed
	s.timed += other.timed
	s.seconds += other.seconds
	s.spend += other.spend
	s.deduct += other.deduct
	s.refund += other.refund
	s.income += other.income
}

func round(value float64, places int) float64 {
	scale := math.Pow(10, float64(places))
	return math.Round(value*scale) / scale
}

func (s sums) value(metric Metric) float64 {
	switch metric {
	case MetricCreations:
		return float64(s.creations)
	case MetricImages:
		return float64(s.images)
	case MetricSucceeded:
		return float64(s.succeeded)
	case MetricFailed:
		return float64(s.failed)
	case MetricSuccessRate:
		if s.succeeded+s.failed == 0 {
			return 0
		}
		return round(float64(s.succeeded)*100/float64(s.succeeded+s.failed), 1)
	case MetricAvgSeconds:
		if s.timed == 0 {
			return 0
		}
		return round(float64(s.seconds)/float64(s.timed), 1)
	case MetricSpendPoints:
		return float64(s.spend)
	case MetricDeductPoints:
		return float64(s.deduct)
	case MetricRefundPoints:
		return float64(s.refund)
	case MetricIncomePoints:
		return float64(s.income)
	case MetricCostPerImage:
		if s.images == 0 {
			return 0
		}
		return round(float64(s.spend)/float64(s.images), 2)
	}
	return 0
}

type plan struct {
	metrics    []Metric
	dimensions []Dimension
	family     factFamily
	location   *time.Location
	timezone   string
}

func resolveLocation(name string) (*time.Location, string) {
	name = strings.TrimSpace(name)
	if name != "" && name != "Local" && len(name) <= 64 {
		if loc, err := time.LoadLocation(name); err == nil {
			return loc, name
		}
	}
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.FixedZone("Asia/Shanghai", 8*3600), "Asia/Shanghai"
	}
	return loc, "Asia/Shanghai"
}

func validate(req Request) (plan, error) {
	p := plan{}
	if len(req.Metrics) == 0 {
		return p, invalid("至少选择一个指标")
	}
	if len(req.Metrics) > maxMetrics {
		return p, invalid("一次最多查询 %d 个指标", maxMetrics)
	}
	if len(req.Dimensions) > maxDimensions {
		return p, invalid("一次最多按 %d 个维度分组", maxDimensions)
	}
	seenMetric := map[Metric]bool{}
	for _, metric := range req.Metrics {
		spec, ok := metricCatalog[metric]
		if !ok {
			return p, invalid("不支持的指标：%s", metric)
		}
		if seenMetric[metric] {
			continue
		}
		seenMetric[metric] = true
		p.metrics = append(p.metrics, metric)
		p.family |= spec.family
	}
	seenDim := map[Dimension]bool{}
	timeDims := 0
	for _, dimension := range req.Dimensions {
		spec, ok := dimensionCatalog[dimension]
		if !ok {
			return p, invalid("不支持的维度：%s", dimension)
		}
		if seenDim[dimension] {
			continue
		}
		seenDim[dimension] = true
		if spec.time {
			timeDims++
		}
		if p.family&^spec.family != 0 {
			return p, invalid("维度“%s”不适用于所选指标", spec.Label)
		}
		p.dimensions = append(p.dimensions, dimension)
	}
	if timeDims > 1 {
		return p, invalid("日期、周、月只能选一个")
	}
	if req.Filters.Status != "" && p.family&familyLedger != 0 {
		return p, invalid("状态筛选只适用于创作类指标")
	}
	if req.Filters.Source != "" && p.family&familyActivity != 0 {
		return p, invalid("积分来源筛选只适用于积分类指标")
	}
	p.location, p.timezone = resolveLocation(req.Timezone)
	return p, nil
}

func dimensionSQL(dimension Dimension) string {
	local := "(created_at AT TIME ZONE $4)"
	switch dimension {
	case DimDay:
		return "to_char(" + local + ", 'YYYY-MM-DD')"
	case DimWeek:
		return "to_char(date_trunc('week', " + local + "), 'YYYY-MM-DD')"
	case DimMonth:
		return "to_char(" + local + ", 'YYYY-MM')"
	case DimWeekday:
		return "EXTRACT(ISODOW FROM " + local + ")::int::text"
	case DimHour:
		return "lpad(EXTRACT(HOUR FROM " + local + ")::int::text, 2, '0')"
	case DimWorkspace:
		return "workspace"
	case DimModel:
		return "model"
	case DimStatus:
		return "status"
	case DimSource:
		return "source"
	}
	return "''"
}

// buildSQL compiles the plan into SQL. Every fragment comes from this package
// or store/metric_facts.go; request values only ever travel as parameters.
// Parameters: $1 user, $2 start, $3 end, $4 timezone, $5.. filters.
func buildSQL(p plan, filters Filters) (string, []any) {
	var facts []string
	if p.family&familyActivity != 0 {
		facts = append(facts, `SELECT created_at, workspace, model, status, ''::text AS source,
			1::bigint AS creations, images,
			(status = 'succeeded')::int::bigint AS succeeded,
			(status = 'failed')::int::bigint AS failed,
			(seconds > 0)::int::bigint AS timed, seconds,
			0::bigint AS spend, 0::bigint AS deduct, 0::bigint AS refund, 0::bigint AS income
		FROM activity`)
	}
	if p.family&familyLedger != 0 {
		// Aliases matter when this is the only branch: UNION takes column
		// names from the first SELECT.
		facts = append(facts, `SELECT created_at, workspace, model, ''::text AS status, source_type AS source,
			0::bigint AS creations, 0::bigint AS images, 0::bigint AS succeeded, 0::bigint AS failed,
			0::bigint AS timed, 0::bigint AS seconds,
			spend_points AS spend, deduct_points AS deduct, refund_points AS refund, income_points AS income
		FROM ledger
		WHERE spend_points <> 0 OR deduct_points <> 0 OR refund_points <> 0 OR income_points <> 0`)
	}
	ctes := []string{}
	if p.family&familyActivity != 0 {
		ctes = append(ctes, "activity AS ("+store.UserActivityFactsSQL+")")
	}
	if p.family&familyLedger != 0 {
		ctes = append(ctes, "ledger AS ("+store.UserLedgerFactsSQL+")")
	}
	ctes = append(ctes, "facts AS ("+strings.Join(facts, "\nUNION ALL\n")+")")

	selects := make([]string, 0, len(p.dimensions)+10)
	groups := make([]string, 0, len(p.dimensions))
	for index, dimension := range p.dimensions {
		selects = append(selects, dimensionSQL(dimension)+" AS d"+strconv.Itoa(index))
		groups = append(groups, "d"+strconv.Itoa(index))
	}
	selects = append(selects,
		"SUM(creations)::bigint", "SUM(images)::bigint", "SUM(succeeded)::bigint", "SUM(failed)::bigint",
		"SUM(timed)::bigint", "SUM(seconds)::bigint",
		"SUM(spend)::bigint", "SUM(deduct)::bigint", "SUM(refund)::bigint", "SUM(income)::bigint")

	where := []string{"created_at >= $2", "created_at < $3"}
	args := []any{nil, nil, nil, nil}
	addFilter := func(column, value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		args = append(args, value)
		where = append(where, column+" = $"+strconv.Itoa(len(args)))
	}
	addFilter("workspace", filters.Workspace)
	addFilter("model", filters.Model)
	addFilter("status", filters.Status)
	addFilter("source", filters.Source)

	sql := "WITH " + strings.Join(ctes, ",\n") +
		"\nSELECT " + strings.Join(selects, ", ") +
		"\nFROM facts WHERE " + strings.Join(where, " AND ")
	if len(groups) > 0 {
		sql += "\nGROUP BY " + strings.Join(groups, ", ")
	}
	// $4 must be referenced even without time dimensions so PostgreSQL can
	// infer its type; a no-op predicate keeps the parameter list fixed.
	sql = strings.Replace(sql, "WHERE created_at >= $2", "WHERE $4::text IS NOT NULL AND created_at >= $2", 1)
	return sql, args
}

type groupedRow struct {
	keys []string
	sums sums
}

func runQuery(ctx context.Context, tx pgx.Tx, p plan, filters Filters, userID uuid.UUID, window ResolvedRange) ([]groupedRow, error) {
	sql, args := buildSQL(p, filters)
	args[0], args[1], args[2], args[3] = userID, window.Start, window.End, p.timezone
	rows, err := tx.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []groupedRow{}
	for rows.Next() {
		keys := make([]string, len(p.dimensions))
		var s sums
		targets := make([]any, 0, len(keys)+10)
		for index := range keys {
			targets = append(targets, &keys[index])
		}
		targets = append(targets, &s.creations, &s.images, &s.succeeded, &s.failed, &s.timed, &s.seconds,
			&s.spend, &s.deduct, &s.refund, &s.income)
		if err := rows.Scan(targets...); err != nil {
			return nil, err
		}
		out = append(out, groupedRow{keys: keys, sums: s})
	}
	return out, rows.Err()
}

func groupKey(keys []string) string { return strings.Join(keys, "\x00") }

// Query answers req for userID. userID must come from the authenticated
// session; nothing in req can change whose data is read.
func Query(ctx context.Context, db TxRunner, userID uuid.UUID, req Request, now time.Time) (*Result, error) {
	if userID == uuid.Nil {
		return nil, invalid("缺少用户")
	}
	p, err := validate(req)
	if err != nil {
		return nil, err
	}
	window, err := req.TimeRange.Resolve(now, p.location)
	if err != nil {
		return nil, invalid("%s", err.Error())
	}
	var previous ResolvedRange
	comparing := false
	if req.CompareToPrevious {
		previous, comparing = window.Previous()
	}

	var current, before []groupedRow
	err = db.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SET TRANSACTION READ ONLY"); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "SET LOCAL statement_timeout = '"+statementTimeout+"'"); err != nil {
			return err
		}
		var err error
		if current, err = runQuery(ctx, tx, p, req.Filters, userID, window); err != nil {
			return err
		}
		if comparing {
			before, err = runQuery(ctx, tx, p, req.Filters, userID, previous)
		}
		return err
	})
	if err != nil {
		return nil, err
	}

	result := &Result{
		Timezone: p.timezone,
		Range:    window,
		Totals:   map[Metric]float64{},
		Rows:     []Row{},
	}
	for _, metric := range p.metrics {
		spec := metricCatalog[metric]
		result.Metrics = append(result.Metrics, MetricInfo{ID: metric, Label: spec.Label, Unit: spec.Unit, Description: spec.Description})
	}
	for _, dimension := range p.dimensions {
		spec := dimensionCatalog[dimension]
		result.Dimensions = append(result.Dimensions, DimensionInfo{ID: dimension, Label: spec.Label, Description: spec.Description})
	}

	var total sums
	for _, row := range current {
		total.add(row.sums)
	}
	for _, metric := range p.metrics {
		result.Totals[metric] = total.value(metric)
	}
	previousByKey := map[string]sums{}
	if comparing {
		var previousTotal sums
		for _, row := range before {
			previousTotal.add(row.sums)
			previousByKey[groupKey(row.keys)] = row.sums
		}
		result.PreviousRange = &previous
		result.PreviousTotals = map[Metric]float64{}
		for _, metric := range p.metrics {
			result.PreviousTotals[metric] = previousTotal.value(metric)
		}
	}

	if len(p.dimensions) == 0 {
		return result, nil
	}
	current = fillTimeBuckets(p, window, current)
	timeIndex := -1
	for index, dimension := range p.dimensions {
		if dimensionCatalog[dimension].time || dimension == DimHour || dimension == DimWeekday {
			timeIndex = index
			break
		}
	}
	for _, row := range current {
		item := Row{
			Keys:   map[Dimension]string{},
			Labels: map[Dimension]string{},
			Values: map[Metric]float64{},
		}
		nonZero := false
		for index, dimension := range p.dimensions {
			item.Keys[dimension] = row.keys[index]
			item.Labels[dimension] = displayLabel(dimension, row.keys[index])
		}
		for _, metric := range p.metrics {
			value := row.sums.value(metric)
			item.Values[metric] = value
			if value != 0 {
				nonZero = true
			}
		}
		// Grouping by a non-time dimension over both fact tables yields rows
		// that only carry the other table's amounts; they are noise here.
		if !nonZero && timeIndex < 0 {
			continue
		}
		if comparing {
			if prior, ok := previousByKey[groupKey(row.keys)]; ok {
				item.Previous = map[Metric]float64{}
				for _, metric := range p.metrics {
					item.Previous[metric] = prior.value(metric)
				}
			}
		}
		result.Rows = append(result.Rows, item)
	}
	sortRows(result.Rows, p, timeIndex)
	if len(result.Rows) > maxRows {
		result.Rows = result.Rows[:maxRows]
		result.Truncated = true
	}
	return result, nil
}

func displayLabel(dimension Dimension, key string) string {
	switch dimension {
	case DimWeekday:
		if day, err := strconv.Atoi(key); err == nil && day >= 1 && day <= 7 {
			return weekdayLabels[day%7]
		}
	case DimHour:
		return key + ":00"
	case DimDay, DimMonth:
		return key
	case DimWeek:
		return key + " 当周"
	}
	return labelFor(dimension, key)
}

func sortRows(rows []Row, p plan, timeIndex int) {
	if timeIndex >= 0 {
		dimension := p.dimensions[timeIndex]
		sort.SliceStable(rows, func(i, j int) bool {
			if rows[i].Keys[dimension] != rows[j].Keys[dimension] {
				return rows[i].Keys[dimension] < rows[j].Keys[dimension]
			}
			return rows[i].Values[p.metrics[0]] > rows[j].Values[p.metrics[0]]
		})
		return
	}
	first := p.metrics[0]
	sort.SliceStable(rows, func(i, j int) bool {
		return rows[i].Values[first] > rows[j].Values[first]
	})
}

// fillTimeBuckets adds zero rows for empty days, weeks or months so a trend
// chart shows gaps instead of silently joining distant points. It only
// applies when the single dimension is a calendar unit.
func fillTimeBuckets(p plan, window ResolvedRange, rows []groupedRow) []groupedRow {
	if len(p.dimensions) != 1 || !dimensionCatalog[p.dimensions[0]].time {
		return rows
	}
	if window.kind == "all" {
		return rows
	}
	present := map[string]bool{}
	for _, row := range rows {
		present[row.keys[0]] = true
	}
	start := window.Start
	var step func(time.Time) time.Time
	var format func(time.Time) string
	switch p.dimensions[0] {
	case DimDay:
		step = func(t time.Time) time.Time { return t.AddDate(0, 0, 1) }
		format = func(t time.Time) string { return t.Format("2006-01-02") }
	case DimWeek:
		start = startOfWeek(start)
		step = func(t time.Time) time.Time { return t.AddDate(0, 0, 7) }
		format = func(t time.Time) string { return t.Format("2006-01-02") }
	case DimMonth:
		start = time.Date(start.Year(), start.Month(), 1, 0, 0, 0, 0, start.Location())
		step = func(t time.Time) time.Time { return t.AddDate(0, 1, 0) }
		format = func(t time.Time) string { return t.Format("2006-01") }
	default:
		return rows
	}
	count := 0
	for cursor := start; cursor.Before(window.End); cursor = step(cursor) {
		count++
		if count > maxFilledBuckets {
			return rows
		}
		key := format(cursor)
		if !present[key] {
			rows = append(rows, groupedRow{keys: []string{key}})
		}
	}
	return rows
}
