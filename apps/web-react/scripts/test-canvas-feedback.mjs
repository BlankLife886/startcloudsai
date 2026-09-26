import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});after(()=>server.close());
const load=path=>server.ssrLoadModule('/src/canvas/'+path);
const {canvasCheckpointFromRun,canvasRecoveryAttemptKey,isFinishedCanvasTaskError}=await load('lib/canvas/canvas-workflow-observation.ts');
const {normalizeCanvasWorkflowCheckpoint}=await load('lib/canvas/canvas-workflow.ts');
const {defaultCanvasImageRatio,coerceCanvasImageSettings,canvasImageSettingsFromModel}=await load('lib/canvas/canvas-image-model.ts');
const {defaultConfig}=await load('stores/use-config-store.ts');
const {buildGenerationConfig}=await load('lib/canvas/canvas-generation-helpers.ts');
const {shouldConfirmHostedCanvasTool}=await load('lib/agent/hosted-agent-permissions.ts');
const {positionCanvasFloatingLayer}=await load('lib/canvas/canvas-floating-geometry.ts');
const {loadCanvasImage}=await load('components/canvas/canvas-preview-image.tsx');
const {fitLockedImageNode,imageFrameRatio,resultNodeSize}=await load('lib/canvas/canvas-node-size.ts');

test('locked image frames fit actual and selected batch image proportions',()=>{
 const node={id:'image',type:'image',width:400,height:400,position:{x:20,y:50},metadata:{content:'/old',naturalWidth:1600,naturalHeight:900}};
 const fitted=fitLockedImageNode(node);assert.equal(fitted.height,225);assert.equal(fitted.position.y+fitted.height/2,250);assert.equal(fitLockedImageNode(fitted),fitted);
 assert.equal(fitLockedImageNode({...node,metadata:{...node.metadata,primaryImageId:'b',images:[{id:'b',naturalWidth:600,naturalHeight:1200}]}}).height,800);
 const free={...node,metadata:{...node.metadata,freeResize:true}};assert.equal(fitLockedImageNode(free),free);
 assert.deepEqual(resultNodeSize(node,900,1600),{width:400,height:400*1600/900});assert.deepEqual(resultNodeSize(free,900,1600),{width:400,height:400});
 const missing={...node,metadata:{}};assert.equal(fitLockedImageNode(missing),missing);
 const decoded={...node,metadata:{...node.metadata,loadedImageAspect:{source:'/old',ratio:4/3}}};assert.equal(fitLockedImageNode(decoded).height,300);
 const stale={...decoded,metadata:{...decoded.metadata,content:'/new'}};assert.equal(fitLockedImageNode(stale).height,225);
 const noDimensions={...node,metadata:{content:'/old',loadedImageAspect:{source:'/old',ratio:2}}};assert.equal(fitLockedImageNode(noDimensions).height,200);
});

test('storyboard image cells keep the selected frame ratio after a mismatched provider response',()=>{
 const node={id:'storyboard-image',type:'image',width:300,height:169,position:{x:20,y:50},metadata:{storyboardSceneId:'shot-1',size:'16:9',content:'/generated',naturalWidth:1024,naturalHeight:1024,loadedImageAspect:{source:'/generated',ratio:1}}};
 assert.equal(imageFrameRatio(node),16/9);
 assert.equal(fitLockedImageNode(node),node);
});

test('image replacement waits for decode and rejects failed or canceled candidates',async()=>{
 const original=globalThis.Image;const instances=[];
 globalThis.Image=class {constructor(){instances.push(this)} decode(){return new Promise((resolve,reject)=>{this.decoded=resolve;this.decodeFailed=reject})}};
 try{
  const controller=new AbortController();let settled=false;
  const ready=loadCanvasImage('/ready',controller.signal).then(value=>{settled=true;return value});
  instances[0].onload();await Promise.resolve();assert.equal(settled,false);
  instances[0].decoded();assert.equal(await ready,true);
  const failed=loadCanvasImage('/missing',controller.signal);instances[1].onerror();assert.equal(await failed,false);
  const decodeFailure=loadCanvasImage('/invalid',controller.signal);instances[2].onload();instances[2].decodeFailed();assert.equal(await decodeFailure,false);
  const canceled=loadCanvasImage('/slow',controller.signal);instances[3].onload();controller.abort();assert.equal(await canceled,false);instances[3].decoded();assert.equal(instances[3].onload,null);
  assert.equal(await loadCanvasImage('/never-start',controller.signal),false);assert.equal(instances.length,4);
 }finally{globalThis.Image=original}
});

test('server recovery carries input version and completed output proofs',()=>{
 const run={id:'run',projectId:'p',ownerId:'other',status:'running',nodeIds:['a','b'],completedNodeIds:['a'],canceledNodeIds:[],inputSignature:'v1:1111111111111111',nodeMetrics:[{nodeId:'a',outputFingerprint:'v1:2222222222222222'}],startedAt:'start',updatedAt:'now',leaseExpiresAt:'expired'};
 const checkpoint=canvasCheckpointFromRun(run);
 assert.equal(checkpoint.inputSignature,run.inputSignature);assert.equal(checkpoint.outputFingerprints.a,run.nodeMetrics[0].outputFingerprint);assert.deepEqual(checkpoint.completedNodeIds,['a']);
 assert.equal(canvasRecoveryAttemptKey(run),canvasRecoveryAttemptKey({...run}));assert.notEqual(canvasRecoveryAttemptKey(run),canvasRecoveryAttemptKey({...run,leaseExpiresAt:'renewed'}));
});
test('a blocked recovery stays blocked after persistence instead of auto-resuming',()=>{
 const checkpoint=normalizeCanvasWorkflowCheckpoint({status:'failed',runId:'run',nodeIds:['a'],completedNodeIds:[],recoveryBlocked:true,errorMessage:'graph changed'});
 assert.equal(normalizeCanvasWorkflowCheckpoint(JSON.parse(JSON.stringify(checkpoint))).recoveryBlocked,true);
});
test('finished tasks do not prevent stopping a workflow, permission failures still do',()=>{
 assert.equal(isFinishedCanvasTaskError({code:'task_already_finished'}),true);assert.equal(isFinishedCanvasTaskError({code:'task_cancel_confirmation_required'}),false);assert.equal(isFinishedCanvasTaskError(Error('network')),false);
});
test('new generation defaults to the first allowed ratio despite an old global 1:1 preference',()=>{
 const model={name:'image',capability:'image',aspectRatios:['auto','16:9','1:1'],resolutions:['1K']};
 const config={...defaultConfig,size:'1:1',model:'test::image',imageModel:'test::image',channels:[{id:'test',name:'test',models:[model]}]};
 assert.equal(defaultConfig.size,'auto');assert.equal(defaultCanvasImageRatio(model,'1K'),'auto');
 assert.equal(buildGenerationConfig(config,{id:'new',type:'config',title:'new',position:{x:0,y:0},width:320,height:240,metadata:{}},'image').size,'auto');
 assert.equal(canvasImageSettingsFromModel(config,'test::image').size,'auto');
 assert.equal(coerceCanvasImageSettings({...model,aspectRatios:['16:9','1:1']},{size:''}).size,'16:9');
 assert.equal(coerceCanvasImageSettings(model,{size:'1:1'}).size,'1:1');
});
test('automatic writes allow both deletion tools and delete ops without repeated confirmation',()=>{
 for(const name of ['canvas_delete_nodes','canvas_apply_ops']){assert.equal(shouldConfirmHostedCanvasTool(name,false,true),false);assert.equal(shouldConfirmHostedCanvasTool(name,true,true),true)}
 assert.equal(shouldConfirmHostedCanvasTool('canvas_get_state',true,false),false);
 assert.equal(shouldConfirmHostedCanvasTool('canvas_clear',false,true),true);
});
test('menus stay anchored instead of flipping or sliding near the viewport edge',()=>{
 const result=positionCanvasFloatingLayer({anchor:{left:1200,right:1200,top:690,bottom:690},bounds:{left:0,top:0,right:1280,bottom:720},width:300,height:400,placement:'bottom-start',gap:0,avoidEdges:false});
 assert.equal(result.left,1200);assert.equal(result.top,690);assert.equal(result.side,'bottom');
});
