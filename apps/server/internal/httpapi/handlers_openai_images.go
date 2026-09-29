package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// openAIImageWaitTimeout bounds how long one /v1 image request waits for the
// upstream; clients and proxies should allow at least 270 seconds.
const openAIImageWaitTimeout = 240 * time.Second

type openAIModelObject struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	OwnedBy string `json:"owned_by"`
}

func openAIPublicModelID(model modelconfig.Model) string {
	// Wire id is the admin-configured display name so OpenAI clients can pass
	// model="gpt-image-2" instead of an internal UUID. Names are expected to be
	// unique among developer-API image models.
	return strings.TrimSpace(model.Name)
}

// developerAPIOffers reports whether /v1 may run the selection for the Key:
// the admin offered the model to the API, it is available, it is routed to an
// OpenAI-wire provider (CRUN is an asynchronous task protocol and cannot
// satisfy the synchronous /v1 contract), and the Key's model list allows it.
func developerAPIOffers(selected modelconfig.Selection, key *store.UserAPIKey) bool {
	model := selected.Model
	if !model.DeveloperAPI || !model.Available() || selected.Provider.Adapter != modelconfig.AdapterOpenAI {
		return false
	}
	return key == nil || len(key.AllowedModelIDs) == 0 || store.Contains(key.AllowedModelIDs, model.ID)
}

func openAIFilterPublicModels(cfg modelconfig.Config, key *store.UserAPIKey, workspace, kind string) []modelconfig.Model {
	models := make([]modelconfig.Model, 0)
	seenNames := make(map[string]struct{})
	for _, selected := range modelconfig.PublicModelsForWorkspace(cfg, workspace, kind) {
		if !developerAPIOffers(selected, key) {
			continue
		}
		model := selected.Model
		publicID := openAIPublicModelID(model)
		if publicID == "" {
			continue
		}
		if _, exists := seenNames[publicID]; exists {
			continue
		}
		seenNames[publicID] = struct{}{}
		models = append(models, model)
	}
	return models
}

func openAIImageModels(cfg modelconfig.Config, key *store.UserAPIKey) []modelconfig.Model {
	return openAIFilterPublicModels(cfg, key, modelconfig.WorkspaceT2I, modelconfig.ModelKindImage)
}

func openAIChatModels(cfg modelconfig.Config, key *store.UserAPIKey) []modelconfig.Model {
	return openAIFilterPublicModels(cfg, key, modelconfig.WorkspaceAssistant, modelconfig.ModelKindChat)
}

// openAIDeveloperModels returns the combined /v1/models catalog (image + chat),
// deduped by public display name.
func openAIDeveloperModels(cfg modelconfig.Config, key *store.UserAPIKey) []modelconfig.Model {
	models := openAIImageModels(cfg, key)
	seenNames := make(map[string]struct{}, len(models))
	for _, model := range models {
		seenNames[openAIPublicModelID(model)] = struct{}{}
	}
	for _, model := range openAIChatModels(cfg, key) {
		publicID := openAIPublicModelID(model)
		if _, exists := seenNames[publicID]; exists {
			continue
		}
		seenNames[publicID] = struct{}{}
		models = append(models, model)
	}
	return models
}

func openAIChatSelections(cfg modelconfig.Config, key *store.UserAPIKey) []modelconfig.Selection {
	selections := make([]modelconfig.Selection, 0)
	seenNames := make(map[string]struct{})
	for _, selected := range modelconfig.PublicModelsForWorkspace(cfg, modelconfig.WorkspaceAssistant, modelconfig.ModelKindChat) {
		if !developerAPIOffers(selected, key) {
			continue
		}
		publicID := openAIPublicModelID(selected.Model)
		if publicID == "" {
			continue
		}
		if _, exists := seenNames[publicID]; exists {
			continue
		}
		seenNames[publicID] = struct{}{}
		selections = append(selections, selected)
	}
	return selections
}

// matchOpenAIImageModel finds the model whose /v1 name equals requested. There
// is no fallback: a caller who asks for a model gets that model or a 404.
func matchOpenAIImageModel(models []modelconfig.Model, requested string) *modelconfig.Model {
	for index := range models {
		if openAIWireModelEqual(openAIPublicModelID(models[index]), requested) {
			return &models[index]
		}
	}
	return nil
}

// matchOpenAIChatSelection finds the chat model whose /v1 name equals
// requested, with no fallback to a default model.
func matchOpenAIChatSelection(selections []modelconfig.Selection, requested string) *modelconfig.Selection {
	for index := range selections {
		if openAIWireModelEqual(openAIPublicModelID(selections[index].Model), requested) {
			return &selections[index]
		}
	}
	return nil
}

// openAIWireModelEqual treats '.' and '-' as interchangeable so clients can
// request gpt-5.5 while the catalog name is gpt-5-5.
func openAIWireModelEqual(left, right string) bool {
	normalize := func(value string) string {
		value = strings.ToLower(strings.TrimSpace(value))
		return strings.ReplaceAll(value, ".", "-")
	}
	return normalize(left) == normalize(right)
}

func asOpenAIModel(model modelconfig.Model) openAIModelObject {
	// This catalog has no model-created timestamp; zero explicitly denotes unknown.
	return openAIModelObject{ID: openAIPublicModelID(model), Object: "model", Created: 0, OwnedBy: "starcloudsai"}
}

func (s *Server) openAIModels(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	cfg, err := modelconfig.Load(c.Request.Context(), s.St.Pool)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	items := make([]openAIModelObject, 0)
	for _, model := range openAIDeveloperModels(cfg, openAPIKeyFromContext(c)) {
		items = append(items, asOpenAIModel(model))
	}
	c.JSON(http.StatusOK, gin.H{"object": "list", "data": items})
}

func (s *Server) openAIModel(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	cfg, err := modelconfig.Load(c.Request.Context(), s.St.Pool)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	if model := matchOpenAIImageModel(openAIDeveloperModels(cfg, openAPIKeyFromContext(c)), c.Param("model")); model != nil {
		c.JSON(http.StatusOK, asOpenAIModel(*model))
		return
	}
	failOpenAI(c, modelNotFoundError(c.Param("model")), "model")
}

func failOpenAIImage(c *gin.Context, err error) {
	var parameter *openAIParameterError
	if errors.As(err, &parameter) {
		failOpenAI(c, apperr.E(parameter.Code, parameter.Message, http.StatusBadRequest), parameter.Param)
		return
	}
	failOpenAI(c, err, "")
}

func (s *Server) openAIGenerateImage(c *gin.Context) { s.openAIImage(c, false) }
func (s *Server) openAIEditImage(c *gin.Context)     { s.openAIImage(c, true) }

type openAIImageData struct {
	B64JSON string `json:"b64_json,omitempty"`
	URL     string `json:"url,omitempty"`
}

type openAIImageResponse struct {
	Created int64             `json:"created"`
	Data    []openAIImageData `json:"data"`
}
