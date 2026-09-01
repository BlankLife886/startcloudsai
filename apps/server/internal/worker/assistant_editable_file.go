package worker

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantbilling"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantstream"
	"github.com/BlankLife886/startcloudsai/server/internal/assistanttools"
	"github.com/BlankLife886/startcloudsai/server/internal/c2a"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/google/uuid"
)

const (
	assistantEditablePollInterval = 5 * time.Second
	assistantEditableMaxWait      = 20 * time.Minute
	assistantEditablePrimaryMax   = 192 << 20
	assistantEditableArchiveMax   = 256 << 20
)

func (w *Worker) setAssistantEditableStage(ctx context.Context, run *store.AssistantRun, stage string) error {
	if err := w.setAssistantRunStage(ctx, run, "chat", stage); err != nil {
		return err
	}
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, "", "chat", "running",
		assistantMessageMetadata(run, nil, stage, "")); err != nil {
		return err
	}
	assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{Kind: "chat", Stage: stage})
	return nil
}

func editableTaskError(task c2a.EditableFileTask) error {
	message := strings.TrimSpace(task.Error)
	if message == "" {
		message = "上游未能完成可编辑文件制作"
	}
	return &c2a.UpstreamError{Message: message, StatusCode: 502}
}

func (w *Worker) waitAssistantEditableTask(
	ctx context.Context,
	client *c2a.Client,
	runID uuid.UUID,
	taskID string,
	initial c2a.EditableFileTask,
	submitErr error,
) (c2a.EditableFileTask, error) {
	if initial.Done() {
		if initial.Succeeded() {
			return initial, nil
		}
		return c2a.EditableFileTask{}, editableTaskError(initial)
	}
	deadline := time.NewTimer(assistantEditableMaxWait)
	defer deadline.Stop()
	ticker := time.NewTicker(assistantEditablePollInterval)
	defer ticker.Stop()
	failedRecoveryPolls := 0
	for {
		select {
		case <-ctx.Done():
			return c2a.EditableFileTask{}, ctx.Err()
		case <-deadline.C:
			return c2a.EditableFileTask{}, &c2a.NetworkError{Message: "等待上游制作 PPT/PSD 超时", Err: context.DeadlineExceeded}
		case <-ticker.C:
			if terminated, err := w.assistantRunTerminated(ctx, runID); err != nil || terminated {
				if err != nil {
					return c2a.EditableFileTask{}, err
				}
				return c2a.EditableFileTask{}, context.Canceled
			}
			task, err := client.PollEditableFileTask(ctx, taskID)
			if err != nil {
				if !c2a.IsRetryableError(err) {
					return c2a.EditableFileTask{}, err
				}
				if submitErr != nil {
					failedRecoveryPolls++
					if failedRecoveryPolls >= 6 {
						return c2a.EditableFileTask{}, submitErr
					}
				}
				continue
			}
			failedRecoveryPolls = 0
			if !task.Done() {
				continue
			}
			if !task.Succeeded() {
				return c2a.EditableFileTask{}, editableTaskError(task)
			}
			return task, nil
		}
	}
}

func validEditablePrimary(kind string, data []byte) error {
	switch kind {
	case "psd":
		if len(data) < 26 || string(data[:4]) != "8BPS" {
			return errors.New("上游返回的 PSD 文件格式无效")
		}
		return nil
	case "ppt":
		reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			return errors.New("上游返回的 PPTX 文件格式无效")
		}
		seenContentTypes, seenPresentation := false, false
		for _, entry := range reader.File {
			switch entry.Name {
			case "[Content_Types].xml":
				seenContentTypes = true
			case "ppt/presentation.xml":
				seenPresentation = true
			}
		}
		if !seenContentTypes || !seenPresentation {
			return errors.New("上游返回的 PPTX 缺少必要内容")
		}
		return nil
	default:
		return errors.New("不支持的可编辑文件类型")
	}
}

func validEditableArchive(data []byte) error {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil || len(reader.File) == 0 {
		return errors.New("上游返回的素材压缩包格式无效")
	}
	return nil
}

func editableArtifactName(kind, upstream string, archive bool) string {
	ext := ".pptx"
	base := "AI演示文稿"
	if kind == "psd" {
		ext = ".psd"
		base = "AI分层设计"
	}
	if archive {
		ext = ".zip"
		base += "-素材"
	}
	upstream = filepath.Base(strings.ReplaceAll(strings.TrimSpace(upstream), "\\", "/"))
	if strings.EqualFold(filepath.Ext(upstream), ext) {
		return upstream
	}
	return base + ext
}

func assistantEditableReferences(ctx context.Context, references []string) ([]string, error) {
	out := make([]string, 0, len(references))
	for _, reference := range references {
		reference = strings.TrimSpace(reference)
		if strings.HasPrefix(reference, "data:image/") {
			out = append(out, reference)
			continue
		}
		data, contentType, _, err := downloadAssistantImage(ctx, reference)
		if err != nil {
			return nil, fmt.Errorf("读取 PPT/PSD 参考图失败: %w", err)
		}
		if len(data) > 16<<20 {
			return nil, errors.New("PPT/PSD 单张参考图不能超过 16 MiB")
		}
		out = append(out, "data:"+contentType+";base64,"+base64.StdEncoding.EncodeToString(data))
	}
	return out, nil
}

func (w *Worker) assistantEditableClient(ctx context.Context, run *store.AssistantRun) (*c2a.Client, error) {
	cfg, err := modelconfig.Runtime(ctx, w.St.Pool, w.Cfg.AppSecret)
	if err != nil {
		return nil, err
	}
	if !cfg.EditableFiles.Enabled {
		return nil, errors.New("PPT/PSD 可编辑文件功能尚未开启")
	}
	provider, configured := modelconfig.EditableFileProvider(cfg)
	if !configured {
		return nil, errors.New("PPT/PSD 服务商或线路配置已失效")
	}
	if strings.TrimSpace(provider.APIKey) == "" {
		return nil, errors.New("PPT/PSD 服务商线路没有可用的 API Key")
	}
	return c2a.NewWithPolicy(
		provider.BaseURL,
		provider.APIKey,
		provider.TimeoutSecs,
		w.Cfg.C2APrivateNetworkAllowed(),
	), nil
}

func (w *Worker) executeAssistantEditableFile(
	ctx context.Context,
	run *store.AssistantRun,
	references []string,
	kind string,
) error {
	if w == nil || w.St == nil || w.Storage == nil {
		return errors.New("可编辑文件存储不可用")
	}
	if kind == "psd" && len(references) == 0 {
		return errors.New("制作分层 PSD 前，请先上传一张 JPG、PNG 或 WebP 参考图")
	}
	run.ResolvedMode = "chat"
	if err := w.setAssistantEditableStage(ctx, run, "submitting-file"); err != nil {
		return err
	}
	client, err := w.assistantEditableClient(ctx, run)
	if err != nil {
		return err
	}
	references, err = assistantEditableReferences(ctx, references)
	if err != nil {
		return err
	}
	taskID := run.ID.String()
	task, submitErr := client.SubmitEditableFileTask(ctx, taskID, kind, run.Prompt, references)
	if submitErr != nil && !c2a.IsRetryableError(submitErr) {
		return submitErr
	}
	if returnedID := task.RequestedID(); returnedID != "" {
		taskID = returnedID
	}
	if err := w.setAssistantEditableStage(ctx, run, "generating-file"); err != nil {
		return err
	}
	task, err = w.waitAssistantEditableTask(ctx, client, run.ID, taskID, task, submitErr)
	if err != nil {
		return err
	}
	if strings.TrimSpace(task.Result.PrimaryURL) == "" {
		return errors.New("上游任务已完成，但没有返回 PPT/PSD 文件")
	}
	if err := w.setAssistantEditableStage(ctx, run, "saving-file"); err != nil {
		return err
	}

	primary, contentType, primaryName, err := client.DownloadEditableFile(ctx, task.Result.PrimaryURL, assistantEditablePrimaryMax)
	if err != nil {
		return err
	}
	if err := validEditablePrimary(kind, primary); err != nil {
		return err
	}
	if kind == "ppt" {
		contentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	} else {
		contentType = "image/vnd.adobe.photoshop"
	}
	invocation := assistanttools.Invocation{UserID: run.UserID, RunID: run.ID, AssistantMessageID: run.AssistantMessageID}
	artifact, err := assistanttools.PersistGeneratedArtifact(ctx, w.St, w.Storage, invocation,
		editableArtifactName(kind, primaryName, false), contentType, primary)
	if err != nil {
		return err
	}
	artifacts := []map[string]any{artifact}
	archiveWarning := ""
	if strings.TrimSpace(task.Result.ZipURL) != "" {
		archive, _, archiveName, downloadErr := client.DownloadEditableFile(ctx, task.Result.ZipURL, assistantEditableArchiveMax)
		if downloadErr == nil {
			downloadErr = validEditableArchive(archive)
		}
		if downloadErr == nil {
			archiveArtifact, persistErr := assistanttools.PersistGeneratedArtifact(ctx, w.St, w.Storage, invocation,
				editableArtifactName(kind, archiveName, true), "application/zip", archive)
			if persistErr == nil {
				artifacts = append(artifacts, archiveArtifact)
			} else {
				downloadErr = persistErr
			}
		}
		if downloadErr != nil {
			archiveWarning = " 主文件已保存，但素材压缩包暂时保存失败。"
		}
	}
	label := "可编辑 PPT"
	if kind == "psd" {
		label = "分层 PSD"
	}
	text := fmt.Sprintf("%s 已制作完成，可在下方下载。", label) + archiveWarning
	metadata := assistantMessageMetadata(run, nil, "complete", "")
	metadata["artifacts"] = artifacts
	metadata["toolsUsed"] = []string{"chatgpt2api_editable_" + kind}
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, text, "chat", "complete", metadata); err != nil {
		return err
	}
	completed, err := assistantbilling.CompleteAttempt(ctx, w.St, run.ID, run.Attempt, "chat")
	if err != nil {
		return err
	}
	if !completed {
		return context.Canceled
	}
	assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{
		Content: text, Kind: "chat", Done: true, Status: "succeeded",
	})
	return nil
}
