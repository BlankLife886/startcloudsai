package httpapi

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

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

func TestDeleteTaskCascadeRemovesDependentTaskChain(t *testing.T) {
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

	var remaining int
	if err := env.st.Pool.QueryRow(context.Background(),
		`SELECT count(*) FROM tasks WHERE id = ANY($1::uuid[])`,
		[]uuid.UUID{parentID, childID, grandchildID}).Scan(&remaining); err != nil {
		t.Fatalf("count remaining tasks: %v", err)
	}
	if remaining != 0 {
		t.Fatalf("cascade left %d tasks", remaining)
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
