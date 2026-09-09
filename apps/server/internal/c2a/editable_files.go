package c2a

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/netguard"
)

const (
	editableFileSubmitTimeout  = 2 * time.Minute
	editableFilePollTimeout    = 15 * time.Second
	maxEditableReferenceImages = 16
	maxEditableReferenceBytes  = 24 << 20
	maxEditableDownloadBytes   = 256 << 20
)

type EditableFileResult struct {
	PrimaryURL string `json:"primary_url"`
	ZipURL     string `json:"zip_url"`
}

type EditableFileTask struct {
	ID      string             `json:"id"`
	TaskID  string             `json:"taskId"`
	Status  string             `json:"status"`
	Kind    string             `json:"kind"`
	Result  EditableFileResult `json:"result"`
	Error   string             `json:"error"`
	Elapsed int                `json:"elapsed_seconds"`
}

func (t EditableFileTask) RequestedID() string {
	if value := strings.TrimSpace(t.ID); value != "" {
		return value
	}
	return strings.TrimSpace(t.TaskID)
}

func (t EditableFileTask) Done() bool {
	switch strings.ToLower(strings.TrimSpace(t.Status)) {
	case "success", "succeeded", "completed", "complete", "done", "error", "failed", "canceled", "cancelled", "expired":
		return true
	default:
		return false
	}
}

func (t EditableFileTask) Succeeded() bool {
	switch strings.ToLower(strings.TrimSpace(t.Status)) {
	case "success", "succeeded", "completed", "complete", "done":
		return true
	default:
		return false
	}
}

func validateEditableFileRequest(kind, prompt string, images []string) error {
	kind = strings.ToLower(strings.TrimSpace(kind))
	if kind != "ppt" && kind != "psd" {
		return errors.New("editable file kind must be ppt or psd")
	}
	if strings.TrimSpace(prompt) == "" {
		return errors.New("editable file prompt is empty")
	}
	if kind == "psd" && len(images) == 0 {
		return errors.New("PSD generation requires at least one reference image")
	}
	if len(images) > maxEditableReferenceImages {
		return fmt.Errorf("editable file task supports at most %d reference images", maxEditableReferenceImages)
	}
	for _, image := range images {
		if len(image) == 0 || len(image) > maxEditableReferenceBytes*4/3+1024 {
			return fmt.Errorf("editable file reference image exceeds %d MiB limit", maxEditableReferenceBytes>>20)
		}
	}
	return nil
}

func parseEditableFileTask(body []byte) (EditableFileTask, error) {
	var task EditableFileTask
	if err := json.Unmarshal(body, &task); err != nil || task.RequestedID() == "" {
		return EditableFileTask{}, &UpstreamError{Message: "上游未返回有效的可编辑文件任务", StatusCode: http.StatusBadGateway}
	}
	if task.ID == "" {
		task.ID = task.TaskID
	}
	return task, nil
}

// SubmitEditableFileTask creates an idempotent ChatGPT2API PPT/PSD task.
func (c *Client) SubmitEditableFileTask(ctx context.Context, taskID, kind, prompt string, base64Images []string) (EditableFileTask, error) {
	if err := validateEditableFileRequest(kind, prompt, base64Images); err != nil {
		return EditableFileTask{}, err
	}
	payload := map[string]any{
		"client_task_id": strings.TrimSpace(taskID),
		"kind":           strings.ToLower(strings.TrimSpace(kind)),
		"prompt":         strings.TrimSpace(prompt),
		"base64_images":  base64Images,
	}
	body, err := c.doRequest(ctx, http.MethodPost, "/v1/editable-file-tasks", payload, editableFileSubmitTimeout)
	if err != nil {
		return EditableFileTask{}, err
	}
	return parseEditableFileTask(body)
}

// PollEditableFileTask performs one lightweight status query.
func (c *Client) PollEditableFileTask(ctx context.Context, taskID string) (EditableFileTask, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return EditableFileTask{}, errors.New("editable file task id is empty")
	}
	body, err := c.doRequest(ctx, http.MethodGet, "/v1/editable-file-tasks?ids="+url.QueryEscape(taskID), nil, editableFilePollTimeout)
	if err != nil {
		return EditableFileTask{}, err
	}
	var payload struct {
		Items      []EditableFileTask `json:"items"`
		MissingIDs []string           `json:"missing_ids"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return EditableFileTask{}, &UpstreamError{Message: "上游未返回有效的可编辑文件任务状态", StatusCode: http.StatusBadGateway}
	}
	for _, task := range payload.Items {
		if task.RequestedID() == taskID {
			if task.ID == "" {
				task.ID = taskID
			}
			return task, nil
		}
	}
	return EditableFileTask{}, &NetworkError{Message: "上游可编辑文件任务暂时不可查询"}
}

func (c *Client) editableDownloadURL(raw string) (*url.URL, bool, error) {
	base, err := url.Parse(c.BaseURL)
	if err != nil || base.Scheme == "" || base.Host == "" {
		return nil, false, &UpstreamError{Message: "上游文件地址无效", StatusCode: http.StatusBadGateway}
	}
	target, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || target.String() == "" {
		return nil, false, &UpstreamError{Message: "上游文件地址无效", StatusCode: http.StatusBadGateway}
	}
	if !target.IsAbs() {
		origin := *base
		origin.Path, origin.RawPath, origin.RawQuery, origin.Fragment = "/", "", "", ""
		target = origin.ResolveReference(target)
	}
	if err := netguard.ValidateURL(target.String(), c.AllowPrivate, false); err != nil {
		return nil, false, &UpstreamError{Message: "上游文件地址不安全", StatusCode: http.StatusBadGateway}
	}
	sameOrigin := target.Scheme == base.Scheme && strings.EqualFold(target.Host, base.Host)
	return target, sameOrigin, nil
}

// DownloadEditableFile securely downloads one upstream artifact with a strict
// size limit. The caller validates the file signature before persisting it.
func (c *Client) DownloadEditableFile(ctx context.Context, rawURL string, limit int64) ([]byte, string, string, error) {
	if limit <= 0 || limit > maxEditableDownloadBytes {
		limit = maxEditableDownloadBytes
	}
	target, sameOrigin, err := c.editableDownloadURL(rawURL)
	if err != nil {
		return nil, "", "", err
	}
	downloadTimeout := min(max(2*time.Minute, c.Timeout), 5*time.Minute)
	reqCtx, cancel := context.WithTimeout(ctx, downloadTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, "", "", err
	}
	if sameOrigin {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, "", "", &NetworkError{Message: fmt.Sprintf("下载上游文件失败：%v", err), Err: err}
	}
	defer resp.Body.Close()
	if resp.Request == nil || resp.Request.URL == nil || netguard.ValidateURL(resp.Request.URL.String(), c.AllowPrivate, false) != nil {
		return nil, "", "", &UpstreamError{Message: "上游文件下载跳转地址不安全", StatusCode: http.StatusBadGateway}
	}
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
		return nil, "", "", &UpstreamError{Message: "下载上游文件失败：" + errorMessage(body), StatusCode: resp.StatusCode}
	}
	if resp.ContentLength > limit {
		return nil, "", "", &UpstreamError{Message: fmt.Sprintf("上游文件超过 %d MiB 限制", limit>>20), StatusCode: http.StatusBadGateway}
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, "", "", &NetworkError{Message: fmt.Sprintf("下载上游文件失败：%v", err), Err: err}
	}
	if len(data) == 0 || int64(len(data)) > limit {
		return nil, "", "", &UpstreamError{Message: fmt.Sprintf("上游文件为空或超过 %d MiB 限制", limit>>20), StatusCode: http.StatusBadGateway}
	}
	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if mediaType, _, parseErr := mime.ParseMediaType(contentType); parseErr == nil {
		contentType = mediaType
	}
	fileName := path.Base(resp.Request.URL.Path)
	if _, params, parseErr := mime.ParseMediaType(resp.Header.Get("Content-Disposition")); parseErr == nil && strings.TrimSpace(params["filename"]) != "" {
		fileName = path.Base(strings.ReplaceAll(params["filename"], "\\", "/"))
	}
	return data, contentType, fileName, nil
}
