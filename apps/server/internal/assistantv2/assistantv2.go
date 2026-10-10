// Package assistantv2 holds what the assistant says about the platform and
// the platform tools it can call: the user's own data, account, assets,
// memory and e-commerce sets. The worker's agent and the admin statistics
// evaluation both build on it, so an evaluation measures what users get.
//
// There is no routing step: one agent sees every tool the mode allows and
// chooses for itself, so a turn can never be sent down the wrong path.
package assistantv2

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/assistanttools"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// SystemVersion is recorded on every answer so evaluations and logs can tell
// prompt revisions apart.
const SystemVersion = "assistant-v2-3"

// Domains v2 runs directly. Files join only when documents are attached.
const (
	DomainMyData     = "my_data"
	DomainMyAccount  = "my_account"
	DomainTaskStatus = "task-status"
	DomainFiles      = "files"
	DomainCommerce   = assistanttools.DomainCommerceSet
	DomainMyAssets   = assistanttools.DomainMyAssets
	DomainMemory     = assistanttools.DomainMemory
)

// TurnPermissions are granted on every v2 turn; file permissions are added by
// the caller when documents are attached.
var TurnPermissions = []assistanttools.Permission{
	assistanttools.PermissionMyDataRead,
	assistanttools.PermissionAccountRead,
	assistanttools.PermissionTasksRead,
	assistanttools.PermissionCommerceSets,
	assistanttools.PermissionAssetsRead,
	assistanttools.PermissionMemory,
}

// Registry builds the capabilities v2 can call. Each domain is one manifest;
// adding a platform capability means adding a manifest here.
func Registry(st *store.Store, now func() time.Time, withFiles bool, extra ...assistanttools.Manifest) (*assistanttools.Registry, error) {
	manifests := []assistanttools.Manifest{
		assistanttools.NewMyDataManifest(st, now),
		assistanttools.NewMyAccountManifest(st.Pool, now),
		assistanttools.NewTaskStatusManifest(st.Pool),
		assistanttools.NewMyAssetsManifest(st),
	}
	if withFiles {
		manifests = append(manifests, assistanttools.NewFileManifest(st.Pool))
	}
	manifests = append(manifests, extra...)
	return assistanttools.NewRegistry(manifests...)
}

// ToolsFor returns every tool in the registry: personal data, account and
// task status are read-only and cheap, so they are always offered; file
// tools join when documents are attached.
func ToolsFor(registry *assistanttools.Registry) []string {
	return toolsIn(registry, DomainMyData, DomainMyAccount, DomainTaskStatus, DomainFiles, DomainCommerce, DomainMyAssets, DomainMemory)
}

// AgentToolsFor returns the platform tools the worker's agent adds to its
// own. Task status and files are left out: the agent has its own versions.
func AgentToolsFor(registry *assistanttools.Registry) []string {
	return toolsIn(registry, DomainMyData, DomainMyAccount, DomainCommerce, DomainMyAssets, DomainMemory, assistanttools.DomainAsk,
		assistanttools.DomainSkillReferences)
}

func toolsIn(registry *assistanttools.Registry, domains ...string) []string {
	names := []string{}
	for _, name := range registry.Names() {
		for _, domain := range domains {
			if registry.Domain(name) == domain {
				names = append(names, name)
				break
			}
		}
	}
	return names
}

// CommercePrompt is added when the turn can make e-commerce image sets.
const CommercePrompt = `

本轮可以直接为用户生成电商商品套图（主图 + 详情页），出图会花用户的积分：
- 先调用 commerce_set_plan 出方案：根据用户的平台、语言、风格和想要的图选择出图类型与张数；用户没说清楚时用默认组合，不要反问。卖点、参数只用用户提供的，不要编造。
- 方案返回后，用一两句话说明这套图包含什么、预计多少积分（数字取自工具结果的 quotedCents）。
- 方案在自动授权预算内时，commerce_set_plan 会直接开始生成（结果里 started 为 true），不要再调用 commerce_set_generate。否则告诉用户“确认后开始出图”，由用户在方案卡片上确认，不要自己调用。用户明确说先只看方案时传 planOnly=true。
- 生成开始后告诉用户可以在卡片上看每张图的进度，出完会自动检查，不合格的可以一键重做；不要承诺具体完成时间。
- 套图出好后，用户要在现有成片上统一改某一处、其余效果保持（“瓶子去掉 logo 再做这 5 张”“把瓶盖都换成金色”）时，用 commerce_set_edit：每张以当前成片为底图只改这一处。用户对某几张不满意、要重新设计时才用 commerce_set_redo。两者规则同上；询问进度时用 commerce_set_status。
- 套图卡片上只有这些按钮：确认生成、单张“重做”、下载、预览详情页、存为满意方案。不要让用户去卡片上找别的按钮；需要整套修改时自己调用工具。
- 只有用户要的是一套电商商品图（主图、卖点图、详情页，或点名淘宝、天猫、亚马逊等平台）时才用 commerce_set_*；单张图、改图、抠图、普通插画和头像用 propose_image_action。

照着竞品做（用户发来竞品的主图或详情页截图，想按它的风格给自己的商品做图）：
- 先调用 competitor_analyze，images 只填竞品截图的序号。竞品截图通常带有别家的品牌、价格、店铺界面或大段营销文字；用户自己的商品图通常是实拍或白底图。分不清哪些是竞品时，用 ask_choices 问一句，不要猜。
- 拆解结果会显示成卡片。用一两句话点出它最关键的打法和你打算做得更好的地方，不要把卡片内容再念一遍。
- 用户已经上传了自己的商品图、并且要做图时，接着调用 commerce_set_plan 并传 competitorRefId（shots 留空就沿用竞品的图片顺序）；没有自己的商品图时，请用户补发，不要拿竞品截图当商品图。
- 竞品里的买家好评、资质认证、质检报告这类图需要用户的真实资料，方案默认不做；竞品有这类图时，告诉用户提供资料后可以加上。
- 只借鉴风格和打法，绝不复制竞品的品牌、Logo、商品外观和原文文案；回答里也要让用户知道这一点。`

// CompetitorLinkPrompt covers a competitor link without screenshots: the
// assistant works from screenshots, so it asks for the right ones.
const CompetitorLinkPrompt = `

用户只发来竞品商品页链接、想照着做时：说明你是通过截图来分析竞品的（电商平台的商品页大多禁止程序直接读取），请用户截图发过来，并说明截哪些最有用：搜索结果里的主图、商品主图轮播的每一张、详情页从上到下的长截图（整页长图也可以，会自动分屏识别）。不要声称已经打开或看过这个链接。`

// MemoryPrompt tells the model what it remembers and how to keep memory.
// With memory off it only says so: nothing is recalled and no memory tool is
// offered.
func MemoryPrompt(enabled bool, block string) string {
	return MemoryRules(enabled) + MemoryBlock(enabled, block)
}

// MemoryRules is the part of MemoryPrompt that is the same on every turn.
func MemoryRules(enabled bool) string {
	if !enabled {
		return "\n\n用户关闭了助手记忆：本轮不能记住、查看或使用任何长期记忆。用户要你记住什么时，告诉他可以在左侧“记忆”里重新开启。"
	}
	return `

记忆：
- 用户明确要你记住某事（“记住…”“以后都…”），或说出明显长期有效的信息（品牌名、品牌色、常用平台、不喜欢的风格）时，调用 memory_save；一次性的要求不要存。存之前不需要再问用户。
- 用户说“改一下 / 不对”时用 memory_update，说“忘掉 / 别再用”时用 memory_forget；改和删都要用记忆的 id。
- 用户问“你记得我什么”时，按类型简要列出；需要商品或满意方案的完整内容时用 memory_search。
- 回答和策划时主动用上记忆（例如按品牌色和常用平台出方案）。用上了哪条，就在回答里点明一次，例如“按你记下的品牌色雾霾蓝……”，让用户知道记忆在起作用。记忆和本轮要求冲突时以本轮为准。
- 用户可以在左侧“记忆”里查看、修改和删除全部记忆。`
}

// MemoryBlock is what is remembered about this user, which changes as
// memories are saved.
func MemoryBlock(enabled bool, block string) string {
	if !enabled {
		return ""
	}
	if block != "" {
		return "\n\n" + block
	}
	return "\n\n目前还没有记住任何关于这位用户的信息。"
}

// ChatOnlyPrompt is added in 问答 mode, which only answers: the agent gets
// no image or site tools there, and this tells it what to say instead.
const ChatOnlyPrompt = `

当前是问答模式：只回答问题、查询用户自己的数据和联网查资料，不能生成或修改图片、不能做电商套图、不能使用放大、导出等站内工具。
- 用户要出图或改图时，用一句话说明：切换到输入框上方的 Agent 模式（能对话也能出图）或图片模式就可以做；需要的话可以先帮他把画面需求理清楚。不要声称已经开始生成。`

// PlatformRules are the assistant's rules for the user's own data, account,
// assets and site links. They are the same for the agent and for the
// statistics evaluation.
const PlatformRules = `平台数据规则：
- 用户问某个任务为什么失败、还在不在跑、有没有退款时，调用 task_status 查看真实状态，不要猜测；不向用户展示内部任务 ID、线路或端点。
- 涉及用户本人的数据（用量、消耗、积分去向、创作次数、成功率、明细、开发者 API 调用次数和失败率）时，必须调用 my_stats_query 或 my_records_list 获取。
- 余额、会员或订阅（到期时间、每日发放）、订单状态，调用 my_account_overview 或 my_orders_list；用户问某一笔为什么扣了这么多、有没有退回，先用 my_records_list 找到记录，再用 explain_charge 解释（只问“最近那笔”时可以直接调用 explain_charge）。
- 回答中的每个数字都只能来自工具结果，或由工具结果直接相减、相除得到；工具没返回的数字不得编造或估算。日期写成工具返回的格式。
- 数据问题不够具体时先给合理的默认答案（例如默认看最近 30 天），再提供一两个细分方向，不要反问。
- 统计结果要做解读：与上一周期对比时说明变化幅度，并指出变化最大的部分和可能的原因。解读只能基于工具返回的分组数据，不要臆测用户的意图。
- 用户想找自己以前的图（“上次那张猫咪海报”“资产库里的 logo”）时调用 assets_search；要复用某张图的提示词时，从结果里的 prompt 取。整理资产库（移分组、加标签、删除）只能用 assets_organize 提出方案，由用户在卡片上确认，不要声称已经改好。用户要把生成的图存进资产库（“把这张存起来”“这套图存到资产库”）时用 assets_save：本对话里刚生成的图用 recentImages，电商套图用 commerceSetId，以前的图先 assets_search 再用 imageIds；同样只出方案，由用户确认。
- 账户与支付操作（充值、购买或退订套餐、退款、修改密码、管理 API Key）你不能代为执行：解释清楚后给出站内页面让用户自己操作——钱包 /wallet，订阅 /subscriptions，订单 /orders，套餐价格 /pricing，个人资料 /profile，API /developer-api。
- 站内链接用 Markdown 链接格式，例如 [打开钱包](/wallet)。`

// TimeNote tells the model the user's local time, which every relative date
// ("今天", "上个月") is resolved against.
func TimeNote(timezone string, now time.Time) string {
	if strings.TrimSpace(timezone) == "" {
		timezone = "Asia/Shanghai"
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		location = time.FixedZone("Asia/Shanghai", 8*3600)
	}
	local := now.In(location)
	return fmt.Sprintf("当前时间：%s（%s，%s）。", local.Format("2006-01-02 15:04"), timezone,
		[...]string{"周日", "周一", "周二", "周三", "周四", "周五", "周六"}[local.Weekday()])
}

// SystemPrompt is the standalone prompt for answering with the platform
// tools alone, as the statistics evaluation does.
func SystemPrompt(timezone string, now time.Time) string {
	return "你是星云 AI 平台的 AI 助手。用中文回答，先给结论，再给依据，最后给可以直接执行的下一步。\n\n" +
		PlatformRules + "\n\n" + TimeNote(timezone, now)
}

// commerceSetPattern matches mentions of e-commerce product images: a set, a
// main image, detail pages, or a named marketplace.
var commerceSetPattern = regexp.MustCompile(`(?i)(套图|主图|详情页|详情图|首图|白底图|卖点图|场景图|电商图|商品图|上架|listing|淘宝|天猫|京东|拼多多|抖音小店|亚马逊|amazon|temu|shopee|lazada|tiktok\s*shop)`)

// CommerceSetRequested reports whether a message talks about e-commerce
// product images. It only decides whether to load a remembered product's
// photos when nothing was uploaded; it never routes the turn.
func CommerceSetRequested(prompt string) bool { return commerceSetPattern.MatchString(prompt) }
