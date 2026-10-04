package commerceset

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// ShotView is one image as the assistant card shows it.
type ShotView struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Role        string `json:"role"`
	AspectRatio string `json:"aspectRatio"`
	Headline    string `json:"headline,omitempty"`
	Subline     string `json:"subline,omitempty"`
	Direction   string `json:"direction,omitempty"`
	Attempts    int    `json:"attempts"`
	TaskID      string `json:"taskId,omitempty"`
	Status      string `json:"status"`
	ImageURL    string `json:"imageUrl,omitempty"`
	OriginalURL string `json:"originalUrl,omitempty"`
	// FileKey is the stored original, so the image viewer can edit it.
	FileKey string `json:"fileKey,omitempty"`
	// Edited means the latest image was edited by the user in the viewer.
	Edited bool `json:"edited,omitempty"`
	// PriceCents is what the latest attempt cost, the estimate for a redo.
	PriceCents int64    `json:"priceCents,omitempty"`
	Reviewed   bool     `json:"reviewed"`
	Pass       bool     `json:"pass"`
	Issues     []string `json:"issues,omitempty"`
	CanRedo    bool     `json:"canRedo"`
}

// View is a set as the assistant card and the model see it.
type View struct {
	ID            string `json:"id"`
	Status        string `json:"status"`
	ProductName   string `json:"productName,omitempty"`
	Platform      string `json:"platform,omitempty"`
	Language      string `json:"language,omitempty"`
	Summary       string `json:"summary,omitempty"`
	ModelID       string `json:"modelId"`
	QuotedCents   int64  `json:"quotedCents"`
	ApprovedCents int64  `json:"approvedCents"`
	// SpentCents counts finished images only; failed tasks are refunded.
	// ReservedCents is held for images still being made.
	SpentCents    int64 `json:"spentCents"`
	ReservedCents int64 `json:"reservedCents"`
	// Downloadable counts shots whose latest image is ready.
	Downloadable int        `json:"downloadable"`
	Shots        []ShotView `json:"shots"`
	// Done counts shots whose latest image finished; Ready means every shot
	// is finished and checked, so the set can be delivered.
	Done             int    `json:"done"`
	Total            int    `json:"total"`
	Ready            bool   `json:"ready"`
	NeedsReview      bool   `json:"needsReview"`
	WorkbenchLink    string `json:"workbenchLink"`
	AutoApprove      bool   `json:"autoApprove"`
	BudgetCents      int64  `json:"budgetCents"`
	AutoApprovable   bool   `json:"autoApprovable"`
	ConfirmationNote string `json:"confirmationNote,omitempty"`
}

// AttemptOutput is the image an attempt produced: its own adopted file, or
// its task's first output once the task succeeded.
func AttemptOutput(attempt *store.CommerceSetAttempt, tasks map[uuid.UUID]*store.Task) (key, thumb string) {
	if attempt == nil {
		return "", ""
	}
	if attempt.FileKey != "" {
		return attempt.FileKey, attempt.ThumbKey
	}
	task := tasks[attempt.TaskID]
	if task == nil || task.Status != "succeeded" || len(task.OutputKeys) == 0 {
		return "", ""
	}
	if len(task.ThumbnailKeys) > 0 {
		thumb = task.ThumbnailKeys[0]
	}
	return task.OutputKeys[0], thumb
}

// fileURL is the app's authenticated file route.
func fileURL(key string) string {
	return "/api/v1/files/" + strings.TrimLeft(strings.TrimSpace(key), "/")
}

// BuildView reads the latest task of every shot and assembles the view.
func (s Service) BuildView(ctx context.Context, set *store.CommerceSet) (*View, error) {
	var spent, reserved int64
	var brief Brief
	_ = json.Unmarshal(set.Brief, &brief)
	tasks, err := s.allTasks(ctx, set)
	if err != nil {
		return nil, err
	}
	for _, shot := range set.Shots {
		for _, attempt := range shot.Attempts {
			task := tasks[attempt.TaskID]
			switch {
			case task == nil:
			case task.Status == "succeeded":
				spent += attempt.PriceCents
			case !terminal(task.Status):
				reserved += attempt.PriceCents
			}
		}
	}
	user, err := store.GetUserByID(ctx, s.St.Pool, set.UserID)
	if err != nil {
		return nil, err
	}
	view := &View{
		ID: set.ID.String(), Status: set.Status, ProductName: brief.ProductName, Platform: brief.Platform,
		Language: brief.Language, Summary: set.Summary, ModelID: set.ModelID, QuotedCents: set.QuotedCents,
		ApprovedCents: set.ApprovedCents, SpentCents: spent, ReservedCents: reserved, Total: len(set.Shots), Shots: []ShotView{},
		WorkbenchLink: "/ecommerce-design",
	}
	if user != nil {
		view.AutoApprove, view.BudgetCents = user.AssistantAutoApprove, user.AssistantAutoApproveBudgetCents
		view.AutoApprovable = user.AssistantAutoApprove && set.ApprovedCents+set.QuotedCents <= user.AssistantAutoApproveBudgetCents
		if set.Status == store.CommerceSetPlanned && !view.AutoApprovable {
			view.ConfirmationNote = BudgetMessage(user, set, set.QuotedCents)
		}
	}
	ready := len(set.Shots) > 0
	for _, shot := range set.Shots {
		item := ShotView{ID: shot.ID, Label: shot.Label, Role: shot.Role, AspectRatio: shot.AspectRatio,
			Headline: shot.Headline, Subline: shot.Subline, Direction: shot.Direction, Attempts: len(shot.Attempts), Status: "planned"}
		attempt := latest(shot)
		if attempt == nil {
			ready = false
		} else {
			item.Status = "queued"
			item.PriceCents = attempt.PriceCents
			if attempt.FileKey != "" {
				item.Status = "succeeded"
				item.Edited = true
				item.PriceCents = previousPrice(shot)
			} else {
				item.TaskID = attempt.TaskID.String()
				if task := tasks[attempt.TaskID]; task != nil {
					item.Status = task.Status
				}
			}
			if key, thumb := AttemptOutput(attempt, tasks); key != "" {
				view.Downloadable++
				item.FileKey = key
				item.OriginalURL = fileURL(key)
				item.ImageURL = item.OriginalURL
				if thumb != "" {
					item.ImageURL = fileURL(thumb)
				}
			}
			if terminal(item.Status) {
				view.Done++
				if attempt.Review == nil {
					view.NeedsReview = true
				}
			}
			if attempt.Review != nil {
				item.Reviewed = true
				item.Pass = attempt.Review.Pass || attempt.Review.Skipped
				item.Issues = attempt.Review.Issues
			} else {
				ready = false
			}
			item.CanRedo = terminal(item.Status) && generatedAttempts(shot) < maxAttemptsPerShot
		}
		view.Shots = append(view.Shots, item)
	}
	view.Ready = ready
	return view, nil
}

// generatedAttempts counts the images the model made for a shot; edits the
// user adopted do not use up redos.
func generatedAttempts(shot store.CommerceSetShot) int {
	count := 0
	for _, attempt := range shot.Attempts {
		if attempt.FileKey == "" {
			count++
		}
	}
	return count
}

// previousPrice is what the last generated attempt cost: the estimate for
// redoing a shot whose latest image was an edit.
func previousPrice(shot store.CommerceSetShot) int64 {
	for index := len(shot.Attempts) - 1; index >= 0; index-- {
		if shot.Attempts[index].FileKey == "" {
			return shot.Attempts[index].PriceCents
		}
	}
	return 0
}

// ViewByID loads a user's set and builds its view; nil when not theirs.
func (s Service) ViewByID(ctx context.Context, userID, setID uuid.UUID) (*View, error) {
	set, err := store.GetUserCommerceSet(ctx, s.St.Pool, userID, setID)
	if err != nil || set == nil {
		return nil, err
	}
	return s.BuildView(ctx, set)
}

// allTasks reads the task of every attempt, so spent points include
// replaced images as well as the current ones.
func (s Service) allTasks(ctx context.Context, set *store.CommerceSet) (map[uuid.UUID]*store.Task, error) {
	ids := []uuid.UUID{}
	for _, shot := range set.Shots {
		for _, attempt := range shot.Attempts {
			ids = append(ids, attempt.TaskID)
		}
	}
	if len(ids) == 0 {
		return map[uuid.UUID]*store.Task{}, nil
	}
	return store.GetTasksByIDs(ctx, s.St.Pool, ids)
}
