package assistanttools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func testManifest(execute Executor) Manifest {
	return Manifest{ID: "files", Version: "1.0.0", Tools: []Definition{{
		Name: "files_search", Description: "Search files",
		InputSchema: map[string]any{"type": "object"}, Permissions: []Permission{PermissionFilesRead},
		Risk: RiskRead, Timeout: time.Second, MaxResultBytes: 32, Execute: execute,
	}}}
}

func TestRegistryValidatesPermissionsAndTruncatesResults(t *testing.T) {
	registry, err := NewRegistry(testManifest(func(_ context.Context, invocation Invocation) (Result, error) {
		var input map[string]any
		if err := json.Unmarshal(invocation.Arguments, &input); err != nil {
			return Result{}, err
		}
		return Result{Content: strings.Repeat("文档结果", 20)}, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := registry.Execute(context.Background(), "files_search", Invocation{}); err == nil {
		t.Fatal("missing file permission must fail")
	}
	result, err := registry.Execute(context.Background(), "files_search", Invocation{
		Arguments: json.RawMessage(`{"query":"test"}`), Permissions: map[Permission]bool{PermissionFilesRead: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result.Content, "truncated") || !strings.Contains(result.Content, "文档") {
		t.Fatalf("result = %q", result.Content)
	}
}

func TestSkillRegistryRejectsUnknownToolsAndResolvesFileDefault(t *testing.T) {
	tools, err := NewRegistry(testManifest(func(context.Context, Invocation) (Result, error) { return Result{}, nil }))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewSkillRegistry(tools, Skill{ID: "broken", Name: "Broken", Instructions: "x", AllowedTools: []string{"missing"}}); err == nil {
		t.Fatal("unknown tool must be rejected")
	}
	skills, err := NewSkillRegistry(tools,
		Skill{ID: SkillGeneral, Name: "General", Instructions: "Answer directly"},
		Skill{ID: SkillDocumentAnalysis, Name: "Documents", Instructions: "Use files", AllowedTools: []string{"files_search"}},
	)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := skills.Resolve("", true)
	if err != nil || resolved.ID != SkillDocumentAnalysis {
		t.Fatalf("resolved = %#v err=%v", resolved, err)
	}
}

func TestDecodeArgumentsRejectsUnknownAndTrailingValues(t *testing.T) {
	var input struct {
		Query string `json:"query"`
	}
	if err := decodeArguments(json.RawMessage(`{"query":"budget","extra":true}`), &input); err == nil {
		t.Fatal("unknown fields must be rejected")
	}
	if err := decodeArguments(json.RawMessage(`{"query":"budget"} {"second":true}`), &input); err == nil {
		t.Fatal("trailing JSON values must be rejected")
	}
	if err := decodeArguments(json.RawMessage(`{"query":"budget"}`), &input); err != nil || input.Query != "budget" {
		t.Fatalf("valid input = %#v err=%v", input, err)
	}
}
