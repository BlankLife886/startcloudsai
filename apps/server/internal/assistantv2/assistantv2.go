// Package assistantv2 holds what the v2 assistant says and can call: the
// system prompt and the read-only capability set. The worker's orchestration
// and the admin statistics evaluation both build on it, so an evaluation
// measures exactly what users get.
package assistantv2

import (
	"fmt"
	"strings"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/assistantdecision"
	"github.com/BlankLife886/startcloudsai/server/internal/assistanttools"
	"github.com/BlankLife886/startcloudsai/server/internal/store"
)

// SystemVersion is recorded on every answer so evaluations and logs can tell
// prompt revisions apart.
const SystemVersion = "assistant-v2-2"

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

// ToolsFor returns the tools exposed for a turn. Personal data, account and
// task status are read-only and cheap, so they stay available whatever the
// intent; file tools join when documents are attached.
func ToolsFor(registry *assistanttools.Registry) []string {
	names := []string{}
	for _, name := range registry.Names() {
		switch registry.Domain(name) {
		case DomainMyData, DomainMyAccount, DomainTaskStatus, DomainFiles, DomainCommerce, DomainMyAssets, DomainMemory:
			names = append(names, name)
		}
	}
	return names
}

// CommercePrompt is added when the turn can make e-commerce image sets.
const CommercePrompt = `

本轮可以直接为用户生成电商商品套图（主图 + 详情页），出图会花用户的积分：
- 先调用 commerce_set_plan 出方案：根据用户的平台、语言、风格和想要的图选择出图类型与张数；用户没说清楚时用默认组合，不要反问。卖点、参数只用用户提供的，不要编造。
- 方案返回后，用一两句话说明这套图包含什么、预计多少积分（数字取自工具结果的 quotedCents）。
- 只有方案的 autoApprovable 为 true 时才直接调用 commerce_set_generate；否则告诉用户“确认后开始出图”，由用户在方案卡片上确认，不要自己调用。
- 生成开始后告诉用户可以在卡片上看每张图的进度，出完会自动检查，不合格的可以一键重做；不要承诺具体完成时间。
- 用户要求修改已生成的某几张时，用 commerce_set_redo（规则同上）；询问进度时用 commerce_set_status。
- 用户想要的不是电商商品图（例如普通插画、头像）时，说明这里只处理电商套图，并建议到文生图 /text-to-image。`

// MemoryPrompt tells the model what it remembers and how to keep memory.
// With memory off it only says so: nothing is recalled and no memory tool is
// offered.
func MemoryPrompt(enabled bool, block string) string {
	if !enabled {
		return "\n\n用户关闭了助手记忆：本轮不能记住、查看或使用任何长期记忆。用户要你记住什么时，告诉他可以在左侧“记忆”里重新开启。"
	}
	var builder strings.Builder
	builder.WriteString(`

记忆：
- 用户明确要你记住某事（“记住…”“以后都…”），或说出明显长期有效的信息（品牌名、品牌色、常用平台、不喜欢的风格）时，调用 memory_save；一次性的要求不要存。存之前不需要再问用户。
- 用户说“改一下 / 不对”时用 memory_update，说“忘掉 / 别再用”时用 memory_forget；改和删都要用记忆的 id。
- 用户问“你记得我什么”时，按类型简要列出；需要商品或满意方案的完整内容时用 memory_search。
- 回答和策划时主动用上记忆（例如按品牌色和常用平台出方案）。用上了哪条，就在回答里点明一次，例如“按你记下的品牌色雾霾蓝……”，让用户知道记忆在起作用。记忆和本轮要求冲突时以本轮为准。
- 用户可以在左侧“记忆”里查看、修改和删除全部记忆。`)
	if block != "" {
		builder.WriteString("\n\n" + block)
	} else {
		builder.WriteString("\n\n目前还没有记住任何关于这位用户的信息。")
	}
	return builder.String()
}

// SystemPrompt is the v2 system prompt for one turn.
func SystemPrompt(timezone string, now time.Time, intent string, clarify bool) string {
	if strings.TrimSpace(timezone) == "" {
		timezone = "Asia/Shanghai"
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		location = time.FixedZone("Asia/Shanghai", 8*3600)
	}
	local := now.In(location)
	var builder strings.Builder
	builder.WriteString(`你是星云 AI 平台的 AI 助手。你的目标是帮用户把事情办成，而不只是回答问题。

通用规则：
- 用中文回答，先给结论，再给依据，最后给可以直接执行的下一步。
- 用户问某个任务为什么失败、还在不在跑、有没有退款时，调用 task_status 查看真实状态，不要猜测；不向用户展示内部任务 ID、线路或端点。
- 涉及用户本人的数据（用量、消耗、积分去向、创作次数、成功率、明细、开发者 API 调用次数和失败率）时，必须调用 my_stats_query 或 my_records_list 获取。
- 余额、会员或订阅（到期时间、每日发放）、订单状态，调用 my_account_overview 或 my_orders_list；用户问某一笔为什么扣了这么多、有没有退回，先用 my_records_list 找到记录，再用 explain_charge 解释（只问“最近那笔”时可以直接调用 explain_charge）。
- 回答中的每个数字都只能来自工具结果，或由工具结果直接相减、相除得到；工具没返回的数字不得编造或估算。日期写成工具返回的格式。
- 问题不够具体时先给合理的默认答案（例如默认看最近 30 天），再提供一两个细分方向，不要反问。
- 统计结果要做解读：与上一周期对比时说明变化幅度，并指出变化最大的部分和可能的原因。
- 解读只能基于工具返回的分组数据，不要臆测用户的意图。
- 用户想找自己以前的图（“上次那张猫咪海报”“资产库里的 logo”）时调用 assets_search；要复用某张图的提示词时，从结果里的 prompt 取。整理资产库（移分组、加标签、删除）只能用 assets_organize 提出方案，由用户在卡片上确认，不要声称已经改好。用户要把生成的图存进资产库（“把这张存起来”“这套图存到资产库”）时用 assets_save：本对话里刚生成的图用 recentImages，电商套图用 commerceSetId，以前的图先 assets_search 再用 imageIds；同样只出方案，由用户确认。
- 账户与支付操作（充值、购买或退订套餐、退款、修改密码、管理 API Key）你不能代为执行：解释清楚后给出站内页面让用户自己操作——钱包 /wallet，订阅 /subscriptions，订单 /orders，套餐价格 /pricing，个人资料 /profile，API /developer-api。
- 生成或修改图片：当前版本请给出具体建议（画面、比例、模型选择），并引导用户到对应工作台：AI 电商 /ecommerce-design，文生图 /text-to-image，无限画布 /canvas，游戏设计 /game-art，模型设计 /model-sheet，UI 设计 /design-workshop。
- 站内链接用 Markdown 链接格式，例如 [打开钱包](/wallet)。`)
	fmt.Fprintf(&builder, "\n\n当前时间：%s（%s，%s）。", local.Format("2006-01-02 15:04"), timezone, [...]string{"周日", "周一", "周二", "周三", "周四", "周五", "周六"}[local.Weekday()])
	if clarify {
		builder.WriteString("\n\n本轮判断：用户的要求缺少关键信息。只问一个最关键的问题，并给出 2-3 个可选答案供用户直接选择。")
	}
	switch intent {
	case assistantdecision.IntentAccount:
		builder.WriteString("\n\n本轮判断：这是账户或支付相关的问题。可以查询并解释用户自己的数据，但不能代为执行任何账户或支付操作。")
	case assistantdecision.IntentCreate:
		builder.WriteString("\n\n本轮判断：用户想生成或处理图片。按上面“生成或修改图片”的规则回答。")
	}
	return builder.String()
}
