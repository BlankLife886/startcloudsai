import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Upload, Layers, Download, FileImage, ZoomIn, ZoomOut, Scan, RefreshCw, Square, ArrowRight } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { apiRequest } from '../legacy-modules/services/apiClient.js';
import { createAssistantConversation,createAssistantRun,fetchAssistantConfig,getAssistantConversation,listAssistantConversations,waitForAssistantRun,cancelAssistantRun } from '../features/assistant/services/assistantApi.js';
import './psd-decompose.css';

const terminal=new Set(['succeeded','failed','canceled']);
const labels={queued:'等待处理',running:'正在分解',succeeded:'分解完成',failed:'分解失败',canceled:'已取消'};
function fileURL(value){if(typeof value!=='string'||!value.startsWith('/api/v1/files/')||/[\\\r\n]/.test(value))return '';return value}

export function PSDDecomposeView(){
  const {user,loading:authLoading}=useAuth();
  const [search,setSearch]=useSearchParams();
  const [file,setFile]=useState(null),[preview,setPreview]=useState(''),[dimensions,setDimensions]=useState(null);
  const [instructions,setInstructions]=useState(''),[config,setConfig]=useState(null),[history,setHistory]=useState([]);
  const [data,setData]=useState(null),[error,setError]=useState(''),[phase,setPhase]=useState(''),[zoom,setZoom]=useState(100),[refresh,setRefresh]=useState(0);
  const input=useRef(null),attempt=useRef(null),action=useRef(null),fileSequence=useRef(0),busyRef=useRef(false);
  const runID=search.get('run')||'';
  const pending=Boolean(phase)||(data?.run&&!terminal.has(data.run.status));

  useEffect(()=>{
    action.current?.abort();fileSequence.current++;attempt.current=null;busyRef.current=false;
    setFile(null);setPreview('');setDimensions(null);setData(null);setHistory([]);setConfig(null);setPhase('');setError('');
    const controller=new AbortController();
    fetchAssistantConfig(controller.signal).then(setConfig).catch(e=>{if(!controller.signal.aborted)setError(e.message)});
    if(user?.id)listAssistantConversations({signal:controller.signal}).then(items=>setHistory(items.filter(item=>item.title?.startsWith('PSD 分解 ·')))).catch(e=>{if(!controller.signal.aborted)setError(e.message)});
    return()=>{controller.abort();action.current?.abort()};
  },[user?.id]);
  useEffect(()=>{if(!preview.startsWith('blob:'))return;return()=>URL.revokeObjectURL(preview)},[preview]);
  useEffect(()=>{
    if(!user?.id||!runID)return;
    const controller=new AbortController();setError('');
    waitForAssistantRun(runID,{signal:controller.signal,intervalMs:1500,onUpdate:next=>{if(!controller.signal.aborted)setData(next)}}).catch(e=>{if(!controller.signal.aborted)setError(e.message)});
    return()=>controller.abort();
  },[user?.id,runID,refresh]);
  useEffect(()=>{
    if(!user?.id||preview||!data?.run?.conversationId)return;
    const controller=new AbortController();
    getAssistantConversation(data.run.conversationId,{signal:controller.signal}).then(record=>{
      if(controller.signal.aborted)return;
      const source=record.messages?.find(message=>message.referenceImages?.length)?.referenceImages?.[0];
      setPreview(fileURL(source?.dataUrl)||fileURL(source?.thumbnailUrl));
    }).catch(()=>{});
    return()=>controller.abort();
  },[user?.id,data?.run?.conversationId,preview]);

  async function choose(file){
    if(!file||pending)return;
    const ticket=++fileSequence.current;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>20*1024*1024){setError('请选择20MB以内的PNG、JPG或WebP图片');return}
    setError('');
    try{
      const bitmap=await createImageBitmap(file);
      const size={width:bitmap.width,height:bitmap.height};bitmap.close();
      if(size.width*size.height>32_000_000)throw new Error('图片不能超过3200万像素');
      if(ticket!==fileSequence.current)return;
      setFile(file);setPreview(URL.createObjectURL(file));setDimensions(size);setData(null);setSearch({}, {replace:true});setZoom(100);attempt.current=null;
    }catch(e){if(ticket===fileSequence.current)setError(e.message||'图片读取失败')}
  }
  async function submit(){
    if(!file||!user?.id||busyRef.current||pending||!config?.editableFilesEnabled)return;
    if(!window.confirm('将图片提交到PSD服务进行分层处理，并按服务端助手模型规则计费。是否继续？'))return;
    busyRef.current=true;setError('');const controller=new AbortController();action.current=controller;
    try{
      if(!attempt.current)attempt.current={idempotencyKey:crypto.randomUUID()};
      const draft=attempt.current;
      if(!draft.upload){setPhase('上传中');const body=new FormData();body.append('file',file);draft.upload=await apiRequest('/uploads',{method:'POST',body,signal:controller.signal})}
      if(!draft.conversation){setPhase('准备任务');draft.conversation=await createAssistantConversation('PSD 分解 · '+file.name,{signal:controller.signal})}
      if(!draft.prompt)draft.prompt=`请将参考图片分解并制作分层 PSD 文件，分别处理主体、背景和文字区域，并交付PSD主文件及素材ZIP。保留原图尺寸和构图。${instructions.trim()?`\n拆层要求：${instructions.trim()}`:''}`;
      setPhase('提交中');
      const result=await createAssistantRun({conversationId:draft.conversation.id,idempotencyKey:draft.idempotencyKey,prompt:draft.prompt,userMessageContent:draft.prompt,mode:'chat',workspace:'assistant',model:config.chatModel,count:1,queue:true,
        referenceImages:[{id:crypto.randomUUID(),name:file.name,fileKey:draft.upload.key,dataUrl:draft.upload.url,thumbnailUrl:draft.upload.thumbnailUrl}]},{signal:controller.signal});
      if(controller.signal.aborted)return;
      setData(result);setSearch({run:result.run.id},{replace:true});attempt.current=null;
      setHistory(await listAssistantConversations({signal:controller.signal}).then(items=>items.filter(item=>item.title?.startsWith('PSD 分解 ·'))));
    }catch(e){if(!controller.signal.aborted)setError(e.message||'任务提交失败')}
    finally{if(!controller.signal.aborted){setPhase('');busyRef.current=false}}
  }
  async function openHistory(item){
    if(pending)return;
    action.current?.abort();const controller=new AbortController();action.current=controller;setError('');setPhase('读取历史');
    try{const record=await getAssistantConversation(item.id,{signal:controller.signal});if(controller.signal.aborted)return;
      const messages=record.messages||[];const reply=[...messages].reverse().find(message=>message.role==='assistant');
      const source=messages.find(message=>message.referenceImages?.length)?.referenceImages?.[0];
      setFile(null);setPreview(fileURL(source?.dataUrl)||fileURL(source?.thumbnailUrl));setDimensions(null);attempt.current=null;
      if(reply?.runId){setData(null);setSearch({run:reply.runId},{replace:true});setRefresh(x=>x+1)}else{setSearch({},{replace:true});setData({assistantMessage:reply});}
    }catch(e){if(!controller.signal.aborted)setError(e.message)}finally{if(!controller.signal.aborted)setPhase('')}
  }
  async function cancel(){
    if(!runID||phase)return;
    if(!window.confirm('停止当前任务？已发生的上游费用可能无法退回。'))return;
    const controller=new AbortController();action.current=controller;
    setPhase('正在停止');try{const result=await cancelAssistantRun(runID,{signal:controller.signal});if(!controller.signal.aborted){setData(result);setRefresh(x=>x+1)}}catch(e){if(!controller.signal.aborted)setError(e.message)}finally{if(!controller.signal.aborted)setPhase('')}
  }
  const artifacts=(data?.assistantMessage?.artifacts||[]).filter(item=>fileURL(item.downloadUrl));
  return <div className="psd-workspace">
    <header className="psd-toolbar"><div><Layers size={22}/><h1>PSD 分解</h1><span className={`psd-state is-${data?.run?.status||'idle'}`}>{phase||labels[data?.run?.status]||'图片转分层文件'}</span></div><div>
      <button onClick={()=>input.current?.click()} disabled={pending}><Upload size={16}/>选择图片</button>
      {data?.run&&!terminal.has(data.run.status)?<button onClick={cancel} disabled={!!phase}><Square size={15}/>停止</button>:<button className="psd-primary" onClick={submit} disabled={!file||pending||!user||!config?.editableFilesEnabled}><Layers size={16}/>开始分解</button>}
    </div></header>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e=>{choose(e.target.files?.[0]);e.target.value=''}}/>
    <div className="psd-body">
      <aside className="psd-inputs"><h2>输入素材</h2><button className="psd-upload" disabled={pending} onClick={()=>input.current?.click()}><Upload size={24}/><strong>{file?.name||'选择原图'}</strong><span>PNG · JPG · WebP</span></button>
        {dimensions&&<dl><dt>画布尺寸</dt><dd>{dimensions.width} × {dimensions.height}</dd><dt>文件大小</dt><dd>{(file.size/1024/1024).toFixed(1)} MB</dd></dl>}
        <label htmlFor="psd-requirements">拆层要求</label><textarea id="psd-requirements" value={instructions} disabled={pending} maxLength={2000} onChange={e=>{setInstructions(e.target.value);attempt.current=null}} placeholder="主体、文字、背景等处理要求" rows={5}/>
        <h2 className="psd-history-title">最近任务</h2><div className="psd-history">{history.map(item=><button key={item.id} disabled={pending} onClick={()=>openHistory(item)}><FileImage size={16}/><span>{item.title.replace('PSD 分解 · ','')}</span></button>)}{!history.length&&<p>暂无任务</p>}</div>
      </aside>
      <section className="psd-stage" aria-label="原图预览" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();choose(e.dataTransfer.files[0])}}>
        <div className="psd-stage-toolbar"><span>{preview?'原始图片':'素材预览'}</span><div><button title="缩小" aria-label="缩小" onClick={()=>setZoom(x=>Math.max(25,x-25))}><ZoomOut size={16}/></button><span>{zoom}%</span><button title="放大" aria-label="放大" onClick={()=>setZoom(x=>Math.min(200,x+25))}><ZoomIn size={16}/></button><button title="适应画布" aria-label="适应画布" onClick={()=>setZoom(100)}><Scan size={16}/></button></div></div>
        <div className="psd-preview"><img src={preview||'/sucai/studio-cover-ecom-create.webp'} alt={preview?'待分解原图':'商品设计样例'} style={{width:zoom+'%',height:zoom+'%'}}/>{!preview&&<span className="psd-example-label">示例素材</span>}</div>
      </section>
      <aside className="psd-delivery"><h2>文件交付</h2>
        {!user&&!authLoading&&<Link className="psd-login" to="/auth?redirect=%2Fpsd-decompose">登录后开始 <ArrowRight size={16}/></Link>}
        {config&&!config.editableFilesEnabled&&<div className="psd-notice" role="status">PSD 服务暂未开放</div>}
        {error&&<div className="psd-error" role="alert">{error}<button aria-label="重新同步" onClick={()=>setRefresh(x=>x+1)}><RefreshCw size={15}/></button></div>}
        {data?.run&&<dl><dt>任务状态</dt><dd>{labels[data.run.status]||data.run.status}</dd><dt>处理阶段</dt><dd>{data.run.stage||'准备中'}</dd><dt>预留积分</dt><dd>{data.run.reservedCents??'—'}</dd></dl>}
        {data?.run?.errorMessage&&<p className="psd-error">{data.run.errorMessage}</p>}
        <div className="psd-files">{artifacts.map(item=><a key={item.id||item.downloadUrl} href={fileURL(item.downloadUrl)}><FileImage size={22}/><span><strong>{item.name||'下载文件'}</strong><small>{item.sizeBytes?`${(item.sizeBytes/1024/1024).toFixed(1)} MB`:item.format?.toUpperCase()}</small></span><Download size={16}/></a>)}</div>
        {!artifacts.length&&<div className="psd-no-files"><Layers size={30}/><p>{pending?'正在准备分层文件':'暂无交付文件'}</p></div>}
        {data?.assistantMessage?.content&&<p className="psd-result-summary">{data.assistantMessage.content}</p>}
      </aside>
    </div>
  </div>;
}
