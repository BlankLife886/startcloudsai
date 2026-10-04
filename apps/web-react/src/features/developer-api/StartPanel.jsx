import {Activity,ArrowRight,CalendarDays,Check,Coins,Copy,Image,KeyRound,MessageSquareText,Plus,WandSparkles} from 'lucide-react';
import {ConsoleSelect} from './Controls.jsx';
import {CODE_LANGUAGES,INSTALL_COMMANDS,callableModel,codeExample,modelNotes,number} from './presentation.js';

export const PROTOCOLS={
 images:{label:'文生图',path:'/images/generations',kind:'image',call:'images.generate(',icon:Image,result:'运行后在当前目录生成 output.png。',curlResult:'返回 JSON，图片是 data[0].b64_json 里的 base64。'},
 edits:{label:'图片编辑',path:'/images/edits',kind:'image',call:'images.edit(',icon:WandSparkles,result:'运行前把参考图放到当前目录并命名为 reference.png，结果保存为 output.png。',curlResult:'上传当前目录的 reference.png，返回 JSON，图片是 data[0].b64_json 里的 base64。'},
 chat:{label:'对话',path:'/chat/completions',kind:'chat',call:'chat.completions.create(',icon:MessageSquareText,result:'运行后逐字打印模型回复，流结束即完成。',curlResult:'以 SSE 逐段返回，收到 data: [DONE] 即结束。'},
};
// Editing needs a model that accepts reference images.
export const modelsFor=(models,protocol)=>models.filter(item=>callableModel(item)&&item.kind===PROTOCOLS[protocol].kind&&(protocol!=='edits'||Number(item.maxReferenceImages)>0));
export const protocolFor=model=>model?.kind==='chat'?'chat':'images';

// Each setting on the left owns a tag; the code lines it changes carry the same
// tag, so it is clear what every choice does to the snippet.
const TAGS={endpoint:'接口',model:'模型',key:'API Key',base:'Base URL'};
function lineTags(line,{base,apiKey,protocol}){
 const tags=[];
 if(line.includes(base))tags.push('base');
 if(line.includes(apiKey||'YOUR_API_KEY'))tags.push('key');
 if(/\bmodel\b"?\s*[:=]/.test(line))tags.push('model');
 if(line.includes(PROTOCOLS[protocol].call)||line.includes(base+PROTOCOLS[protocol].path))tags.push('endpoint');
 return tags;
}

function Stats({ready,summary}){
 const cells=[['今日请求',summary.todayTasks,'次',Activity],['今日提交预算',summary.todayBudget,'积分',Coins],['本月请求',summary.monthTasks,'次',CalendarDays],['可用 Key',summary.usableKeys,`/ 10`,KeyRound]];
 return <dl className="dap-stats" aria-label="用量摘要">{cells.map(([label,value,unit,Icon])=><div key={label}><dt><span aria-hidden="true"><Icon size={15}/></span>{label}</dt><dd>{ready?number(value):'—'}<small>{unit}</small></dd></div>)}</dl>;
}

function Field({tag,label,aside,children}){
 return <div className="dap-field"><div className="dap-field-head"><span className={`dap-tag is-${tag}`}>{TAGS[tag]}</span><h3>{label}</h3>{aside}</div>{children}</div>;
}

// StartPanel is a request builder: choose the endpoint, model and key on the
// left and the code on the right updates line by line. A Key created or
// rotated during this visit is kept in memory only and filled into the code.
export function StartPanel({models,ready,summary,freshSecret,protocol,onProtocol,model,onModel,language,onLanguage,apiBase,createDisabled,createTitle,onCreate,onKeys,onModels,copy}){
 const exampleModels=modelsFor(models,protocol);
 const apiKey=freshSecret?.value;
 const code=codeExample({language,protocol,base:apiBase,model,apiKey});
 const install=INSTALL_COMMANDS[language];
 const base=apiBase.replace(/\/$/,'');
 return <>
  <Stats ready={ready.keys} summary={summary}/>
  <div className="dap-start-grid">
   <section className="dap-panel dap-builder" aria-label="请求配置">
    <Field tag="endpoint" label="要调用什么">
     <div className="dap-choice" role="radiogroup" aria-label="接口类型">{Object.entries(PROTOCOLS).map(([value,{label,icon:Icon}])=><button key={value} type="button" role="radio" aria-checked={protocol===value} className={protocol===value?'active':''} onClick={()=>onProtocol(value)}><Icon size={17}/><b>{label}</b></button>)}</div>
     <p className="dap-choice-path"><span>POST</span><code>/v1{PROTOCOLS[protocol].path}</code></p>
    </Field>
    <Field tag="model" label="用哪个模型" aside={model&&<small>{number(model.priceCents)} 积分起 / 次</small>}>
     <ConsoleSelect label="模型" value={model?.id||''} disabled={!exampleModels.length} placeholder={protocol==='chat'?'暂无对话模型':protocol==='edits'?'暂无支持参考图的模型':'暂无图片模型'} onChange={onModel} options={exampleModels.map(item=>({value:item.id,label:item.model}))}/>
     {modelNotes(model).map(([tone,text])=><p key={text} className={`dap-model-note is-${tone}`}>{text}</p>)}
     <button className="dap-text-button" onClick={onModels}>查看全部模型与参数<ArrowRight size={14}/></button>
    </Field>
    <Field tag="key" label="用哪把 Key" aside={freshSecret&&<small className="is-ok"><Check size={13}/>已填入</small>}>
     {freshSecret?<><span className="dap-secret-inline" title={`「${freshSecret.label}」的密钥已填进代码`}><KeyRound size={14}/><code>{freshSecret.value.slice(0,10)}••••••••</code><button type="button" onClick={()=>copy(freshSecret.value,'密钥已复制')}><Copy size={13}/>复制</button></span></>
      :summary.usableKeys>0?<><div className="dap-action-row"><button className="dap-button" onClick={onCreate} disabled={createDisabled} title={createTitle}><Plus size={15}/>新建 Key</button><button className="dap-text-button" onClick={onKeys}>管理 {summary.usableKeys} 把 Key<ArrowRight size={14}/></button></div></>
      :<><button className="dap-button primary" onClick={onCreate} disabled={createDisabled} title={createTitle}><Plus size={15}/>创建 Key</button></>}
    </Field>
    <Field tag="base" label="请求地址" aside={<small>固定</small>}>
     <div className="dap-endpoint"><code>{base}</code><button aria-label="复制 Base URL" title="复制 Base URL" onClick={()=>copy(base,'Base URL 已复制')}><Copy size={14}/></button></div>
    </Field>
   </section>
   <section className="dap-code" aria-label="示例代码">
    <header><div className="dap-code-tabs" role="tablist" aria-label="语言">{CODE_LANGUAGES.map(([value,label])=><button key={value} type="button" role="tab" aria-selected={language===value} className={language===value?'active':''} onClick={()=>onLanguage(value)}>{label}</button>)}</div><button type="button" className="dap-code-copy" onClick={()=>copy(code,'代码已复制')}><Copy size={14}/>复制代码</button></header>
    {install&&<div className="dap-code-install"><span>先安装</span><code><i>$</i> {install}</code><button type="button" aria-label="复制安装命令" title="复制安装命令" onClick={()=>copy(install,'安装命令已复制')}><Copy size={13}/></button></div>}
    <pre tabIndex={0} aria-label="示例代码">{code.split('\n').map((line,index)=>{const tags=lineTags(line,{base,apiKey,protocol});return <span key={index} className={`dap-line${tags.length?` is-${tags[0]}`:''}`}><span className="dap-line-no" aria-hidden="true">{index+1}</span><span className="dap-line-text">{line||' '}</span>{tags.map(tag=><i key={tag} className={`dap-tag is-${tag}`} aria-hidden="true">{TAGS[tag]}</i>)}</span>})}</pre>
    <footer><Check size={13}/>{language==='curl'?PROTOCOLS[protocol].curlResult:PROTOCOLS[protocol].result}{freshSecret?' 代码里已是真实密钥，不要提交到代码仓库或公开分享。':' 失败或超时不扣费（内容违规被驳回除外），网关不会自动重试。'}</footer>
   </section>
  </div>
 </>;
}
