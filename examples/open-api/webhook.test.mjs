import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyStarCloudWebhook } from './webhook.mjs';

const rawBody=Buffer.from('{"id":"delivery-123"}'),secret='test-only-secret',timestamp='1788652800';
const signature='v1='+createHmac('sha256',secret).update(timestamp+'.').update(rawBody).digest('hex');
const valid={rawBody,secret,timestamp,signature,nowSeconds:Number(timestamp)};
test('valid raw bytes pass and changed bytes fail',()=>{assert.equal(verifyStarCloudWebhook(valid),true);assert.equal(verifyStarCloudWebhook({...valid,rawBody:Buffer.from('{}')}),false)});
test('missing short or malformed signature fails without exceptions',()=>{for(const value of [undefined,null,'','v1=a','v1='+'z'.repeat(64),'x'.repeat(1000)])assert.equal(verifyStarCloudWebhook({...valid,signature:value}),false)});
test('timestamps reject replay, future skew and invalid types',()=>{for(const value of ['bad',null,1788652800])assert.equal(verifyStarCloudWebhook({...valid,timestamp:value}),false);assert.equal(verifyStarCloudWebhook({...valid,nowSeconds:Number(timestamp)+301}),false);assert.equal(verifyStarCloudWebhook({...valid,nowSeconds:Number(timestamp)-301}),false)});
