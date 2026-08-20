package httpapi

import (
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestTaskDictIncludesRecordedModel(t *testing.T) {
	task := &store.Task{ID: uuid.New(), Type: "t2i", Model: "gpt-image-2"}
	dict := taskDict(task, nil, nil)
	if got := dict["model"]; got != "gpt-image-2" {
		t.Fatalf("model = %v, want gpt-image-2", got)
	}
}

func TestAttachShareSubmission(t *testing.T) {
	empty := attachShareSubmission(gin.H{}, nil)
	if empty["shareSubmitted"] != false || empty["shareSubmissionStatus"] != "" {
		t.Fatalf("empty share = %#v", empty)
	}
	submitted := attachShareSubmission(gin.H{}, &store.GallerySubmission{Status: "pending"})
	if submitted["shareSubmitted"] != true || submitted["shareSubmissionStatus"] != "pending" {
		t.Fatalf("pending share = %#v", submitted)
	}
}

func TestAttachSubmissionTaskMarksCanvasOrigin(t *testing.T) {
	d := gin.H{}
	attachSubmissionTask(d, &store.Task{
		Type:   "t2i",
		Prompt: "canvas prompt",
		Model:  "gpt-image-2",
		Params: map[string]any{"_source": "react_canvas", "aspectRatio": "16:9"},
	})
	if d["taskType"] != "t2i" {
		t.Fatalf("taskType = %#v, canvas jobs stay t2i", d["taskType"])
	}
	if d["source"] != store.CanvasTaskSource || d["displayName"] != "无限画布" {
		t.Fatalf("canvas origin = %#v", d)
	}
	if d["prompt"] != "canvas prompt" || d["aspectRatio"] != "16:9" {
		t.Fatalf("canvas prompt/aspect = %#v", d)
	}
	plain := gin.H{}
	attachSubmissionTask(plain, &store.Task{Type: "t2i", Prompt: "studio prompt"})
	if plain["source"] != nil || plain["displayName"] != nil || plain["taskType"] != "t2i" {
		t.Fatalf("plain t2i = %#v", plain)
	}
}

func TestTaskDictIncludesUserDeletionMarker(t *testing.T) {
	deletedAt := time.Date(2026, 8, 11, 9, 30, 0, 0, time.UTC)
	actor := "user"
	task := &store.Task{
		ID: uuid.New(), DeletedAt: &deletedAt, DeletionActor: &actor, DeletedOutputCount: 2,
	}
	dict := taskDict(task, nil, nil)
	if dict["deletedAt"] == nil || dict["deletionActor"] != actor || dict["deletedOutputCount"] != 2 {
		t.Fatalf("deletion marker not serialized: %#v", dict)
	}
}

func TestAdminTaskDictIncludesActualServiceProvider(t *testing.T) {
	tests := []struct {
		name     string
		task     *store.Task
		provider string
	}{
		{name: "configured task", task: &store.Task{ID: uuid.New(), Type: "t2i", Params: map[string]any{"_serviceProvider": "sub2api"}}, provider: "sub2api"},
		{name: "legacy task", task: &store.Task{ID: uuid.New(), Type: "t2i"}, provider: "c2a"},
		{name: "local puzzle", task: &store.Task{ID: uuid.New(), Type: "puzzle"}, provider: "local"},
		{name: "assistant image", task: &store.Task{ID: uuid.New(), Type: "assistant", Params: map[string]any{"resolvedMode": "image", "_serviceProvider": "c2a"}}, provider: "c2a"},
		{name: "CRUN task", task: &store.Task{ID: uuid.New(), Type: "ui_design", Params: map[string]any{"_serviceProvider": "crun"}}, provider: "crun"},
		{name: "assistant chat", task: &store.Task{ID: uuid.New(), Type: "assistant", Params: map[string]any{"resolvedMode": "chat", "_serviceProvider": "c2a"}}, provider: "sub2api"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			dict := adminTaskDict(test.task, nil)
			if got := dict["serviceProvider"]; got != test.provider {
				t.Fatalf("serviceProvider = %v, want %s", got, test.provider)
			}
		})
	}
}

func TestAdminTaskDictSeparatesCanvasAssistantSource(t *testing.T) {
	task := &store.Task{
		ID: uuid.New(), Type: "assistant",
		Params: map[string]any{"workspace": "infinite_canvas", "_source": "react_canvas"},
	}
	dict := adminTaskDict(task, nil)
	if dict["source"] != "infinite_canvas" {
		t.Fatalf("canvas assistant source = %#v", dict)
	}
}

func TestUserDictIncludesProfileDetails(t *testing.T) {
	user := &store.User{
		ID:                 uuid.New(),
		Username:           "星云画师",
		Bio:                "专注角色与场景设计",
		Location:           "上海",
		WebsiteURL:         "https://example.com/portfolio",
		RequireCostConfirm: true,
	}
	dict := userDict(user)
	if dict["bio"] != user.Bio || dict["location"] != user.Location || dict["websiteUrl"] != user.WebsiteURL {
		t.Fatalf("profile details not serialized: %#v", dict)
	}
	if dict["requireCostConfirm"] != true {
		t.Fatalf("requireCostConfirm = %v, want true", dict["requireCostConfirm"])
	}
	if _, ok := dict["studioFigureUrl"]; !ok {
		t.Fatalf("studioFigureUrl missing: %#v", dict)
	}
}

func TestWalletDictUsesSingleAvailableBalanceDefinition(t *testing.T) {
	dict := walletDict(&store.Wallet{
		BalanceCents: 80, TrialBalanceCents: 20,
		FrozenCents: 15, TrialFrozenCents: 5,
	})
	if dict["availableCents"] != int64(100) || dict["balanceCents"] != int64(100) {
		t.Fatalf("available balance = %#v", dict)
	}
	if dict["frozenCents"] != int64(20) || dict["totalCents"] != int64(120) {
		t.Fatalf("wallet totals = %#v", dict)
	}
}

func TestLedgerDictWithTaskIncludesUserFacingTaskDetails(t *testing.T) {
	taskID := uuid.New()
	entry := &store.LedgerEntry{
		ID:                uuid.New(),
		Kind:              "freeze",
		DeltaCents:        -10,
		BalanceAfterCents: 90,
		SourceType:        "task",
		CreatedAt:         time.Now(),
	}
	task := &store.Task{
		ID:        taskID,
		Type:      "background_remove",
		Status:    "succeeded",
		Model:     "internal-upstream-name",
		Count:     1,
		CostCents: 10,
		Params: map[string]any{
			"_modelDisplayName": "背景移除",
			"_automatic":        true,
		},
	}
	dict := ledgerDictWithTask(entry, task)
	taskDict, ok := dict["task"].(gin.H)
	if !ok {
		t.Fatalf("task details missing: %#v", dict)
	}
	if taskDict["modelName"] != "背景移除" || taskDict["automaticBackgroundRemove"] != true || taskDict["settledCostPoints"] != int64(10) {
		t.Fatalf("unexpected task details: %#v", taskDict)
	}
	if taskDict["displayName"] != "背景移除" {
		t.Fatalf("displayName = %#v", taskDict["displayName"])
	}
}

func TestLedgerDictWithTaskUsesCanvasDisplayName(t *testing.T) {
	entry := &store.LedgerEntry{
		ID:                uuid.New(),
		Kind:              "spend",
		DeltaCents:        0,
		BalanceAfterCents: 90,
		SourceType:        "task",
		CreatedAt:         time.Now(),
	}
	task := &store.Task{
		ID:     uuid.New(),
		Type:   "t2i",
		Status: "succeeded",
		Model:  "gpt-image-2",
		Count:  1,
		Params: map[string]any{"_source": "react_canvas"},
	}
	dict := ledgerDictWithTask(entry, task)
	taskDict, ok := dict["task"].(gin.H)
	if !ok {
		t.Fatalf("task details missing: %#v", dict)
	}
	if taskDict["displayName"] != "无限画布" || taskDict["source"] != "react_canvas" {
		t.Fatalf("canvas ledger task = %#v", taskDict)
	}
}

func TestLedgerDictWithAssistantRunUsesCanvasDisplayName(t *testing.T) {
	reason := "AI 助手结算（chat）"
	entry := &store.LedgerEntry{
		ID: uuid.New(), Kind: "spend", SourceType: "assistant_run", Reason: &reason, CreatedAt: time.Now(),
	}
	run := &store.AssistantRun{
		ID: uuid.New(), Status: "succeeded",
		Params: map[string]any{"workspace": "infinite_canvas", "_source": "react_canvas"},
	}
	dict := ledgerDictWithAssistantRun(entry, run)
	taskDict, ok := dict["task"].(gin.H)
	if !ok || taskDict["displayName"] != "无限画布" || taskDict["source"] != "infinite_canvas" {
		t.Fatalf("canvas assistant ledger task = %#v", dict["task"])
	}
	got, _ := dict["reason"].(*string)
	if got == nil || *got != "无限画布结算（chat）" {
		t.Fatalf("canvas assistant ledger reason = %#v", dict["reason"])
	}
}

func TestLedgerDictWithTaskRewritesCanvasFreezeReason(t *testing.T) {
	reason := "任务冻结（t2i×1）"
	entry := &store.LedgerEntry{
		ID: uuid.New(), Kind: "freeze", SourceType: "task", Reason: &reason, CreatedAt: time.Now(),
	}
	task := &store.Task{
		ID: uuid.New(), Type: "t2i", Status: "running", Params: map[string]any{"_source": "react_canvas"},
	}
	dict := ledgerDictWithTask(entry, task)
	got, _ := dict["reason"].(*string)
	if got == nil || *got != "无限画布冻结" {
		t.Fatalf("canvas task ledger reason = %#v", dict["reason"])
	}
}

func TestLedgerDictWithTaskStripsInternalTypeCode(t *testing.T) {
	reason := "任务冻结（t2i×1）"
	entry := &store.LedgerEntry{
		ID: uuid.New(), Kind: "freeze", SourceType: "task", Reason: &reason, CreatedAt: time.Now(),
	}
	task := &store.Task{
		ID: uuid.New(), Type: "t2i", Status: "running",
	}
	dict := ledgerDictWithTask(entry, task)
	got, _ := dict["reason"].(*string)
	if got == nil || *got != "任务冻结" {
		t.Fatalf("task ledger reason = %#v", dict["reason"])
	}
}

func TestThumbURLsForTaskPrefersStoredThumbsAndDerivesWhenMissing(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	taskID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	original := "tasks/" + userID.String() + "/" + taskID.String() + "/original/0.png"
	storedThumb := "tasks/" + userID.String() + "/" + taskID.String() + "/thumb/0"
	prefix := "/api/v1/admin/files/"

	stored := thumbURLsForTask(&store.Task{OutputKeys: []string{original}, ThumbnailKeys: []string{storedThumb}}, prefix)
	if len(stored) != 1 || stored[0] != prefix+storedThumb {
		t.Fatalf("stored thumbs = %#v", stored)
	}

	derived := thumbURLsForTask(&store.Task{OutputKeys: []string{original}}, prefix)
	if len(derived) != 1 || derived[0] != prefix+"tasks/"+userID.String()+"/"+taskID.String()+"/thumb/0" {
		t.Fatalf("derived thumbs = %#v", derived)
	}

	copiedOriginals := thumbURLsForTask(&store.Task{OutputKeys: []string{original}, ThumbnailKeys: []string{original}}, prefix)
	if len(copiedOriginals) != 1 || copiedOriginals[0] != prefix+"tasks/"+userID.String()+"/"+taskID.String()+"/thumb/0" {
		t.Fatalf("copied original thumbs = %#v, want derived thumb", copiedOriginals)
	}

	assistantOriginal := "tasks/" + userID.String() + "/assistant/" + taskID.String() + "/1.png"
	assistant := thumbURLsForTask(&store.Task{OutputKeys: []string{assistantOriginal}}, prefix)
	if len(assistant) != 1 || assistant[0] != prefix+"tasks/"+userID.String()+"/assistant/"+taskID.String()+"/1-thumb" {
		t.Fatalf("assistant thumbs = %#v", assistant)
	}
}
