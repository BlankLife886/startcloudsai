import {useCallback,useEffect,useRef,useState} from 'react';
import {Link,useSearchParams} from 'react-router';
import {BookOpen,Box,Boxes,Check,ChevronLeft,ChevronRight,Copy,ExternalLink,History,KeyRound,Plus,RefreshCw,Rocket,Search,ShieldCheck,SquareTerminal,TriangleAlert} from 'lucide-react';
import {useAuth} from '../auth/AuthContext.jsx';
import {useIsDark} from '../hooks/useIsDark.js';
import * as liveClient from '../legacy-modules/services/developerApi.js';
import {Modal,KeyForm,Secret} from '../features/developer-api/Dialogs.jsx';
import {KEY_STATUSES,MODEL_STATUSES,callableModel,day,keyStatus,modelNotes,number,time,copyText} from '../features/developer-api/presentation.js';
import './DeveloperAPIView.css';
import {ConsoleSelect} from '../features/developer-api/Controls.jsx';
import {useConsoleMotion} from '../features/developer-api/motion.js';
import {CallsPanel} from '../features/developer-api/CallsPanel.jsx';
import {KeysTable} from '../features/developer-api/KeysTable.jsx';
import {KeyDetail} from '../features/developer-api/KeyDetail.jsx';
import {StartPanel,modelsFor,protocolFor} from '../features/developer-api/StartPanel.jsx';

const NAV=[['start','开始使用',Rocket],['keys','API Keys',KeyRound],['calls','调用记录',History],['models','模型',Boxes]];
// Links from before the start tab merged overview and quickstart.
const TAB_ALIASES={overview:'start',quickstart:'start'};
const EMPTY={keys:[],models:[]};
const RESOURCE_LABELS={keys:'API Key',models:'模型'};
const STATUS_ORDER={active:0,paused:1,expired:2,frozen:3,revoked:4};
const tabFrom=value=>{const tab=TAB_ALIASES[value]||value;return NAV.some(([id])=>id===tab)?tab:'start'};


function Badge({status,children}){return <span className={`dap-badge ${status}`}><i/>{children}</span>}
function Pager({page,total,onChange,extra}){const pages=Math.max(1,Math.ceil(total/8));return <footer className="dap-pagination"><span>共 {total} 条{extra}</span><div><button className="dap-icon" title="上一页" aria-label="上一页" disabled={page<=1} onClick={()=>onChange(page-1)}><ChevronLeft size={16}/></button><span>{page} / {pages}</span><button className="dap-icon" title="下一页" aria-label="下一页" disabled={page>=pages} onClick={()=>onChange(page+1)}><ChevronRight size={16}/></button></div></footer>}
function Empty({icon:Icon=KeyRound,title,description,action}){return <div className="dap-empty"><span><Icon size={25}/></span><h3>{title}</h3><p>{description}</p>{action}</div>}
function CopyValue({value,label,onCopy}){return value?<span className="dap-copy-value"><code>{value}</code><button type="button" aria-label={`复制${label}`} title={`复制${label}`} onClick={()=>onCopy(value,`${label}已复制`)}><Copy size={13}/></button></span>:'—'}

export function DeveloperAPIView(){const auth=useAuth();return <DeveloperConsole key={`live:${auth.user?.id||'guest'}`} auth={auth}/>}

function DeveloperConsole({auth}){
 const isDark=useIsDark();
 const client=liveClient;
 const [searchParams,setSearchParams]=useSearchParams();
 const tab=tabFrom(searchParams.get('tab'));
 const [data,setData]=useState(EMPTY),[ready,setReady]=useState({}),[errors,setErrors]=useState({});
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[page,setPage]=useState(1),[showRevoked,setShowRevoked]=useState(false);
 const [dialog,setDialog]=useState(null),[detail,setDetail]=useState(null),[secret,setSecret]=useState(null),[confirmation,setConfirmation]=useState(null),[actionError,setActionError]=useState('');
 const [notice,setNotice]=useState(''),[updated,setUpdated]=useState(null),[selectedModel,setSelectedModel]=useState(''),[protocol,setProtocol]=useState('images'),[language,setLanguage]=useState('python');
 // The newest secret shown this visit, filled into the start tab's code. Never persisted.
 const [freshSecret,setFreshSecret]=useState(null);
 const alive=useRef(true),generation=useRef(0),pendingRead=useRef(null),mutating=useRef(false);
 const signedIn=Boolean(auth?.isAuthenticated);
 const consoleRef=useRef(null);
 useConsoleMotion(consoleRef,tab,Object.values(ready).some(Boolean),signedIn);
 useEffect(()=>{const previous=document.title;document.title='API 调用 · 星空云绘';return()=>{document.title=previous}},[]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;pendingRead.current?.abort()}},[]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),3200);return()=>clearTimeout(timer)},[notice]);

 const load=useCallback(async()=>{
  if(!signedIn){setLoading(false);return}
  const ticket=++generation.current;pendingRead.current?.abort();const controller=new AbortController();pendingRead.current=controller;
  let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;controller.abort()},15000);setLoading(true);setErrors({});
  const methods={keys:'listAPIKeys',models:'listDeveloperModels'};
  await Promise.allSettled(Object.entries(methods).map(async([key,method])=>{
   try{const items=await client[method]({signal:controller.signal});if(alive.current&&ticket===generation.current&&!controller.signal.aborted){setData(current=>({...current,[key]:items}));setReady(current=>({...current,[key]:true}))}}
   catch(error){if(alive.current&&ticket===generation.current)setErrors(current=>({...current,[key]:timedOut?'读取超时，请重试':error.message||'读取失败'}))}
  }));
  clearTimeout(timeout);if(alive.current&&ticket===generation.current){setLoading(false);setUpdated(new Date());pendingRead.current=null}
 },[client,signedIn]);
 useEffect(()=>{void load()},[load]);
 useEffect(()=>{setPage(1)},[tab,query,filter]);
 const navigateTab=next=>{setQuery('');setFilter('all');setPage(1);setSearchParams(current=>{const params=new URLSearchParams(current);if(next==='start')params.delete('tab');else params.set('tab',next);return params})};
 async function copy(value,message='已复制'){try{await copyText(value);if(alive.current)setNotice(message)}catch(error){if(alive.current)setNotice(error.message)}}
 function ask(kind,item){setDetail(null);setActionError('');setConfirmation({kind,item})}
 function showSecret(title,value,key){setSecret({title,value});setFreshSecret({value,label:key?.label||'新 Key',keyId:key?.id})}
 async function confirm(){
  if(mutating.current||!confirmation)return;mutating.current=true;setBusy(true);setActionError('');
  const {kind,item}=confirmation;
  try{
   const result=kind==='rotate'?await client.rotateAPIKey(item.id):await client.revokeAPIKey(item.id);
   if(!alive.current)return;setConfirmation(null);
   if(kind==='revoke')setFreshSecret(current=>current?.keyId===item.id?null:current);
   if(result?.secret)showSecret('新密钥已生成',result.secret,result.key||item);
   setNotice(kind==='rotate'?'Key 已轮换':'Key 已撤销');await load();
  }catch(error){if(alive.current)setActionError(error.message||'操作失败')}
  finally{mutating.current=false;if(alive.current)setBusy(false)}
 }
 // Pausing is reversible, so it runs without a confirmation step.
 async function setPaused(item,paused){
  if(mutating.current)return;mutating.current=true;setBusy(true);
  try{await client.setAPIKeyPaused(item.id,paused);if(!alive.current)return;setDetail(null);setNotice(paused?`「${item.label}」已停用`:`「${item.label}」已重新启用`);await load()}
  catch(error){if(alive.current)setNotice(error.message||'操作失败')}
  finally{mutating.current=false;if(alive.current)setBusy(false)}
 }
 function savedKey(result,mode,draftLabel){if(!alive.current)return;setDialog(null);setDetail(null);if(result?.secret)showSecret(mode==='created'?'API Key 已创建':'API Key 已更新',result.secret,result.key||{label:draftLabel});setNotice(mode==='created'?'API Key 已创建':'API Key 已更新');void load()}
 function pickModel(model){setProtocol(protocolFor(model));setSelectedModel(model.id);navigateTab('start')}
 function applySecret(){setSecret(null);navigateTab('start')}

 const usable=data.keys.filter(key=>keyStatus(key)==='active');
 const retained=data.keys.filter(key=>['active','frozen'].includes(key.status)).length;
 const sumUsage=field=>data.keys.reduce((sum,key)=>sum+Number(key.usage?.[field]||0),0);
 const createDisabled=!ready.keys||!ready.models||Boolean(errors.keys||errors.models)||retained>=10;
 const createTitle=retained>=10?'保留 Key 已达 10 个，请先撤销旧 Key':undefined;
 const openCreate=()=>setDialog({kind:'key'});
 const needle=query.toLowerCase().trim();
 const revokedCount=data.keys.filter(key=>key.status==='revoked').length;
 // Revoked keys stay out of the way unless asked for.
 const keyList=data.keys.filter(key=>(filter==='all'?showRevoked||key.status!=='revoked':keyStatus(key)===filter)&&`${key.label} ${key.prefix}`.toLowerCase().includes(needle)).sort((a,b)=>(STATUS_ORDER[keyStatus(a)]??9)-(STATUS_ORDER[keyStatus(b)]??9));
 const modelList=data.models.filter(item=>(filter==='all'||item.kind===filter)&&`${item.name} ${item.model}`.toLowerCase().includes(needle));
 const pageItems=items=>items.slice((Math.min(page,Math.max(1,Math.ceil(items.length/8)))-1)*8,page*8);
 const exampleModels=modelsFor(data.models,protocol);
 const model=exampleModels.find(item=>item.id===selectedModel)||exampleModels[0];
 const apiBase=`${window.location.origin}/v1`;
 const createButton=<button className="dap-button primary" onClick={openCreate} disabled={createDisabled} title={createTitle}><Plus size={16}/>创建 Key</button>;

 if(!auth?.loading&&!signedIn)return <main className={`dap${isDark?' is-dark':''}`}><div className="dap-inner"><Empty icon={ShieldCheck} title="API 调用" description="登录后创建 API Key，用 OpenAI SDK 调用图片与对话模型。" action={<div className="dap-action-row"><Link className="dap-button primary" to="/auth?redirect=%2Fdeveloper-api">登录控制台</Link></div>}/></div></main>;

 return <main ref={consoleRef} className={`dap${isDark?' is-dark':''}`} data-testid="developer-console" data-tab={tab}><div className="dap-shell">
  <aside className="dap-side">
   <div className="dap-brand"><span className="dap-brand-mark" aria-hidden="true"><SquareTerminal size={18}/></span><div><h1>API 调用</h1><small>OpenAI 兼容 · /v1</small></div></div>
   <p className="dap-side-label">控制台</p><nav className="dap-tabs" aria-label="API 调用导航">{NAV.map(([id,label,Icon])=><button key={id} className={tab===id?'active':''} aria-current={tab===id?'page':undefined} onClick={()=>navigateTab(id)}><Icon size={17} aria-hidden="true"/><span>{label}</span>{id==='keys'&&ready.keys&&<b>{usable.length}</b>}</button>)}</nav>
   <div className="dap-side-foot">
    {tab!=='start'&&<div className="dap-side-endpoint"><span>Base URL</span><CopyValue value={apiBase} label="Base URL" onCopy={copy}/></div>}
    <Link to="/developer-api/docs" className="dap-side-link"><BookOpen size={16}/>API 文档<ExternalLink size={13}/></Link>
    <p className="dap-side-status"><span className={`dap-status-dot${Object.keys(errors).length?' is-warn':''}`}/><span>{Object.keys(errors).length?'部分数据未更新':'数据已同步'}{updated?` · ${time(updated,true)}`:''}</span><small>用量每天 08:00 重置</small><button className="dap-icon" aria-label="刷新数据" title="刷新数据" disabled={loading||busy} onClick={()=>void load()}><RefreshCw size={14} className={loading?'dap-spin':''}/></button></p>
   </div>
  </aside>
  <div className="dap-main">
   <div className="dap-content">
   {Object.entries(errors).map(([resource,message])=><div className="dap-error" role="alert" key={resource}><TriangleAlert size={16}/><span>{RESOURCE_LABELS[resource]}读取失败：{message}</span><button onClick={()=>void load()} disabled={loading}>重试</button></div>)}
   {loading&&!Object.values(ready).some(Boolean)?<div className="dap-loading" role="status"><RefreshCw size={20} className="dap-spin"/>正在读取工作区…</div>:<>
    {tab==='start'&&<StartPanel models={data.models} ready={ready} summary={{usableKeys:usable.length,todayTasks:sumUsage('todayTasks'),todayBudget:sumUsage('todaySpendCents'),monthTasks:sumUsage('monthTasks')}} freshSecret={freshSecret} protocol={protocol} onProtocol={value=>{setProtocol(value);setSelectedModel('')}} model={model} onModel={setSelectedModel} language={language} onLanguage={setLanguage} apiBase={apiBase} createDisabled={createDisabled} createTitle={createTitle} onCreate={openCreate} onKeys={()=>navigateTab('keys')} onModels={()=>navigateTab('models')} copy={copy}/>}
    {(tab==='keys'||tab==='models')&&<div className="dap-filterbar"><label className="dap-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={tab==='keys'?'搜索名称或 Key 前缀':'搜索模型'} aria-label="搜索当前列表"/>{query&&<button onClick={()=>setQuery('')} aria-label="清除搜索">×</button>}</label>
     <ConsoleSelect label={tab==='keys'?'状态筛选':'类型筛选'} value={filter} onChange={setFilter} options={tab==='keys'?[{value:'all',label:'全部状态'},...Object.entries(KEY_STATUSES).map(([value,label])=>({value,label}))]:[{value:'all',label:'全部类型'},{value:'image',label:'图片'},{value:'chat',label:'对话'}]}/>
     <span className="dap-filter-spacer"/>{tab==='keys'&&createButton}
    </div>}
    {tab==='keys'&&<section className="dap-panel"><div className="dap-table-wrap"><KeysTable keys={pageItems(keyList)} models={data.models} onOpen={setDetail} onEdit={item=>setDialog({kind:'key',item})} onPause={setPaused} onRotate={item=>ask('rotate',item)} onRevoke={item=>ask('revoke',item)}/></div>{!keyList.length&&<Empty title={data.keys.length?'没有匹配的 Key':'还没有 API Key'} description={data.keys.length?'换个关键词或状态试试。':'创建一把 Key 开始接入。'} action={data.keys.length?null:createButton}/>}<Pager page={Math.min(page,Math.max(1,Math.ceil(keyList.length/8)))} total={keyList.length} onChange={setPage} extra={filter==='all'&&revokedCount>0&&<button className="dap-link-button" onClick={()=>{setShowRevoked(value=>!value);setPage(1)}}>{showRevoked?'隐藏':'显示'}已撤销的 {revokedCount} 把</button>}/></section>}
    {tab==='calls'&&<CallsPanel client={client} keys={data.keys}/>}
    {tab==='models'&&<section className="dap-panel"><div className="dap-table-wrap"><table><thead><tr><th>模型名（model）</th><th>状态</th><th>类型</th><th>价格</th><th>单次张数</th><th>参考图上限</th><th>分辨率</th><th/></tr></thead><tbody>{modelList.map(item=>{const [statusLabel,tone]=MODEL_STATUSES[item.status]||MODEL_STATUSES.live,notes=modelNotes(item),retired=item.status==='retired';return <tr key={item.id} className={retired?'is-retired':''}><td><strong><CopyValue value={item.model} label="模型名" onCopy={copy}/></strong>{item.name&&item.name!==item.model&&<span className="dap-subtext">{item.name}</span>}</td><td><span className={`dap-badge ${tone}`}><i/>{statusLabel}</span>{notes.filter(([kind])=>kind!=='info'||item.status==='maintenance').map(([kind,text])=><small key={text} className={`dap-model-note is-${kind}`}>{text}</small>)}</td><td>{item.kind==='chat'?'对话':'图片'}</td><td>{retired||item.priceCents==null?'—':<>{number(item.priceCents)} 积分/次</>}{item.pendingPrice&&<small className="dap-model-note is-info">{day(item.pendingPrice.effectiveAt)} 起 {number(item.pendingPrice.priceCents)} 积分/次</small>}</td><td>{item.kind==='chat'?'—':item.maxImages||1}</td><td>{item.maxReferenceImages||0}</td><td>{item.kind==='chat'?'—':item.resolutions?.join(' / ')||'由模型决定'}</td><td>{callableModel(item)&&<button className="dap-button" onClick={()=>pickModel(item)}>用它生成代码</button>}</td></tr>})}</tbody></table></div>{!modelList.length&&<Empty icon={Box} title={data.models.length?'没有匹配的模型':'暂无可用模型'} description={data.models.length?'换个关键词或类型试试。':'模型开放状态由平台配置决定。'}/>}<p className="dap-models-footnote">价格按每次成功的请求计，失败或超时不扣费，内容违规被上游驳回照常扣费；API 价格不享受订阅锁价。涨价至少提前 7 天在此预告并发站内消息，降价立即生效。</p></section>}
   </>}
   </div>
   <footer className="dap-content-footer"><span>请求数与预算按 UTC 重置（北京时间 08:00）</span><Link to="/developer-api/docs"><BookOpen size={13}/>API 文档</Link></footer>
  </div>
 </div>
  {notice&&<div className="dap-toast" role="status"><Check size={16}/>{notice}</div>}
  {dialog?.kind==='key'&&<KeyForm client={client} models={data.models} initial={dialog.item} onClose={()=>setDialog(null)} onSaved={savedKey}/>}
  {secret&&<Secret secret={secret} onClose={()=>setSecret(null)} onUse={tab==="start"?undefined:applySecret}/>}
  {detail&&<KeyDetail item={detail} models={data.models} busy={busy} onClose={()=>setDetail(null)} onEdit={item=>{setDetail(null);setDialog({kind:'key',item})}} onPause={setPaused} onRotate={item=>ask('rotate',item)} onRevoke={item=>ask('revoke',item)}/>}
  {confirmation&&<Modal title={confirmation.kind==='rotate'?'轮换访问密钥':'撤销访问密钥'} onClose={()=>setConfirmation(null)} busy={busy} footer={<><button className="dap-button" disabled={busy} onClick={()=>setConfirmation(null)}>取消</button><button className={`dap-button ${confirmation.kind==='rotate'?'primary':'danger'}`} disabled={busy} onClick={confirm}>{busy?'处理中…':confirmation.kind==='rotate'?'确认轮换':'确认撤销'}</button></>}>
   <p className="dap-confirm-subject">{confirmation.item.label}</p><p>{confirmation.kind==='rotate'?'旧Key将立即失效，新密钥只显示一次。请及时更新调用方配置。':'撤销后无法恢复，使用这把Key的应用将不能继续调用接口。'}</p>{actionError&&<p className="dap-form-error" role="alert">{actionError}</p>}
  </Modal>}
 </main>;
}
