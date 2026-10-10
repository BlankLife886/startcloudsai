package assistanttools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

type Permission string

const (
	PermissionFilesMetadata Permission = "files.metadata"
	PermissionFilesRead     Permission = "files.read"
	PermissionFilesWrite    Permission = "files.write"
	PermissionTasksRead     Permission = "tasks.read"
	PermissionWebRead       Permission = "web.read"
	PermissionActionsCreate Permission = "actions.create"
)

type Risk string

const (
	RiskRead  Risk = "read"
	RiskWrite Risk = "write"
)

// Level grades what a tool does to the user, and therefore what approval the
// v2 orchestrator needs before running it:
//
//   - LevelRead: reads the user's own data; runs directly.
//   - LevelSpend: consumes points. The orchestrator runs it, but the tool
//     must enforce approval itself: spend only within the user's
//     auto-approval budget, checked inside the transaction that spends, and
//     otherwise answer that the user has to confirm (the user then approves
//     on a card, which calls the same code with their confirmation).
//   - LevelChange: modifies or deletes user content; needs confirmation and
//     should be undoable.
//   - LevelMemory: writes only the assistant's own notes about the user
//     (memories). Runs directly when the user has memory on; every write is
//     shown in the reply with an undo, and the user can edit or delete it.
//
// Account and payment operations (purchases, refunds, passwords, API keys)
// have no level on purpose: the assistant explains and links to the page
// where the user acts, but never performs them.
type Level string

const (
	LevelRead   Level = "read"
	LevelSpend  Level = "spend"
	LevelChange Level = "change"
	LevelMemory Level = "memory"
)

type Manifest struct {
	ID          string
	Version     string
	Description string
	Tools       []Definition
}

type Definition struct {
	Name        string
	Description string
	InputSchema map[string]any
	Permissions []Permission
	Risk        Risk
	// Level defaults from Risk: read → LevelRead, write → LevelChange.
	Level          Level
	Timeout        time.Duration
	MaxResultBytes int
	Strict         bool
	Execute        Executor
}

type Invocation struct {
	UserID             uuid.UUID
	RunID              uuid.UUID
	AssistantMessageID uuid.UUID
	Arguments          json.RawMessage
	Permissions        map[Permission]bool
	FileIDs            []uuid.UUID
	// Timezone is the user's IANA zone for date-bucketed tools.
	Timezone string
}

type Result struct {
	Content string
	Meta    map[string]any
}

type Executor func(context.Context, Invocation) (Result, error)

type registeredTool struct {
	pluginID string
	version  string
	def      Definition
}

type Registry struct {
	tools map[string]registeredTool
}

var (
	pluginIDPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{1,63}$`)
	toolNamePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
)

func NewRegistry(manifests ...Manifest) (*Registry, error) {
	registry := &Registry{tools: make(map[string]registeredTool)}
	for _, manifest := range manifests {
		if err := registry.Register(manifest); err != nil {
			return nil, err
		}
	}
	return registry, nil
}

func (r *Registry) Register(manifest Manifest) error {
	if r == nil {
		return errors.New("assistant tool registry is nil")
	}
	manifest.ID = strings.TrimSpace(manifest.ID)
	manifest.Version = strings.TrimSpace(manifest.Version)
	if !pluginIDPattern.MatchString(manifest.ID) {
		return fmt.Errorf("invalid assistant plugin id %q", manifest.ID)
	}
	if manifest.Version == "" {
		return fmt.Errorf("assistant plugin %s has no version", manifest.ID)
	}
	if len(manifest.Tools) == 0 {
		return fmt.Errorf("assistant plugin %s has no tools", manifest.ID)
	}
	validated := make([]registeredTool, 0, len(manifest.Tools))
	for _, definition := range manifest.Tools {
		definition.Name = strings.TrimSpace(definition.Name)
		definition.Description = strings.TrimSpace(definition.Description)
		if !toolNamePattern.MatchString(definition.Name) {
			return fmt.Errorf("assistant plugin %s has invalid tool name %q", manifest.ID, definition.Name)
		}
		if _, exists := r.tools[definition.Name]; exists {
			return fmt.Errorf("assistant tool %s is already registered", definition.Name)
		}
		if definition.Description == "" || definition.InputSchema == nil || definition.Execute == nil {
			return fmt.Errorf("assistant tool %s has an incomplete definition", definition.Name)
		}
		if definition.Risk != RiskRead && definition.Risk != RiskWrite {
			return fmt.Errorf("assistant tool %s has invalid risk %q", definition.Name, definition.Risk)
		}
		switch definition.Level {
		case "":
			definition.Level = LevelRead
			if definition.Risk == RiskWrite {
				definition.Level = LevelChange
			}
		case LevelRead:
			if definition.Risk != RiskRead {
				return fmt.Errorf("assistant tool %s is level read but risk %q", definition.Name, definition.Risk)
			}
		case LevelSpend, LevelChange, LevelMemory:
			if definition.Risk != RiskWrite {
				return fmt.Errorf("assistant tool %s is level %s but risk %q", definition.Name, definition.Level, definition.Risk)
			}
		default:
			return fmt.Errorf("assistant tool %s has invalid level %q", definition.Name, definition.Level)
		}
		if definition.Timeout <= 0 {
			definition.Timeout = 10 * time.Second
		}
		if definition.Timeout > 2*time.Minute {
			return fmt.Errorf("assistant tool %s timeout exceeds two minutes", definition.Name)
		}
		if definition.MaxResultBytes <= 0 {
			definition.MaxResultBytes = 32 << 10
		}
		if definition.MaxResultBytes > 1<<20 {
			return fmt.Errorf("assistant tool %s result limit exceeds one MiB", definition.Name)
		}
		validated = append(validated, registeredTool{pluginID: manifest.ID, version: manifest.Version, def: definition})
	}
	for _, tool := range validated {
		r.tools[tool.def.Name] = tool
	}
	return nil
}

func (r *Registry) Has(name string) bool {
	if r == nil {
		return false
	}
	_, ok := r.tools[strings.TrimSpace(name)]
	return ok
}

// Level reports a registered tool's level; ok is false for unknown tools.
func (r *Registry) Level(name string) (Level, bool) {
	if r == nil {
		return "", false
	}
	tool, ok := r.tools[strings.TrimSpace(name)]
	return tool.def.Level, ok
}

// Names lists every registered tool name, sorted.
func (r *Registry) Names() []string {
	if r == nil {
		return nil
	}
	names := make([]string, 0, len(r.tools))
	for name := range r.tools {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// Domain reports which manifest registered a tool.
func (r *Registry) Domain(name string) string {
	if r == nil {
		return ""
	}
	return r.tools[strings.TrimSpace(name)].pluginID
}

func (r *Registry) Definitions(names []string) ([]sub2api.FunctionTool, error) {
	if r == nil {
		return nil, errors.New("assistant tool registry is nil")
	}
	requested := append([]string(nil), names...)
	sort.Strings(requested)
	out := make([]sub2api.FunctionTool, 0, len(requested))
	seen := make(map[string]bool, len(requested))
	for _, name := range requested {
		name = strings.TrimSpace(name)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		tool, ok := r.tools[name]
		if !ok {
			return nil, fmt.Errorf("assistant tool %s is not registered", name)
		}
		out = append(out, sub2api.FunctionTool{
			Name: tool.def.Name, Description: tool.def.Description, Parameters: tool.def.InputSchema,
			Strict: tool.def.Strict,
		})
	}
	return out, nil
}

func (r *Registry) Execute(ctx context.Context, name string, invocation Invocation) (Result, error) {
	if r == nil {
		return Result{}, errors.New("assistant tool registry is nil")
	}
	tool, ok := r.tools[strings.TrimSpace(name)]
	if !ok {
		return Result{}, fmt.Errorf("assistant tool %s is not registered", name)
	}
	for _, permission := range tool.def.Permissions {
		if !invocation.Permissions[permission] {
			return Result{}, fmt.Errorf("assistant tool %s requires permission %s", name, permission)
		}
	}
	toolCtx, cancel := context.WithTimeout(ctx, tool.def.Timeout)
	defer cancel()
	result, err := tool.def.Execute(toolCtx, invocation)
	if err != nil {
		return Result{}, err
	}
	result.Content = truncateUTF8Bytes(strings.TrimSpace(result.Content), tool.def.MaxResultBytes)
	return result, nil
}

func truncateUTF8Bytes(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	value = value[:limit]
	for !utf8.ValidString(value) && len(value) > 0 {
		value = value[:len(value)-1]
	}
	return strings.TrimSpace(value) + "\n[tool result truncated]"
}
