package assistanttools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/testdb"
)

func TestTaskStatusRequestedOnlyMatchesStatusQuestions(t *testing.T) {
	positive := []string{
		"我的任务为什么还在运行中？",
		"查询我最近失败的任务，告诉我失败原因、重试次数和是否退款。",
		"刚才那张图失败后有重试吗",
		"生图取消后积分退款了吗",
	}
	for _, prompt := range positive {
		if !TaskStatusRequested(prompt) {
			t.Fatalf("expected task status intent for %q", prompt)
		}
	}
	for _, prompt := range []string{"帮我生成一张图片", "任务系统是什么", "解释一下图片模型"} {
		if TaskStatusRequested(prompt) {
			t.Fatalf("unexpected task status intent for %q", prompt)
		}
	}
}

func TestTaskStatusReturnsOwnedFailureAndRedactsInternals(t *testing.T) {
	ctx := context.Background()
	st := testdb.Setup(t)
	user, err := store.InsertUser(ctx, st.Pool, "task-status-"+uuid.NewString()+"@test.dev", "task-user", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}
	other, err := store.InsertUser(ctx, st.Pool, "task-status-other-"+uuid.NewString()+"@test.dev", "other", "x", "user", nil)
	if err != nil {
		t.Fatal(err)
	}

	privateID := uuid.New()
	task, err := store.InsertTask(ctx, st.Pool, store.NewTask{
		ID: uuid.New(), UserID: user.ID, Type: "t2i", Model: "gpt-image-2",
		Prompt: "生成产品主图", Params: map[string]any{"_generationStage": "upstream_generating"},
		Count: 2, CostCents: 25, WorkUnits: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	started := time.Now().UTC().Add(-45 * time.Second)
	finished := started.Add(30 * time.Second)
	errorMessage := "上游拒绝了请求 route=https://provider.example/v1 task=" + privateID.String() + " token=sk-secretvalue123456789"
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status='failed', attempt=2, started_at=$2, finished_at=$3, error_code='upstream_error', error_message=$4 WHERE id=$1`,
		task.ID, started, finished, errorMessage); err != nil {
		t.Fatal(err)
	}
	if err := store.AppendTaskTimelineEvent(ctx, st.Pool, task.ID, "upstream_error", "error",
		"线路 https://provider.example/internal 返回失败 "+privateID.String(), 1200, nil); err != nil {
		t.Fatal(err)
	}
	reason := "任务失败解冻"
	if _, err := store.InsertLedgerEntry(ctx, st.Pool, user.ID, "release", 25, 100, "task", stringPointer(task.ID.String()), &reason, "normal"); err != nil {
		t.Fatal(err)
	}
	foreign, err := store.InsertTask(ctx, st.Pool, store.NewTask{
		ID: uuid.New(), UserID: other.ID, Type: "t2i", Model: "secret-model",
		Prompt: "other user's private task", Count: 1, CostCents: 99, WorkUnits: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE tasks SET status='failed', error_message='foreign private failure' WHERE id=$1`, foreign.ID); err != nil {
		t.Fatal(err)
	}

	registry, err := NewRegistry(NewTaskStatusManifest(st.Pool))
	if err != nil {
		t.Fatal(err)
	}
	arguments := json.RawMessage(`{"scope":"failed","limit":5,"task_id":""}`)
	if _, err := registry.Execute(ctx, ToolTaskStatus, Invocation{UserID: user.ID, Arguments: arguments}); err == nil {
		t.Fatal("task_status must require tasks.read")
	}
	result, err := registry.Execute(ctx, ToolTaskStatus, Invocation{
		UserID: user.ID, Arguments: arguments,
		Permissions: map[Permission]bool{PermissionTasksRead: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{task.ID.String(), privateID.String(), "provider.example", "sk-secret", "foreign private failure", foreign.ID.String()} {
		if strings.Contains(result.Content, forbidden) {
			t.Fatalf("task status leaked %q: %s", forbidden, result.Content)
		}
	}
	for _, expected := range []string{"上游拒绝了请求", "已退款或解冻 25 积分", `"retry_count":2`, `"task_number":1`} {
		if !strings.Contains(result.Content, expected) {
			t.Fatalf("task status missing %q: %s", expected, result.Content)
		}
	}

	foreignArguments, _ := json.Marshal(taskStatusInput{Scope: "latest", Limit: 1, TaskID: foreign.ID.String()})
	if _, err := registry.Execute(ctx, ToolTaskStatus, Invocation{
		UserID: user.ID, Arguments: foreignArguments,
		Permissions: map[Permission]bool{PermissionTasksRead: true},
	}); err == nil || !strings.Contains(err.Error(), "当前用户") {
		t.Fatalf("foreign lookup error = %v", err)
	}
}

func TestDefaultGeneralSkillIncludesTaskStatus(t *testing.T) {
	st := testdb.Setup(t)
	tools, skills, err := NewDefaultRegistries(st)
	if err != nil {
		t.Fatal(err)
	}
	if !tools.Has(ToolTaskStatus) {
		t.Fatal("default registry does not include task_status")
	}
	skill, err := skills.Resolve(SkillGeneral, false)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, name := range skill.AllowedTools {
		found = found || name == ToolTaskStatus
	}
	if !found {
		t.Fatalf("general tools = %#v", skill.AllowedTools)
	}
}

func stringPointer(value string) *string { return &value }
