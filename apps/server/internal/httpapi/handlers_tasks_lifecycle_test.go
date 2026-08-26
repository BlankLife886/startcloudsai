package httpapi

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

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
