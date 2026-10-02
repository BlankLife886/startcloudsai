package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// A cut-out asks the image model for a transparent PNG; the flag is kept only
// when the model supports a transparent background.
func TestAssistantImageRunTransparentBackground(t *testing.T) {
	env, _, token, cfg := newExecutionAdmissionEnv(t)
	ctx := context.Background()
	conversation, _ := decode(t, env.do(t, http.MethodPost, "/api/v1/assistant/conversations", map[string]any{"title": "Cut-out"}, token))
	run := func(key string) *store.AssistantRun {
		t.Helper()
		created := env.do(t, http.MethodPost, "/api/v1/assistant/runs", map[string]any{
			"conversationId": conversation["id"], "prompt": "去掉背景", "mode": "image", "model": "image", "count": 1,
			"queue": true, "idempotencyKey": key, "transparentBackground": true,
		}, token)
		if created.Code != http.StatusCreated {
			t.Fatalf("create: %d %s", created.Code, created.Body.String())
		}
		data, _ := decode(t, created)
		stored, err := store.GetAssistantRun(ctx, env.st.Pool, uuid.MustParse(data["run"].(map[string]any)["id"].(string)))
		if err != nil {
			t.Fatal(err)
		}
		return stored
	}

	supported := run("transparent-supported")
	if supported.Params["transparentBackground"] != true || supported.Params["outputFormat"] != "png" {
		t.Fatalf("params = %#v", supported.Params)
	}

	// A model without a format selector keeps its built-in format.
	cfg.Models[0].OutputFormats = []string{}
	if err := modelconfig.Save(ctx, env.st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	builtIn := run("transparent-built-in-format")
	if _, named := builtIn.Params["outputFormat"]; builtIn.Params["transparentBackground"] != true || named {
		t.Fatalf("built-in format params = %#v", builtIn.Params)
	}

	// Turned off the way the admin page does it: an explicit false in JSON.
	var model modelconfig.Model
	raw, _ := json.Marshal(cfg.Models[0])
	raw = bytes.Replace(raw, []byte(`"transparentBackground":true`), []byte(`"transparentBackground":false`), 1)
	if err := json.Unmarshal(raw, &model); err != nil || model.TransparentBackground {
		t.Fatalf("model = %+v err = %v", model, err)
	}
	cfg.Models[0] = model
	if err := modelconfig.Save(ctx, env.st.Pool, cfg); err != nil {
		t.Fatal(err)
	}
	unsupported := run("transparent-unsupported")
	if _, ok := unsupported.Params["transparentBackground"]; ok {
		t.Fatalf("unsupported model kept the flag: %#v", unsupported.Params)
	}
}
