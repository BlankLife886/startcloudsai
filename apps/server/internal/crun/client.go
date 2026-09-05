package crun

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	DefaultBaseURL = "https://api.crun.ai"
	DefaultModel   = "openai/gpt-image-2"
)

type UpstreamError struct {
	Status  int
	Code    int
	Message string
}

func (e *UpstreamError) Error() string {
	if e == nil {
		return "CRUN request failed"
	}
	return fmt.Sprintf("CRUN request failed (http=%d code=%d): %s", e.Status, e.Code, e.Message)
}

type Client struct {
	baseURL      string
	apiKey       string
	model        string
	timeout      time.Duration
	pollInterval time.Duration
	httpClient   *http.Client
}

// OpenAIImageRequest is the internal image contract used by the application.
// The CRUN adapter translates it into one or more CreateTask requests.
type OpenAIImageRequest struct {
	Prompt                string
	N                     int
	Size                  string
	Quality               string
	ImageURLs             []string
	AspectRatio           string
	Resolution            string
	TransparentBackground bool
	OutputFormat          string
	ModerationLevel       string
	AllowedInputFields    []string
}

func New(baseURL, apiKey, model string, timeoutSecs int) (*Client, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, errors.New("CRUN base URL is invalid")
	}
	parsed.Path = strings.TrimSuffix(strings.TrimRight(parsed.Path, "/"), "/api/v1")
	parsed.RawQuery = ""
	parsed.Fragment = ""
	baseURL = strings.TrimRight(parsed.String(), "/")
	model = strings.TrimSpace(model)
	if model == "" {
		model = DefaultModel
	}
	if timeoutSecs <= 0 {
		timeoutSecs = 1200
	}
	return &Client{
		baseURL: baseURL, apiKey: strings.TrimSpace(apiKey), model: model,
		// Image tasks usually finish in tens of seconds. A 15s interval added a
		// visible delay after completion; 2s matches the other async providers.
		timeout: time.Duration(timeoutSecs) * time.Second, pollInterval: 2 * time.Second,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}, nil
}

func (c *Client) Configured() bool { return c != nil && c.apiKey != "" }
func (c *Client) Model() string    { return c.model }

type MediaEstimate struct {
	EstimatedCredits float64 `json:"estimated_credits"`
	Balance          float64 `json:"balance"`
	Affordable       bool    `json:"affordable"`
}

type MediaTaskRequest struct {
	Model       string         `json:"model"`
	Input       map[string]any `json:"input"`
	CallbackURL string         `json:"callback_url,omitempty"`
}

type MediaTaskCreated struct {
	TaskID string `json:"task_id"`
}

type TemplateQuery struct {
	Platform   string
	Page       int
	PageSize   int
	TemplateID string
}

type apiEnvelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
	Errors  []string        `json:"errors"`
}

func (c *Client) doJSON(ctx context.Context, method, path string, body any, out any) error {
	if !c.Configured() {
		return errors.New("CRUN API key is not configured")
	}
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return err
	}
	var envelope apiEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return fmt.Errorf("decode CRUN response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || envelope.Code != 200 {
		message := strings.TrimSpace(envelope.Message)
		if len(envelope.Errors) > 0 {
			message = strings.TrimSpace(message + ": " + strings.Join(envelope.Errors, "; "))
		}
		if message == "" {
			message = http.StatusText(resp.StatusCode)
		}
		return &UpstreamError{Status: resp.StatusCode, Code: envelope.Code, Message: message}
	}
	if out != nil && len(envelope.Data) > 0 && string(envelope.Data) != "null" {
		if err := json.Unmarshal(envelope.Data, out); err != nil {
			return fmt.Errorf("decode CRUN response data: %w", err)
		}
	}
	return nil
}

func (c *Client) Balance(ctx context.Context) (float64, error) {
	var data struct {
		Balance float64 `json:"balance"`
	}
	err := c.doJSON(ctx, http.MethodGet, "/api/v1/client/account/balance", nil, &data)
	return data.Balance, err
}

func (c *Client) ListModels(ctx context.Context, modality, operation string) (any, error) {
	values := url.Values{}
	if modality = strings.TrimSpace(modality); modality != "" {
		values.Set("modality", modality)
	}
	if operation = strings.TrimSpace(operation); operation != "" {
		values.Set("operation", operation)
	}
	path := "/api/v1/client/job/Models"
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var data any
	err := c.doJSON(ctx, http.MethodGet, path, nil, &data)
	return data, err
}

func (c *Client) DescribeModel(ctx context.Context, model string) (any, error) {
	model = strings.Trim(strings.TrimSpace(model), "/")
	if model == "" {
		return nil, errors.New("CRUN model is empty")
	}
	parts := strings.Split(model, "/")
	for index := range parts {
		parts[index] = url.PathEscape(parts[index])
	}
	var data any
	err := c.doJSON(ctx, http.MethodGet, "/api/v1/client/job/Models/"+strings.Join(parts, "/"), nil, &data)
	return data, err
}

func (c *Client) EstimateMediaTask(ctx context.Context, request MediaTaskRequest) (*MediaEstimate, error) {
	request.Model = strings.TrimSpace(request.Model)
	if request.Model == "" || request.Input == nil {
		return nil, errors.New("CRUN media task model and input are required")
	}
	var data MediaEstimate
	if err := c.doJSON(ctx, http.MethodPost, "/api/v1/client/job/EstimateTask", request, &data); err != nil {
		return nil, err
	}
	return &data, nil
}

// CreateMediaTask intentionally performs exactly one HTTP request. Callers
// must persist the returned task ID before any retry or status polling.
func (c *Client) CreateMediaTask(ctx context.Context, request MediaTaskRequest) (*MediaTaskCreated, error) {
	request.Model = strings.TrimSpace(request.Model)
	if request.Model == "" || request.Input == nil {
		return nil, errors.New("CRUN media task model and input are required")
	}
	var data MediaTaskCreated
	if err := c.doJSON(ctx, http.MethodPost, "/api/v1/client/job/CreateTask", request, &data); err != nil {
		return nil, err
	}
	if strings.TrimSpace(data.TaskID) == "" {
		return nil, errors.New("CRUN returned an empty task id")
	}
	return &data, nil
}

func (c *Client) ListTemplates(ctx context.Context, query TemplateQuery) (any, error) {
	platform := strings.ToLower(strings.TrimSpace(query.Platform))
	path, idKey := "", ""
	switch platform {
	case "kling":
		path, idKey = "/api/v1/client/job/kling-templates", "template_id"
	case "vidu":
		path, idKey = "/api/v1/client/job/vidu-templates", "template"
	case "bytedance":
		path, idKey = "/api/v1/client/job/bytedance-templates", "template_id"
	default:
		return nil, errors.New("unsupported CRUN template platform")
	}
	if query.Page <= 0 {
		query.Page = 1
	}
	if query.PageSize <= 0 || query.PageSize > 50 {
		query.PageSize = 20
	}
	values := url.Values{
		"page":      []string{fmt.Sprint(query.Page)},
		"page_size": []string{fmt.Sprint(query.PageSize)},
	}
	if id := strings.TrimSpace(query.TemplateID); id != "" {
		values.Set(idKey, id)
	}
	var data any
	err := c.doJSON(ctx, http.MethodGet, path+"?"+values.Encode(), nil, &data)
	return data, err
}

func (c *Client) CreateTask(ctx context.Context, prompt, aspectRatio, resolution string, imageURLs []string) (string, error) {
	return c.CreateTaskWithRequest(ctx, OpenAIImageRequest{
		Prompt: prompt, AspectRatio: aspectRatio, Resolution: resolution, ImageURLs: imageURLs,
	})
}

func (c *Client) CreateTaskWithRequest(ctx context.Context, request OpenAIImageRequest) (string, error) {
	input := buildImageInput(request)
	if err := c.ensureAffordable(ctx, input); err != nil {
		return "", err
	}
	return c.createTaskWithInput(ctx, input)
}

func buildImageInput(request OpenAIImageRequest) map[string]any {
	input := map[string]any{"prompt": request.Prompt}
	if inputFieldAllowed(request.AllowedInputFields, "aspect_ratio") && strings.TrimSpace(request.AspectRatio) != "" {
		input["aspect_ratio"] = request.AspectRatio
	}
	if inputFieldAllowed(request.AllowedInputFields, "img_urls") && len(request.ImageURLs) > 0 {
		input["img_urls"] = request.ImageURLs
	}
	if inputFieldAllowed(request.AllowedInputFields, "resolution") && strings.TrimSpace(request.Resolution) != "" {
		input["resolution"] = request.Resolution
	}
	if quality := strings.ToLower(strings.TrimSpace(request.Quality)); inputFieldAllowed(request.AllowedInputFields, "quality") && quality != "" {
		input["quality"] = quality
	}
	if inputFieldAllowed(request.AllowedInputFields, "background") && request.TransparentBackground {
		input["background"] = "transparent"
	}
	if format := strings.ToLower(strings.TrimSpace(request.OutputFormat)); inputFieldAllowed(request.AllowedInputFields, "output_format") && format != "" {
		input["output_format"] = format
	}
	if moderation := strings.ToLower(strings.TrimSpace(request.ModerationLevel)); inputFieldAllowed(request.AllowedInputFields, "moderation") && moderation != "" {
		input["moderation"] = moderation
	}
	return input
}

func inputFieldAllowed(allowed []string, field string) bool {
	if len(allowed) == 0 {
		return true
	}
	for _, candidate := range allowed {
		if strings.EqualFold(strings.TrimSpace(candidate), field) {
			return true
		}
	}
	return false
}

func (c *Client) ensureAffordable(ctx context.Context, input map[string]any) error {
	estimate, err := c.EstimateMediaTask(ctx, MediaTaskRequest{Model: c.model, Input: input})
	if err != nil {
		return fmt.Errorf("CRUN task estimate failed: %w", err)
	}
	if !estimate.Affordable {
		return errors.New("CRUN account balance is insufficient for this task")
	}
	return nil
}

func (c *Client) createTaskWithInput(ctx context.Context, input map[string]any) (string, error) {
	var data struct {
		TaskID string `json:"task_id"`
	}
	err := c.doJSON(ctx, http.MethodPost, "/api/v1/client/job/CreateTask", map[string]any{
		"model": c.model,
		"input": input,
	}, &data)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(data.TaskID) == "" {
		return "", errors.New("CRUN returned an empty task id")
	}
	return data.TaskID, nil
}

func (c *Client) CreateBackgroundRemovalTask(ctx context.Context, imageURL string) (string, error) {
	imageURL = strings.TrimSpace(imageURL)
	if imageURL == "" {
		return "", errors.New("CRUN background removal image URL is empty")
	}
	input := map[string]any{"img_urls": []string{imageURL}}
	if err := c.ensureAffordable(ctx, input); err != nil {
		return "", err
	}
	var data struct {
		TaskID string `json:"task_id"`
	}
	err := c.doJSON(ctx, http.MethodPost, "/api/v1/client/job/CreateTask", map[string]any{
		"model": c.model,
		"input": input,
	}, &data)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(data.TaskID) == "" {
		return "", errors.New("CRUN returned an empty background removal task id")
	}
	return data.TaskID, nil
}

func (c *Client) CreateImageTasks(
	ctx context.Context,
	request OpenAIImageRequest,
	existing []string,
	onCreated func([]string) error,
) ([]string, error) {
	count := request.N
	if count < 1 {
		count = 1
	}
	if count > 4 {
		count = 4
	}
	taskIDs := append([]string(nil), existing...)
	if len(taskIDs) > count {
		taskIDs = taskIDs[:count]
	}
	for len(taskIDs) < count {
		taskID, err := c.CreateTaskWithRequest(ctx, request)
		if err != nil {
			return nil, err
		}
		taskIDs = append(taskIDs, taskID)
		if onCreated != nil {
			if err := onCreated(append([]string(nil), taskIDs...)); err != nil {
				return nil, err
			}
		}
	}
	return taskIDs, nil
}

type TaskInfo struct {
	TaskID string `json:"task_id"`
	Status string `json:"status"`
	Result *struct {
		Code      int      `json:"code"`
		Message   string   `json:"message"`
		MediaURLs []string `json:"media_urls"`
	} `json:"result"`
}

func (c *Client) GetTask(ctx context.Context, taskID string) (*TaskInfo, error) {
	path := "/api/v1/client/job/TaskInfo?task_id=" + url.QueryEscape(taskID)
	var data TaskInfo
	if err := c.doJSON(ctx, http.MethodGet, path, nil, &data); err != nil {
		return nil, err
	}
	return &data, nil
}

func (c *Client) WaitTasks(ctx context.Context, taskIDs []string, onImage func(index int, imageURL string) error) ([]string, error) {
	if len(taskIDs) == 0 {
		return nil, errors.New("CRUN task ids are empty")
	}
	waitCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	for {
		results, pending, err := c.PollTasks(waitCtx, taskIDs)
		if err != nil {
			if IsRetryableError(err) {
				pending = true
			} else {
				return nil, err
			}
		}
		if !pending {
			for index, imageURL := range results {
				if onImage != nil {
					if err := onImage(index, imageURL); err != nil {
						return nil, err
					}
				}
			}
			return results, nil
		}
		timer := time.NewTimer(c.pollInterval)
		select {
		case <-waitCtx.Done():
			timer.Stop()
			return nil, waitCtx.Err()
		case <-timer.C:
		}
	}
}

// WaitMediaTask waits for one generic CRUN job and returns every media URL.
// Video and audio models may return multiple artifacts from a single job.
func (c *Client) WaitMediaTask(ctx context.Context, taskID string) ([]string, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return nil, errors.New("CRUN task id is empty")
	}
	waitCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	for {
		info, err := c.GetTask(waitCtx, taskID)
		if err == nil {
			switch strings.ToLower(strings.TrimSpace(info.Status)) {
			case "pending", "running", "":
			case "success":
				if info.Result == nil || info.Result.Code != 200 || len(info.Result.MediaURLs) == 0 {
					return nil, &UpstreamError{Code: 501, Message: "CRUN task completed without media"}
				}
				urls := make([]string, 0, len(info.Result.MediaURLs))
				for _, mediaURL := range info.Result.MediaURLs {
					if mediaURL = strings.TrimSpace(mediaURL); mediaURL != "" {
						urls = append(urls, mediaURL)
					}
				}
				if len(urls) == 0 {
					return nil, &UpstreamError{Code: 501, Message: "CRUN returned empty media URLs"}
				}
				return urls, nil
			case "failed":
				message, code := "CRUN media generation failed", 501
				if info.Result != nil {
					code = info.Result.Code
					if strings.TrimSpace(info.Result.Message) != "" {
						message = info.Result.Message
					}
				}
				return nil, &UpstreamError{Code: code, Message: message}
			default:
				return nil, &UpstreamError{Code: 501, Message: "unknown CRUN task status: " + info.Status}
			}
		} else if !IsRetryableError(err) {
			return nil, err
		}
		timer := time.NewTimer(c.pollInterval)
		select {
		case <-waitCtx.Done():
			timer.Stop()
			return nil, waitCtx.Err()
		case <-timer.C:
		}
	}
}

func IsRetryableError(err error) bool {
	var upstream *UpstreamError
	return errors.As(err, &upstream) && (upstream.Status == 429 || upstream.Status >= 500 || upstream.Code == 455)
}

// PollTasks performs one status query per CRUN job and never waits between queries.
func (c *Client) PollTasks(ctx context.Context, taskIDs []string) ([]string, bool, error) {
	if len(taskIDs) == 0 {
		return nil, false, errors.New("CRUN task ids are empty")
	}
	results := make([]string, len(taskIDs))
	pending := false
	for index, taskID := range taskIDs {
		info, err := c.GetTask(ctx, taskID)
		if err != nil {
			return nil, false, err
		}
		switch strings.ToLower(strings.TrimSpace(info.Status)) {
		case "pending", "running", "":
			pending = true
		case "success":
			if info.Result == nil || info.Result.Code != 200 || len(info.Result.MediaURLs) == 0 {
				return nil, false, &UpstreamError{Code: 501, Message: "CRUN task completed without an image"}
			}
			results[index] = strings.TrimSpace(info.Result.MediaURLs[0])
			if results[index] == "" {
				return nil, false, &UpstreamError{Code: 501, Message: "CRUN returned an empty image URL"}
			}
		case "failed":
			message, code := "CRUN image generation failed", 501
			if info.Result != nil {
				code = info.Result.Code
				if strings.TrimSpace(info.Result.Message) != "" {
					message = info.Result.Message
				}
			}
			return nil, false, &UpstreamError{Code: code, Message: message}
		default:
			return nil, false, &UpstreamError{Code: 500, Message: "unknown CRUN task status: " + info.Status}
		}
	}
	return results, pending, nil
}
