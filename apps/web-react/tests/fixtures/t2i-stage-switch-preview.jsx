import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { stageAspectValue, stageFrameStyle, stageGridLayout } from "../../src/views/TextToImageView.jsx";
import { StageTransition, stageMediaKey } from "../../src/features/text-to-image/StageTransition.jsx";
import { GenerationReveal } from "../../src/features/text-to-image/GenerationReveal.jsx";
import { ProgressiveAuthenticatedImage } from "../../src/components/ProgressiveAuthenticatedImage.jsx";
import "./t2i-stage-switch-preview.css";

function sample(width, height, color, text) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${color}"/><circle cx="${width*.72}" cy="${height*.32}" r="${height*.18}" fill="#ffffff44"/><path d="M0 ${height*.75} Q${width*.25} ${height*.32} ${width*.53} ${height*.72} T${width} ${height*.56}V${height}H0Z" fill="#ffffff22"/><text x="7%" y="85%" font-family="sans-serif" font-size="${Math.min(width,height)*.12}" fill="white">${text}</text></svg>`);
}
const groups = [
  { key: 'wide', title: '横幅 1920×600', items: [{ key:'wide-image', src:sample(1920,600,'#326a83','WIDE'), delay:0 }] },
  { key: 'portrait', title: '竖图（慢加载）', items: [{ key:'portrait-image', src:sample(600,1000,'#8264a1','PORTRAIT'), delay:1000 }] },
  { key: 'square', title: '方图', items: [{ key:'square-image', src:sample(720,720,'#b78256','SQUARE'), delay:0 }] },
  { key: 'four', title: '四张一组', items: [0,1,2,3].map(i=>({ key:`four-${i}`, src:sample(600,900,['#537e76','#7b75a1','#a16c7b','#8d875c'][i],`0${i+1}`), delay:120+i*140 })) },
  { key: 'broken', title: '读取失败', items: [{ key:'broken-image', src:'data:image/png;base64,broken', delay:0 }] },
];

function LoadedImage({ item, handlers }) {
  const [show, setShow] = useState(!item.delay);
  useEffect(() => { const timeout = setTimeout(()=>setShow(true),item.delay); return ()=>clearTimeout(timeout); }, [item.delay]);
  return show ? <ProgressiveAuthenticatedImage src={item.src} alt={item.key} loading="eager" loadOriginal hideStatus retryCount={0} onLoad={handlers.onReady} onPreviewLoad={handlers.onPreviewReady} onOriginalError={handlers.onFailure} onError={handlers.onFailure} /> : null;
}

function Preview() {
  const [selected, setSelected] = useState('wide');
  const [sizes, setSizes] = useState({});
  const [light, setLight] = useState(true);
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState('等待检查');
  const root = useRef(null), timeouts = useRef([]), frame = useRef(0);
  const metrics = useRef(null);
  const group = groups.find(item=>item.key===selected);
  const remember = useCallback((key,width,height)=>setSizes(current=>current[key]===`${width} / ${height}` ? current : {...current,[key]:`${width} / ${height}`}),[]);
  useEffect(() => { document.documentElement.classList.toggle('settings-no-animations',paused); return()=>document.documentElement.classList.remove('settings-no-animations'); },[paused]);
  useEffect(() => () => { cancelAnimationFrame(frame.current); timeouts.current.forEach(clearTimeout); },[]);
  const inspect = useCallback(() => {
    const check = metrics.current;
    if (!check) return;
    const scenes = [...root.current.querySelectorAll('.t2i-stage-scene')];
    check.frames++;
    check.layers = Math.max(check.layers,scenes.length);
    if (root.current.querySelector('.t2i-stage-workspace').scrollTop !== 0) check.scrolls++;
    if (!scenes.some(el=>Number(getComputedStyle(el).opacity)>.98 && el.dataset.stageReady==='true')) check.blank++;
    for (const scene of scenes) {
      if (Number(getComputedStyle(scene).opacity)<.02 || scene.dataset.stageReady!=='true') continue;
      const r = scene.querySelector('.t2i-stage-frame').getBoundingClientRect();
      const before = check.bounds.get(scene.dataset.stageKey);
      if (before && (Math.abs(before.width-r.width)>1 || Math.abs(before.height-r.height)>1)) check.jumps++;
      check.bounds.set(scene.dataset.stageKey,{width:r.width,height:r.height});
    }
    const transition = root.current.querySelector('.t2i-stage-transition');
    if (check.frames>3 && !timeouts.current.length && transition.getAttribute('aria-busy')==='false') {
      setResult(`采样 ${check.frames} 帧 · 空白 ${check.blank} 帧 · 尺寸跳变 ${check.jumps} 次 · 外层滚动 ${check.scrolls} 帧 · 最多 ${check.layers} 层 · 最终 ${scenes[0]?.dataset.stageKey}`);
      metrics.current=null;
    } else frame.current=requestAnimationFrame(inspect);
  },[]);
  const switchTo = key => { setSelected(key); };
  const run = rapid => {
    cancelAnimationFrame(frame.current); timeouts.current.forEach(clearTimeout); timeouts.current=[];
    metrics.current={frames:0,blank:0,jumps:0,scrolls:0,layers:0,bounds:new Map()};
    setResult('检查中');
    const sequence = rapid ? ['portrait','four','square'] : ['portrait'];
    sequence.forEach((key,index) => {
      const timer=setTimeout(()=>{setSelected(key);timeouts.current=timeouts.current.filter(id=>id!==timer);}, index*(rapid?80:0));
      timeouts.current.push(timer);
    });
    frame.current=requestAnimationFrame(inspect);
  };
  const task = { aspectRatio:'auto', actualOutputSize:'auto', status:'completed' };
  const aspect = stageAspectValue(task,sizes[group.items[0].key]);
  const layout = stageGridLayout(group.items.length,aspect,2);
  const style = { ...stageFrameStyle(task,sizes[group.items[0].key]), ...(layout ? { aspectRatio:String(layout.ratio),'--t2i-stage-fit-width':`${layout.ratio*100}cqh` } : {}) };
  return <main ref={root} className={`t2i-page stage-switch-preview${light?' is-light':''}`}>
    <header><h1>画布切换检查</h1><button onClick={()=>setLight(value=>!value)}>切换亮暗模式</button><button onClick={()=>setPaused(value=>!value)}>{paused?'恢复动画':'减少动画'}</button><button onClick={()=>run(false)}>慢加载检查</button><button onClick={()=>run(true)}>快速连点检查</button></header>
    <section className="t2i-panel t2i-panel--stage preview-switch-panel"><div className="t2i-stage-workspace"><div className="t2i-stage">
    <div className="t2i-stage-canvas preview-switch-canvas"><StageTransition sceneKey={group.key} mediaKeys={group.items.map(item=>stageMediaKey(item.key,item.src))} onImageSize={remember}>
      <div className="t2i-stage-frame" style={style}>{layout ? <div className="t2i-stage-grid" style={{'--t2i-grid-cols':layout.columns}}>{group.items.map(item=><div className="t2i-stage-cell" key={item.key}><GenerationReveal complete sourceKey={item.src} mediaKey={item.key}>{handlers=><div className="t2i-stage-cell-media"><LoadedImage item={item} handlers={handlers}/></div>}</GenerationReveal></div>)}</div> : <GenerationReveal complete sourceKey={group.items[0].src} mediaKey={group.items[0].key}>{handlers=><div className="t2i-stage-media"><LoadedImage item={group.items[0]} handlers={handlers}/></div>}</GenerationReveal>}</div>
    </StageTransition></div>
    <div className="t2i-stage-bar">{group.title}</div>
    <nav className="t2i-filmstrip" aria-label="底部缩略图">{groups.map(item=><button className="t2i-film-item" key={item.key} aria-pressed={selected===item.key} onClick={()=>switchTo(item.key)}>{item.title}</button>)}</nav>
    </div></div></section>
    <output aria-label="切换检查结果">{result}</output><p>只读取本地样例，不创建生成任务。</p>
  </main>;
}
const previewRoot = import.meta.hot?.data.previewRoot || createRoot(document.getElementById('root'));
if (import.meta.hot) import.meta.hot.data.previewRoot = previewRoot;
previewRoot.render(<Preview/>);
