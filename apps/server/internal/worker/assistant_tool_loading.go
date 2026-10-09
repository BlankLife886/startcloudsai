package worker

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/BlankLife886/startcloudsai/server/internal/assistanttools"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
	"github.com/BlankLife886/startcloudsai/server/internal/sub2api"
)

// 工具按需加载。
//
// 每次请求模型都要把全部工具的完整定义发一遍，一轮里调几次工具就发几遍。可绝大多数
// 回复一个工具都不调，账户、素材、记忆、站内动作这些工具一个月也用不了几次，它们的
// 定义却占了每次请求输入的一半以上。所以这些低频工具平时只在 load_tools 的说明里占
// 一行；模型要用时先调 load_tools，同一轮里下一次请求就带上完整定义。
//
// 不靠猜用户意图来砍能力：目录始终在，模型随时能加载，猜测只用来提前加载（猜错只是
// 多带几个定义）。本对话用过的工具、本轮强制要调的工具也提前带上，免得多一次往返。

const assistantLoadToolsName = "load_tools"

// assistantDeferredToolSummaries 是可以按需加载的工具和它在目录里的一行说明。不在这里
// 的工具（出图方案、联网搜索、任务状态、选择卡、文件、电商套图、技能资料……）照旧每次
// 完整发送：新工具默认常驻，只有确认低频的才放进来。顺序就是目录顺序。
var assistantDeferredToolSummaries = []struct{ name, summary string }{
	{assistanttools.ToolMyStatsQuery, "统计我的生成量、花费、成功率等数据（按时间、模型、工作台）"},
	{assistanttools.ToolMyRecordsList, "列出我的生成、扣费、API 调用等明细记录"},
	{assistanttools.ToolMyAccountOverview, "查看我的余额、积分、套餐和会员状态"},
	{assistanttools.ToolMyOrdersList, "查看我的充值和购买订单"},
	{assistanttools.ToolExplainCharge, "解释某一笔扣费是怎么算的"},
	{assistanttools.ToolAssetsSearch, "在我的素材库里找图"},
	{assistanttools.ToolAssetsSave, "把图片存进素材库"},
	{assistanttools.ToolAssetsOrganize, "整理素材库分组"},
	{assistanttools.ToolMemorySave, "记住用户的长期偏好或信息（用户说“记住…”“以后都…”时）"},
	{assistanttools.ToolMemoryUpdate, "修改一条已记住的记忆"},
	{assistanttools.ToolMemoryForget, "删除一条记忆"},
	{assistanttools.ToolMemorySearch, "查看记忆的完整内容（商品、满意方案等）"},
	{assistanttools.ToolMediaAction, "图片压缩、高清放大、裁剪、切图"},
	{assistanttools.ToolImageSearch, "从公开图库搜索真实参考图"},
	{assistanttools.ToolWebpageCapture, "给网页截图"},
	{assistanttools.ToolProductImport, "从商品链接导入商品信息和图片"},
	{assistanttools.ToolDeliveryExport, "把图片打包导出成交付包"},
	{assistanttools.ToolReferenceRebuild, "按参考图复刻出一个工作流"},
	{assistanttools.ToolSendToWorkspace, "把图片发送到无限画布或 AI 电商工作台"},
	{assistanttools.ToolSiteOperator, "操作站内页面、跳转到对应功能"},
}

func assistantToolIsDeferrable(name string) bool {
	for _, item := range assistantDeferredToolSummaries {
		if item.name == name {
			return true
		}
	}
	return false
}

// assistantToolPreloadRules 按用户这句话提前加载，省掉一次 load_tools 往返。只求大致
// 命中：漏了模型会自己加载，多了只是多带几个定义。
var assistantToolPreloadRules = []struct {
	pattern *regexp.Regexp
	tools   []string
}{
	{regexp.MustCompile(`统计|钱|花(了|费|在|哪|掉|销)|消费|开销|余额|积分|订单|充值|账单|扣费|扣了|用量|明细|记录|多少张|多少次|成功率|失败率|退款|套餐|会员|订阅|API ?(调用|用量|key)`),
		[]string{assistanttools.ToolMyStatsQuery, assistanttools.ToolMyRecordsList, assistanttools.ToolMyAccountOverview, assistanttools.ToolMyOrdersList, assistanttools.ToolExplainCharge}},
	{regexp.MustCompile(`素材库|素材|收藏|存起来|存到|存进|保存到|分组`),
		[]string{assistanttools.ToolAssetsSearch, assistanttools.ToolAssetsSave, assistanttools.ToolAssetsOrganize}},
	{regexp.MustCompile(`记住|记得|记忆|忘掉|忘记|别再用|以后都|以后用|我的品牌|品牌色`),
		[]string{assistanttools.ToolMemorySave, assistanttools.ToolMemoryUpdate, assistanttools.ToolMemoryForget, assistanttools.ToolMemorySearch}},
	{regexp.MustCompile(`压缩|放大|高清|裁剪|切图|切成`), []string{assistanttools.ToolMediaAction}},
	{regexp.MustCompile(`截图|网页|网站|链接|https?://`), []string{assistanttools.ToolWebpageCapture, assistanttools.ToolProductImport}},
	{regexp.MustCompile(`参考图|图库|找图|搜图|找些图|找一些图`), []string{assistanttools.ToolImageSearch}},
	{regexp.MustCompile(`导出|打包|交付`), []string{assistanttools.ToolDeliveryExport}},
	{regexp.MustCompile(`复刻|工作流`), []string{assistanttools.ToolReferenceRebuild}},
	{regexp.MustCompile(`画布|AI ?电商|发送到|发到`), []string{assistanttools.ToolSendToWorkspace}},
	{regexp.MustCompile(`页面|打开|跳转|设置|在哪`), []string{assistanttools.ToolSiteOperator}},
}

func assistantToolPreloadsFor(prompt string) []string {
	out := []string{}
	for _, rule := range assistantToolPreloadRules {
		if rule.pattern.MatchString(prompt) {
			out = append(out, rule.tools...)
		}
	}
	return out
}

// assistantToolsUsedInHistory 是本对话之前调用过的工具：用户多半还会接着用。
func assistantToolsUsedInHistory(history []*store.AssistantMessage) []string {
	out := []string{}
	for _, message := range history {
		if message == nil || message.Role != "assistant" {
			continue
		}
		steps, _ := message.Metadata["toolSteps"].([]any)
		for _, raw := range steps {
			step, _ := raw.(map[string]any)
			if name, _ := step["name"].(string); name != "" {
				out = append(out, name)
			}
		}
		// load_tools 本身不记步骤，记在这里。
		loaded, _ := message.Metadata["loadedTools"].([]any)
		for _, raw := range loaded {
			if name, _ := raw.(string); name != "" {
				out = append(out, name)
			}
		}
	}
	return out
}

// assistantToolLoader 决定每次请求带哪些工具的完整定义。
type assistantToolLoader struct {
	all       []sub2api.FunctionTool
	deferred  map[string]bool
	loaded    []string
	loadTool  sub2api.FunctionTool
	available bool
}

func newAssistantToolLoader(all []sub2api.FunctionTool, preload ...[]string) *assistantToolLoader {
	loader := &assistantToolLoader{all: all, deferred: map[string]bool{}}
	catalog := []string{}
	names := []any{}
	for _, item := range assistantDeferredToolSummaries {
		if !assistantToolListHas(all, item.name) {
			continue
		}
		loader.deferred[item.name] = true
		catalog = append(catalog, "- "+item.name+"："+item.summary)
		names = append(names, item.name)
	}
	if len(catalog) == 0 {
		return loader
	}
	loader.available = true
	// 说明只随“本轮有哪些工具”变化，不随加载进度变化，前缀缓存才稳。
	loader.loadTool = sub2api.FunctionTool{
		Name: assistantLoadToolsName,
		Description: "下面这些工具平时不在你的工具列表里。要用其中任何一个时，先调用本工具加载（一次可加载多个，" +
			"把可能用到的一起加载），加载后即可直接调用。不需要时不要加载。可加载：\n" + strings.Join(catalog, "\n"),
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"names": map[string]any{"type": "array", "minItems": 1, "maxItems": len(names), "items": map[string]any{"type": "string", "enum": names}},
			},
			"required":             []string{"names"},
			"additionalProperties": false,
		},
	}
	for _, list := range preload {
		loader.load(list)
	}
	return loader
}

func assistantToolListHas(tools []sub2api.FunctionTool, name string) bool {
	for _, tool := range tools {
		if tool.Name == name {
			return true
		}
	}
	return false
}

// load 加载列出的工具，返回这次新加载的名字。
func (l *assistantToolLoader) load(names []string) []string {
	added := []string{}
	for _, name := range names {
		name = strings.TrimSpace(name)
		if !l.deferred[name] || containsString(l.loaded, name) {
			continue
		}
		l.loaded = append(l.loaded, name)
		added = append(added, name)
	}
	return added
}

// active 是这次请求要发的完整工具：常驻工具按原顺序在前，然后是 load_tools，加载
// 过的工具按加载顺序追加在最后。新加载的工具只追加，前面的部分保持不变，上游缓存
// 仍能命中前缀。
func (l *assistantToolLoader) active(base []sub2api.FunctionTool) []sub2api.FunctionTool {
	if !l.available {
		return base
	}
	out := make([]sub2api.FunctionTool, 0, len(base)+1)
	pending := false
	for _, tool := range base {
		if l.deferred[tool.Name] {
			if !containsString(l.loaded, tool.Name) {
				pending = true
			}
			continue
		}
		out = append(out, tool)
	}
	if pending {
		out = append(out, l.loadTool)
	}
	for _, name := range l.loaded {
		for _, tool := range base {
			if tool.Name == name {
				out = append(out, tool)
				break
			}
		}
	}
	return out
}

// loadCalls 取出这次回复里的 load_tools 调用。
func (l *assistantToolLoader) loadCalls(result sub2api.AgentChatResult) []sub2api.ToolCall {
	if l == nil || !l.available {
		return nil
	}
	calls := result.ToolCalls
	if len(calls) == 0 && result.ToolCall != nil {
		calls = []sub2api.ToolCall{*result.ToolCall}
	}
	out := []sub2api.ToolCall{}
	for _, call := range calls {
		if call.Name == assistantLoadToolsName {
			out = append(out, call)
		}
	}
	return out
}

// observe 执行一次 load_tools，返回给模型的结果。
func (l *assistantToolLoader) observe(call sub2api.ToolCall) string {
	var input struct {
		Names []string `json:"names"`
	}
	_ = json.Unmarshal([]byte(assistantToolArguments(call.Arguments)), &input)
	added := l.load(input.Names)
	ready := []string{}
	unknown := []string{}
	for _, name := range input.Names {
		name = strings.TrimSpace(name)
		switch {
		case containsString(l.loaded, name):
			ready = append(ready, name)
		case name != "":
			unknown = append(unknown, name)
		}
	}
	if len(ready) == 0 {
		return "没有加载任何工具：只能加载 load_tools 说明里列出的工具。"
	}
	note := fmt.Sprintf("已加载：%s。现在可以直接调用。", strings.Join(ready, "、"))
	if len(added) == 0 {
		note = fmt.Sprintf("%s 已经加载过，直接调用即可。", strings.Join(ready, "、"))
	}
	if len(unknown) > 0 {
		note += fmt.Sprintf("（%s 不在可加载列表里。）", strings.Join(unknown, "、"))
	}
	return note
}

func containsString(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}
