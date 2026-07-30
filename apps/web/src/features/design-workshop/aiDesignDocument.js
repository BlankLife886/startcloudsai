import {
  cancelAssistantRun,
  createAssistantConversation,
  createAssistantRun,
  deleteAssistantConversation,
  listActiveAssistantRuns,
  openAssistantRunStream,
  waitForAssistantRun,
} from '@/services/assistantApi'
import { withTransparentPngInstruction } from '@/features/ai-shared/transparentPng'

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
  const nodes = projectNodes(
    Array.isArray(parsed?.nodes) ? parsed.nodes : [],
    reportedViewport,
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

function referenceDescriptor(source, name = '当前 UI 设计成稿') {
  const value = String(source || '').trim()
  if (!value) return null
  const url = new URL(value, window.location.origin)
  const marker = '/api/files/'
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
8. 必须逐层扫描所有非文字视觉层：页面背景、区域容器、卡片、媒体框、按钮、输入框、选择器、标签、徽章、开关、单选/复选控件、图标、头像、Logo、插画、照片、图表、进度条、滚动条、边框、分割线和有明确边界的装饰形状。即使尺寸很小也不能遗漏。
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
9. 逐个审计按钮内部图标、下拉箭头、开关滑块、单选/复选标记、徽章、Logo 子形状、进度条、分割线、边框与装饰形状。这些叶子层必须拥有独立节点和正确 parentId，不能因为已有父容器而省略。
10. 节点数量由原稿复杂度决定，不得为了缩短响应而合并不同视觉层或停止扫描。
11. 每个区域都要填写 category、description 和 confidence；category 只允许 layout、component、content、icon、image。
12. 保持紧凑定位协议：每个 node 只输出 id、name、type、parentId、x、y、width、height、text、category、description、confidence；tokens 返回三个空数组；禁止输出任何样式字段或美化缩进。

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
      clientUserMessageId: uid('user'),
      clientAssistantMessageId: uid('assistant'),
      referenceImages: references,
      count: 1,
      quality: 'high',
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
      )
      onSession?.({ conversationId: conversation.id, runId: '', phase: 'draft' })
    }
    const reference = referenceDescriptor(referenceImage)
    const references = reference ? [reference] : []
    let finalContent = ''

    if (resumedConversationId) {
      const activeRuns = await listActiveAssistantRuns({ signal }).catch(() => [])
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
      onSession?.({ conversationId: conversation.id, runId, phase, draftContent })
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
        references,
        phase,
        signal,
        onStage,
        onRun(value) {
          runId = value
          onRun?.(value)
          onSession?.({ conversationId: conversation.id, runId, phase: 'draft' })
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
      if (finalDocument.partial && finalContent !== draftContent) {
        try {
          return mergePartialDesignDocument(
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
    value
      .match(/```(?:vue|html|css|javascript|typescript|svg|xml)?\s*([\s\S]*?)```/i)?.[1]
      ?.trim() || value
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
    conversation = await createAssistantConversation(`提取组件 · ${region.name}`)
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

function regionSvgPrompt({ viewport, region }) {
  return `你是专业 UI 图标与矢量资产设计师。第一张参考图是完整 UI 设计稿，第二张参考图只是目标区域的定位预览。请把指定区域重建为真正的可编辑 SVG，而不是把截图嵌入 SVG。

整张原图尺寸：${viewport.width}×${viewport.height}
目标区域：x=${Math.round(region.x)}, y=${Math.round(region.y)}, width=${Math.round(region.width)}, height=${Math.round(region.height)}
区域名称：${region.name}
区域类型：${region.type}
区域说明：${region.description || region.name}

要求：
1. 根元素必须是 <svg>，viewBox 使用 "0 0 ${Math.round(region.width)} ${Math.round(region.height)}"。
2. 只使用 path、rect、circle、ellipse、line、polyline、polygon、g、defs、linearGradient、radialGradient、stop 等原生矢量元素。
3. 禁止使用 image、foreignObject、script、base64、blob URL、外部链接或任何位图嵌入。
4. 保持目标区域的形状、比例、描边、颜色、圆角和层级；周围页面背景不属于目标时不得画入。
5. 文本如果是图标不可分割的一部分，可转换为 path；否则不要猜造文字轮廓。
6. 输出完整 SVG 源码，不要解释、Markdown 标题或使用说明。`
}

export async function generateDesignRegionSvg({
  referenceImage,
  regionReferenceDataUrl,
  viewport,
  region,
  signal,
  onStage,
  onRun,
  onStream,
}) {
  let conversation = null
  let runId = ''
  try {
    onStage?.('preparing')
    conversation = await createAssistantConversation(`重建 SVG · ${region.name}`)
    const references = [
      referenceDescriptor(referenceImage),
      referenceDescriptor(regionReferenceDataUrl),
    ].filter(Boolean)
    if (!references.length) throw new Error('缺少设计图参考，无法重建 SVG')
    const content = await executeDesignPass({
      conversationId: conversation.id,
      prompt: regionSvgPrompt({ viewport, region }),
      references,
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

function regionImagePrompt({ region, transparent, generationMode }) {
  const isReplacement = generationMode === 'replace'
  const prompt = `根据两张参考图重建一个独立 UI 素材。第一张是完整设计稿，第二张是用户选中的目标区域，仅用于视觉参考，不得直接裁切或照搬截图背景。

目标名称：${region.name}
目标类型：${region.type}
目标说明：${region.description || region.name}

要求：
1. 只重建目标素材本身，不生成完整页面、浏览器窗口、设计软件界面、标注框、文字说明或样机。
2. ${
    isReplacement
      ? '允许替换素材的主体创意，但必须保持原区域的宽高比、视觉重量、构图层级、留白方式、品牌色关系和在界面中的功能角色，替换后能直接放回原位置。'
      : '执行严格还原：保持目标的主体身份、造型、构图、比例、颜色、材质、光影、边缘细节与当前整张设计稿的视觉语言，不做风格改写或创意替换。'
  }
3. 不保留原设计稿周围的卡片、按钮容器或页面背景，除非它们本身就是目标素材的一部分。
4. 这是 AI 重建任务，不是截图裁切或放大任务。
5. 输出构图的宽高比必须与目标区域 ${Math.round(region.width)}:${Math.round(region.height)} 保持一致，主体不能被裁断，也不能增加改变占位尺寸的大面积留白。
6. ${
    transparent
      ? '只保留目标素材本身和必要的透明留白，不保留原设计稿的底色或周边内容。'
      : '使用与目标素材协调的干净背景，并保证素材主体完整。'
  }`
  return withTransparentPngInstruction(prompt, transparent)
}

export async function generateDesignRegionImage({
  referenceImage,
  regionReferenceDataUrl,
  region,
  transparent = true,
  generationMode = 'strict',
  requestSize = 'auto',
  signal,
  onStage,
  onRun,
  onImage,
}) {
  let conversation = null
  let runId = ''
  let stream = null
  try {
    onStage?.('preparing')
    conversation = await createAssistantConversation(`重建素材 · ${region.name}`)
    const fullReference = referenceDescriptor(referenceImage)
    const regionReference = referenceDescriptor(regionReferenceDataUrl)
    const references = [fullReference, regionReference].filter(Boolean)
    if (!references.length) throw new Error('缺少设计图参考，无法重建素材')
    const created = await createAssistantRun(
      {
        conversationId: conversation.id,
        prompt: regionImagePrompt({ region, transparent, generationMode }),
        mode: 'image',
        clientUserMessageId: uid('user'),
        clientAssistantMessageId: uid('assistant'),
        referenceImages: references,
        count: 1,
        requestSize,
        quality: 'high',
        serviceKey: 'ui_design_asset',
      },
      { signal },
    )
    runId = created.run?.id || ''
    onRun?.(runId)
    onStage?.('generating-image')
    stream = openAssistantRunStream(runId, {
      onEvent(event) {
        if (event?.stage) onStage?.(event.stage)
        if (event?.image?.dataUrl) onImage?.(event.image)
      },
    })
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
    return images[0]
  } finally {
    stream?.close()
    if (signal?.aborted && runId) await cancelAssistantRun(runId).catch(() => null)
    if (conversation?.id) {
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
    conversation = await createAssistantConversation(`描述素材 · ${region.name}`)
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
  const compactAssets = assets.map((asset) => {
    if (asset.format === 'png') referenceNumber += 1
    return {
      id: asset.id,
      sourceRegionId: asset.sourceRegionId,
      name: asset.name,
      format: asset.format,
      url: asset.url || '',
      svgSource: asset.svgSource || '',
      description: asset.description || '',
      naturalBounds: asset.naturalBounds,
      referenceNumber: asset.format === 'png' ? referenceNumber : null,
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
3. approvedAssetId 对应的素材必须放入该图层。PNG 使用素材记录中的 url；SVG 使用 svgSource 原样内联，禁止用占位图替换已经确认的素材。
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
    conversation = await createAssistantConversation(`还原网站 · ${name}`)
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
