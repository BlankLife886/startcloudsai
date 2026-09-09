package worker

import (
	"context"
	"errors"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/crun"
	"github.com/BlankLife886/startcloudsai/server/internal/executionconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

func (w *Worker) taskExecutionSnapshot(ctx context.Context, task *store.Task) (*executionconfig.Snapshot, error) {
	return w.taskExecutionSnapshotQ(ctx, w.St.Pool, task)
}

func (w *Worker) taskExecutionSnapshotQ(ctx context.Context, q store.Q, task *store.Task) (*executionconfig.Snapshot, error) {
	params := task.Params
	if taskParamString(params, "_pricingWorkspace") == "" {
		params = make(map[string]any, len(task.Params)+1)
		for key, value := range task.Params {
			params[key] = value
		}
		workspace, _ := modelconfig.WorkspaceForTaskType(task.Type)
		if taskParamString(params, "_source") == "react_canvas" {
			workspace = modelconfig.WorkspaceCanvas
		}
		params["_pricingWorkspace"] = workspace
	}
	return executionconfig.Ensure(ctx, q, executionconfig.Task, task.ID, params)
}

func (w *Worker) assistantExecutionSnapshot(ctx context.Context, run *store.AssistantRun) (*executionconfig.Snapshot, error) {
	return w.assistantExecutionSnapshotQ(ctx, w.St.Pool, run)
}

func (w *Worker) assistantExecutionSnapshotQ(ctx context.Context, q store.Q, run *store.AssistantRun) (*executionconfig.Snapshot, error) {
	return executionconfig.Ensure(ctx, q, executionconfig.Assistant, run.ID, run.Params)
}

func (w *Worker) resolveLegacyImageClient(ctx context.Context, provider, model, taskType string) (executionconfig.ClientConfig, error) {
	cfg := executionconfig.ClientConfig{Provider: strings.ToLower(strings.TrimSpace(provider)), Model: model}
	if cfg.Provider != "c2a" && cfg.Provider != "crun" && cfg.Provider != "sub2api" {
		var err error
		cfg.Provider, err = settings.ImageServiceProvider(ctx, w.St.Pool, taskType)
		if err != nil {
			return cfg, err
		}
	}
	switch cfg.Provider {
	case "c2a":
		resolved, err := settings.ResolveC2A(ctx, w.St.Pool, w.Cfg.C2ABaseURL, w.Cfg.C2AAPIKey, w.Cfg.C2ATimeoutSecs, w.Cfg.AppSecret)
		if err != nil {
			return cfg, err
		}
		cfg.BaseURL, cfg.APIKey, cfg.TimeoutSecs = resolved.BaseURL, resolved.APIKey, resolved.TimeoutSecs
		if cfg.Model == "" {
			modelType := taskType
			if modelType == "assistant_image" {
				modelType = "t2i"
			}
			if modelType == "ui_design_asset" {
				modelType = "ui_design"
			}
			cfg.Model, err = settings.TaskModel(ctx, w.St.Pool, modelType)
			if err != nil {
				return cfg, err
			}
		}
	case "crun":
		resolved, err := settings.ResolveCRUN(ctx, w.St.Pool, settings.CRUNConfig{BaseURL: w.Cfg.CRUNBaseURL, APIKey: w.Cfg.CRUNAPIKey, TimeoutSecs: w.Cfg.CRUNTimeoutSecs}, w.Cfg.AppSecret)
		if err != nil {
			return cfg, err
		}
		cfg.BaseURL, cfg.APIKey, cfg.TimeoutSecs = resolved.BaseURL, resolved.APIKey, resolved.TimeoutSecs
		if cfg.Model == "" {
			cfg.Model = crun.DefaultModel
		}
	case "sub2api":
		resolved, err := w.resolveLegacyAssistantClient(ctx)
		if err != nil {
			return cfg, err
		}
		resolved.Provider = cfg.Provider
		if cfg.Model != "" {
			resolved.ImageModel = cfg.Model
		}
		resolved.Model = resolved.ImageModel
		return resolved, nil
	default:
		return cfg, errors.New("unsupported legacy image provider")
	}
	return cfg, nil
}

func (w *Worker) legacyTaskClientConfig(ctx context.Context, task *store.Task) (executionconfig.ClientConfig, error) {
	return executionconfig.Client(ctx, w.St.Pool, executionconfig.Task, task.ID, "image", w.Cfg.AppSecret, func() (executionconfig.ClientConfig, error) {
		return w.resolveLegacyImageClient(ctx, taskParamString(task.Params, "_serviceProvider"), strings.TrimSpace(task.Model), task.Type)
	})
}

// taskExecutionIdentity lets the run handler bind legacy identity before it
// records metadata. Configured identities use the same immutable selection as
// attempt registration and the actual provider call.
func (w *Worker) taskExecutionIdentity(ctx context.Context, task *store.Task) (string, string, error) {
	selection, configured, err := w.configuredModelSelection(ctx, task)
	if err != nil {
		return "", "", err
	}
	if configured {
		return selection.Provider.Adapter, selection.Model.UpstreamModel, nil
	}
	cfg, err := w.legacyTaskClientConfig(ctx, task)
	return cfg.Provider, cfg.Model, err
}

func (w *Worker) legacyAssistantImageConfig(ctx context.Context, run *store.AssistantRun) (executionconfig.ClientConfig, error) {
	return executionconfig.Client(ctx, w.St.Pool, executionconfig.Assistant, run.ID, "image", w.Cfg.AppSecret, func() (executionconfig.ClientConfig, error) {
		return w.resolveLegacyImageClient(ctx, assistantParamString(run.Params, "_serviceProvider", ""), "", assistantParamString(run.Params, "serviceKey", "assistant_image"))
	})
}

func (w *Worker) resolveLegacyAssistantClient(ctx context.Context) (executionconfig.ClientConfig, error) {
	resolved, err := settings.ResolveSub2API(ctx, w.St.Pool, settings.Sub2APIConfig{
		BaseURL: w.Cfg.Sub2APIBaseURL, APIKey: w.Cfg.Sub2APIAPIKey, ChatModel: w.Cfg.Sub2APIChatModel,
		ImageModel: w.Cfg.Sub2APIImageModel, TimeoutSecs: w.Cfg.Sub2APITimeoutSecs,
	}, w.Cfg.AppSecret)
	return executionconfig.ClientConfig{BaseURL: resolved.BaseURL, APIKey: resolved.APIKey, ChatModel: resolved.ChatModel, ImageModel: resolved.ImageModel, TimeoutSecs: resolved.TimeoutSecs}, err
}

func legacySub2Client(cfg executionconfig.ClientConfig) (*sub2api.Client, error) {
	client, err := sub2api.New(cfg.BaseURL, cfg.APIKey, cfg.ChatModel, cfg.ImageModel, cfg.TimeoutSecs)
	if err != nil {
		return nil, err
	}
	if !client.Configured() {
		return nil, errors.New("AI service is not configured")
	}
	return client, nil
}

func (w *Worker) assistantClientForRun(ctx context.Context, run *store.AssistantRun) (*sub2api.Client, error) {
	cfg, err := executionconfig.Client(ctx, w.St.Pool, executionconfig.Assistant, run.ID, "chat", w.Cfg.AppSecret, func() (executionconfig.ClientConfig, error) {
		return w.resolveLegacyAssistantClient(ctx)
	})
	if err != nil {
		return nil, err
	}
	return legacySub2Client(cfg)
}

func (w *Worker) frozenC2AClient(cfg executionconfig.ClientConfig) *c2a.Client {
	return c2a.NewWithPolicy(cfg.BaseURL, cfg.APIKey, cfg.TimeoutSecs, w.Cfg.C2APrivateNetworkAllowed()).WithAsyncImageEdits()
}

func legacyCRUNClient(cfg executionconfig.ClientConfig) (*crun.Client, error) {
	client, err := crun.New(cfg.BaseURL, cfg.APIKey, cfg.Model, cfg.TimeoutSecs)
	if err != nil {
		return nil, err
	}
	if !client.Configured() {
		return nil, errors.New("CRUN API key is not configured")
	}
	return client, nil
}
