package httpapi

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

var (
	canvasTemplateSlugPattern   = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,79}$`)
	canvasTemplateAccentPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
)

type canvasTemplateDocument struct {
	Version        int               `json:"version"`
	Nodes          []json.RawMessage `json:"nodes"`
	Connections    []json.RawMessage `json:"connections"`
	BackgroundMode string            `json:"backgroundMode,omitempty"`
	ShowImageInfo  bool              `json:"showImageInfo,omitempty"`
	Viewport       json.RawMessage   `json:"viewport,omitempty"`
}

type canvasTemplateNode struct {
	ID       string                 `json:"id"`
	Type     string                 `json:"type"`
	Title    string                 `json:"title"`
	Position canvasTemplatePosition `json:"position"`
	Width    float64                `json:"width"`
	Height   float64                `json:"height"`
}

type canvasTemplatePosition struct {
	X *float64 `json:"x"`
	Y *float64 `json:"y"`
}

type canvasTemplateViewport struct {
	X *float64 `json:"x"`
	Y *float64 `json:"y"`
	K *float64 `json:"k"`
}

type canvasTemplateConnection struct {
	ID         string `json:"id"`
	FromNodeID string `json:"fromNodeId"`
	ToNodeID   string `json:"toNodeId"`
}

type canvasTemplateInput struct {
	Slug          string          `json:"slug"`
	Title         string          `json:"title"`
	Category      string          `json:"category"`
	CategoryLabel string          `json:"categoryLabel"`
	Industry      string          `json:"industry"`
	Summary       string          `json:"summary"`
	Platforms     []string        `json:"platforms"`
	Deliverables  []string        `json:"deliverables"`
	Accent        string          `json:"accent"`
	Document      json.RawMessage `json:"document"`
	Enabled       *bool           `json:"enabled"`
	Sort          int             `json:"sort"`
}

type canvasTemplatePatchInput struct {
	Slug          *string          `json:"slug"`
	Title         *string          `json:"title"`
	Category      *string          `json:"category"`
	CategoryLabel *string          `json:"categoryLabel"`
	Industry      *string          `json:"industry"`
	Summary       *string          `json:"summary"`
	Platforms     *[]string        `json:"platforms"`
	Deliverables  *[]string        `json:"deliverables"`
	Accent        *string          `json:"accent"`
	Document      *json.RawMessage `json:"document"`
	Enabled       *bool            `json:"enabled"`
	Sort          *int             `json:"sort"`
}

func validateCanvasTemplateText(value, field string, minLength, maxLength int) (string, error) {
	value = strings.TrimSpace(value)
	length := len([]rune(value))
	if length < minLength || length > maxLength {
		return "", apperr.E("validation_error", field+": 长度无效", 422)
	}
	return value, nil
}

func validateCanvasTemplateStrings(values []string, field string) ([]string, error) {
	if len(values) > 20 {
		return nil, apperr.E("validation_error", field+": 最多 20 项", 422)
	}
	result := make([]string, 0, len(values))
	for _, value := range values {
		clean, err := validateCanvasTemplateText(value, field, 1, 80)
		if err != nil {
			return nil, err
		}
		result = append(result, clean)
	}
	return result, nil
}

func validateCanvasTemplateDocument(raw json.RawMessage) (json.RawMessage, int, error) {
	if len(raw) == 0 || len(raw) > 1<<20 {
		return nil, 0, apperr.E("validation_error", "document: 文件无效或超过 1 MiB", 422)
	}
	var document canvasTemplateDocument
	if err := json.Unmarshal(raw, &document); err != nil || document.Version != 3 {
		return nil, 0, apperr.E("validation_error", "document: 只支持画布 v3 JSON", 422)
	}
	if document.Nodes == nil || document.Connections == nil || len(document.Nodes) < 1 || len(document.Nodes) > 1000 || len(document.Connections) > 5000 {
		return nil, 0, apperr.E("validation_error", "document: 节点或连线数量无效", 422)
	}
	if document.BackgroundMode != "" && document.BackgroundMode != "dots" && document.BackgroundMode != "lines" && document.BackgroundMode != "blank" {
		return nil, 0, apperr.E("validation_error", "document: 背景模式无效", 422)
	}
	if len(document.Viewport) > 0 {
		var viewport canvasTemplateViewport
		if err := json.Unmarshal(document.Viewport, &viewport); err != nil || viewport.X == nil || viewport.Y == nil || viewport.K == nil || *viewport.K <= 0 {
			return nil, 0, apperr.E("validation_error", "document: 视口格式无效", 422)
		}
	}
	nodeIDs := make(map[string]bool, len(document.Nodes))
	for _, rawNode := range document.Nodes {
		var node canvasTemplateNode
		if err := json.Unmarshal(rawNode, &node); err != nil || strings.TrimSpace(node.ID) == "" || len(node.ID) > 200 ||
			strings.TrimSpace(node.Type) == "" || len(node.Type) > 200 || strings.TrimSpace(node.Title) == "" ||
			node.Position.X == nil || node.Position.Y == nil || node.Width <= 0 || node.Height <= 0 {
			return nil, 0, apperr.E("validation_error", "document: 节点格式无效", 422)
		}
		if nodeIDs[node.ID] {
			return nil, 0, apperr.E("validation_error", "document: 节点 ID 重复", 422)
		}
		nodeIDs[node.ID] = true
	}
	connectionIDs := make(map[string]bool, len(document.Connections))
	for _, rawConnection := range document.Connections {
		var connection canvasTemplateConnection
		if err := json.Unmarshal(rawConnection, &connection); err != nil || strings.TrimSpace(connection.ID) == "" || len(connection.ID) > 200 ||
			connectionIDs[connection.ID] || !nodeIDs[connection.FromNodeID] || !nodeIDs[connection.ToNodeID] {
			return nil, 0, apperr.E("validation_error", "document: 连线格式无效", 422)
		}
		connectionIDs[connection.ID] = true
	}
	normalized, err := json.Marshal(document)
	if err != nil {
		return nil, 0, err
	}
	return normalized, len(document.Nodes), nil
}

func canvasTemplateJSON(item *store.CanvasWorkflowTemplate, includeDocument bool) gin.H {
	result := gin.H{
		"id": item.ID.String(), "slug": item.Slug, "title": item.Title, "category": item.Category,
		"categoryLabel": item.CategoryLabel, "industry": item.Industry, "summary": item.Summary,
		"platforms": item.Platforms, "deliverables": item.Deliverables, "accent": item.Accent,
		"nodeCount": item.NodeCount, "enabled": item.Enabled, "sort": item.Sort,
		"createdAt": isoValue(item.CreatedAt), "updatedAt": isoValue(item.UpdatedAt),
	}
	if includeDocument {
		result["document"] = item.Document
	}
	return result
}

func (s *Server) publicCanvasWorkflowTemplates(c *gin.Context) {
	items, err := store.ListCanvasWorkflowTemplates(c.Request.Context(), s.St.Pool, false)
	if err != nil {
		fail(c, err)
		return
	}
	result := make([]gin.H, 0, len(items))
	for _, item := range items {
		result = append(result, canvasTemplateJSON(item, false))
	}
	ok(c, gin.H{"items": result})
}

func (s *Server) publicCanvasWorkflowTemplate(c *gin.Context) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	item, err := store.GetCanvasWorkflowTemplate(c.Request.Context(), s.St.Pool, id, true)
	if err != nil {
		fail(c, err)
		return
	}
	if item == nil {
		fail(c, apperr.E("not_found", "画布模板不存在", 404))
		return
	}
	ok(c, canvasTemplateJSON(item, true))
}

func (s *Server) adminCanvasWorkflowTemplates(c *gin.Context, _ *store.User) {
	items, err := store.ListCanvasWorkflowTemplates(c.Request.Context(), s.St.Pool, true)
	if err != nil {
		fail(c, err)
		return
	}
	result := make([]gin.H, 0, len(items))
	for _, item := range items {
		result = append(result, canvasTemplateJSON(item, false))
	}
	ok(c, gin.H{"items": result})
}

func normalizeCanvasTemplateInput(in *canvasTemplateInput) (*store.CanvasWorkflowTemplate, error) {
	if !canvasTemplateSlugPattern.MatchString(strings.TrimSpace(in.Slug)) {
		return nil, apperr.E("validation_error", "slug: 仅支持小写字母、数字和连字符", 422)
	}
	title, err := validateCanvasTemplateText(in.Title, "title", 1, 120)
	if err != nil {
		return nil, err
	}
	category, err := validateCanvasTemplateText(in.Category, "category", 1, 60)
	if err != nil {
		return nil, err
	}
	categoryLabel, err := validateCanvasTemplateText(in.CategoryLabel, "categoryLabel", 1, 60)
	if err != nil {
		return nil, err
	}
	industry, err := validateCanvasTemplateText(in.Industry, "industry", 0, 80)
	if err != nil {
		return nil, err
	}
	summary, err := validateCanvasTemplateText(in.Summary, "summary", 0, 500)
	if err != nil {
		return nil, err
	}
	platforms, err := validateCanvasTemplateStrings(in.Platforms, "platforms")
	if err != nil {
		return nil, err
	}
	deliverables, err := validateCanvasTemplateStrings(in.Deliverables, "deliverables")
	if err != nil {
		return nil, err
	}
	accent := strings.TrimSpace(in.Accent)
	if accent == "" {
		accent = "#6d5cff"
	}
	if !canvasTemplateAccentPattern.MatchString(accent) {
		return nil, apperr.E("validation_error", "accent: 必须是六位十六进制颜色", 422)
	}
	document, nodeCount, err := validateCanvasTemplateDocument(in.Document)
	if err != nil {
		return nil, err
	}
	platformJSON, _ := json.Marshal(platforms)
	deliverableJSON, _ := json.Marshal(deliverables)
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}
	return &store.CanvasWorkflowTemplate{Slug: strings.TrimSpace(in.Slug), Title: title, Category: category, CategoryLabel: categoryLabel,
		Industry: industry, Summary: summary, Platforms: platformJSON, Deliverables: deliverableJSON, Accent: accent,
		Document: document, NodeCount: nodeCount, Enabled: enabled, Sort: in.Sort}, nil
}

func (s *Server) adminCreateCanvasWorkflowTemplate(c *gin.Context, _ *store.User) {
	var in canvasTemplateInput
	if err := bindJSON(c, &in); err != nil {
		fail(c, err)
		return
	}
	item, err := normalizeCanvasTemplateInput(&in)
	if err != nil {
		fail(c, err)
		return
	}
	created, err := store.CreateCanvasWorkflowTemplate(c.Request.Context(), s.St.Pool, item)
	if err != nil {
		if store.IsUniqueViolation(err, "canvas_workflow_templates_slug_key") {
			fail(c, apperr.E("validation_error", "slug: 模板标识已存在", 409))
			return
		}
		fail(c, err)
		return
	}
	respondCreated(c, canvasTemplateJSON(created, true))
}

func (s *Server) adminPatchCanvasWorkflowTemplate(c *gin.Context, _ *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	var in canvasTemplatePatchInput
	if err := bindJSON(c, &in); err != nil {
		fail(c, err)
		return
	}
	patch := store.CanvasWorkflowTemplatePatch{Enabled: in.Enabled, Sort: in.Sort}
	if in.Slug != nil {
		value := strings.TrimSpace(*in.Slug)
		if !canvasTemplateSlugPattern.MatchString(value) {
			fail(c, apperr.E("validation_error", "slug: 格式无效", 422))
			return
		}
		patch.Slug = &value
	}
	textFields := []struct {
		input    *string
		field    string
		min, max int
		target   **string
	}{
		{in.Title, "title", 1, 120, &patch.Title}, {in.Category, "category", 1, 60, &patch.Category},
		{in.CategoryLabel, "categoryLabel", 1, 60, &patch.CategoryLabel}, {in.Industry, "industry", 0, 80, &patch.Industry},
		{in.Summary, "summary", 0, 500, &patch.Summary},
	}
	for _, field := range textFields {
		if field.input == nil {
			continue
		}
		value, validationErr := validateCanvasTemplateText(*field.input, field.field, field.min, field.max)
		if validationErr != nil {
			fail(c, validationErr)
			return
		}
		*field.target = &value
	}
	if in.Platforms != nil {
		values, validationErr := validateCanvasTemplateStrings(*in.Platforms, "platforms")
		if validationErr != nil {
			fail(c, validationErr)
			return
		}
		patch.Platforms, _ = json.Marshal(values)
	}
	if in.Deliverables != nil {
		values, validationErr := validateCanvasTemplateStrings(*in.Deliverables, "deliverables")
		if validationErr != nil {
			fail(c, validationErr)
			return
		}
		patch.Deliverables, _ = json.Marshal(values)
	}
	if in.Accent != nil {
		value := strings.TrimSpace(*in.Accent)
		if !canvasTemplateAccentPattern.MatchString(value) {
			fail(c, apperr.E("validation_error", "accent: 格式无效", 422))
			return
		}
		patch.Accent = &value
	}
	if in.Document != nil {
		document, nodeCount, validationErr := validateCanvasTemplateDocument(*in.Document)
		if validationErr != nil {
			fail(c, validationErr)
			return
		}
		patch.Document = document
		patch.NodeCount = &nodeCount
	}
	item, err := store.UpdateCanvasWorkflowTemplate(c.Request.Context(), s.St.Pool, id, patch)
	if err != nil {
		if store.IsUniqueViolation(err, "canvas_workflow_templates_slug_key") {
			fail(c, apperr.E("validation_error", "slug: 模板标识已存在", 409))
			return
		}
		fail(c, err)
		return
	}
	if item == nil {
		fail(c, apperr.E("not_found", "画布模板不存在", 404))
		return
	}
	ok(c, canvasTemplateJSON(item, true))
}

func (s *Server) adminDeleteCanvasWorkflowTemplate(c *gin.Context, _ *store.User) {
	id, err := parseUUIDParam(c, "id")
	if err != nil {
		fail(c, err)
		return
	}
	deleted, err := store.DeleteCanvasWorkflowTemplate(c.Request.Context(), s.St.Pool, id)
	if err != nil {
		fail(c, err)
		return
	}
	if !deleted {
		fail(c, apperr.E("not_found", "画布模板不存在", 404))
		return
	}
	c.Status(204)
}
