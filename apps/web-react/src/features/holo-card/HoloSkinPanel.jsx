import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FlipHorizontal2, ImagePlus, Layers, RotateCcw, Sparkles, Upload } from 'lucide-react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ASTRAL_SAMPLE } from './astral-design-layers.js';
import { CARD_DESIGN_PARTS, CARD_SKIN_GALLERY, CARD_SKINS, getCardSkin, resolveCardDesign } from './cardSkins.js';
import { createCardSkinCanvases, drawCardSkinTypography } from './card-skin-art.js';
import { drawBack, drawFrontTypography } from './sample-relief-renderer.js';
import { fitSubject, mergeAlphaBounds, scanAlphaBounds } from './subject-fitting.js';
import './holo-skins.css';

gsap.registerPlugin(useGSAP);
const SWATCHES = ['#ff70b5', '#72f6ee', '#d3a560', '#a394de', '#81ab63', '#ef8b66'];
const TEXT_FIELDS = [
  ['title', '卡片名称', 28], ['subtitle', '副标题', 48], ['name', '角色名称', 28],
  ['number', '编号', 12], ['collection', '系列', 48], ['edition', '版本', 24],
  ['rarity', '稀有度', 10], ['element', '属性', 8], ['level', '等级', 4],
  ['power', '生命值', 8], ['attack', '攻击', 8], ['defense', '防御', 8], ['ability', '技能名称', 24],
];
const imageCache = new Map();
function staticImage(url) {
  if (!imageCache.has(url)) imageCache.set(url, new Promise((resolve, reject) => {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => resolve(img); img.onerror = () => { imageCache.delete(url); reject(new Error('预览加载失败')); }; img.src = url;
  }));
  return imageCache.get(url);
}

async function preparePortrait(image, isCurrent) {
  const sourceWidth = image.naturalWidth, sourceHeight = image.naturalHeight;
  const strip = document.createElement('canvas');
  strip.width = sourceWidth; strip.height = Math.min(128, sourceHeight);
  const context = strip.getContext('2d', { willReadFrequently: true });
  let bounds = null, pixelImage = null;
  try {
    for (let top = 0; top < sourceHeight; top += strip.height) {
      if (!isCurrent()) return null;
      const rows = Math.min(strip.height, sourceHeight - top);
      context.clearRect(0, 0, strip.width, strip.height);
      context.drawImage(image, 0, top, sourceWidth, rows, 0, 0, sourceWidth, rows);
      bounds = mergeAlphaBounds(bounds, scanAlphaBounds(context.getImageData(0, 0, sourceWidth, rows).data, sourceWidth, rows, top));
      if (top && top % 1024 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (!isCurrent()) return null;
    const ratio = Math.min(1, 512 / Math.max(sourceWidth, sourceHeight));
    pixelImage = document.createElement('canvas');
    pixelImage.width = Math.max(1, Math.round(sourceWidth * ratio)); pixelImage.height = Math.max(1, Math.round(sourceHeight * ratio));
    const pixelContext = pixelImage.getContext('2d', { willReadFrequently: true });
    pixelContext.drawImage(image, 0, 0, pixelImage.width, pixelImage.height);
    const pixels = pixelContext.getImageData(0, 0, pixelImage.width, pixelImage.height);
    const original = pixels.data.slice();
    const block = Math.max(1, Math.round(Math.max(sourceWidth, sourceHeight) / 128));
    for (let y = 0; y < pixelImage.height; y++) for (let x = 0; x < pixelImage.width; x++) {
      // Match the renderer's source-pixel grid, anchored at the bottom-left.
      const sourceX = (x + .5) / pixelImage.width * sourceWidth;
      const sourceY = (1 - (y + .5) / pixelImage.height) * sourceHeight;
      const qx = Math.min(pixelImage.width - 1, Math.max(0, Math.floor((Math.floor(sourceX / block) + .5) * block / sourceWidth * pixelImage.width)));
      const qy = Math.min(pixelImage.height - 1, Math.max(0, Math.floor((1 - (Math.floor(sourceY / block) + .5) * block / sourceHeight) * pixelImage.height)));
      const from = (qy * pixelImage.width + qx) * 4, to = (y * pixelImage.width + x) * 4;
      if (original[from + 3] < 1) continue;
      pixels.data[to] = original[from]; pixels.data[to + 1] = original[from + 1]; pixels.data[to + 2] = original[from + 2];
      // Alpha stays at its original sampling resolution, including fine edges.
    }
    pixelContext.putImageData(pixels, 0, 0);
  } catch {
    if (pixelImage) { pixelImage.width = 1; pixelImage.height = 1; }
    pixelImage = null; /* A source without readable pixels retains its original image. */
  }
  finally { strip.width = 1; strip.height = 1; }
  return { image, bounds, pixelImage };
}

function useThumbnailPortrait(url) {
  const [portrait, setPortrait] = useState(null);
  useEffect(() => {
    let current = true;
    setPortrait(null);
    if (!url) return;
    const image = new Image(); image.crossOrigin = 'anonymous';
    image.onload = async () => {
      if (!current) return;
      const next = await preparePortrait(image, () => current);
      if (current && next) setPortrait(next);
      else if (next?.pixelImage) { next.pixelImage.width = 1; next.pixelImage.height = 1; }
    };
    image.src = url;
    return () => { current = false; image.onload = null; image.onerror = null; image.src = ''; };
  }, [url]);
  useEffect(() => {
    const pixelImage = portrait?.pixelImage;
    // Release after the portrait leaves the rendered tree, not merely when its
    // source URL changes: pending thumbnail effects still own the previous image.
    return () => { if (pixelImage) { pixelImage.width = 1; pixelImage.height = 1; } };
  }, [portrait]);
  return portrait;
}

function SkinThumbnail({ skin, portrait, back }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    setFailed(false);
    void (async () => {
      const canvas = ref.current;
      if (!canvas) return;
      const width = 360, height = 540;
      let plates, scene;
      try {
        if (skin.id === 'astral') {
          const [background, effects] = await Promise.all([staticImage(ASTRAL_SAMPLE.assets.background), staticImage(ASTRAL_SAMPLE.assets.effects)]);
          plates = { background, effects };
        } else {
          if (!back && (skin.previewArtwork || skin.artwork)) scene = await staticImage(skin.previewArtwork || skin.artwork);
          if (!current) return;
          plates = createCardSkinCanvases(skin.id, { width, height });
        }
        if (!current) return;
        // Assemble offscreen: a late scene cannot be paired with the previous frame.
        const composed = document.createElement('canvas'); composed.width = width; composed.height = height;
        const ctx = composed.getContext('2d');
        if (back) {
          if (skin.id === 'astral') drawBack(composed, skin.defaults);
          else ctx.drawImage(plates.back, 0, 0, width, height);
        } else {
          ctx.drawImage(scene || plates.background, 0, 0, width, height);
          if (portrait) {
            const { image, bounds } = portrait;
            const fitting = fitSubject({ width: image.naturalWidth, height: image.naturalHeight, framing: 'auto', alphaBounds: bounds || { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight }, artworkRect: skin.artworkRect });
            const s = fitting.sourceBounds, d = fitting.displayBounds;
            const source = skin.pixelated && portrait.pixelImage ? portrait.pixelImage : image;
            const sx = (source.naturalWidth || source.width) / image.naturalWidth, sy = (source.naturalHeight || source.height) / image.naturalHeight;
            ctx.drawImage(source, s.x * sx, s.y * sy, s.width * sx, s.height * sy, d.x * width, (1 - d.y - d.height) * height, d.width * width, d.height * height);
          }
          if (plates.effects) ctx.drawImage(plates.effects, 0, 0, width, height);
          if (plates.frame) ctx.drawImage(plates.frame, 0, 0, width, height);
          const text = document.createElement('canvas'); text.width = width; text.height = height;
          if (skin.id === 'astral') drawFrontTypography(text, skin.defaults);
          else drawCardSkinTypography(text, skin.id, skin.defaults);
          ctx.drawImage(text, 0, 0); text.width = 1; text.height = 1;
        }
        if (!current) return;
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(composed, 0, 0);
        composed.width = 1; composed.height = 1;
      } finally {
        if (skin.id !== 'astral' && plates) Object.values(plates).forEach(plate => { if (plate) { plate.width = 1; plate.height = 1; } });
      }
    })().catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [skin, portrait, back]);
  return <span className={`holo-skin-art${back ? ' is-back' : ''}`}><canvas ref={ref} aria-hidden="true"/>{failed && <span className="holo-skin-fallback"><strong>{skin.title}</strong><small>场景预览暂未就绪</small></span>}<span className="holo-skin-sheen"/></span>;
}

function Fold({ title, children }) {
  return <details className="holo-details holo-skin-fold"><summary>{title}<ChevronDown size={15}/></summary><div>{children}</div></details>;
}

export function CardTextControls({ settings, onChange }) {
  const layout = resolveCardDesign(settings).layout, defaults = layout.defaults;
  const fields = layout.fullArt ? TEXT_FIELDS.slice(0, 6) : TEXT_FIELDS;
  return <div className="holo-card-copy-fields">{fields.map(([key, label, maxLength]) => <label className={`holo-field${['number', 'edition', 'rarity', 'element', 'level', 'power', 'attack', 'defense'].includes(key) ? ' is-compact' : ''}`} key={key}>{label}<input value={settings[key] ?? defaults[key] ?? ''} maxLength={maxLength} onChange={event => onChange(key, event.target.value)}/></label>)}{!layout.fullArt && <label className="holo-field">卡片描述<textarea value={settings.description ?? defaults.description ?? ''} rows={3} maxLength={180} onChange={event => onChange('description', event.target.value)}/></label>}</div>;
}

export function HoloSkinPanel({ settings, onChange, onSelect, artworkUrl, active, graphicAssets, onUpload, onGraphicMode, disabled }) {
  const root = useRef(null);
  const [back, setBack] = useState(false), [draftColor, setDraftColor] = useState('');
  const portrait = useThumbnailPortrait(active ? artworkUrl : '');
  const skin = getCardSkin(settings.skinId);
  useEffect(() => { setDraftColor(settings.accentColor || skin.palette.accent); }, [settings.accentColor, skin.id]);
  useEffect(() => {
    if (!draftColor || draftColor === (settings.accentColor || skin.palette.accent)) return;
    const timer = setTimeout(() => onChange('accentColor', draftColor), 180);
    return () => clearTimeout(timer);
  }, [draftColor, settings.accentColor, skin.id, onChange]);
  useGSAP(() => {
    if (!active || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.fromTo('.holo-skin-tile', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: .42, stagger: .04, ease: 'power3.out' });
  }, { scope: root, dependencies: [active], revertOnUpdate: true });
  return <div ref={root} className="holo-skin-library">{active && <>
    <div className="holo-skin-intro"><span>THE CARD WARDROBE</span><h2>换个世界，继续闪耀。</h2><p>点选一套，整张卡一起换装。</p></div>
    <div className="holo-skin-library-bar"><span>{CARD_SKINS.length} 套完整设计</span><button type="button" onClick={() => setBack(value => !value)} aria-label={back ? '预览皮肤卡面' : '预览皮肤卡背'}><FlipHorizontal2 size={13}/>{back ? '看卡面' : '看卡背'}</button></div>
    <div className="holo-skin-grid" role="group" aria-label="完整卡片皮肤">{CARD_SKIN_GALLERY.map((item, index) => <button type="button" key={item.id} className="holo-skin-tile" data-card-skin={item.id} aria-label={`应用${item.title}皮肤`} aria-pressed={skin.id === item.id} onClick={() => onSelect(item.id)} disabled={disabled} style={{ '--skin-accent': item.palette.accent, '--skin-secondary': item.palette.secondary, '--skin-lean': index % 2 ? '2deg' : '-2deg' }}>
      <SkinThumbnail skin={item} portrait={portrait} back={back}/><span className="holo-skin-tile-copy"><strong>{item.title}</strong><small>{item.reference}</small></span><span className="holo-skin-check">{skin.id === item.id ? <Check size={13}/> : <Sparkles size={12}/>}</span>
    </button>)}</div>
    <p className="holo-skin-preserve"><Layers size={13}/>保留你的角色和文字，换装无需重新生成。</p>
    <Fold title="自由混搭"><p className="holo-caption">背景、卡框、排版、装饰与卡背都能单独换。</p><div className="holo-skin-part-selects">{CARD_DESIGN_PARTS.map(({ key, label }) => <label className="holo-field" key={key}>{label}<select value={settings[key] || 'skin'} onChange={event => onChange(key, event.target.value)}><option value="skin">跟随当前皮肤</option>{CARD_SKINS.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>)}</div>
      <label className="holo-field">角色画风<select value={settings.artTreatment || 'skin'} onChange={event => onChange('artTreatment', event.target.value)}><option value="skin">跟随皮肤</option><option value="natural">保留原画</option><option value="pixel">像素化显示</option></select></label>
      <div className="holo-skin-visibility">{[['showFrame', '显示卡框'], ['showEffects', '显示前景装饰'], ['showText', '显示文字']].map(([key, label]) => <label key={key}><input type="checkbox" checked={settings[key] !== false} onChange={event => onChange(key, event.target.checked)}/><span>{label}</span></label>)}</div>
    </Fold>
    <Fold title="专属配色"><div className="holo-skin-colors">{SWATCHES.map(color => <button type="button" key={color} aria-label={`主题色 ${color}`} aria-pressed={settings.accentColor === color} onClick={() => onChange('accentColor', color)} style={{ background: color }}/>)}</div><label className="holo-skin-color-input">自选强调色<input aria-label="自选强调色" type="color" value={draftColor || skin.palette.accent} onChange={event => setDraftColor(event.target.value)}/></label><button type="button" className="holo-text-button" onClick={() => onChange('accentColor', '')}><RotateCcw size={13}/>恢复皮肤原色</button></Fold>
    <Fold title="卡面文字"><CardTextControls settings={settings} onChange={onChange}/></Fold>
    <Fold title="自备素材"><p className="holo-caption">用你自己的图片替换任何一层。卡框、装饰用 2:3 透明 PNG，卡背和背景也支持 JPG / WebP。</p>{graphicAssets.map(asset => <div className="holo-skin-upload" key={asset.kind}>
      <button type="button" className="holo-skin-upload-main" aria-label={`上传${asset.label}`} onClick={() => onUpload(asset.kind)} disabled={disabled}><span>{asset.url ? <img src={asset.url} alt=""/> : <ImagePlus size={17}/>}</span><span><strong>{asset.label}</strong><small>{asset.name || (asset.transparent ? '2:3 透明 PNG' : 'PNG · JPG · WebP')}</small></span><Upload size={14}/></button>
      {asset.url && <div className="holo-skin-source-switch"><button type="button" aria-pressed={asset.mode === 'custom'} aria-label={`使用我的${asset.label}`} onClick={() => onGraphicMode(asset.kind, 'custom')}>我的素材</button><button type="button" aria-pressed={asset.mode !== 'custom'} aria-label={`恢复皮肤${asset.label}`} onClick={() => onGraphicMode(asset.kind, 'template')}>皮肤自带</button></div>}
    </div>)}</Fold>
  </>}</div>;
}
