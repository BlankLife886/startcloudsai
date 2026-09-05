package worker

import (
	"testing"

	"github.com/hibiken/asynq"
)

func TestPeriodicConfigsUseClusterDeduplication(t *testing.T) {
	configs, err := (&staticPeriodicConfigProvider{}).GetConfigs()
	if err != nil {
		t.Fatal(err)
	}
	if len(configs) != 17 {
		t.Fatalf("periodic config count = %d", len(configs))
	}
	for _, config := range configs {
		hasUnique := false
		for _, option := range config.Opts {
			if option.Type() == asynq.UniqueOpt {
				hasUnique = true
				break
			}
		}
		if !hasUnique {
			t.Fatalf("periodic task %s has no unique option", config.Task.Type())
		}
	}
}
