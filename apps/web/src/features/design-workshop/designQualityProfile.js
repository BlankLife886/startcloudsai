import {
  createAssistantConversation,
  createAssistantRun,
  deleteAssistantConversation,
  waitForAssistantRun,
} from '@/services/assistantApi'
import { uploadAiTempBlob } from '@/features/ai-shared/aiImageIO'

// Product-specific adaptation of public design guidance from Taste Skill (MIT)
// and Impeccable (Apache-2.0). No upstream runtime or prompt text is bundled.
const SOURCE_LINKS = [
  'https://github.com/leonxlnx/taste-skill',
  'https://github.com/pbakaus/impeccable',
]

export const DESIGN_QUALITY_REVIEW_MODES = [
  {
    id: 'balanced',
    label: '综合评审',
    icon: 'bi-sliders2',
    prompt: '综合平衡信息层级、视觉质量、组件一致性与业务完整度。',
  },
  {
    id: 'standards',
    label: '规范审计',
    icon: 'bi-rulers',
    prompt: '优先检查栅格、间距、字号、对比度、组件状态、可访问性和响应式可实施性。',
  },
  {
    id: 'product',
    label: '业务打磨',
    icon: 'bi-diagram-3',
    prompt: '优先检查用户任务、信息架构、操作闭环、状态反馈、异常路径和真实产品完整度。',
  },
]

function uid(prefix) {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  )
}

function referenceDescriptor(source, name = '待检查 UI 设计稿') {
  const value = String(source || '').trim()
  if (!value) return null
  const url = new URL(value, window.location.origin)
  const marker = '/api/v1/files/'
  const markerIndex = url.pathname.indexOf(marker)
  const fileKey =
    markerIndex >= 0 ? decodeURIComponent(url.pathname.slice(markerIndex + marker.length)) : ''
  return {
    id: uid('quality-reference'),
    name,
    dataUrl: url.href,
    ...(fileKey ? { fileKey } : {}),
  }
}

const GROUNDING_COLUMNS = 16
const GROUNDING_ROWS = 10

function gridCellRegion(cell, inset = { x: 0, y: 0, width: 1, height: 1 }) {
  const match = String(cell || '')
    .trim()
    .toUpperCase()
    .match(/^([A-P])(10|[1-9])$/)
  if (!match) return null
  const column = match[1].charCodeAt(0) - 65
  const row = Number(match[2]) - 1
  const local = normalizeAuditRegion(inset)
  if (!local) return null
  return {
    x: (column + local.x) / GROUNDING_COLUMNS,
    y: (row + local.y) / GROUNDING_ROWS,
    width: local.width / GROUNDING_COLUMNS,
    height: local.height / GROUNDING_ROWS,
  }
}

function gridCellsRegion(cells) {
  const regions = (Array.isArray(cells) ? cells : [])
    .map((cell) => gridCellRegion(cell))
    .filter(Boolean)
  if (!regions.length) return null
  const x = Math.min(...regions.map((region) => region.x))
  const y = Math.min(...regions.map((region) => region.y))
  const right = Math.max(...regions.map((region) => region.x + region.width))
  const bottom = Math.max(...regions.map((region) => region.y + region.height))
  return { x, y, width: right - x, height: bottom - y }
}

function localizedIssueRegion(item, issue) {
  if (item?.scope !== 'local' || Number(item?.confidence) < 0.82) return null
  if (issue?.dimension === 'product') return null
  const cells = Array.isArray(item?.cells) ? [...new Set(item.cells.map(String))] : []
  if (!cells.length || cells.length > 16) return null
  const region = gridCellsRegion(cells)
  if (!region) return null
  if (region.width > 0.5 || region.height > 0.5 || region.width * region.height > 0.18) {
    return null
  }
  return region
}

function localizedAssetRegion(item) {
  if (Number(item?.confidence) < 0.82) return null
  const region = gridCellRegion(item?.cell, item?.regionInCell)
  if (!region) return null
  if (region.width > 0.25 || region.height > 0.35 || region.width * region.height > 0.06) {
    return null
  }
  return region
}

async function createGroundingReference(source, signal) {
  const response = await fetch(new URL(source, window.location.origin), {
    credentials: 'include',
    signal,
  })
  if (!response.ok) throw new Error('定位参考图读取失败')
  const bitmap = await createImageBitmap(await response.blob())
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建定位网格')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  const cellWidth = canvas.width / GROUNDING_COLUMNS
  const cellHeight = canvas.height / GROUNDING_ROWS
  context.strokeStyle = 'rgba(255, 67, 67, 0.72)'
  context.lineWidth = Math.max(1, Math.round(canvas.width / 1000))
  context.font = `700 ${Math.max(11, Math.round(canvas.width / 95))}px monospace`
  context.textBaseline = 'top'
  for (let row = 0; row < GROUNDING_ROWS; row += 1) {
    for (let column = 0; column < GROUNDING_COLUMNS; column += 1) {
      const x = column * cellWidth
      const y = row * cellHeight
      context.strokeRect(x, y, cellWidth, cellHeight)
      const label = `${String.fromCharCode(65 + column)}${row + 1}`
      const metrics = context.measureText(label)
      context.fillStyle = 'rgba(12, 12, 18, 0.82)'
      context.fillRect(x + 2, y + 2, metrics.width + 8, Math.max(15, canvas.width / 70))
      context.fillStyle = '#ffffff'
      context.fillText(label, x + 6, y + 4)
    }
  }
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('定位网格生成失败'))),
      'image/png',
    )
  })
  return uploadAiTempBlob(blob, { signal })
}

function normalizeAuditRegion(value) {
  if (!value || typeof value !== 'object') return null
  const coordinate = (input) => {
    const parsed = Number(input)
    if (!Number.isFinite(parsed)) return 0
    return parsed > 1 ? parsed / 1000 : parsed
  }
  const x = Math.max(0, Math.min(0.995, coordinate(value.x)))
  const y = Math.max(0, Math.min(0.995, coordinate(value.y)))
  const width = Math.max(0.005, Math.min(1 - x, coordinate(value.width)))
  const height = Math.max(0.005, Math.min(1 - y, coordinate(value.height)))
  return { x, y, width, height }
}

function parseAuditResult(content) {
  const value = String(content || '').trim()
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')
  const candidate = fenced || (start >= 0 && end > start ? value.slice(start, end + 1) : '')
  let parsed
  try {
    parsed = JSON.parse(candidate)
  } catch {
    throw new Error('品质检查结果无法解析，请重新检查')
  }
  const issues = Array.isArray(parsed?.issues)
    ? parsed.issues.slice(0, 8).map((item, index) => ({
        id: `issue-${index + 1}`,
        severity: ['critical', 'major', 'minor'].includes(item?.severity) ? item.severity : 'minor',
        dimension: ['hierarchy', 'layout', 'typography', 'color', 'components', 'product'].includes(
          item?.dimension,
        )
          ? item.dimension
          : 'product',
        title: String(item?.title || '设计问题'),
        evidence: String(item?.evidence || ''),
        fix: String(item?.fix || ''),
        region: normalizeAuditRegion(item?.region),
      }))
    : []
  const developerAssets = Array.isArray(parsed?.developerAssets)
    ? parsed.developerAssets
        .slice(0, 12)
        .map((item, index) => ({
          id: `asset-${index + 1}`,
          name: String(item?.name || `开发素材 ${index + 1}`),
          type: ['logo', 'icon', 'avatar', 'illustration', 'photo', 'chart', 'decoration'].includes(
            item?.type,
          )
            ? item.type
            : 'icon',
          region: normalizeAuditRegion(item?.region),
          reason: String(item?.reason || '该视觉元素需要作为独立素材交付开发'),
          suggestedFormat: ['png', 'webp'].includes(item?.suggestedFormat)
            ? item.suggestedFormat
            : 'png',
        }))
        .filter((item) => item.region)
    : []
  const dimensions = Array.isArray(parsed?.dimensions)
    ? parsed.dimensions.slice(0, 6).map((item) => ({
        id: ['hierarchy', 'layout', 'typography', 'color', 'components', 'product'].includes(
          item?.id,
        )
          ? item.id
          : 'product',
        label: String(item?.label || '产品完整度'),
        score: Math.max(0, Math.min(100, Number(item?.score) || 0)),
        note: String(item?.note || ''),
      }))
    : []
  const reportedScore = Math.max(0, Math.min(100, Number(parsed?.score) || 0))
  const score =
    dimensions.length >= 4
      ? Math.round(dimensions.reduce((total, item) => total + item.score, 0) / dimensions.length)
      : reportedScore
  const comparison =
    parsed?.comparison && typeof parsed.comparison === 'object'
      ? {
          summary: String(parsed.comparison.summary || ''),
          resolvedIssueIds: Array.isArray(parsed.comparison.resolvedIssueIds)
            ? parsed.comparison.resolvedIssueIds.map(String).slice(0, 8)
            : [],
          persistentIssueIds: Array.isArray(parsed.comparison.persistentIssueIds)
            ? parsed.comparison.persistentIssueIds.map(String).slice(0, 8)
            : [],
          newIssueCount: Math.max(0, Math.min(8, Number(parsed.comparison.newIssueCount) || 0)),
        }
      : null
  return {
    score,
    reportedScore,
    verdict: String(parsed?.verdict || '检查完成'),
    strengths: Array.isArray(parsed?.strengths)
      ? parsed.strengths
          .slice(0, 4)
          .map((item) => String(item || ''))
          .filter(Boolean)
      : [],
    issues,
    dimensions,
    comparison,
    developerAssets,
    iterationPrompt: String(parsed?.iterationPrompt || issues.map((item) => item.fix).join('；')),
    sources: SOURCE_LINKS,
  }
}

function applyAuditLocalization(audit, content) {
  const value = String(content || '').trim()
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')
  let parsed
  try {
    parsed = JSON.parse(fenced || value.slice(start, end + 1))
  } catch {
    return audit
  }
  const issueById = new Map(audit.issues.map((issue) => [issue.id, issue]))
  const issueRegions = new Map(
    (Array.isArray(parsed?.issues) ? parsed.issues : [])
      .map((item) => {
        const id = String(item?.id || '')
        return [id, localizedIssueRegion(item, issueById.get(id))]
      })
      .filter(([id, region]) => id && region),
  )
  const localizedAssets = new Map(
    (Array.isArray(parsed?.developerAssets) ? parsed.developerAssets : [])
      .map((item) => [String(item?.id || ''), item])
      .filter(([id, item]) => id && localizedAssetRegion(item)),
  )
  return {
    ...audit,
    grounded: true,
    issues: audit.issues.map((issue) => ({
      ...issue,
      region: issueRegions.get(issue.id) || null,
    })),
    developerAssets: audit.developerAssets
      .map((asset) => {
        const localized = localizedAssets.get(asset.id)
        if (!localized) return null
        return {
          ...asset,
          name: String(localized.name || asset.name),
          region: localizedAssetRegion(localized),
          reason: String(localized.reason || asset.reason),
          suggestedFormat: ['png', 'webp'].includes(localized.suggestedFormat)
            ? localized.suggestedFormat
            : asset.suggestedFormat,
        }
      })
      .filter(Boolean),
  }
}

export function buildQualityIterationPrompt(audit, selectedIssueIds = []) {
  const issues = Array.isArray(audit?.issues) ? audit.issues : []
  const selected = new Set(selectedIssueIds)
  const targets = issues.filter((issue) => selected.has(issue.id))
  if (!targets.length) return ''
  const trimSentenceEnd = (value) =>
    String(value || '')
      .trim()
      .replace(/[。；;，,.]+$/u, '')
  const instructions = targets
    .map(
      (issue, index) =>
        `${index + 1}. ${trimSentenceEnd(issue.title)}：${trimSentenceEnd(issue.fix)}${issue.evidence ? `。对应现状：${trimSentenceEnd(issue.evidence)}` : ''}。`,
    )
    .join('\n')
  return `基于当前版本进行定向修复，只处理以下 ${targets.length} 项：\n${instructions}\n范围锁定：未列出的区域、文案、信息架构、组件位置、品牌色、画布比例和视觉风格保持不变；不要借机重做整页，不要新增无关模块。完成后保证文字清晰、对齐稳定、组件可开发。`
}

export function buildDesignQualityRules({ pageType, style, density, colorScheme }) {
  const rules = [
    '品质增强：先建立清晰的信息主次和一条明确的视觉动线，再安排装饰；不要套用千篇一律的 SaaS 卡片模板。',
    '避免无意义的大标题、悬浮卡片堆叠、卡片嵌套、重复圆角容器和装饰性图标底座；每个容器必须有清晰的信息分组职责。',
    '布局允许有节奏变化，但所有变化必须服务于内容和操作；首屏要有明确焦点，次要内容不得与主要任务竞争。',
    '动效只能通过静态画面中的层级、状态和方向暗示表达，不要绘制夸张光效、速度线或无法实现的交互效果。',
  ]
  if (density === 'compact') {
    rules.push('紧凑模式仍须保证分组边界清楚、操作热区可辨，不能通过缩小文字和压缩行高堆叠信息。')
  }
  if (['minimal', 'monochrome'].includes(style)) {
    rules.push(
      '极简或单色方向依靠排版、间距和字重建立层级，不得为了“反模板化”强行添加多余颜色或装饰。',
    )
  }
  if (['darkpro', 'futuristic'].includes(style) || colorScheme === 'dark') {
    rules.push('深色界面避免大面积发光描边与低对比灰字，使用克制的高光和可读的表面层级。')
  }
  if (['dashboard', 'admin', 'crm', 'analytics', 'workspace'].includes(pageType)) {
    rules.push('专业工作界面以扫描、比较和重复操作效率为先，禁止营销式巨型 Hero 和无效大留白。')
  }
  if (['landing', 'portfolio'].includes(pageType)) {
    rules.push(
      '品牌页面首屏必须直接呈现产品、作品或明确价值，视觉表达可以有个性但不能牺牲正文可读性。',
    )
  }
  return rules.join('\n')
}

export async function auditAiDesignQuality({
  image,
  model,
  productPrompt,
  pageType,
  style,
  density,
  colorScheme,
  reviewMode = 'balanced',
  baseline,
  signal,
}) {
  const reference = referenceDescriptor(image)
  if (!reference) throw new Error('请先选择一张设计稿')
  const mode =
    DESIGN_QUALITY_REVIEW_MODES.find((item) => item.id === reviewMode) ||
    DESIGN_QUALITY_REVIEW_MODES[0]
  const baselineContext = baseline
    ? JSON.stringify({
        score: baseline.score,
        dimensions: baseline.dimensions?.map(({ id, score }) => ({ id, score })) || [],
        issues:
          baseline.issues?.map(({ id, dimension, title }) => ({ id, dimension, title })) || [],
      })
    : ''
  let conversation
  try {
    conversation = await createAssistantConversation('UI 设计品质检查')
    const prompt = `你是资深产品设计评审。请检查附带的完整 UI 设计稿，而不是重新描述图片。

产品与页面目标：${productPrompt || '未提供'}
页面类型：${pageType || '未指定'}
视觉风格：${style || '未指定'}
信息密度：${density || '未指定'}
明暗模式：${colorScheme || '未指定'}
评审视角：${mode.label}。${mode.prompt}
${baselineContext ? `父版本评审基线：${baselineContext}` : '父版本评审基线：无，本次不做版本问题归因。'}

按以下维度逐项检查：
1. 信息层级与核心任务是否清楚，是否存在模板化大标题、无效留白或视觉竞争。
2. 栅格、对齐、间距、密度和容器职责是否一致，是否存在卡片嵌套或重复圆角盒子。
3. 字号、字重、行高、换行和文字可读性，特别检查乱码、伪文字、溢出和低对比。
4. 品牌色、语义色、中性色和明暗表面是否协调，状态是否仅依赖颜色区分。
5. 按钮、输入框、导航、表格、图表和反馈状态是否完整、一致且符合业务。
6. 页面是否像真实可开发产品，而不是概念海报、样机、拼贴或通用 AI 模板。

先分别评分，再给出可定位、可单独修复的问题。每个问题必须同时给出它在整张图中的唯一主要区域。坐标统一使用 0–1000 标尺：左上角为 (0,0)，右下角为 (1000,1000)，x、y、width、height 都是整数。不要因为追求反模板化而破坏用户指定的极简、专业或高密度方向。

另外识别必须独立交付开发的视觉素材：Logo、非通用图标、头像、插画、照片、图表和无法仅靠 CSS 还原的特殊装饰。普通文字、按钮底色、卡片、输入框、分割线、通用 Bootstrap 图标和纯 CSS 形状不要列为素材。每个素材使用紧贴可见边缘的区域，不能包含周围界面。

只返回 JSON，不要 Markdown：
{
  "score": 0,
  "verdict": "一句话结论",
  "dimensions": [
    { "id": "hierarchy", "label": "信息层级", "score": 0, "note": "一句具体判断" },
    { "id": "layout", "label": "布局节奏", "score": 0, "note": "一句具体判断" },
    { "id": "typography", "label": "文字质量", "score": 0, "note": "一句具体判断" },
    { "id": "color", "label": "配色对比", "score": 0, "note": "一句具体判断" },
    { "id": "components", "label": "组件一致", "score": 0, "note": "一句具体判断" },
    { "id": "product", "label": "业务完整", "score": 0, "note": "一句具体判断" }
  ],
  "strengths": ["最多四条具体优点"],
  "issues": [
    { "severity": "critical|major|minor", "dimension": "hierarchy|layout|typography|color|components|product", "title": "问题名称", "evidence": "指出画面中的具体位置或表现", "fix": "可直接单独执行的修改", "region": { "x": 0, "y": 0, "width": 0, "height": 0 } }
  ],
  "developerAssets": [
    { "name": "素材名称", "type": "logo|icon|avatar|illustration|photo|chart|decoration", "region": { "x": 0, "y": 0, "width": 0, "height": 0 }, "reason": "为什么需要独立交付", "suggestedFormat": "png|webp" }
  ],
  "comparison": ${baselineContext ? '{ "summary": "相对父版本的一句话变化", "resolvedIssueIds": ["父版本 issue id"], "persistentIssueIds": ["父版本 issue id"], "newIssueCount": 0 }' : 'null'},
  "iterationPrompt": "合并所有必要修复的一段精确迭代指令，强调未提及部分保持不变"
}`
    const created = await createAssistantRun(
      {
        conversationId: conversation.id,
        prompt,
        mode: 'chat',
        model,
        clientUserMessageId: uid('quality-user'),
        clientAssistantMessageId: uid('quality-assistant'),
        referenceImages: [reference],
        count: 1,
        quality: 'high',
        serviceKey: 'ui_design_analysis',
      },
      { signal },
    )
    const runId = created?.run?.id
    if (!runId) throw new Error('品质检查任务创建失败')
    const completed = await waitForAssistantRun(runId, { signal, intervalMs: 700 })
    if (completed?.run?.status !== 'succeeded') {
      throw new Error(completed?.run?.errorMessage || '品质检查失败')
    }
    const audit = parseAuditResult(completed?.assistantMessage?.content)
    const ungroundedAudit = {
      ...audit,
      grounded: false,
      issues: audit.issues.map((issue) => ({ ...issue, region: null })),
      developerAssets: [],
    }
    const groundingReferenceUrl = await createGroundingReference(image, signal).catch(() => '')
    if (!groundingReferenceUrl) return ungroundedAudit
    const groundingReference = referenceDescriptor(
      groundingReferenceUrl,
      '带编号定位网格的 UI 设计稿',
    )
    const localizationPrompt = `你现在只负责复核品质问题和开发素材的位置，不再评分或提出新问题。第一张图是干净原稿，第二张图是完全相同的原稿并覆盖了 16列×10行定位网格：列为 A-P，行为 1-10。

待复核问题：${JSON.stringify(audit.issues.map(({ id, title, evidence }) => ({ id, title, evidence })))}
待复核素材：${JSON.stringify(audit.developerAssets.map(({ id, name, type }) => ({ id, name, type })))}

逐项对照第二张图的可见网格编号定位：
1. 先判断问题是否真的存在一个可以在截图上框住的单一可见目标。只有文字、按钮、标题、输入框、单张卡片等明确局部目标可标为 local。整体明暗模式、全页风格、重复卡片、分散在多处的按钮层级、缺少某个流程或功能等问题必须标为 global、distributed 或 missing，绝对不能为了凑数随便框一块区域。
2. 只有 scope=local 且置信度不低于 0.82 的问题才返回 cells。cells 必须是直接覆盖问题目标的最少连续单元格，最多 16 格；这个上限只用于一张完整卡片或单个连续模块，目标不明确就省略该问题。不得用页头、Logo、头像或右栏代替一个全局问题的位置。
3. 每个素材先返回唯一 cell，再返回该单元格内部的 regionInCell。regionInCell 使用单元格自身 0–1000 坐标，必须紧贴素材本体可见边缘。Logo 图形与旁边品牌文字若可独立使用，只框 Logo 图形；头像只框头像；图表只框图表本体。
   Logo 优先选择可独立复用的最小图形标志；如果图形与字标不可分割，则必须完整框住全部字标，绝对不能切穿、截断或只带入半个字符。
4. cell 必须是素材中心实际所在的格子，regionInCell 不允许越出该格。只有置信度不低于 0.82 时才返回；无法在网格图中明确找到的素材直接省略。
5. 保持传入 id，不新增项目。宁可少返回，也不能返回猜测位置。

只返回 JSON：
{
  "issues": [{ "id": "issue-1", "scope": "local|global|distributed|missing", "confidence": 0.0, "target": "截图中唯一可见目标；非 local 时留空", "cells": ["A1", "B1"] }],
  "developerAssets": [{ "id": "asset-1", "name": "素材名称", "confidence": 0.0, "cell": "A1", "regionInCell": { "x": 0, "y": 0, "width": 0, "height": 0 }, "reason": "交付原因", "suggestedFormat": "png|webp" }]
}`
    try {
      const localization = await createAssistantRun(
        {
          conversationId: conversation.id,
          prompt: localizationPrompt,
          mode: 'chat',
          model,
          clientUserMessageId: uid('quality-location-user'),
          clientAssistantMessageId: uid('quality-location-assistant'),
          referenceImages: [reference, groundingReference],
          count: 1,
          quality: 'high',
          serviceKey: 'ui_design_analysis',
        },
        { signal },
      )
      const localizationRunId = localization?.run?.id
      if (!localizationRunId) return ungroundedAudit
      const localized = await waitForAssistantRun(localizationRunId, { signal, intervalMs: 700 })
      if (localized?.run?.status !== 'succeeded') return ungroundedAudit
      return applyAuditLocalization(audit, localized?.assistantMessage?.content)
    } catch (caught) {
      if (caught?.name === 'AbortError') throw caught
      return ungroundedAudit
    }
  } finally {
    if (conversation?.id) {
      await deleteAssistantConversation(conversation.id, { cancelActive: true }).catch(() => null)
    }
  }
}

export async function auditAiDesignRegion({
  image,
  regionImage,
  region,
  model,
  productPrompt,
  signal,
}) {
  const fullReference = referenceDescriptor(image)
  const regionReference = referenceDescriptor(regionImage)
  if (!fullReference || !regionReference) throw new Error('框选区域预览生成失败，请重新框选')
  let conversation
  try {
    conversation = await createAssistantConversation('UI 设计区域优化')
    const prompt = `你是资深 UI 设计评审。第一张图是完整页面，第二张图是用户框选区域的清晰裁图。

页面目标：${productPrompt || '未提供'}
框选位置：左侧 ${Math.round(region.x * 100)}%，顶部 ${Math.round(region.y * 100)}%，宽 ${Math.round(region.width * 100)}%，高 ${Math.round(region.height * 100)}%。

只分析框选区域，同时结合完整页面判断它的上下文。指出这个区域承担的功能、最具体的视觉或体验问题，以及不破坏页面其他部分的优化方式。禁止建议重做整页。

只返回 JSON，不要 Markdown：
{
  "title": "区域名称",
  "location": "页面中的位置与功能",
  "summary": "一句话优化判断",
  "observations": ["最多三条具体问题"],
  "suggestions": ["最多三条可执行建议"],
  "iterationPrompt": "只修改框选区域的精确迭代指令，明确其他区域保持不变"
}`
    const created = await createAssistantRun(
      {
        conversationId: conversation.id,
        prompt,
        mode: 'chat',
        model,
        clientUserMessageId: uid('region-user'),
        clientAssistantMessageId: uid('region-assistant'),
        referenceImages: [fullReference, regionReference],
        count: 1,
        quality: 'high',
        serviceKey: 'ui_design_analysis',
      },
      { signal },
    )
    const runId = created?.run?.id
    if (!runId) throw new Error('区域优化任务创建失败')
    const completed = await waitForAssistantRun(runId, { signal, intervalMs: 700 })
    if (completed?.run?.status !== 'succeeded') {
      throw new Error(completed?.run?.errorMessage || '区域优化分析失败')
    }
    const value = String(completed?.assistantMessage?.content || '').trim()
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
    const start = value.indexOf('{')
    const end = value.lastIndexOf('}')
    const parsed = JSON.parse(fenced || value.slice(start, end + 1))
    return {
      title: String(parsed?.title || '框选区域'),
      location: String(parsed?.location || ''),
      summary: String(parsed?.summary || '区域分析完成'),
      observations: Array.isArray(parsed?.observations)
        ? parsed.observations.map(String).filter(Boolean).slice(0, 3)
        : [],
      suggestions: Array.isArray(parsed?.suggestions)
        ? parsed.suggestions.map(String).filter(Boolean).slice(0, 3)
        : [],
      iterationPrompt: String(parsed?.iterationPrompt || ''),
    }
  } catch (caught) {
    if (caught instanceof SyntaxError) {
      throw new Error('区域优化结果无法解析，请重新框选', { cause: caught })
    }
    throw caught
  } finally {
    if (conversation?.id) {
      await deleteAssistantConversation(conversation.id, { cancelActive: true }).catch(() => null)
    }
  }
}
