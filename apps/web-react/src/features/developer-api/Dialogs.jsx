import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowRight,Check,Copy,KeyRound,X} from 'lucide-react';
import {KEY_PRESETS,copyText,emptyKey,draftFromKey,keyPayload,number,presetOf} from './presentation.js';
import {DateField,ModelSelect,NumberField} from './Controls.jsx';
import {playDialogExit,useDialogMotion} from './motion.js';

// Footer may be a function of close, so its own buttons get the exit animation too.
export function Modal({title,children,onClose,busy=false,footer,wide=false,locked=false,drawer=false}){
 const ref=useRef(null),closing=useRef(false),backdropPress=useRef(false);
 useDialogMotion(ref,drawer);
 const close=()=>{if(closing.current)return;closing.current=true;playDialogExit(ref.current,drawer,onClose)};
 // A backdrop click closes only when it started on the backdrop with no popover
 // open; otherwise that first click just dismisses the popover.
 const pressed=event=>{backdropPress.current=event.target===event.currentTarget&&!event.currentTarget.querySelector('[data-radix-popper-content-wrapper]')};
 return <dialog ref={ref} className={`dap-dialog${wide?' is-wide':''}${drawer?' is-drawer':''}`} aria-label={title} onCancel={event=>{event.preventDefault();if(!busy&&!locked)close()}} onPointerDown={pressed} onClick={event=>{if(backdropPress.current&&event.target===event.currentTarget&&!busy&&!locked)close()}}>
  <header><h2>{title}</h2>{!locked&&<button className="dap-icon" aria-label="关闭" title="关闭" disabled={busy} onClick={close}><X size={18}/></button>}</header>
  <div className="dap-dialog-body">{children}</div>{footer&&<footer>{typeof footer==='function'?footer(close):footer}</footer>}
 </dialog>;
}

const QUOTA_INPUTS=[
 ['dailyTaskLimit','每日请求数','次',100000,1],['monthlyTaskLimit','每月请求数','次',1000000,1],
 ['dailySpendLimitCents','每日提交预算','积分',1000000000,1],['monthlySpendLimitCents','每月提交预算','积分',10000000000,1],
 ['rateLimitPerMinute','每分钟请求数','次',10000,1],['dailyByteLimitGiB','每日流量','GiB',1024,'any'],
];
const compact=value=>{const n=Number(value)||0;return n>=10000?`${Number((n/10000).toFixed(1))} 万`:number(n)};
const quotaSummary=draft=>`每日 ${compact(draft.dailyTaskLimit)} 次 · ${compact(draft.dailySpendLimitCents)} 积分 · 每分钟 ${compact(draft.rateLimitPerMinute)} 次`;

function Row({label,htmlFor,children}){
 return <div className="dap-kf-row">{htmlFor?<label className="dap-kf-label" htmlFor={htmlFor}>{label}</label>:<span className="dap-kf-label">{label}</span>}{children}</div>;
}

function Segmented({label,options,value,onChange}){
 return <div className="dap-kf-segment" role="radiogroup" aria-label={label}>{options.map(([id,text])=><button key={id} type="button" role="radio" aria-checked={value===id} className={value===id?'active':''} onClick={()=>onChange(id)}>{text}</button>)}</div>;
}

// KeyForm is a side drawer with one line per setting. Model picks open in a large dropdown and the six
// quota inputs appear only for a custom tier, so the dialog stays short.
export function KeyForm({client,models,initial,onClose,onSaved}){
 const editing=Boolean(initial?.id);
 const [draft,setDraft]=useState(()=>editing?draftFromKey(initial):emptyKey()),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [scope,setScope]=useState(()=>initial?.allowedModelIds?.length?'some':'all');
 // Retired or withdrawn models would make the save fail (422), so they are
 // dropped from the selection once the model list is known and not offered.
 const selectable=useMemo(()=>models.filter(model=>model.status!=='retired'),[models]);
 useEffect(()=>{if(!models.length)return;const known=new Set(selectable.map(model=>model.id));setDraft(current=>current.allowedModelIds.every(id=>known.has(id))?current:{...current,allowedModelIds:current.allowedModelIds.filter(id=>known.has(id))})},[models,selectable]);
 const [tier,setTier]=useState(()=>presetOf(editing?draftFromKey(initial):emptyKey()));
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
 const change=(key,value)=>setDraft(current=>({...current,[key]:value}));
 function pickTier(id){
  setTier(id);
  const values=KEY_PRESETS.find(([preset])=>preset===id)?.[3];
  if(values)setDraft(current=>({...current,...Object.fromEntries(Object.entries(values).map(([key,value])=>[key,String(value)]))}));
 }
 async function submit(event){event.preventDefault();if(busy)return;setError('');
  if(scope==='some'&&!draft.allowedModelIds.length){setError('请至少选择一个模型，或改为“全部模型”');return}
  setBusy(true);try{
  const payload=keyPayload({...draft,allowedModelIds:scope==='all'?[]:draft.allowedModelIds});
  const result=editing?await client.updateAPIKey(initial.id,payload):await client.createAPIKey(payload);
  if(alive.current)onSaved(result,editing?'updated':'created',payload.label);
 }catch(error){if(alive.current)setError(error.message)}finally{if(alive.current)setBusy(false)}}
 return <Modal title={editing?'编辑 API Key':'创建 API Key'} busy={busy} onClose={onClose} drawer footer={close=><><button className="dap-button" disabled={busy} onClick={close}>取消</button><button className="dap-button primary" form="dap-key-form" type="submit" disabled={busy}>{busy?(editing?'保存中…':'创建中…'):(editing?'保存修改':'创建 Key')}</button></>}>
  <form id="dap-key-form" onSubmit={submit} className="dap-form dap-kf"><fieldset disabled={busy}>
   <Row label="名称" htmlFor="dap-key-label"><input id="dap-key-label" data-autofocus required maxLength={80} placeholder="如：电商后台、测试脚本" value={draft.label} onChange={e=>change('label',e.target.value)}/></Row>
   <Row label="可用模型"><Segmented label="可用模型范围" value={scope} onChange={setScope} options={[['all','全部模型'],['some','指定模型']]}/>
    {scope==='some'&&<ModelSelect models={selectable} value={draft.allowedModelIds} onChange={ids=>change('allowedModelIds',ids)} disabled={busy}/>}
   </Row>
   <Row label="额度"><Segmented label="额度档位" value={tier} onChange={pickTier} options={[...KEY_PRESETS.map(([id,label])=>[id,label]),['custom','自定义']]}/>
    {tier==='custom'?<div className="dap-kf-quota">{QUOTA_INPUTS.map(([id,label,unit,max,step])=><div className="dap-form-field" key={id}><label htmlFor={`dap-${id}`}>{label}</label><NumberField id={`dap-${id}`} label={label} unit={unit} required min={step==='any'?0.001:1} max={max} step={step} value={draft[id]} onChange={value=>change(id,value)}/></div>)}</div>
     :<p className="dap-kf-note">{quotaSummary(draft)}</p>}
   </Row>
   <Row label="IP 白名单" htmlFor="dap-ip-allowlist"><input id="dap-ip-allowlist" placeholder="不限制；或填 IP / CIDR，逗号分隔" value={draft.ipAllowlistText} onChange={e=>change('ipAllowlistText',e.target.value)}/></Row>
   <Row label="有效期"><DateField value={draft.expiresAt} disabled={busy} onChange={value=>change('expiresAt',value)}/></Row>
  </fieldset>{error&&<p className="dap-form-error" role="alert">{error}</p>}</form>
 </Modal>;
}

export function Secret({secret,onClose,onUse}){
 const [copied,setCopied]=useState(false),[error,setError]=useState('');
 return <Modal title={secret.title} onClose={onClose} locked footer={<><button className={`dap-button${onUse?'':' primary'}`} onClick={onClose}>我已安全保存</button>{onUse&&<button className="dap-button primary" onClick={onUse}>填入示例代码<ArrowRight size={15}/></button>}</>}>
  <div className="dap-secret-symbol"><KeyRound size={27}/></div><p>密钥仅在此次显示，关闭后无法再次查看。离开页面前，示例代码里会保留这把密钥。</p><code className="dap-secret-value">{secret.value}</code><button className="dap-button" onClick={async()=>{try{await copyText(secret.value);setCopied(true)}catch(e){setError(e.message)}}}>{copied?<Check size={15}/>:<Copy size={15}/>} {copied?'已复制':'复制密钥'}</button>{error&&<p role="alert" className="dap-form-error">{error}</p>}
 </Modal>;
}
