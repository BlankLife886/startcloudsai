package commerceset

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// Checker looks at one finished image next to the product references and
// answers in JSON (see ReviewPrompt). The caller attaches the images.
type Checker func(ctx context.Context, prompt string, outputKey string, referenceKeys []string) (string, error)

// ReviewPrompt asks a vision model whether an image does its job. The
// first attached image is the generated one; the rest are the product.
func ReviewPrompt(shot store.CommerceSetShot, language string) string {
	copyLine := "这张图不要求文字。"
	if shot.Headline != "" {
		copyLine = "这张图应带标题「" + shot.Headline + "」"
		if shot.Subline != "" {
			copyLine += "和副文案「" + shot.Subline + "」"
		}
		copyLine += "（" + fallback(language, "简体中文") + "）。若画面没有文字或文字留白，不算问题；若有文字，必须正确可读、没有乱码或错别字。"
	}
	return `你是电商图片质检。第 1 张图是刚生成的电商图，其余是原始商品参考图。请判断第 1 张能否直接交付：
本张职责：` + shot.Label + `。` + shot.Direction + `
` + copyLine + `
逐项检查：
1. 商品与参考图是同一件：造型、比例、颜色、Logo、包装文字、关键部件一致，没有被换成相似商品、没有多出或缺少部件。
2. 完成了本张职责（例如白底图是干净白底、场景图有对应场景、卖点图有信息区）。
3. 没有明显瑕疵：畸形的手或人体、重复商品、残缺边缘、水印、无关品牌。
只有明显影响交付的问题才算不通过，审美偏好不算。
只返回 JSON，不要解释：{"pass":true,"issues":[]}，issues 用简短中文写每个问题（最多 3 条）。`
}

func decodeReview(raw string) (store.CommerceSetReview, error) {
	text := strings.TrimSpace(raw)
	start, end := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return store.CommerceSetReview{}, errors.New("review reply has no JSON object")
	}
	var reply struct {
		Pass   *bool    `json:"pass"`
		Issues []string `json:"issues"`
	}
	if err := json.Unmarshal([]byte(text[start:end+1]), &reply); err != nil {
		return store.CommerceSetReview{}, err
	}
	if reply.Pass == nil {
		return store.CommerceSetReview{}, errors.New("review reply has no verdict")
	}
	review := store.CommerceSetReview{Pass: *reply.Pass}
	for _, issue := range reply.Issues {
		if issue = truncate(issue, 60); issue != "" && len(review.Issues) < 3 {
			review.Issues = append(review.Issues, issue)
		}
	}
	if !review.Pass && len(review.Issues) == 0 {
		review.Issues = []string{"检查未通过"}
	}
	return review, nil
}

// RedoNote turns a failed review into instructions for the next attempt.
func RedoNote(review *store.CommerceSetReview, userNote string) string {
	parts := []string{}
	if review != nil && !review.Pass && len(review.Issues) > 0 {
		parts = append(parts, "上一版检查发现的问题："+strings.Join(review.Issues, "；")+"。本次必须修正这些问题，其余要求不变。")
	}
	if userNote = truncate(userNote, 200); userNote != "" {
		parts = append(parts, "用户对本次重做的要求："+userNote+"。")
	}
	return strings.Join(parts, "\n")
}

// ReviewResult reports what a review pass did.
type ReviewResult struct {
	Set       *store.CommerceSet
	Reviewed  int
	Failed    []string
	AutoRedo  []string
	RedoError string
}

func latest(shot store.CommerceSetShot) *store.CommerceSetAttempt {
	if len(shot.Attempts) == 0 {
		return nil
	}
	return &shot.Attempts[len(shot.Attempts)-1]
}

func terminal(status string) bool {
	switch status {
	case "succeeded", "failed", "canceled", "cancelled":
		return true
	}
	return false
}

// Review checks every finished, unchecked image. The model calls happen
// outside the transaction; results are written only for attempts that are
// still unchecked, so overlapping calls never double-count. When the user
// has auto-approval on, failed shots are redone once within the budget.
func (s Service) Review(ctx context.Context, userID, setID uuid.UUID, check Checker) (*ReviewResult, error) {
	set, err := store.GetUserCommerceSet(ctx, s.St.Pool, userID, setID)
	if err != nil || set == nil {
		if set == nil && err == nil {
			err = errors.New("commerce set not found")
		}
		return nil, err
	}
	var brief Brief
	_ = json.Unmarshal(set.Brief, &brief)
	tasks, err := s.latestTasks(ctx, set)
	if err != nil {
		return nil, err
	}
	// Checks run in parallel (bounded): a full set of 18 would otherwise
	// take minutes of sequential vision calls.
	type job struct {
		shot   store.CommerceSetShot
		taskID uuid.UUID
		task   *store.Task
	}
	jobs := []job{}
	for _, shot := range set.Shots {
		attempt := latest(shot)
		if attempt == nil || attempt.Review != nil {
			continue
		}
		task := tasks[attempt.TaskID]
		if task == nil || !terminal(task.Status) {
			continue
		}
		jobs = append(jobs, job{shot: shot, taskID: attempt.TaskID, task: task})
	}
	reviews := make([]store.CommerceSetReview, len(jobs))
	slots := make(chan struct{}, reviewConcurrency)
	var wait sync.WaitGroup
	for index, item := range jobs {
		wait.Add(1)
		go func(index int, item job) {
			defer wait.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			reviews[index] = s.reviewOne(ctx, set, brief, item.shot, item.task, check)
		}(index, item)
	}
	wait.Wait()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	byTask := map[uuid.UUID]store.CommerceSetReview{}
	for index, item := range jobs {
		byTask[item.taskID] = reviews[index]
	}
	result := &ReviewResult{}
	var pending []uuid.UUID
	err = s.St.Tx(ctx, func(tx pgx.Tx) error {
		locked, err := store.LockUserCommerceSet(ctx, tx, userID, setID)
		if err != nil {
			return err
		}
		set = locked
		redo := []string{}
		for index := range set.Shots {
			attempt := latest(set.Shots[index])
			if attempt == nil || attempt.Review != nil {
				continue
			}
			review, ok := byTask[attempt.TaskID]
			if !ok {
				continue
			}
			attempt.Review = &review
			result.Reviewed++
			if !review.Pass && !review.Skipped {
				result.Failed = append(result.Failed, set.Shots[index].ID)
				if len(set.Shots[index].Attempts) < autoRedoAttempts {
					redo = append(redo, set.Shots[index].ID)
				}
			}
		}
		if err := store.SaveCommerceSet(ctx, tx, set); err != nil {
			return err
		}
		if len(redo) == 0 {
			return nil
		}
		// Automatic redos spend without asking, so they only happen for users
		// who turned auto-approval on; everyone else redoes from the card.
		user, err := store.GetUserByID(ctx, tx, userID)
		if err != nil {
			return err
		}
		if user == nil || !user.AssistantAutoApprove {
			return nil
		}
		// Each redo carries its own shot's issues, so they go one by one;
		// the first that does not fit the budget stops the rest.
		for _, id := range redo {
			var shot store.CommerceSetShot
			for _, candidate := range set.Shots {
				if candidate.ID == id {
					shot = candidate
				}
			}
			generated, genErr := s.redoInTx(ctx, tx, set, id, RedoNote(latest(shot).Review, ""))
			if genErr != nil {
				if errors.Is(genErr, ErrNeedsConfirmation) {
					result.RedoError = strings.TrimPrefix(genErr.Error(), ErrNeedsConfirmation.Error()+": ")
					return nil
				}
				return genErr
			}
			result.AutoRedo = append(result.AutoRedo, id)
			set = generated.Set
			pending = append(pending, generated.TaskIDs...)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.enqueue(ctx, pending)
	if err := s.settleStatus(ctx, userID, setID); err != nil {
		return nil, err
	}
	result.Set, err = store.GetUserCommerceSet(ctx, s.St.Pool, userID, setID)
	return result, err
}

// reviewConcurrency bounds parallel vision checks per set.
const reviewConcurrency = 4

func (s Service) reviewOne(ctx context.Context, set *store.CommerceSet, brief Brief, shot store.CommerceSetShot, task *store.Task, check Checker) store.CommerceSetReview {
	review := store.CommerceSetReview{CheckedAt: s.now(), Skipped: true}
	if task.Status != "succeeded" {
		// A failed task needs a redo just like a failed check.
		return store.CommerceSetReview{CheckedAt: review.CheckedAt, Issues: []string{"生成失败"}}
	}
	if len(task.OutputKeys) == 0 || check == nil {
		return review
	}
	reply, err := check(ctx, ReviewPrompt(shot, brief.Language), task.OutputKeys[0], set.InputKeys)
	if err == nil {
		var decoded store.CommerceSetReview
		if decoded, err = decodeReview(reply); err == nil {
			decoded.CheckedAt = review.CheckedAt
			return decoded
		}
	}
	if ctx.Err() == nil {
		log.Printf("commerce set %s shot %s review failed: %v", set.ID, shot.ID, err)
	}
	return review
}

func (s Service) redoInTx(ctx context.Context, tx pgx.Tx, set *store.CommerceSet, shotID, note string) (*GenerateResult, error) {
	// A savepoint keeps a refused redo from rolling back the reviews.
	nested, err := tx.Begin(ctx)
	if err != nil {
		return nil, err
	}
	result, err := s.generateLocked(ctx, nested, set, GenerateInput{ShotIDs: []string{shotID}, Via: store.CommerceApprovedByBudget, Note: note})
	if err != nil {
		_ = nested.Rollback(ctx)
		return nil, err
	}
	return result, nested.Commit(ctx)
}

func (s Service) latestTasks(ctx context.Context, set *store.CommerceSet) (map[uuid.UUID]*store.Task, error) {
	ids := []uuid.UUID{}
	for _, shot := range set.Shots {
		if attempt := latest(shot); attempt != nil {
			ids = append(ids, attempt.TaskID)
		}
	}
	if len(ids) == 0 {
		return map[uuid.UUID]*store.Task{}, nil
	}
	return store.GetTasksByIDs(ctx, s.St.Pool, ids)
}

// settleStatus marks a generating set done once every shot's latest attempt
// is finished and checked.
func (s Service) settleStatus(ctx context.Context, userID, setID uuid.UUID) error {
	return s.St.Tx(ctx, func(tx pgx.Tx) error {
		set, err := store.LockUserCommerceSet(ctx, tx, userID, setID)
		if err != nil || set == nil || set.Status != store.CommerceSetGenerating {
			return err
		}
		for _, shot := range set.Shots {
			attempt := latest(shot)
			if attempt == nil || attempt.Review == nil {
				return nil
			}
		}
		set.Status = store.CommerceSetDone
		return store.SaveCommerceSet(ctx, tx, set)
	})
}

// Redo regenerates chosen shots after the user confirmed on the card.
func (s Service) Redo(ctx context.Context, userID, setID uuid.UUID, shotIDs []string, userNote string, expected *int64) (*GenerateResult, error) {
	var result *GenerateResult
	err := s.St.Tx(ctx, func(tx pgx.Tx) error {
		set, err := store.LockUserCommerceSet(ctx, tx, userID, setID)
		if err != nil {
			return err
		}
		if set == nil {
			return fmt.Errorf("commerce set not found")
		}
		note := ""
		for _, shot := range set.Shots {
			for _, id := range shotIDs {
				if shot.ID == id {
					if attempt := latest(shot); attempt != nil && note == "" && len(shotIDs) == 1 {
						note = RedoNote(attempt.Review, userNote)
					}
				}
			}
		}
		if note == "" {
			note = RedoNote(nil, userNote)
		}
		result, err = s.generateLocked(ctx, tx, set, GenerateInput{ShotIDs: shotIDs, Via: store.CommerceApprovedByUser, ExpectedTotalCents: expected, Note: note})
		return err
	})
	if err != nil {
		return result, err
	}
	s.enqueue(ctx, result.TaskIDs)
	return result, nil
}
