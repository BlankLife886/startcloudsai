package httpapi

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/BlankLife886/startcloudsai/server/internal/apperr"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
	"github.com/BlankLife886/startcloudsai/server/internal/trialfeature"
	"github.com/BlankLife886/startcloudsai/server/internal/wallet"
)

const openAPIResponsesChatSourceType = "open_api_responses_chat"

type openAIResponsesRequest struct {
	Model              string            `json:"model"`
	Input              json.RawMessage   `json:"input"`
	Tools              []json.RawMessage `json:"tools"`
	Stream             bool              `json:"stream"`
	PreviousResponseID string            `json:"previous_response_id"`
	Metadata           map[string]string `json:"metadata"`
}

type openAIResponsesImageTool struct {
	Type          string `json:"type"`
	Model         string `json:"model"`
	Size          string `json:"size"`
	Quality       string `json:"quality"`
	OutputFormat  string `json:"output_format"`
	Background    string `json:"background"`
	Moderation    string `json:"moderation"`
	PartialImages int    `json:"partial_images"`
}

type openAIResponsesImageInput struct {
	Name        string
	ContentType string
	Data        []byte
}

type openAIResponsesImageCall struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	Status string `json:"status"`
	Result string `json:"result"`
}

type openAIResponsesObject struct {
	ID                string            `json:"id"`
	Object            string            `json:"object"`
	CreatedAt         int64             `json:"created_at"`
	CompletedAt       int64             `json:"completed_at"`
	Status            string            `json:"status"`
	Error             any               `json:"error"`
	Model             string            `json:"model"`
	Output            []any             `json:"output"`
	OutputText        string            `json:"output_text"`
	Metadata          map[string]string `json:"metadata"`
	ParallelToolCalls bool              `json:"parallel_tool_calls"`
	Usage             gin.H             `json:"usage"`
}

func decodeOpenAIResponsesRequest(request *http.Request) (openAIResponsesRequest, error) {
	var result openAIResponsesRequest
	decoder := json.NewDecoder(request.Body)
	if err := decoder.Decode(&result); err != nil {
		return result, imageParameterError("body", "Invalid Responses API request body.")
	}
	if strings.TrimSpace(result.PreviousResponseID) != "" {
		return result, imageParameterError("previous_response_id", "previous_response_id is not supported by this Responses endpoint.")
	}
	return result, nil
}

func selectOpenAIResponsesImageTool(rawTools []json.RawMessage) (openAIResponsesImageTool, bool, error) {
	var selected *openAIResponsesImageTool
	for _, raw := range rawTools {
		var tool openAIResponsesImageTool
		if err := json.Unmarshal(raw, &tool); err != nil || strings.TrimSpace(tool.Type) == "" {
			return tool, false, imageParameterError("tools", "Invalid tool definition.")
		}
		if tool.Type != "image_generation" {
			// Codex sends its complete tool catalog to Responses providers. This
			// endpoint ignores tools it cannot execute as long as routing can
			// decide between image_generation and plain chat.
			continue
		}
		if selected != nil {
			return tool, false, imageParameterError("tools", "Provide exactly one image_generation tool.")
		}
		copy := tool
		selected = &copy
	}
	if selected == nil {
		return openAIResponsesImageTool{}, false, nil
	}
	if selected.PartialImages < 0 || selected.PartialImages > 3 {
		return *selected, true, imageParameterError("tools.partial_images", "partial_images must be between 0 and 3.")
	}
	return *selected, true, nil
}

func parseOpenAIResponsesInput(raw json.RawMessage) (string, []openAIResponsesImageInput, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", nil, imageParameterError("input", "input is required.")
	}
	var direct string
	if json.Unmarshal(raw, &direct) == nil {
		direct = strings.TrimSpace(direct)
		if direct == "" {
			return "", nil, imageParameterError("input", "input must include text.")
		}
		return direct, nil, nil
	}
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return "", nil, imageParameterError("input", "input must be a string or Responses input array.")
	}
	texts := make([]string, 0)
	images := make([]openAIResponsesImageInput, 0)
	var walk func(any) error
	walk = func(value any) error {
		switch item := value.(type) {
		case []any:
			for _, child := range item {
				if err := walk(child); err != nil {
					return err
				}
			}
		case map[string]any:
			typeName, _ := item["type"].(string)
			switch typeName {
			case "input_text":
				if text, _ := item["text"].(string); strings.TrimSpace(text) != "" {
					texts = append(texts, strings.TrimSpace(text))
				}
			case "input_image":
				imageURL, _ := item["image_url"].(string)
				image, err := decodeOpenAIResponsesDataImage(imageURL, len(images))
				if err != nil {
					return err
				}
				images = append(images, image)
			default:
				if content, exists := item["content"]; exists {
					if err := walk(content); err != nil {
						return err
					}
				} else if text, _ := item["text"].(string); strings.TrimSpace(text) != "" {
					texts = append(texts, strings.TrimSpace(text))
				}
			}
		}
		return nil
	}
	if err := walk(root); err != nil {
		return "", nil, err
	}
	prompt := strings.TrimSpace(strings.Join(texts, "\n"))
	if prompt == "" {
		return "", nil, imageParameterError("input", "input must include input_text content.")
	}
	if len(images) > maxTaskInputImages {
		return "", nil, imageParameterError("input", fmt.Sprintf("At most %d input images are supported.", maxTaskInputImages))
	}
	var totalBytes int64
	for _, image := range images {
		totalBytes += int64(len(image.Data))
	}
	if totalBytes > openAIImageInputBytes {
		return "", nil, imageParameterError("input", "Input images must not exceed 32 MiB in total.")
	}
	return prompt, images, nil
}

func parseOpenAIResponsesChatMessages(raw json.RawMessage) ([]sub2api.Message, bool, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, false, imageParameterError("input", "input is required.")
	}
	var direct string
	if json.Unmarshal(raw, &direct) == nil {
		direct = strings.TrimSpace(direct)
		if direct == "" {
			return nil, false, imageParameterError("input", "input must include text.")
		}
		return []sub2api.Message{{Role: "user", Content: direct}}, false, nil
	}
	var items []map[string]any
	if err := json.Unmarshal(raw, &items); err == nil && len(items) > 0 {
		messages := make([]sub2api.Message, 0, len(items))
		hasImages := false
		for _, item := range items {
			role, _ := item["role"].(string)
			role = strings.TrimSpace(strings.ToLower(role))
			if role == "" {
				role = "user"
			}
			if role != "user" && role != "assistant" && role != "system" {
				role = "user"
			}
			textParts := make([]string, 0)
			imageURLs := make([]string, 0)
			switch content := item["content"].(type) {
			case string:
				if strings.TrimSpace(content) != "" {
					textParts = append(textParts, strings.TrimSpace(content))
				}
			case []any:
				for _, part := range content {
					partMap, ok := part.(map[string]any)
					if !ok {
						continue
					}
					switch strings.TrimSpace(fmt.Sprint(partMap["type"])) {
					case "input_text", "output_text", "text":
						if text, _ := partMap["text"].(string); strings.TrimSpace(text) != "" {
							textParts = append(textParts, strings.TrimSpace(text))
						}
					case "input_image":
						imageURL, _ := partMap["image_url"].(string)
						image, err := decodeOpenAIResponsesDataImage(imageURL, len(imageURLs))
						if err != nil {
							return nil, false, err
						}
						imageURLs = append(imageURLs, openAIResponsesImageDataURL(image))
						hasImages = true
					}
				}
			}
			if len(textParts) == 0 && len(imageURLs) == 0 {
				if text, _ := item["text"].(string); strings.TrimSpace(text) != "" {
					textParts = append(textParts, strings.TrimSpace(text))
				}
			}
			contentText := strings.TrimSpace(strings.Join(textParts, "\n"))
			if contentText == "" && len(imageURLs) == 0 {
				continue
			}
			messages = append(messages, sub2api.Message{
				Role:            role,
				Content:         contentText,
				ReferenceImages: imageURLs,
			})
		}
		if len(messages) == 0 {
			return nil, false, imageParameterError("input", "input must include text.")
		}
		return messages, hasImages, nil
	}
	prompt, images, err := parseOpenAIResponsesInput(raw)
	if err != nil {
		return nil, false, err
	}
	imageURLs := make([]string, 0, len(images))
	for _, image := range images {
		imageURLs = append(imageURLs, openAIResponsesImageDataURL(image))
	}
	return []sub2api.Message{{Role: "user", Content: prompt, ReferenceImages: imageURLs}}, len(imageURLs) > 0, nil
}

func openAIResponsesImageDataURL(image openAIResponsesImageInput) string {
	return "data:" + image.ContentType + ";base64," + base64.StdEncoding.EncodeToString(image.Data)
}

func decodeOpenAIResponsesDataImage(value string, index int) (openAIResponsesImageInput, error) {
	if !strings.HasPrefix(value, "data:image/") {
		return openAIResponsesImageInput{}, imageParameterError("input", "input_image currently requires a PNG, JPEG, or WebP data URL.")
	}
	parts := strings.SplitN(value, ",", 2)
	if len(parts) != 2 || !strings.HasSuffix(parts[0], ";base64") {
		return openAIResponsesImageInput{}, imageParameterError("input", "input_image must be a Base64 data URL.")
	}
	media := strings.TrimPrefix(strings.TrimSuffix(parts[0], ";base64"), "data:")
	contentType, extension := "image/png", "png"
	switch media {
	case "image/png":
		contentType, extension = "image/png", "png"
	case "image/jpeg", "image/jpg":
		contentType, extension = "image/jpeg", "jpg"
	case "image/webp":
		contentType, extension = "image/webp", "webp"
	default:
		return openAIResponsesImageInput{}, imageParameterError("input", "input_image must be PNG, JPEG, or WebP.")
	}
	data, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil || len(data) == 0 || int64(len(data)) > openAIImageInputBytes {
		return openAIResponsesImageInput{}, imageParameterError("input", "input_image contains invalid or oversized Base64 data.")
	}
	return openAIResponsesImageInput{Name: fmt.Sprintf("input-%d.%s", index+1, extension), ContentType: contentType, Data: data}, nil
}

func buildOpenAIResponsesImageRequest(req openAIResponsesRequest, tool openAIResponsesImageTool, prompt string, images []openAIResponsesImageInput) (*http.Request, error) {
	if len(images) == 0 {
		payload := gin.H{
			"model": tool.Model, "prompt": prompt, "n": 1, "response_format": "b64_json",
		}
		if value := strings.TrimSpace(tool.Size); value != "" {
			payload["size"] = value
		}
		if value := strings.TrimSpace(tool.Quality); value != "" {
			payload["quality"] = value
		}
		if value := strings.TrimSpace(tool.OutputFormat); value != "" {
			payload["output_format"] = value
		}
		if value := strings.TrimSpace(tool.Background); value != "" {
			payload["background"] = value
		}
		if value := strings.TrimSpace(tool.Moderation); value != "" {
			payload["moderation"] = value
		}
		body, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		request, err := http.NewRequest(http.MethodPost, "/v1/images/generations", bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		request.Header.Set("Content-Type", "application/json")
		return request, nil
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fields := map[string]string{
		"model": tool.Model, "prompt": prompt, "n": "1", "response_format": "b64_json",
	}
	for key, value := range map[string]string{
		"size": tool.Size, "quality": tool.Quality, "output_format": tool.OutputFormat,
		"background": tool.Background, "moderation": tool.Moderation,
	} {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			fields[key] = trimmed
		}
	}
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			return nil, err
		}
	}
	for _, image := range images {
		part, err := writer.CreateFormFile("image[]", image.Name)
		if err != nil {
			return nil, err
		}
		if _, err := part.Write(image.Data); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	request, err := http.NewRequest(http.MethodPost, "/v1/images/edits", &body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return request, nil
}



func (s *Server) runOpenAIResponsesImage(c *gin.Context, req openAIResponsesRequest, tool openAIResponsesImageTool, prompt string, images []openAIResponsesImageInput) (*openAIImageResponse, string, error) {
	request, err := buildOpenAIResponsesImageRequest(req, tool, prompt, images)
	if err != nil {
		return nil, "", err
	}
	request = request.WithContext(c.Request.Context())
	if idempotency := strings.TrimSpace(c.GetHeader("Idempotency-Key")); idempotency != "" {
		request.Header.Set("Idempotency-Key", idempotency)
	}
	recorder := httptest.NewRecorder()
	inner, _ := gin.CreateTestContext(recorder)
	inner.Request = request
	inner.Keys = c.Keys
	s.openAIImage(inner, len(images) > 0)
	for _, header := range []string{"Idempotency-Key", "X-Task-ID", "Retry-After", "X-Should-Retry"} {
		if value := recorder.Header().Get(header); value != "" {
			c.Header(header, value)
		}
	}
	if recorder.Code != http.StatusOK {
		var envelope struct {
			Error struct{ Message, Code string } `json:"error"`
		}
		_ = json.Unmarshal(recorder.Body.Bytes(), &envelope)
		message := envelope.Error.Message
		if message == "" {
			message = "Image generation failed."
		}
		return nil, "", &openAIResponsesUpstreamError{Status: recorder.Code, Code: envelope.Error.Code, Message: message, Body: recorder.Body.Bytes()}
	}
	var result openAIImageResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		return nil, "", err
	}
	return &result, recorder.Header().Get("X-Task-ID"), nil
}

type openAIResponsesUpstreamError struct {
	Status        int
	Code, Message string
	Body          []byte
}

func (e *openAIResponsesUpstreamError) Error() string { return e.Message }

func (s *Server) openAIResponses(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	req, err := decodeOpenAIResponsesRequest(c.Request)
	if err != nil {
		failOpenAIImage(c, err)
		return
	}
	tool, hasImageTool, err := selectOpenAIResponsesImageTool(req.Tools)
	if err != nil {
		failOpenAIImage(c, err)
		return
	}
	cfg, err := modelconfig.Runtime(c.Request.Context(), s.St.Pool, s.Cfg.AppSecret)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	key := openAPIKeyFromContext(c)
	chatSelections := openAIChatSelections(cfg, key)
	imageModels := openAIImageModels(cfg, key)
	chatSel := matchOpenAIChatSelection(chatSelections, req.Model, imageModels)
	imageModel := matchOpenAIImageModel(imageModels, req.Model)

	// Dedicated Images-style Responses: caller named an image model (or only
	// image models exist) and included image_generation.
	if hasImageTool && imageModel != nil && chatSel == nil {
		if strings.TrimSpace(tool.Model) == "" {
			tool.Model = openAIPublicModelID(*imageModel)
		}
		s.openAIResponsesImage(c, req, tool)
		return
	}
	if hasImageTool && chatSel == nil && len(imageModels) > 0 {
		s.openAIResponsesImage(c, req, tool)
		return
	}
	if chatSel != nil {
		// Codex-style: chat model with optional image_generation tool execution.
		s.openAIResponsesChat(c, req, cfg, chatSel, len(imageModels) > 0, tool)
		return
	}
	// Codex/Cockpit often name an image model directly without also sending the
	// image_generation tool block. Treat that as a plain image Responses call.
	if !hasImageTool && imageModel != nil {
		if strings.TrimSpace(tool.Model) == "" {
			tool.Model = openAIPublicModelID(*imageModel)
		}
		s.openAIResponsesImage(c, req, tool)
		return
	}
	if hasImageTool {
		s.openAIResponsesImage(c, req, tool)
		return
	}
	failOpenAI(c, apperr.E("model_not_found", "No chat or image model is available to this API Key.", http.StatusNotFound), "model")
}

func (s *Server) openAIResponsesImage(c *gin.Context, req openAIResponsesRequest, tool openAIResponsesImageTool) {
	if strings.TrimSpace(tool.Model) == "" {
		cfg, loadErr := modelconfig.Load(c.Request.Context(), s.St.Pool)
		if loadErr != nil {
			failOpenAI(c, loadErr, "")
			return
		}
		models := openAIImageModels(cfg, openAPIKeyFromContext(c))
		if model := matchOpenAIImageModel(models, req.Model); model != nil {
			tool.Model = openAIPublicModelID(*model)
		}
		if tool.Model == "" && len(models) > 0 {
			tool.Model = openAIPublicModelID(models[0])
		}
		if tool.Model == "" {
			failOpenAI(c, apperr.E("model_not_found", "No image model is available to this API Key.", http.StatusNotFound), "tools.model")
			return
		}
	}
	prompt, images, err := parseOpenAIResponsesInput(req.Input)
	if err != nil {
		failOpenAIImage(c, err)
		return
	}
	if len(images) > 0 && !apiKeyHasScope(openAPIKeyFromContext(c), "files:write") {
		failOpenAI(c, apperr.E("api_key_scope_denied", "Image editing requires files:write permission.", http.StatusForbidden), "input")
		return
	}
	result, _, err := s.runOpenAIResponsesImage(c, req, tool, prompt, images)
	if err != nil {
		if upstream, ok := err.(*openAIResponsesUpstreamError); ok {
			c.Data(upstream.Status, "application/json", upstream.Body)
			return
		}
		failOpenAI(c, err, "")
		return
	}
	now := time.Now().Unix()
	responseID := "resp_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	output := make([]any, 0, len(result.Data))
	for _, image := range result.Data {
		output = append(output, openAIResponsesImageCall{ID: "ig_" + strings.ReplaceAll(uuid.NewString(), "-", ""), Type: "image_generation_call", Status: "completed", Result: image.B64JSON})
	}
	responseModel := strings.TrimSpace(req.Model)
	if responseModel == "" {
		responseModel = tool.Model
	}
	response := openAIResponsesObject{ID: responseID, Object: "response", CreatedAt: now, CompletedAt: now, Status: "completed", Error: nil, Model: responseModel, Output: output, OutputText: "", Metadata: req.Metadata, ParallelToolCalls: true, Usage: gin.H{"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}}
	if req.Stream {
		c.Header("Content-Type", "text/event-stream")
		c.Header("Connection", "keep-alive")
		sequence := 0
		write := func(event any) {
			raw, _ := json.Marshal(event)
			_, _ = fmt.Fprintf(c.Writer, "data: %s\n\n", raw)
			sequence++
		}
		write(gin.H{"type": "response.created", "response": gin.H{"id": response.ID, "object": "response", "status": "in_progress", "created_at": response.CreatedAt, "model": response.Model, "output": []any{}}, "sequence_number": sequence})
		for index, item := range output {
			call := item.(openAIResponsesImageCall)
			write(gin.H{"type": "response.output_item.added", "output_index": index, "item": gin.H{"id": call.ID, "type": call.Type, "status": "in_progress", "result": nil}, "sequence_number": sequence})
			write(gin.H{"type": "response.image_generation_call.in_progress", "output_index": index, "item_id": call.ID, "sequence_number": sequence})
			write(gin.H{"type": "response.image_generation_call.generating", "output_index": index, "item_id": call.ID, "sequence_number": sequence})
			if tool.PartialImages > 0 {
				write(gin.H{"type": "response.image_generation_call.partial_image", "output_index": index, "item_id": call.ID, "partial_image_index": 0, "partial_image_b64": call.Result, "sequence_number": sequence})
			}
			write(gin.H{"type": "response.image_generation_call.completed", "output_index": index, "item_id": call.ID, "sequence_number": sequence})
			write(gin.H{"type": "response.output_item.done", "output_index": index, "item": call, "sequence_number": sequence})
		}
		write(gin.H{"type": "response.completed", "response": response, "sequence_number": sequence})
		_, _ = fmt.Fprint(c.Writer, "data: [DONE]\n\n")
		return
	}
	c.JSON(http.StatusOK, response)
}

func (s *Server) openAIResponsesChat(c *gin.Context, req openAIResponsesRequest, cfg modelconfig.Config, selection *modelconfig.Selection, enableImageTool bool, imageTool openAIResponsesImageTool) {
	user, err := s.requireUser(c)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	if !s.enforceUsageLimit(c, "task-create-minute", user.ID.String(), highCostRequestsPerMinute, 1, time.Minute) {
		return
	}
	messages, hasImages, err := parseOpenAIResponsesChatMessages(req.Input)
	if err != nil {
		failOpenAIImage(c, err)
		return
	}
	if hasImages && !apiKeyHasScope(openAPIKeyFromContext(c), "files:write") {
		failOpenAI(c, apperr.E("api_key_scope_denied", "Chat input images require files:write permission.", http.StatusForbidden), "input")
		return
	}
	if strings.TrimSpace(selection.Provider.APIKey) == "" {
		failOpenAI(c, apperr.E("provider_misconfigured", "The selected chat model has no usable provider API key.", http.StatusBadGateway), "model")
		return
	}
	priceCents := modelconfig.ResolveWorkspacePrice(cfg, modelconfig.WorkspaceAssistant, selection.Model).EffectiveCents
	responseID := "resp_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	billingID := responseID
	if err := s.St.Tx(c.Request.Context(), func(tx pgx.Tx) error {
		_, err := wallet.FreezeFeatureCredits(c.Request.Context(), tx, user.ID, priceCents, trialfeature.AIAssistantKey,
			openAPIResponsesChatSourceType, billingID, nil)
		return err
	}); err != nil {
		failOpenAI(c, err, "")
		return
	}
	settled := false
	defer func() {
		if settled || priceCents <= 0 {
			return
		}
		_ = s.St.Tx(c.Request.Context(), func(tx pgx.Tx) error {
			_, err := wallet.ReleaseFeatureCredits(c.Request.Context(), tx, user.ID, priceCents,
				openAPIResponsesChatSourceType, billingID, nil)
			return err
		})
	}()

	client, err := sub2api.New(selection.Provider.BaseURL, selection.Provider.APIKey, selection.Model.UpstreamModel, "", selection.Provider.TimeoutSecs)
	if err != nil {
		failOpenAI(c, err, "")
		return
	}
	responseModel := openAIPublicModelID(selection.Model)
	if strings.TrimSpace(req.Model) != "" {
		responseModel = strings.TrimSpace(req.Model)
	}
	now := time.Now().Unix()
	messageID := "msg_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if enableImageTool {
		messages = ensureOpenAIResponsesImageToolSystemMessage(messages)
	}

	type chatTurn struct {
		Text     string
		Usage    sub2api.ChatUsage
		ToolCall *sub2api.ToolCall
	}
	runTurn := func(onUpdate func(text, reasoning string) error) (chatTurn, error) {
		if enableImageTool {
			toolChoice := ""
			if openAIResponsesWantsImageGeneration(messages) {
				toolChoice = "image_generation"
			}
			result, chatErr := client.ChatAgentWithTools(c.Request.Context(), messages, nil,
				[]sub2api.FunctionTool{openAIResponsesImageGenerationFunctionTool()}, toolChoice, onUpdate)
			return chatTurn{Text: result.Text, Usage: result.Usage, ToolCall: result.ToolCall}, chatErr
		}
		result, chatErr := client.CompleteChatTextWithImages(c.Request.Context(), messages, nil, onUpdate)
		return chatTurn{Text: result.Text, Usage: result.Usage}, chatErr
	}

	settleChat := func() error {
		if priceCents <= 0 {
			settled = true
			return nil
		}
		err := s.St.Tx(c.Request.Context(), func(tx pgx.Tx) error {
			_, err := wallet.SettleFeatureCredits(c.Request.Context(), tx, user.ID, priceCents,
				openAPIResponsesChatSourceType, billingID, nil)
			return err
		})
		if err == nil {
			settled = true
		}
		return err
	}
	releaseChatReservation := func() {
		if settled || priceCents <= 0 {
			settled = true
			return
		}
		_ = s.St.Tx(c.Request.Context(), func(tx pgx.Tx) error {
			_, err := wallet.ReleaseFeatureCredits(c.Request.Context(), tx, user.ID, priceCents,
				openAPIResponsesChatSourceType, billingID, nil)
			return err
		})
		settled = true // prevent defer double-release
	}

	if req.Stream {
		c.Header("Content-Type", "text/event-stream")
		c.Header("Connection", "keep-alive")
		c.Header("Cache-Control", "no-store")
		sequence := 0
		write := func(event any) {
			raw, _ := json.Marshal(event)
			_, _ = fmt.Fprintf(c.Writer, "data: %s\n\n", raw)
			if flusher, ok := c.Writer.(http.Flusher); ok {
				flusher.Flush()
			}
			sequence++
		}
		write(gin.H{"type": "response.created", "response": gin.H{"id": responseID, "object": "response", "status": "in_progress", "created_at": now, "model": responseModel, "output": []any{}}, "sequence_number": sequence})
		write(gin.H{"type": "response.output_item.added", "output_index": 0, "item": gin.H{"id": messageID, "type": "message", "status": "in_progress", "role": "assistant", "content": []any{}}, "sequence_number": sequence})
		write(gin.H{"type": "response.content_part.added", "output_index": 0, "item_id": messageID, "content_index": 0, "part": gin.H{"type": "output_text", "text": ""}, "sequence_number": sequence})
		var lastText string
		turn, chatErr := runTurn(func(text, _ string) error {
			delta := text
			if strings.HasPrefix(text, lastText) {
				delta = text[len(lastText):]
			}
			lastText = text
			if delta == "" {
				return nil
			}
			write(gin.H{"type": "response.output_text.delta", "output_index": 0, "item_id": messageID, "content_index": 0, "delta": delta, "sequence_number": sequence})
			return nil
		})
		if chatErr != nil {
			write(gin.H{"type": "response.failed", "response": gin.H{"id": responseID, "object": "response", "status": "failed", "error": gin.H{"message": chatErr.Error()}}, "sequence_number": sequence})
			_, _ = fmt.Fprint(c.Writer, "data: [DONE]\n\n")
			return
		}
		finalText := strings.TrimSpace(turn.Text)
		if finalText == "" {
			finalText = strings.TrimSpace(lastText)
		}
		if imageToolCall, prompt, displayText, ok := s.openAIResponsesChatImageAction(c, cfg, req, messages, imageTool, turn.ToolCall, finalText); ok {
			releaseChatReservation()
			result, _, imgErr := s.runOpenAIResponsesImage(c, req, imageToolCall, prompt, nil)
			if imgErr != nil {
				message := imgErr.Error()
				if upstream, ok := imgErr.(*openAIResponsesUpstreamError); ok {
					message = upstream.Message
				}
				write(gin.H{"type": "response.failed", "response": gin.H{"id": responseID, "object": "response", "status": "failed", "error": gin.H{"message": message}}, "sequence_number": sequence})
				_, _ = fmt.Fprint(c.Writer, "data: [DONE]\n\n")
				return
			}
			s.writeOpenAIResponsesChatImageStream(c, write, &sequence, responseID, responseModel, req.Metadata, now, messageID, displayText, imageToolCall, result, turn.Usage)
			return
		}
		if err := settleChat(); err != nil {
			write(gin.H{"type": "response.failed", "response": gin.H{"id": responseID, "object": "response", "status": "failed", "error": gin.H{"message": err.Error()}}, "sequence_number": sequence})
			_, _ = fmt.Fprint(c.Writer, "data: [DONE]\n\n")
			return
		}
		completedAt := time.Now().Unix()
		outputItem := gin.H{
			"id": messageID, "type": "message", "status": "completed", "role": "assistant",
			"content": []gin.H{{"type": "output_text", "text": finalText}},
		}
		response := openAIResponsesObject{
			ID: responseID, Object: "response", CreatedAt: now, CompletedAt: completedAt, Status: "completed",
			Error: nil, Model: responseModel, Output: []any{outputItem}, OutputText: finalText,
			Metadata: req.Metadata, ParallelToolCalls: false,
			Usage: openAIResponsesChatUsage(turn.Usage),
		}
		write(gin.H{"type": "response.output_text.done", "output_index": 0, "item_id": messageID, "content_index": 0, "text": finalText, "sequence_number": sequence})
		write(gin.H{"type": "response.content_part.done", "output_index": 0, "item_id": messageID, "content_index": 0, "part": gin.H{"type": "output_text", "text": finalText}, "sequence_number": sequence})
		write(gin.H{"type": "response.output_item.done", "output_index": 0, "item": outputItem, "sequence_number": sequence})
		write(gin.H{"type": "response.completed", "response": response, "sequence_number": sequence})
		_, _ = fmt.Fprint(c.Writer, "data: [DONE]\n\n")
		return
	}

	turn, chatErr := runTurn(nil)
	if chatErr != nil {
		failOpenAI(c, apperr.E("upstream_error", chatErr.Error(), http.StatusBadGateway), "")
		return
	}
	finalText := strings.TrimSpace(turn.Text)
	if imageToolCall, prompt, displayText, ok := s.openAIResponsesChatImageAction(c, cfg, req, messages, imageTool, turn.ToolCall, finalText); ok {
		releaseChatReservation()
		result, _, imgErr := s.runOpenAIResponsesImage(c, req, imageToolCall, prompt, nil)
		if imgErr != nil {
			if upstream, ok := imgErr.(*openAIResponsesUpstreamError); ok {
				c.Data(upstream.Status, "application/json", upstream.Body)
				return
			}
			failOpenAI(c, imgErr, "")
			return
		}
		c.JSON(http.StatusOK, buildOpenAIResponsesChatImageObject(responseID, responseModel, req.Metadata, now, messageID, displayText, result))
		return
	}
	if err := settleChat(); err != nil {
		failOpenAI(c, err, "")
		return
	}
	completedAt := time.Now().Unix()
	outputItem := gin.H{
		"id": messageID, "type": "message", "status": "completed", "role": "assistant",
		"content": []gin.H{{"type": "output_text", "text": finalText}},
	}
	c.JSON(http.StatusOK, openAIResponsesObject{
		ID: responseID, Object: "response", CreatedAt: now, CompletedAt: completedAt, Status: "completed",
		Error: nil, Model: responseModel, Output: []any{outputItem}, OutputText: finalText,
		Metadata: req.Metadata, ParallelToolCalls: false,
		Usage: openAIResponsesChatUsage(turn.Usage),
	})
}

func (s *Server) resolveOpenAIResponsesImageToolModel(c *gin.Context, cfg modelconfig.Config, tool openAIResponsesImageTool, requestedModel string) openAIResponsesImageTool {
	if strings.TrimSpace(tool.Model) != "" {
		return tool
	}
	models := openAIImageModels(cfg, openAPIKeyFromContext(c))
	if model := matchOpenAIImageModel(models, requestedModel); model != nil {
		tool.Model = openAIPublicModelID(*model)
		return tool
	}
	if len(models) > 0 {
		tool.Model = openAIPublicModelID(models[0])
	}
	return tool
}

// openAIResponsesChatImageAction resolves an image tool call from a real
// function call, or recovers when the chat model dumps tool JSON / refuses
// while the user clearly asked to generate an image.
func (s *Server) openAIResponsesChatImageAction(
	c *gin.Context,
	cfg modelconfig.Config,
	req openAIResponsesRequest,
	messages []sub2api.Message,
	base openAIResponsesImageTool,
	toolCall *sub2api.ToolCall,
	assistantText string,
) (openAIResponsesImageTool, string, string, bool) {
	if toolCall != nil && strings.EqualFold(toolCall.Name, "image_generation") {
		prompt, tool, err := parseOpenAIResponsesImageToolCall(toolCall.Arguments, messages, base)
		if err != nil {
			return openAIResponsesImageTool{}, "", "", false
		}
		tool = s.resolveOpenAIResponsesImageToolModel(c, cfg, tool, req.Model)
		if strings.TrimSpace(tool.Model) == "" || strings.TrimSpace(prompt) == "" {
			return openAIResponsesImageTool{}, "", "", false
		}
		return tool, prompt, strings.TrimSpace(assistantText), true
	}
	if !openAIResponsesWantsImageGeneration(messages) {
		return openAIResponsesImageTool{}, "", "", false
	}
	arguments := extractOpenAIResponsesImageToolJSON(assistantText)
	prompt, tool, err := parseOpenAIResponsesImageToolCall(arguments, messages, base)
	if err != nil {
		return openAIResponsesImageTool{}, "", "", false
	}
	tool = s.resolveOpenAIResponsesImageToolModel(c, cfg, tool, req.Model)
	if strings.TrimSpace(tool.Model) == "" || strings.TrimSpace(prompt) == "" {
		return openAIResponsesImageTool{}, "", "", false
	}
	// Drop refusal / pseudo-tool chatter from recovered generations.
	return tool, prompt, "", true
}

func extractOpenAIResponsesImageToolJSON(text string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}
	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return ""
	}
	candidate := text[start : end+1]
	var payload map[string]any
	if err := json.Unmarshal([]byte(candidate), &payload); err != nil {
		return ""
	}
	prompt, _ := payload["prompt"].(string)
	if strings.TrimSpace(prompt) == "" {
		return ""
	}
	return candidate
}

const openAIResponsesImageToolSystemPrompt = "You have an image_generation function tool. When the user asks to draw, create, generate, or paint an image, you MUST call image_generation with a detailed prompt. Never claim you cannot generate images while this tool is available. For ordinary non-image questions, answer in text without calling the tool."

func openAIResponsesImageGenerationFunctionTool() sub2api.FunctionTool {
	return sub2api.FunctionTool{
		Name:        "image_generation",
		Description: "Generate an image from a text prompt when the user asks to draw, create, or generate a picture.",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"prompt":        map[string]any{"type": "string", "description": "Detailed image generation prompt"},
				"size":          map[string]any{"type": "string", "description": "Optional size such as 1024x1024 or auto"},
				"quality":       map[string]any{"type": "string", "description": "Optional quality such as low, medium, high, or auto"},
				"output_format": map[string]any{"type": "string", "description": "Optional output format: png, jpeg, or webp"},
			},
			"required":             []string{"prompt"},
			"additionalProperties": false,
		},
	}
}

func ensureOpenAIResponsesImageToolSystemMessage(messages []sub2api.Message) []sub2api.Message {
	if len(messages) > 0 && messages[0].Role == "system" && strings.Contains(messages[0].Content, "image_generation") {
		return messages
	}
	out := make([]sub2api.Message, 0, len(messages)+1)
	out = append(out, sub2api.Message{Role: "system", Content: openAIResponsesImageToolSystemPrompt})
	out = append(out, messages...)
	return out
}

func openAIResponsesWantsImageGeneration(messages []sub2api.Message) bool {
	text := ""
	for index := len(messages) - 1; index >= 0; index-- {
		if messages[index].Role == "user" && strings.TrimSpace(messages[index].Content) != "" {
			text = strings.ToLower(strings.TrimSpace(messages[index].Content))
			break
		}
	}
	if text == "" {
		return false
	}
	needles := []string{
		"image_generation", "generate an image", "generate a picture", "create an image", "create a picture",
		"draw an image", "draw a picture", "make an image", "make a picture", "paint an image",
		"生成图片", "生成一张", "生成一幅", "生成一只", "生成一个", "生成个",
		"画一张", "画一幅", "画一只", "画一个", "画个", "画只",
		"生图", "出图", "帮我画", "请画", "画图", "请生成", "帮我生成",
	}
	for _, needle := range needles {
		if strings.Contains(text, needle) {
			return true
		}
	}
	return false
}

func parseOpenAIResponsesImageToolCall(arguments string, messages []sub2api.Message, base openAIResponsesImageTool) (string, openAIResponsesImageTool, error) {
	tool := base
	tool.Type = "image_generation"
	prompt := ""
	var payload map[string]any
	if strings.TrimSpace(arguments) != "" {
		if err := json.Unmarshal([]byte(arguments), &payload); err != nil {
			return "", tool, imageParameterError("tools", "image_generation tool arguments must be JSON.")
		}
		if value, _ := payload["prompt"].(string); strings.TrimSpace(value) != "" {
			prompt = strings.TrimSpace(value)
		}
		if value, _ := payload["size"].(string); strings.TrimSpace(value) != "" {
			tool.Size = strings.TrimSpace(value)
		}
		if value, _ := payload["quality"].(string); strings.TrimSpace(value) != "" {
			tool.Quality = strings.TrimSpace(value)
		}
		if value, _ := payload["output_format"].(string); strings.TrimSpace(value) != "" {
			tool.OutputFormat = strings.TrimSpace(value)
		}
	}
	if prompt == "" {
		for index := len(messages) - 1; index >= 0; index-- {
			if messages[index].Role == "user" && strings.TrimSpace(messages[index].Content) != "" {
				prompt = strings.TrimSpace(messages[index].Content)
				break
			}
		}
	}
	if prompt == "" {
		return "", tool, imageParameterError("input", "image_generation requires a prompt.")
	}
	return prompt, tool, nil
}

func buildOpenAIResponsesChatImageObject(responseID, responseModel string, metadata map[string]string, createdAt int64, messageID, text string, result *openAIImageResponse) openAIResponsesObject {
	output := make([]any, 0, len(result.Data)+1)
	if strings.TrimSpace(text) != "" {
		output = append(output, gin.H{
			"id": messageID, "type": "message", "status": "completed", "role": "assistant",
			"content": []gin.H{{"type": "output_text", "text": strings.TrimSpace(text)}},
		})
	}
	for _, image := range result.Data {
		output = append(output, openAIResponsesImageCall{
			ID: "ig_" + strings.ReplaceAll(uuid.NewString(), "-", ""), Type: "image_generation_call",
			Status: "completed", Result: image.B64JSON,
		})
	}
	now := time.Now().Unix()
	return openAIResponsesObject{
		ID: responseID, Object: "response", CreatedAt: createdAt, CompletedAt: now, Status: "completed",
		Error: nil, Model: responseModel, Output: output, OutputText: strings.TrimSpace(text),
		Metadata: metadata, ParallelToolCalls: false,
		Usage: gin.H{"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
	}
}

func (s *Server) writeOpenAIResponsesChatImageStream(
	c *gin.Context,
	write func(any),
	sequence *int,
	responseID, responseModel string,
	metadata map[string]string,
	createdAt int64,
	messageID, text string,
	tool openAIResponsesImageTool,
	result *openAIImageResponse,
	usage sub2api.ChatUsage,
) {
	_ = usage
	response := buildOpenAIResponsesChatImageObject(responseID, responseModel, metadata, createdAt, messageID, text, result)
	if strings.TrimSpace(text) != "" {
		write(gin.H{"type": "response.output_text.done", "output_index": 0, "item_id": messageID, "content_index": 0, "text": strings.TrimSpace(text), "sequence_number": *sequence})
		write(gin.H{"type": "response.content_part.done", "output_index": 0, "item_id": messageID, "content_index": 0, "part": gin.H{"type": "output_text", "text": strings.TrimSpace(text)}, "sequence_number": *sequence})
		write(gin.H{"type": "response.output_item.done", "output_index": 0, "item": response.Output[0], "sequence_number": *sequence})
	}
	startIndex := 0
	if strings.TrimSpace(text) != "" {
		startIndex = 1
	}
	for index := startIndex; index < len(response.Output); index++ {
		call, ok := response.Output[index].(openAIResponsesImageCall)
		if !ok {
			continue
		}
		write(gin.H{"type": "response.output_item.added", "output_index": index, "item": gin.H{"id": call.ID, "type": call.Type, "status": "in_progress", "result": nil}, "sequence_number": *sequence})
		write(gin.H{"type": "response.image_generation_call.in_progress", "output_index": index, "item_id": call.ID, "sequence_number": *sequence})
		write(gin.H{"type": "response.image_generation_call.generating", "output_index": index, "item_id": call.ID, "sequence_number": *sequence})
		if tool.PartialImages > 0 {
			write(gin.H{"type": "response.image_generation_call.partial_image", "output_index": index, "item_id": call.ID, "partial_image_index": 0, "partial_image_b64": call.Result, "sequence_number": *sequence})
		}
		write(gin.H{"type": "response.image_generation_call.completed", "output_index": index, "item_id": call.ID, "sequence_number": *sequence})
		write(gin.H{"type": "response.output_item.done", "output_index": index, "item": call, "sequence_number": *sequence})
	}
	write(gin.H{"type": "response.completed", "response": response, "sequence_number": *sequence})
	_, _ = fmt.Fprint(c.Writer, "data: [DONE]\n\n")
}

func openAIResponsesChatUsage(usage sub2api.ChatUsage) gin.H {
	return gin.H{
		"input_tokens":  usage.PromptTokens,
		"output_tokens": usage.CompletionTokens,
		"total_tokens":  usage.TotalTokens,
	}
}
