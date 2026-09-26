import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyKey,keyPayload,keyStatus,curlExample,imageCurlExample,imageResponseExample} from './presentation.js';
test('expired keys are not usable and monthly limits cannot be below daily limits',()=>{
 assert.equal(keyStatus({status:'active',expiresAt:'2025-01-01T00:00:00Z'},Date.parse('2026-01-01T00:00:00Z')),'expired');
 assert.equal(keyStatus({status:'frozen',expiresAt:'2025-01-01T00:00:00Z'}),'frozen');
 assert.throws(()=>keyPayload({...emptyKey(),label:'demo',dailyTaskLimit:3000,monthlyTaskLimit:2000}),/月额度/);
});
test('quote example uses safe placeholders and shell-escapes JSON',()=>{
 const code=curlExample('https://example.com/api/open/v1',{id:"demo'quoted"});
 assert.ok(code.includes('/tasks/quote'));assert.ok(code.includes('YOUR_API_KEY'));assert.ok(code.includes("'\\''"));assert.ok(!code.includes('\n+'));
});
test('Images example uses the compatibility path and a reusable idempotency placeholder',()=>{
 const code=imageCurlExample('https://example.com/v1/',{id:"public'quoted"});
 assert.ok(code.includes('/v1/images/generations'));
 assert.ok(code.includes('Idempotency-Key: REPLACE_WITH_SAVED_REQUEST_ID'));
 assert.ok(code.includes('"response_format": "b64_json"'));
 assert.ok(code.includes('"size": "auto"'));
 assert.ok(code.includes('"n": 1'));
 assert.ok(code.includes("'\\''"));
 assert.ok(!code.includes('/tasks/quote'));
 assert.ok(!code.includes('"params"'));
 assert.ok(imageCurlExample('https://example.com/v1').includes('PUBLIC_MODEL_ID'));
});
test('Images demo returns an independent fixed PNG response without a real task',()=>{
 const first=imageResponseExample(),second=imageResponseExample();
 assert.deepEqual(first,second);
 const png=Buffer.from(first.data[0].b64_json,'base64');
 assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
 assert.equal(png.readUInt32BE(16),1);assert.equal(png.readUInt32BE(20),1);
 assert.equal(png.subarray(-8,-4).toString('ascii'),'IEND');
 first.data[0].b64_json='changed';
 assert.notEqual(imageResponseExample().data[0].b64_json,'changed');
 assert.equal('task_id' in first,false);
});
