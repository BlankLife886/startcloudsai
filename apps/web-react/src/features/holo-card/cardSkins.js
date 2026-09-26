import { ASTRAL_TEMPLATE_SETTINGS } from './holoTemplates.js';

// Normalized artwork windows are shared by the drawing and subject fitting code.
// Typography stays independent of the uploaded character and is never baked into it.
export const CARD_SKINS = Object.freeze([
  {
    id: 'astral', title: '星间旅人', subtitle: '星轨 · 金箔 · 全画幅', reference: '原版典藏', tag: 'CELESTIAL',
    palette: { base: '#10252e', panel: '#10252e', border: '#d8bf83', ink: '#f5e9ce', muted: '#b4b9b3', accent: '#d8bf83', secondary: '#a394de' },
    artworkRect: { x: 0, y: 0, width: 1, height: 1 }, fullArt: true, pixelated: false,
    material: { foil: 'gold', foilStrength: .65, pattern: 'flow', depth: 1, orbitStyle: 'orbit', shineStyle: 'sweep' },
    defaults: { ...ASTRAL_TEMPLATE_SETTINGS, rarity: 'SSR', element: '星', level: '7', power: '180', attack: '2400', defense: '1800', ability: '星河回响', description: '收集散落的星光，把此刻封存为独一无二的珍藏。' },
  },
  {
    id: 'anime', title: '霓光漫游', subtitle: '夜樱 · 透明镭射 · 全景收藏', reference: '动漫收藏卡', tag: 'NEON ANIME',
    palette: { base: '#151b38', panel: '#121a32', border: '#b8d8ed', ink: '#f4eeff', muted: '#a9b2d0', accent: '#e7a5ce', secondary: '#82cde9' },
    artworkRect: { x: .04, y: .045, width: .92, height: .775 }, pixelated: false,
    artwork: '/holo-skins/v2/anime-scene.webp', previewArtwork: '/holo-skins/v2/anime-preview.webp',
    material: { foil: 'pearl', foilStrength: .48, pattern: 'aurora', depth: 1, orbitStyle: 'figure8', shineStyle: 'comet' },
    defaults: { title: '霓光漫游', subtitle: 'BEYOND THE NEON', name: '夜航者', number: '02', collection: 'NEON ARCHIVE', edition: 'FIRST LIGHT', rarity: 'SSR', element: '光', level: '9', power: '240', attack: '2800', defense: '1600', ability: '超频觉醒', description: '穿越城市的夜色，追逐下一道属于你的光。' },
  },
  {
    id: 'pixel', title: '像素勇者', subtitle: '月夜城堡 · 宝石像素 · 冒险纪念', reference: '像素 RPG', tag: '8-BIT QUEST',
    palette: { base: '#171c34', panel: '#19223a', border: '#94809b', ink: '#fff0cc', muted: '#a5b6cc', accent: '#e6c58a', secondary: '#8dbec4' },
    artworkRect: { x: .065, y: .10, width: .87, height: .67 }, pixelated: true,
    artwork: '/holo-skins/v2/pixel-scene.webp', previewArtwork: '/holo-skins/v2/pixel-preview.webp',
    material: { foil: 'silver', foilStrength: .4, pattern: 'diffraction', depth: .8, orbitStyle: 'float', shineStyle: 'cross' },
    defaults: { title: '像素勇者', subtitle: 'A NEW ADVENTURE', name: '勇者', number: '03', collection: 'QUEST LOG', edition: 'SAVE 01', rarity: 'EPIC', element: '风', level: '32', power: '128', attack: '960', defense: '640', ability: '水晶之心', description: '背上行囊，点亮地图。每一格像素都藏着新的冒险。' },
  },
  {
    id: 'monster', title: '精灵图鉴', subtitle: '秘境森林 · 金色压印 · 特别插画', reference: '宝可梦卡牌灵感', tag: 'CREATURE ATLAS',
    palette: { base: '#234f4a', panel: '#f4edd6', border: '#d6b779', ink: '#34483b', muted: '#7a846e', accent: '#d2af66', secondary: '#9fc9b2' },
    artworkRect: { x: .055, y: .115, width: .89, height: .655 }, pixelated: false,
    artwork: '/holo-skins/v2/monster-scene.webp', previewArtwork: '/holo-skins/v2/monster-preview.webp',
    material: { foil: 'gold', foilStrength: .42, pattern: 'stardust', depth: .95, orbitStyle: 'orbit', shineStyle: 'sweep' },
    defaults: { title: '精灵图鉴', subtitle: 'ELEMENTAL COMPANION', name: '星光伙伴', number: '025', collection: 'WONDER ATLAS', edition: 'HOLO RARE', rarity: 'SR', element: '雷', level: '24', power: '180', attack: '120', defense: '80', ability: '闪耀共鸣', description: '当心意与星光相连，微小的勇气也能释放耀眼的力量。' },
  },
  {
    id: 'farm', title: '四季物语', subtitle: '金色山谷 · 手绘木纹 · 田园纪念', reference: '星露谷物语灵感', tag: 'SEASONS JOURNAL',
    palette: { base: '#526953', panel: '#f5e7c5', border: '#92674b', ink: '#604f3e', muted: '#958570', accent: '#c49e6b', secondary: '#9cac75' },
    artworkRect: { x: .055, y: .09, width: .89, height: .68 }, pixelated: true,
    artwork: '/holo-skins/v2/farm-scene.webp', previewArtwork: '/holo-skins/v2/farm-preview.webp',
    material: { foil: 'pearl', foilStrength: .26, pattern: 'silk', depth: .7, orbitStyle: 'float', shineStyle: 'sweep' },
    defaults: { title: '四季物语', subtitle: 'A LITTLE EVERYDAY MAGIC', name: '山谷来客', number: '04', collection: 'VALLEY MEMORIES', edition: 'SPRING YEAR 01', rarity: '珍藏', element: '春', level: '8', power: '100', attack: '88', defense: '64', ability: '丰收的约定', description: '种下一颗种子，等风经过麦田。把平凡日子酿成甜甜的回忆。' },
  },
  {
    id: 'duel', title: '秘法决斗', subtitle: '黑金古籍 · 紫晶圣殿 · 浮雕铭文', reference: '游戏王卡牌灵感', tag: 'ARCANE DUEL',
    palette: { base: '#241c2f', panel: '#e4d8bb', border: '#a68857', ink: '#4b3f33', muted: '#91836e', accent: '#c7a675', secondary: '#afa1c7' },
    artworkRect: { x: .075, y: .165, width: .85, height: .565 }, pixelated: false,
    artwork: '/holo-skins/v2/duel-scene.webp', previewArtwork: '/holo-skins/v2/duel-preview.webp',
    material: { foil: 'gold', foilStrength: .55, pattern: 'guilloche', depth: .95, orbitStyle: 'orbit', shineStyle: 'cross' },
    defaults: { title: '秘法决斗', subtitle: 'THE ANCIENT COVENANT', name: '星界召唤师', number: '006', collection: 'ARCANA CHRONICLE', edition: '1ST EDITION', rarity: 'UR', element: '暗', level: '7', power: '240', attack: '2800', defense: '2100', ability: '星界契约', description: '以古老的符文唤醒沉睡之力。此卡登场时，星界之门为你开启。' },
  },
  {
    id: 'dopamine', title: '潮酷多巴胺', subtitle: '撞色拼贴 · 果冻镭射 · 潮流收藏', reference: '多巴胺 / 潮流贴纸', tag: 'DOPAMINE CLUB', featured: true,
    palette: { base: '#fee852', panel: '#fff7e9', border: '#28223f', ink: '#29233e', muted: '#71637a', accent: '#ff5b92', secondary: '#4a5ce5' },
    artworkRect: { x: .065, y: .10, width: .87, height: .67 }, pixelated: false,
    artwork: '/holo-skins/v3/dopamine-scene.webp', previewArtwork: '/holo-skins/v3/dopamine-preview.webp',
    material: { foil: 'opal', foilStrength: .48, pattern: 'prism', depth: 1, orbitStyle: 'figure8', shineStyle: 'cross' },
    defaults: { title: '快乐超频', subtitle: 'GOOD ENERGY / ALL DAY', name: 'COLOR PLAYER', number: '007', collection: 'DOPAMINE CLUB', edition: 'COLOR DROP 01', rarity: 'SUPER', element: '快乐', level: '99', power: '100', attack: '88', defense: '66', ability: '心动暴击', description: '把喜欢的颜色穿在身上，今天的快乐由自己定义。' },
  },
  {
    id: 'pokemon', title: '宝可梦·虹彩', subtitle: '经典金边 · 精灵球 · 特别插画', reference: '宝可梦 / 虹彩收藏', tag: 'POKÉMON HOLO', featured: true,
    palette: { base: '#4c98cb', panel: '#fff4d0', border: '#e9be44', ink: '#333c46', muted: '#777254', accent: '#f3ca44', secondary: '#3974b9' },
    artworkRect: { x: .065, y: .125, width: .87, height: .615 }, pixelated: false,
    artwork: '/holo-skins/v3/pokemon-scene.webp', previewArtwork: '/holo-skins/v3/pokemon-preview.webp',
    material: { foil: 'spectrum', foilStrength: .58, pattern: 'stardust', depth: .95, orbitStyle: 'orbit', shineStyle: 'halo' },
    defaults: { title: '闪耀伙伴', subtitle: 'SPECIAL ILLUSTRATION RARE', name: 'MY PARTNER', number: '025', collection: 'POKÉMON / COLLECTION', edition: 'HOLO EDITION', rarity: 'SAR', element: '雷', level: '28', power: '180', attack: '120', defense: '80', ability: '十万伏特', description: '与伙伴并肩探索，把每一次相遇收藏成闪耀的回忆。' },
  },
  {
    id: 'ocean', title: '海洋之心', subtitle: '深海满版 · 银蓝浮雕 · 潮汐流光', reference: '满版 / 深海典藏', tag: 'HEART OF THE OCEAN', featured: true,
    palette: { base: '#092b49', panel: '#082c54', border: '#adddea', ink: '#edf9ff', muted: '#afd0dc', accent: '#78d2e8', secondary: '#4b93bc' },
    artworkRect: { x: 0, y: 0, width: 1, height: 1 }, fullArt: true, pixelated: false,
    artwork: '/holo-skins/v4/ocean-scene.webp', previewArtwork: '/holo-skins/v4/ocean-preview.webp',
    material: { foil: 'ice', foilStrength: .52, pattern: 'ripple', depth: 1, orbitStyle: 'float', shineStyle: 'halo' },
    defaults: { title: '海洋之心', subtitle: 'WHERE THE LIGHT MEETS THE DEEP', name: 'TIDAL DREAMER', number: '010', collection: 'OCEAN / JEWEL COLLECTION', edition: 'SAPPHIRE EDITION', rarity: 'UR', element: '水', level: '88', power: '200', attack: '160', defense: '120', ability: '潮汐共鸣', description: '将一颗蓝色的心交给大海，让每一道波光都记住你的名字。' },
  },
  {
    id: 'arknights', title: '明日方舟·干员', subtitle: '工业黑白 · 警示黄 · 干员档案', reference: '明日方舟 / 战术档案', tag: 'OPERATOR ARCHIVE', featured: true,
    palette: { base: '#293039', panel: '#e9e9e3', border: '#1b2027', ink: '#242a31', muted: '#757b7d', accent: '#e6b848', secondary: '#9aafba' },
    artworkRect: { x: .085, y: .12, width: .83, height: .615 }, pixelated: false,
    artwork: '/holo-skins/v3/arknights-scene.webp', previewArtwork: '/holo-skins/v3/arknights-preview.webp',
    material: { foil: 'silver', foilStrength: .34, pattern: 'diffraction', depth: 1, orbitStyle: 'sway', shineStyle: 'sweep' },
    defaults: { title: '代号：曙光', subtitle: 'OPERATOR / PERSONNEL FILE', name: 'DAWN', number: 'RI-009', collection: 'RHODES ISLAND', edition: 'ELITE 02', rarity: '★★★★★★', element: '近卫', level: '90', power: '24', attack: '780', defense: '420', ability: '战术协同', description: '行动指令已确认。无论前路如何，始终守住身后的灯火。' },
  },
]);

export const CARD_SKIN_GALLERY = Object.freeze([...CARD_SKINS.filter(skin => skin.featured), ...CARD_SKINS.filter(skin => !skin.featured)]);

export const CARD_DESIGN_PARTS = Object.freeze([
  { key: 'backgroundDesign', label: '背景', part: 'background' },
  { key: 'frameDesign', label: '卡框', part: 'frame' },
  { key: 'layoutDesign', label: '文字排版', part: 'layout' },
  { key: 'effectsDesign', label: '前景装饰', part: 'effects' },
  { key: 'backDesign', label: '卡背', part: 'back' },
]);

export function getCardSkin(id) {
  return CARD_SKINS.find(skin => skin.id === id) || CARD_SKINS[0];
}

export function resolveCardDesign(settings = {}) {
  const skin = getCardSkin(settings.skinId);
  const parts = Object.fromEntries(CARD_DESIGN_PARTS.map(({ key, part }) => [part, !settings[key] || settings[key] === 'skin' ? skin : getCardSkin(settings[key])]));
  const accentColor = /^#[\da-f]{6}$/i.test(settings.accentColor || '') ? settings.accentColor : '';
  const { frame, layout } = parts;
  const a = settings.showFrame === false ? layout.artworkRect : frame.artworkRect;
  // The original card uses a full-art identity map, including its quiet text
  // zones. When its type is borrowed by another frame, reserve those zones so
  // the enlarged portrait cannot collide with the legacy title and name.
  const b = layout.fullArt && !frame.fullArt && settings.showFrame !== false
    ? { x: 0, y: .095, width: 1, height: .665 } : layout.artworkRect;
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const artworkRect = { x, y, width: Math.max(.1, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(.1, Math.min(a.y + a.height, b.y + b.height) - y) };
  return {
    skin, ...parts, accentColor, artworkRect,
    palette: { ...skin.palette, accent: accentColor || skin.palette.accent },
    pixelated: settings.artTreatment === 'pixel' || (settings.artTreatment !== 'natural' && skin.pixelated),
    showFrame: settings.showFrame !== false, showEffects: settings.showEffects !== false, showText: settings.showText !== false,
  };
}

export const resolveSkinDesign = resolveCardDesign;

export function applyCardSkin(settings, id) {
  const skin = getCardSkin(id);
  return {
    ...settings, ...skin.material, skinId: skin.id,
    ...Object.fromEntries(CARD_DESIGN_PARTS.map(({ key }) => [key, 'skin'])),
    accentColor: '', showFrame: true, showEffects: true, showText: true, artTreatment: 'skin',
  };
}
