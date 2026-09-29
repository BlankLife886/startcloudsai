export const KEY_STATUSES = {active:'可用',frozen:'已冻结',revoked:'已撤销',expired:'已过期'};
export const number = value => Math.max(0,Number(value)||0).toLocaleString('zh-CN');
export function keyStatus(key,now=Date.now()){return key.status==='active'&&key.expiresAt&&Date.parse(key.expiresAt)<=now?'expired':key.status;}
export function expiresSoon(key,now=Date.now()){const expiry=Date.parse(key.expiresAt);return keyStatus(key,now)==='active'&&expiry>now&&expiry-now<14*86400000;}
export function time(value,short=false){if(!value)return '—';const date=new Date(value);if(Number.isNaN(date.getTime()))return '—';return date.toLocaleString('zh-CN',short?{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}:{hour12:false});}
export function bytes(value){const n=Number(value)||0;return n>=1024**3?`${(n/1024**3).toFixed(2)} GiB`:`${(n/1024**2).toFixed(1)} MiB`;}
export function ratio(used,limit){return limit>0?Math.max(0,Math.min(100,Number(used||0)/limit*100)):0;}
export async function copyText(value){if(!navigator.clipboard?.writeText)throw new Error('浏览器不允许自动复制，请手动选择内容复制');await navigator.clipboard.writeText(String(value));}
export function localDate(){const date=new Date();date.setMinutes(date.getMinutes()-date.getTimezoneOffset());return date.toISOString().slice(0,10);}
export function emptyKey(){return {label:'',allowedModelIds:[],dailyTaskLimit:100,monthlyTaskLimit:2000,dailySpendLimitCents:10000,monthlySpendLimitCents:200000,rateLimitPerMinute:120,dailyByteLimitGiB:2,ipAllowlistText:'',expiresAt:''};}
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

export function imageCurlExample(base,model){
 const body=JSON.stringify({model:model?.model||'MODEL_NAME',prompt:'一只在窗边晒太阳的橘猫，柔和自然光，摄影风格',n:1,size:'auto',quality:'auto',response_format:'b64_json'},null,2);
 const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
 return [`curl --max-time 270 ${quote(base.replace(/\/$/,'')+'/images/generations')}`,"  -H 'Authorization: Bearer YOUR_API_KEY'","  -H 'Content-Type: application/json'",`  -d ${quote(body)}`].join(' '+String.fromCharCode(92,10));
}

export function chatCurlExample(base,model){
 const body=JSON.stringify({model:model?.model||'CHAT_MODEL_NAME',messages:[{role:'system',content:'用简体中文回答。'},{role:'user',content:'用一句话介绍你自己'}],stream:true},null,2);
 const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
 return [`curl -N --max-time 300 ${quote(base.replace(/\/$/,'')+'/chat/completions')}`,"  -H 'Authorization: Bearer YOUR_API_KEY'","  -H 'Content-Type: application/json'",`  -d ${quote(body)}`].join(' '+String.fromCharCode(92,10));
}

// Billing behaviour of the /v1 gateway, mirrored from docs/OPEN_API.md.
export const BILLING_RULES = [
 ['成功才扣费','拿到结果才按模型价格结算，同一请求只扣一次。'],
 ['失败全额退回','上游拒绝（含内容风控）、出错、超时或平台故障都算失败：退回预留积分，也不计入 Key 的日/月额度。'],
 ['断开不等于失败','生图和非流式对话发出后你断开连接，上游成功仍会扣费；流式对话收到内容后断开照常扣费，收到内容前断开不扣费。'],
 ['不自动重试','网关不会替你重试。需要重试时发一个新请求，并关闭 SDK 的自动重试（max_retries=0）。'],
 ['模型并发上限','部分模型限制同时进行的请求数，超出时立即返回 429 model_concurrency_limited，稍后再发即可。'],
];

export const ERROR_CODES = [
 ['400','invalid_parameter','参数不合法或模型不支持该取值，消息指出具体字段和可选值'],
 ['400','upstream_rejected','上游拒绝了请求（如内容安全），消息附上游原因'],
 ['401','api_key_expired','Key 已过期，请创建或轮换'],
 ['403','api_key_frozen','Key 被风控冻结，消息中含原因'],
 ['404','model_not_found','模型名写错，或未开放给这把 Key'],
 ['429','model_concurrency_limited','该模型同时进行的请求已达上限'],
 ['429','api_key_daily_limit','Key 当日请求数或积分额度已用完'],
 ['502','upstream_error','上游服务出错，消息附 HTTP 状态和原因'],
 ['502','upstream_misconfigured','平台上游配置异常，与你的 Key 无关'],
 ['504','request_timeout','等待上游超过 240 秒'],
];
