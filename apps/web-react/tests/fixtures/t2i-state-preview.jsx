import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { PendingStage, TaskStatusStage, TaskCancelDialog } from "../../src/views/TextToImageView.jsx";
import { GenerationButtonContent } from "../../src/features/text-to-image/TaskStateIndicator.jsx";
import { useReferenceDraft } from "../../src/features/text-to-image/useReferenceDraft.js";

function Preview() {
  const [light, setLight] = useState(true);
  const [notice, setNotice] = useState("");
  const [cancelTarget, setCancelTarget] = useState(null);
  const [fastState, setFastState] = useState("ready");
  const [flashResult, setFlashResult] = useState("");
  const [timingStep, setTimingStep] = useState(0);
  const [timingAdvance, setTimingAdvance] = useState(0);
  const [portraitPreview, setPortraitPreview] = useState(true);
  const [motionEnabled, setMotionEnabled] = useState(true);
  const { references, setReferences, referencesReady } = useReferenceDraft("queue-fix-visual-fixture");
  const states = [
    ["等待服务器接收", { status: "submitting" }],
    ["个人名额等待", { status: "queued", queueReason: "user_execution_limit" }],
    ["准备输入", { status: "running", generationStage: "preparing" }],
    ["模型生成", { status: "running", generationStage: "upstream_generating" }],
    ["保存结果", { status: "running", generationStage: "saving_result" }],
    ["队列已满", { status: "queue_full", error: "你的任务队列已满，请等已有任务结束后重试" }],
    ["结果待确认", { status: "submission_unknown", error: "提交结果暂未确认，参数已保留" }],
    ["生成失败", { status: "failed", error: "模型未返回图片" }],
  ];
  return <main className={`t2i-page${light ? " is-light" : ""}`} style={{ display: "block", height: "auto", minHeight: "100vh", overflow: "visible", padding: 24 }}>
    <h1>文生图状态验收</h1><button onClick={() => setLight(value => !value)}>切换主题</button>
    <button onClick={() => setPortraitPreview(value => !value)}>切换横竖图样例</button>
    <button onClick={() => { document.documentElement.classList.toggle("settings-no-animations", motionEnabled); setMotionEnabled(value => !value); }}>{motionEnabled ? "暂停动画样例" : "恢复动画样例"}</button>
    <section id="generation-motion-preview" aria-label="沉浸生成动画" style={{ display: "grid", gridTemplateColumns: portraitPreview ? "repeat(4,minmax(0,1fr))" : "repeat(2,minmax(0,1fr))", gap: 4, maxWidth: 1040, marginTop: 20, borderRadius: 20, overflow: "hidden" }}>
      {[0, 1, 2, 3].map(index => <div key={index} style={{ position: "relative", aspectRatio: portraitPreview ? "9 / 16" : "16 / 9" }}>
        <PendingStage task={{ status: "running", generationStage: "upstream_generating", createdAt: "2026-09-09T00:00:00Z", startedAt: "2026-09-09T00:00:45Z" }} now={Date.parse("2026-09-09T00:00:56Z")} batchIndex={index} />
      </div>)}
    </section>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 16, marginTop: 20 }}>
      {states.map(([title, values], index) => {
        const task = { id: String(index), serverJobId: values.status.startsWith("submission") || values.status === "submitting" || values.status === "queue_full" ? "" : String(index), prompt: "状态动画验收示例", createdAt: new Date(Date.now() - 60000).toISOString(), startedAt: new Date(Date.now() - 20000).toISOString(), ...values };
        return <section key={title} aria-label={title}><h2 style={{ fontSize: 14 }}>{title}</h2><div style={{ position: "relative", height: 245, border: "1px solid var(--t2i-line)", borderRadius: 16, background: "var(--t2i-panel)" }}>
          {["submitting", "queued", "running"].includes(task.status) ? <PendingStage task={task} now={Date.now()} batchIndex={index} /> : <TaskStatusStage task={task} onEdit={() => setNotice(`编辑 ${title}`)} onDelete={() => setNotice(`删除 ${title}`)} />}
        </div></section>;
      })}
    </div>
    <section aria-label="排队转生成计时" style={{ marginTop: 24 }}>
      <h2>排队转生成计时</h2>
      <p>固定样例：提交后第56秒，四张图分别在第45、46、52、49秒开始生成。</p>
      <button onClick={() => { setTimingStep(0); setTimingAdvance(0); }}>模拟仍在排队</button>
      <button onClick={() => setTimingStep(1)}>模拟排队结束</button>
      <button onClick={() => setTimingAdvance(value => value + 10)}>推进10秒</button>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12, maxWidth: 760, marginTop: 12 }}>
        {[45, 46, 52, 49].map((start, index) => <div key={index} style={{ position: "relative", height: 260, border: "1px solid var(--t2i-line)", borderRadius: 16 }}>
          <PendingStage task={{ id: `timing-${index}`, status: timingStep ? "running" : "queued", generationStage: timingStep ? "upstream_generating" : "", createdAt: "2026-09-09T00:00:00Z", startedAt: timingStep ? new Date(Date.parse("2026-09-09T00:00:00Z") + start * 1000).toISOString() : "" }} now={Date.parse("2026-09-09T00:00:00Z") + (56 + timingAdvance) * 1000} batchIndex={index} />
        </div>)}
      </div>
    </section>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24 }}>
      {[ ["ready", "立即生成"], ["uploading", "正在上传参考图"], ["submitting", "正在提交"], ["recovering", "核对提交状态"], ["full", "队列已满 · 重试提交"] ].map(([state,label]) => <button key={state} className="t2i-generate" data-state={state} style={{ width: 240 }} onClick={() => setNotice(label)}><GenerationButtonContent state={state} label={label} detail={state === "full" ? "仅提交尚未接受的图片" : "本地状态样例"} /></button>)}
    </div>
    <section style={{ marginTop: 30 }}><h2>参考图刷新恢复</h2><p role="status">{referencesReady ? `参考图 ${references.length} 张` : "正在读取参考图"}</p>
      <button disabled={!referencesReady} onClick={() => {
        const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="), c => c.charCodeAt(0));
        const file = new File([bytes], "fixture.png", { type: "image/png" });
        setReferences([{ id: "fixture", name: file.name, file, url: "", preview: URL.createObjectURL(file) }]);
      }}>添加本地测试参考图</button><button onClick={() => setReferences([])}>清理测试参考图</button>
      {references.map(item => <img key={item.id} src={item.preview} alt={item.name} width="40" height="40" />)}
    </section>
    <button onClick={() => setCancelTarget({ id: "group", tasks: Array.from({ length: 4 }, (_, index) => ({ id: `task-${index}`, serverJobId: `task-${index}`, status: index === 0 ? "running" : "queued", cancelPolicy: { upstreamSubmitted: index === 0 } })) })}>查看同组取消说明</button>
    <TaskCancelDialog target={cancelTarget} light={light} onCancel={() => setCancelTarget(null)} onConfirm={() => { setNotice("已确认本组取消说明（界面样例）"); setCancelTarget(null); }} />
    <button className="t2i-generate" style={{ width: 240, marginTop: 16 }} aria-label="短请求闪烁检查" aria-busy={fastState === "submitting"} disabled={fastState === "submitting"} onClick={(event) => {
      const button = event.currentTarget;
      const samples = [];
      setFastState("submitting");
      window.setTimeout(() => setFastState("ready"), 30);
      const sample = () => { samples.push({ opacity: Number(getComputedStyle(button).opacity), text: button.textContent }); if (samples.length < 12) requestAnimationFrame(sample); else setFlashResult(`按钮最小透明度 ${Math.min(...samples.map(item => item.opacity))}；短请求提交标签出现 ${samples.filter(item => item.text.includes("正在提交")).length} 帧`); };
      requestAnimationFrame(sample);
    }}><GenerationButtonContent state={fastState} label={fastState === "submitting" ? "正在提交" : "立即生成"} detail="短请求按钮验收" /></button>
    <p role="status">{flashResult}</p><p>{notice}</p>
  </main>;
}
createRoot(document.querySelector("#root")).render(<Preview />);
