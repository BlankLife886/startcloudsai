package assistantreview

import (
	"context"
	"sort"
	"sync"
	"time"
)

// Action is the agent's first move on a case: a tool call, or words.
type Action struct {
	Category  string `json:"category"`
	Tool      string `json:"tool,omitempty"`
	Arguments string `json:"arguments,omitempty"`
	Text      string `json:"text,omitempty"`
	LatencyMs int64  `json:"latencyMs"`
}

// Probe asks the agent for its first move on a case without running tools.
type Probe func(ctx context.Context, item Case) (Action, error)

// Result is one case's outcome.
type Result struct {
	Case   Case   `json:"case"`
	Got    Action `json:"got"`
	Passed bool   `json:"passed"`
	Error  string `json:"error,omitempty"`
}

// Bucket counts results for one expected category.
type Bucket struct {
	Expected string `json:"expected"`
	Total    int    `json:"total"`
	Passed   int    `json:"passed"`
}

// Report summarises an evaluation run.
type Report struct {
	ModelID      string   `json:"modelId"`
	Total        int      `json:"total"`
	Passed       int      `json:"passed"`
	Accuracy     float64  `json:"accuracy"`
	Errors       int      `json:"errors"`
	AvgLatencyMs int64    `json:"avgLatencyMs"`
	ByExpected   []Bucket `json:"byExpected"`
	// Failures lists wrong and failed cases, user cases first.
	Failures   []Result `json:"failures"`
	DurationMs int64    `json:"durationMs"`
}

// Passes reports whether a first move is one the case accepts.
func Passes(item Case, got Action) bool {
	for _, expected := range item.Expected {
		if expected == got.Category {
			return true
		}
	}
	return false
}

// Evaluate probes every case with up to concurrency calls in flight. A case
// whose probe fails counts as failed; the run never stops early.
func Evaluate(ctx context.Context, cases []Case, probe Probe, modelID string, concurrency int) Report {
	started := time.Now()
	if concurrency < 1 {
		concurrency = 1
	}
	results := make([]Result, len(cases))
	slots := make(chan struct{}, concurrency)
	var group sync.WaitGroup
	for index := range cases {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			select {
			case slots <- struct{}{}:
				defer func() { <-slots }()
			case <-ctx.Done():
				results[index] = Result{Case: cases[index], Error: ctx.Err().Error()}
				return
			}
			got, err := probe(ctx, cases[index])
			result := Result{Case: cases[index], Got: got}
			if err != nil {
				result.Error = err.Error()
			} else {
				result.Passed = Passes(cases[index], got)
			}
			results[index] = result
		}(index)
	}
	group.Wait()

	report := Report{ModelID: modelID, Total: len(results), Failures: []Result{}}
	buckets := map[string]*Bucket{}
	var latency int64
	answered := 0
	for _, result := range results {
		key := result.Case.Expected[0]
		if buckets[key] == nil {
			buckets[key] = &Bucket{Expected: key}
		}
		buckets[key].Total++
		switch {
		case result.Error != "":
			report.Errors++
			report.Failures = append(report.Failures, result)
		case result.Passed:
			report.Passed++
			buckets[key].Passed++
		default:
			report.Failures = append(report.Failures, result)
		}
		if result.Error == "" {
			latency += result.Got.LatencyMs
			answered++
		}
	}
	if report.Total > 0 {
		report.Accuracy = float64(report.Passed) / float64(report.Total)
	}
	if answered > 0 {
		report.AvgLatencyMs = latency / int64(answered)
	}
	for _, key := range Expectations {
		if bucket := buckets[key]; bucket != nil {
			report.ByExpected = append(report.ByExpected, *bucket)
		}
	}
	sort.SliceStable(report.Failures, func(i, j int) bool {
		return report.Failures[i].Case.Source == SourceUser && report.Failures[j].Case.Source != SourceUser
	})
	report.DurationMs = time.Since(started).Milliseconds()
	return report
}
