import {
  cancelAssistantRun,
  createAssistantConversation,
  createAssistantRun,
  deleteAssistantConversation,
  listActiveAssistantRuns,
  openAssistantRunStream,
  waitForAssistantRun,
} from '../../services/assistantApi.js'
import { withTransparentPngInstruction } from '../ai-shared/transparentPng.js'
import { stabilizeAnalysisNodes } from './analysisNodeGeometry.js'
import { normalizeCropElementItems } from './regionGeometry.js'
import { parseCropElementResponse } from './cropElementResponse.js'
import {
  resolveRegionImageRequestSize,
  wantsRegionTransparentOutput,
} from './regionOutputPolicy.js'

export const ACTIVE_DESIGN_ANALYSIS_KEY = 'ui-design-active-analysis-v1'
export const ACTIVE_DESIGN_ANALYSIS_VERSION = 3

function uid(prefix = 'design') {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  )
}

function number(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeNode(item, index, viewport) {
  const type = [
    'frame',
    'text',
    'rectangle',
    'button',
    'input',
    'icon',
    'image',
    'divider',
  ].includes(item?.type)
    ? item.type
    : 'rectangle'
  const width = Math.max(1, Math.min(number(item?.width, 120), viewport.width))
  const height = Math.max(1, Math.min(number(item?.height, 48), viewport.height))
  const isText = type === 'text'
  return {
    id: String(item?.id || `node-${index + 1}`),
    name: String(item?.name || `图层 ${index + 1}`),
    type,
    parentId: String(item?.parentId || ''),
    x: Math.max(0, Math.min(number(item?.x), viewport.width - width)),
    y: Math.max(0, Math.min(number(item?.y), viewport.height - height)),
    width,
    height,
    fill: isText ? 'transparent' : String(item?.fill || '#ffffff'),
    color: String(item?.color || '#18181f'),
    stroke: isText ? 'transparent' : String(item?.stroke || 'transparent'),
    strokeWidth: isText ? 0 : Math.max(0, number(item?.strokeWidth)),
    radius: isText ? 0 : Math.max(0, number(item?.radius)),
    opacity: Math.min(1, Math.max(0, number(item?.opacity, 1))),
    text: String(item?.text || ''),
    fontSize: Math.max(8, number(item?.fontSize, type === 'text' ? 16 : 14)),
    fontWeight: Math.max(100, Math.min(900, number(item?.fontWeight, 500))),
    lineHeight: Math.max(0.8, number(item?.lineHeight, 1.4)),
    align: ['left', 'center', 'right'].includes(item?.align) ? item.align : 'left',
    icon: String(item?.icon || ''),
    src: String(item?.src || ''),
    objectFit: ['contain', 'cover'].includes(item?.objectFit) ? item.objectFit : 'contain',
    shadow: isText ? 'none' : String(item?.shadow || 'none'),
    category: ['layout', 'component', 'content', 'icon', 'image'].includes(item?.category)
      ? item.category
      : type === 'icon'
        ? 'icon'
        : type === 'image'
          ? 'image'
          : ['button', 'input'].includes(type)
            ? 'component'
            : 'content',
    description: String(item?.description || item?.name || `图层 ${index + 1}`),
    confidence: Math.min(1, Math.max(0, number(item?.confidence, 0.8))),
    sourceBounds: {
      x: Math.max(0, Math.min(number(item?.x), viewport.width - width)),
      y: Math.max(0, Math.min(number(item?.y), viewport.height - height)),
      width,
      height,
    },
    detached: false,
    hidden: false,
    locked: false,
  }
}

function normalizeNodes(items, viewport) {
  const ids = new Set()
  const normalized = items.map((item, index) => {
    const node = normalizeNode(item, index, viewport)
    const baseId = node.id
    let suffix = 2
    while (ids.has(node.id)) {
      node.id = `${baseId}-${suffix}`
      suffix += 1
    }
    ids.add(node.id)
    return node
  })
  return normalized.filter((node) => {
    if (node.opacity <= 0) return false
    if (node.type === 'text' && !node.text.trim()) return false
    if (node.type !== 'text') return true
    return !normalized.some((container) => {
      if (
        !['button', 'input'].includes(container.type) ||
        container.text.trim() !== node.text.trim()
      ) {
        return false
      }
      return (
        node.x >= container.x - 2 &&
        node.y >= container.y - 2 &&
        node.x + node.width <= container.x + container.width + 2 &&
        node.y + node.height <= container.y + container.height + 2
      )
    })
  })
}

function targetViewport(viewport) {
  return {
    width: Math.max(1, Math.round(number(viewport?.width, 1440))),
    height: Math.max(1, Math.round(number(viewport?.height, 810))),
    background: String(viewport?.background || '#ffffff'),
  }
}

function sourceViewport(viewport, fallback) {
  return {
    width: Math.max(1, number(viewport?.width, fallback.width)),
    height: Math.max(1, number(viewport?.height, fallback.height)),
    background: String(viewport?.background || fallback.background),
  }
}

// Vision models occasionally return coordinates in their own analysis canvas even when the
// requested viewport is explicit. Always project that coordinate system back to the real target
// viewport before normalization; otherwise every layer drifts by the same scale factor.
function projectNodes(items, fromViewport, toViewport) {
  const scaleX = toViewport.width / Math.max(1, fromViewport.width)
  const scaleY = toViewport.height / Math.max(1, fromViewport.height)
  const visualScale = Math.sqrt(scaleX * scaleY)
  const projected = items.map((item) => ({
    ...item,
    x: number(item?.x) * scaleX,
    y: number(item?.y) * scaleY,
    width: number(item?.width, 120) * scaleX,
    height: number(item?.height, 48) * scaleY,
    radius: number(item?.radius) * visualScale,
    strokeWidth: number(item?.strokeWidth) * visualScale,
    fontSize: number(item?.fontSize, item?.type === 'text' ? 16 : 14) * scaleY,
  }))
  return normalizeNodes(projected, toViewport)
}

function extractArrayObjects(text, key) {
  const source = String(text || '')
  const keyIndex = source.indexOf(`"${key}"`)
  if (keyIndex < 0) return []
  const arrayStart = source.indexOf('[', keyIndex)
  if (arrayStart < 0) return []
  const objects = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = arrayStart + 1; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') {
      if (depth === 0) start = index
      depth += 1
    } else if (char === '}') {
      depth = Math.max(0, depth - 1)
      if (depth === 0 && start >= 0) {
        try {
          objects.push(JSON.parse(source.slice(start, index + 1)))
        } catch {
          // Ignore the current incomplete streamed node.
        }
        start = -1
      }
    } else if (char === ']' && depth === 0) break
  }
  return objects
}

function extractViewport(text, fallback) {
  const match = String(text || '').match(
    /"viewport"\s*:\s*\{[^}]*"width"\s*:\s*(\d+)[^}]*"height"\s*:\s*(\d+)[^}]*"background"\s*:\s*"([^"]+)"/,
  )
  return match
    ? { width: Number(match[1]), height: Number(match[2]), background: match[3] }
    : fallback
}

export function extractDesignDocumentProgress(text, fallbackViewport) {
  const viewport = targetViewport(fallbackViewport)
  const reportedViewport = sourceViewport(extractViewport(text, viewport), viewport)
  return {
    viewport,
    nodes: projectNodes(extractArrayObjects(text, 'nodes'), reportedViewport, viewport),
  }
}

function parseDesignDocument(text, fallbackViewport) {
  const value = String(text || '').trim()
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const candidate = fenced || value.slice(value.indexOf('{'), value.lastIndexOf('}') + 1)
  let parsed
  let partial = false
  try {
    parsed = JSON.parse(candidate)
  } catch {
    const recoveredNodes = extractArrayObjects(value, 'nodes')
    if (!recoveredNodes.length) throw new Error('AI 返回的设计文档无法解析，请重新生成')
    partial = true
    parsed = {
      name: value.match(/"name"\s*:\s*"([^"]+)"/)?.[1] || '设计稿元素分析',
      viewport: extractViewport(value, fallbackViewport),
      nodes: recoveredNodes,
      tokens: { colors: [], spacing: [], typography: [] },
    }
  }
  const viewport = targetViewport(fallbackViewport)
  const reportedViewport = sourceViewport(parsed?.viewport, viewport)
  const nodes = stabilizeAnalysisNodes(
    projectNodes(Array.isArray(parsed?.nodes) ? parsed.nodes : [], reportedViewport, viewport),
    viewport,
  )
  if (!nodes.length) throw new Error('AI 没有生成有效的设计图层')
  return {
    id: uid('document'),
    name: String(parsed?.name || '未命名设计稿'),
    viewport,
    nodes,
    tokens: {
      colors: Array.isArray(parsed?.tokens?.colors) ? parsed.tokens.colors : [],
      spacing: Array.isArray(parsed?.tokens?.spacing) ? parsed.tokens.spacing : [],
      typography: Array.isArray(parsed?.tokens?.typography) ? parsed.tokens.typography : [],
    },
    partial,
  }
}

function mergePartialDesignDocument(base, refinement) {
  const refinedById = new Map(refinement.nodes.map((node) => [node.id, node]))
  const merged = base.nodes.map((node) => refinedById.get(node.id) || node)
  const known = new Set(merged.map((node) => node.id))
  refinement.nodes.forEach((node) => {
    if (!known.has(node.id)) merged.push(node)
  })
  return {
    ...base,
    name: refinement.name || base.name,
    viewport: refinement.viewport || base.viewport,
    nodes: merged,
    tokens: refinement.tokens || base.tokens,
    partial: true,
  }
}

function resolveRefinedDesignDocument(base, refinement) {
  // A complete calibration pass is authoritative. Keeping draft-only nodes here can resurrect
  // regions that the vision model deliberately removed or moved during pixel-level validation.
  if (!refinement.partial) return refinement
  return mergePartialDesignDocument(base, refinement)
}

function referenceDescriptor(source, name = '当前 UI 设计成稿') {
  const value = String(source || '').trim()
  if (!value) return null
  const url = new URL(value, window.location.origin)
  const marker = '/api/v1/files/'
  const markerIndex = url.pathname.indexOf(marker)
  const fileKey =
    markerIndex >= 0 ? decodeURIComponent(url.pathname.slice(markerIndex + marker.length)) : ''
  return {
    id: uid('reference'),
    name,
    dataUrl: url.href,
    ...(fileKey ? { fileKey } : {}),
  }
}

function designPrompt({ prompt, viewport, hasReference }) {
  return `你是一个直接操作专业设计画布的 UI 设计代理。${
    hasReference
      ? '已附带一张当前 UI 成稿。你的任务是分析整张设计图并建立可点击的语义区域，不是重绘或重建设计稿。'
      : '根据产品要求创建一份可编辑设计文档。'
  }

产品要求：
${prompt}

${
  hasReference
    ? `视觉还原要求：
- 附图是唯一视觉基准，保持相同的画布比例、布局区域、间距、配色、圆角、字体层级和内容密度。
- 这不是重新绘图任务。原图会完整显示，nodes 只用于让用户点击某个按钮、图标、图片、卡片或页面模块，并进一步提取素材或生成该区域代码。
- 当前附图已经由客户端无留白重采样为 ${viewport.width}×${viewport.height}；附图像素坐标与输出 viewport 完全一致，不存在原始文件尺寸、缩略图尺寸或 letterbox 偏移。
- 先按 ${viewport.width}×${viewport.height} 建立坐标标尺，再识别背景、导航、侧栏和内容容器，最后识别卡片、文字、按钮、图标与图片。
- 所有 x、y、width、height 都必须是相对于整张原图左上角的整数像素；禁止使用百分比、局部坐标或模型内部缩放后的坐标。
- 每个可见元素只建立一个紧贴其可见边缘的 bounding box，不要为了语义完整而扩大范围，也不要把整块区域误识别成单个组件。
- 不得擅自改变主题、重新排版、替换文案或添加附图中不存在的模块。
- 无法读取的细小文字保留短占位文案即可，但 bounding box 的位置和尺寸仍必须与附图一致。`
    : ''
}

必须只返回 JSON，不要 Markdown 或解释，并严格按以下键顺序输出。客户端会实时读取每一个已经闭合的 node 并立即放到画布上：
{
  "name": "设计稿名称",
  "viewport": { "width": ${viewport.width}, "height": ${viewport.height}, "background": "#ffffff" },
  "nodes": [
    ${
      hasReference
        ? `{
      "id": "nav-logo",
      "name": "导航 Logo",
      "type": "icon",
      "parentId": "nav",
      "x": 24, "y": 20, "width": 32, "height": 32,
      "text": "",
      "category": "icon", "description": "顶部导航中的品牌 Logo", "confidence": 0.95
    }`
        : `{
      "id": "nav",
      "name": "顶部导航",
      "type": "frame",
      "parentId": "",
      "x": 0, "y": 0, "width": ${viewport.width}, "height": 72,
      "fill": "#ffffff", "color": "#18181f", "stroke": "#eeeeee", "strokeWidth": 1,
      "radius": 0, "opacity": 1, "shadow": "none",
      "text": "", "fontSize": 14, "fontWeight": 500, "lineHeight": 1.4, "align": "left", "icon": "",
      "src": "", "objectFit": "contain",
      "category": "layout", "description": "页面顶部主导航区域", "confidence": 0.95
    }`
    }
  ],
  "tokens": ${
    hasReference
      ? `{ "colors": [], "spacing": [], "typography": [] }`
      : `{
    "colors": [{ "name": "Primary", "value": "#6d5cff" }],
    "spacing": [{ "name": "Space 4", "value": 16 }],
    "typography": [{ "name": "Heading", "fontSize": 32, "fontWeight": 700 }]
  }`
  }
}

规则：
1. nodes 是完整的可点击图层清单，按从大区域到叶子元素、从上到下输出。不得设置固定数量上限：简单页面通常不少于 60 个，普通页面通常为 100-180 个，复杂页面继续增加，直到所有可见非文字层都被覆盖。
2. 只使用 frame、text、rectangle、button、input、icon、image、divider 八种 type。
3. 所有节点使用画布绝对坐标，不能超出 ${viewport.width}×${viewport.height}。
4. ${
    hasReference
      ? '这是定位分析，不是重绘。为保证流式分析稳定，每个 node 只能输出示例中的 id、name、type、parentId、x、y、width、height、text、category、description、confidence 十二个字段，禁止输出 fill、color、stroke、shadow、fontSize、src 等样式字段；JSON 不要美化缩进。'
      : '每个节点必须有完整可见样式。'
  } 文字按语义文本块建立节点：同一个标题、段落、标签或说明即使渲染成多行，也只能是一个 text 节点；不要按视觉行拆分。不同语义、字号、颜色或对齐方式的文字必须分开。${hasReference ? '' : 'text 的 fill、stroke 必须为 transparent，strokeWidth 必须为 0；禁止给文字画黑框或底色。'}
5. ${
    hasReference
      ? 'image 节点只记录原图中图片、头像、图表或插画的精确边界，不猜造或替换素材，src 保持为空，objectFit 使用 cover。'
      : 'image 节点使用干净的渐变或中性色素材占位，objectFit 默认 contain。'
  }
6. frame 用于页面区域、侧栏、卡片等容器；子节点填写 parentId，但仍使用相对整张画布的绝对坐标。
7. 按钮或输入框的容器与其文案合并为一个节点，不再叠加同文案 text；但其中独立可见的图标、头像、徽标、开关滑块、下拉箭头必须各自建立子节点并填写 parentId。
8. 必须逐层扫描所有非文字视觉层：页面背景、区域容器、卡片、媒体框、按钮、输入框、选择器、标签、徽章、开关、单选/复选控件、图标、头像、Logo、插画、照片、图表、进度条、滚动条、边框、分割线和有明确边界的装饰形状。即使尺寸很小也不能遗漏。每一个可点击按钮都必须有独立节点，包括纯图标按钮、工具栏按钮、分页按钮、轮播箭头、菜单触发器、标签页和分段控件；不得只识别按钮文字或只识别外层工具栏。
9. 父子关系必须与视觉嵌套一致。父节点和子节点都使用整张画布绝对坐标；同一个视觉层只出现一次，不用重复的大框模拟细节。
10. 每个节点都要填写 category、description 和 confidence；category 只允许 layout、component、content、icon、image。`
}

function refinementPrompt(viewport) {
  return `现在进行第二轮区域校准。请把上一轮区域分析与本轮附带的原始 UI 成稿逐项对照，并返回完整、修正后的 JSON。

校准重点：
1. viewport 必须逐字保持为 width=${viewport.width}、height=${viewport.height}，不得替换成原图文件尺寸、模型视觉尺寸或其他坐标系。
2. 本轮附图本身就是 ${viewport.width}×${viewport.height}，没有缩略图缩放或黑边；直接以附图左上角为 (0,0) 校准。
3. 逐个检查可点击区域的四条边是否与原稿元素可见边缘重合，优先修正 x、y、width、height；全部坐标使用整数像素。
4. 保留语义相同节点的 id；删除重复、不可见或完全被遮挡的节点，并执行一次从左上到右下、从父层到叶子层的缺失审计。不要只补“关键节点”，所有可见非文字层都要补齐。
5. 同一标题、段落、标签或说明即使换成多行也必须合并为一个语义文本块。按钮和输入框的文案直接写在自身 text 中，不叠加重复文字层。
6. 检查前后景绘制顺序和 parentId，避免大面积 frame 遮挡内容。
7. 不得重新设计、改主题或添加原稿中不存在的模块。
8. 不要根据常见 UI 模板推测布局；只根据原稿实际像素位置校准。按钮、图标、头像、图表、图片和卡片都必须使用紧边界，不能用大框粗略包围。
9. 逐个审计所有按钮以及按钮内部图标、下拉箭头、开关滑块、单选/复选标记、徽章、Logo 子形状、进度条、分割线、边框与装饰形状。初轮已经识别的可见按钮、卡片和模块不得在本轮遗漏；纯图标按钮、工具栏按钮、分页按钮、菜单触发器和分段控件必须各自保留独立节点。这些叶子层必须拥有独立节点和正确 parentId，不能因为已有父容器而省略。
10. 节点数量由原稿复杂度决定，不得为了缩短响应而合并不同视觉层或停止扫描。
11. 每个区域都要填写 category、description 和 confidence；category 只允许 layout、component、content、icon、image。
12. 保持紧凑定位协议：每个 node 只输出 id、name、type、parentId、x、y、width、height、text、category、description、confidence；tokens 返回三个空数组；禁止输出任何样式字段或美化缩进。
13. 对每个 button、input、text 节点执行“文字—边界”核验：name 和 text 必须来自该 bounding box 内真实可见的文字；如果框内文字与节点名称不一致，必须移动边界或修正名称，禁止把相邻菜单项的名称配给当前坐标。
14. 输出前按 y、x 顺序复查同一菜单或列表中的连续项目，确认名称顺序、垂直顺序和坐标顺序完全一致；不得将上一项或下一项的语义错位套用。

只返回完整 JSON，不要 Markdown、说明、评分或差异报告。键顺序与上一轮完全一致。`
}

function terminalRunError(message) {
  const error = new Error(message || 'AI 设计任务失败')
  error.runTerminal = true
  return error
}

async function monitorDesignPass({ runId, phase, signal, onStage, onStream }) {
  onStage?.(phase === 'refine' ? 'auditing' : 'drawing')
  const stream = openAssistantRunStream(runId, {
    onEvent(event) {
      if (event?.stage) onStage?.(phase === 'refine' ? 'auditing' : event.stage)
      if (typeof event?.content === 'string') onStream?.(event.content, phase)
    },
  })
  try {
    const completed = await waitForAssistantRun(runId, {
      signal,
      intervalMs: 700,
      onUpdate(data) {
        if (data?.run?.stage) onStage?.(phase === 'refine' ? 'auditing' : data.run.stage)
        if (typeof data?.assistantMessage?.content === 'string') {
          onStream?.(data.assistantMessage.content, phase)
        }
      },
    })
    if (completed?.run?.status !== 'succeeded') {
      const partialContent = String(completed?.assistantMessage?.content || '')
      if (extractArrayObjects(partialContent, 'nodes').length >= 4) {
        return partialContent
      }
      throw terminalRunError(completed?.run?.errorMessage || 'AI 设计任务失败')
    }
    return completed?.assistantMessage?.content || ''
  } finally {
    stream?.close()
  }
}

async function executeDesignPass({
  conversationId,
  prompt,
  model,
  references,
  phase,
  signal,
  onStage,
  onRun,
  onStream,
}) {
  const created = await createAssistantRun(
    {
      conversationId,
      prompt,
      mode: 'chat',
      model,
      clientUserMessageId: uid('user'),
      clientAssistantMessageId: uid('assistant'),
      referenceImages: references,
      count: 1,
      quality: 'high',
      serviceKey: 'ui_design_analysis',
    },
    { signal },
  )
  const passRunId = created.run?.id || ''
  if (!passRunId) throw new Error('AI 分析任务创建失败')
  onRun?.(passRunId)
  return monitorDesignPass({ runId: passRunId, phase, signal, onStage, onStream })
}

export async function generateAiDesignDocument({
  prompt,
  model,
  viewport,
  referenceImage,
  resumeSession,
  signal,
  onStage,
  onRun,
  onSession,
  onStream,
  shouldPreserveSession,
}) {
  const requestedModel = String(resumeSession?.model || model || '').trim()
  const resumedConversationId = String(resumeSession?.conversationId || '').trim()
  let conversation = resumedConversationId ? { id: resumedConversationId } : null
  let runId = String(resumeSession?.runId || '').trim()
  let phase = resumeSession?.phase === 'refine' ? 'refine' : 'draft'
  let draftContent = String(resumeSession?.draftContent || '')
  let workflowTerminal = false
  try {
    onStage?.('preparing')
    if (!conversation) {
      conversation = await createAssistantConversation(
        referenceImage ? '设计稿元素分析' : 'AI 设计稿生成',
        { workspace: 'ui_design' },
      )
      onSession?.({
        conversationId: conversation.id,
        runId: '',
        phase: 'draft',
        model: requestedModel,
      })
    }
    const reference = referenceDescriptor(referenceImage)
    const references = reference ? [reference] : []
    let finalContent = ''

    if (resumedConversationId) {
      const activeRuns = await listActiveAssistantRuns({
        workspace: 'ui_design',
        signal,
      }).catch(() => [])
      const activeRun = activeRuns.find((item) => item?.conversationId === conversation.id)
      if (activeRun?.id && activeRun.id !== runId) {
        if (runId && phase === 'draft' && !draftContent) {
          draftContent = await monitorDesignPass({
            runId,
            phase: 'draft',
            signal,
            onStage,
            onStream,
          })
        }
        runId = activeRun.id
        if (draftContent) phase = 'refine'
      }
    }

    if (runId) {
      onRun?.(runId)
      onSession?.({
        conversationId: conversation.id,
        runId,
        phase,
        draftContent,
        model: requestedModel,
      })
      try {
        const resumedContent = await monitorDesignPass({
          runId,
          phase,
          signal,
          onStage,
          onStream,
        })
        if (phase === 'refine') finalContent = resumedContent
        else draftContent = resumedContent
      } catch (caught) {
        if (phase !== 'refine' || !draftContent || !caught?.runTerminal) throw caught
        finalContent = draftContent
      }
    } else {
      phase = 'draft'
      draftContent = await executeDesignPass({
        conversationId: conversation.id,
        prompt: designPrompt({ prompt, viewport, hasReference: Boolean(reference) }),
        model: requestedModel,
        references,
        phase,
        signal,
        onStage,
        onRun(value) {
          runId = value
          onRun?.(value)
          onSession?.({
            conversationId: conversation.id,
            runId,
            phase: 'draft',
            model: requestedModel,
          })
        },
        onStream,
      })
    }

    if (!finalContent) finalContent = draftContent
    if (reference && phase !== 'refine') {
      try {
        finalContent = await executeDesignPass({
          conversationId: conversation.id,
          prompt: refinementPrompt(viewport),
          model: requestedModel,
          references,
          phase: 'refine',
          signal,
          onStage,
          onRun(value) {
            runId = value
            onRun?.(value)
            onSession?.({
              conversationId: conversation.id,
              runId,
              phase: 'refine',
              draftContent,
              model: requestedModel,
            })
          },
          onStream,
        })
      } catch (caught) {
        if (signal?.aborted || caught?.name === 'AbortError') throw caught
        if (!caught?.runTerminal) throw caught
        finalContent = draftContent
      }
    }
    onStage?.('complete')
    workflowTerminal = true
    try {
      const finalDocument = parseDesignDocument(finalContent, viewport)
      if (finalContent !== draftContent) {
        try {
          return resolveRefinedDesignDocument(
            parseDesignDocument(draftContent, viewport),
            finalDocument,
          )
        } catch {
          return finalDocument
        }
      }
      return finalDocument
    } catch (caught) {
      if (finalContent === draftContent) throw caught
      return parseDesignDocument(draftContent, viewport)
    }
  } catch (caught) {
    if (caught?.runTerminal) workflowTerminal = true
    throw caught
  } finally {
    const preserveSession = shouldPreserveSession?.() === true
    const shouldKeepActiveRun = Boolean(runId) && !workflowTerminal && !signal?.aborted
    if (!preserveSession && !shouldKeepActiveRun && signal?.aborted && runId) {
      await cancelAssistantRun(runId).catch(() => null)
    }
    if (!preserveSession && !shouldKeepActiveRun && conversation?.id) {
      await deleteAssistantConversation(conversation.id, { cancelActive: true }).catch(() => null)
    }
  }
}

function unwrapCodeBlock(content) {
  const value = String(content || '').trim()
  return (
    value.match(/```(?:vue|html|css|javascript|typescript)?\s*([\s\S]*?)```/i)?.[1]?.trim() || value
  )
}

function regionCodePrompt({ viewport, region, framework }) {
  const target = framework === 'html' ? 'HTML + CSS' : 'Vue 3 单文件组件'
  return `你是高级前端工程师。附图是一张完整 UI 设计稿，只实现下面指定区域，不要生成整页。

整张设计图尺寸：${viewport.width}×${viewport.height}
目标区域：x=${Math.round(region.x)}, y=${Math.round(region.y)}, width=${Math.round(region.width)}, height=${Math.round(region.height)}
区域名称：${region.name}
区域类型：${region.type}
区域说明：${region.description || region.name}

请仔细查看附图中该坐标范围，输出可直接使用的 ${target}：
- 视觉结构、间距、颜色、圆角、边框、阴影和文字层级尽量贴近该区域。
- 只包含目标区域及其内部内容，不要补齐页面其他部分。
- 使用语义化结构和清晰类名，尺寸可响应式但默认外观应匹配目标区域。
- 图标优先使用 Bootstrap Icons 的 bi 类名；无法确认的素材使用明确的图片占位接口，不要伪造 base64。
- Vue 使用 <script setup> 和 scoped CSS；HTML 则把 CSS 放在同一个 <style> 中。
- 只返回代码，不要解释、Markdown 标题或使用说明。`
}

export async function generateDesignRegionCode({
  referenceImage,
  viewport,
  region,
  framework = 'vue',
  signal,
  onStage,
  onRun,
  onStream,
}) {
  let conversation = null
  let runId = ''
  try {
    onStage?.('preparing')
    conversation = await createAssistantConversation(`提取组件 · ${region.name}`, {
      workspace: 'ui_design',
    })
    const reference = referenceDescriptor(referenceImage)
    if (!reference) throw new Error('缺少原始设计图，无法生成区域代码')
    const content = await executeDesignPass({
      conversationId: conversation.id,
      prompt: regionCodePrompt({ viewport, region, framework }),
      references: [reference],
      phase: 'draft',
      signal,
      onStage,
      onRun(value) {
        runId = value
        onRun?.(value)
      },
      onStream(contentValue) {
        onStream?.(unwrapCodeBlock(contentValue))
      },
    })
    onStage?.('complete')
    return unwrapCodeBlock(content)
  } finally {
    if (signal?.aborted && runId) await cancelAssistantRun(runId).catch(() => null)
    if (conversation?.id) {
      await deleteAssistantConversation(conversation.id, { cancelActive: true }).catch(() => null)
    }
  }
}

function cropMinSelectableCount(viewport) {
  const area = Math.max(1, viewport.width) * Math.max(1, viewport.height)
  // Banner-sized crops should never collapse to a single “whole region” node.
  if (area >= 220_000) return 5
  if (area >= 90_000) return 4
  if (area >= 40_000) return 3
  return 2
}

function cropElementAnalysisPrompt({ viewport, recognitionTypes = [] }) {
  const width = Math.max(1, Math.round(viewport.width))
  const height = Math.max(1, Math.round(viewport.height))
  const minCount = recognitionTypes.length ? 1 : cropMinSelectableCount({ width, height })
  const coordinateEdge = 1000
  const targetMin = minCount
  const targetMax = 12
  const selected = new Set(recognitionTypes)
  const allowedTypes = [
    ...(selected.has('text') ? ['text', 'button', 'input'] : []),
    ...(selected.has('icon') ? ['icon'] : []),
    ...(selected.has('image') ? ['image'] : []),
  ]
  const recognitionRule = allowedTypes.length
    ? `本次只识别这些 type：${allowedTypes.join(', ')}。其它类型即使可见也禁止输出。`
    : '本次没有勾选识别类型，禁止输出任何元素。'
  const exampleType = allowedTypes[0] || 'text'
  return `你是 UI 局部截图的「多元素拆分器」。唯一依据是本消息附图的真实像素。

目标：只把用户勾选类别拆成可独立点选编辑的叶子元素。
${recognitionRule}
禁止：把整块截图识别成 1 个元素；禁止编造附图中看不见的文字或物体。
name 与 text 必须逐字来自附图可见内容；bounding box 必须紧贴该内容的真实像素位置，不能凭空偏移。

只输出一个紧凑 JSON 对象。第一个字符必须是 {，最后一个字符必须是 }。不要 Markdown、代码围栏、解释或 :::writing 包装。

唯一允许的结构：
{"coordinateSpace":{"width":${coordinateEdge},"height":${coordinateEdge},"unit":"normalized"},"nodes":[{"id":"el_1","name":"附图真实名称","type":"${exampleType}","x":0,"y":0,"width":1,"height":1,"text":"附图原文"}]}

硬性规则：
1. coordinateSpace 必须逐字为 ${coordinateEdge}×${coordinateEdge} normalized。所有 x/y/width/height 都使用 0..${coordinateEdge} 的整数坐标，原点是附图左上角；附图实际尺寸为 ${width}×${height}。
2. 先在脑中把附图分成网格，再按从左到右、从上到下定位；每个 box 的中心必须落在对应对象上。
3. 至少 ${minCount} 个 nodes；目标 ${targetMin}-${targetMax} 个，不要为了凑数重复元素。
4. 只拆分已允许的 type；同一类别中的每个独立可见对象各自一个 node，不得把多个对象合成大框。
5. 单个 node 面积 < 整图 45%；禁止输出覆盖全图的大框。
6. node 只输出 id/name/type/x/y/width/height/text；type 仅限 ${allowedTypes.join('/') || '无'}。`
}

function cropElementRepairPrompt({ viewport, recognitionTypes = [], reason = 'parse' }) {
  const width = Math.max(1, Math.round(viewport.width))
  const height = Math.max(1, Math.round(viewport.height))
  const minCount = recognitionTypes.length ? 1 : cropMinSelectableCount({ width, height })
  const exampleType = recognitionTypes.includes('icon')
    ? 'icon'
    : recognitionTypes.includes('image')
      ? 'image'
      : 'text'
  const schema = `{"coordinateSpace":{"width":1000,"height":1000,"unit":"normalized"},"nodes":[{"id":"el_1","name":"附图真实名称","type":"${exampleType}","x":0,"y":0,"width":1,"height":1,"text":"附图原文"}]}`
  const coordinateRule = `coordinateSpace 固定为 1000×1000 normalized，所有元素坐标使用 0..1000 整数；附图实际尺寸为 ${width}×${height}。`
  const typeRule = `只输出已勾选类别：${recognitionTypes.join(', ') || '无'}；禁止补充其它类别。`
  if (reason === 'too-few') {
    return `上一轮错误：元素太少或把整块当成大框。请只根据附图真实像素重新拆分。
已勾选类别中的每个独立可见对象各自一个 node；name/text 必须能在附图中找到。
至少 ${minCount} 个 nodes；单个 node 面积 < 整图 45%。
${coordinateRule} ${typeRule} 坐标必须对准真实位置。
只输出 ${schema} 这种紧凑 JSON；不要 Markdown、代码围栏或 :::writing。`
  }
  if (reason === 'misaligned') {
    return `上一轮错误：name/text 或坐标与附图对不上（出现了附图没有的文案，或框没有罩住对应内容）。
请重新看附图，只输出附图里真实存在的元素；每个 box 必须紧贴该文字/人物/图标的可见边缘。
${coordinateRule} ${typeRule}
至少 ${minCount} 个 nodes。只输出 ${schema} 这种紧凑 JSON。`
  }
  return `上一轮输出无法被程序解析。请立刻重新输出合法 JSON（不要解释）。
必须包含至少 ${minCount} 个 "nodes"；禁止编造附图不存在的内容。${coordinateRule} ${typeRule}
只输出 ${schema} 这种 JSON 对象本身；不要 Markdown、代码围栏或 :::writing。`
}

function coerceCropNodeItems(items) {
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const name = String(item?.name || item?.label || `元素${index + 1}`).trim()
    const rawText = String(item?.text || item?.content || '').trim()
    let type = ['text', 'button', 'icon', 'image', 'input', 'divider'].includes(item?.type)
      ? item.type
      : rawText
        ? 'text'
        : 'image'
    // Never keep whole-crop wrappers typed as frame/rectangle.
    if (type === 'frame' || type === 'rectangle') type = rawText ? 'text' : 'image'
    const text =
      type === 'text' || type === 'button' || type === 'input' ? rawText || name : rawText
    return {
      id: String(item?.id || `el_${index + 1}`),
      parentId: '',
      name,
      type,
      x: number(item?.x),
      y: number(item?.y),
      width: Math.max(1, number(item?.width, 40)),
      height: Math.max(1, number(item?.height, 24)),
      text,
      category:
        type === 'icon'
          ? 'icon'
          : type === 'image'
            ? 'image'
            : type === 'button'
              ? 'component'
              : 'content',
      description: name,
      confidence: number(item?.confidence, 0.85),
    }
  })
}

function filterOversizedCropNodes(nodes, viewport) {
  const viewArea = Math.max(1, viewport.width * viewport.height)
  const leafTypes = new Set(['text', 'button', 'icon', 'image', 'input', 'divider'])
  return (Array.isArray(nodes) ? nodes : []).filter((node) => {
    if (!leafTypes.has(node?.type)) return false
    const nodeArea = Math.max(1, number(node.width) * number(node.height))
    // Drop “整块横幅” wrappers that cover almost the whole crop.
    if (nodeArea / viewArea > 0.45) return false
    if (number(node.width) / viewport.width > 0.92 && number(node.height) / viewport.height > 0.7) {
      return false
    }
    return true
  })
}

function buildCropDocumentFromItems(
  items,
  fallbackViewport,
  { coordinateSpace = null, reportedViewport = null } = {},
) {
  const viewport = targetViewport(fallbackViewport)
  const normalizedItems = normalizeCropElementItems(items, {
    viewport,
    coordinateSpace,
    reportedViewport,
  })
  const coerced = coerceCropNodeItems(normalizedItems)
  const projected = projectNodes(coerced, viewport, viewport)
  const nodes = filterOversizedCropNodes(projected, viewport)
  if (!nodes.length) {
    throw new Error('元素被合并成整块区域了，需要拆成多个可点选元素')
  }
  return {
    id: uid('document'),
    name: '框选区域元素',
    viewport,
    nodes,
    tokens: { colors: [], spacing: [], typography: [] },
    partial: false,
  }
}

export function parseCropElementDocument(text, fallbackViewport) {
  return parseCropElementResponse(
    text,
    ({ items, coordinateSpace, reportedViewport, partial }) => ({
      ...buildCropDocumentFromItems(items, fallbackViewport, {
        coordinateSpace,
        reportedViewport,
      }),
      partial,
    }),
  )
}

function filterCropNodesByRecognitionTypes(nodes, recognitionTypes) {
  const selected = new Set(recognitionTypes)
  const allowed = new Set([
    ...(selected.has('text') ? ['text', 'button', 'input'] : []),
    ...(selected.has('icon') ? ['icon'] : []),
    ...(selected.has('image') ? ['image'] : []),
  ])
  return (Array.isArray(nodes) ? nodes : []).filter((node) => allowed.has(node?.type))
}

/**
 * Analyze a cropped region screenshot into clickable leaf elements.
 * Uses ui_design_analysis (chat), not image generation.
 */
export async function analyzeDesignCropElements({
  cropImage,
  width,
  height,
  recognitionTypes = [],
  model = '',
  signal,
  onStage,
  onRun,
}) {
  const viewport = {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    background: '#ffffff',
  }
  const minCount = recognitionTypes.length ? 1 : cropMinSelectableCount(viewport)
  const reference = referenceDescriptor(cropImage, '框选区域截图')
  if (!reference) throw new Error('缺少框选截图，无法分析元素')
  let conversation = null
  let runId = ''
  try {
    onStage?.('preparing')
    conversation = await createAssistantConversation('框选区域元素分析', {
      workspace: 'ui_design',
    })
    onStage?.('analyzing')
    const runPass = async (prompt) =>
      executeDesignPass({
        conversationId: conversation.id,
        prompt,
        model: String(model || '').trim(),
        references: [reference],
        phase: 'draft',
        signal,
        onStage,
        onRun(value) {
          runId = value
          onRun?.(value)
        },
      })

    let best = null
    let lastError = null
    let nextPrompt = cropElementAnalysisPrompt({ viewport, recognitionTypes })
    for (let index = 0; index < 3; index += 1) {
      const content = await runPass(nextPrompt)
      try {
        const parsed = parseCropElementDocument(content, viewport)
        const document = {
          ...parsed,
          nodes: filterCropNodesByRecognitionTypes(parsed.nodes, recognitionTypes),
        }
        const count = document.nodes?.length || 0
        if (!best || count > best.nodes.length) best = document
        if (count >= minCount) break
        lastError = new Error(`只识别到 ${count} 个元素，横幅应拆成多段文字/多张插画分别点选`)
        nextPrompt = cropElementRepairPrompt({ viewport, recognitionTypes, reason: 'too-few' })
      } catch (caught) {
        lastError = caught
        const retryReason = /合并成整块|拆成多个|元素太少/.test(String(caught?.message || ''))
          ? 'too-few'
          : 'parse'
        nextPrompt = cropElementRepairPrompt({ viewport, recognitionTypes, reason: retryReason })
      }
    }
    if (!best?.nodes?.length) {
      throw (
        lastError ||
        new Error('元素分析失败：没有拆出多个可点选元素。可重新分析，或直接写提示做图片编辑。')
      )
    }
    onStage?.('complete')
    return best
  } finally {
    if (signal?.aborted && runId) await cancelAssistantRun(runId).catch(() => null)
    if (conversation?.id) {
      await deleteAssistantConversation(conversation.id, { cancelActive: true }).catch(() => null)
    }
  }
}

export function buildRegionEditInstruction({
  elements = [],
  userNote = '',
  viewport = null,
  action = 'remove',
  hasStyleReference = false,
  transparent = false,
} = {}) {
  const note = String(userNote || '').trim()
  const cutout = Boolean(transparent) || wantsRegionTransparentOutput(note, action)
  const list = (Array.isArray(elements) ? elements : [])
    .map((item, index) => {
      const name = String(item?.name || item?.type || `元素${index + 1}`).trim()
      const type = String(item?.type || 'element').trim()
      const text = String(item?.text || '').trim()
      const box =
        viewport?.width && viewport?.height
          ? `位置约 (${Math.round((Number(item.x) / viewport.width) * 100)}%, ${Math.round((Number(item.y) / viewport.height) * 100)}%)，约占 ${Math.round((Number(item.width) / viewport.width) * 100)}%×${Math.round((Number(item.height) / viewport.height) * 100)}%`
          : `像素框 (${Math.round(item.x)},${Math.round(item.y)},${Math.round(item.width)}×${Math.round(item.height)})`
      return `${index + 1}. [${type}] ${name}${text ? `「${text}」` : ''}；${box}`
    })
    .filter(Boolean)
  if (
    !list.length &&
    !note &&
    action !== 'replace-background' &&
    !(hasStyleReference && (action === 'improve-icon' || action === 'custom'))
  ) {
    return ''
  }
  const parts = [
    hasStyleReference
      ? '这是按风格参考图重绘当前框选内容：第一张是该框选自己的截图（必须保留其主体和语义），其后是风格参考（只学画法，不抄主体）。'
      : '这是图片编辑（image edit / inpainting），不是文生图。必须以第一张参考图（框选截图）为底图做最小改动。',
  ]
  if (action === 'remove' && list.length) {
    parts.push('请移除下列已点选元素，并用周围连续背景自然填补，不要留下灰块/白块/空洞：')
    parts.push(list.join('\n'))
    parts.push(
      '移除后必须保留原来的空间占位，不得让相邻文字、图标、按钮或插画自动补位、居中、缩放或重新排列。只允许修改上述 bounding box 及其边缘少量过渡像素；所有框外像素视为锁定区。',
    )
    parts.push(
      '必须输出与第一张参考图相同的完整画面、画布边界和宽高比；禁止裁切、扩图、重新构图、改变留白或生成另一版布局。',
    )
  } else if (action === 'improve-icon' && (list.length || hasStyleReference)) {
    if (list.length) {
      parts.push(
        hasStyleReference
          ? '请只重绘下列已点选图标：保留各自原有语义、符号和识别特征，按风格参考图统一材质、光影、体积感和配色方法，不得把它们画成同一枚图标：'
          : '请只重绘下列已点选图标：保持原语义、尺寸、中心位置和点击热区，替换为更精致、统一、清晰的现代图标，不得移动其它元素：',
      )
      parts.push(list.join('\n'))
    } else {
      parts.push(
        '请按风格参考图重绘当前框选图标：保留该框选自己的语义、符号和识别特征，只统一材质、光影、体积感和配色方法。',
      )
    }
    parts.push(
      cutout
        ? hasStyleReference
          ? '禁止复制风格参考图的主体或符号；禁止输出与其它框选相同的结果。只输出当前框选自己的图标主体，必须是真透明 PNG，禁止白底、棋盘格或任何背景像素。'
          : '只输出当前框选的图标主体，必须是真透明 PNG；禁止白底、棋盘格、假透明图案，禁止把完整画面背景留在画布上。'
        : hasStyleReference
          ? '禁止复制风格参考图的主体或符号；禁止输出与其它框选相同的结果。必须输出与当前框选截图相同的完整画面和背景，禁止只输出参考图本身。'
          : '必须输出与第一张参考图相同的完整画面和背景；禁止只输出图标、禁止抠图、禁止透明画布、禁止裁切或改变画布比例。',
    )
  } else if (action === 'replace-background') {
    if (list.length) {
      parts.push('请只替换下列已点选图片或背景区域，保持前景文字、图标和控件原样：')
      parts.push(list.join('\n'))
    } else {
      parts.push('请只重新设计当前框选区域的背景，保持其中全部前景文字、图标和控件原样。')
    }
    parts.push('新背景应更有层次并符合原页面风格；禁止纯白背景、白色矩形和无内容占位块。')
  } else if (action === 'custom' && (list.length || hasStyleReference)) {
    if (list.length) {
      parts.push('只对下列已点选元素执行用户补充要求：')
      parts.push(list.join('\n'))
    } else if (hasStyleReference) {
      parts.push('请按风格参考图重绘当前框选内容：保留该框选自己的主体和语义，只统一画法。')
    }
  }
  if (note) parts.push(`补充要求：${note}`)
  parts.push(
    hasStyleReference
      ? '每个框选必须输出该框选自己的内容；风格向参考图看齐，禁止抄参考图主体，禁止多框出成同一张图。'
      : '未点选的内容必须保持原样（构图、颜色、材质、光影、其余文字与图标）。',
  )
  return parts.join('\n')
}

export function buildRegionRemovalInstruction(options = {}) {
  return buildRegionEditInstruction({ ...options, action: 'remove' })
}

function regionImagePrompt({
  region,
  transparent,
  generationMode,
  userInstruction = '',
  preserveLayout = false,
  hasDesignReference = false,
  designReferenceIsFirstOutput = false,
  styleReferenceCount = 0,
}) {
  const isReplacement = generationMode === 'replace'
  const instruction = String(userInstruction || '').trim()
  const cutout = Boolean(transparent) || wantsRegionTransparentOutput(instruction)
  const aspectW = Math.max(1, Math.round(region.width))
  const aspectH = Math.max(1, Math.round(region.height))
  const outputRatio = String(region.outputRatio || `${aspectW}:${aspectH}`)
  const hasStyleReference = styleReferenceCount > 0
  const followStyleOnly = hasStyleReference || designReferenceIsFirstOutput
  const localEditBlock = instruction
    ? `
用户图片编辑要求：
${instruction}

图片编辑规则（最高优先级）：
- 这是对已有截图的编辑，不是从零文生图；禁止重新设计整张海报。
- ${
    followStyleOnly
      ? '第一张框选截图决定“画什么”（主体、符号、识别特征）；风格参考只决定“怎么画”（材质、光影、体积、描边、配色方法）。禁止把风格参考的主体复制过来。'
      : '只改用户点名要改/移除的部分；其余像素尽量与第一张框选截图一致。'
  }
- ${
    cutout
      ? '用户已要求去背：只保留主体轮廓和透明留白，不要保留原画面背景。'
      : preserveLayout
        ? '布局已锁定：未点选区域的绝对坐标、尺寸、间距、留白和层级必须逐像素保持；删除后不得触发布局回流。'
        : '保持第一张框选截图的页面结构和视觉层级。'
  }
- ${
    cutout
      ? '禁止把白底、浅灰底、棋盘格或任何背景画进像素；透明必须是真实 alpha 通道。'
      : '移除文字/控件后，必须用周围背景渐变与纹理自然补齐，禁止灰色/白色矩形占位。'
  }
- ${cutout ? '所有框选都必须输出真透明 PNG，禁止只对第一张去背。' : '禁止擅自去背，除非用户明确要求抠图/透明背景。'}
`
    : ''
  const designReferenceLine = hasStyleReference
    ? `其后 ${styleReferenceCount} 张是用户风格参考图：只学画法，不抄主体；每个框选必须输出与该框选截图对应的不同内容，禁止多框出成同一张图。`
    : designReferenceIsFirstOutput
      ? cutout
        ? '第二张是第一张出图的风格参考（已铺中性底便于看清主体，底色不是风格）：只学材质、光影、体积和配色方法；必须保留当前框选自己的主体；输出必须是真透明 PNG，禁止把中性底、棋盘格或任何背景画进像素，禁止把第一张出图的图标复制过来，禁止多框出成同一张图。'
        : '第二张是第一张出图，仅作风格参考：只学材质、光影、体积和配色方法；必须保留当前框选自己的主体，禁止把第一张出图的图标复制过来，禁止多框出成同一张图。'
      : hasDesignReference
        ? '第二张若存在则为完整设计稿，仅作风格上下文。'
        : preserveLayout && !cutout
          ? '本任务已启用布局锁定，不使用整页参考，禁止重新推断或重排布局。'
          : '第二张若存在则为完整设计稿，仅作风格上下文。'
  const prompt = `这是 UI 局部图片编辑任务。第一张参考图是用户当前框选截图（编辑底图，必须保留其主体）；${designReferenceLine}

目标名称：${region.name}
目标类型：${region.type}
目标说明：${region.description || region.name}
目标像素约：${aspectW}×${aspectH}
${localEditBlock}
要求：
1. 只输出与当前框选截图同一块区域，不生成完整页面、浏览器窗口、标注框或样机。
2. ${
    followStyleOnly
      ? '按风格参考重绘当前框选自己的主体；禁止输出风格参考里的图标，禁止和其他框选输出同一张图。'
      : instruction
        ? '以第一张框选截图为底执行图片编辑；未要求改动的区域保持原构图、颜色、材质、光影与边缘细节。'
        : isReplacement
          ? '允许替换素材主体创意，但必须保持原区域宽高比、视觉重量与可放回界面的占位关系。'
          : '执行严格还原：保持主体身份、造型、构图、比例、颜色、材质与光影。'
  }
3. ${
    cutout
      ? '用户已要求抠图：只保留目标主体和必要透明留白，禁止白底、棋盘格或假透明。'
      : instruction
        ? '保留第一张框选截图的完整画布、背景与渐变连续性；不要自动去背，不得只输出被编辑元素，不要改成大面积纯色填充。'
        : '保留与素材协调的完整背景。'
  }
4. 输出清晰锐利；输出比例必须与框选区域实际比例 ${outputRatio} 完全一致。`
  return cutout ? withTransparentPngInstruction(prompt, true) : prompt
}

async function settleDesignRegionImageRun({
  runId,
  conversationId = '',
  signal,
  onStage,
  onImage,
}) {
  const stream = openAssistantRunStream(runId, {
    onEvent(event) {
      if (event?.stage) onStage?.(event.stage)
      if (event?.image?.dataUrl) onImage?.(event.image)
    },
  })
  try {
    const completed = await waitForAssistantRun(runId, {
      signal,
      intervalMs: 900,
      onUpdate(data) {
        if (data?.run?.stage) onStage?.(data.run.stage)
        const images = Array.isArray(data?.assistantMessage?.images)
          ? data.assistantMessage.images
          : []
        if (images.length) onImage?.(images[0])
      },
    })
    if (completed?.run?.status !== 'succeeded') {
      throw new Error(completed?.run?.errorMessage || 'PNG 素材重建失败')
    }
    const images = Array.isArray(completed?.assistantMessage?.images)
      ? completed.assistantMessage.images
      : []
    if (!images[0]?.dataUrl) throw new Error('生图模型没有返回 PNG 素材')
    onStage?.('complete')
    return {
      ...images[0],
      conversationId,
      runId,
    }
  } finally {
    stream?.close()
  }
}

export async function generateDesignRegionImage({
  referenceImage,
  regionReferenceDataUrl,
  region,
  transparent = true,
  generationMode = 'strict',
  userInstruction = '',
  requestSize = 'auto',
  resolution = '',
  quality = 'high',
  preserveLayout = false,
  retainConversation = true,
  designReferenceImage = '',
  designReferenceName = '',
  styleReferences = [],
  conversationId: resumeConversationId = '',
  runId: resumeRunId = '',
  parentOutputUrl = '',
  signal,
  onStage,
  onRun,
  onImage,
  onConversation,
}) {
  const resumedConversationId = String(resumeConversationId || '').trim()
  const resumedRunId = String(resumeRunId || '').trim()
  let conversation = resumedConversationId ? { id: resumedConversationId } : null
  let runId = resumedRunId
  let createdThisCall = false
  try {
    onStage?.('preparing')
    if (runId) {
      onConversation?.(conversation?.id || '')
      onRun?.(runId)
      onStage?.('generating-image')
      return await settleDesignRegionImageRun({
        runId,
        conversationId: conversation?.id || '',
        signal,
        onStage,
        onImage,
      })
    }
    if (!conversation) {
      conversation = await createAssistantConversation(`图片编辑 · ${region.name}`, {
        workspace: 'ui_design',
      })
    }
    onConversation?.(conversation.id)
    // Crop first so upstream EditImages treats the selection as the primary canvas.
    const regionReference = referenceDescriptor(regionReferenceDataUrl, '框选截图（编辑底图）')
    const designSource = String(designReferenceImage || '').trim()
    const designReference = designSource
      ? referenceDescriptor(
          designSource,
          designReferenceName || '完整设计稿（风格上下文）',
        )
      : preserveLayout
        ? null
        : referenceDescriptor(referenceImage, '完整设计稿（风格上下文）')
    const extraReferences = (Array.isArray(styleReferences) ? styleReferences : [])
      .map((item, index) => {
        const url = typeof item === 'string' ? item : item?.dataUrl || item?.url || ''
        return referenceDescriptor(url, item?.name || `用户参考图 ${index + 1}`)
      })
      .filter(Boolean)
    const references = [regionReference, designReference, ...extraReferences].filter(Boolean)
    if (!references.length) throw new Error('缺少设计图参考，无法进行图片编辑')
    const safeRequestSize = resolveRegionImageRequestSize(requestSize, resolution)
    const created = await createAssistantRun(
      {
        conversationId: conversation.id,
        prompt: regionImagePrompt({
          region,
          transparent,
          generationMode,
          userInstruction,
          preserveLayout,
          hasDesignReference: Boolean(designReference),
          designReferenceIsFirstOutput: /第一张出图/.test(
            String(designReference?.name || designReferenceName || ''),
          ),
          styleReferenceCount: extraReferences.length,
        }),
        mode: 'image',
        clientUserMessageId: uid('user'),
        clientAssistantMessageId: uid('assistant'),
        referenceImages: references,
        count: 1,
        requestSize: safeRequestSize,
        ...(resolution ? { resolution } : {}),
        quality,
        serviceKey: 'ui_design_asset',
        ...(String(parentOutputUrl || '').trim()
          ? { parentOutputUrl: String(parentOutputUrl).trim() }
          : {}),
      },
      { signal },
    )
    runId = created.run?.id || ''
    createdThisCall = Boolean(runId)
    onRun?.(runId)
    onStage?.('generating-image')
    return await settleDesignRegionImageRun({
      runId,
      conversationId: conversation.id,
      signal,
      onStage,
      onImage,
    })
  } finally {
    if (signal?.aborted && runId && createdThisCall) {
      await cancelAssistantRun(runId).catch(() => null)
    }
    if (conversation?.id && !retainConversation) {
      await deleteAssistantConversation(conversation.id, { cancelActive: true }).catch(() => null)
    }
  }
}

function assetDescriptionPrompt({ region, transparent, format, generationMode }) {
  return `你是设计系统的素材编目工程师。附图是已经生成并等待用户确认的独立 UI 素材，请只描述附图本身，不要描述聊天界面或原始页面。

素材名称：${region.name}
原始功能：${region.description || region.name}
格式：${String(format || 'png').toUpperCase()}
背景：${transparent ? '透明或应透明' : '包含背景'}
生成策略：${generationMode === 'replace' ? '创意替换' : '严格还原'}

用 2-4 句中文给出可编辑的素材描述，必须包含主体/形状、主色与辅助色、材质或描边、光影、透明背景状态和适用的 UI 角色。不要输出 Markdown、标题、评分或生成建议。`
}

export async function generateDesignAssetDescription({
  assetImage,
  region,
  transparent = false,
  format = 'png',
  generationMode = 'strict',
  signal,
  onStage,
  onRun,
}) {
  let conversation = null
  let runId = ''
  try {
    onStage?.('preparing')
    conversation = await createAssistantConversation(`描述素材 · ${region.name}`, {
      workspace: 'ui_design',
    })
    const reference = referenceDescriptor(assetImage, `待确认素材 · ${region.name}`)
    if (!reference) throw new Error('缺少待描述素材')
    const content = await executeDesignPass({
      conversationId: conversation.id,
      prompt: assetDescriptionPrompt({ region, transparent, format, generationMode }),
      references: [reference],
      phase: 'draft',
      signal,
      onStage,
      onRun(value) {
        runId = value
        onRun?.(value)
      },
    })
    onStage?.('complete')
    return unwrapCodeBlock(content).trim()
  } finally {
    if (signal?.aborted && runId) await cancelAssistantRun(runId).catch(() => null)
    if (conversation?.id) {
      await deleteAssistantConversation(conversation.id, { cancelActive: true }).catch(() => null)
    }
  }
}

function websiteRestorationPrompt({ name, viewport, nodes, assets }) {
  const compactNodes = nodes.map((node) => ({
    id: node.id,
    parentId: node.parentId || '',
    name: node.name,
    type: node.type,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: Math.round(node.width),
    height: Math.round(node.height),
    text: node.text || '',
    description: node.description || '',
    confirmed: Boolean(node.selectionConfirmed),
    approvedAssetId: node.approvedAssetId || '',
  }))
  let referenceNumber = 1
  const compactAssets = assets
    .filter((asset) => asset.format === 'png')
    .map((asset) => {
      referenceNumber += 1
      return {
        id: asset.id,
        sourceRegionId: asset.sourceRegionId,
        name: asset.name,
        format: asset.format,
        url: asset.url || '',
        description: asset.description || '',
        naturalBounds: asset.naturalBounds,
        referenceNumber,
      }
    })
  return `你是资深 Figma 转前端工程师。第一张参考图是要还原的完整 UI 设计稿；后续参考图是用户逐个确认过的 PNG 素材。请结合精确图层坐标和已确认素材，生成一份可直接运行的完整 HTML 文档。

设计稿名称：${name}
原始画布：${viewport.width}×${viewport.height}
精确图层：${JSON.stringify(compactNodes)}
已确认素材：${JSON.stringify(compactAssets)}

要求：
1. 还原整张设计稿的 DOM 层级、布局、尺寸、间距、颜色、圆角、边框、阴影和文字层级；默认视口下与参考图一致，同时提供合理的窄屏响应。
2. 不得把第一张完整设计稿作为 img、背景图、canvas 像素或任何截图覆盖层；页面必须由真实 HTML/CSS 和已确认素材构成。
3. approvedAssetId 对应的 PNG 素材必须放入该图层，使用素材记录中的 url，禁止用占位图替换已经确认的素材。
4. referenceNumber 表示该 PNG 在参考图列表中的序号，仅用于理解视觉，不要写进页面。
5. confirmed=true 的坐标是用户校准后的原图像素，优先级高于视觉估算；其他坐标是 AI 候选，需结合完整参考图校准。
6. 图标如无已确认素材，可使用 CSS 或 Bootstrap Icons；不得生成 base64 假素材。交互控件需要有自然 hover/focus/active 状态。
7. 只返回从 <!doctype html> 开始的单个完整 HTML 文档，CSS 和必要脚本内联，不要 Markdown 或解释。`
}

export async function generateDesignWebsite({
  name,
  referenceImage,
  viewport,
  nodes,
  assets,
  signal,
  onStage,
  onRun,
  onStream,
}) {
  let conversation = null
  let runId = ''
  try {
    onStage?.('preparing')
    conversation = await createAssistantConversation(`还原网站 · ${name}`, {
      workspace: 'ui_design',
    })
    const references = [referenceDescriptor(referenceImage, '完整 UI 设计稿')]
    assets
      .filter((asset) => asset.format === 'png' && asset.url)
      .forEach((asset) => {
        references.push(referenceDescriptor(asset.url, `已确认素材 · ${asset.name}`))
      })
    const content = await executeDesignPass({
      conversationId: conversation.id,
      prompt: websiteRestorationPrompt({ name, viewport, nodes, assets }),
      references: references.filter(Boolean),
      phase: 'draft',
      signal,
      onStage,
      onRun(value) {
        runId = value
        onRun?.(value)
      },
      onStream(value) {
        onStream?.(unwrapCodeBlock(value))
      },
    })
    onStage?.('complete')
    return unwrapCodeBlock(content)
  } finally {
    if (signal?.aborted && runId) await cancelAssistantRun(runId).catch(() => null)
    if (conversation?.id) {
      await deleteAssistantConversation(conversation.id, { cancelActive: true }).catch(() => null)
    }
  }
}
