package assistanttools

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/BlankLife886/startcloudsai/server/internal/commerceset"
	"github.com/BlankLife886/startcloudsai/server/internal/media"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

const (
	ToolCompetitorAnalyze = "competitor_analyze"
	// maxCompetitorTiles bounds what one analysis sends the vision model.
	maxCompetitorTiles = 16
)

func competitorAnalyzeDefinition(service commerceset.Service, turn CommerceSetContext) Definition {
	return Definition{
		Name: ToolCompetitorAnalyze,
		Description: "拆解竞品截图的视觉打法（图片顺序、构图版式、配色、光线、文字排版、文案写法），用于“照着竞品做”。不花积分。" +
			"images 填本轮附图里属于竞品截图的序号（按上传顺序从 1 开始），用户自己的商品图不要填。返回 competitorRefId，出方案时传给 commerce_set_plan。",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"images": map[string]any{"type": "array", "minItems": 1, "maxItems": 10,
					"items": map[string]any{"type": "integer", "minimum": 1}},
				"note": map[string]any{"type": "string", "maxLength": 300, "description": "用户特别想参考的地方，没有就留空"},
			},
			"required":             []any{"images"},
			"additionalProperties": false,
		},
		Permissions:    []Permission{PermissionCommerceSets},
		Risk:           RiskRead,
		Level:          LevelRead,
		Timeout:        120 * time.Second,
		MaxResultBytes: 64 << 10,
		Execute: func(ctx context.Context, invocation Invocation) (Result, error) {
			var input struct {
				Images []int  `json:"images"`
				Note   string `json:"note"`
			}
			if err := json.Unmarshal(invocation.Arguments, &input); err != nil {
				return Result{}, errors.New("参数格式不正确")
			}
			return analyzeCompetitor(ctx, service, invocation.UserID, turn, input.Images, input.Note)
		},
	}
}

func analyzeCompetitor(ctx context.Context, service commerceset.Service, userID uuid.UUID, turn CommerceSetContext, indexes []int, note string) (Result, error) {
	if turn.Vision == nil || len(turn.Attachments) == 0 {
		return Result{}, errors.New("本轮没有可分析的截图，请把竞品的主图或详情页截图发过来")
	}
	picked := []Attachment{}
	seen := map[int]bool{}
	for _, index := range indexes {
		if index < 1 || index > len(turn.Attachments) {
			return Result{}, fmt.Errorf("本轮只有 %d 张图，序号 %d 不存在", len(turn.Attachments), index)
		}
		if !seen[index] {
			seen[index] = true
			picked = append(picked, turn.Attachments[index-1])
		}
	}
	if len(picked) == 0 {
		return Result{}, errors.New("请指出哪几张是竞品截图")
	}
	tiles, err := competitorTiles(picked)
	if err != nil {
		return Result{}, err
	}
	prompt := commerceset.CompetitorPrompt(len(tiles), note)
	reply, err := turn.Vision(ctx, prompt, tiles)
	style, parseErr := (*commerceset.CompetitorStyle)(nil), err
	if err == nil {
		style, parseErr = commerceset.ParseCompetitorStyle(reply)
		if parseErr != nil && ctx.Err() == nil {
			// One more try: the model sometimes wraps or truncates the JSON.
			if reply, err = turn.Vision(ctx, prompt+"\n\n上一次的回复不是合法 JSON，请严格只返回上面格式的 JSON。", tiles); err == nil {
				style, parseErr = commerceset.ParseCompetitorStyle(reply)
			} else {
				parseErr = err
			}
		}
	}
	if parseErr != nil {
		return Result{}, fmt.Errorf("竞品截图分析失败：%v", parseErr)
	}
	keys := []string{}
	images := []map[string]any{}
	for _, attachment := range picked {
		if attachment.Key != "" {
			keys = append(keys, attachment.Key)
			images = append(images, map[string]any{"url": "/api/v1/files/" + attachment.Key})
		}
	}
	raw, err := json.Marshal(style)
	if err != nil {
		return Result{}, err
	}
	ref, err := store.InsertCompetitorRef(ctx, service.St.Pool, &store.CompetitorRef{
		UserID: userID, ConversationID: turn.ConversationID, ImageKeys: keys, Style: raw,
	})
	if err != nil {
		return Result{}, err
	}
	payload := map[string]any{"competitorRefId": ref.ID.String(), "style": style, "screenshots": len(picked)}
	if style.NotListing {
		payload["notListing"] = true
	}
	content, err := json.Marshal(payload)
	if err != nil {
		return Result{}, err
	}
	slots := make([]map[string]any, 0, len(style.Slots))
	for _, slot := range style.Slots {
		label := slot.Type
		if item, ok := commerceset.TypeByID(slot.Type); ok {
			label = item.Label
		}
		slots = append(slots, map[string]any{"type": slot.Type, "label": label, "purpose": slot.Purpose, "layout": slot.Layout, "copyPattern": slot.CopyPattern})
	}
	view := map[string]any{"id": ref.ID.String(), "style": style, "slots": slots, "images": images}
	return Result{Content: string(content), Meta: map[string]any{"view": "competitor_style", "data": view}}, nil
}

// competitorTiles cuts the screenshots into screens the vision model can
// read, sharing the tile budget between them.
func competitorTiles(picked []Attachment) ([]string, error) {
	perImage := max(2, maxCompetitorTiles/len(picked))
	out := []string{}
	for _, attachment := range picked {
		data, err := decodeDataURL(attachment.DataURL)
		if err != nil {
			return nil, errors.New("有一张截图读取失败，请重新上传")
		}
		tiles, err := media.ScreenshotTiles(data, min(perImage, maxCompetitorTiles-len(out)))
		if err != nil {
			return nil, errors.New("有一张截图无法识别，请换成 PNG 或 JPG 截图")
		}
		for _, tile := range tiles {
			out = append(out, "data:image/jpeg;base64,"+base64.StdEncoding.EncodeToString(tile))
		}
		if len(out) >= maxCompetitorTiles {
			break
		}
	}
	return out, nil
}

func decodeDataURL(value string) ([]byte, error) {
	comma := strings.Index(value, ",")
	if !strings.HasPrefix(value, "data:") || comma < 0 || !strings.Contains(value[:comma], ";base64") {
		return nil, errors.New("not a base64 data URL")
	}
	return base64.StdEncoding.DecodeString(value[comma+1:])
}

// planCompetitor prepares a plan for 照着竞品做: it loads the named analysis,
// keeps every competitor screenshot of the conversation out of the product
// references, and lets the copy planner see only the user's own photos.
func planCompetitor(ctx context.Context, service commerceset.Service, userID uuid.UUID, turn CommerceSetContext, in *commerceset.PlanInput) error {
	if id := strings.TrimSpace(in.Brief.CompetitorRefID); id != "" {
		refID, err := uuid.Parse(id)
		if err != nil {
			return commerceset.ErrInvalid
		}
		ref, err := store.GetUserCompetitorRef(ctx, service.St.Pool, userID, refID)
		if err != nil {
			return err
		}
		if ref == nil {
			return fmt.Errorf("%w: 找不到这份竞品分析，请重新发竞品截图", commerceset.ErrInvalid)
		}
		in.Competitor = ref
	}
	drop := []string{}
	if turn.ConversationID != nil {
		keys, err := store.ConversationCompetitorKeys(ctx, service.St.Pool, userID, *turn.ConversationID)
		if err != nil {
			return err
		}
		drop = keys
	}
	if in.Competitor != nil {
		drop = append(drop, in.Competitor.ImageKeys...)
	}
	in.InputKeys = commerceset.WithoutKeys(in.InputKeys, drop)
	if len(in.InputKeys) == 0 && len(drop) > 0 {
		return fmt.Errorf("%w: 竞品截图只用来参考风格，还需要上传你自己的商品图", commerceset.ErrInvalid)
	}
	if turn.Vision != nil {
		product := map[string]bool{}
		for _, key := range in.InputKeys {
			product[key] = true
		}
		images := []string{}
		for _, attachment := range turn.Attachments {
			if attachment.Key != "" && product[attachment.Key] {
				images = append(images, attachment.DataURL)
			}
		}
		in.Copy = nil
		if len(images) > 0 {
			vision := turn.Vision
			in.Copy = func(ctx context.Context, prompt string) (string, error) { return vision(ctx, prompt, images) }
		}
	}
	return nil
}
