// 视觉上下文推断：判断提示词是否指向“最近的图片”，
// 并在用户没有显式附图时，自动把最近一轮的图片带入本次请求。
// 意图路由本身由服务端完成（mode=agent），这里不做 chat/image 分类。

export function promptNeedsRecentVisual(prompt) {
  const text = String(prompt || '')
    .trim()
    .toLowerCase()
  if (!text) return false
  const previousVisualCue =
    /(这张|这幅|这个图|该图|那张|上图|上一张|前一张|最后一张|刚才.{0,8}(图|图片|画面)|之前.{0,8}(图|图片|画面)|参考图\s*[一二三四五六七八九1-9]|图\s*[1-9]|第[一二三四五六七八九1-9]张|图中|图片中|照片中|截图中|画面中|它|其中|上述)/i
  if (previousVisualCue.test(text)) return true

  const freshImageRequest =
    /(生成|创建|制作|绘制|画|设计|做|来|给我).{0,14}([1-4一二两三四]\s*)?(张|幅)?\s*(新)?(图|图片|图像|海报|插画|头像|壁纸|封面|logo)/i
  if (freshImageRequest.test(text)) return false

  return /(?:(识别|读取|提取|ocr|描述|分析|总结|翻译|解释|修改|编辑|重绘|替换|换成|改成|变成|风格化|美化|换背景|去背景|抠图|擦除|移除|删除|添加|修复|扩图|裁剪|上色).{0,12}(图|图片|图像|照片|截图|画面|文字|背景|人物|主体|颜色|构图|风格)|(图|图片|图像|照片|截图|画面|文字|背景|人物|主体|颜色|构图|风格).{0,12}(识别|读取|提取|ocr|描述|分析|总结|翻译|解释|修改|编辑|重绘|替换|换成|改成|变成|风格化|美化|换背景|去背景|抠图|擦除|移除|删除|添加|修复|扩图|裁剪|上色))/i.test(
    text,
  )
}

export function resolveVisualContext(conversation, prompt, maxImages = 16) {
  const limit = Math.min(16, Math.max(0, Number(maxImages) || 0));
  if (limit <= 0) return [];
  const latestUserMessage = [...conversation.messages]
    .reverse()
    .find((message) => message.role === 'user')
  const currentImages = (latestUserMessage?.referenceImages || []).filter((image) => image?.dataUrl)
  if (currentImages.length) return currentImages.slice(0, limit)
  if (!promptNeedsRecentVisual(prompt)) return []

  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index]
    if (message.id === latestUserMessage?.id) continue
    const images = [...(message.images || []), ...(message.referenceImages || [])].filter(
      (image) => image?.dataUrl,
    )
    if (images.length) return images.slice(0, limit)
  }
  return []
}
