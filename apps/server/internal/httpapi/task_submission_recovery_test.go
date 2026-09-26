package httpapi

import (
	"context"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/google/uuid"
	"net/http"
	"testing"
)

func TestTaskSubmissionLookupIsReadOnlyAndUserScoped(t *testing.T) {
	env := newCommunityEnv(t)
	u, token := env.newUserSession(t, "user")
	_, otherToken := env.newUserSession(t, "user")
	ctx := context.Background()
	key := "recover-" + uuid.NewString()
	var id uuid.UUID
	if err := env.st.Pool.QueryRow(ctx, `INSERT INTO tasks(user_id,type,prompt,status,idempotency_key,cost_cents) VALUES($1,'t2i','recover','queued',$2,0) RETURNING id`, u.ID, key).Scan(&id); err != nil {
		t.Fatal(err)
	}
	for _, sample := range []struct {
		token, key string
		exists     bool
	}{{token, key, true}, {otherToken, key, false}, {token, "missing", false}} {
		response := env.do(t, http.MethodGet, "/api/v1/tasks/by-idempotency?key="+sample.key, nil, sample.token)
		data, code := decode(t, response)
		if response.Code != http.StatusOK || code != "" {
			t.Fatalf("status=%d code=%s", response.Code, code)
		}
		task, _ := data["task"].(map[string]any)
		if (task != nil) != sample.exists {
			t.Fatalf("task=%v exists=%v", task, sample.exists)
		}
		if task != nil && task["id"] != id.String() {
			t.Fatalf("unexpected task %v", task)
		}
	}
	var count int
	if err := env.st.Pool.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE idempotency_key=$1`, key).Scan(&count); err != nil || count != 1 {
		t.Fatalf("count=%d err=%v", count, err)
	}
}

func TestTaskSnapshotExposesSafeQueueReason(t *testing.T) {
	task := &store.Task{Status: "queued", Params: map[string]any{"_queueWaitReason": "user_execution_limit"}}
	data := taskDict(task, nil, nil)
	if data["queueReason"] != "user_execution_limit" {
		t.Fatalf("queue reason=%v", data["queueReason"])
	}
}
