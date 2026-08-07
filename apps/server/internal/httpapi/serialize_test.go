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
}
