// Shared by the controls and both renderers. Keep the first five finish IDs in
// this order so existing configurations retain their original-print channel.
export const FINISHES = Object.freeze([
  { id: 'spectrum', label: '光谱', description: '随视角流转的全色镭射', swatch: 'conic-gradient(from 20deg, #a6eadb, #a8aff5, #e8c1eb, #efcea3, #a6eadb)' },
  { id: 'silver', label: '银箔', description: '冷调镜面与利落高光', swatch: 'linear-gradient(135deg, #fff, #becbdd 39%, #7c879d 73%, #cfd9e8)' },
  { id: 'gold', label: '金箔', description: '温润金属与雕刻光泽', swatch: 'linear-gradient(130deg, #ffeab3, #e2c78c 44%, #aa763e 77%, #f2d490)' },
  { id: 'pearl', label: '珠光', description: '柔和乳白与细腻偏色', swatch: 'linear-gradient(130deg, #fffce8, #dceae4 37%, #e5c9ec 73%, #f8e2dc)' },
  { id: 'original', label: '原画', description: '保留画面的原始色彩', swatch: 'linear-gradient(135deg, #7d9d94, #415e67 58%, #354055)' },
  { id: 'rose', label: '玫瑰金', description: '玫瑰铜色与缎面反光', swatch: 'linear-gradient(130deg, #ffe9dc, #e0a5a4 38%, #955d70 68%, #f4ccba)' },
  { id: 'ice', label: '冰晶', description: '冰蓝折射与锐利晶光', swatch: 'conic-gradient(from 45deg, #e4fcff, #80b4db, #deefff, #7e90c4, #edffff)' },
  { id: 'obsidian', label: '曜石', description: '深色釉面与紫金边光', swatch: 'linear-gradient(135deg, #6d6a82, #232332 33%, #8c778f 48%, #252635 60%, #968366)' },
  { id: 'opal', label: '欧泊', description: '宝石内部的斑斓变彩', swatch: 'conic-gradient(from 40deg, #c8e9e1, #a59add, #e7b1d4, #f0d5a6, #94cbd0, #c8e9e1)' },
]);

export const PATTERNS = Object.freeze([
  { id: 'flow', label: '流光', description: '细腻的流动光带' },
  { id: 'stardust', label: '星砂', description: '细闪颗粒随视角明灭' },
  { id: 'aurora', label: '极光', description: '弧形幻彩与柔光' },
  { id: 'prism', label: '碎钻', description: '细碎晶面折射出不同光彩' },
  { id: 'ripple', label: '水波', description: '同心涟漪中的柔亮波纹' },
  { id: 'guilloche', label: '雕纹', description: '交错曲线组成精细金属刻纹' },
  { id: 'silk', label: '织光', description: '绸缎纤维般的定向光泽' },
  { id: 'nebula', label: '星云', description: '层叠雾彩中的明暗星团' },
  { id: 'diffraction', label: '光栅', description: '精密光栅折出的色散光线' },
]);

export const SHINE_STYLES = Object.freeze([
  { id: 'sweep', label: '掠光', description: '一道细光斜掠卡面' },
  { id: 'halo', label: '光环', description: '从中心绽开的光之涟漪' },
  { id: 'comet', label: '彗星', description: '带着柔亮尾迹划过卡面' },
  { id: 'cross', label: '星芒', description: '十字光芒逐渐绽放与消隐' },
]);

export const MOTION_STYLES = Object.freeze([
  { id: 'orbit', label: '环绕', description: '沿环形轨迹缓缓流转', path: 'M9 25C9 8 55 8 55 25S9 42 9 25Z' },
  { id: 'sway', label: '摇曳', description: '钟摆般的左右摇曳', path: 'M8 17Q32 44 56 17' },
  { id: 'figure8', label: '蝶舞', description: '沿八字轨迹舒展游弋', path: 'M32 25C2-6 2 56 32 25S62-6 32 25C2 56 2-6 32 25S62 56 32 25Z' },
  { id: 'float', label: '悬浮', description: '轻柔的纵向漂浮与微倾', path: 'M24 8C47 14 17 34 40 42' },
]);

export const VISUAL_PRESETS = Object.freeze([
  { id: 'celestial', label: '星河秘境', caption: '幻彩 · 星云', foil: 'spectrum', pattern: 'nebula', foilStrength: .58, orbitStyle: 'figure8', shineStyle: 'halo' },
  { id: 'frost', label: '月下冰晶', caption: '冰蓝 · 碎钻', foil: 'ice', pattern: 'prism', foilStrength: .64, orbitStyle: 'float', shineStyle: 'sweep' },
  { id: 'rose-silk', label: '蔷薇鎏金', caption: '玫瑰 · 丝缎', foil: 'rose', pattern: 'silk', foilStrength: .58, orbitStyle: 'sway', shineStyle: 'comet' },
  { id: 'nocturne', label: '黑曜典藏', caption: '深釉 · 雕纹', foil: 'obsidian', pattern: 'guilloche', foilStrength: .68, orbitStyle: 'orbit', shineStyle: 'cross' },
  { id: 'opal-tide', label: '幻彩欧泊', caption: '变彩 · 涟漪', foil: 'opal', pattern: 'ripple', foilStrength: .62, orbitStyle: 'figure8', shineStyle: 'halo' },
  { id: 'gold-seal', label: '黄金圣印', caption: '金箔 · 刻纹', foil: 'gold', pattern: 'guilloche', foilStrength: .7, orbitStyle: 'sway', shineStyle: 'cross' },
  { id: 'aurora-echo', label: '极光回响', caption: '珠光 · 极光', foil: 'pearl', pattern: 'aurora', foilStrength: .64, orbitStyle: 'orbit', shineStyle: 'comet' },
  { id: 'cyber', label: '赛博光栅', caption: '银箔 · 色散', foil: 'silver', pattern: 'diffraction', foilStrength: .7, orbitStyle: 'figure8', shineStyle: 'sweep' },
]);

const PRESET_KEYS = Object.freeze(['foil', 'pattern', 'foilStrength', 'orbitStyle', 'shineStyle']);

export function visualPresetPatch(id) {
  const preset = VISUAL_PRESETS.find(item => item.id === id);
  return preset ? Object.fromEntries(PRESET_KEYS.map(key => [key, preset[key]])) : null;
}

export function selectedVisualPreset(settings) {
  return VISUAL_PRESETS.find(preset => PRESET_KEYS.every(key => settings[key] === preset[key]))?.id || '';
}
