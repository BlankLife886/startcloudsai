/** 壁纸工坊静态配置：右栏 Tab / Skills / MCP / 灵感提示 */

import { normalizeGptImageOutputSize } from '@/services/aiImageOutputSize'
import { BUILTIN_WALLPAPER_SKILLS } from '../skills/wallpaperSkills.js'

export const WALLPAPER_INSPECTOR_TABS = [
  { id: 'params', label: '参数', icon: 'bi-sliders2' },
  { id: 'model', label: '模型', icon: 'bi-stars' },
  { id: 'advanced', label: '高级', icon: 'bi-diagram-3' },
]

export const WALLPAPER_PROMPT_PRESETS = [
  '电影感光影',
  '极简干净',
  '动漫场景',
  '赛博霓虹',
  '自然风景',
  '梦幻柔光',
]

export const WALLPAPER_INSPIRATION_PROMPTS = [
  '雨夜东京街角，霓虹灯倒映在湿润柏油路上，电影镜头，细腻光影，适合作为桌面壁纸',
  '巨大月亮悬在安静海面上，远处灯塔发出暖光，蓝色夜景，极简留白，高级感',
  '漂浮在云层中的未来图书馆，玻璃结构，柔和日光，空间宏大，超清壁纸',
  '春日山谷里的木屋和溪流，微风吹动花海，清透自然光，干净治愈',
  '白色机甲站在雪原边缘，远处极光流动，科幻但克制，构图稳定',
  '复古胶片风室内工作台，窗外下雪，暖色台灯，安静、有质感、细节丰富',
]

/** 文生图页：比例 / 分辨率 / 质量 / 提示词库 */
export const T2I_ASPECT_OPTIONS = [
  { value: '1:1', label: '1:1 方形' },
  { value: '2:3', label: '2:3 竖图' },
  { value: '3:2', label: '3:2 横图' },
  { value: '3:4', label: '3:4 竖图' },
  { value: '4:3', label: '4:3 横图' },
  { value: '4:5', label: '4:5 竖图' },
  { value: '5:4', label: '5:4 横图' },
  { value: '9:16', label: '9:16 竖屏' },
  { value: '16:9', label: '16:9 横屏' },
  { value: '21:9', label: '21:9 超宽' },
]

export const T2I_RESOLUTION_OPTIONS = [
  { value: '1K', label: '1K', longSide: 1024, icon: 'bi-badge-sd' },
  { value: '2K', label: '2K', longSide: 2048, icon: 'bi-badge-hd' },
  { value: '4K', label: '4K', longSide: 3840, icon: 'bi-badge-4k' },
  { value: '8K', label: '8K 实验', longSide: 7680, icon: 'bi-badge-8k' },
]

export const T2I_QUALITY_OPTIONS = [
  { value: 'standard', label: '标准', icon: 'bi-sliders' },
  { value: 'high', label: '高清', icon: 'bi-stars' },
  { value: 'hd', label: '精细', icon: 'bi-gem' },
]

export const T2I_COUNT_OPTIONS = [
  { value: 1, label: '1 张', icon: 'bi-image' },
  { value: 2, label: '2 张', icon: 'bi-images' },
  { value: 3, label: '3 张', icon: 'bi-images' },
  { value: 4, label: '4 张', icon: 'bi-collection' },
]

export const T2I_OUTPUT_FORMAT_OPTIONS = [
  { value: 'auto', label: '自动格式', icon: 'bi-magic' },
  { value: 'png', label: 'PNG 无损', icon: 'bi-filetype-png' },
  { value: 'webp', label: 'WebP 无损', icon: 'bi-filetype-webp' },
  { value: 'jpeg', label: 'JPEG 最高质量', icon: 'bi-filetype-jpg' },
  { value: 'jpg', label: 'JPG 最高质量', icon: 'bi-filetype-jpg' },
]

export const T2I_PROMPT_LIBRARY = [
  {
    id: 'cinematic',
    label: '电影感',
    prompt: '电影感光影，浅景深，戏剧性打光，细腻色彩，适合作为桌面壁纸',
  },
  {
    id: 'minimal',
    label: '极简干净',
    prompt: '极简干净构图，大面积留白，柔和光线，克制高级，适合作为桌面壁纸',
  },
  {
    id: 'anime',
    label: '动漫场景',
    prompt: '动漫场景，清晰线条，鲜明色彩，氛围感强，适合作为桌面壁纸',
  },
  {
    id: 'cyber',
    label: '赛博霓虹',
    prompt: '赛博霓虹夜景，湿润地面反射，未来都市，高对比光影，适合作为桌面壁纸',
  },
  {
    id: 'nature',
    label: '自然风景',
    prompt: '自然风景，清透空气感，真实材质，开阔构图，适合作为桌面壁纸',
  },
  {
    id: 'dreamy',
    label: '梦幻柔光',
    prompt: '梦幻柔光，轻雾与散射光，柔和色调，安静治愈，适合作为桌面壁纸',
  },
  {
    id: 'rain-tokyo',
    label: '雨夜东京',
    prompt: WALLPAPER_INSPIRATION_PROMPTS[0],
  },
  {
    id: 'moon-sea',
    label: '海上月色',
    prompt: WALLPAPER_INSPIRATION_PROMPTS[1],
  },
  {
    id: 'sky-library',
    label: '云中图书馆',
    prompt: WALLPAPER_INSPIRATION_PROMPTS[2],
  },
  {
    id: 'spring-valley',
    label: '春日山谷',
    prompt: WALLPAPER_INSPIRATION_PROMPTS[3],
  },
]

export function resolveT2iOutputSize(aspectRatio = '16:9', resolutionScale = '2K') {
  const scale =
    T2I_RESOLUTION_OPTIONS.find((item) => item.value === resolutionScale) ||
    T2I_RESOLUTION_OPTIONS[1]
  const longSide = Number(scale.longSide) || 2048
  const [rawW, rawH] = String(aspectRatio || '16:9')
    .split(':')
    .map((part) => Number(part))
  const ratioW = Number.isFinite(rawW) && rawW > 0 ? rawW : 16
  const ratioH = Number.isFinite(rawH) && rawH > 0 ? rawH : 9
  const requestedWidth = ratioW >= ratioH ? longSide : (longSide * ratioW) / ratioH
  const requestedHeight = ratioW >= ratioH ? (longSide * ratioH) / ratioW : longSide
  const normalized = normalizeGptImageOutputSize(requestedWidth, requestedHeight)
  return `${normalized.width}x${normalized.height}`
}

export const WALLPAPER_SKILL_OPTIONS = BUILTIN_WALLPAPER_SKILLS

export const WALLPAPER_DEFAULT_MCP_OPTIONS = [
  {
    id: 'wallhaven-source',
    name: 'Wallhaven Source',
    icon: 'bi-images',
    endpoint: 'wallhaven://search',
    description: '检索本站图片与标签素材',
  },
  {
    id: 'local-assets',
    name: 'Local Assets',
    icon: 'bi-folder2-open',
    endpoint: 'local://assets',
    description: '读取本地素材库引用',
  },
  {
    id: 'prompt-vault',
    name: 'Prompt Vault',
    icon: 'bi-journal-text',
    endpoint: 'vault://prompts',
    description: '复用保存过的提示词模板',
  },
  {
    id: 'metadata-inspector',
    name: 'Metadata Inspector',
    icon: 'bi-info-circle',
    endpoint: 'metadata://image',
    description: '读取尺寸、比例和来源信息',
  },
]
