package httpapi

import (
	"testing"

	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func TestValidateAssistantFileQuota(t *testing.T) {
	tests := []struct {
		name     string
		usage    store.AssistantFileUsage
		incoming int64
		wantErr  bool
	}{
		{name: "within quota", usage: store.AssistantFileUsage{FileCount: 49, TotalBytes: assistantFileTotalBytesLimit - 1, ActiveCount: 3, Created24h: 49}, incoming: 1},
		{name: "file count", usage: store.AssistantFileUsage{FileCount: assistantFileListLimit}, incoming: 1, wantErr: true},
		{name: "total bytes", usage: store.AssistantFileUsage{TotalBytes: assistantFileTotalBytesLimit}, incoming: 1, wantErr: true},
		{name: "processing", usage: store.AssistantFileUsage{ActiveCount: assistantFileActiveLimit}, incoming: 1, wantErr: true},
		{name: "daily", usage: store.AssistantFileUsage{Created24h: assistantFileDailyLimit}, incoming: 1, wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := validateAssistantFileQuota(test.usage, test.incoming); (err != nil) != test.wantErr {
				t.Fatalf("validateAssistantFileQuota() err = %v, wantErr %v", err, test.wantErr)
			}
		})
	}
}
