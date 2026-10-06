import "./assistant-workspace-entry.css";
import { useRef, useState } from "react";
import { AssistantFollowUpQueue, AssistantMessageRow, ConversationMinimap } from "../features/assistant/AssistantMessageComponents.jsx";
import { AssistantReplyActionsContext } from "../features/assistant/AssistantDataViews.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import { CommerceSetOwnersContext, commerceSetOwners } from "../features/assistant/AssistantCommerceSet.jsx";
import { imageEditSources } from "../features/assistant/domain/assistantImageCompare.js";
import { setAppearance } from "../theme/appearance.js";
import { ExtensionGallery } from "./AssistantMessageGalleryExtensions.jsx";
import { StatusTransitionDemo } from "./AssistantMessageGalleryStatusDemo.jsx";
import { AssistantAutoApproveDialog } from "../features/assistant/AssistantWorkspaceUi.jsx";

// Dev-only gallery: every kind of content the assistant can show in a
// conversation, rendered by the real message components with sample data.

const imageModels = [
  { model: "image-pro", label: "Image Pro", pricePoints: 20, aspectRatios: ["auto", "1:1", "3:4", "16:9", "9:16"], resolutions: ["1K", "2K"], qualities: ["low", "medium", "high"], maxReferenceImages: 4 },
  { model: "image-basic", label: "Image Basic", pricePoints: 12, aspectRatios: ["auto", "1:1"], resolutions: ["1K"], qualities: ["low"], maxReferenceImages: 4 },
];

const now = Date.now();
const at = (offsetMinutes) => new Date(now - offsetMinutes * 60_000).toISOString();
const img = (name) => `/sucai/${name}`;

function msg(id, role, content, extra = {}) {
  return { id, role, content, kind: "chat", status: "complete", pending: false, createdAt: at(30), updatedAt: at(29), ...extra };
}

const refImage = { id: "ref-1", name: "商品参考图", dataUrl: img("ecom-thumb-listing.webp"), fileKey: "uploads/ref-1.png" };

const SECTIONS = [
  {
    title: "一、对话结构",
    samples: [
      { label: "1 日期分隔线 · 2 上下文分隔线", messages: [
        msg("d-user", "user", "昨天的问题", { createdAt: at(60 * 26) }),
        { id: "divider", role: "system", kind: "context-divider", content: "", createdAt: at(60 * 25) },
      ] },
    ],
  },
  {
    title: "二、用户消息",
    samples: [
      { label: "3 文字 · 4 引用块 · 5 参考图 · 6 文档附件", messages: [
        msg("u-full", "user", "参考这张图和简报，帮我写一段卖点文案", {
          quoted: { kind: "AI 回复", content: "保温杯主打 12 小时长效保温，适合通勤。" },
          referenceImages: [refImage, { id: "ref-2", name: "场景图", dataUrl: img("ecom-thumb-handheld.webp"), fileKey: "uploads/ref-2.png" }],
          attachments: [{ id: "doc-1", name: "产品简报.pdf", contentType: "application/pdf", sizeBytes: 482_000, status: "ready", pageCount: 6 }],
        }),
      ] },
      { label: "7 编辑状态（最后一条用户消息）", editingId: "u-edit", messages: [msg("u-edit", "user", "把文案改得更口语化一点")] },
    ],
  },
  {
    title: "三、状态栏（思考 / 过程 / 流程 / 上下文）",
    samples: [
      { label: "8 进行中：状态与计时 · 9 思考实时显示 · 10 过程 · 11 用时", messages: [
        msg("s-live", "assistant", "正在整理本月消费数据，", {
          kind: "agent", pending: true, status: "running", statusStage: "answering",
          startedAt: now - 8_000, createdAt: new Date(now - 8_000).toISOString(),
          reasoning: "用户想看本月花费。先查统计，再按功能拆分，最后给出建议。",
          toolSteps: [
            { requestId: "t1", name: "my_stats_query", status: "completed", durationMs: 120 },
            { requestId: "t2", name: "web_search", status: "running" },
          ],
          debugTrace: [
            { step: "agent_start", detail: "进入 Agent，正在准备上下文", elapsedMs: 0 },
            { step: "intent_done", detail: "判定 chat（模型判定）", elapsedMs: 380 },
            { step: "model_wait", detail: "第 1 轮，正在等模型决定下一步", elapsedMs: 420 },
            { step: "model_token", detail: "模型开始输出思考", elapsedMs: 1300 },
            { step: "model_tool", detail: "模型要调用 my_stats_query", elapsedMs: 2100 },
            { step: "tool_start", detail: "正在执行 my_stats_query", elapsedMs: 2120 },
            { step: "tool_done", detail: "my_stats_query 完成，用了 140ms", elapsedMs: 2260 },
            { step: "model_wait", detail: "第 2 轮，正在等模型决定下一步", elapsedMs: 2300 },
            { step: "tool_start", detail: "正在执行 web_search", elapsedMs: 3100 },
          ],
        }),
      ] },
      { label: "12 已完成：右侧用量 · 「参考了 N 条消息」已展开", expanded: "s-done", messages: [
        msg("s-done", "assistant", "已为你总结完毕。", {
          kind: "agent", reasoning: "先确认目标，再给出可执行的结论。",
          usage: { inputTokens: 18_400, outputTokens: 640, firstTokenMs: 920, durationMs: 6_400 },
          context: { inputBudgetTokens: 128_000, estimatedInputTokens: 18_400, includedMessages: 12, totalMessages: 30, compactedMessages: 8, omittedMessages: 10 },
          toolSteps: [{ requestId: "t1", name: "my_stats_query", status: "completed", durationMs: 120 }],
          debugTrace: [
            { step: "agent_start", detail: "进入 Agent，正在准备上下文", elapsedMs: 0 },
            { step: "intent_done", detail: "判定 chat（模型判定）", elapsedMs: 400 },
            { step: "model_wait", detail: "第 1 轮，正在等模型决定下一步", elapsedMs: 450 },
            { step: "tool_start", detail: "正在执行 my_stats_query", elapsedMs: 1300 },
            { step: "tool_done", detail: "my_stats_query 完成，用了 120ms", elapsedMs: 1420 },
            { step: "synthesis_wait", detail: "工具阶段结束，正在等最后一次总结", elapsedMs: 1450 },
            { step: "model_token", detail: "模型开始吐字", elapsedMs: 5200 },
          ],
        }),
      ] },
      { label: "失败状态", messages: [msg("s-fail", "assistant", "", { kind: "chat", status: "failed", error: "模型响应超时，请稍后重试。" })] },
    ],
  },
  {
    title: "四、回复正文",
    samples: [
      { label: "13 执行计划 · 14 Markdown 正文（标题 / 列表 / 表格 / 代码 / 引用 / 链接）", messages: [
        msg("md", "assistant", [
          "## 保温杯卖点文案",
          "根据简报，我整理了 **3 个核心卖点**：",
          "1. 12 小时长效保温\n2. 316 不锈钢内胆\n3. 一键开盖，单手可用",
          "> 建议主图突出「一杯暖一天」。",
          "| 卖点 | 主图位置 | 优先级 |\n| --- | --- | --- |\n| 长效保温 | 首图 | 高 |\n| 材质 | 详情第 2 屏 | 中 |",
          "```js\nconst title = \"一杯暖一天\";\n```",
          "需要的话可以 [打开电商工作台](/ecommerce-design) 直接出图。",
        ].join("\n\n"), {
          kind: "agent",
          plan: [
            { title: "读取产品简报", status: "completed" },
            { title: "提炼核心卖点", status: "completed" },
            { title: "生成文案", status: "in_progress" },
            { title: "给出主图建议", status: "pending" },
          ],
        }),
      ] },
      { label: "15 生成方案卡（可编辑参数、提示词，批准 / 忽略）", messages: [
        msg("p-user", "user", "帮我生成品牌主视觉"),
        msg("p-card", "assistant", "已整理方案", { kind: "proposal", proposal: {
          action: "generate", prompt: "一张极简品牌主视觉，雾霾蓝主色，产品居中，柔和侧光", reason: "根据品牌信息生成主视觉。",
          planningSummary: "已整理图片生成方案。", model: "image-pro", ratio: "16:9", resolution: "2K", count: 2, quality: "medium",
          referenceImages: [refImage],
        } }),
      ] },
      { label: "15b 多图独立方案（每张一条提示词）", messages: [
        msg("p-items", "assistant", "我会分别重做这两张", { kind: "proposal", proposal: {
          action: "edit", prompt: "分别将图1和图2改为9:16竖版", model: "image-pro", ratio: "9:16", resolution: "1K", count: 2, quality: "medium",
          referenceImages: [refImage, { id: "ref-2", name: "场景图", dataUrl: img("ecom-thumb-handheld.webp"), fileKey: "uploads/ref-2.png" }],
          referencedImageIds: ["ref-1", "ref-2"], referenceMode: "shared",
          items: [
            { id: "item-1", title: "产品卖点展示·9:16", prompt: "将图1改为9:16竖版产品核心卖点详情图。", ratio: "9:16", resolution: "1K", quality: "medium", referencedImageIds: ["ref-1"], referenceImages: [refImage] },
            { id: "item-2", title: "场景与细节·9:16", prompt: "将图2改为9:16竖版使用场景图。", ratio: "9:16", resolution: "1K", quality: "medium", referencedImageIds: ["ref-2"], referenceImages: [{ id: "ref-2", name: "场景图", dataUrl: img("ecom-thumb-handheld.webp"), fileKey: "uploads/ref-2.png" }] },
          ],
        } }),
      ] },
      { label: "16 出图进度（生成中）· 扩展 2：每张标出第几张和是否完成，右侧显示已完成 2/4", messages: [
        msg("img-live", "assistant", "", {
          kind: "image", pending: true, status: "running", statusStage: "generating-image", startedAt: now - 14_000, createdAt: new Date(now - 14_000).toISOString(),
          prompt: "一张极简品牌主视觉", model: "image-pro", ratio: "1:1", resolution: "2K", quality: "medium", count: 4,
          images: [{ id: "live-1", index: 0, dataUrl: img("ecom-thumb-listing.webp") }, { id: "live-3", index: 2, dataUrl: img("ecom-thumb-shoot.webp") }],
        }),
      ] },
    ],
  },
  {
    title: "五、数据视图（dataViews）",
    samples: [
      { label: "17 统计 stats · 扩展 14：换时间段、对比上一期、导出 CSV（预览页未登录，切换会提示查询失败）", messages: [msg("dv-stats", "assistant", "本月共消耗 240 积分，主要用在 AI 电商。", { kind: "agent", dataViews: [{
        tool: "my_stats_query", view: "stats", data: {
          range: { from: "2026-10-01", to: "2026-10-31", label: "本月" }, previousRange: { from: "2026-09-01", to: "2026-09-30", label: "上一个月" },
          metrics: [{ id: "spend_points", label: "消耗积分", unit: "积分" }], dimensions: [{ id: "workspace", label: "功能" }],
          query: { metrics: ["spend_points"], dimensions: ["workspace"], timeRange: { preset: "this_month" }, compareToPrevious: true },
          rows: [
            { keys: { workspace: "ecommerce_design" }, labels: { workspace: "AI 电商" }, values: { spend_points: 180 } },
            { keys: { workspace: "assistant" }, labels: { workspace: "AI 助手" }, values: { spend_points: 60 } },
          ],
          totals: { spend_points: 240 }, previousTotals: { spend_points: 200 },
        },
      }] })] },
      { label: "18 记录 records", messages: [msg("dv-records", "assistant", "最近的创作记录如下。", { kind: "agent", dataViews: [{
        tool: "my_records", view: "records", data: { type: "creations", records: [
          { id: "r1", time: "2026-10-04 10:20", workspaceLabel: "AI 电商", statusLabel: "成功", status: "succeeded", images: 4, points: 40 },
          { id: "r2", time: "2026-10-03 18:02", workspaceLabel: "文生图", statusLabel: "失败", status: "failed", images: 0, points: 0 },
        ] },
      }] })] },
      { label: "19 账户 account · 20 订单 orders · 21 扣费说明 charge", messages: [msg("dv-acct", "assistant", "你还有 1520 积分，会员 11 天后到期。", { kind: "agent", dataViews: [
        { tool: "my_account_overview", view: "account", data: {
          balance: { availablePoints: 1520, frozenPoints: 40, subscriptionPoints: 300 },
          subscriptions: [{ planName: "月度会员", status: "active", statusLabel: "生效中", daysLeft: 11, endsAt: "2026-10-13 09:00", dailyPoints: 100, nextGrantAt: "2026-10-06 09:00" }],
          orders: { pending: 1, confirming: 0 },
        } },
        { tool: "my_orders_list", view: "orders", data: { orders: [{ orderNo: "o-1", createdAt: "2026-10-01 10:00", planName: "1000 积分", amountYuan: 10, points: 1000, bonusPoints: 100, statusLabel: "已完成，积分或套餐已到账" }] } },
        { tool: "explain_charge", view: "charge", data: {
          found: true,
          source: { type: "task", typeLabel: "创作任务", workspaceLabel: "AI 电商", statusLabel: "成功", model: "高清模型", time: "2026-10-02 09:00", link: "/history" },
          entries: [
            { time: "2026-10-02 09:00", kind: "freeze", label: "预留", points: 40 },
            { time: "2026-10-02 09:01", kind: "spend", label: "结算扣费", points: 30 },
            { time: "2026-10-02 09:01", kind: "release", label: "退回可用余额", points: 10 },
          ],
          totals: { reservedPoints: 40, chargedPoints: 30, returnedPoints: 10, netPoints: 30, pendingPoints: 0 },
          summary: ["提交时预留了 40 积分。", "实际扣费 30 积分，多余的 10 积分已退回。"],
        } },
      ] })] },
      { label: "22 电商套图 commerce_set（待确认 / 已完成）", messages: [msg("dv-set", "assistant", "方案已准备好：2 张图，预计 20 积分，确认后开始出图。", { kind: "agent", dataViews: [
        { tool: "commerce_set_plan", view: "commerce_set", data: {
          id: "gallery-set-planned", productName: "保温杯", platform: "天猫", summary: "清爽白蓝", modelId: "image-pro", quotedCents: 20, total: 2, workbenchLink: "/ecommerce-design",
          status: "planned", approvedCents: 0, done: 0, ready: false, needsReview: false, autoApprovable: false,
          confirmationNote: "这套图预计 20 积分，需要你在方案卡片上确认后再生成。",
          shots: [
            { id: "white", label: "产品白底图", role: "main", aspectRatio: "1:1", attempts: 0, status: "planned", reviewed: false, pass: false, canRedo: false },
            { id: "selling", label: "核心卖点图", headline: "一杯暖一天", role: "detail", aspectRatio: "3:4", attempts: 0, status: "planned", reviewed: false, pass: false, canRedo: false },
          ],
        } },
        { tool: "commerce_set_generate", view: "commerce_set", data: {
          id: "gallery-set-done", productName: "保温杯", platform: "天猫", summary: "清爽白蓝", modelId: "image-pro", quotedCents: 20, total: 2, workbenchLink: "/ecommerce-design",
          status: "done", approvedCents: 20, spentCents: 20, done: 2, ready: true, downloadable: 2, needsReview: false,
          shots: [
            { id: "white", label: "产品白底图", role: "main", aspectRatio: "1:1", attempts: 1, status: "succeeded", imageUrl: img("ecom-thumb-listing.webp"), reviewed: true, pass: true, canRedo: true, priceCents: 10 },
            { id: "selling", label: "核心卖点图", role: "detail", aspectRatio: "3:4", attempts: 1, status: "succeeded", imageUrl: img("ecom-thumb-detail.webp"), reviewed: true, pass: false, issues: ["标题有错别字"], canRedo: true, priceCents: 10 },
          ],
        } },
      ] })] },
      { label: "22b 同一套图在后续消息再次出现：较早的消息只留一行引用，完整卡片在最新消息里", messages: [
        msg("dv-set-first", "assistant", "已开始制作 2 张淘宝详情图，你可以在卡片中查看每张图的进度。", { kind: "agent", dataViews: [{ tool: "commerce_set_generate", view: "commerce_set", data: {
          id: "gallery-set-repeat", productName: "木纹布艺床头台灯", platform: "淘宝", summary: "以木纹与米白布艺为视觉主线", modelId: "image-pro", quotedCents: 2, total: 2, workbenchLink: "/ecommerce-design",
          status: "done", approvedCents: 2, spentCents: 2, done: 2, ready: true, downloadable: 2, needsReview: false,
          shots: [
            { id: "a", label: "首屏视觉图", headline: "一盏暖灯，点亮床头时光", role: "main", aspectRatio: "3:4", attempts: 1, status: "succeeded", imageUrl: img("ecom-thumb-shoot.webp"), reviewed: true, pass: true, canRedo: true, priceCents: 1 },
            { id: "b", label: "细节特写", headline: "看得见的细腻质感", role: "detail", aspectRatio: "3:4", attempts: 1, status: "running", reviewed: false, pass: false, canRedo: false },
          ],
        } }] }),
        msg("dv-set-later", "assistant", "这套图检查完了，有一张自动重做中。", { kind: "agent", dataViews: [{ tool: "commerce_set_review", view: "commerce_set", data: {
          id: "gallery-set-repeat", productName: "木纹布艺床头台灯", platform: "淘宝", summary: "以木纹与米白布艺为视觉主线", modelId: "image-pro", quotedCents: 2, total: 2, workbenchLink: "/ecommerce-design",
          status: "done", approvedCents: 2, spentCents: 2, done: 2, ready: true, downloadable: 2, needsReview: false,
          shots: [
            { id: "a", label: "首屏视觉图", headline: "一盏暖灯，点亮床头时光", role: "main", aspectRatio: "3:4", attempts: 1, status: "succeeded", imageUrl: img("ecom-thumb-shoot.webp"), reviewed: true, pass: true, canRedo: true, priceCents: 1 },
            { id: "b", label: "细节特写", headline: "看得见的细腻质感", role: "detail", aspectRatio: "3:4", attempts: 1, status: "running", reviewed: false, pass: false, canRedo: false },
          ],
        } }] }),
      ] },
      { label: "23 素材 assets · 24 素材操作 asset_action", messages: [msg("dv-assets", "assistant", "找到 2 张，已准备把海报移到「中秋」分组，确认后执行。", { kind: "agent", dataViews: [
        { tool: "assets_search", view: "assets", data: { query: "猫 海报", groups: [], items: [
          { id: "asset:a1", kind: "asset", title: "中秋猫咪海报", imageUrl: img("ecom-thumb-campaign.webp"), group: "节日海报", time: "2026-09-30 10:00", link: "/assets" },
          { id: "task:t1", kind: "generated", title: "一只橘猫坐在月亮上", prompt: "一只橘猫坐在月亮上的海报，暖色调", imageUrl: img("ecom-thumb-backdrop.webp"), workspace: "文生图", time: "2026-09-29 10:00", link: "/history" },
        ] } },
        { tool: "assets_organize", view: "asset_action", data: { action: "move", assetIds: ["asset:a1"], group: "中秋", createGroup: true, titles: ["中秋猫咪海报"], summary: "把 1 个素材移到「中秋」（新建这个分组）" } },
      ] })] },
      { label: "25 记忆变更 memory_change", messages: [msg("dv-mem", "assistant", "记住了：品牌色是雾霾蓝。", { kind: "agent", dataViews: [
        { tool: "memory_save", view: "memory_change", data: { action: "created", memory: { id: "m-brand", kind: "brand", kindLabel: "品牌资料", title: "品牌色", content: "雾霾蓝，做图默认主色", imageKeys: [], imageUrls: [], source: "assistant" } } },
      ] })] },
    ],
  },
  {
    title: "六、附加信息",
    samples: [
      { label: "26 主动消息（任务完成 / 异常提醒 / 定时报告）", messages: [
        msg("pro-done", "assistant", "你的电商套图已经全部生成完成。", { kind: "agent", proactive: "task_done" }),
        msg("pro-alert", "assistant", "提醒一下：你现在可用 30 积分，不到 50。", { kind: "agent", proactive: "alert" }),
        msg("pro-report", "assistant", "本周共生成 42 张图，消耗 380 积分。", { kind: "agent", proactive: "report" }),
      ] },
      { label: "27 联网搜索来源", messages: [msg("web", "assistant", "2026 年双十一主图规范要求首图为白底、1:1、不少于 800×800。", { kind: "agent", webSearches: [{ query: "天猫 主图 规范 2026", sources: [
        { url: "https://www.tmall.com/rules/main-image", title: "天猫主图发布规范" },
        { url: "https://developer.taobao.com/docs/image", title: "淘宝开放平台 · 图片要求" },
        { url: "https://www.example.com/blog/double11", title: "双十一视觉趋势解读" },
      ] }] })] },
    ],
  },
  {
    title: "回复补充（扩展 2 · 3 · 4 · 5 · 10 · 13 · 15 · 17）",
    samples: [
      { label: "扩展 4 · 按原因区分的错误卡（积分不足 / 未通过审核 / 服务繁忙），带可直接操作的按钮", last: "err-balance", messages: [
        msg("err-balance", "assistant", "", { kind: "image", status: "failed", error: "积分不足，本次需要 40 积分，当前可用 30 积分" }),
        msg("err-moderation", "assistant", "", { kind: "image", status: "failed", error: "提示词包含敏感内容，未通过审核" }),
        msg("err-busy", "assistant", "", { kind: "chat", status: "failed", error: "当前助手任务较多，请稍后再试；你的输入不会丢失" }),
      ] },
      { label: "扩展 2 · 出完后有几张没出来：缺的位置显示占位，可一键补生成", last: "img-missing", messages: [
        msg("img-missing", "assistant", "已生成 2/3 张图片，其余图片经自动重试后仍未完成", { kind: "image", count: 3, model: "image-pro", ratio: "1:1",
          images: [{ id: "m-1", index: 0, dataUrl: img("ecom-thumb-listing.webp"), fileKey: "tasks/demo/1.png" }, { id: "m-3", index: 2, dataUrl: img("ecom-thumb-shoot.webp"), fileKey: "tasks/demo/3.png" }] }),
      ] },
      { label: "扩展 13 · 出图前的选择卡（Agent 模式，模型缺关键信息时才问）", last: "choices", messages: [
        msg("choices-user", "user", "帮我做一张保温杯海报"),
        msg("choices", "assistant", "先确认几项，避免做出来不合用。", { kind: "agent", dataViews: [{ tool: "ask_choices", view: "choices", data: {
          title: "出图前确认几项",
          groups: [
            { id: "ratio", label: "尺寸", options: ["1:1", "3:4", "9:16", "16:9"] },
            { id: "style", label: "风格", options: ["简约白底", "生活场景", "高级质感", "节日氛围"], multiple: true },
            { id: "platform", label: "平台", options: ["天猫", "京东", "抖音", "小红书"] },
          ],
          submitLabel: "按这个出图",
        } }] }),
      ] },
      { label: "扩展 15 · 重新生成后可以切回之前的版本（操作栏里的 ‹ 3/3 ›）", messages: [
        msg("versions", "assistant", "第三版：保温杯适合通勤上班族、学生和户外运动人群，其中通勤人群最在意容量和防漏。", { kind: "chat", previousVersions: [
          { id: "v1", content: "第一版：保温杯适合大多数人。", kind: "chat", metadata: {} },
          { id: "v2", content: "第二版：保温杯适合通勤上班族和学生。", kind: "chat", metadata: {} },
        ] }),
      ] },
      { label: "扩展 17 · 点踩后问哪里不满意（只在刚点踩时出现）", askReasons: "dislike", messages: [
        msg("dislike", "assistant", "保温杯一般能保温 6 小时。", { kind: "chat", feedback: "negative" }),
      ] },
      { label: "扩展 10 · 视频结果卡（只做了卡片，助手目前还不能出视频）", messages: [
        msg("video", "assistant", "10 秒产品展示视频已生成。", { kind: "agent", videos: [
          { url: "/sucai/demo-video.mp4", posterUrl: img("canvas-hero.webp"), durationSeconds: 10, title: "保温杯 360° 展示", width: 1920, height: 1080, model: "Video Pro" },
        ] }),
      ] },
    ],
  },
  {
    title: "正文增强与追问（扩展 6–9）",
    samples: [
      { label: "扩展 6 · Mermaid 流程图（可看源码、复制）+ 表格（点表头排序、复制后可直接粘贴到 Excel）", messages: [msg("md-extra", "assistant", [
        "出图流程如下：",
        "",
        "```mermaid",
        "flowchart LR",
        "  A[上传商品图] --> B[AI 抠图]",
        "  B --> C{需要场景?}",
        "  C -- 是 --> D[生成场景图]",
        "  C -- 否 --> E[白底主图]",
        "  D --> F[质量检查]",
        "  E --> F",
        "  F --> G[打包下载]",
        "```",
        "",
        "各平台主图要求：",
        "",
        "| 平台 | 主图比例 | 最小尺寸 | 建议价格带 |",
        "| --- | --- | --- | --- |",
        "| 天猫 | 1:1 | 800×800 | ¥129 |",
        "| 京东 | 1:1 | 800×800 | ¥99 |",
        "| 抖音 | 3:4 | 600×800 | ¥59 |",
        "| 小红书 | 3:4 | 1080×1440 | ¥1,280 |",
      ].join("\n"), { kind: "chat" })] },
      { label: "扩展 7 · 正文引用角标：[n] 对应下面「来源」的第 n 条，悬停看标题，点开原文", messages: [msg("md-cite", "assistant",
        "天猫主图的首图要求白底、1:1[1]，尺寸不少于 800×800，且不能出现水印和外链二维码[2]。今年大促更看重首屏的场景化表达[3][1]。",
        { kind: "agent", webSearches: [{ query: "天猫 主图 规范 2026", sources: [
          { url: "https://www.tmall.com/rules/main-image", title: "天猫主图发布规范" },
          { url: "https://developer.taobao.com/docs/image", title: "淘宝开放平台 · 图片要求" },
          { url: "https://www.example.com/blog/double11", title: "双十一视觉趋势解读" },
        ] }] })] },
      { label: "扩展 8 · 追问建议：只在最后一条回复下显示，点一下直接发送；问答模式只推荐提问（第一条也是输入框里按 Tab 采纳的那条）", last: "md-follow", messages: [
        msg("md-follow-user", "user", "保温杯适合什么人群？"),
        msg("md-follow", "assistant", "保温杯适合通勤上班族、学生和户外运动人群。", { kind: "chat", requestedMode: "chat",
          nextPrompt: "不同人群各自最在意什么卖点？", followUps: ["不同人群各自最在意什么卖点？", "主图文案该怎么写？", "竞品一般怎么定价？"] }),
      ] },
      { label: "扩展 9 · 长回复自动目录：超过 1200 字且有 3 个以上标题时出现，点一节跳过去", messages: [msg("md-toc", "assistant", [
        "## 一、市场概况",
        "保温杯市场近三年保持稳定增长，线上渠道占比持续提升。".repeat(9),
        "### 目标人群",
        "通勤上班族、学生和户外运动人群是三大核心人群，各自关注点不同。".repeat(9),
        "### 价格带分布",
        "主流价格带集中在 59～129 元，高端线以 300 元以上的钛杯为主。".repeat(9),
        "## 二、竞品分析",
        "头部品牌以材质和保温时长为主要卖点，新锐品牌更强调颜值和场景。".repeat(9),
        "## 三、视觉建议",
        "主图建议白底突出产品，详情页用场景图讲清楚使用情境。".repeat(9),
      ].join("\n\n"), { kind: "chat" })] },
    ],
  },
  {
    title: "七、产出与工具卡片",
    samples: [
      { label: "28 生成的文件 artifacts", messages: [msg("art", "assistant", "已生成说明文档和分层文件。", { kind: "agent", artifacts: [
        { id: "a-md", name: "产品说明.md", format: "md", contentType: "text/markdown", sizeBytes: 2048, downloadUrl: "#" },
        { id: "a-psd", name: "主视觉分层.psd", format: "psd", sizeBytes: 5_400_000, layerCount: 12, downloadUrl: "#" },
      ] })] },
      { label: "29 工具结果卡 toolActions（图片搜索 / 下载 / 网页截图 / 导入商品 / 跳转）", messages: [msg("tools", "assistant", "我准备好了以下操作。", { kind: "agent", toolActions: [
        { id: "ta-img", kind: "image_results", title: "图片搜索结果", description: "来自开放授权图库", items: [
          { id: "i1", title: "白色保温杯", imageUrl: img("ecom-thumb-listing.webp"), sourceUrl: "https://example.com/1", license: "CC BY", creator: "Alice" },
          { id: "i2", title: "手持场景", imageUrl: img("ecom-thumb-handheld.webp"), sourceUrl: "https://example.com/2", license: "CC0" },
          { id: "i3", title: "阴影效果", imageUrl: img("ecom-thumb-shadow.webp"), sourceUrl: "https://example.com/3", license: "CC BY-SA", creator: "Bob" },
        ] },
        { id: "ta-dl", kind: "download", title: "打包下载 4 张图", description: "ZIP · 约 12 MB", buttonLabel: "下载" },
        { id: "ta-cap", kind: "webpage_capture", title: "网页截图", description: "example.com 首页", previewUrl: img("canvas-hero.webp"), targetUrl: "https://example.com", buttonLabel: "查看" },
        { id: "ta-imp", kind: "product_import", title: "导入商品", description: "从链接导入标题与主图", buttonLabel: "导入" },
        { id: "ta-nav", kind: "navigate", title: "打开电商工作台", description: "带上当前商品继续出图", buttonLabel: "前往" },
      ] })] },
      { label: "30 生成图片网格（含编辑方案按钮）", sourceProposalFor: "img-done", messages: [msg("img-done", "assistant", "", {
        kind: "image", prompt: "一张极简品牌主视觉", model: "image-pro", ratio: "1:1", resolution: "2K", quality: "medium", width: 2048, height: 2048,
        usage: { durationMs: 21_000 },
        images: [
          { id: "g1", fileKey: "tasks/g1.png", dataUrl: img("ecom-thumb-listing.webp"), width: 2048, height: 2048 },
          { id: "g2", fileKey: "tasks/g2.png", dataUrl: img("ecom-thumb-enhance.webp"), width: 2048, height: 2048 },
          { id: "g3", fileKey: "tasks/g3.png", dataUrl: img("ecom-thumb-shoot.webp"), width: 2048, height: 2048 },
          { id: "g4", fileKey: "tasks/g4.png", dataUrl: img("ecom-thumb-tryon.webp"), width: 2048, height: 2048 },
        ],
      })] },
      { label: "30b 改图结果：在 /assistant 里点开大图，顶栏有「对比原图」（预览页不打开查看器）", messages: [
        msg("edit-user", "user", "把背景换成大理石台面，其他不变", { referenceImages: [{ id: "edit-ref", name: "原图", dataUrl: img("ecom-thumb-listing.webp"), fileKey: "uploads/edit-ref.png" }] }),
        msg("edit-done", "assistant", "", {
          kind: "image", prompt: "把背景换成大理石台面，其他不变", model: "image-pro", ratio: "1:1", resolution: "2K", quality: "medium", width: 2048, height: 2048,
          usage: { durationMs: 18_000 },
          images: [{ id: "edit-out", fileKey: "tasks/edit-out.png", dataUrl: img("ecom-thumb-backdrop.webp"), width: 2048, height: 2048 }],
        }),
      ] },
    ],
  },
  {
    title: "八、回复底部",
    samples: [
      { label: "31 AI 生成提示与耗时 · 32 操作栏（更多菜单已展开） · 33 纠正快捷项", moreOpen: "foot", messages: [
        msg("foot-user", "user", "保温杯适合什么人群？"),
        msg("foot", "assistant", "适合通勤上班族、学生和户外运动人群。", { kind: "chat", usage: { inputTokens: 1200, outputTokens: 80, durationMs: 3_200 } }),
      ] },
    ],
  },
];

const allMessages = SECTIONS.flatMap((section) => section.samples.flatMap((sample) => sample.messages));
const lastUserId = [...allMessages].reverse().find((item) => item.role === "user")?.id;
const lastAssistantId = "foot";
// 选择卡在预览页里点“按这个出图”只显示已发送，不真的发消息。
const GALLERY_REPLY_ACTIONS = { lastAssistantId: "choices", busy: false, send: () => undefined };

const minimapItems = allMessages.filter((item) => item.role === "user").map((item) => ({ id: item.id, preview: item.content, time: "10:20" }));
const followUps = [{ id: "q1", prompt: "再帮我出一版 3:4 的" }, { id: "q2", prompt: "顺便统计一下本周花费", pending: true }];

export function AssistantMessageGalleryView() {
  const isDark = useIsDark();
  const [expanded, setExpanded] = useState(() => new Set(SECTIONS.flatMap((s) => s.samples).map((s) => s.expanded).filter(Boolean)));
  const [moreOpen, setMoreOpen] = useState("foot");
  const [copied, setCopied] = useState("");
  const [loadedImages, setLoadedImages] = useState(() => new Set());
  const [autoApproveOpen, setAutoApproveOpen] = useState(false);
  const markImageLoaded = (messageId, index) => setLoadedImages((current) => new Set(current).add(`${messageId}-${index}`));
  const [editingDraft, setEditingDraft] = useState("把文案改得更口语化一点");
  const minimapSetter = useRef(() => {});
  const noop = () => {};

  const toggleStatus = (id) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const commerceOwners = commerceSetOwners(allMessages);
  const scrollTo = (id) => document.querySelector(`[data-message-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
    <div className={`assistant-workspace assistant-gallery${isDark ? " is-dark" : ""}`} style={{ "--assistant-sidebar-occupied": "0px", display: "block", height: "100vh", overflowY: "auto" }} onClick={() => setMoreOpen("")}>
      <CommerceSetOwnersContext.Provider value={commerceOwners}>
      <AssistantReplyActionsContext.Provider value={GALLERY_REPLY_ACTIONS}>
      <main className="assistant-main" style={{ height: "auto", overflow: "visible" }}>
        <div className="assistant-messages" style={{ height: "auto", overflow: "visible" }}>
          <section className="message-thread">
            <div className="assistant-gallery-theme" role="group" aria-label="主题">
              <button type="button" className={isDark ? "" : "is-active"} onClick={() => setAppearance("light")}><i className="bi bi-sun" /> 浅色</button>
              <button type="button" className={isDark ? "is-active" : ""} onClick={() => setAppearance("dark")}><i className="bi bi-moon-stars" /> 深色</button>
            </div>
            <header className="assistant-gallery-intro">
              <h1>AI 助手 · 对话内容类型一览</h1>
              <p>以下全部由真实的消息组件渲染，数据为示例。编号与清单一致。</p>
            </header>
            <div className="message-turns">
              {SECTIONS.map((section) => (
                <div key={section.title} className="assistant-gallery-section">
                  <h2 className="assistant-gallery-section-title">{section.title}</h2>
                  {section.title.startsWith("三") ? (
                    <div className="assistant-gallery-sample">
                      <p className="assistant-gallery-label">动态演示：理解问题 → 思考 → 调用工具 → 联网搜索 → 写回答 → 完成</p>
                      <StatusTransitionDemo />
                    </div>
                  ) : null}
                  {section.samples.map((sample) => (
                    <div key={sample.label} className="assistant-gallery-sample">
                      <p className="assistant-gallery-label">{sample.label}</p>
                      {sample.messages.map((message, index) => (
                        <AssistantMessageRow
                          key={message.id}
                          message={message}
                          editSources={message.images?.length ? imageEditSources(message, allMessages) : undefined}
                          turnId={message.id}
                          showDate={index === 0 && message.id === "d-user"}
                          expanded={expanded.has(message.id)}
                          copied={copied === message.id}
                          generating={false}
                          feedbackBusy={false}
                          isLastAssistant={message.id === lastAssistantId || message.id === "p-card" || message.id === sample.last}
                          isLastUser={message.id === lastUserId || message.id === sample.editingId}
                          editing={message.id === sample.editingId}
                          editingDraft={editingDraft}
                          moreOpen={moreOpen === message.id}
                          loadedImages={loadedImages}
                          failedImages={new Set()}
                          imageRetryVersions={{}}
                          imageModels={imageModels}
                          sourceProposal={sample.sourceProposalFor === message.id ? { id: "p-card" } : null}
                          proposalExecuted={false}
                          attachedReferences={[]}
                          maxMessageCharacters={8000}
                          onToolAction={noop}
                          onToggleStatus={toggleStatus}
                          onCopy={(item) => setCopied(item.id)}
                          onFeedback={noop}
                          onQuote={noop}
                          onOpenImage={noop}
                          onImageLoad={markImageLoaded}
                          onImageError={noop}
                          onImageRetry={noop}
                          onUseReference={noop}
                          onStartEdit={noop}
                          onEditDraft={setEditingDraft}
                          onCancelEdit={noop}
                          onSubmitEdit={noop}
                          onRetry={noop}
                          onToggleMore={(id) => setMoreOpen((current) => (current === id ? "" : id))}
                          onDownloadMarkdown={noop}
                          onDelete={noop}
                          onProposalChange={noop}
                          onProposalDismiss={noop}
                          onProposalRestore={noop}
                          onProposalApprove={noop}
                          onReopenProposal={noop}
                          onCorrection={noop}
                          onFollowUp={noop}
                          onEditPrompt={noop}
                          onGenerateMissing={noop}
                          askFeedbackReasons={message.id === sample.askReasons}
                          onFeedbackReasons={async () => true}
                          onDismissFeedbackReasons={noop}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              ))}
              <div className="assistant-gallery-section">
                <h2 className="assistant-gallery-section-title">九、对话区之外但相关</h2>
                <div className="assistant-gallery-sample">
                  <p className="assistant-gallery-label">追问队列（输入框上方）</p>
                  <AssistantFollowUpQueue items={followUps} editingId="" busyId="" onEdit={noop} onRemove={noop} />
                  <p className="assistant-gallery-label">对话小地图（左侧竖条，窄屏在右侧，悬停可预览）</p>
                  <p className="assistant-gallery-label">Agent 自动出图授权弹窗</p>
                  <button type="button" className="assistant-gallery-demo-play" style={{ marginLeft: 0 }} onClick={(event) => { event.stopPropagation(); setAutoApproveOpen(true); }}><i className="bi bi-lightning-charge" />打开弹窗</button>
                </div>
              </div>
              <ExtensionGallery />
            </div>
          </section>
        </div>
      </main>
      </AssistantReplyActionsContext.Provider>
      </CommerceSetOwnersContext.Provider>
      <AssistantAutoApproveDialog open={autoApproveOpen} light={!isDark} budgetCents={60} onCancel={() => setAutoApproveOpen(false)} onConfirm={() => setAutoApproveOpen(false)} />
      <ConversationMinimap items={minimapItems} activeSetterRef={minimapSetter} onScrollToMessage={scrollTo} />
      <style>{`
        .assistant-gallery-intro { padding: 32px 0 8px; }
        .assistant-gallery-intro h1 { font-size: 22px; margin: 0 0 6px; color: var(--assistant-text); }
        .assistant-gallery-intro p { margin: 0; color: var(--assistant-muted); font-size: 13px; }
        .assistant-gallery-section { margin-top: 36px; }
        .assistant-gallery-section-title { font-size: 16px; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--assistant-border); color: var(--assistant-text); }
        .assistant-gallery-sample { margin: 0 0 28px; }
        .assistant-gallery-label { display: inline-block; margin: 0 0 10px; padding: 3px 10px; border-radius: 999px; font-size: 12px; color: var(--assistant-text-soft); background: var(--assistant-panel-active); }
        .assistant-gallery-theme { position: fixed; top: 16px; right: 24px; z-index: 20; display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: var(--assistant-panel); border: 1px solid var(--assistant-border); box-shadow: 0 6px 20px rgba(0,0,0,.08); }
        .assistant-gallery-theme button { border: 0; background: transparent; color: var(--assistant-text-soft); padding: 6px 12px; border-radius: 999px; font-size: 13px; cursor: pointer; }
        .assistant-gallery-theme button.is-active { background: var(--assistant-panel-active); color: var(--assistant-text); font-weight: 600; }
        .assistant-gallery .conversation-minimap { position: fixed; }
        .assistant-gallery-demo { position: relative; min-height: 120px; padding: 10px 16px 4px; border: 1px dashed var(--assistant-border-strong); border-radius: 14px; }
        .assistant-gallery-demo-play { display: flex; margin: 0 0 10px auto; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border: 1px solid var(--assistant-border); border-radius: 999px; color: var(--assistant-text-soft); background: var(--assistant-card); font-size: 12px; cursor: pointer; }
        .assistant-gallery-demo-play:hover { color: var(--assistant-text); border-color: var(--assistant-border-strong); }
        .assistant-gallery-demo .message { margin-bottom: 8px; }
        .assistant-gallery-section.is-extension { margin-top: 56px; padding-top: 8px; border-top: 2px dashed var(--assistant-border-strong); }
        .assistant-gallery-note { margin: -4px 0 18px; color: var(--assistant-muted); font-size: 12px; }
        .assistant-gallery-priority { margin-left: 8px; padding: 0 6px; border-radius: 4px; color: var(--assistant-card); background: var(--assistant-accent); font-size: 11px; font-weight: 700; }
        .assistant-gallery .assistant-followup-queue { position: static; margin-bottom: 16px; }
      `}</style>
    </div>
  );
}
