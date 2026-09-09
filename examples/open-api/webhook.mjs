import { createHmac, timingSafeEqual } from 'node:crypto';

// Pass the unmodified bytes received by the HTTP server, before JSON parsing.
export function verifyStarCloudWebhook({rawBody,timestamp,signature,secret,nowSeconds=Math.floor(Date.now()/1000)}) {
  if (!Buffer.isBuffer(rawBody) || typeof secret!=='string' || !secret || typeof timestamp!=='string' || !/^\d{10,12}$/.test(timestamp)) return false;
  if (typeof signature!=='string' || !/^v1=[0-9a-f]{64}$/.test(signature)) return false;
  const seconds=Number(timestamp);
  if (!Number.isSafeInteger(seconds) || !Number.isFinite(nowSeconds) || Math.abs(nowSeconds-seconds)>300) return false;
  const expected=createHmac('sha256',secret).update(timestamp+'.').update(rawBody).digest();
  const actual=Buffer.from(signature.slice(3),'hex');
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}
