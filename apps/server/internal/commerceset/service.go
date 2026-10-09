package commerceset

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
)

// TaskType is what a set produces: ordinary e-commerce workbench tasks.
const TaskType = "ecommerce_design"

// SetParam links a task back to its set.
const SetParam = "_assistantCommerceSetId"

const (
	maxReferenceImages = 6
	// maxAttemptsPerShot bounds redos: the first image plus two redos.
	maxAttemptsPerShot = 3
	// autoRedoAttempts is how many attempts a shot may reach through
	// budget-approved automatic redos; more need the user.
	autoRedoAttempts = 2
)

// ErrNeedsConfirmation means spending was not approved: auto-approval is off
// or the set's cumulative cost would pass the user's budget. The user can
// still approve it on the card.
var ErrNeedsConfirmation = errors.New("commerce set needs user confirmation")

// ErrPriceChanged means the price moved since the user saw it.
var ErrPriceChanged = errors.New("commerce set price changed")

// Service plans and produces sets. Enqueue hands created tasks to the
// queue; it may be nil in tests, where the durable queued-task recovery
// would pick them up.
type Service struct {
	St      *store.Store
	Enqueue func(ctx context.Context, taskID string) error
	Now     func() time.Time
}

func (s Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now().UTC()
}

// CopyWriter asks a vision-capable chat model to plan copy, with the
// product images attached by the caller.
type CopyWriter func(ctx context.Context, prompt string) (string, error)

// PlanInput is everything needed to plan a set.
type PlanInput struct {
	UserID         uuid.UUID
	ConversationID *uuid.UUID
	RunID          *uuid.UUID
	InputKeys      []string
	Brief          Brief
	Copy           CopyWriter
	// Competitor is the analysis the set follows; its screenshots are never
	// product references.
	Competitor *store.CompetitorRef
}

// imageModel picks the e-commerce workbench's default image model.
func imageModel(ctx context.Context, q store.Q) (string, error) {
	cfg, err := modelconfig.Load(ctx, q)
	if err != nil {
		return "", err
	}
	selection, ok := modelconfig.SelectPublicForWorkspace(cfg, modelconfig.WorkspaceEcommerce, modelconfig.ModelKindImage, "")
	if !ok {
		return "", invalid("AI 电商暂时没有可用的出图模型")
	}
	return selection.Model.ID, nil
}

// Plan normalises the brief, plans copy for every shot, quotes the set and
// stores it. Planning copy is best effort: when the model fails, shots keep
// their catalog directions and the set can still be generated.
func (s Service) Plan(ctx context.Context, in PlanInput) (*store.CommerceSet, error) {
	in.Brief.Reference, in.Brief.ReferenceSequence, in.Brief.CompetitorRefID = "", "", ""
	if in.Competitor != nil {
		style, err := DecodeCompetitorStyle(in.Competitor.Style)
		if err != nil {
			return nil, err
		}
		in.InputKeys = WithoutKeys(in.InputKeys, in.Competitor.ImageKeys)
		if len(in.InputKeys) == 0 {
			return nil, invalid("竞品截图只用来参考风格，还需要上传你自己的商品图")
		}
		in.Brief.CompetitorRefID = in.Competitor.ID.String()
		in.Brief.Reference, in.Brief.ReferenceSequence = CompetitorStyleText(style), CompetitorSequenceText(style)
		if len(in.Brief.Shots) == 0 {
			in.Brief.Shots = ShotsFromCompetitor(style)
		}
	}
	if len(in.InputKeys) == 0 {
		return nil, invalid("需要先上传至少 1 张商品图")
	}
	if len(in.InputKeys) > maxReferenceImages {
		in.InputKeys = in.InputKeys[:maxReferenceImages]
	}
	brief, err := Normalize(in.Brief)
	if err != nil {
		return nil, err
	}
	shots, err := Expand(brief)
	if err != nil {
		return nil, err
	}
	summary := ""
	if in.Copy != nil {
		reply, copyErr := in.Copy(ctx, CopyPrompt(brief, shots))
		if copyErr == nil {
			summary, shots, copyErr = ApplyCopy(reply, shots)
		}
		if copyErr != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			log.Printf("commerce set copy planning failed, using catalog directions: %v", copyErr)
		}
	}
	modelID, err := imageModel(ctx, s.St.Pool)
	if err != nil {
		return nil, err
	}
	briefJSON, err := json.Marshal(brief)
	if err != nil {
		return nil, err
	}
	set := &store.CommerceSet{
		UserID: in.UserID, ConversationID: in.ConversationID, RunID: in.RunID,
		Brief: briefJSON, Summary: summary, InputKeys: in.InputKeys, ModelID: modelID,
	}
	for _, shot := range shots {
		set.Shots = append(set.Shots, store.CommerceSetShot{ID: shot.ID, TypeID: shot.TypeID, Role: shot.Role,
			Label: shot.Label, AspectRatio: shot.AspectRatio, Headline: shot.Headline, Subline: shot.Subline, Direction: shot.Direction})
	}
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		inputs, err := s.taskInputs(ctx, tx, set, nil, "", nil)
		if err != nil {
			return err
		}
		for _, input := range inputs {
			set.QuotedCents += input.price
		}
		set, err = store.InsertCommerceSet(ctx, tx, set)
		return err
	})
	if err != nil {
		return nil, err
	}
	return set, nil
}

type taskInput struct {
	shotIndex int
	create    taskflow.CreateInput
	price     int64
}

func (s Service) model(ctx context.Context, q store.Q, modelID string) (*modelconfig.Model, error) {
	cfg, err := modelconfig.Load(ctx, q)
	if err != nil {
		return nil, err
	}
	selection, ok := modelconfig.SelectPublicForWorkspace(cfg, modelconfig.WorkspaceEcommerce, modelconfig.ModelKindImage, modelID)
	if !ok || selection.Model.ID != modelID {
		return nil, invalid("这套图选用的出图模型已不可用，请重新策划")
	}
	return &selection.Model, nil
}

// taskInputs builds and quotes the task for each selected shot (nil = all).
// The parameters mirror what the workbench submits for 商品套图.
func (s Service) taskInputs(ctx context.Context, tx pgx.Tx, set *store.CommerceSet, indexes []int, note string, edits map[int]editSpec) ([]taskInput, error) {
	var brief Brief
	if err := json.Unmarshal(set.Brief, &brief); err != nil {
		return nil, err
	}
	shots := make([]Shot, len(set.Shots))
	for index, shot := range set.Shots {
		shots[index] = Shot{ID: shot.ID, TypeID: shot.TypeID, Role: shot.Role, Label: shot.Label,
			AspectRatio: shot.AspectRatio, Headline: shot.Headline, Subline: shot.Subline, Direction: shot.Direction}
	}
	shots = RestoreDirections(shots)
	prompts := Prompts(brief, set.Summary, shots, len(set.InputKeys))
	model, err := s.model(ctx, tx, set.ModelID)
	if err != nil {
		return nil, err
	}
	if indexes == nil {
		for index := range shots {
			indexes = append(indexes, index)
		}
	}
	createdAt := s.now().Format(time.RFC3339)
	out := make([]taskInput, 0, len(indexes))
	for _, index := range indexes {
		shot := shots[index]
		prompt := prompts[index]
		inputKeys := set.InputKeys
		if edit, ok := edits[index]; ok {
			prompt, inputKeys = EditPrompt(shot, edit.note), []string{edit.base}
		}
		if note != "" {
			prompt += "\n" + note
		}
		params := map[string]any{
			"kindVariant": "listing", "viewId": shot.ID, "viewLabel": ViewLabel(shot), "count": 1,
			"publicModelKey": set.ModelID, "_kind": "ui-design-ecommerce-listing-generation",
			"batchId": set.ID.String(), "batchIndex": index, "batchSize": len(shots), "batchCreatedAt": createdAt,
		}
		// Like the workbench, an aspect ratio the model cannot make is left
		// to the model's default rather than failing the whole set.
		for _, ratio := range modelconfig.AspectRatiosForResolution(*model, "") {
			if ratio == shot.AspectRatio {
				params["aspectRatio"], params["requestedAspectRatio"] = ratio, ratio
			}
		}
		// Underscore params from callers are dropped as untrusted; the set
		// link is written by the server, so it goes in TrustedParams.
		create := taskflow.CreateInput{Type: TaskType, Prompt: prompt, Params: params, InputKeys: inputKeys, Count: 1,
			TrustedParams: map[string]any{SetParam: set.ID.String()}}
		quote, err := taskflow.QuoteTaskPrice(ctx, tx, create, set.UserID)
		if err != nil {
			return nil, err
		}
		unit := quote.UnitPriceCents
		create.ExpectedUnitPriceCents = &unit
		out = append(out, taskInput{shotIndex: index, create: create, price: quote.TotalPriceCents})
	}
	return out, nil
}

// GenerateInput selects what to generate and how it was approved.
type GenerateInput struct {
	// ShotIDs empty means every shot without an attempt yet.
	ShotIDs []string
	Via     string
	// ExpectedTotalCents is the price the user confirmed on the card.
	ExpectedTotalCents *int64
	// Note is appended to every prompt (redo instructions).
	Note string
	// Edit, when set, changes the shots' current images instead of
	// generating them again: each is edited with this instruction and keeps
	// its composition, copy and lighting. Empty ShotIDs means every shot.
	Edit string
	// EditAsOf picks each shot's image as of that time (zero = latest).
	EditAsOf time.Time
}

// GenerateResult reports what was started.
type GenerateResult struct {
	Set        *store.CommerceSet
	TaskIDs    []uuid.UUID
	TotalCents int64
}

// BudgetMessage explains an ErrNeedsConfirmation to the user.
func BudgetMessage(user *store.User, set *store.CommerceSet, total int64) string {
	if user == nil || !user.AssistantAutoApprove {
		return fmt.Sprintf("预计 %d 积分，需要你在卡片上确认后开始。", total)
	}
	return fmt.Sprintf("这次需要 %d 积分，加上已批准的 %d 积分会超过自动授权预算 %d 积分，需要你在卡片上确认。",
		total, set.ApprovedCents, user.AssistantAutoApproveBudgetCents)
}

// Generate creates the tasks for a set inside one transaction. Budget
// approvals are checked against the set's cumulative approved points while
// the set row is locked, so concurrent turns cannot overspend.
func (s Service) Generate(ctx context.Context, userID, setID uuid.UUID, in GenerateInput) (*GenerateResult, error) {
	var result *GenerateResult
	err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		set, err := store.LockUserCommerceSet(ctx, tx, userID, setID)
		if err != nil {
			return err
		}
		if set == nil {
			return apperr.E("not_found", "套图不存在", 404)
		}
		result, err = s.generateLocked(ctx, tx, set, in)
		return err
	})
	if err != nil {
		return result, err
	}
	s.enqueue(ctx, result.TaskIDs)
	return result, nil
}

func (s Service) enqueue(ctx context.Context, ids []uuid.UUID) {
	if s.Enqueue == nil {
		return
	}
	for _, id := range ids {
		if err := s.Enqueue(ctx, id.String()); err != nil {
			// The queued row is durable; recovery will enqueue it later.
			log.Printf("commerce set task %s enqueue deferred: %v", id, err)
		}
	}
}

func (s Service) generateLocked(ctx context.Context, tx pgx.Tx, set *store.CommerceSet, in GenerateInput) (*GenerateResult, error) {
	result := &GenerateResult{Set: set}
	if set.Status == store.CommerceSetCanceled {
		return result, invalid("这套图已取消")
	}
	in.Edit = truncate(strings.TrimSpace(in.Edit), 500)
	indexes := []int{}
	byID := map[string]int{}
	for index, shot := range set.Shots {
		byID[shot.ID] = index
	}
	if len(in.ShotIDs) == 0 && in.Edit != "" {
		for index := range set.Shots {
			indexes = append(indexes, index)
		}
	} else if len(in.ShotIDs) == 0 {
		for index, shot := range set.Shots {
			if len(shot.Attempts) == 0 {
				indexes = append(indexes, index)
			}
		}
		if len(indexes) == 0 {
			return result, invalid("这套图已经全部生成过了")
		}
	} else {
		tasks, err := s.allTasks(ctx, set)
		if err != nil {
			return result, err
		}
		seen := map[int]bool{}
		for _, id := range in.ShotIDs {
			index, ok := byID[strings.TrimSpace(id)]
			if !ok {
				return result, invalid("套图里没有这张：%s", id)
			}
			if seen[index] {
				continue
			}
			seen[index] = true
			if in.Edit == "" && generatedAttempts(set.Shots[index], tasks) >= maxAttemptsPerShot {
				return result, invalid("「%s」已经重做过 %d 次，可以点开图片继续修改", set.Shots[index].Label, maxAttemptsPerShot-1)
			}
			indexes = append(indexes, index)
		}
	}
	edits, err := s.editSpecs(ctx, set, indexes, in.Edit, in.EditAsOf)
	if err != nil {
		return result, err
	}
	inputs, err := s.taskInputs(ctx, tx, set, indexes, in.Note, edits)
	if err != nil {
		return result, err
	}
	for _, input := range inputs {
		result.TotalCents += input.price
	}
	switch in.Via {
	case store.CommerceApprovedByBudget:
		user, err := store.GetUserByID(ctx, tx, set.UserID)
		if err != nil {
			return result, err
		}
		if user == nil || !user.AssistantAutoApprove || set.ApprovedCents+result.TotalCents > user.AssistantAutoApproveBudgetCents {
			return result, fmt.Errorf("%w: %s", ErrNeedsConfirmation, BudgetMessage(user, set, result.TotalCents))
		}
	case store.CommerceApprovedByUser:
		// Dynamic pricing can move the price between the card and the click;
		// a lower price goes through, a higher one needs a new confirmation.
		if in.ExpectedTotalCents != nil && result.TotalCents > *in.ExpectedTotalCents {
			return result, fmt.Errorf("%w: 价格已更新为 %d 积分，请确认后再生成", ErrPriceChanged, result.TotalCents)
		}
	default:
		return result, invalid("缺少批准方式")
	}
	createdAt := s.now()
	for _, input := range inputs {
		shot := &set.Shots[input.shotIndex]
		// Discarded attempts used their numbers too; reusing one would hand
		// back the old task through the idempotency key.
		key := fmt.Sprintf("acs:%s:%s:%d", set.ID, shot.ID, len(shot.Attempts)+len(shot.Discarded)+1)
		input.create.IdempotencyKey = &key
		task, _, err := taskflow.CreateTaskInTx(ctx, tx, set.UserID, input.create, nil)
		if err != nil {
			return result, err
		}
		attempt := store.CommerceSetAttempt{TaskID: task.ID, Via: in.Via, PriceCents: input.price, Note: in.Note, CreatedAt: createdAt}
		if edit, ok := edits[input.shotIndex]; ok {
			attempt.BaseKey, attempt.EditNote = edit.base, edit.note
		}
		shot.Attempts = append(shot.Attempts, attempt)
		result.TaskIDs = append(result.TaskIDs, task.ID)
	}
	set.ApprovedCents += result.TotalCents
	set.Status = store.CommerceSetGenerating
	return result, store.SaveCommerceSet(ctx, tx, set)
}

// editSpec is the image a shot's next attempt edits and what to change.
type editSpec struct {
	base string
	note string
}

// editSpecs decides which shots are edited rather than generated afresh.
// With an edit instruction every chosen shot edits its current image. Without
// one, a shot whose latest attempt was an edit is redone as the same edit of
// the same image, so a redo never throws the user's change away.
func (s Service) editSpecs(ctx context.Context, set *store.CommerceSet, indexes []int, instruction string, asOf time.Time) (map[int]editSpec, error) {
	edits := map[int]editSpec{}
	if instruction == "" {
		for _, index := range indexes {
			if attempt := latest(set.Shots[index]); attempt != nil && attempt.BaseKey != "" {
				edits[index] = editSpec{base: attempt.BaseKey, note: attempt.EditNote}
			}
		}
		return edits, nil
	}
	tasks, err := s.allTasks(ctx, set)
	if err != nil {
		return nil, err
	}
	for _, index := range indexes {
		shot := set.Shots[index]
		key, _ := AttemptOutput(attemptAsOf(shot, asOf), tasks)
		if key == "" {
			return nil, invalid("「%s」还没有出好的图，不能在上面修改", shot.Label)
		}
		edits[index] = editSpec{base: key, note: instruction}
	}
	return edits, nil
}

// attemptAsOf is the shot's latest attempt made no later than asOf; a zero
// asOf means the latest one.
func attemptAsOf(shot store.CommerceSetShot, asOf time.Time) *store.CommerceSetAttempt {
	if asOf.IsZero() {
		return latest(shot)
	}
	for index := len(shot.Attempts) - 1; index >= 0; index-- {
		if !shot.Attempts[index].CreatedAt.After(asOf) {
			return &shot.Attempts[index]
		}
	}
	return nil
}

// EditPrompt asks for one change to a finished shot (image 1) and nothing
// else, so the edited set keeps the look the user already approved.
func EditPrompt(shot Shot, instruction string) string {
	lines := []string{
		"以图1为底图做局部修改，这是一张已经完成的电商图「" + shot.Label + "」。",
		"只做这一处修改：" + instruction,
		"除此之外必须与图1保持一致：构图、机位、商品的位置大小和角度、背景、光线、色调、道具、画面上的标题和文案文字及其排版、画幅比例都不变；不要重新设计画面，不要增删元素，不要改动文字内容。",
	}
	return strings.Join(lines, "\n")
}

// Rewind puts a conversation's sets back to how they were at a moment: the
// user resent an earlier message, so the replies after it are gone and so is
// what they did to the sets. Attempts made later are moved to Discarded
// (their points stay counted); sets planned later are canceled.
func (s Service) Rewind(ctx context.Context, tx pgx.Tx, userID, conversationID uuid.UUID, at time.Time) error {
	sets, err := store.LockConversationCommerceSets(ctx, tx, userID, conversationID)
	if err != nil {
		return err
	}
	for _, set := range sets {
		if set.Status == store.CommerceSetCanceled {
			continue
		}
		if set.CreatedAt.After(at) {
			set.Status = store.CommerceSetCanceled
			if err := store.SaveCommerceSet(ctx, tx, set); err != nil {
				return err
			}
			continue
		}
		changed := false
		for index := range set.Shots {
			shot := &set.Shots[index]
			kept := shot.Attempts[:0:0]
			for _, attempt := range shot.Attempts {
				if attempt.CreatedAt.After(at) {
					shot.Discarded = append(shot.Discarded, attempt)
					changed = true
					continue
				}
				kept = append(kept, attempt)
			}
			shot.Attempts = kept
		}
		if !changed {
			continue
		}
		set.Status = rewoundStatus(set)
		if err := store.SaveCommerceSet(ctx, tx, set); err != nil {
			return err
		}
	}
	return nil
}

// rewoundStatus is a set's status from its remaining attempts.
func rewoundStatus(set *store.CommerceSet) string {
	started, checked := false, true
	for _, shot := range set.Shots {
		attempt := latest(shot)
		if attempt == nil {
			checked = false
			continue
		}
		started = true
		if attempt.Review == nil {
			checked = false
		}
	}
	switch {
	case !started:
		return store.CommerceSetPlanned
	case checked:
		return store.CommerceSetDone
	default:
		return store.CommerceSetGenerating
	}
}
