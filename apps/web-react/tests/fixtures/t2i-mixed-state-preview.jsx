import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PendingStage, TaskStatusStage, TaskCancelDialog, stageFrameStyle, stageGridLayout } from '../../src/views/TextToImageView.jsx';
import { GenerationReveal } from '../../src/features/text-to-image/GenerationReveal.jsx';
import { StageTransition, stageMediaKey } from '../../src/features/text-to-image/StageTransition.jsx';
import { useSubmissionStage, showBatchRecovery } from '../../src/features/text-to-image/useSubmissionStage.js';
import { resolveStageGroupAspect } from '../../src/features/text-to-image/stageGroupGeometry.js';
import { ProgressiveAuthenticatedImage } from '../../src/components/ProgressiveAuthenticatedImage.jsx';
import './t2i-mixed-state-preview.css';

const START = Date.parse('2026-09-10T00:00:00Z');
const PHOTO = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1000"><rect width="100%" height="100%" fill="#536c91"/><circle cx="390" cy="280" r="130" fill="#b8cadb"/><path d="M0 800 300 400 600 760V1000H0Z" fill="#7891aa"/></svg>');
function batchRows(id, status = 'mixed') {
  return Array.from({length:4},(_,index)=>({id:`${id}-${index}`,clientRequestId:`${id}-${index}`,serverJobId:status==='submitting'?'':`${id}-${index}`,batchId:id,batchIndex:index,batchSize:4,
    status:status==='mixed'?(index===0?'running':'queued'):status,generationStage:index===0?'upstream_generating':'',aspectRatio:'16:9',
    createdAt:new Date(START).toISOString(),startedAt:index===0?new Date(START+1000).toISOString():'',
    cancelPolicy:{allowed:true,upstreamSubmitted:status==='mixed' && index===0},prompt:'混合状态的本地示例'}));
}

function Preview() {
  const [tasks,setTasks]=useState(()=>batchRows('initial'));
  const [latest,setLatest]=useState('initial'), [selected,setSelected]=useState('initial');
  const [pending,setPending]=useState(null), [submitting,setSubmitting]=useState(false);
  const [light,setLight]=useState(true), [target,setTarget]=useState(null), [notice,setNotice]=useState('');
  const [sizes,setSizes]=useState({}), [check,setCheck]=useState('等待检查');
  const stage=useSubmissionStage(tasks,latest), root=useRef(null), timer=useRef(0), frame=useRef(0), sequence=useRef(0), geometryRef=useRef(null);
  useEffect(()=>()=>{clearTimeout(timer.current);cancelAnimationFrame(frame.current);},[]);
  useLayoutEffect(()=>{if(stage.focusBatchId)setSelected(stage.focusBatchId);},[stage.focusBatchId]);
  const visible=stage.tasks.filter(task=>task.batchId===selected);
  const all=visible.length?visible:stage.tasks.filter(task=>task.batchId===stage.tasks[0]?.batchId);
  const key=all[0]?.batchId || 'none';
  const geometry=resolveStageGroupAspect({key,count:all.length,active:all.some(task=>['queued','running','submitting'].includes(task.status)),requested:'16 / 9',measured:sizes[all[0]?.id] || '16 / 9'},geometryRef.current);
  useLayoutEffect(()=>{geometryRef.current=geometry;},[geometry.key,geometry.aspect,geometry.locked]);
  const layout=stageGridLayout(all.length,geometry.aspect,2.1);
  const frameStyle={...stageFrameStyle({aspectRatio:'16:9'}),...(layout?{aspectRatio:String(layout.ratio),'--t2i-stage-fit-width':`${layout.ratio*100}cqh`}:{})};
  const sample = delay => {
    clearTimeout(timer.current); cancelAnimationFrame(frame.current);
    const id=`submit-${++sequence.current}`, rows=batchRows(id,'submitting');
    setLatest(id);setTasks(current=>[...rows,...current]);setPending({entries:rows.map(()=>({payload:{}}))});setSubmitting(true);setCheck('检查中');
    timer.current=setTimeout(()=>{setTasks(current=>[...batchRows(id),...current.filter(task=>task.batchId!==id)]);setSubmitting(false);setPending(null);},delay);
    const started=performance.now();let frames=0,placeholders=0,recovery=0;
    const inspect=()=>{
      frames++;
      const current=root.current.querySelector('[data-stage-role="current"]');
      if(current?.textContent.includes('正在提交'))placeholders++;
      if(root.current.querySelector('.t2i-batch-recovery'))recovery++;
      if(performance.now()-started<delay+650)frame.current=requestAnimationFrame(inspect);
      else setCheck(`采样 ${frames} 帧 · 提交占位 ${placeholders} 帧 · 补交提示 ${recovery} 帧`);
    };
    frame.current=requestAnimationFrame(inspect);
  };
  const confirm=()=>{
    const chosen=target.tasks || [target], ids=new Set(chosen.map(task=>task.id));
    setTasks(current=>current.map(task=>ids.has(task.id)?{...task,status:'canceled',error:task.cancelPolicy.upstreamSubmitted?'已停止接收结果':'排队已取消',finishedAt:new Date(START+12000).toISOString()}:task));
    setNotice(`模拟取消 ${chosen.length} 张；${chosen.filter(task=>!task.cancelPolicy.upstreamSubmitted).length} 张退回冻结积分`);setTarget(null);
  };
  return <main ref={root} className={`t2i-page mixed-preview${light?' is-light':''}`}>
    <header><h1>三张排队 · 一张生成</h1><button onClick={()=>setLight(value=>!value)}>切换亮暗模式</button><button onClick={()=>sample(30)}>模拟快速生成</button><button onClick={()=>sample(850)}>模拟慢提交</button><button onClick={()=>{setTasks(batchRows('initial'));setLatest('initial');setSelected('initial');setPending(null);setSubmitting(false);}}>恢复混合状态</button><button onClick={()=>setTasks(current=>current.map(task=>task.batchId===key && task.batchIndex===0?{...task,status:'completed',url:PHOTO}:task))}>第一张完成</button></header>
    <section className="t2i-main mixed-preview-main"><div className="t2i-panel t2i-panel--stage"><div className="t2i-stage-workspace"><div className="t2i-stage">
      <div className="t2i-stage-canvas"><StageTransition sceneKey={key} mediaKeys={all.filter(task=>task.url).map(task=>stageMediaKey(task.id,task.url))} onImageSize={(id,width,height)=>setSizes(current=>current[id]===`${width} / ${height}`?current:{...current,[id]:`${width} / ${height}`})}>
        <div className="t2i-stage-frame" style={frameStyle}><div className="t2i-stage-grid" style={{'--t2i-grid-cols':layout?.columns||2}}>{all.map((task,index)=><div className={`t2i-stage-cell${task.status==='canceled'?' is-status':task.url?'':' is-pending'}`} key={task.id}>
          {task.status==='canceled'?<TaskStatusStage task={task} batchIndex={index} onEdit={()=>setNotice('编辑样例')} onDelete={()=>setNotice('删除样例')}/>:<GenerationReveal complete={Boolean(task.url)} sourceKey={task.url||''} mediaKey={task.id} pending={<PendingStage task={task} now={START+12000} batchIndex={index} onCancel={task.url?undefined:()=>setTarget(task)}/>}>
            {handlers=><div className="t2i-stage-cell-media"><ProgressiveAuthenticatedImage src={task.url} loading="eager" loadOriginal hideStatus onLoad={handlers.onReady} onPreviewLoad={handlers.onPreviewReady} onError={handlers.onFailure}/></div>}
          </GenerationReveal>}
        </div>)}</div></div>
      </StageTransition></div>
      <div className="t2i-stage-bar"><span>仅界面模拟，不操作真实任务或钱包</span><button onClick={()=>{const active=all.filter(task=>['running','queued'].includes(task.status));if(active.length)setTarget({id:active[0].id,tasks:active});}}>取消整组</button></div>
    </div></div></div></section>
    {showBatchRecovery(pending,submitting)&&<div className="t2i-batch-recovery">还有图片待补交</div>}
    <output aria-label="提交显示检查">{check}</output><p>{notice}</p>
    <TaskCancelDialog target={target} light={light} onCancel={()=>setTarget(null)} onConfirm={confirm}/>
  </main>;
}
const previewRoot=import.meta.hot?.data.root||createRoot(document.getElementById('root'));
if(import.meta.hot)import.meta.hot.data.root=previewRoot;
previewRoot.render(<Preview/>);
