import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/views/TextToImageView.jsx";
import { GenerationButtonContent } from "../../src/features/text-to-image/TaskStateIndicator.jsx";
import { generationButtonState } from "../../src/features/text-to-image/generationButtonState.js";
import "./t2i-button-preview.css";

const retryBatch = (full = false) => ({ entries: [{ payload: { expectedUnitPriceCents: 2 } }, { payload: { expectedUnitPriceCents: 2 }, error: full ? { code: 'user_task_limit' } : null }] });
const states = [
  ["可生成", { generationCost: 2, count: 1 }], ["多张生成", { generationCost: 8, count: 4 }],
  ["免费模型", { generationCost: 0, count: 1 }], ["等待输入", { hasPrompt: false, generationCost: 2 }],
  ["核算费用", { quoting: true, generationCost: 8, count: 4 }], ["等待确认", { confirmation: { total: 8, count: 4 } }],
  ["上传参考图", { submitting: true, submissionPhase: "uploading", generationCost: 8, count: 4 }],
  ["提交任务", { submitting: true, submissionPhase: "submitting", generationCost: 8, count: 4 }],
  ["核对结果", { submissionPhase: "recovering", generationCost: 8, count: 4 }],
  ["已有任务生成中", { taskCounts: { running: 4 }, generationCost: 8, count: 4 }],
  ["补交剩余图片", { pendingBatch: retryBatch() }], ["队列已满", { pendingBatch: retryBatch(true) }],
];

function Button({ options, onClick, label }) {
  const state = generationButtonState(options);
  return <button className="t2i-generate" data-state={state.state} aria-busy={state.busy} disabled={state.disabled} title={state.title} aria-label={label} onClick={onClick}>
    <GenerationButtonContent state={state.state} label={state.label} points={state.points} />
  </button>;
}

function Preview() {
  const [light, setLight] = useState(true);
  const [narrow, setNarrow] = useState(false);
  const [options, setOptions] = useState({ generationCost: 8, count: 4 });
  const [notice, setNotice] = useState("");
  const [probe, setProbe] = useState("");
  const demo = useRef(null);
  const frameRef = useRef(0);
  const timers = useRef([]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); cancelAnimationFrame(frameRef.current); }, []);
  const play = (fast = false) => {
    timers.current.forEach(clearTimeout); timers.current = [];
    setOptions({ generationCost: 8, count: 4, submitting: true, submissionPhase: fast ? "submitting" : "uploading" });
    if (!fast) timers.current.push(setTimeout(() => setOptions({ generationCost: 99, count: 1, submitting: true, submissionPhase: "submitting" }), 1000));
    timers.current.push(setTimeout(() => setOptions({ generationCost: 8, count: 4, taskCounts: { running: 4 } }), fast ? 30 : 2400));
    cancelAnimationFrame(frameRef.current);
    const samples = [];
    const start = performance.now();
    const sample = () => {
      const button = demo.current.querySelector('.t2i-generate');
      samples.push({ opacity: Number(getComputedStyle(button).opacity), text: button.textContent });
      if (performance.now() - start < (fast ? 350 : 2800)) frameRef.current = requestAnimationFrame(sample);
      else setProbe(fast
        ? `短请求：按钮最低透明度 ${Math.min(...samples.map(item => item.opacity))}，提交字样出现 ${samples.filter(item => item.text.includes('正在提交')).length} 帧`
        : `提交过程：费用改变 ${samples.filter(item => item.text.includes('99')).length} 帧，按钮最低透明度 ${Math.min(...samples.map(item => item.opacity))}`);
    };
    frameRef.current = requestAnimationFrame(sample);
  };
  return <main className={`t2i-page button-preview${light ? " is-light" : ""}`}>
    <div className="button-preview-inner"><header><div><p>单行布局 · 清晰费用</p><h1>生成按钮</h1></div><button className="preview-control" onClick={() => setLight(value => !value)}>切换亮暗模式</button></header>
      <section className="button-preview-demo"><div ref={demo} style={{ width: narrow ? 240 : 300, maxWidth: "100%" }}><Button options={options} onClick={() => play()} label="播放提交过程" /></div><p>点按钮查看上传 → 提交 → 继续生成。提交期间费用保持不变。</p>
        <div className="button-preview-controls"><button className="preview-control" onClick={() => setNarrow(value => !value)}>切换窄宽度</button><button className="preview-control" onClick={() => play(true)}>短请求检查</button><button className="preview-control" onClick={() => setOptions({ generationCost: 8, count: 4 })}>恢复初始状态</button></div>
        <output aria-label="按钮交互检查">{probe}</output>
      </section>
      <div className="button-preview-grid">{states.map(([title, value]) => <section key={title} aria-label={title}><h2>{title}</h2><div style={{ width: narrow ? 240 : 300, maxWidth: "100%" }}><Button options={value} onClick={() => setNotice(`${title}：仅界面样例，不创建任务`)} /></div></section>)}</div>
      <p className="button-preview-notice">{notice || "此页面不会创建任务或消耗积分。"}</p>
    </div>
  </main>;
}

createRoot(document.getElementById("root")).render(<Preview />);
