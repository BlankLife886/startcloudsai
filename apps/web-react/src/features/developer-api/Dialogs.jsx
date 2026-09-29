import {useEffect,useRef,useState} from 'react';
import {Check,Copy,KeyRound,X} from 'lucide-react';
import {copyText,emptyKey,draftFromKey,keyPayload,number} from './presentation.js';
import {Checkbox,DateField,NumberField} from './Controls.jsx';
import {useDialogMotion} from './motion.js';

export function Modal({title,children,onClose,busy=false,footer,wide=false,locked=false}){
 const ref=useRef(null);
 useDialogMotion(ref);
 return <dialog ref={ref} className={`dap-dialog${wide?' is-wide':''}`} aria-label={title} onCancel={event=>{event.preventDefault();if(!busy&&!locked)onClose()}} onClick={event=>{if(event.target===event.currentTarget&&!busy&&!locked)onClose()}}>
  <header><h2>{title}</h2>{!locked&&<button className="dap-icon" aria-label="关闭" title="关闭" disabled={busy} onClick={onClose}><X size={18}/></button>}</header>
  <div className="dap-dialog-body">{children}</div>{footer&&<footer>{footer}</footer>}
 </dialog>;
}

export function KeyForm({client,models,initial,onClose,onSaved}){
 const editing=Boolean(initial?.id);
 const [draft,setDraft]=useState(()=>editing?draftFromKey(initial):emptyKey()),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 const change=(key,value)=>setDraft(current=>({...current,[key]:value}));
 const toggle=(key,value)=>setDraft(current=>({...current,[key]:current[key].includes(value)?current[key].filter(item=>item!==value):[...current[key],value]}));
 async function submit(event){event.preventDefault();if(busy)return;setError('');setBusy(true);try{
  const payload=keyPayload(draft);
  const result=editing?await client.updateAPIKey(initial.id,payload):await client.createAPIKey(payload);
  if(alive.current)onSaved(result,editing?'updated':'created');
 }catch(error){if(alive.current)setError(error.message)}finally{if(alive.current)setBusy(false)}}
 return <Modal title={editing?'编辑 API Key':'创建 API Key'} busy={busy} onClose={onClose} wide footer={<><button className="dap-button" disabled={busy} onClick={onClose}>取消</button><button className="dap-button primary" form="dap-key-form" type="submit" disabled={busy}>{busy?(editing?'保存中…':'创建中…'):(editing?'保存修改':'创建 Key')}</button></>}>
  <form id="dap-key-form" onSubmit={submit} className="dap-form"><fieldset disabled={busy}><label>名称<input data-autofocus required maxLength={80} placeholder="例如：生产环境图像服务" value={draft.label} onChange={e=>change('label',e.target.value)}/></label>
   <section className="dap-form-section"><h3>可用模型 <small>不选则可调用全部模型</small></h3>{models.length?<div className="dap-options">{models.map(model=><label key={model.id}><Checkbox checked={draft.allowedModelIds.includes(model.id)} onChange={()=>toggle('allowedModelIds',model.id)}/><span>{model.name}<small>{model.kind==='chat'?'对话':'图片'} · {number(model.priceCents)} 积分起</small></span></label>)}</div>:<p className="dap-muted">暂无可用模型，请确认模型列表已加载。</p>}</section>
   <section className="dap-form-section"><h3>额度与有效期</h3><div className="dap-form-grid">{[['dailyTaskLimit','每日请求数',100000],['monthlyTaskLimit','每月请求数',1000000],['dailySpendLimitCents','每日提交预算（积分）',1000000000],['monthlySpendLimitCents','每月提交预算（积分）',10000000000],['rateLimitPerMinute','每分钟请求数',10000]].map(([id,label,max])=><div className="dap-form-field" key={id}><label htmlFor={`dap-${id}`}>{label}</label><NumberField id={`dap-${id}`} label={label} required min={1} max={max} step={1} value={draft[id]} onChange={value=>change(id,value)}/></div>)}
   <div className="dap-form-field"><label htmlFor="dap-dailyByteLimitGiB">每日流量（GiB）</label><NumberField id="dap-dailyByteLimitGiB" label="每日流量（GiB）" required min={0.001} max={1024} step="any" value={draft.dailyByteLimitGiB} onChange={value=>change('dailyByteLimitGiB',value)}/></div>
   <label className="wide">IP 白名单<input placeholder="203.0.113.10, 10.0.0.0/24" value={draft.ipAllowlistText} onChange={e=>change('ipAllowlistText',e.target.value)}/><small>可选，支持IP与CIDR，最多20项。</small></label><div className="dap-form-field wide"><span className="dap-form-label">到期日期</span><DateField value={draft.expiresAt} disabled={busy} onChange={value=>change('expiresAt',value)}/></div></div></section>
  </fieldset>{error&&<p className="dap-form-error" role="alert">{error}</p>}</form>
 </Modal>;
}

export function Secret({secret,onClose}){
 const [copied,setCopied]=useState(false),[error,setError]=useState('');
 return <Modal title={secret.title} onClose={onClose} locked footer={<button className="dap-button primary" onClick={onClose}>我已安全保存</button>}>
  <div className="dap-secret-symbol"><KeyRound size={27}/></div><p>密钥仅在此次显示，关闭后无法再次查看。</p><code className="dap-secret-value">{secret.value}</code><button className="dap-button" onClick={async()=>{try{await copyText(secret.value);setCopied(true)}catch(e){setError(e.message)}}}>{copied?<Check size={15}/>:<Copy size={15}/>} {copied?'已复制':'复制密钥'}</button>{error&&<p role="alert" className="dap-form-error">{error}</p>}
 </Modal>;
}
