package statseval

import (
	"encoding/json"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	um "github.com/BlankLife886/startcloudsai/server/internal/usermetrics"
)

// Call is one tool call the answer made, with what the tool returned.
type Call struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
	Result    string `json:"result,omitempty"`
}

// Transcript is everything an answer did for one question.
type Transcript struct {
	Calls     []Call `json:"calls"`
	Answer    string `json:"answer"`
	LatencyMs int64  `json:"latencyMs"`
}

// Grade is the verdict on one transcript.
type Grade struct {
	ToolOK bool `json:"toolOk"`
	// ArgsOK means some call of the expected tool passed every argument check.
	ArgsOK bool `json:"argsOk"`
	// Problems lists the failed checks of the closest call, in Chinese.
	Problems []string `json:"problems"`
	// Ungrounded are numbers in the answer that no tool result supports.
	Ungrounded []string `json:"ungrounded"`
	ChangeOK   bool     `json:"changeOk"`
	Passed     bool     `json:"passed"`
}

type statsArgs struct {
	Metrics           []um.Metric       `json:"metrics"`
	Dimensions        []um.Dimension    `json:"dimensions"`
	Filters           map[string]string `json:"filters"`
	TimeRange         um.TimeRange      `json:"timeRange"`
	CompareToPrevious bool              `json:"compareToPrevious"`
	Type              string            `json:"type"`
	Sort              string            `json:"sort"`
	Status            string            `json:"status"`
}

func containsAll[T comparable](have, want []T) []T {
	missing := []T{}
	for _, item := range want {
		found := false
		for _, candidate := range have {
			if candidate == item {
				found = true
				break
			}
		}
		if !found {
			missing = append(missing, item)
		}
	}
	return missing
}

func containsAny[T comparable](have, want []T) bool {
	return len(want) == 0 || len(containsAll(have, want)) < len(want)
}

// expectedRange resolves the case's window, or reports none to check.
func expectedRange(expect Expect, now time.Time, loc *time.Location) (um.ResolvedRange, bool) {
	switch {
	case expect.LastDays > 0:
		today := now.In(loc)
		from := today.AddDate(0, 0, -(expect.LastDays - 1))
		resolved, err := um.TimeRange{From: from.Format("2006-01-02"), To: today.Format("2006-01-02")}.Resolve(now, loc)
		return resolved, err == nil
	case expect.Preset != "":
		resolved, err := um.TimeRange{Preset: expect.Preset}.Resolve(now, loc)
		return resolved, err == nil
	}
	return um.ResolvedRange{}, false
}

// sameWindow treats a window that runs to today as equal to one running to
// the end of the current week, month or year: "本月" asked on the 2nd is
// answered correctly by 1st–2nd as well as 1st–31st.
func sameWindow(got, want um.ResolvedRange, today string) bool {
	if got.From != want.From {
		return false
	}
	clip := func(to string) string {
		if to > today {
			return today
		}
		return to
	}
	return clip(got.To) == clip(want.To)
}

// checkCall lists what one call got wrong against the expectation.
func checkCall(expect Expect, call Call, now time.Time, loc *time.Location) []string {
	var args statsArgs
	if err := json.Unmarshal([]byte(call.Arguments), &args); err != nil && strings.TrimSpace(call.Arguments) != "" {
		return []string{"参数不是合法的 JSON"}
	}
	problems := []string{}
	if missing := containsAll(args.Metrics, expect.Metrics); len(missing) > 0 {
		problems = append(problems, "缺少指标 "+joinIDs(missing))
	}
	if !containsAny(args.Metrics, expect.MetricsAny) {
		problems = append(problems, "应选指标之一 "+joinIDs(expect.MetricsAny))
	}
	if missing := containsAll(args.Dimensions, expect.Dimensions); len(missing) > 0 {
		problems = append(problems, "缺少分组 "+joinIDs(missing))
	}
	if !containsAny(args.Dimensions, expect.DimensionsAny) {
		problems = append(problems, "应按其中之一分组 "+joinIDs(expect.DimensionsAny))
	}
	if want, ok := expectedRange(expect, now, loc); ok {
		got, err := args.TimeRange.Resolve(now, loc)
		if err != nil {
			problems = append(problems, "时间范围无效")
		} else if !sameWindow(got, want, now.In(loc).Format("2006-01-02")) {
			problems = append(problems, "时间范围应为 "+want.From+" 至 "+want.To+"，实际 "+got.From+" 至 "+got.To)
		}
	}
	if expect.Compare && !args.CompareToPrevious {
		problems = append(problems, "没有与上一周期对比")
	}
	if expect.RecordType != "" && args.Type != expect.RecordType {
		problems = append(problems, "记录类型应为 "+expect.RecordType)
	}
	if expect.Sort != "" {
		sortOrder := args.Sort
		if sortOrder == "" {
			sortOrder = "recent"
		}
		if sortOrder != expect.Sort {
			problems = append(problems, "排序应为 "+expect.Sort)
		}
	}
	for key, want := range expect.Filters {
		got := args.Filters[key]
		if call.Name == toolOrders && key == "status" {
			got = args.Status
			// Both mean "not finished paying"; the orders page offers both.
			if want == "unsettled" && got == "pending" {
				got = want
			}
		}
		if got != want {
			problems = append(problems, "筛选 "+key+" 应为 "+want)
		}
	}
	return problems
}

func joinIDs[T ~string](values []T) string {
	parts := make([]string, len(values))
	for index, value := range values {
		parts[index] = string(value)
	}
	return strings.Join(parts, "、")
}

var changeWords = regexp.MustCompile(`上升|下降|增加|减少|增长|降低|多了|少了|提高|持平|涨|跌|翻倍|环比|相比|比上|较上`)

// GradeTranscript checks one transcript against its case.
func GradeTranscript(item Case, transcript Transcript, now time.Time, loc *time.Location) Grade {
	grade := Grade{Problems: []string{}, Ungrounded: []string{}, ChangeOK: true}
	var best []string
	for _, call := range transcript.Calls {
		if call.Name != item.Expect.Tool && !contains(item.Expect.AlsoAccept, call.Name) {
			continue
		}
		grade.ToolOK = true
		problems := []string{}
		if call.Name == item.Expect.Tool {
			problems = checkCall(item.Expect, call, now, loc)
		}
		if best == nil || len(problems) < len(best) {
			best = problems
		}
	}
	if !grade.ToolOK {
		called := []string{}
		for _, call := range transcript.Calls {
			called = append(called, call.Name)
		}
		message := "没有调用 " + item.Expect.Tool
		if len(called) > 0 {
			message += "（调用了 " + strings.Join(called, "、") + "）"
		}
		grade.Problems = append(grade.Problems, message)
	} else {
		grade.Problems = append(grade.Problems, best...)
		grade.ArgsOK = len(best) == 0
	}
	grade.Ungrounded = UngroundedNumbers(transcript.Answer, item.Prompt, transcript.Calls)
	if item.Expect.MentionsChange {
		grade.ChangeOK = changeWords.MatchString(transcript.Answer)
		if !grade.ChangeOK {
			grade.Problems = append(grade.Problems, "没有说明变化")
		}
	}
	if len(grade.Ungrounded) > 0 {
		grade.Problems = append(grade.Problems, "数字没有出处："+strings.Join(grade.Ungrounded, "、"))
	}
	grade.Passed = grade.ToolOK && grade.ArgsOK && grade.ChangeOK && len(grade.Ungrounded) == 0
	return grade
}

func contains(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}

var (
	// Spans that hold numbers which are not claims: links, code, dates and
	// clock times, list markers.
	linkPattern     = regexp.MustCompile(`\]\([^)]*\)|https?://\S+|` + "`[^`]*`")
	datePattern     = regexp.MustCompile(`\d{4}[-/年.]\d{1,2}(?:[-/月.]\d{1,2}日?)?|\d{1,2}月\d{1,2}[日号]?|\d{1,2}:\d{2}|\d{1,2}月(?:份)?`)
	listPattern     = regexp.MustCompile(`(?m)^\s*(?:\d+[.)、]|[-*])\s+`)
	ordinalPattern  = regexp.MustCompile(`第\s*\d+|前\s*\d+\s*(?:名|个|项|条|次|笔)|[Tt]op\s*\d+`)
	weekdayPattern  = regexp.MustCompile(`周[一二三四五六日天]`)
	windowPattern   = regexp.MustCompile(`(?:最近|近|过去|之前)\s*\d+\s*(?:天|周|个月|小时)`)
	numberPattern   = regexp.MustCompile(`\d[\d,]*(?:\.\d+)?\s*(万)?`)
	resultNumberPat = regexp.MustCompile(`-?\d+(?:\.\d+)?`)
)

// UngroundedNumbers returns the numbers in answer that cannot be traced to a
// tool result: present as is, or as a difference, sum, ratio, percentage
// change or share of two returned values. Numbers the user typed and numbers
// that are dates, times, time windows ("最近 30 天") or list markers are not
// claims and are skipped.
func UngroundedNumbers(answer, prompt string, calls []Call) []string {
	text := linkPattern.ReplaceAllString(answer, " ")
	text = datePattern.ReplaceAllString(text, " ")
	text = listPattern.ReplaceAllString(text, " ")
	text = ordinalPattern.ReplaceAllString(text, " ")
	text = weekdayPattern.ReplaceAllString(text, " ")
	text = windowPattern.ReplaceAllString(text, " ")

	userNumbers := map[float64]bool{}
	for _, match := range resultNumberPat.FindAllString(prompt, -1) {
		if value, err := strconv.ParseFloat(match, 64); err == nil {
			userNumbers[value] = true
		}
	}
	values := groundValues(calls)
	out := []string{}
	seen := map[string]bool{}
	for _, match := range numberPattern.FindAllStringSubmatch(text, -1) {
		raw := strings.TrimSpace(match[0])
		digits := strings.ReplaceAll(strings.TrimSuffix(strings.TrimSpace(strings.TrimSuffix(raw, "万")), " "), ",", "")
		value, err := strconv.ParseFloat(digits, 64)
		if err != nil {
			continue
		}
		precision := 0.5
		if dot := strings.IndexByte(digits, '.'); dot >= 0 {
			precision = 0.5 * math.Pow(10, -float64(len(digits)-dot-1))
		}
		if match[1] != "" {
			value *= 10000
			precision *= 10000
		}
		if userNumbers[value] || value == 0 {
			continue
		}
		if !values.supports(value, precision) && !seen[raw] {
			seen[raw] = true
			out = append(out, raw)
		}
	}
	return out
}

// groundSet holds every number the tools returned plus what can be derived
// from any two of them.
type groundSet struct {
	base []float64
}

const maxGroundValues = 600

func groundValues(calls []Call) groundSet {
	unique := map[float64]bool{}
	for _, call := range calls {
		var decoded any
		if json.Unmarshal([]byte(call.Result), &decoded) == nil {
			collectNumbers(decoded, unique)
		} else {
			for _, match := range resultNumberPat.FindAllString(call.Result, -1) {
				if value, err := strconv.ParseFloat(match, 64); err == nil {
					unique[math.Abs(value)] = true
				}
			}
		}
	}
	base := make([]float64, 0, len(unique))
	for value := range unique {
		base = append(base, value)
	}
	sort.Float64s(base)
	if len(base) > maxGroundValues {
		// Keep the largest values: totals matter more than per-row noise.
		base = base[len(base)-maxGroundValues:]
	}
	return groundSet{base: base}
}

func collectNumbers(value any, into map[float64]bool) {
	switch typed := value.(type) {
	case float64:
		into[math.Abs(typed)] = true
	case string:
		for _, match := range resultNumberPat.FindAllString(typed, -1) {
			if number, err := strconv.ParseFloat(match, 64); err == nil {
				into[math.Abs(number)] = true
			}
		}
	case []any:
		for _, item := range typed {
			collectNumbers(item, into)
		}
	case map[string]any:
		for _, item := range typed {
			collectNumbers(item, into)
		}
	}
}

func near(a, b, precision float64) bool { return math.Abs(a-b) <= precision+1e-9 }

func (g groundSet) supports(value, precision float64) bool {
	for _, a := range g.base {
		if near(a, value, precision) {
			return true
		}
	}
	for i, a := range g.base {
		for j, b := range g.base {
			if i == j {
				continue
			}
			if a > b && near(a-b, value, precision) {
				return true
			}
			if a+b > 0 && near(a+b, value, precision) {
				return true
			}
			if b != 0 {
				ratio := a / b
				if near(ratio, value, precision) || near(ratio*100, value, precision) ||
					near(math.Abs(ratio-1)*100, value, precision) {
					return true
				}
			}
		}
	}
	return false
}
