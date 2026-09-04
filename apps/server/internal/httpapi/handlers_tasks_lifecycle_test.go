package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func insertUIDesignHistoryMirror(t *testing.T, env *communityEnv, userID uuid.UUID) (*store.Task, string) {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC()
	outputKey := "tasks/" + userID.String() + "/assistant/" + uuid.NewString() + "/1.png"
	conversation, err := store.InsertAssistantConversationWithWorkspace(
		ctx, env.st.Pool, uuid.New(), userID, "框选优化", "ui_design", now,
	)
	if err != nil {
		t.Fatalf("insert ui design conversation: %v", err)
	}
	userMessage, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Content: "优化选区",
		Kind: "text", Status: "complete", CreatedAt: now,
	})
	if err != nil {
		t.Fatalf("insert ui design user message: %v", err)
	}
	assistantMessage, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Kind: "image",
		Status: "complete", Metadata: map[string]any{
			"images": []map[string]any{{"fileKey": outputKey}},
		},
		CreatedAt: now.Add(time.Millisecond),
	})
	if err != nil {
		t.Fatalf("insert ui design assistant message: %v", err)
	}
	run, err := store.InsertAssistantRun(ctx, env.st.Pool, store.AssistantRun{
		ID: uuid.New(), UserID: userID, ConversationID: conversation.ID,
		UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID,
		Mode: "image", Prompt: "优化选区", Params: map[string]any{
			"serviceKey": "ui_design_asset",
		},
	})
	if err != nil {
		t.Fatalf("insert ui design run: %v", err)
	}
	run.Status = "succeeded"
	run.FinishedAt = &now
	task, _, err := store.SyncUIDesignAssetHistoryFromRun(ctx, env.st.Pool, run, []string{outputKey})
	if err != nil || task == nil {
		t.Fatalf("sync ui design history mirror: task=%#v err=%v", task, err)
	}
	return task, outputKey
}

func TestDeleteTaskOutputRemovesOneImageFromABatch(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	first := "tasks/" + user.ID.String() + "/a.png"
	second := "tasks/" + user.ID.String() + "/b.png"
	third := "tasks/" + user.ID.String() + "/c.png"

	var taskID uuid.UUID
	if err := env.st.Pool.QueryRow(context.Background(), `
		INSERT INTO tasks (user_id, type, prompt, status, input_keys, output_keys, thumbnail_keys, count, cost_cents)
		VALUES ($1, 't2i', 'batch', 'succeeded', '[]'::jsonb,
			jsonb_build_array($2::text, $3::text, $4::text),
			jsonb_build_array($2::text, $3::text, $4::text),
			3, 0)
		RETURNING id`, user.ID, first, second, third).Scan(&taskID); err != nil {
		t.Fatalf("insert batch task: %v", err)
	}

	w := env.do(t, http.MethodDelete, "/api/v1/tasks/"+taskID.String()+"/outputs/1", nil, token)
	data, code := decode(t, w)
	if w.Code != http.StatusOK || code != "" {
		t.Fatalf("delete one output: status %d code %s body %s", w.Code, code, w.Body.String())
	}
	originals, _ := data["originalUrls"].([]any)
	if len(originals) != 2 {
		t.Fatalf("originalUrls = %#v, want 2 remaining images", originals)
	}
	if count, _ := data["count"].(float64); count != 2 {
		t.Fatalf("count = %#v, want 2", data["count"])
	}

	var remaining int
	if err := env.st.Pool.QueryRow(context.Background(),
		`SELECT jsonb_array_length(output_keys) FROM tasks WHERE id = $1 AND deleted_at IS NULL`,
		taskID).Scan(&remaining); err != nil {
		t.Fatalf("read remaining outputs: %v", err)
	}
	if remaining != 2 {
		t.Fatalf("remaining outputs = %d, want 2", remaining)
	}
	var cleanupJobs int
	if err := env.st.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM object_cleanup_jobs WHERE object_key = $1`, second).Scan(&cleanupJobs); err != nil {
		t.Fatalf("count deferred cleanup jobs: %v", err)
	}
	if cleanupJobs != 1 {
		t.Fatalf("deferred cleanup jobs = %d, want 1", cleanupJobs)
	}
}

func TestDeleteTaskProtectsReferencedOutputs(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	parentKey := "tasks/" + user.ID.String() + "/parent.png"
	childKey := "tasks/" + user.ID.String() + "/child.png"

	var parentID uuid.UUID
	if err := env.st.Pool.QueryRow(context.Background(), `
		INSERT INTO tasks (user_id, type, prompt, status, input_keys, output_keys, cost_cents)
		VALUES ($1, 't2i', 'parent', 'succeeded', '[]'::jsonb, jsonb_build_array($2::text), 0)
		RETURNING id`, user.ID, parentKey).Scan(&parentID); err != nil {
		t.Fatalf("insert parent task: %v", err)
	}
	if _, err := env.st.Pool.Exec(context.Background(), `
		INSERT INTO tasks (user_id, type, prompt, status, input_keys, output_keys, cost_cents)
		VALUES ($1, 't2i', 'child', 'succeeded', jsonb_build_array($2::text), jsonb_build_array($3::text), 0)`,
		user.ID, parentKey, childKey); err != nil {
		t.Fatalf("insert child task: %v", err)
	}

	w := env.do(t, http.MethodDelete, "/api/v1/tasks/"+parentID.String(), nil, token)
	if _, code := decode(t, w); w.Code != http.StatusConflict || code != "task_in_use" {
		t.Fatalf("delete referenced parent: status %d code %s body %s", w.Code, code, w.Body.String())
	}

	var exists bool
	if err := env.st.Pool.QueryRow(context.Background(),
		`SELECT EXISTS (SELECT 1 FROM tasks WHERE id = $1)`, parentID).Scan(&exists); err != nil {
		t.Fatalf("check parent task: %v", err)
	}
	if !exists {
		t.Fatal("referenced parent task was deleted")
	}
}

func TestDeleteTaskCascadeMarksDependentTaskChainAsUserDeleted(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	parentKey := "tasks/" + user.ID.String() + "/parent.png"
	childKey := "tasks/" + user.ID.String() + "/child.png"
	grandchildKey := "tasks/" + user.ID.String() + "/grandchild.png"

	var parentID, childID, grandchildID uuid.UUID
	if err := env.st.Pool.QueryRow(context.Background(), `
		INSERT INTO tasks (user_id, type, prompt, status, input_keys, output_keys, cost_cents)
		VALUES ($1, 't2i', 'parent', 'succeeded', '[]'::jsonb, jsonb_build_array($2::text), 0)
		RETURNING id`, user.ID, parentKey).Scan(&parentID); err != nil {
		t.Fatalf("insert parent task: %v", err)
	}
	if err := env.st.Pool.QueryRow(context.Background(), `
		INSERT INTO tasks (user_id, type, prompt, status, input_keys, output_keys, cost_cents)
		VALUES ($1, 't2i', 'child', 'succeeded', jsonb_build_array($2::text), jsonb_build_array($3::text), 0)
		RETURNING id`, user.ID, parentKey, childKey).Scan(&childID); err != nil {
		t.Fatalf("insert child task: %v", err)
	}
	if err := env.st.Pool.QueryRow(context.Background(), `
		INSERT INTO tasks (user_id, type, prompt, status, input_keys, output_keys, cost_cents)
		VALUES ($1, 't2i', 'grandchild', 'succeeded', jsonb_build_array($2::text), jsonb_build_array($3::text), 0)
		RETURNING id`, user.ID, childKey, grandchildKey).Scan(&grandchildID); err != nil {
		t.Fatalf("insert grandchild task: %v", err)
	}

	w := env.do(t, http.MethodDelete, "/api/v1/tasks/"+parentID.String()+"?cascade=true", nil, token)
	if _, code := decode(t, w); w.Code != http.StatusOK || code != "" {
		t.Fatalf("cascade delete: status %d code %s body %s", w.Code, code, w.Body.String())
	}

	var marked, deletedOutputs, remainingOutputs int
	if err := env.st.Pool.QueryRow(context.Background(),
		`SELECT
			count(*) FILTER (WHERE deleted_at IS NOT NULL AND deletion_actor = 'user'),
			coalesce(sum(deleted_output_count), 0),
			coalesce(sum(jsonb_array_length(output_keys)), 0)
		 FROM tasks WHERE id = ANY($1::uuid[])`,
		[]uuid.UUID{parentID, childID, grandchildID}).Scan(&marked, &deletedOutputs, &remainingOutputs); err != nil {
		t.Fatalf("read task deletion markers: %v", err)
	}
	if marked != 3 || deletedOutputs != 3 || remainingOutputs != 0 {
		t.Fatalf("cascade markers = %d tasks / %d deleted outputs / %d live outputs, want 3 / 3 / 0",
			marked, deletedOutputs, remainingOutputs)
	}

	w = env.do(t, http.MethodGet, "/api/v1/tasks/"+parentID.String(), nil, token)
	if _, code := decode(t, w); w.Code != http.StatusNotFound || code != "task_not_found" {
		t.Fatalf("read user-deleted task: status %d code %s body %s", w.Code, code, w.Body.String())
	}
}

func TestDeleteTaskProtectsMaskReferences(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	parentKey := "tasks/" + user.ID.String() + "/parent/original.png"

	var parentID uuid.UUID
	if err := env.st.Pool.QueryRow(context.Background(), `
		INSERT INTO tasks (user_id, type, prompt, status, input_keys, output_keys, cost_cents)
		VALUES ($1, 't2i', 'parent', 'succeeded', '[]'::jsonb, jsonb_build_array($2::text), 0)
		RETURNING id`, user.ID, parentKey).Scan(&parentID); err != nil {
		t.Fatalf("insert parent task: %v", err)
	}
	if _, err := env.st.Pool.Exec(context.Background(), `
		INSERT INTO tasks (user_id, type, prompt, status, params, input_keys, output_keys, cost_cents)
		VALUES ($1, 't2i', 'child', 'succeeded',
			jsonb_build_object('maskKey', $2::text, 'maskBaseKey', $2::text),
			'[]'::jsonb, '[]'::jsonb, 0)`, user.ID, parentKey); err != nil {
		t.Fatalf("insert mask child task: %v", err)
	}

	w := env.do(t, http.MethodDelete, "/api/v1/tasks/"+parentID.String(), nil, token)
	if _, code := decode(t, w); w.Code != http.StatusConflict || code != "task_in_use" {
		t.Fatalf("delete mask-referenced parent: status %d code %s body %s", w.Code, code, w.Body.String())
	}
}

func TestDeleteTaskProtectsAssistantMessageReferences(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	parentKey := "tasks/" + user.ID.String() + "/parent/original.png"

	var parentID uuid.UUID
	if err := env.st.Pool.QueryRow(context.Background(), `
		INSERT INTO tasks (user_id, type, prompt, status, input_keys, output_keys, cost_cents)
		VALUES ($1, 't2i', 'parent', 'succeeded', '[]'::jsonb, jsonb_build_array($2::text), 0)
		RETURNING id`, user.ID, parentKey).Scan(&parentID); err != nil {
		t.Fatalf("insert parent task: %v", err)
	}
	var conversationID uuid.UUID
	if err := env.st.Pool.QueryRow(context.Background(), `
		INSERT INTO assistant_conversations (user_id, title)
		VALUES ($1, '引用测试') RETURNING id`, user.ID).Scan(&conversationID); err != nil {
		t.Fatalf("insert assistant conversation: %v", err)
	}
	if _, err := env.st.Pool.Exec(context.Background(), `
		INSERT INTO assistant_messages (conversation_id, role, content, kind, status, metadata)
		VALUES ($1, 'user', '引用图片', 'chat', 'complete',
			jsonb_build_object('referenceImages', jsonb_build_array(jsonb_build_object('fileKey', $2::text))))`,
		conversationID, parentKey); err != nil {
		t.Fatalf("insert assistant reference: %v", err)
	}

	w := env.do(t, http.MethodDelete, "/api/v1/tasks/"+parentID.String(), nil, token)
	if _, code := decode(t, w); w.Code != http.StatusConflict || code != "task_in_use" {
		t.Fatalf("delete assistant-referenced parent: status %d code %s body %s", w.Code, code, w.Body.String())
	}
}

func TestDeleteTaskProtectsAssistantProposalReferences(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	parentKey := "tasks/" + user.ID.String() + "/parent/original.png"

	var parentID uuid.UUID
	if err := env.st.Pool.QueryRow(context.Background(), `
		INSERT INTO tasks (user_id, type, prompt, status, input_keys, output_keys, cost_cents)
		VALUES ($1, 't2i', 'parent', 'succeeded', '[]'::jsonb, jsonb_build_array($2::text), 0)
		RETURNING id`, user.ID, parentKey).Scan(&parentID); err != nil {
		t.Fatalf("insert parent task: %v", err)
	}
	var conversationID uuid.UUID
	if err := env.st.Pool.QueryRow(context.Background(), `
		INSERT INTO assistant_conversations (user_id, title)
		VALUES ($1, '方案引用测试') RETURNING id`, user.ID).Scan(&conversationID); err != nil {
		t.Fatalf("insert assistant conversation: %v", err)
	}
	if _, err := env.st.Pool.Exec(context.Background(), `
		INSERT INTO assistant_messages (conversation_id, role, content, kind, status, metadata)
		VALUES ($1, 'assistant', '方案', 'proposal', 'complete',
			jsonb_build_object('proposal', jsonb_build_object('referenceImages',
				jsonb_build_array(jsonb_build_object('fileKey', $2::text)))))`, conversationID, parentKey); err != nil {
		t.Fatalf("insert assistant proposal reference: %v", err)
	}

	w := env.do(t, http.MethodDelete, "/api/v1/tasks/"+parentID.String(), nil, token)
	if _, code := decode(t, w); w.Code != http.StatusConflict || code != "task_in_use" {
		t.Fatalf("delete proposal-referenced parent: status %d code %s body %s", w.Code, code, w.Body.String())
	}
}

func TestDeleteTaskProtectsAssistantGeneratedProposalImages(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	parentKey := "tasks/" + user.ID.String() + "/parent/original.png"

	var parentID uuid.UUID
	if err := env.st.Pool.QueryRow(context.Background(), `
		INSERT INTO tasks (user_id, type, prompt, status, input_keys, output_keys, cost_cents)
		VALUES ($1, 't2i', 'parent', 'succeeded', '[]'::jsonb, jsonb_build_array($2::text), 0)
		RETURNING id`, user.ID, parentKey).Scan(&parentID); err != nil {
		t.Fatalf("insert parent task: %v", err)
	}
	var conversationID uuid.UUID
	if err := env.st.Pool.QueryRow(context.Background(), `
		INSERT INTO assistant_conversations (user_id, title)
		VALUES ($1, '方案产物引用测试') RETURNING id`, user.ID).Scan(&conversationID); err != nil {
		t.Fatalf("insert assistant conversation: %v", err)
	}
	if _, err := env.st.Pool.Exec(context.Background(), `
		INSERT INTO assistant_messages (conversation_id, role, content, kind, status, metadata)
		VALUES ($1, 'assistant', '方案', 'proposal', 'complete', jsonb_build_object(
			'images', jsonb_build_array(jsonb_build_object('fileKey', $2::text)),
			'proposal', jsonb_build_object('images', jsonb_build_array(jsonb_build_object('fileKey', $2::text)))
		))`, conversationID, parentKey); err != nil {
		t.Fatalf("insert assistant generated images: %v", err)
	}

	w := env.do(t, http.MethodDelete, "/api/v1/tasks/"+parentID.String(), nil, token)
	if _, code := decode(t, w); w.Code != http.StatusConflict || code != "task_in_use" {
		t.Fatalf("delete generated-image-referenced parent: status %d code %s body %s", w.Code, code, w.Body.String())
	}
}

func TestDeleteUIDesignHistoryMirrorIgnoresItsOwnAssistantOutput(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	task, outputKey := insertUIDesignHistoryMirror(t, env, user.ID)

	w := env.do(t, http.MethodDelete, "/api/v1/tasks/"+task.ID.String()+"?cascade=true", nil, token)
	if _, code := decode(t, w); w.Code != http.StatusOK || code != "" {
		t.Fatalf("delete ui design history mirror: status %d code %s body %s", w.Code, code, w.Body.String())
	}

	var deleted bool
	if err := env.st.Pool.QueryRow(context.Background(),
		`SELECT deleted_at IS NOT NULL AND jsonb_array_length(output_keys) = 0 FROM tasks WHERE id = $1`,
		task.ID).Scan(&deleted); err != nil {
		t.Fatalf("read deleted ui design history mirror: %v", err)
	}
	if !deleted {
		t.Fatal("ui design history mirror retained its output after deletion")
	}
	var cleanupJobs int
	if err := env.st.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM object_cleanup_jobs WHERE object_key = $1`, outputKey).Scan(&cleanupJobs); err != nil {
		t.Fatalf("count ui design cleanup jobs: %v", err)
	}
	if cleanupJobs != 1 {
		t.Fatalf("ui design cleanup jobs = %d, want 1", cleanupJobs)
	}
}

func TestDeleteUIDesignHistoryMirrorStillProtectsExternalAssistantReference(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	task, outputKey := insertUIDesignHistoryMirror(t, env, user.ID)

	var conversationID uuid.UUID
	if err := env.st.Pool.QueryRow(context.Background(), `
		INSERT INTO assistant_conversations (user_id, title)
		VALUES ($1, '真实引用') RETURNING id`, user.ID).Scan(&conversationID); err != nil {
		t.Fatalf("insert external assistant conversation: %v", err)
	}
	if _, err := env.st.Pool.Exec(context.Background(), `
		INSERT INTO assistant_messages (conversation_id, role, content, kind, status, metadata)
		VALUES ($1, 'user', '继续参考这张设计稿', 'chat', 'complete',
			jsonb_build_object('referenceImages', jsonb_build_array(jsonb_build_object('fileKey', $2::text))))`,
		conversationID, outputKey); err != nil {
		t.Fatalf("insert external assistant reference: %v", err)
	}

	w := env.do(t, http.MethodDelete, "/api/v1/tasks/"+task.ID.String()+"?cascade=true", nil, token)
	if _, code := decode(t, w); w.Code != http.StatusConflict || code != "task_in_use" {
		t.Fatalf("delete externally referenced ui design mirror: status %d code %s body %s", w.Code, code, w.Body.String())
	}
}

func TestDeleteAssistantHistoryRunPreservesConversationAndMessage(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	ctx := context.Background()
	now := time.Now().UTC()
	outputKey := "tasks/" + user.ID.String() + "/assistant/failed-output.png"

	conversation, err := store.InsertAssistantConversationWithWorkspace(
		ctx, env.st.Pool, uuid.New(), user.ID, "失败图片对话", "assistant", now,
	)
	if err != nil {
		t.Fatalf("insert assistant conversation: %v", err)
	}
	userMessage, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "user", Content: "生成一张图",
		Kind: "text", Status: "complete", CreatedAt: now,
	})
	if err != nil {
		t.Fatalf("insert assistant user message: %v", err)
	}
	assistantMessage, err := store.InsertAssistantMessage(ctx, env.st.Pool, store.AssistantMessage{
		ID: uuid.New(), ConversationID: conversation.ID, Role: "assistant", Kind: "image",
		Status: "failed", Metadata: map[string]any{
			"images": []map[string]any{{"fileKey": outputKey}},
		}, CreatedAt: now.Add(time.Millisecond),
	})
	if err != nil {
		t.Fatalf("insert assistant output message: %v", err)
	}
	run, err := store.InsertAssistantRun(ctx, env.st.Pool, store.AssistantRun{
		ID: uuid.New(), UserID: user.ID, ConversationID: conversation.ID,
		UserMessageID: userMessage.ID, AssistantMessageID: assistantMessage.ID,
		Mode: "image", Prompt: "生成一张图", Params: map[string]any{"model": "test-image"},
	})
	if err != nil {
		t.Fatalf("insert assistant run: %v", err)
	}
	if _, err := env.st.Pool.Exec(ctx, `UPDATE assistant_runs
		SET status = 'failed', stage = 'complete', finished_at = $2 WHERE id = $1`, run.ID, now); err != nil {
		t.Fatalf("finish assistant run: %v", err)
	}

	w := env.do(t, http.MethodDelete, "/api/v1/tasks/"+run.ID.String()+"?history=true", nil, token)
	if _, code := decode(t, w); w.Code != http.StatusConflict || code != "force_media_required" {
		t.Fatalf("delete assistant history without force: status %d code %s body %s", w.Code, code, w.Body.String())
	}
	w = env.do(t, http.MethodDelete, "/api/v1/tasks/"+run.ID.String()+"?history=true&forceMedia=true&cascade=true", nil, token)
	if _, code := decode(t, w); w.Code != http.StatusOK || code != "" {
		t.Fatalf("delete assistant history run: status %d code %s body %s", w.Code, code, w.Body.String())
	}

	if stored, err := store.GetUserAssistantConversation(ctx, env.st.Pool, user.ID, conversation.ID); err != nil || stored == nil {
		t.Fatalf("assistant conversation was removed: conversation=%#v err=%v", stored, err)
	}
	storedMessage, err := store.GetAssistantMessage(ctx, env.st.Pool, assistantMessage.ID)
	if err != nil || storedMessage == nil {
		t.Fatalf("assistant output message was removed: message=%#v err=%v", storedMessage, err)
	}
	images, _ := storedMessage.Metadata["images"].([]any)
	if len(images) != 1 {
		t.Fatalf("assistant image placeholder = %#v", storedMessage.Metadata["images"])
	}
	placeholder, _ := images[0].(map[string]any)
	if placeholder["deletedByHistory"] != true || placeholder["fileKey"] != nil || placeholder["deletionMessage"] != store.DeletedMediaPlaceholderMessage {
		t.Fatalf("assistant image placeholder = %#v", storedMessage.Metadata["images"])
	}
	if stored, err := store.GetUserAssistantRun(ctx, env.st.Pool, user.ID, run.ID); err != nil || stored == nil {
		t.Fatalf("assistant run was removed: run=%#v err=%v", stored, err)
	}

	listed, err := store.ListTasks(ctx, env.st.Pool, &user.ID, store.PromptTaskTypeAssistant, "", nil, 10, nil, "", "")
	if err != nil {
		t.Fatalf("list assistant history: %v", err)
	}
	if len(listed) != 0 {
		t.Fatalf("assistant history still contains cleared run: %#v", listed)
	}
	var tombstoneOK bool
	if err := env.st.Pool.QueryRow(ctx, `SELECT
		deleted_at IS NOT NULL AND deletion_actor = 'user' AND deleted_output_count = 1
		FROM tasks WHERE id = $1`, run.ID).Scan(&tombstoneOK); err != nil {
		t.Fatalf("read assistant history tombstone: %v", err)
	}
	if !tombstoneOK {
		t.Fatal("assistant history tombstone does not preserve output accounting")
	}
	var cleanupJobs int
	if err := env.st.Pool.QueryRow(ctx,
		`SELECT count(*) FROM object_cleanup_jobs WHERE object_key = $1`, outputKey).Scan(&cleanupJobs); err != nil {
		t.Fatalf("count assistant output cleanup jobs: %v", err)
	}
	if cleanupJobs != 1 {
		t.Fatalf("assistant output cleanup jobs = %d, want 1", cleanupJobs)
	}
}

func TestDeleteCanvasHistoryReplacesProjectImageWithPlaceholder(t *testing.T) {
	env := newCommunityEnv(t)
	user, token := env.newUserSession(t, "user")
	ctx := context.Background()
	outputKey := "tasks/" + user.ID.String() + "/canvas/output.png"

	var taskID uuid.UUID
	if err := env.st.Pool.QueryRow(ctx, `
		INSERT INTO tasks (user_id, type, prompt, status, params, input_keys, output_keys, thumbnail_keys, cost_cents)
		VALUES ($1, 't2i', '画布图片', 'succeeded', jsonb_build_object('_source', 'react_canvas'),
			'[]'::jsonb, jsonb_build_array($2::text), '[]'::jsonb, 0)
		RETURNING id`, user.ID, outputKey).Scan(&taskID); err != nil {
		t.Fatalf("insert canvas task: %v", err)
	}
	document, _ := json.Marshal(map[string]any{
		"version": 3,
		"nodes": []any{map[string]any{
			"id": "image-1", "type": "image", "title": "画布图片",
			"position": map[string]any{"x": 0, "y": 0}, "width": 512, "height": 512,
			"metadata": map[string]any{"content": "/api/v1/files/" + outputKey, "storageKey": outputKey, "status": "success"},
		}},
		"connections": []any{},
	})
	project, err := store.InsertCanvasProject(ctx, env.st.Pool, user.ID, "保留节点", document)
	if err != nil {
		t.Fatalf("insert canvas project: %v", err)
	}

	w := env.do(t, http.MethodDelete, "/api/v1/tasks/"+taskID.String()+"?history=true", nil, token)
	if _, code := decode(t, w); w.Code != http.StatusConflict || code != "force_media_required" {
		t.Fatalf("delete canvas history without force: status %d code %s body %s", w.Code, code, w.Body.String())
	}
	w = env.do(t, http.MethodDelete, "/api/v1/tasks/"+taskID.String()+"?history=true&forceMedia=true&cascade=true", nil, token)
	if _, code := decode(t, w); w.Code != http.StatusOK || code != "" {
		t.Fatalf("force delete canvas history: status %d code %s body %s", w.Code, code, w.Body.String())
	}

	storedProject, err := store.GetUserCanvasProject(ctx, env.st.Pool, user.ID, project.ID)
	if err != nil || storedProject == nil {
		t.Fatalf("canvas project was removed: project=%#v err=%v", storedProject, err)
	}
	var storedDocument map[string]any
	if err := json.Unmarshal(storedProject.Document, &storedDocument); err != nil {
		t.Fatalf("decode canvas project: %v", err)
	}
	nodes, _ := storedDocument["nodes"].([]any)
	if len(nodes) != 1 {
		t.Fatalf("canvas nodes = %#v", storedDocument["nodes"])
	}
	node, _ := nodes[0].(map[string]any)
	metadata, _ := node["metadata"].(map[string]any)
	if metadata["deletedByHistory"] != true || metadata["storageKey"] != nil || metadata["deletionMessage"] != store.DeletedMediaPlaceholderMessage {
		t.Fatalf("canvas image placeholder = %#v", metadata)
	}
	var cleanupJobs int
	if err := env.st.Pool.QueryRow(ctx,
		`SELECT count(*) FROM object_cleanup_jobs WHERE object_key = $1`, outputKey).Scan(&cleanupJobs); err != nil {
		t.Fatalf("count canvas output cleanup jobs: %v", err)
	}
	if cleanupJobs != 1 {
		t.Fatalf("canvas output cleanup jobs = %d, want 1", cleanupJobs)
	}
}

func TestTaskReferenceCountIgnoresForeignAssistantProposal(t *testing.T) {
	env := newCommunityEnv(t)
	user, _ := env.newUserSession(t, "user")
	foreignUser, _ := env.newUserSession(t, "user")
	parentKey := "tasks/" + user.ID.String() + "/parent/original.png"

	var parentID uuid.UUID
	if err := env.st.Pool.QueryRow(context.Background(), `
		INSERT INTO tasks (user_id, type, prompt, status, input_keys, output_keys, cost_cents)
		VALUES ($1, 't2i', 'parent', 'succeeded', '[]'::jsonb, jsonb_build_array($2::text), 0)
		RETURNING id`, user.ID, parentKey).Scan(&parentID); err != nil {
		t.Fatalf("insert parent task: %v", err)
	}
	var conversationID uuid.UUID
	if err := env.st.Pool.QueryRow(context.Background(), `
		INSERT INTO assistant_conversations (user_id, title)
		VALUES ($1, '其他用户的方案') RETURNING id`, foreignUser.ID).Scan(&conversationID); err != nil {
		t.Fatalf("insert foreign conversation: %v", err)
	}
	if _, err := env.st.Pool.Exec(context.Background(), `
		INSERT INTO assistant_messages (conversation_id, role, content, kind, status, metadata)
		VALUES ($1, 'assistant', '方案', 'proposal', 'complete',
			jsonb_build_object('proposal', jsonb_build_object('referenceImages',
				jsonb_build_array(jsonb_build_object('fileKey', $2::text)))))`, conversationID, parentKey); err != nil {
		t.Fatalf("insert foreign assistant proposal: %v", err)
	}

	count, err := store.CountTasksReferencingInputKeys(
		context.Background(), env.st.Pool, user.ID, parentID, []string{parentKey},
	)
	if err != nil {
		t.Fatalf("count task references: %v", err)
	}
	if count != 0 {
		t.Fatalf("foreign assistant proposal counted as task reference: %d", count)
	}
}
