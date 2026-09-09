import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, ArrowUpRight, Check, Download, FlipHorizontal2, Info, Layers, LoaderCircle, Pause, Play, RotateCcw, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { zipSync, strToU8 } from 'fflate';
import { HoloAtmosphere } from '../features/holo-card/HoloAtmosphere.jsx';
import { HoloPlayControls, useHoloReducedMotion } from '../features/holo-card/HoloPlayControls.jsx';
import { FINISHES as ALL_FINISHES } from '../features/holo-card/holoVisualCatalog.js';
import { HoloFeedback, HoloLoadingState, useHoloFeedback } from '../features/holo-card/HoloFeedback.jsx';
import { SampleReliefStage } from '../features/holo-card/SampleReliefStage.jsx';
import { ASTRAL_SAMPLE } from '../features/holo-card/astral-design-layers.js';
import { ASTRAL_TEMPLATE_SETTINGS } from '../features/holo-card/holoTemplates.js';
import { downloadCardBlob } from '../features/holo-card/holoCardImages.js';
import './holo-card-sample.css';

const FINISHES = [['spectrum', '镭射'], ['gold', '烫金'], ['silver', '银箔'], ['pearl', '珠光'], ['original', '原画']];
const DEFAULTS = ASTRAL_TEMPLATE_SETTINGS;
gsap.registerPlugin(useGSAP);

export function HoloCardSampleView() {
  const stageRef = useRef(null), mounted = useRef(true);
  const pageRef = useRef(null), popupRef = useRef(null), popupTriggerRef = useRef(null);
  const lightingButtonRef = useRef(null), infoButtonRef = useRef(null), moreButtonRef = useRef(null);
  const [settings, setSettings] = useState(DEFAULTS);
  const [panel, setPanel] = useState('');
  const [renderedPanel, setRenderedPanel] = useState('');
  const [librarySection, setLibrarySection] = useState('presets');
  const reducedMotion = useHoloReducedMotion();
  const feedback = useHoloFeedback();
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const change = (key, value) => setSettings(current => ({ ...current, [key]: value }));
  const extendedFinish = !FINISHES.some(([id]) => id === settings.foil) && ALL_FINISHES.find(item => item.id === settings.foil);

  useGSAP(() => {
    const media = gsap.matchMedia();
    let introduced = false;
    media.add({ reduced: '(prefers-reduced-motion: reduce)', normal: '(prefers-reduced-motion: no-preference)' }, ({ conditions }) => {
      if (introduced) return;
      introduced = true;
      if (conditions.reduced) return;
      gsap.from('[data-sample-enter]', { y: 12, autoAlpha: 0, duration: .58, stagger: .045, ease: 'power3.out', clearProps: 'transform,opacity,visibility' });
      gsap.from('.holo-sample-stage', { y: 16, autoAlpha: 0, duration: .76, ease: 'power3.out', clearProps: 'transform,opacity,visibility' });
    }, pageRef);
    return () => media.revert();
  }, { scope: pageRef });

  useGSAP(() => {
    if (!renderedPanel || !popupRef.current) return;
    if (reducedMotion) {
      gsap.set(popupRef.current, { autoAlpha: panel ? 1 : 0, y: 0 });
      if (!panel) setRenderedPanel('');
      return;
    }
    if (panel) gsap.set(popupRef.current, { visibility: 'visible', opacity: .4, y: 8 });
    gsap.to(popupRef.current, { autoAlpha: panel ? 1 : 0, y: panel ? 0 : 8, duration: panel ? .28 : .2, ease: 'power3.out', overwrite: true,
      onComplete: () => { if (!panel) setRenderedPanel(''); },
    });
  }, { scope: pageRef, dependencies: [panel, renderedPanel] });
  useGSAP(() => {
    if (!reducedMotion || !popupRef.current) return;
    gsap.killTweensOf(popupRef.current);
    gsap.set(popupRef.current, { autoAlpha: panel ? 1 : 0, y: 0 });
    if (!panel) setRenderedPanel('');
  }, { scope: pageRef, dependencies: [reducedMotion] });

  const closePanel = () => {
    setPanel('');
    popupTriggerRef.current?.focus({ preventScroll: true });
  };
  const togglePanel = (nextPanel, event) => {
    popupTriggerRef.current = event.currentTarget;
    if (panel === nextPanel) setPanel('');
    else { setRenderedPanel(nextPanel); setPanel(nextPanel); }
  };

  useEffect(() => {
    if (!panel) return;
    const frame = requestAnimationFrame(() => popupRef.current?.querySelector('button')?.focus({ preventScroll: true }));
    const onKeyDown = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setPanel('');
      popupTriggerRef.current?.focus({ preventScroll: true });
    };
    const onPointerDown = event => {
      if (popupRef.current?.contains(event.target) || lightingButtonRef.current?.contains(event.target) || infoButtonRef.current?.contains(event.target) || moreButtonRef.current?.contains(event.target)) return;
      setPanel('');
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [panel]);

  useEffect(() => {
    mounted.current = true;
    const title = document.title; document.title = '星间旅人 · 浮雕样卡';
    return () => { mounted.current = false; document.title = title; };
  }, []);
  async function exportCard() {
    if (!ready || busy) return;
    setBusy('image'); setError('');
    try { const blob = await stageRef.current.exportPng(); if (mounted.current) { downloadCardBlob(blob, `astral-${settings.flipped ? 'back' : 'front'}.png`); feedback.notify('PNG 下载已开始', 'export'); } }
    catch (e) { if (mounted.current) setError(e.message || '导出失败'); }
    finally { if (mounted.current) setBusy(''); }
  }
  async function exportPack() {
    if (!ready || busy) return;
    setBusy('pack'); setError('');
    try {
      const files = {};
      for (const [name, url] of Object.entries(ASTRAL_SAMPLE.assets)) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${name} 图层读取失败`);
        files[`${name}.png`] = new Uint8Array(await response.arrayBuffer());
      }
      const text = await stageRef.current.exportTextPng();
      files['text.png'] = new Uint8Array(await text.arrayBuffer());
      files['card-config.json'] = strToU8(JSON.stringify({
        version: 1, title: settings.title, subtitle: settings.subtitle, collection: settings.collection, edition: settings.edition,
        sourceMode: 'relief', canvas: { width: 1024, height: 1536 },
        parameters: { foil: settings.foil, foilStrength: settings.foilStrength, depth: settings.depth, pattern: settings.pattern, exploded: settings.exploded, autoOrbit: settings.autoOrbit, orbitStyle: settings.orbitStyle, shineStyle: settings.shineStyle },
        assets: { subject: 'subject.png', background: 'background.png', effects: 'effects.png', text: 'text.png' },
        provenance: '主体复用项目已有透明立绘，字节未改动。背景、前景星轨、文字为原创代码原生设计。本次未生成新的AI画作。',
      }, null, 2));
      files['README.txt'] = strToU8('星间旅人 · 浮雕样卡\n\n四层画布同为1024×1536。主体PNG保留项目已有透明立绘原始字节；背景、前景图形与文字分别制作。\n对应网页 /holo-card/sample，可交互倾斜、翻转与比较平面/浮雕。PNG快照为静态图片；此素材包不含网页运行代码。\n内置生图工具本次返回503，未生成月狐等新画作，本样卡不用于声称image2自动分层质量已验证。\n');
      const zipped = zipSync(files, { level: 0 });
      if (mounted.current) { downloadCardBlob(new Blob([zipped], { type: 'application/zip' }), 'astral-relief-card-assets.zip'); feedback.notify('分层素材下载已开始', 'export'); }
    } catch (e) { if (mounted.current) setError(e.message || '素材包导出失败'); }
    finally { if (mounted.current) setBusy(''); }
  }

  return <main ref={pageRef} className="holo-sample-page" data-tone={settings.foil} data-paused={settings.paused}>
    <HoloAtmosphere paused={settings.paused} tone={settings.foil}/>
    <HoloFeedback feedback={feedback.feedback} onDismiss={feedback.dismiss}/>
    <header className="holo-sample-topbar" data-sample-enter>
      <Link to="/holo-card"><ArrowLeft size={16}/><span>返回工作台</span></Link>
      <div className="holo-sample-brand"><Sparkles size={16}/><span>STARCLOUDS <small>卡片展厅</small></span></div>
      <button type="button" className="holo-sample-save" onClick={exportCard} disabled={!ready || Boolean(busy)}>{busy === 'image' ? <LoaderCircle className="sample-spin" size={15}/> : feedback.feedback?.kind === 'export' ? <Check size={15}/> : <Download size={15}/>}保存画面</button>
    </header>
    <section className="holo-sample-body" aria-label="星间旅人展厅">
      <div className="holo-sample-story" data-sample-enter>
        <p className="holo-sample-kicker"><span/>典藏 · 001</p>
        <h1>星间旅人</h1>
        <p className="holo-sample-english">ASTRAL TRAVELER</p>
        <p className="holo-sample-poem">循光而行，万象入梦。</p>
        <Link className="holo-sample-create-own" to="/holo-card?template=astral">制作同款<ArrowUpRight size={13}/></Link>
      </div>

      <div className="holo-sample-stage">
        <SampleReliefStage assets={ASTRAL_SAMPLE.assets} settings={settings} stageRef={stageRef} onReady={setReady} onError={setError}/>
        <HoloLoadingState active={!ready && !error} label="正在点亮星光"/>
      </div>

      <div className="holo-sample-presentation" data-sample-enter>
        <button type="button" className="holo-sample-relief-toggle" aria-label={settings.depth > 0 ? '切换为平面对照' : '切换为浮雕层次'} aria-pressed={settings.depth > 0} onClick={() => change('depth', settings.depth > 0 ? 0 : 1)}><Layers size={15}/><span>{settings.depth > 0 ? '浮雕层次' : '平面对照'}</span><i aria-hidden="true"/></button>
        <span className="holo-sample-face">{settings.flipped ? '背面 / 02' : '正面 / 01'}</span>
      </div>

      <div className="holo-sample-art-meta" data-sample-enter>
        <span className="holo-sample-meta-caption">四层光影，一瞬流转</span>
        <button ref={infoButtonRef} type="button" className="holo-sample-info-trigger" aria-haspopup="dialog" aria-expanded={panel === 'info'} aria-controls={panel === 'info' ? 'holo-sample-info' : undefined} onClick={event => togglePanel('info', event)}><Info size={14}/>作品信息<ArrowUpRight size={13}/></button>
      </div>

      <div className="holo-sample-bottom" data-sample-enter>
        <p className="holo-sample-hint"><span className="holo-sample-hint-pointer" aria-hidden="true"/>{settings.paused ? '画面已静止 · 仍可翻面与切换材质' : '移动鼠标，追随光的方向'}<span className="holo-sample-touch-hint">轻拖卡片，感受立体层次</span></p>
        <div className="holo-sample-dock" data-holo-preserve-pose>
          <div className="holo-sample-finishes" role="group" aria-label="样卡材质">{FINISHES.map(([value, label]) => <button type="button" key={value} aria-label={label} aria-pressed={settings.foil === value} onClick={() => change('foil', value)}><i className={`sample-finish-${value}`} aria-hidden="true">{settings.foil === value && <Check size={12}/>}</i><span>{label}</span></button>)}<button ref={moreButtonRef} type="button" className="holo-sample-more" aria-label="更多材质" aria-pressed={Boolean(extendedFinish)} aria-haspopup="dialog" aria-expanded={panel === 'lighting'} onClick={event => { popupTriggerRef.current = event.currentTarget; setLibrarySection('finishes'); setRenderedPanel('lighting'); setPanel('lighting'); }}><i style={extendedFinish ? { background: extendedFinish.swatch } : undefined} aria-hidden="true">{extendedFinish ? <Check size={12}/> : <Sparkles size={14}/>}</i><span>{extendedFinish ? extendedFinish.label : '更多'}</span></button></div>
          <div className="holo-sample-controls" role="group" aria-label="样卡交互">
            <button type="button" aria-label="翻转样卡" onClick={() => change('flipped', !settings.flipped)} disabled={!ready}><FlipHorizontal2 size={17}/><span>翻面</span></button>
            <button type="button" aria-label={settings.paused ? '启用样卡交互' : '静止样卡'} aria-pressed={settings.paused} onClick={() => change('paused', !settings.paused)} disabled={!ready}>{settings.paused ? <Play size={16}/> : <Pause size={16}/>}<span>{settings.paused ? '互动' : '静止'}</span></button>
            <button type="button" aria-label="复位样卡" onClick={() => { setSettings(DEFAULTS); stageRef.current?.reset(); }} disabled={!ready}><RotateCcw size={16}/><span>复位</span></button>
            <button ref={lightingButtonRef} type="button" aria-label="光效设置" aria-haspopup="dialog" aria-expanded={panel === 'lighting'} aria-controls={panel === 'lighting' ? 'holo-sample-lighting' : undefined} onClick={event => togglePanel('lighting', event)}><SlidersHorizontal size={16}/><span>光效</span></button>
          </div>
        </div>
      </div>

      {renderedPanel && <aside ref={popupRef} id={`holo-sample-${renderedPanel}`} className={`holo-sample-popup holo-sample-popup-${renderedPanel}`} role="dialog" aria-modal="false" aria-hidden={!panel || undefined} inert={!panel} aria-labelledby="holo-sample-popup-title" data-holo-preserve-pose>
        <div className="holo-sample-popup-heading"><h2 id="holo-sample-popup-title">{renderedPanel === 'lighting' ? '光效设置' : '关于这张卡'}</h2><button type="button" aria-label="关闭面板" onClick={closePanel}><X size={16}/></button></div>
        {renderedPanel === 'lighting' ? <>
          <p className="holo-sample-popup-description holo-sample-library-intro">为这张卡，找到另一种光。</p>
          <label className="holo-sample-range">光泽强度<output>{Math.round(settings.foilStrength * 100)}%</output><input aria-label="样卡光泽" type="range" min="0" max="1" step=".01" value={settings.foilStrength} disabled={settings.foil === 'original'} onChange={event => change('foilStrength', Number(event.target.value))}/><span>柔和</span><span>闪耀</span></label>
          <HoloPlayControls settings={settings} onChange={change} onPatch={patch => setSettings(current => ({ ...current, ...patch }))} section={librarySection} onSectionChange={setLibrarySection} onShine={() => stageRef.current?.shine()} disabled={!ready}/>
        </> : <>
          <p className="holo-sample-popup-description">背景、人物、光屑与文字各自悬浮，让每一次转动都有新的风景。</p>
          <ol className="holo-sample-layer-list"><li><span>01</span>背景星轨<i/></li><li><span>02</span>透明立绘<i/></li><li><span>03</span>前景光屑<i/></li><li><span>04</span>独立文字<i/></li></ol>
          <button type="button" className="holo-sample-download" onClick={exportPack} disabled={!ready || Boolean(busy)}>{busy === 'pack' ? <LoaderCircle className="sample-spin" size={15}/> : <Download size={15}/>}下载分层素材<ArrowUpRight size={14}/></button>
          <small className="holo-sample-source">已有角色素材 · 原创星轨版式</small>
        </>}
      </aside>}
      {error && <p className="holo-sample-error" role="alert">{error}</p>}
    </section>
  </main>;
}
