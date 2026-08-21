package worker

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantbilling"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantfiles"
	"github.com/BlankLife886/startcloudsai/server/internal/assistantstream"
	"github.com/BlankLife886/startcloudsai/server/internal/assistanttools"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

func (w *Worker) executeAssistantPSDConversion(
	ctx context.Context,
	run *store.AssistantRun,
	references []string,
) error {
	if w == nil || w.St == nil || w.Storage == nil {
		return errors.New("PSD conversion storage is unavailable")
	}
	if len(references) == 0 {
		return errors.New("请先粘贴或上传一张 JPG、PNG 或 WebP 图片")
	}
	run.ResolvedMode = "chat"
	const stage = "converting-file"
	if err := w.setAssistantRunStage(ctx, run, "chat", stage); err != nil {
		return err
	}
	if err := store.UpdateAssistantMessage(ctx, w.St.Pool, run.AssistantMessageID, "", "chat", "running",
		assistantMessageMetadata(run, nil, stage, "")); err != nil {
		return err
	}
	assistantstream.Publish(ctx, w.Stream, run.ID.String(), assistantstream.Event{Kind: "chat", Stage: stage})

	sourceItems := assistantProposalReferences(run.Params)
	artifacts := make([]map[string]any, 0, len(references))
	failures := make([]string, 0)
	totalLayers := 0
	totalTextLayers := 0
	for index, reference := range references {
		data, _, _, err := downloadAssistantImage(ctx, reference)
		if err != nil {
			failures = append(failures, fmt.Sprintf("第 %d 张图片读取失败", index+1))
			continue
		}
		sourceName := fmt.Sprintf("image-%d", index+1)
		if index < len(sourceItems) {
			if value := strings.TrimSpace(assistantMapString(sourceItems[index], "name")); value != "" {
				sourceName = value
			}
		}
		artifactName := psdArtifactName(sourceName, index, len(references))
		textRegions := w.assistantPSDTextRegions(ctx, data)
		artifact, info, err := assistanttools.CreateAutoLayeredPSDArtifact(ctx, w.St, w.Storage, assistanttools.Invocation{
			UserID: run.UserID, RunID: run.ID, AssistantMessageID: run.AssistantMessageID,
		}, artifactName, sourceName, data, textRegions)
		if err != nil {
			failures = append(failures, fmt.Sprintf("%s：%s", sourceName, err.Error()))
			continue
		}
		artifacts = append(artifacts, artifact)
		totalLayers += info.LayerCount
		totalTextLayers += info.TextLayerCount
	}
	if len(artifacts) == 0 {
		if len(failures) > 0 {
			return errors.New(strings.Join(failures, "；"))
		}
		return errors.New("没有可转换的图片")
	}

	text := fmt.Sprintf("已将 %d 张图片转换为自动拆层 PSD，共生成 %d 个图层，可在下方下载。", len(artifacts), totalLayers)
	if totalTextLayers > 0 {
		text += fmt.Sprintf(" 其中包含 %d 个 OCR 文字区域图层；文字目前是独立栅格层，不是可改字体的原生文字层。", totalTextLayers)
	} else {
		text += " 当前图片未检测到可靠文字区域。"
	}
	text += " 主体、背景和文字边界由程序近似识别，复杂画面仍可能需要手工修整蒙版。"
	if len(failures) > 0 {
		text += fmt.Sprintf(" 另有 %d 张未完成：%s。", len(failures), strings.Join(failures, "；"))
	}
	metadata := assistantMessageMetadata(run, nil, "complete", "")
	metadata["artifacts"] = artifacts
	metadata["toolsUsed"] = []string{"image_to_layered_psd"}
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

func (w *Worker) assistantPSDTextRegions(ctx context.Context, data []byte) []assistanttools.PSDTextRegion {
	if w == nil || w.Cfg == nil || !w.Cfg.AssistantOCREnabled {
		return nil
	}
	regions, err := assistantfiles.OCRImageRegions(ctx, data, assistantfiles.ImageOCRConfig{
		TesseractPath: w.Cfg.AssistantTesseractPath,
		Languages:     w.Cfg.AssistantOCRLanguages,
		Timeout:       w.Cfg.AssistantOCRTimeout,
	})
	if err != nil {
		return nil
	}
	out := make([]assistanttools.PSDTextRegion, 0, len(regions))
	for _, region := range regions {
		out = append(out, assistanttools.PSDTextRegion{Text: region.Text, Bounds: region.Bounds})
	}
	return out
}

func psdArtifactName(sourceName string, index, total int) string {
	base := strings.TrimSpace(strings.TrimSuffix(filepath.Base(strings.ReplaceAll(sourceName, "\\", "/")), filepath.Ext(sourceName)))
	if base == "" || base == "." {
		base = "image"
	}
	if total > 1 {
		base = fmt.Sprintf("%s-%d", base, index+1)
	}
	return base + ".psd"
}
