export const SCOPES = [['models:read','读取模型'],['files:write','上传文件'],['tasks:write','报价与创建任务'],['tasks:read','读取任务与文件']];
export const EVENTS = [['task.succeeded','任务成功'],['task.failed','任务失败'],['task.canceled','任务取消']];
export const KEY_STATUSES = {active:'可用',frozen:'已冻结',revoked:'已撤销',expired:'已过期'};
export const DELIVERY_STATUSES = {delivered:'已送达',pending:'待投递',dead:'投递失败'};
export const number = value => Math.max(0,Number(value)||0).toLocaleString('zh-CN');
export function keyStatus(key,now=Date.now()){return key.status==='active'&&key.expiresAt&&Date.parse(key.expiresAt)<=now?'expired':key.status;}
export function expiresSoon(key,now=Date.now()){const expiry=Date.parse(key.expiresAt);return keyStatus(key,now)==='active'&&expiry>now&&expiry-now<14*86400000;}
export function time(value,short=false){if(!value)return '—';const date=new Date(value);if(Number.isNaN(date.getTime()))return '—';return date.toLocaleString('zh-CN',short?{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}:{hour12:false});}
export function bytes(value){const n=Number(value)||0;return n>=1024**3?`${(n/1024**3).toFixed(2)} GiB`:`${(n/1024**2).toFixed(1)} MiB`;}
export function ratio(used,limit){return limit>0?Math.max(0,Math.min(100,Number(used||0)/limit*100)):0;}
export async function copyText(value){if(!navigator.clipboard?.writeText)throw new Error('浏览器不允许自动复制，请手动选择内容复制');await navigator.clipboard.writeText(String(value));}
export function localDate(){const date=new Date();date.setMinutes(date.getMinutes()-date.getTimezoneOffset());return date.toISOString().slice(0,10);}
export function emptyKey(){return {label:'',scopes:SCOPES.map(([id])=>id),allowedModelIds:[],dailyTaskLimit:100,monthlyTaskLimit:2000,dailySpendLimitCents:10000,monthlySpendLimitCents:200000,rateLimitPerMinute:120,dailyByteLimitGiB:2,ipAllowlistText:'',expiresAt:''};}
export function keyPayload(draft){
 const payload={label:draft.label.trim(),scopes:draft.scopes,allowedModelIds:draft.allowedModelIds,expiresAt:draft.expiresAt?new Date(`${draft.expiresAt}T23:59:59`).toISOString():null,
 ipAllowlist:[...new Set(draft.ipAllowlistText.split(/[\s,]+/).filter(Boolean))],dailyByteLimit:Math.round(Number(draft.dailyByteLimitGiB)*1024**3)};
 for(const [field,min,max] of [['dailyTaskLimit',1,100000],['monthlyTaskLimit',1,1000000],['dailySpendLimitCents',1,1000000000],['monthlySpendLimitCents',1,10000000000],['rateLimitPerMinute',1,10000]]){
  const value=Number(draft[field]);if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error('任务、积分和请求额度须为范围内的整数');payload[field]=value;
 }
 if(!payload.label||!payload.scopes.length)throw new Error('请填写名称并至少选择一项权限');
 if(payload.monthlyTaskLimit<payload.dailyTaskLimit||payload.monthlySpendLimitCents<payload.dailySpendLimitCents)throw new Error('月额度不能小于日额度');
 if(payload.dailyByteLimit<1024**2||payload.dailyByteLimit>1024**4)throw new Error('每日流量须在1 MiB至1024 GiB之间');
 if(payload.ipAllowlist.length>20)throw new Error('IP白名单最多20项');
 if(payload.expiresAt&&Date.parse(payload.expiresAt)<=Date.now())throw new Error('请选择未来的到期日期');
 return payload;
}

export function curlExample(base,model){
 const body=JSON.stringify({type:'t2i',count:1,params:{modelId:model?.id||'PUBLIC_MODEL_ID',aspectRatio:model?.aspectRatios?.[0]||'1:1',resolution:model?.resolutions?.[0]||'1K'}},null,2);
 const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
 return [`curl ${quote(base+'/tasks/quote')}`,"  -H 'Authorization: Bearer YOUR_API_KEY'","  -H 'Content-Type: application/json'",`  -d ${quote(body)}`].join(' '+String.fromCharCode(92,10));
}

export function imageCurlExample(base,model){
 const body=JSON.stringify({model:model?.id||'PUBLIC_MODEL_ID',prompt:'一只在窗边晒太阳的橘猫，柔和自然光，摄影风格',n:1,size:'auto',quality:'auto',response_format:'b64_json'},null,2);
 const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
 return [`curl --max-time 270 ${quote(base.replace(/\/$/,'')+'/images/generations')}`,"  -H 'Authorization: Bearer YOUR_API_KEY'","  -H 'Content-Type: application/json'","  -H 'Idempotency-Key: REPLACE_WITH_SAVED_REQUEST_ID'",`  -d ${quote(body)}`].join(' '+String.fromCharCode(92,10));
}

// A fixed 1×1 PNG demonstrates the wire format without fetching or generating images.
export function imageResponseExample(){return {created:1788912000,data:[{b64_json:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNoDPj/HwAF9gLQWK3ToAAAAABJRU5ErkJggg=='}]};}
