const WEB_TERMS = ["联网", "搜索", "查证", "最新", "今天", "新闻", "价格", "政策", "版本"]
const IMAGE_TERMS = ["图片", "生图", "海报", "主图", "插画", "构图", "参考图", "修图"]
const FILE_TERMS = ["ppt", "pptx", "psd", "文档", "文件", "表格", "导出", "报告"]

function containsAny(value, terms) {
  const text = String(value || "").toLowerCase()
  return terms.some((term) => text.includes(term))
}

function taskFocus(prompt) {
  const compact = String(prompt || "").replace(/\s+/g, " ").trim()
  return compact.length > 32 ? `${compact.slice(0, 32)}…` : compact || "当前任务"
}

function dynamicGuidance(kind, run, messages) {
  const focus = taskFocus(run.prompt)
  const hasReference = Number(run.referenceCount || 0) > 0 || messages.some((message) => message.referenceImages?.length)
  const asksComparison = /对比|比较|区别|差异|优缺点|versus|\bvs\b/i.test(run.prompt || "")
  const asksSteps = /如何|怎么|步骤|流程|方案|实现|how|steps/i.test(run.prompt || "")
  if (kind === "web") return [
    { id: "verify-sources", icon: "bi-shield-check", label: "核对关键来源", prompt: `完成后逐项核对“${focus}”中的关键结论、发布日期和原始来源。` },
    { id: "summarize-evidence", icon: "bi-table", label: asksComparison ? "整理对比证据" : "整理证据表", prompt: `完成后把“${focus}”的结论、证据、日期和来源整理成表格。` },
    { id: "find-gaps", icon: "bi-search", label: "查找遗漏信息", prompt: `完成后继续检查“${focus}”还有哪些重要信息没有覆盖。` },
  ]
  if (kind === "image") return [
    { id: "image-variant", icon: "bi-images", label: hasReference ? "基于参考图再做" : "换构图再做一版", prompt: `完成后围绕“${focus}”再生成一版，保留已确认要求并明确说明构图变化。` },
    { id: "image-refine", icon: "bi-sliders", label: hasReference ? "精修当前图片" : "检查画面细节", prompt: `完成后检查“${focus}”的主体、比例、背景和细节，整理下一版修改方案。` },
    { id: "image-prompt", icon: "bi-card-text", label: "保存本次提示词", prompt: `完成后把“${focus}”整理成包含比例和关键视觉约束的可复用提示词。` },
  ]
  if (kind === "file") return [
    { id: "file-summary", icon: "bi-list-check", label: "提炼文件结论", prompt: `完成后从“${focus}”中提炼结论、依据和待办事项。` },
    { id: "file-table", icon: "bi-table", label: asksComparison ? "生成对比表" : "整理结构化表格", prompt: `完成后把“${focus}”的关键信息整理成结构清晰的表格。` },
    { id: "file-export", icon: "bi-file-earmark-arrow-down", label: "导出整理结果", prompt: `完成后把“${focus}”的最终内容生成可下载文件。` },
  ]
  return [
    { id: "chat-detail", icon: "bi-zoom-in", label: asksSteps ? "细化执行步骤" : "深入关键结论", prompt: `完成后继续展开“${focus}”中最关键但尚未说明清楚的部分。` },
    { id: "chat-example", icon: "bi-lightbulb", label: asksComparison ? "补充对比例子" : "给出具体例子", prompt: `完成后针对“${focus}”补充可以直接验证或使用的具体例子。` },
    { id: "chat-actions", icon: "bi-list-check", label: asksSteps ? "整理落地清单" : "生成行动清单", prompt: `完成后把“${focus}”整理成简短、可执行且可检查的行动清单。` },
  ]
}

export function assistantRunGuidance(run = {}, messages = []) {
  const prompt = String(run.prompt || "")
  const stage = String(run.stage || "").toLowerCase()
  const mode = String(run.resolvedMode || run.mode || "").toLowerCase()
  let kind = "chat"
  if (stage === "web_search" || containsAny(prompt, WEB_TERMS)) kind = "web"
  else if (mode === "image" || stage.includes("image") || containsAny(prompt, IMAGE_TERMS)) kind = "image"
  else if (stage.includes("ppt") || stage.includes("psd") || containsAny(prompt, FILE_TERMS)) kind = "file"
  return dynamicGuidance(kind, run, Array.isArray(messages) ? messages : [])
}
