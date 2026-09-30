import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyKey,keyPayload,keyStatus,imageCurlExample,editCurlExample,chatCurlExample,codeExample} from './presentation.js';
test('expired keys are not usable and monthly limits cannot be below daily limits',()=>{
 assert.equal(keyStatus({status:'active',expiresAt:'2025-01-01T00:00:00Z'},Date.parse('2026-01-01T00:00:00Z')),'expired');
 assert.equal(keyStatus({status:'frozen',expiresAt:'2025-01-01T00:00:00Z'}),'frozen');
 assert.throws(()=>keyPayload({...emptyKey(),label:'demo',dailyTaskLimit:3000,monthlyTaskLimit:2000}),/月额度/);
});
test('Images example uses the compatibility path and a reusable idempotency placeholder',()=>{
 const code=imageCurlExample('https://example.com/v1/',{id:'model-internal-uuid',model:"public'quoted"});
 assert.ok(code.includes('/v1/images/generations'));
 assert.ok(!code.includes('Idempotency-Key'));
 assert.ok(code.includes('"response_format": "b64_json"'));
 assert.ok(code.includes('"size": "auto"'));
 assert.ok(code.includes('"n": 1'));
 assert.ok(code.includes("'\\''"));
 assert.ok(!code.includes('/tasks/quote'));
 assert.ok(!code.includes('"params"'));
 assert.ok(!code.includes('model-internal-uuid'));
 assert.ok(imageCurlExample('https://example.com/v1').includes('MODEL_NAME'));
});
test('Chat example streams a chat model by its name on the /v1 path',()=>{
 const code=chatCurlExample('https://example.com/v1/',{id:'model-internal-uuid',model:"chat'quoted"});
 assert.ok(code.includes("'https://example.com/v1/chat/completions'"));
 assert.ok(code.includes('"stream": true'));
 assert.ok(code.includes('"messages"'));
 assert.ok(code.includes("'\\''"));
 assert.ok(!code.includes('model-internal-uuid'));
 assert.ok(chatCurlExample('https://example.com/v1').includes('CHAT_MODEL_NAME'));
});

test('Edits example uploads the reference image as multipart on /v1/images/edits',()=>{
 const code=editCurlExample('https://example.com/v1/',{id:'model-internal-uuid',model:'edit-model'});
 assert.ok(code.includes("'https://example.com/v1/images/edits'"));
 assert.ok(code.includes("-F 'model=edit-model'"));
 assert.ok(code.includes("-F 'image=@./reference.png'"));
 assert.ok(!code.includes('Content-Type: application/json'));
 assert.ok(!code.includes('model-internal-uuid'));
 for(const language of ['python','node']){
  const sdk=codeExample({language,protocol:'edits',base:'https://example.com/v1',model:{model:'edit-model'}});
  assert.ok(sdk.includes('images.edit('),language);
  assert.ok(sdk.includes('reference.png'),language);
 }
});
