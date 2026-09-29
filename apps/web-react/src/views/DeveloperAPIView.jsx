import {useCallback,useEffect,useRef,useState} from 'react';
import {Link} from 'react-router';
import {ArrowRight,BookOpen,Box,Check,ChevronLeft,ChevronRight,Copy,ExternalLink,KeyRound,MoreHorizontal,Plus,RefreshCw,RotateCw,Search,ShieldCheck,Trash2,TriangleAlert} from 'lucide-react';
import {useAuth} from '../auth/AuthContext.jsx';
import {useIsDark} from '../hooks/useIsDark.js';
import * as liveClient from '../legacy-modules/services/developerApi.js';
import {Modal,KeyForm,Secret} from '../features/developer-api/Dialogs.jsx';
import {KEY_STATUSES,keyStatus,expiresSoon,number,time,bytes,ratio,copyText,imageCurlExample,chatCurlExample} from '../features/developer-api/presentation.js';
import {ReliabilityGuide} from '../features/developer-api/ReliabilityGuide.jsx';
import './DeveloperAPIView.css';
import {OverviewHighlights} from '../features/developer-api/OverviewHighlights.jsx';
import {ConsoleSelect} from '../features/developer-api/Controls.jsx';
import {useConsoleMotion} from '../features/developer-api/motion.js';
import {CallsPanel} from '../features/developer-api/CallsPanel.jsx';

const NAV=[['overview','概览'],['keys','API Keys'],['calls','调用记录'],['models','模型'],['quickstart','快速接入']];
const EMPTY={keys:[],models:[]};
const RESOURCE_LABELS={keys:'API Key',models:'模型'};
const PROTOCOLS={images:{label:'Images · 生图',kind:'image'},chat:{label:'Chat Completions · 对话',kind:'chat'}};
const protocolFor=model=>model?.kind==='chat'?'chat':'images';

function Badge({status,children}){return <span className={`dap-badge ${status}`}><i/>{children}</span>}
function Meter({used,limit,label}){const percent=ratio(used,limit);return <div className={`dap-meter${percent>=85?' warning':''}`}><div><span>{label}</span><b>{number(used)} <small>/ {number(limit)}</small></b></div><div className="dap-meter-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={Number(limit)||1} aria-valuenow={Math.min(Number(used)||0,Number(limit)||1)}><span style={{width:percent+'%'}}/></div></div>}
function Pager({page,total,onChange}){const pages=Math.max(1,Math.ceil(total/8));return <footer className="dap-pagination"><span>共 {total} 条</span><div><button className="dap-icon" title="上一页" aria-label="上一页" disabled={page<=1} onClick={()=>onChange(page-1)}><ChevronLeft size={16}/></button><span>{page} / {pages}</span><button className="dap-icon" title="下一页" aria-label="下一页" disabled={page>=pages} onClick={()=>onChange(page+1)}><ChevronRight size={16}/></button></div></footer>}
function Empty({icon:Icon=KeyRound,title,description,action}){return <div className="dap-empty"><span><Icon size={25}/></span><h3>{title}</h3><p>{description}</p>{action}</div>}
function CopyValue({value,label,onCopy}){return value?<span className="dap-copy-value"><code>{value}</code><button type="button" aria-label={`复制${label}`} title={`复制${label}`} onClick={()=>onCopy(value,`${label}已复制`)}><Copy size={13}/></button></span>:'—'}
function DetailRow({label,children}){return <div className="dap-detail-row"><dt>{label}</dt><dd>{children===undefined||children===null||children===''?'—':children}</dd></div>}

export function DeveloperAPIView(){const auth=useAuth();return <DeveloperConsole key={`live:${auth.user?.id||'guest'}`} auth={auth}/>}

function DeveloperConsole({auth}){
 const isDark=useIsDark();
 const client=liveClient;
 const [data,setData]=useState(EMPTY),[ready,setReady]=useState({}),[errors,setErrors]=useState({});
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[tab,setTab]=useState('overview');
 const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[page,setPage]=useState(1);
 const [dialog,setDialog]=useState(null),[detail,setDetail]=useState(null),[secret,setSecret]=useState(null),[confirmation,setConfirmation]=useState(null),[actionError,setActionError]=useState('');
 const [notice,setNotice]=useState(''),[updated,setUpdated]=useState(null),[selectedModel,setSelectedModel]=useState(''),[protocol,setProtocol]=useState('images');
 const alive=useRef(true),generation=useRef(0),pendingRead=useRef(null),mutating=useRef(false);
 const signedIn=Boolean(auth?.isAuthenticated);
 const consoleRef=useRef(null);
 useConsoleMotion(consoleRef,tab,Object.values(ready).some(Boolean),signedIn);
 useEffect(()=>{const previous=document.title;document.title='开发者 API · 星空云绘';return()=>{document.title=previous}},[]);
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
 const navigateTab=next=>{setTab(next);setQuery('');setFilter('all');setPage(1)};
 async function copy(value,message='已复制'){try{await copyText(value);if(alive.current)setNotice(message)}catch(error){if(alive.current)setNotice(error.message)}}
 function ask(kind,item){setDetail(null);setActionError('');setConfirmation({kind,item})}
 async function confirm(){
  if(mutating.current||!confirmation)return;mutating.current=true;setBusy(true);setActionError('');
  const {kind,item}=confirmation;
  try{
   const result=kind==='rotate'?await client.rotateAPIKey(item.id):await client.revokeAPIKey(item.id);
   if(!alive.current)return;setConfirmation(null);if(result?.secret)setSecret({title:'新密钥已生成',value:result.secret});setNotice('操作已完成');await load();
  }catch(error){if(alive.current)setActionError(error.message||'操作失败')}
  finally{mutating.current=false;if(alive.current)setBusy(false)}
 }
 function savedKey(result,mode){if(!alive.current)return;setDialog(null);setDetail(null);if(result?.secret)setSecret({title:mode==='created'?'API Key 已创建':'API Key 已更新',value:result.secret});setNotice(mode==='created'?'API Key 已创建':'API Key 已更新');void load()}
 function openExample(model){setProtocol(protocolFor(model));setSelectedModel(model.id);navigateTab('quickstart')}

 const usable=data.keys.filter(key=>keyStatus(key)==='active');
 const retained=data.keys.filter(key=>['active','frozen'].includes(key.status)).length;
 const sumUsage=field=>data.keys.reduce((sum,key)=>sum+Number(key.usage?.[field]||0),0);
 const createDisabled=!ready.keys||!ready.models||Boolean(errors.keys||errors.models)||retained>=10;
 const needle=query.toLowerCase().trim();
 const keyList=data.keys.filter(key=>(filter==='all'||keyStatus(key)===filter)&&`${key.label} ${key.prefix}`.toLowerCase().includes(needle));
 const modelList=data.models.filter(item=>(filter==='all'||item.kind===filter)&&`${item.name} ${item.model}`.toLowerCase().includes(needle));
 const pageItems=items=>items.slice((Math.min(page,Math.max(1,Math.ceil(items.length/8)))-1)*8,page*8);
 const exampleModels=data.models.filter(item=>item.kind===PROTOCOLS[protocol].kind);
 const model=exampleModels.find(item=>item.id===selectedModel)||exampleModels[0];
 const apiBase=`${window.location.origin}/v1`;
 const snippet=protocol==='images'?imageCurlExample(apiBase,model):chatCurlExample(apiBase,model);
 const title=NAV.find(([id])=>id===tab)?.[1]||'概览';
 const actions=<button className="dap-button primary" onClick={()=>setDialog({kind:'key'})} disabled={createDisabled} title={retained>=10?'保留Key已达10个，请先撤销旧Key':undefined}><Plus size={16}/>创建 Key</button>;

 if(!auth?.loading&&!signedIn)return <main className={`dap${isDark?' is-dark':''}`}><div className="dap-inner"><Empty icon={ShieldCheck} title="开发者 API" description="登录后创建 API Key，用 OpenAI SDK 调用图片与对话模型。" action={<div className="dap-action-row"><Link className="dap-button primary" to="/auth?redirect=%2Fdeveloper-api">登录控制台</Link></div>}/></div></main>;

 return <main ref={consoleRef} className={`dap${isDark?' is-dark':''}`} data-testid="developer-console" data-tab={tab}><div className="dap-inner">
  <header className="dap-header"><div className="dap-heading"><h1>开发者 API</h1><p>OpenAI 兼容接口：换一个 Base URL 和 Key，就能用现有 SDK 调用</p></div><div className="dap-header-actions"><Link to="/developer-api/docs" className="dap-button"><BookOpen size={16}/>API 文档<ExternalLink size={13}/></Link><button className="dap-icon" aria-label="刷新数据" title="刷新数据" disabled={loading||busy} onClick={()=>void load()}><RefreshCw size={16} className={loading?'dap-spin':''}/></button></div></header>
  <div className="dap-layout"><aside className="dap-sidebar" aria-label="开发者导航"><nav>{NAV.map(([id,label])=><button key={id} className={tab===id?'active':''} aria-current={tab===id?'page':undefined} onClick={()=>navigateTab(id)}><span className="dap-nav-copy">{label}</span></button>)}</nav></aside>
  <div className="dap-content"><div className="dap-content-heading"><div><h2>{title}</h2><p>{tab==='overview'?'今日用量、访问凭据与接入地址':tab==='keys'?'为不同应用创建独立的 Key，分别设置额度、可用模型和 IP 白名单':tab==='calls'?'每次 /v1 请求的用量、扣费与退回原因':tab==='models'?'调用时把模型名填入 model 参数':'复制示例，替换 Key 后即可运行'}</p></div></div>
   {Object.entries(errors).map(([resource,message])=><div className="dap-error" role="alert" key={resource}><TriangleAlert size={16}/><span>{RESOURCE_LABELS[resource]}读取失败：{message}</span><button onClick={()=>void load()} disabled={loading}>重试</button></div>)}
   {loading&&!Object.values(ready).some(Boolean)?<div className="dap-loading" role="status"><RefreshCw size={20} className="dap-spin"/>正在读取工作区…</div>:<>
    {tab==='overview'&&<>
     <OverviewHighlights data={data} ready={ready} summary={{usableKeys:usable.length,retained,todayTasks:sumUsage('todayTasks'),todayBudget:sumUsage('todaySpendCents'),monthTasks:sumUsage('monthTasks')}} onKeys={()=>navigateTab('keys')} onQuickstart={()=>navigateTab('quickstart')} onModels={()=>navigateTab('models')}/>
     <div className="dap-overview-grid"><section className="dap-panel"><header><h3>额度使用</h3><button className="dap-text-button" onClick={()=>navigateTab('keys')}>管理 Key<ArrowRight size={14}/></button></header>{data.keys.filter(item=>item.status!=='revoked').slice(0,3).map(key=><div className="dap-usage-row" key={key.id}><div><span className="dap-glyph"><KeyRound size={15}/></span><strong>{key.label}</strong><Badge status={keyStatus(key)}>{KEY_STATUSES[keyStatus(key)]}</Badge></div><Meter used={key.usage?.todaySpendCents} limit={key.dailySpendLimitCents} label="今日提交预算"/></div>)}{!data.keys.length&&<Empty title="创建第一把 Key" description="每个应用一把 Key，额度和模型范围互不影响。" action={actions}/>}<footer className="dap-panel-note">请求数与预算按 UTC 重置（北京时间 08:00）</footer></section>
     <section className="dap-panel dap-start"><header><h3>接入地址</h3><span className="dap-small-label">OpenAI 兼容 · v1</span></header><div className="dap-start-copy"><h3>用你熟悉的 OpenAI SDK 接入</h3><p>把 base_url 换成下面的地址，api_key 换成你的 Key，model 填模型名。</p></div><div className="dap-start-terminal"><div className="dap-terminal-chrome"><span><i/><i/><i/></span><small>Terminal</small></div><pre><span className="dap-command-word">curl</span>{' '+apiBase+'/models'+' '+String.fromCharCode(92,10)}<span className="dap-command-option">  -H</span>{' "Authorization: Bearer YOUR_API_KEY"'}</pre></div><div className="dap-endpoint"><span>BASE</span><code>{apiBase}</code><button aria-label="复制 Base URL" title="复制 Base URL" onClick={()=>copy(apiBase,'Base URL 已复制')}><Copy size={14}/></button></div><button className="dap-button" onClick={()=>navigateTab('quickstart')}>查看接入示例<ArrowRight size={15}/></button></section></div>
    </>}
    {(tab==='keys'||tab==='models')&&<div className="dap-filterbar"><label className="dap-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={tab==='keys'?'搜索名称或 Key 前缀':'搜索模型'} aria-label="搜索当前列表"/>{query&&<button onClick={()=>setQuery('')} aria-label="清除搜索">×</button>}</label>
     <ConsoleSelect label={tab==='keys'?'状态筛选':'类型筛选'} value={filter} onChange={setFilter} options={tab==='keys'?[{value:'all',label:'全部状态'},...Object.entries(KEY_STATUSES).map(([value,label])=>({value,label}))]:[{value:'all',label:'全部类型'},{value:'image',label:'图片'},{value:'chat',label:'对话'}]}/>
     <span className="dap-filter-spacer"/>{tab==='keys'&&actions}
    </div>}
    {tab==='keys'&&<section className="dap-panel"><div className="dap-table-wrap"><table className="dap-keys-table"><thead><tr><th>名称 / Key</th><th>状态</th><th>可用模型</th><th>今日提交预算</th><th>最近使用</th><th/></tr></thead><tbody>{pageItems(keyList).map(key=><tr key={key.id}><td><button className="dap-row-title" onClick={()=>setDetail(key)}>{key.label}</button><code className="dap-subtext">{key.prefix}••••••••</code>{expiresSoon(key)&&<small className="dap-expiry">{time(key.expiresAt,true)} 到期</small>}</td><td><Badge status={keyStatus(key)}>{KEY_STATUSES[keyStatus(key)]}</Badge></td><td>{key.allowedModelIds?.length?`${key.allowedModelIds.length} 个指定模型`:'全部模型'}</td><td><Meter used={key.usage?.todaySpendCents} limit={key.dailySpendLimitCents} label="积分"/></td><td>{time(key.lastUsedAt,true)}<small className="dap-subtext">{key.lastUsedIp||(key.lastUsedAt?'IP 未记录':'尚未使用')}</small></td><td><button className="dap-icon" aria-label={`查看 ${key.label}`} title="查看详情" onClick={()=>setDetail(key)}><MoreHorizontal size={18}/></button></td></tr>)}</tbody></table></div>{!keyList.length&&<Empty title={data.keys.length?'没有匹配的 Key':'还没有 API Key'} description={data.keys.length?'换个关键词或状态试试。':'创建一把Key开始接入。'}/>}<Pager page={Math.min(page,Math.max(1,Math.ceil(keyList.length/8)))} total={keyList.length} onChange={setPage}/></section>}
    {tab==='calls'&&<CallsPanel client={client} keys={data.keys}/>}
    {tab==='models'&&<section className="dap-panel"><div className="dap-table-wrap"><table><thead><tr><th>模型名（model）</th><th>类型</th><th>起始价格</th><th>单次张数</th><th>参考图上限</th><th>分辨率</th><th/></tr></thead><tbody>{modelList.map(item=><tr key={item.id}><td><strong><CopyValue value={item.model} label="模型名" onCopy={copy}/></strong>{item.name!==item.model&&<span className="dap-subtext">{item.name}</span>}</td><td>{item.kind==='chat'?'对话':'图片'}</td><td>{number(item.priceCents)} 积分</td><td>{item.kind==='chat'?'—':item.maxImages||1}</td><td>{item.maxReferenceImages||0}</td><td>{item.kind==='chat'?'—':item.resolutions?.join(' / ')||'由模型决定'}</td><td><button className="dap-text-button" onClick={()=>openExample(item)}>接入示例<ArrowRight size={14}/></button></td></tr>)}</tbody></table></div>{!modelList.length&&<Empty icon={Box} title={data.models.length?'没有匹配的模型':'暂无可用模型'} description={data.models.length?'换个关键词或类型试试。':'模型开放状态由平台配置决定。'}/>}</section>}
    {tab==='quickstart'&&<div className="dap-quickstart"><section className="dap-panel"><header><h3>{protocol==='images'?'生成图片':'对话'}</h3><Badge status="active">只复制示例</Badge></header><div className="dap-quick-form"><label>接口<ConsoleSelect label="接口" value={protocol} onChange={value=>{setProtocol(value);setSelectedModel('')}} options={Object.entries(PROTOCOLS).map(([value,{label}])=>({value,label}))}/></label><label>模型<ConsoleSelect label="示例模型" value={model?.id||''} disabled={!exampleModels.length} placeholder={protocol==='chat'?'暂无对话模型':'暂无图片模型'} onChange={setSelectedModel} options={exampleModels.map(item=>({value:item.id,label:item.model}))}/></label><p>{protocol==='images'?'执行以下请求会按模型价格消耗积分，当前页面不会发送请求。':'每次对话按模型单价计费；上游失败会退回预留。当前页面不会发送请求。'}</p><div className="dap-endpoint"><span>BASE</span><code>{apiBase}</code><button aria-label="复制 Base URL" title="复制 Base URL" onClick={()=>copy(apiBase,'Base URL 已复制')}><Copy size={14}/></button></div><button className="dap-button" onClick={()=>copy(snippet,'cURL 示例已复制')}><Copy size={15}/>复制 cURL</button></div><div className="dap-code"><div><span>cURL</span><small>服务端调用</small></div><pre>{snippet}</pre></div><footer className="dap-panel-note">{protocol==='images'?'同步返回结果。失败（含超时）不扣费，网关不会重试；发出后主动断开，图片生成成功仍会扣费。客户端与代理读取超时不低于 270 秒。':'请求原样转发给上游，stream: true 返回 SSE。上游失败不扣费；已收到回答内容后主动断开照常扣费。单次最长 300 秒。'}</footer></section>
     <section className="dap-panel"><header><h3>接入流程</h3></header><ol className="dap-steps"><li><b>01</b><div><strong>创建 Key</strong><p>先设置较小的额度，需要时再限定可用模型或 IP 白名单。</p></div></li><li><b>02</b><div><strong>配置 OpenAI SDK</strong><p>base_url 填 {apiBase}，api_key 填你的 Key，model 填模型页里的模型名。</p></div></li><li><b>03</b><div><strong>{protocol==='images'?'生成图片并保存结果':'读取流式输出'}</strong><p>{protocol==='images'?'默认返回 b64_json，解码后保存。失败的请求不扣费，需要时直接发新请求。':'逐条读取 choices[0].delta.content，收到 data: [DONE] 即结束；如果中途收到 error 事件，表示本次失败且不扣费。'}</p></div></li></ol><footer className="dap-panel-note"><Link to="/developer-api/docs">查看 Python、Node 与图片编辑示例 <ExternalLink size={13}/></Link></footer></section><ReliabilityGuide/></div>}
   </>}
   <footer className="dap-content-footer"><span><span className="dap-status-dot"/>{Object.keys(errors).length?'部分数据未更新':'数据已同步'}</span><span>{updated?`更新于 ${time(updated,true)}`:''}</span></footer>
  </div></div>
  {notice&&<div className="dap-toast" role="status"><Check size={16}/>{notice}</div>}
  {dialog?.kind==='key'&&<KeyForm client={client} models={data.models} initial={dialog.item} onClose={()=>setDialog(null)} onSaved={savedKey}/>}
  {secret&&<Secret secret={secret} onClose={()=>setSecret(null)}/>}
  {detail&&<Modal title="Key 详情" onClose={()=>setDetail(null)} wide footer={<><button className="dap-button" disabled={detail.status==='revoked'} onClick={()=>{setDetail(null);setDialog({kind:'key',item:detail})}}>编辑</button><button className="dap-button danger" disabled={detail.status==='revoked'} onClick={()=>ask('revoke',detail)}><Trash2 size={15}/>撤销 Key</button><button className="dap-button primary" disabled={keyStatus(detail)!=='active'} onClick={()=>ask('rotate',detail)}><RotateCw size={15}/>轮换 Key</button></>}>
    <div className="dap-detail-head"><span className="dap-glyph"><KeyRound size={22}/></span><div><h3>{detail.label}</h3><code>{detail.prefix}••••••••</code></div><Badge status={keyStatus(detail)}>{KEY_STATUSES[keyStatus(detail)]}</Badge></div>{keyStatus(detail)==='frozen'&&<div className="dap-form-error"><strong>此 Key 已被风控冻结</strong><p>{(detail.freezeReason||'未记录原因').trim().replace(/[。.！!]+$/,'')}。冻结期间调用返回 403 api_key_frozen，请联系客服核实后解冻；上游服务故障或超时不会触发冻结。</p></div>}{keyStatus(detail)==='expired'&&<p className="dap-form-error">此 Key 已过期，调用返回 401 api_key_expired。请创建新 Key 并撤销旧 Key 以释放保留名额。</p>}<dl className="dap-details"><DetailRow label="可用模型">{detail.allowedModelIds?.length?detail.allowedModelIds.map(id=>data.models.find(item=>item.id===id)?.model||'已下线的模型').join('、'):'全部模型'}</DetailRow><DetailRow label="IP 白名单">{detail.ipAllowlist?.join('、')||'未限制'}</DetailRow><DetailRow label="创建时间">{time(detail.createdAt)}</DetailRow><DetailRow label="到期时间">{detail.expiresAt?time(detail.expiresAt):'长期有效'}</DetailRow><DetailRow label="最近使用 IP">{detail.lastUsedIp}</DetailRow><DetailRow label="每分钟请求上限">{number(detail.rateLimitPerMinute)}</DetailRow></dl><div className="dap-detail-quotas"><Meter used={detail.usage?.todayTasks} limit={detail.dailyTaskLimit} label="每日请求数"/><Meter used={detail.usage?.monthTasks} limit={detail.monthlyTaskLimit} label="每月请求数"/><Meter used={detail.usage?.todaySpendCents} limit={detail.dailySpendLimitCents} label="每日提交预算"/><Meter used={detail.usage?.monthSpendCents} limit={detail.monthlySpendLimitCents} label="每月提交预算"/></div><p className="dap-muted">今日流量 {bytes(detail.usage?.todayBytes)} / {bytes(detail.dailyByteLimit)} · 图片与对话请求都会计入，明确失败的请求不计入 · 过期但未撤销的Key仍占保留名额。</p>
  </Modal>}
  {confirmation&&<Modal title={confirmation.kind==='rotate'?'轮换访问密钥':'撤销访问密钥'} onClose={()=>setConfirmation(null)} busy={busy} footer={<><button className="dap-button" disabled={busy} onClick={()=>setConfirmation(null)}>取消</button><button className="dap-button primary" disabled={busy} onClick={confirm}>{busy?'处理中…':'确认操作'}</button></>}>
   <p className="dap-confirm-subject">{confirmation.item.label}</p><p>{confirmation.kind==='rotate'?'旧Key将立即失效，新密钥只显示一次。请及时更新调用方配置。':'撤销后无法恢复，使用这把Key的应用将不能继续调用接口。'}</p>{actionError&&<p className="dap-form-error" role="alert">{actionError}</p>}
  </Modal>}
 </div></main>;
}
