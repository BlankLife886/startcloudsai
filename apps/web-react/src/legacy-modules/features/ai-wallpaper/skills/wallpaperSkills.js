import preserve4kUpscalePrompt from './preserve-4k-upscale/SKILL.md?raw'

/** Built-in skills use UI metadata plus either a client or server prompt contract. */
export const BUILTIN_WALLPAPER_SKILLS = [
  {
    id: 'solid-background-for-removal',
    name: '纯色抠图背景',
    icon: 'bi-square-fill',
    description: '为自动抠图生成边缘清晰的纯色背景',
    prompt:
      'Force the generated image to use one completely flat, uniform, opaque solid-color background chosen for strong contrast with the main subject. The solid color must fill the entire canvas edge to edge. Keep the subject fully visible with a clean, crisp silhouette and clear separation from the background. Do not generate scenery, environmental objects, gradients, textures, patterns, bokeh, atmospheric effects, horizon lines, floor-wall seams, background shadows, reflections, transparent backgrounds, or colors near the subject edges that blend into the subject.',
    builtin: true,
  },
  {
    id: 'female-portrait-director',
    name: '人像导演',
    icon: 'bi-person-bounding-box',
    description: '智能编排成年女性人像的造型、镜头、光线与场景',
    serverManaged: true,
    builtin: true,
  },
  {
    id: 'prompt-architect',
    name: 'Prompt Architect',
    icon: 'bi-vector-pen',
    description: '拆解主体、镜头、光线和负面约束',
    prompt:
      'Structure the image request into subject, scene, composition, lighting, materials, style, and explicit avoid constraints without changing the user intent.',
  },
  {
    id: 'style-director',
    name: 'Style Director',
    icon: 'bi-palette2',
    description: '统一画风、材质和色彩倾向',
    prompt:
      'Keep the requested visual style coherent across composition, materials, color palette, lighting, and camera language.',
  },
  {
    id: 'composition-guard',
    name: 'Composition Guard',
    icon: 'bi-bounding-box',
    description: '控制构图稳定、主体不变形',
    prompt:
      'Preserve the requested subject count, pose, framing, spatial relationships, and aspect-ratio composition; avoid distortions and accidental additions.',
  },
  {
    id: 'detail-qa',
    name: 'Detail QA',
    icon: 'bi-stars',
    description: '强化高清细节与瑕疵规避',
    prompt:
      'Prefer clean, physically plausible details and reject blur, noise, broken anatomy, malformed objects, unwanted text, and watermarks.',
  },
  {
    id: 'clean-hd-render',
    name: '高清净化',
    icon: 'bi-badge-hd',
    description: '放大保持清晰，抑制脏点、糊边和伪细节',
    prompt:
      'Create a clean high-fidelity image that remains clear when viewed large. Preserve the user requested style and intentional texture, while prioritizing coherent macro and micro details, naturally crisp edges, clean gradients, controlled surface texture, accurate material boundaries, and low-noise shadows. Avoid blur, smearing, muddy colors, unintended dirty or grimy texture, oversharpening halos, JPEG artifacts, color banding, chromatic noise, duplicated details, random micro-text, signatures, logos, and watermarks. Do not remove dirt, grain, text, or rough texture when the user explicitly requests it.',
  },
  {
    id: 'motion-planner',
    name: 'Motion Planner',
    icon: 'bi-camera-reels',
    description: '为视频生成规划镜头运动',
    prompt:
      'For video requests, define restrained camera movement, subject motion, timing, and continuity while keeping the scene readable.',
  },
  {
    id: 'preserve-4k-upscale',
    name: 'Preserve 4K Upscale',
    icon: 'bi-badge-4k',
    description: '仅提升分辨率，保护文字、Logo 与商品细节',
    prompt: preserve4kUpscalePrompt,
    builtin: true,
    featureGate: 'superResolution',
  },
]

export function normalizeCustomWallpaperSkill(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const id = String(value.id || '').trim()
  const name = String(value.name || value.label || '').trim()
  const prompt = String(value.prompt || value.instructions || '').trim()
  if (!id || !name || !prompt) return null
  return {
    id,
    name: name.slice(0, 80),
    icon: String(value.icon || 'bi-lightning-charge').trim(),
    description: String(value.description || '用户自定义 Skill').slice(0, 180),
    prompt: prompt.slice(0, 12000),
    custom: true,
    builtin: false,
  }
}

export function normalizeCustomWallpaperSkills(value, max = 20) {
  if (!Array.isArray(value)) return []
  const seen = new Set(BUILTIN_WALLPAPER_SKILLS.map((skill) => skill.id))
  const result = []
  for (const item of value) {
    const skill = normalizeCustomWallpaperSkill(item)
    if (!skill || seen.has(skill.id)) continue
    seen.add(skill.id)
    result.push(skill)
    if (result.length >= max) break
  }
  return result
}

export function resolveActiveWallpaperSkills({
  outputType = 'image',
  resolutionScale = '2K',
  superResolutionEnabled = true,
  selectedSkillIds = [],
  customSkills = [],
} = {}) {
  const selected = new Set(Array.isArray(selectedSkillIds) ? selectedSkillIds : [])
  const all = [...BUILTIN_WALLPAPER_SKILLS, ...normalizeCustomWallpaperSkills(customSkills)]
  return all.filter((skill) => {
    if (!selected.has(skill.id)) return false
    if (skill.featureGate === 'superResolution') {
      return (
        outputType === 'image' &&
        superResolutionEnabled &&
        ['2K', '4K', '8K'].includes(String(resolutionScale || '').toUpperCase())
      )
    }
    return true
  })
}

export function buildWallpaperSkillPrompt(skills = []) {
  const prompts = skills
    .filter((skill) => skill?.serverManaged !== true)
    .map((skill) => String(skill?.prompt || '').trim())
    .filter(Boolean)
  if (!prompts.length) return ''
  return [
    'Active image-generation Skills. Follow them as execution instructions; do not render them as visible text:',
    ...prompts.map((prompt, index) => `\n[Skill ${index + 1}]\n${prompt}`),
  ].join('\n')
}
