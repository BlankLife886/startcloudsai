import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PendingStage } from "../../src/views/TextToImageView.jsx";
import { GenerationReveal } from "../../src/features/text-to-image/GenerationReveal.jsx";
import { particleRenderStats } from "../../src/features/text-to-image/GenerationParticleField.jsx";
import { ProgressiveAuthenticatedImage } from "../../src/components/ProgressiveAuthenticatedImage.jsx";
import "./t2i-motion-options.css";

const STYLES = [
  { id: "particle-logo", name: "粒子 Logo", description: "粒子组成云朵、星芒与星环，缓慢聚散呼吸" },
  { id: "particle-wave", name: "粒子潮汐", description: "细密粒子铺满卡片，形成缓缓流动的波纹" },
  { id: "particle-stars", name: "星尘漂浮", description: "不同远近的星尘缓慢漂浮与闪烁" },
];
const STAGES = [
  { id: "queued", label: "排队", status: "queued", generationStage: "" },
  { id: "generating", label: "生成", status: "running", generationStage: "upstream_generating" },
];
const START = Date.parse("2026-09-09T00:00:00Z");

function Preview() {
  const [style, setStyle] = useState("particle-logo");
  const [dark, setDark] = useState(false);
  const [stage, setStage] = useState("generating");
  const [automatic, setAutomatic] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [count, setCount] = useState(4);
  const [portrait, setPortrait] = useState(true);
  const [paused, setPaused] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [imageDelay, setImageDelay] = useState(0);
  const [brokenImage, setBrokenImage] = useState(false);
  const [performanceOpen, setPerformanceOpen] = useState(false);
  const [stats, setStats] = useState(particleRenderStats);
  const [transitionCheck, setTransitionCheck] = useState("");
  const [hiddenCheck, setHiddenCheck] = useState("");
  const resultArea = useRef(null);
  useEffect(() => {
    if (!automatic || paused) return;
    const interval = window.setInterval(() => setSeconds(value => (value + 1) % 17), 1000);
    return () => window.clearInterval(interval);
  }, [automatic, paused]);
  useEffect(() => {
    document.documentElement.classList.toggle("settings-no-animations", paused);
    return () => document.documentElement.classList.remove("settings-no-animations");
  }, [paused]);
  useEffect(() => {
    if (!performanceOpen) return;
    const interval = window.setInterval(() => setStats(particleRenderStats()), 500);
    return () => window.clearInterval(interval);
  }, [performanceOpen]);
  const selectedStage = automatic ? STAGES[seconds < 3 ? 0 : 1] : STAGES.find(item => item.id === stage) || STAGES[1];
  const complete = completed || (automatic && seconds >= 11);
  const resultUrl = brokenImage ? "/tests/fixtures/unavailable-result.png" : "/game-art/wireframe-horizon.jpg";
  useEffect(() => {
    const inspectHidden = () => {
      if (!document.hidden) return;
      const snapshot = particleRenderStats();
      setHiddenCheck(`最近后台检查：回调 ${snapshot.callbacks} 个，画布 ${snapshot.canvasPixels} 像素`);
    };
    document.addEventListener("visibilitychange", inspectHidden);
    return () => document.removeEventListener("visibilitychange", inspectHidden);
  }, []);
  useEffect(() => {
    if (!complete) { setTransitionCheck(""); return; }
    let request, frames = 0, fades = 0, blanks = 0;
    const sample = () => {
      frames++;
      const rows = [...resultArea.current.querySelectorAll('.t2i-generation-reveal')];
      for (const row of rows) {
        const cover = row.querySelector('.t2i-generation-cover');
        const opacity = cover ? Number(getComputedStyle(cover).opacity) : 0;
        const hasImage = row.classList.contains('is-ready');
        const error = row.querySelector('[role="alert"]');
        if (opacity > 0.01 && opacity < 0.99) fades++;
        if (opacity < 0.98 && !hasImage && !error) blanks++;
      }
      const done = rows.every(row => !row.querySelector('.t2i-generation-cover'));
      if (done || frames >= 1200) { setTransitionCheck(`转场采样 ${frames} 帧 · 渐变 ${fades} 次 · 空白 ${blanks} 帧 · 剩余粒子画布 ${resultArea.current.querySelectorAll('canvas').length}`); return; }
      request = requestAnimationFrame(sample);
    };
    request = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(request);
  }, [complete, resultUrl]);
  const selectedStyle = STYLES.find(item => item.id === style) || STYLES[0];
  const task = {
    status: selectedStage.status, generationStage: selectedStage.generationStage,
    createdAt: new Date(START).toISOString(), startedAt: selectedStage.status === "queued" ? "" : new Date(START + 4000).toISOString(),
  };
  return <main className={`t2i-page motion-lab${dark ? "" : " is-light"}`}>
    <div className="motion-lab-inner">
      <header className="motion-lab-header"><div><p>品牌星云 · 动态预览</p><h1>让品牌标志参与每一次生成。</h1></div><button onClick={() => setDark(value => !value)}>{dark ? "浅色外观" : "深色外观"}</button></header>
      <div className="motion-lab-options" role="tablist" aria-label="动画方案">
        {STYLES.map((item, index) => <button key={item.id} role="tab" aria-selected={selectedStyle.id === item.id} onClick={() => setStyle(item.id)}><span className="motion-lab-option-number">0{index + 1}</span><span><strong>{item.name}</strong><small>{item.description}</small></span>{selectedStyle.id === item.id && <span className="motion-lab-selected" aria-hidden="true" />}</button>)}
      </div>
      <div className="motion-lab-toolbar">
        <div className="motion-lab-stages" role="group" aria-label="生成阶段">{STAGES.map(item => <button key={item.id} aria-pressed={selectedStage.id === item.id && !complete} onClick={() => { setAutomatic(false); setCompleted(false); setStage(item.id); }}>{item.label}</button>)}<button aria-pressed={complete} onClick={() => { setAutomatic(false); setImageDelay(0); setBrokenImage(false); setCompleted(true); }}>模拟生成完成</button></div>
        <div className="motion-lab-controls">
          <button aria-pressed={automatic} onClick={() => { setSeconds(0); setCompleted(false); setBrokenImage(false); setImageDelay(0); setAutomatic(value => !value); }}>{automatic ? "停止演示" : "播放完整过程"}</button>
          <button onClick={() => setCount(value => value === 4 ? 1 : 4)}>{count === 4 ? "查看单图" : "查看四张"}</button>
          <button onClick={() => setPortrait(value => !value)}>{portrait ? "切换横图" : "切换竖图"}</button>
          <button aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? "恢复动画" : "暂停动画"}</button>
        </div>
      </div>
      <section ref={resultArea} className="motion-lab-canvas" data-count={count} data-stress={count > 4} data-portrait={portrait} aria-label={`${selectedStyle.name}预览`}>
        {Array.from({ length: count }, (_, index) => <div key={index} className="motion-lab-cell" style={{ aspectRatio: count > 4 ? undefined : portrait ? "9 / 16" : "16 / 9" }}>
          <GenerationReveal complete={complete} sourceKey={resultUrl} pending={<PendingStage task={complete ? { ...task, status: "running", generationStage: "fetching_result" } : task} now={START + (automatic ? seconds : 15) * 1000} batchIndex={count > 1 ? index : undefined} motionStyle={selectedStyle.id} />}>
            {handlers => <PreviewResult {...handlers} src={resultUrl} delay={imageDelay} />}
          </GenerationReveal>
        </div>)}
      </section>
      <footer className="motion-lab-foot"><span>{selectedStyle.name} · {complete ? "完成转场" : selectedStage.label}</span><span>仅动画预览，不会创建任务或消耗积分</span></footer>
      <details className="motion-lab-performance" onToggle={event => setPerformanceOpen(event.currentTarget.open)}>
        <summary>多卡片性能与图片转场检查</summary>
        <div className="motion-lab-controls">{[1, 4, 12].map(value => <button key={value} onClick={() => { setCount(value); setCompleted(false); setAutomatic(false); setStage("generating"); }}>{value} 张同时生成</button>)}
          <button onClick={() => { setCompleted(true); setAutomatic(false); setBrokenImage(false); setImageDelay(2000); }}>模拟慢加载完成</button>
          <button onClick={() => { setCompleted(true); setAutomatic(false); setBrokenImage(true); setImageDelay(0); }}>模拟图片读取失败</button>
        </div>
        <output aria-label="粒子绘制统计">可见运行 {stats.active} 张 · 绘制回调 {stats.callbacks} 个 · 粒子 {stats.particles} 个 · 画布 {stats.canvasPixels} 像素 · 目标 {stats.targetFps} 帧/秒 · 平均绘制 {stats.averageDrawMs} ms · 累计绘制 {stats.renderedFrames} 次</output>
        <output aria-label="Logo轮廓缓存">Logo轮廓 {stats.logoShapePoints || 0} 个采样点 · 共享缓存 {((stats.logoShapeBytes || 0) / 1024).toFixed(1)} KB</output>
        <output aria-label="图片转场检查">{transitionCheck}</output>
        <output aria-label="后台暂停检查">{hiddenCheck}</output>
      </details>
    </div>
  </main>;
}

function PreviewResult({ src, delay, onReady, onPreviewReady, onFailure }) {
  const [show, setShow] = useState(delay === 0);
  useEffect(() => { const timer = window.setTimeout(() => setShow(true), delay); return () => window.clearTimeout(timer); }, [delay]);
  return show ? <ProgressiveAuthenticatedImage className="motion-lab-result" src={src} loading="eager" loadOriginal hideStatus retryCount={0} onLoad={onReady} onPreviewLoad={onPreviewReady} onOriginalError={onFailure} onError={onFailure} /> : null;
}

createRoot(document.getElementById("root")).render(<Preview />);
