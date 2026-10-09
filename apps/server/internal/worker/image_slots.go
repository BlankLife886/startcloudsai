package worker

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/contentpolicy"
	"github.com/BlankLife886/startcloudsai/server/internal/crun"
	"github.com/BlankLife886/startcloudsai/server/internal/imageslots"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

const (
	typeProbeImageSlots     = "cron:probe_image_slots"
	imageSlotProbeParallel  = 4
	imageSlotOutcomeTimeout = 10 * time.Second
)

// slotFailureCounts reports whether a failed attempt says something about the
// member rather than the request: content, validation, cancellation and our
// own processing errors never take a member out.
func slotFailureCounts(errorCode string) bool {
	switch errorCode {
	case "user_canceled", "admin_force_failed", "upstream_submission_uncertain":
		return false
	}
	for _, prefix := range []string{"content_policy", "invalid", "validation", "insufficient"} {
		if strings.HasPrefix(errorCode, prefix) {
			return false
		}
	}
	return strings.HasPrefix(errorCode, "upstream")
}

// slotMemberRejected is an upstream refusal that means the member itself
// cannot serve (bad key, no balance, no access, unknown model). A slot task
// moves on to its next member instead of failing outright.
func slotMemberRejected(task *store.Task, err error) bool {
	if task == nil || taskParamString(task.Params, "_slotResolution") == "" {
		return false
	}
	return upstreamRejectsMember(err)
}

// upstreamRejectsMember reports an upstream status that blames the member.
func upstreamRejectsMember(err error) bool {
	if err == nil {
		return false
	}
	status := 0
	var c2aErr *c2a.UpstreamError
	var subErr *sub2api.UpstreamError
	var crunErr *crun.UpstreamError
	switch {
	case errors.As(err, &c2aErr):
		status = c2aErr.StatusCode
	case errors.As(err, &subErr):
		status = subErr.Status
	case errors.As(err, &crunErr):
		status = crunErr.Status
	}
	switch status {
	case http.StatusUnauthorized, http.StatusPaymentRequired, http.StatusForbidden, http.StatusNotFound:
		return true
	}
	return false
}

func (w *Worker) recordSlotFailure(ctx context.Context, task *store.Task, errorCode, message string) {
	if task == nil || taskParamString(task.Params, "_slotResolution") == "" || !slotFailureCounts(errorCode) {
		return
	}
	if policy, err := contentpolicy.Load(ctx, w.St.Pool); err == nil {
		if _, violation := policy.Match(message); violation {
			return
		}
	}
	w.recordSlotOutcome(ctx, task, false, message)
}

func (w *Worker) recordSlotSuccess(ctx context.Context, task *store.Task) {
	w.recordSlotOutcome(ctx, task, true, "")
}

// recordSlotOutcome feeds one slot attempt into its member's health. It is
// best effort: health is advisory and must never fail the task itself.
func (w *Worker) recordSlotOutcome(ctx context.Context, task *store.Task, ok bool, message string) {
	if task == nil {
		return
	}
	w.recordSlotMemberOutcome(ctx, "task "+task.ID.String(), taskParamString(task.Params, "_modelConfigId"),
		taskParamString(task.Params, "_slotResolution"), ok, message)
}

// recordAssistantSlotOutcome is recordSlotOutcome for a direct assistant image run.
func (w *Worker) recordAssistantSlotOutcome(ctx context.Context, run *store.AssistantRun, ok bool, message string) {
	if run == nil {
		return
	}
	w.recordSlotMemberOutcome(ctx, "assistant run "+run.ID.String(), assistantParamString(run.Params, "_imageModelConfigId", ""),
		assistantParamString(run.Params, "_imageSlotResolution", ""), ok, message)
}

func (w *Worker) recordSlotMemberOutcome(ctx context.Context, source, memberID, resolution string, ok bool, message string) {
	if resolution == "" || memberID == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), imageSlotOutcomeTimeout)
	defer cancel()
	err := w.St.Tx(ctx, func(tx pgx.Tx) error {
		return imageslots.RecordOutcome(ctx, tx, func() (modelconfig.Config, error) {
			return modelconfig.Load(ctx, tx)
		}, memberID, resolution, ok, message, time.Now().UTC())
	})
	if err != nil {
		log.Printf("%s image slot outcome member=%s resolution=%s ok=%t failed: %v", source, memberID, resolution, ok, err)
	}
}

// handleProbeImageSlots checks down slot members at the configured interval,
// within the 24-hour probe budget, and switches slots back as they recover.
func (w *Worker) handleProbeImageSlots(ctx context.Context, _ *asynq.Task) error {
	cfg, err := modelconfig.Load(ctx, w.St.Pool)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	// Keeps slot states in step with configuration edits as well.
	if err := w.St.Tx(ctx, func(tx pgx.Tx) error { return imageslots.Reconcile(ctx, tx, cfg, now) }); err != nil {
		return err
	}
	targets, err := imageslots.DueProbes(ctx, w.St.Pool, cfg, now)
	if err != nil || len(targets) == 0 {
		return err
	}
	runtime, err := modelconfig.Runtime(ctx, w.St.Pool, w.Cfg.AppSecret)
	if err != nil {
		return err
	}
	sem := make(chan struct{}, imageSlotProbeParallel)
	var wg sync.WaitGroup
	for _, target := range targets {
		wg.Add(1)
		sem <- struct{}{}
		go func(target imageslots.ProbeTarget) {
			defer wg.Done()
			defer func() { <-sem }()
			ok, message := imageslots.Probe(ctx, runtime, target, w.Cfg.C2APrivateNetworkAllowed())
			at := time.Now().UTC()
			if err := w.St.Tx(ctx, func(tx pgx.Tx) error {
				return imageslots.RecordProbe(ctx, tx, cfg, target, ok, message, at)
			}); err != nil {
				log.Printf("image slot probe record member=%s resolution=%s failed: %v", target.ModelID, target.Resolution, err)
			}
		}(target)
	}
	wg.Wait()
	return nil
}
