package assistantreview

import (
	"context"
	"sync"
	"time"
)

// Replay is a real turn replayed against the current version: what was
// asked, what the assistant did then, and what the user's behaviour says
// about it.
type Replay struct {
	Case Case
	// Recorded is the first move the assistant made at the time.
	Recorded string
	// Label is what a one-tap correction said the move should have been.
	Label string
	// Executed means the user ran the image proposal it made.
	Executed bool
	// Doubted means the user stopped it, gave a thumbs-down, deleted the image
	// soon after or said it misunderstood.
	Doubted   bool
	CreatedAt time.Time
}

// Verdicts for a replayed turn.
const (
	VerdictBetter       = "better"        // now matches the user's correction
	VerdictWorse        = "worse"         // the user had accepted the old move
	VerdictLikelyBetter = "likely_better" // the old move was doubted and now differs
	VerdictStillWrong   = "still_wrong"   // the user corrected it and now repeats it
	VerdictUnknown      = "unknown"       // changed, with nothing to judge by
)

// CompareItem is one turn worth looking at.
type CompareItem struct {
	Case      Case      `json:"case"`
	Recorded  string    `json:"recorded"`
	Now       Action    `json:"now"`
	Label     string    `json:"label,omitempty"`
	Verdict   string    `json:"verdict"`
	Error     string    `json:"error,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// CompareReport summarises a replay: only turns whose first move changed (or
// that the user corrected and still go wrong) are listed.
type CompareReport struct {
	ModelID      string        `json:"modelId"`
	Total        int           `json:"total"`
	Same         int           `json:"same"`
	Changed      int           `json:"changed"`
	Better       int           `json:"better"`
	LikelyBetter int           `json:"likelyBetter"`
	Worse        int           `json:"worse"`
	StillWrong   int           `json:"stillWrong"`
	Unknown      int           `json:"unknown"`
	Errors       int           `json:"errors"`
	Items        []CompareItem `json:"items"`
	DurationMs   int64         `json:"durationMs"`
}

// Judge decides what a replayed move means, using only the user's own
// behaviour on the recorded turn.
func Judge(replay Replay, now string) string {
	switch {
	case now == replay.Recorded && replay.Label != "" && replay.Label != now:
		return VerdictStillWrong
	case now == replay.Recorded:
		return ""
	case replay.Label != "" && now == replay.Label:
		return VerdictBetter
	case replay.Label == "" && replay.Recorded == ExpectImage && replay.Executed:
		return VerdictWorse
	case replay.Label == "" && replay.Doubted:
		return VerdictLikelyBetter
	}
	return VerdictUnknown
}

// Compare replays turns through probe and judges every changed first move.
func Compare(ctx context.Context, replays []Replay, probe Probe, modelID string, concurrency int) CompareReport {
	started := time.Now()
	if concurrency < 1 {
		concurrency = 1
	}
	moves := make([]Action, len(replays))
	failures := make([]error, len(replays))
	slots := make(chan struct{}, concurrency)
	var group sync.WaitGroup
	for index := range replays {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			select {
			case slots <- struct{}{}:
				defer func() { <-slots }()
			case <-ctx.Done():
				failures[index] = ctx.Err()
				return
			}
			moves[index], failures[index] = probe(ctx, replays[index].Case)
		}(index)
	}
	group.Wait()

	report := CompareReport{ModelID: modelID, Total: len(replays), Items: []CompareItem{}}
	for index, replay := range replays {
		item := CompareItem{Case: replay.Case, Recorded: replay.Recorded, Now: moves[index], Label: replay.Label, CreatedAt: replay.CreatedAt}
		if failures[index] != nil {
			report.Errors++
			item.Error = failures[index].Error()
			report.Items = append(report.Items, item)
			continue
		}
		item.Verdict = Judge(replay, moves[index].Category)
		switch item.Verdict {
		case "":
			report.Same++
			continue
		case VerdictStillWrong:
			report.Same++
			report.StillWrong++
		case VerdictBetter:
			report.Changed++
			report.Better++
		case VerdictLikelyBetter:
			report.Changed++
			report.LikelyBetter++
		case VerdictWorse:
			report.Changed++
			report.Worse++
		default:
			report.Changed++
			report.Unknown++
		}
		report.Items = append(report.Items, item)
	}
	report.DurationMs = time.Since(started).Milliseconds()
	return report
}
