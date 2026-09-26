import { useEffect, useId, useRef, useState } from 'react';
import { Check, Layers, Orbit, Shuffle, Sparkles } from 'lucide-react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { FINISHES, PATTERNS, MOTION_STYLES, SHINE_STYLES, VISUAL_PRESETS, selectedVisualPreset, visualPresetPatch } from './holoVisualCatalog.js';
import './holo-play-controls.css';

gsap.registerPlugin(useGSAP);
const SECTIONS = [['presets', '灵感'], ['finishes', '材质'], ['patterns', '纹理'], ['motion', '动态']];

export function useHoloReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update); update();
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

export function HoloPlayControls({ settings, onChange, onPatch, onShine, section = 'presets', onSectionChange, disabled = false, canExplode = true }) {
  const reduced = useHoloReducedMotion();
  const rootRef = useRef(null), contentRef = useRef(null);
  const id = useId();
  const activePreset = selectedVisualPreset(settings);
  const finish = FINISHES.find(item => item.id === settings.foil) || FINISHES[0];
  const pattern = PATTERNS.find(item => item.id === settings.pattern) || PATTERNS[0];
  const motion = MOTION_STYLES.find(item => item.id === settings.orbitStyle) || MOTION_STYLES[0];
  const shine = SHINE_STYLES.find(item => item.id === settings.shineStyle) || SHINE_STYLES[0];

  useGSAP(() => {
    if (!contentRef.current || reduced) return;
    gsap.fromTo(contentRef.current, { opacity: .35, y: 6 }, { opacity: 1, y: 0, duration: .28, ease: 'power3.out', clearProps: 'opacity,transform' });
  }, { scope: rootRef, dependencies: [section], revertOnUpdate: true });
  useGSAP(() => {
    if (!reduced || !contentRef.current) return;
    gsap.killTweensOf(contentRef.current);
    gsap.set(contentRef.current, { clearProps: 'opacity,transform' });
  }, { scope: rootRef, dependencies: [reduced] });

  const applyPreset = presetId => {
    const patch = visualPresetPatch(presetId);
    if (patch) onPatch(patch);
  };
  const surprise = () => {
    const options = VISUAL_PRESETS.filter(item => item.id !== activePreset);
    applyPreset(options[Math.floor(Math.random() * options.length)].id);
  };
  const navigate = (event, index) => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % SECTIONS.length;
    if (event.key === 'ArrowLeft') next = (index + SECTIONS.length - 1) % SECTIONS.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = SECTIONS.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    onSectionChange(SECTIONS[next][0]);
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus({ preventScroll: true });
  };

  return <div ref={rootRef} className="holo-play-controls">
    <div className="holo-library-heading"><span>光的无限可能<small>{FINISHES.length} 种材质 · {PATTERNS.length} 种纹理</small></span><button type="button" aria-label="随机灵感搭配" title="换一套灵感搭配" disabled={disabled} onClick={surprise}><Shuffle size={16}/></button></div>
    <div className="holo-library-tabs" role="tablist" aria-label="风格库分类">{SECTIONS.map(([value, label], index) => <button type="button" key={value} id={`${id}-tab-${value}`} role="tab" tabIndex={section === value ? 0 : -1} aria-selected={section === value} aria-controls={`${id}-panel`} onClick={() => onSectionChange(value)} onKeyDown={event => navigate(event, index)}>{label}</button>)}</div>
    <div ref={contentRef} key={section} className="holo-library-content" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${section}`} tabIndex={0}>
      {section === 'presets' && <div className="holo-look-grid" role="group" aria-label="灵感搭配">{VISUAL_PRESETS.map(preset => <button type="button" key={preset.id} className={`holo-look is-${preset.id}`} aria-label={`${preset.label}搭配`} aria-pressed={activePreset === preset.id} disabled={disabled} onClick={() => applyPreset(preset.id)}>
        <span className={`holo-look-art holo-pattern-preview is-${preset.pattern}`} aria-hidden="true"><i/><i/><i/><span className="holo-look-card" style={{ '--finish-swatch': FINISHES.find(item => item.id === preset.foil).swatch }}><Sparkles size={15}/></span></span>
        <span className="holo-look-copy"><strong>{preset.label}</strong><small>{preset.caption}</small></span>{activePreset === preset.id && <Check className="holo-look-check" size={12}/>}</button>)}</div>}
      {section === 'finishes' && <div className="holo-library-finishes" role="group" aria-label="全部材质">{FINISHES.map(item => <button type="button" key={item.id} aria-label={`${item.label}材质`} aria-pressed={settings.foil === item.id} title={item.description} disabled={disabled} onClick={() => onChange('foil', item.id)}>
        <span className={`holo-material-orb is-${item.id}`} style={{ '--finish-swatch': item.swatch }} aria-hidden="true">{settings.foil === item.id && <Check size={14}/>}</span><span>{item.label}</span></button>)}</div>}
      {section === 'patterns' && <div className="holo-patterns" role="group" aria-label="视觉纹理">{PATTERNS.map(item => <button type="button" key={item.id} title={item.description} aria-label={`${item.label}纹理`} disabled={disabled || settings.foil === 'original'} aria-pressed={(settings.pattern || 'flow') === item.id} onClick={() => onChange('pattern', item.id)}>
        <span className={`holo-pattern-preview is-${item.id}`} aria-hidden="true"><i/><i/><i/></span><span>{item.label}</span>
      </button>)}</div>}
      {section === 'motion' && <>
        <div className="holo-play-title">巡游轨迹<span>{reduced || settings.paused ? '记住轨迹，恢复互动后体验' : '选择即开始体验'}</span></div>
        <div className="holo-motion-grid" role="group" aria-label="巡游轨迹">{MOTION_STYLES.map(item => <button type="button" key={item.id} aria-label={`${item.label}轨迹`} aria-pressed={motion.id === item.id} title={item.description} disabled={disabled} onClick={() => onPatch({ orbitStyle: item.id, ...(!reduced && !settings.paused ? { autoOrbit: true, exploded: false } : {}) })}>
          <svg viewBox="0 0 64 50" aria-hidden="true"><path d={item.path}/><path className="holo-motion-path-light" d={item.path}/></svg><span>{item.label}</span></button>)}</div>
        <div className="holo-play-title">瞬间光效<span>选择后点亮卡片</span></div>
        <div className="holo-shine-grid" role="group" aria-label="瞬间光效">{SHINE_STYLES.map(item => <button type="button" key={item.id} aria-label={`${item.label}光效`} aria-pressed={shine.id === item.id} disabled={disabled || settings.foil === 'original'} title={item.description} onClick={() => onChange('shineStyle', item.id)}><span className={`holo-shine-icon is-${item.id}`} aria-hidden="true"/><span>{item.label}</span></button>)}</div>
      </>}
    </div>
    <div className="holo-library-selection" aria-live="polite"><span style={{ background: finish.swatch }}/>{finish.label}{settings.foil !== 'original' && <> · {pattern.label}</>}<small>{activePreset ? VISUAL_PRESETS.find(item => item.id === activePreset).label : '自由搭配'}</small></div>
    <div className="holo-play-actions">
      <button type="button" aria-label="光影巡游" aria-pressed={Boolean(settings.autoOrbit)} disabled={disabled || reduced} onClick={() => onPatch({ autoOrbit: !settings.autoOrbit, ...(!settings.autoOrbit ? { exploded: false } : {}) })}><Orbit size={17}/><span>光影巡游<small>{settings.autoOrbit ? (reduced ? '已减少动态，巡游暂缓' : settings.paused ? '已静止，恢复互动后继续' : settings.exploded ? '拆层中，合拢后继续巡游' : `${motion.label}中，拖动可接管`) : `${motion.label} · 自动捕捉流光`}</small></span><i/></button>
      <button type="button" aria-label="透视拆层" aria-pressed={Boolean(settings.exploded)} disabled={disabled || (!canExplode && !settings.exploded)} onClick={() => onChange('exploded', !settings.exploded)}><Layers size={17}/><span>透视拆层<small>{settings.exploded ? '点击合拢图层' : !canExplode ? '采用透明主体后可展开图层' : '展开前景与背景的距离'}</small></span><i/></button>
      <button type="button" className="holo-play-shine" aria-label="点亮卡片" onClick={onShine} disabled={disabled || reduced || settings.paused || settings.foil === 'original'}><Sparkles size={17}/><span>点亮瞬间<small>{shine.label} · 双击卡面也可触发</small></span><span className="holo-play-arrow">↗</span></button>
    </div>
    {reduced && <p className="holo-play-note">已遵循系统的减少动态效果设置。</p>}
    {settings.foil === 'original' && <p className="holo-play-note">切换镭射材质后可使用纹理与扫光。</p>}
  </div>;
}
