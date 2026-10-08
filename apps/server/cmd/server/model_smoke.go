package main

import (
	"context"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/modelconfig"
	"github.com/BlankLife886/startcloudsai/server/internal/modelprovider"
	"github.com/BlankLife886/startcloudsai/server/internal/modeltest"
)

// runModelSmoke exercises every model of one configured provider against the
// real upstream through the production client stack: chat models answer a
// prompt and are probed for tool calling; image models generate one image and
// then edit it as a reference. Keys are read from the stored configuration
// and never printed.
func runModelSmoke(cfg *config.Config, args []string) error {
	fs := flag.NewFlagSet("model-smoke", flag.ExitOnError)
	providerQuery := fs.String("provider", "", "服务商 ID、名称或模板 ID（必填）")
	modelList := fs.String("models", "", "只测这些上游模型 ID（逗号分隔）；默认测该服务商下已配置的全部模型")
	catalog := fs.Bool("catalog", false, "改为测试上游目录里所有可用模型（不限于已配置的）")
	kindFilter := fs.String("kind", "", "只测 chat 或 image；配合 -catalog 时，未设定类型的模型按此类型测试")
	outDir := fs.String("out", "model-smoke-output", "生成图片的保存目录")
	edit := fs.Bool("edit", true, "生图模型额外测试一次带参考图的图生图")
	parallel := fs.Int("parallel", 3, "并发数")
	listOnly := fs.Bool("list", false, "只列出上游模型目录及分类，不发起生成")
	rawImage := fs.String("raw-image", "", "诊断：按原样发送这些生图请求体（JSON 数组，不套用兼容规则），报告扣费、格式和实际尺寸")
	chatPrompt := fs.String("prompt", "", "对话测试的提问内容（默认请模型自我介绍）")
	skipTools := fs.Bool("skip-tools", false, "对话模型不测工具调用")
	reasoningEffort := fs.String("reasoning", "", "对话测试带上的推理档位（reasoning_effort），如 low、medium、high")
	toolChoice := fs.String("tool-choice", "", "工具调用测试的 tool_choice（默认 auto，可设 required 判断上游是否透传工具）")
	imageParams := fs.String("image-params", "", "仅本次测试：使用这个生图参数档案（ID），不改后台配置")
	imageSize := fs.String("size", "", "生图测试的尺寸，如 2048x1152（默认 1024x1024）")
	imageEdit := fs.String("image-edit", "", "仅本次测试：参考图发送方式（multipart、json_image_url、json_generations）")
	chatAPI := fs.String("chat-api", "", "仅本次测试：覆盖 Gemini 对话接口（v1 为 /v1/chat/completions，official 为 /v1beta/openai），不改后台配置")
	imageResponse := fs.String("image-response", "", "仅本次测试：覆盖 Gemini 图片返回方式（inline、text_url、text_data_uri），不改后台配置")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*providerQuery) == "" {
		return errors.New("请用 -provider 指定服务商")
	}
	ctx := context.Background()
	st, err := newStore(ctx, cfg)
	if err != nil {
		return err
	}
	defer st.Close()
	runtimeCfg, err := modelconfig.Runtime(ctx, st.Pool, cfg.AppSecret)
	if err != nil {
		return err
	}
	provider, err := smokeProvider(runtimeCfg, *providerQuery)
	if err != nil {
		return err
	}
	allowPrivate := cfg.C2APrivateNetworkAllowed()
	if *rawImage != "" {
		return runRawImageProbe(provider, *rawImage, allowPrivate)
	}
	if *listOnly {
		result, err := modelprovider.DiscoverModels(ctx, provider, allowPrivate)
		if err != nil {
			return fmt.Errorf("读取模型目录失败：%w", err)
		}
		for _, entry := range result.Entries {
			fmt.Printf("%-48s kind=%-6s compatible=%-5v methods=%v %s\n", entry.ID, entry.Kind, entry.Compatible, entry.Operations, entry.Incompatibility)
		}
		return nil
	}

	type target struct {
		model modelconfig.Model
	}
	var targets []target
	wanted := map[string]bool{}
	for _, id := range strings.Split(*modelList, ",") {
		if id = strings.TrimSpace(id); id != "" {
			wanted[id] = true
		}
	}
	if *catalog {
		result, err := modelprovider.DiscoverModels(ctx, provider, allowPrivate)
		if err != nil {
			return fmt.Errorf("读取模型目录失败：%w", err)
		}
		// The type is never guessed: use the kind the admin configured, or the
		// one given with -kind; anything else is skipped and listed.
		configuredKind := map[string]string{}
		for _, model := range runtimeCfg.Models {
			if model.ProviderID == provider.ID {
				configuredKind[model.UpstreamModel] = model.Kind
			}
		}
		var untyped []string
		for _, entry := range result.Entries {
			if !entry.Compatible {
				continue
			}
			kind := configuredKind[entry.ID]
			if kind == "" {
				kind = *kindFilter
			}
			if kind != modelconfig.ModelKindChat && kind != modelconfig.ModelKindImage {
				untyped = append(untyped, entry.ID)
				continue
			}
			targets = append(targets, target{modelconfig.Model{ID: entry.ID, Name: entry.ID, UpstreamModel: entry.ID, Kind: kind, ProviderID: provider.ID}})
		}
		if len(untyped) > 0 {
			fmt.Printf("跳过 %d 个未设定类型的模型（在后台设定类型，或用 -kind 指定）：%s\n\n", len(untyped), strings.Join(untyped, ", "))
		}
	} else {
		for _, model := range runtimeCfg.Models {
			if model.ProviderID == provider.ID && (model.Kind == modelconfig.ModelKindChat || model.Kind == modelconfig.ModelKindImage) {
				targets = append(targets, target{model})
			}
		}
	}
	filtered := targets[:0]
	for _, item := range targets {
		if len(wanted) > 0 && !wanted[item.model.UpstreamModel] {
			continue
		}
		if *kindFilter != "" && item.model.Kind != *kindFilter {
			continue
		}
		filtered = append(filtered, item)
	}
	targets = filtered
	if len(targets) == 0 {
		return errors.New("没有可测试的模型（检查 -models / -kind，或用 -catalog 测试上游目录）")
	}
	sort.Slice(targets, func(i, j int) bool { return targets[i].model.UpstreamModel < targets[j].model.UpstreamModel })
	if err := os.MkdirAll(*outDir, 0o755); err != nil {
		return err
	}
	fmt.Printf("服务商：%s（%s，协议 %s）· 测试 %d 个模型\n\n", provider.Name, provider.ID, provider.Adapter, len(targets))

	results := make([]modeltest.Result, len(targets))
	sem := make(chan struct{}, max(1, *parallel))
	var wg sync.WaitGroup
	for index, item := range targets {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			selection := &modelconfig.Selection{Provider: provider, Model: item.model}
			if *imageParams != "" || *imageEdit != "" {
				compat := modelconfig.RequestCompat{}
				if selection.Model.Compat != nil {
					compat = *selection.Model.Compat
				}
				if *imageParams != "" {
					compat.ImageParams = *imageParams
					if err := modelconfig.ResolveCompatImageParams(ctx, st.Pool, &compat); err != nil {
						results[index] = modeltest.Result{Model: item.model.UpstreamModel, Kind: item.model.Kind, Steps: []modeltest.Step{{Name: "档案", Detail: err.Error()}}}
						return
					}
				}
				if *imageEdit != "" {
					compat.ImageEdit = strings.TrimPrefix(*imageEdit, "multipart")
				}
				selection.Model.Compat = &compat
			}
			if *chatAPI != "" {
				compat := modelconfig.RequestCompat{}
				if selection.Model.Compat != nil {
					compat = *selection.Model.Compat
				}
				compat.ChatAPI = strings.TrimPrefix(*chatAPI, "official")
				selection.Model.Compat = &compat
			}
			if *imageResponse != "" {
				compat := modelconfig.RequestCompat{}
				if selection.Model.Compat != nil {
					compat = *selection.Model.Compat
				}
				compat.ImageResponse = strings.TrimPrefix(*imageResponse, "inline")
				selection.Model.Compat = &compat
			}
			if item.model.Kind == modelconfig.ModelKindChat {
				results[index] = modeltest.Chat(ctx, selection, modeltest.ChatOptions{Prompt: *chatPrompt, SkipTools: *skipTools, ToolChoice: *toolChoice, ReasoningEffort: *reasoningEffort})
			} else {
				results[index] = modeltest.Image(ctx, selection, allowPrivate, modeltest.ImageOptions{Edit: *edit, Size: *imageSize})
			}
		}()
	}
	wg.Wait()
	failed := 0
	for _, result := range results {
		printSmokeResult(result, *outDir)
		if !result.OK() {
			failed++
		}
	}
	fmt.Printf("\n通过 %d / %d；图片保存在 %s\n", len(results)-failed, len(results), *outDir)
	if failed > 0 {
		return fmt.Errorf("%d 个模型未通过", failed)
	}
	return nil
}

func smokeProvider(cfg modelconfig.Config, query string) (modelconfig.Provider, error) {
	query = strings.ToLower(strings.TrimSpace(query))
	var matches []modelconfig.Provider
	for _, provider := range cfg.Providers {
		if strings.ToLower(provider.ID) == query || strings.ToLower(provider.Name) == query || strings.ToLower(provider.Vendor) == query {
			matches = append(matches, provider)
		}
	}
	if len(matches) != 1 {
		names := make([]string, 0, len(cfg.Providers))
		for _, provider := range cfg.Providers {
			names = append(names, fmt.Sprintf("%s（id=%s 模板=%s 协议=%s）", provider.Name, provider.ID, provider.Vendor, provider.Adapter))
		}
		return modelconfig.Provider{}, fmt.Errorf("找到 %d 个匹配「%s」的服务商；现有：%s", len(matches), query, strings.Join(names, "；"))
	}
	provider, ok := modelconfig.TestRoute(matches[0])
	if !ok {
		return modelconfig.Provider{}, fmt.Errorf("服务商 %s 没有填写 API Key 的线路", provider.Name)
	}
	return provider, nil
}

// printSmokeResult prints one model's result and saves its images.
func printSmokeResult(result modeltest.Result, outDir string) {
	status := "✅"
	if !result.OK() {
		status = "❌"
	}
	kind := "对话"
	if result.Kind == modelconfig.ModelKindImage {
		kind = "生图"
	}
	fmt.Printf("%s %s [%s]\n", status, result.Model, kind)
	safe := strings.NewReplacer("/", "_", ":", "_").Replace(result.Model)
	for index, step := range result.Steps {
		mark := "  ✓"
		if !step.OK {
			mark = "  ✕"
		}
		detail := strings.ReplaceAll(step.Detail, "\n", " ")
		if step.Image != "" {
			path := filepath.Join(outDir, fmt.Sprintf("%s-%d.png", safe, index+1))
			if data, err := base64.StdEncoding.DecodeString(step.Image); err == nil && os.WriteFile(path, data, 0o644) == nil {
				detail += " → " + path
			}
		}
		fmt.Printf("%s %s %.1fs  %s\n", mark, step.Name, float64(step.LatencyMs)/1000, modeltest.Truncate(detail, 200))
	}
}
