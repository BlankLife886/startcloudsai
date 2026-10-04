package httpapi

import (
	"context"
	"encoding/json"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantreview"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// assistantCorrectionIn marks a run as the user's one-tap correction of an
// earlier reply ("我只是问问", "帮我画出来", "联网查一下").
type assistantCorrectionIn struct {
	MessageID string `json:"messageId"`
	Action    string `json:"action"`
}

var assistantCorrectionText = regexp.MustCompile(store.AssistantCorrectionPattern)

// imageDeletedSoon is how soon after an image is made deleting it counts as
// "the user did not want this".
const imageDeletedSoon = 10 * time.Minute

// validateAssistantCorrection checks a correction before the run is created:
// it belongs to 问答/Agent turns and its mode is fixed by the action.
func validateAssistantCorrection(correction *assistantCorrectionIn, mode string, engineV2 bool) error {
	if correction == nil {
		return nil
	}
	definition, known := assistantreview.CorrectionFor(strings.TrimSpace(correction.Action))
	if _, err := uuid.Parse(strings.TrimSpace(correction.MessageID)); err != nil || !known {
		return apperr.E("validation_error", "correction 无效", 422)
	}
	if !engineV2 || mode == "image" || (definition.Mode != "" && definition.Mode != mode) {
		return apperr.E("validation_error", "correction 与模式不符", 422)
	}
	return nil
}

// recordAssistantTurnSignals notes what a new run says about earlier turns:
// a proposal being run, a one-tap correction (which also becomes a
// regression case), or a text correction. It runs after the run is created
// and is best effort: a failure here must never fail the user's message.
func (s *Server) recordAssistantTurnSignals(ctx context.Context, body assistantRunIn, conversationID, assistantMessageID uuid.UUID) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	record := func(event store.AssistantTurnEvent) {
		if err := store.RecordAssistantTurnEvent(ctx, s.St.Pool, event); err != nil {
			log.Printf("assistant turn event %s for %s failed: %v", event.Event, event.AssistantMessageID, err)
		}
	}
	if sourceID, err := uuid.Parse(strings.TrimSpace(body.ProposalSourceMessageID)); err == nil {
		record(store.AssistantTurnEvent{AssistantMessageID: sourceID, Event: assistantreview.EventProposalExecuted})
	}
	if strings.TrimSpace(body.SourceUserMessageID) != "" {
		// Editing or regenerating rewrites the conversation; it says nothing
		// about the reply it replaces.
		return
	}
	if body.Correction != nil {
		if err := s.recordAssistantCorrection(ctx, *body.Correction, conversationID); err != nil {
			log.Printf("assistant correction for %s failed: %v", body.Correction.MessageID, err)
		}
		return
	}
	previous, err := store.LatestAssistantReplyBefore(ctx, s.St.Pool, conversationID, assistantMessageID)
	if err != nil || previous == nil {
		return
	}
	if assistantCorrectionText.MatchString(body.Prompt) {
		record(store.AssistantTurnEvent{AssistantMessageID: previous.ID, Event: assistantreview.EventCorrectedInText})
	}
}

func (s *Server) recordAssistantCorrection(ctx context.Context, correction assistantCorrectionIn, conversationID uuid.UUID) error {
	definition, _ := assistantreview.CorrectionFor(correction.Action)
	messageID, _ := uuid.Parse(strings.TrimSpace(correction.MessageID))
	message, err := store.GetAssistantMessage(ctx, s.St.Pool, messageID)
	if err != nil || message == nil || message.ConversationID != conversationID || message.Role != "assistant" {
		return err
	}
	run, err := store.GetAssistantRunByAssistantMessage(ctx, s.St.Pool, messageID)
	if err != nil || run == nil {
		return err
	}
	got := assistantreview.RecordedMove(message.Kind, message.Status, assistantToolStepNames(message.Metadata))
	if err := store.RecordAssistantTurnEvent(ctx, s.St.Pool, store.AssistantTurnEvent{
		AssistantMessageID: messageID, Event: assistantreview.CorrectionEvent(definition.Action), Got: got, Expected: definition.Expected,
	}); err != nil {
		return err
	}
	if !definition.Labels(run.Mode, got) {
		return nil
	}
	history, err := store.ListAssistantMessages(ctx, s.St.Pool, conversationID, 60)
	if err != nil {
		return err
	}
	contextJSON, _ := json.Marshal(assistantreview.ContextFrom(history, run.UserMessageID))
	_, err = store.UpsertAssistantAgentCase(ctx, s.St.Pool, store.AssistantAgentCase{
		SourceMessageID: &messageID, Mode: run.Mode, Context: contextJSON, Prompt: run.Prompt,
		ReferenceCount: len(assistantReferenceItems(run.Params["referenceImages"])), Expected: []string{definition.Expected},
	})
	return err
}

// assistantToolStepNames lists the tools a reply called, in order.
func assistantToolStepNames(metadata map[string]any) []string {
	steps, _ := metadata["toolSteps"].([]any)
	names := make([]string, 0, len(steps))
	for _, raw := range steps {
		if step, ok := raw.(map[string]any); ok {
			if name, _ := step["name"].(string); name != "" {
				names = append(names, name)
			}
		}
	}
	return names
}

// recordAssistantTurnEventLater stores an event without failing the request.
func (s *Server) recordAssistantTurnEventLater(ctx context.Context, messageID uuid.UUID, event string) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancel()
	if err := store.RecordAssistantTurnEvent(ctx, s.St.Pool, store.AssistantTurnEvent{AssistantMessageID: messageID, Event: event}); err != nil {
		log.Printf("assistant turn event %s for %s failed: %v", event, messageID, err)
	}
}
