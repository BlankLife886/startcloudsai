import preserve4kUpscalePrompt from './preserve-4k-upscale/SKILL.md?raw'

/** Built-in skills are metadata plus an explicit prompt contract. */
export const BUILTIN_WALLPAPER_SKILLS = [
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
      return outputType === 'image' && superResolutionEnabled && resolutionScale !== '1K'
    }
    return true
  })
}

export function buildWallpaperSkillPrompt(skills = []) {
  const prompts = skills
    .map((skill) => String(skill?.prompt || '').trim())
    .filter(Boolean)
  if (!prompts.length) return ''
  return [
    'Active image-generation Skills. Follow them as execution instructions; do not render them as visible text:',
    ...prompts.map((prompt, index) => `\n[Skill ${index + 1}]\n${prompt}`),
  ].join('\n')
}
