package assistantreview

import "strings"

// One-tap corrections the user can make on the assistant's last answer.
// Each one fixes the turn for the user and, when it is a real mistake,
// labels it: the turn should have been Expected.
const (
	ActionJustAsking = "just_asking" // on an image proposal: "我只是问问"
	ActionDrawIt     = "draw_it"     // on a text answer: "帮我画出来"
	ActionSearchWeb  = "search_web"  // on a text answer: "联网查一下"
)

// Correction describes one action: what the follow-up message says, which
// mode it runs in ("" keeps the user's mode), and what the corrected turn
// should have done.
type Correction struct {
	Action   string
	Prompt   string
	Mode     string
	Expected string
}

var corrections = map[string]Correction{
	ActionJustAsking: {Action: ActionJustAsking, Prompt: "我只是问问，不用出图。", Mode: ModeChat, Expected: ExpectAnswer},
	ActionDrawIt:     {Action: ActionDrawIt, Prompt: "帮我画出来。", Mode: ModeAgent, Expected: ExpectImage},
	ActionSearchWeb:  {Action: ActionSearchWeb, Prompt: "联网查一下最新信息。", Expected: ExpectWeb},
}

// CorrectionFor returns the action's definition.
func CorrectionFor(action string) (Correction, bool) {
	item, ok := corrections[action]
	return item, ok
}

// Labels reports whether a correction says the corrected turn was wrong.
// 问答 mode cannot draw by design, so "帮我画出来" there is a mode switch,
// not a mistake; and correcting a turn into what it already did is noise.
func (c Correction) Labels(correctedMode, got string) bool {
	if c.Action == ActionDrawIt && correctedMode != ModeAgent {
		return false
	}
	return got != c.Expected
}

// Turn events, recorded when they happen.
const (
	EventProposalExecuted = "proposal_executed" // an image proposal was run
	EventStopped          = "stopped"           // the user stopped the turn
	EventImageDeleted     = "image_deleted"     // an image deleted soon after it was made
	EventNegativeFeedback = "negative_feedback" // thumbs-down
	EventCorrectedInText  = "corrected_in_text" // the next message says it misunderstood
)

// CorrectionEvent is the event name for a one-tap correction.
func CorrectionEvent(action string) string { return "correction_" + action }

// CategoryOfTool names the kind of move a tool call is. The plan tool is
// not a move and returns "".
func CategoryOfTool(name string) string {
	switch {
	case name == "":
		return ExpectAnswer
	case name == "update_plan":
		return ""
	case name == "propose_image_action" || strings.HasPrefix(name, "commerce_set_"):
		return ExpectImage
	case name == "web_search":
		return ExpectWeb
	case name == "task_status" || name == "explain_charge" || strings.HasPrefix(name, "my_") ||
		strings.HasPrefix(name, "assets_") || strings.HasPrefix(name, "memory_"):
		return ExpectData
	case strings.HasPrefix(name, "files_"):
		return ExpectFiles
	}
	return ExpectWorkspace
}

// RecordedMove is the first move a stored turn made: its first tool that is
// a move, an image proposal, or a plain answer. Failed turns made none.
func RecordedMove(kind, status string, tools []string) string {
	if status == "failed" {
		return ""
	}
	for _, tool := range tools {
		if category := CategoryOfTool(tool); category != "" {
			return category
		}
	}
	if kind == "proposal" {
		return ExpectImage
	}
	return ExpectAnswer
}
