package assistanttools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

// ask_choices: before making something, when a key choice is missing and a
// default would likely be wrong, the model shows a card of options (size,
// style, platform…). The user taps their picks and sends them as the next
// message; the turn ends with the card.

const (
	ToolAskChoices = "ask_choices"
	DomainAsk      = "ask"

	askMaxGroups  = 4
	askMinOptions = 2
	askMaxOptions = 6
)

type askChoiceGroup struct {
	ID       string   `json:"id"`
	Label    string   `json:"label"`
	Options  []string `json:"options"`
	Multiple bool     `json:"multiple,omitempty"`
}

type askChoices struct {
	Title       string           `json:"title"`
	Groups      []askChoiceGroup `json:"groups"`
	SubmitLabel string           `json:"submitLabel,omitempty"`
}

func clip(value string, max int) string {
	value = strings.Join(strings.Fields(value), " ")
	if utf8.RuneCountInString(value) <= max {
		return value
	}
	return string([]rune(value)[:max])
}

func normalizeAskChoices(raw json.RawMessage) (askChoices, error) {
	var in askChoices
	if err := json.Unmarshal(raw, &in); err != nil {
		return askChoices{}, errors.New("选择卡参数格式不正确")
	}
	out := askChoices{Title: clip(in.Title, 40), SubmitLabel: clip(in.SubmitLabel, 12)}
	if out.Title == "" {
		out.Title = "先确认几项"
	}
	seen := map[string]bool{}
	for _, group := range in.Groups {
		if len(out.Groups) == askMaxGroups {
			break
		}
		label := clip(group.Label, 12)
		id := clip(group.ID, 32)
		if id == "" {
			id = label
		}
		if label == "" || seen[id] {
			continue
		}
		options := []string{}
		taken := map[string]bool{}
		for _, option := range group.Options {
			option = clip(option, 16)
			if option == "" || taken[option] {
				continue
			}
			taken[option] = true
			options = append(options, option)
			if len(options) == askMaxOptions {
				break
			}
		}
		if len(options) < askMinOptions {
			continue
		}
		seen[id] = true
		out.Groups = append(out.Groups, askChoiceGroup{ID: id, Label: label, Options: options, Multiple: group.Multiple})
	}
	if len(out.Groups) == 0 {
		return askChoices{}, errors.New("选择卡至少要有一组、每组至少两个选项")
	}
	return out, nil
}

// NewAskChoicesManifest is offered in Agent mode only.
func NewAskChoicesManifest() Manifest {
	return Manifest{
		ID:          DomainAsk,
		Version:     "1",
		Description: "出图前让用户点选关键选项",
		Tools: []Definition{{
			Name: ToolAskChoices,
			Description: "出图或做方案前，关键选择缺失、而且用默认值很可能做错时（例如用户要一张“海报”却没说用在哪个平台、什么尺寸），用选择卡让用户一次点选。" +
				"只问真正影响结果的 1～4 项，每项给 2～6 个简短选项，最可能的放第一个；能从对话推断的不要问；同一个对话里问过的不要再问。" +
				"调用后用一句话说明为什么要先确认，然后结束本轮，等用户选完再继续，不要接着出方案或出图。",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"title": map[string]any{"type": "string", "maxLength": 40, "description": "卡片标题，如“出图前确认几项”"},
					"groups": map[string]any{
						"type": "array", "minItems": 1, "maxItems": askMaxGroups,
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"id":       map[string]any{"type": "string", "maxLength": 32},
								"label":    map[string]any{"type": "string", "maxLength": 12, "description": "如“尺寸”“风格”“平台”"},
								"options":  map[string]any{"type": "array", "minItems": askMinOptions, "maxItems": askMaxOptions, "items": map[string]any{"type": "string", "maxLength": 16}},
								"multiple": map[string]any{"type": "boolean", "description": "可以多选时为 true"},
							},
							"required":             []any{"label", "options"},
							"additionalProperties": false,
						},
					},
					"submitLabel": map[string]any{"type": "string", "maxLength": 12, "description": "提交按钮文字，如“按这个出图”"},
				},
				"required":             []any{"groups"},
				"additionalProperties": false,
			},
			Risk:           RiskRead,
			Level:          LevelRead,
			Timeout:        5 * time.Second,
			MaxResultBytes: 8 << 10,
			Execute: func(_ context.Context, invocation Invocation) (Result, error) {
				choices, err := normalizeAskChoices(invocation.Arguments)
				if err != nil {
					content, _ := json.Marshal(map[string]any{"error": err.Error()})
					return Result{Content: string(content), Meta: map[string]any{"invalid": true}}, nil
				}
				return Result{
					Content: "选择卡已经展示给用户。用一句话说明为什么要先确认，然后结束本轮，等用户选完再继续。",
					Meta:    map[string]any{"view": "choices", "data": choices},
				}, nil
			},
		}},
	}
}
