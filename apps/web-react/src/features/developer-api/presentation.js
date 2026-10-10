export const KEY_STATUSES = {active:'可用',paused:'已停用',frozen:'已冻结',revoked:'已撤销',expired:'已过期'};
// Model lifecycle as the console shows it (docs/DEVELOPER_API_MODEL_CATALOG.md section 5).
export const MODEL_STATUSES = {live:['可用','active'],deprecated:['即将下线','warn'],maintenance:['维护中','paused'],retired:['已下线','revoked']};
export const callableModel = model => !model?.status||model.status==='live'||model.status==='deprecated';
export function day(value){const date=new Date(value);return Number.isNaN(date.getTime())?'—':`${date.getMonth()+1}月${date.getDate()}日`;}
// modelNotes lists what an integrator should know about a model: its sunset
// and replacement, maintenance, and an announced price change.
export function modelNotes(model){
 const notes=[],successor=model?.replacement?.model?`，建议改用 ${model.replacement.model}`:'';
 if(model?.status==='deprecated'&&model.sunsetAt)notes.push(['warn',`${day(model.sunsetAt)} 下线${successor}`]);
 if(model?.status==='retired')notes.push(['bad',`已下线，调用返回 410${successor}`]);
 if(model?.status==='maintenance')notes.push(['info','暂时不可用，调用返回 503，可稍后重试，不扣费']);
 if(model?.pendingPrice)notes.push(['info',`${day(model.pendingPrice.effectiveAt)} 起调整为 ${number(model.pendingPrice.priceCents)} 积分/次`]);
 return notes;
}
// sizeText / qualityText tell an integrator what size and quality to send.
export function sizeText(model){
 const exact=model?.exactSize;
 if(!exact)return 'auto';
 const range=`${exact.minWidth}–${exact.maxWidth} × ${exact.minHeight}–${exact.maxHeight}`;
 return `auto，或 宽x高（${range}${exact.step>1?`，${exact.step} 的倍数`:''}）`;
}
export function qualityText(model){return ['auto',...(model?.qualities||[])].join(' / ');}
// keyModels sorts a Key's allowlist by what calls with it will do.
export function keyModels(ids,models){
 const found=ids.map(id=>models.find(model=>model.id===id)),usable=found.filter(callableModel).filter(Boolean);
 return {usable,deprecated:found.filter(model=>model?.status==='deprecated'),retired:found.filter(model=>!model||model.status==='retired').length,paused:found.filter(model=>model?.status==='maintenance')};
}
export const number = value => Math.max(0,Number(value)||0).toLocaleString('zh-CN');
export function keyStatus(key,now=Date.now()){return key.status==='active'&&key.expiresAt&&Date.parse(key.expiresAt)<=now?'expired':key.status;}
export function expiresSoon(key,now=Date.now()){const expiry=Date.parse(key.expiresAt);return keyStatus(key,now)==='active'&&expiry>now&&expiry-now<14*86400000;}
export function time(value,short=false){if(!value)return '—';const date=new Date(value);if(Number.isNaN(date.getTime()))return '—';return date.toLocaleString('zh-CN',short?{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}:{hour12:false});}
export function ago(value,now=Date.now()){if(!value)return '';const diff=now-Date.parse(value);if(!(diff>=0))return time(value,true);const minutes=Math.floor(diff/60000);if(minutes<1)return '刚刚';if(minutes<60)return `${minutes} 分钟前`;const hours=Math.floor(minutes/60);if(hours<24)return `${hours} 小时前`;const days=Math.floor(hours/24);return days<30?`${days} 天前`:time(value,true);}
export function bytes(value){const n=Number(value)||0;return n>=1024**3?`${(n/1024**3).toFixed(2)} GiB`:`${(n/1024**2).toFixed(1)} MiB`;}
export function ratio(used,limit){return limit>0?Math.max(0,Math.min(100,Number(used||0)/limit*100)):0;}
export async function copyText(value){if(!navigator.clipboard?.writeText)throw new Error('浏览器不允许自动复制，请手动选择内容复制');await navigator.clipboard.writeText(String(value));}
export function localDate(){const date=new Date();date.setMinutes(date.getMinutes()-date.getTimezoneOffset());return date.toISOString().slice(0,10);}
export function emptyKey(){return {label:'',allowedModelIds:[],dailyTaskLimit:100,monthlyTaskLimit:2000,dailySpendLimitCents:10000,monthlySpendLimitCents:200000,rateLimitPerMinute:120,dailyByteLimitGiB:2,ipAllowlistText:'',expiresAt:''};}
// Quota presets for the Key form; 轻量 matches emptyKey().
export const QUOTA_FIELDS=['dailyTaskLimit','monthlyTaskLimit','rateLimitPerMinute','dailySpendLimitCents','monthlySpendLimitCents','dailyByteLimitGiB'];
export const KEY_PRESETS=[
 ['light','轻量','测试与个人脚本',{dailyTaskLimit:100,monthlyTaskLimit:2000,rateLimitPerMinute:120,dailySpendLimitCents:10000,monthlySpendLimitCents:200000,dailyByteLimitGiB:2}],
 ['standard','标准','小型线上应用',{dailyTaskLimit:1000,monthlyTaskLimit:20000,rateLimitPerMinute:300,dailySpendLimitCents:50000,monthlySpendLimitCents:1000000,dailyByteLimitGiB:10}],
 ['heavy','高用量','批量生产',{dailyTaskLimit:10000,monthlyTaskLimit:200000,rateLimitPerMinute:1200,dailySpendLimitCents:500000,monthlySpendLimitCents:10000000,dailyByteLimitGiB:50}],
];
export function presetOf(draft){return KEY_PRESETS.find(([, , ,values])=>QUOTA_FIELDS.every(field=>Number(draft[field])===values[field]))?.[0]||'custom';}
export function draftFromKey(key){
 return {
  label:key?.label||'',allowedModelIds:[...(key?.allowedModelIds||[])],
  dailyTaskLimit:key?.dailyTaskLimit||100,monthlyTaskLimit:key?.monthlyTaskLimit||2000,
  dailySpendLimitCents:key?.dailySpendLimitCents||10000,monthlySpendLimitCents:key?.monthlySpendLimitCents||200000,
  rateLimitPerMinute:key?.rateLimitPerMinute||120,
  dailyByteLimitGiB:Number(((Number(key?.dailyByteLimit)||2*1024**3)/1024**3).toFixed(3)),
  ipAllowlistText:(key?.ipAllowlist||[]).join(', '),
  expiresAt:key?.expiresAt?String(key.expiresAt).slice(0,10):'',
 };
}
export function keyPayload(draft){
 const payload={label:draft.label.trim(),allowedModelIds:draft.allowedModelIds,expiresAt:draft.expiresAt?new Date(`${draft.expiresAt}T23:59:59`).toISOString():null,
 ipAllowlist:[...new Set(draft.ipAllowlistText.split(/[\s,]+/).filter(Boolean))],dailyByteLimit:Math.round(Number(draft.dailyByteLimitGiB)*1024**3)};
 for(const [field,min,max] of [['dailyTaskLimit',1,100000],['monthlyTaskLimit',1,1000000],['dailySpendLimitCents',1,1000000000],['monthlySpendLimitCents',1,10000000000],['rateLimitPerMinute',1,10000]]){
  const value=Number(draft[field]);if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error('请求数、积分和每分钟请求上限须为范围内的整数');payload[field]=value;
 }
 if(!payload.label)throw new Error('请填写名称');
 if(payload.monthlyTaskLimit<payload.dailyTaskLimit||payload.monthlySpendLimitCents<payload.dailySpendLimitCents)throw new Error('月额度不能小于日额度');
 if(payload.dailyByteLimit<1024**2||payload.dailyByteLimit>1024**4)throw new Error('每日流量须在1 MiB至1024 GiB之间');
 if(payload.ipAllowlist.length>20)throw new Error('IP白名单最多20项');
 if(payload.expiresAt&&Date.parse(payload.expiresAt)<=Date.now())throw new Error('请选择未来的到期日期');
 return payload;
}

const SAMPLE_IMAGE_PROMPT='一只在窗边晒太阳的橘猫，柔和自然光，摄影风格';
const SAMPLE_EDIT_PROMPT='保留主体，将背景改为简洁的浅蓝色摄影棚';
const SAMPLE_REFERENCE='reference.png';
const SAMPLE_CHAT=[{role:'system',content:'用简体中文回答。'},{role:'user',content:'用一句话介绍你自己'}];
const shellQuote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const trimBase=base=>base.replace(/\/$/,'');
const keyOrPlaceholder=apiKey=>apiKey||'YOUR_API_KEY';

export function imageCurlExample(base,model,apiKey){
 const body=JSON.stringify({model:model?.model||'MODEL_NAME',prompt:SAMPLE_IMAGE_PROMPT,n:1,size:'auto',quality:'auto',response_format:'b64_json'},null,2);
 return [`curl -sS --max-time 270 ${shellQuote(trimBase(base)+'/images/generations')}`,`  -H ${shellQuote('Authorization: Bearer '+keyOrPlaceholder(apiKey))}`,"  -H 'Content-Type: application/json'",`  -d ${shellQuote(body)}`].join(' '+String.fromCharCode(92,10));
}

// Edits are multipart uploads, as in docs/OPEN_API.md.
export function editCurlExample(base,model,apiKey){
 return [`curl -sS --max-time 270 ${shellQuote(trimBase(base)+'/images/edits')}`,`  -H ${shellQuote('Authorization: Bearer '+keyOrPlaceholder(apiKey))}`,`  -F ${shellQuote('model='+(model?.model||'MODEL_NAME'))}`,`  -F ${shellQuote('prompt='+SAMPLE_EDIT_PROMPT)}`,`  -F ${shellQuote('image=@./'+SAMPLE_REFERENCE)}`].join(' '+String.fromCharCode(92,10));
}

export function chatCurlExample(base,model,apiKey){
 const body=JSON.stringify({model:model?.model||'CHAT_MODEL_NAME',messages:SAMPLE_CHAT,stream:true},null,2);
 return [`curl -sS -N --max-time 300 ${shellQuote(trimBase(base)+'/chat/completions')}`,`  -H ${shellQuote('Authorization: Bearer '+keyOrPlaceholder(apiKey))}`,"  -H 'Content-Type: application/json'",`  -d ${shellQuote(body)}`].join(' '+String.fromCharCode(92,10));
}

// SDK examples mirror docs/OPEN_API.md: SDK retries off, read timeout above the
// gateway's 240 s upstream wait.
function pythonExample(base,model,apiKey,protocol){
 const client=['from openai import OpenAI','','client = OpenAI(',`    base_url=${JSON.stringify(trimBase(base))},`,`    api_key=${JSON.stringify(keyOrPlaceholder(apiKey))},`,`    timeout=${protocol==='chat'?'300.0':'270.0'},`,'    max_retries=0,',')',''];
 if(protocol==='chat')return [...client,'stream = client.chat.completions.create(',`    model=${JSON.stringify(model?.model||'CHAT_MODEL_NAME')},`,'    messages=[',...SAMPLE_CHAT.map(m=>`        {"role": "${m.role}", "content": ${JSON.stringify(m.content)}},`),'    ],','    stream=True,',')','for chunk in stream:','    if chunk.choices:','        print(chunk.choices[0].delta.content or "", end="", flush=True)'].join('\n');
 const save=['image = result.data[0]','# 部分模型返回图片链接（url），两种都要处理','data = base64.b64decode(image.b64_json) if image.b64_json else urllib.request.urlopen(image.url).read()','with open("output.png", "wb") as file:','    file.write(data)'];
 if(protocol==='edits')return ['import base64','import urllib.request',...client,'result = client.images.edit(',`    model=${JSON.stringify(model?.model||'MODEL_NAME')},`,`    image=open(${JSON.stringify(SAMPLE_REFERENCE)}, "rb"),`,`    prompt=${JSON.stringify(SAMPLE_EDIT_PROMPT)},`,')',...save].join('\n');
 return ['import base64','import urllib.request',...client,'result = client.images.generate(',`    model=${JSON.stringify(model?.model||'MODEL_NAME')},`,`    prompt=${JSON.stringify(SAMPLE_IMAGE_PROMPT)},`,'    size="auto",',')',...save].join('\n');
}

function nodeExample(base,model,apiKey,protocol){
 const client=['import OpenAI from "openai";','','const client = new OpenAI({',`  baseURL: ${JSON.stringify(trimBase(base))},`,`  apiKey: ${JSON.stringify(keyOrPlaceholder(apiKey))},`,`  timeout: ${protocol==='chat'?'300_000':'270_000'},`,'  maxRetries: 0,','});',''];
 if(protocol==='chat')return [...client,'const stream = await client.chat.completions.create({',`  model: ${JSON.stringify(model?.model||'CHAT_MODEL_NAME')},`,'  messages: [',...SAMPLE_CHAT.map(m=>`    { role: "${m.role}", content: ${JSON.stringify(m.content)} },`),'  ],','  stream: true,','});','for await (const chunk of stream) {','  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");','}'].join('\n');
 const save=['const image = result.data[0];','// 部分模型返回图片链接（url），两种都要处理','const data = image.b64_json','  ? Buffer.from(image.b64_json, "base64")','  : Buffer.from(await (await fetch(image.url)).arrayBuffer());','fs.writeFileSync("output.png", data);'];
 if(protocol==='edits')return ['import fs from "node:fs";',...client,'const result = await client.images.edit({',`  model: ${JSON.stringify(model?.model||'MODEL_NAME')},`,`  image: fs.createReadStream(${JSON.stringify(SAMPLE_REFERENCE)}),`,`  prompt: ${JSON.stringify(SAMPLE_EDIT_PROMPT)},`,'});',...save].join('\n');
 return ['import fs from "node:fs";',...client,'const result = await client.images.generate({',`  model: ${JSON.stringify(model?.model||'MODEL_NAME')},`,`  prompt: ${JSON.stringify(SAMPLE_IMAGE_PROMPT)},`,'  size: "auto",','});',...save].join('\n');
}

export const CODE_LANGUAGES = [['python','Python'],['node','Node.js'],['curl','cURL']];
export const INSTALL_COMMANDS = {python:'pip install openai',node:'npm install openai',curl:''};

export function codeExample({language,protocol,base,model,apiKey}){
 if(language==='python')return pythonExample(base,model,apiKey,protocol);
 if(language==='node')return nodeExample(base,model,apiKey,protocol);
 if(protocol==='chat')return chatCurlExample(base,model,apiKey);
 return protocol==='edits'?editCurlExample(base,model,apiKey):imageCurlExample(base,model,apiKey);
}
