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

func (c *Client) CreateTask(ctx context.Context, prompt, aspectRatio, resolution string, imageURLs []string) (string, error) {
	return c.CreateTaskWithRequest(ctx, OpenAIImageRequest{
		Prompt: prompt, AspectRatio: aspectRatio, Resolution: resolution, ImageURLs: imageURLs,
	})
}

func (c *Client) CreateTaskWithRequest(ctx context.Context, request OpenAIImageRequest) (string, error) {
	input := map[string]any{"prompt": request.Prompt}
	if strings.TrimSpace(request.AspectRatio) != "" {
		input["aspect_ratio"] = request.AspectRatio
	}
	if len(request.ImageURLs) > 0 {
		input["img_urls"] = request.ImageURLs
	}
	// CRUN's base GPT Image 2 schema rejects the Premium-only resolution field.
	if strings.TrimSpace(request.Resolution) != "" && c.model != DefaultModel {
		input["resolution"] = request.Resolution
	}
	if quality := strings.ToLower(strings.TrimSpace(request.Quality)); quality != "" {
		input["quality"] = quality
	}
	if request.TransparentBackground {
		input["background"] = "transparent"
	}
	if format := strings.ToLower(strings.TrimSpace(request.OutputFormat)); format != "" {
		input["output_format"] = format
	}
	if moderation := strings.ToLower(strings.TrimSpace(request.ModerationLevel)); moderation != "" {
		input["moderation"] = moderation
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
		return "", errors.New("CRUN returned an empty task id")
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
