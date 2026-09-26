package executionconfig

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/settings"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// ClientConfig is private. Client binds a legacy/env route once, encrypting its
// resolved secret before insertion. Subsequent attempts never resolve live keys.
type ClientConfig struct {
	BaseURL     string `json:"baseUrl"`
	APIKey      string `json:"apiKey"`
	Model       string `json:"model,omitempty"`
	ChatModel   string `json:"chatModel,omitempty"`
	ImageModel  string `json:"imageModel,omitempty"`
	TimeoutSecs int    `json:"timeoutSecs"`
	Provider    string `json:"provider,omitempty"`
}

func Client(ctx context.Context, q store.Q, source string, id uuid.UUID, slot, masterKey string, resolve func() (ClientConfig, error)) (ClientConfig, error) {
	raw, err := store.GetExecutionSnapshot(ctx, q, source, id, "client:"+slot)
	if err != nil {
		return ClientConfig{}, err
	}
	if len(raw) == 0 {
		cfg, err := resolve()
		if err != nil {
			return ClientConfig{}, err
		}
		if cfg.APIKey != "" {
			cfg.APIKey, err = settings.EncryptSecret(cfg.APIKey, masterKey)
			if err != nil {
				return ClientConfig{}, err
			}
		}
		raw, err = json.Marshal(cfg)
		if err != nil {
			return ClientConfig{}, err
		}
		raw, err = store.BindExecutionSnapshot(ctx, q, source, id, "client:"+slot, raw)
		if err != nil {
			return ClientConfig{}, err
		}
	}
	var cfg ClientConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return ClientConfig{}, err
	}
	if cfg.APIKey != "" {
		cfg.APIKey, err = settings.DecryptSecret(cfg.APIKey, masterKey)
	}
	return cfg, err
}
