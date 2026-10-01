package assistanttools

import (
	"errors"
	"fmt"
	"sort"
	"strings"
)

const (
	SkillGeneral          = "general"
	SkillDocumentAnalysis = "document_analysis"
)

type Skill struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	Instructions string   `json:"-"`
	AllowedTools []string `json:"-"`
	MaxSteps     int      `json:"-"`
	FilePolicy   string   `json:"-"`
}

type SkillRegistry struct {
	items map[string]Skill
}

func NewSkillRegistry(tools *Registry, skills ...Skill) (*SkillRegistry, error) {
	registry := &SkillRegistry{items: make(map[string]Skill, len(skills))}
	for _, skill := range skills {
		skill.ID = strings.TrimSpace(skill.ID)
		skill.Name = strings.TrimSpace(skill.Name)
		skill.Description = strings.TrimSpace(skill.Description)
		skill.Instructions = strings.TrimSpace(skill.Instructions)
		if !pluginIDPattern.MatchString(skill.ID) || skill.Name == "" || skill.Instructions == "" {
			return nil, fmt.Errorf("invalid assistant skill %q", skill.ID)
		}
		if _, exists := registry.items[skill.ID]; exists {
			return nil, fmt.Errorf("assistant skill %s is already registered", skill.ID)
		}
		for _, tool := range skill.AllowedTools {
			if tools == nil || !tools.Has(tool) {
				return nil, fmt.Errorf("assistant skill %s references unknown tool %s", skill.ID, tool)
			}
		}
		if skill.MaxSteps <= 0 {
			skill.MaxSteps = 4
		}
		if skill.MaxSteps > 12 {
			return nil, fmt.Errorf("assistant skill %s exceeds the step limit", skill.ID)
		}
		registry.items[skill.ID] = skill
	}
	return registry, nil
}

func (r *SkillRegistry) Resolve(id string, hasFiles bool) (Skill, error) {
	if r == nil {
		return Skill{}, errors.New("assistant skill registry is nil")
	}
	id = strings.TrimSpace(id)
	if id == "" {
		if hasFiles {
			id = SkillDocumentAnalysis
		} else {
			id = SkillGeneral
		}
	}
	skill, ok := r.items[id]
	if !ok {
		return Skill{}, fmt.Errorf("assistant skill %s is not available", id)
	}
	return skill, nil
}

func (r *SkillRegistry) Public() []Skill {
	if r == nil {
		return []Skill{}
	}
	out := make([]Skill, 0, len(r.items))
	for _, skill := range r.items {
		skill.Instructions = ""
		skill.AllowedTools = nil
		skill.MaxSteps = 0
		skill.FilePolicy = ""
		out = append(out, skill)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}
