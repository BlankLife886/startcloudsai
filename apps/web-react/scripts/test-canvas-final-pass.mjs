import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});after(()=>server.close());
const load=path=>server.ssrLoadModule('/src/canvas/lib/canvas/'+path+'.ts');
const storage=await load('canvas-project-storage'), navigation=await load('canvas-navigation'), history=await load('canvas-edit-history'), media=await load('canvas-media-queue'), preview=await load('canvas-preview-image'), review=await load('canvas-output-review');
const n=(id,metadata={},extra={})=>({id,type:'text',title:id,width:300,height:200,position:{x:0,y:0},metadata,...extra});
const graph=nodes=>({nodes,connections:[]});
const {commitCanvasArray}=await load('canvas-live-state');
test('scheduler sees new outputs before a deferred React render and preserves interleaved edits',()=>{
 const ref={current:[n('result',{content:'old'})]};const renders=[];let called=0;
 commitCanvasArray(ref,current=>{called++;return current.map(item=>({...item,metadata:{...item.metadata,content:'new'}}))},value=>renders.push(value));
 assert.equal(ref.current[0].metadata.content,'new');
 commitCanvasArray(ref,current=>current.map(item=>({...item,title:'user title'})),value=>renders.push(value));
 assert.equal(ref.current[0].metadata.content,'new');assert.equal(ref.current[0].title,'user title');assert.equal(called,1);assert.equal(renders.length,2);
});

test('saving one canvas does not serialize or rewrite other canvas documents',async()=>{
 const values=new Map(),writes=[];const adapter=storage.createCanvasProjectStorage({getItem:k=>values.get(k)||null,setItem:(k,v)=>{writes.push(k);values.set(k,v)},removeItem:k=>values.delete(k)});
 const a={id:'a',nodes:[n('a')]},b={id:'b',nodes:[n('b')]};const state=projects=>({state:{ownerUserId:'u',projects},version:0});
 await adapter.setItem('canvases',state([a,b]));writes.length=0;
 await adapter.setItem('canvases',state([{...a,title:'edited'},b]));
 assert.equal(writes.filter(k=>k.includes(':project:')).length,1);assert.ok(!writes.some(k=>k.endsWith(':b')));
 const restored=await storage.createCanvasProjectStorage({getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}).getItem('canvases');
 assert.equal(restored.state.projects[0].title,'edited');assert.equal(restored.state.projects[1].id,'b');
});
test('legacy cache migrates only after all project writes succeed',async()=>{
 const legacy={state:{ownerUserId:'u',projects:[{id:'a'},{id:'b'}]},version:0};const values=new Map([['cache',JSON.stringify(legacy)]]);let fail=true;
 const adapter=storage.createCanvasProjectStorage({getItem:k=>values.get(k)||null,setItem:(k,v)=>{if(k.endsWith(':b')&&fail)throw Error('quota');values.set(k,v)},removeItem:k=>values.delete(k)});
 assert.deepEqual(await adapter.getItem('cache'),legacy);await assert.rejects(adapter.setItem('cache',legacy),/quota/);assert.deepEqual(JSON.parse(values.get('cache')),legacy);
 fail=false;await adapter.setItem('cache',legacy);assert.equal(JSON.parse(values.get('cache')).canvasProjectIndex,1);
 await adapter.setItem('cache',{state:{ownerUserId:'u',projects:[legacy.state.projects[0]]}});assert.equal(values.has('cache:project:u:b'),false);
});
test('wheel pans on both axes while Ctrl/Meta and trackpad pinch zoom',()=>{
 const base={deltaX:30,deltaY:50,deltaMode:0,ctrlKey:false,metaKey:false,shiftKey:false};
 assert.deepEqual(navigation.canvasWheelIntent(base),{kind:'pan',dx:30,dy:50});assert.equal(navigation.canvasWheelIntent({...base,ctrlKey:true}).kind,'zoom');
 assert.deepEqual(navigation.canvasWheelIntent({...base,deltaX:0,shiftKey:true}),{kind:'pan',dx:50,dy:0});
});
test('fit content includes far branches and excludes hidden implementation nodes',()=>{
 const nodes=[n('a',{}, {position:{x:1000,y:2000}}),n('b',{}, {position:{x:3000,y:2500}}),n('hidden',{hidden:true},{position:{x:1e9,y:1e9}})];
 const view=navigation.fitCanvasContent(nodes,{width:1440,height:900},280,440);
 for(const node of nodes.slice(0,2)){assert.ok(node.position.x*view.k+view.x>=304);assert.ok((node.position.x+node.width)*view.k+view.x<=976)}
});
test('background results do not create undo steps and undoing a prompt preserves latest output',()=>{
 const before=graph([n('config',{prompt:'before'}, {type:'config'}),n('image',{content:'old',status:'success',workflowProducerNodeId:'config',generationCompletedAt:'old'},{type:'image'})]);
 const output=graph([before.nodes[0],n('image',{content:'new',status:'success',workflowProducerNodeId:'config',generationCompletedAt:'new'},{type:'image'})]);
 assert.equal(history.hasCanvasUserEdit(before,output),false);
 const edited=graph([{...output.nodes[0],metadata:{prompt:'after'}},output.nodes[1]]);assert.equal(history.hasCanvasUserEdit(output,edited),true);
 const undone=history.applyCanvasHistoryDelta(before,edited,edited);assert.equal(undone.nodes[0].metadata.prompt,'before');assert.equal(undone.nodes[1].metadata.content,'new');
});
test('undo preserves new generated children, redo and manual text edits stay undoable',()=>{
 const before=graph([n('config',{prompt:'before'},{type:'config'})]);const after=graph([{...before.nodes[0],metadata:{prompt:'after'}},n('output',{content:'generated',workflowProducerNodeId:'config'})]);
 const undone=history.applyCanvasHistoryDelta(before,after,after);assert.equal(undone.nodes.some(n=>n.id==='output'),true);assert.equal(undone.nodes[0].metadata.prompt,'before');
 const redone=history.applyCanvasHistoryDelta(after,undone,undone);assert.equal(redone.nodes[0].metadata.prompt,'after');
 const manual=graph([n('output',{content:'manual',workflowProducerNodeId:'config'})]);assert.equal(history.hasCanvasUserEdit(graph([after.nodes[1]]),manual),true);
});
test('local operation output counters, normalized metadata and resized results are background changes',()=>{
 const before=graph([n('crop',{localImageOperation:'crop',localImageOperationParams:{width:.8},generationStartedAt:'start',executionStatus:'running'},{type:'builtin:crop'}),n('out',{workflowProducerNodeId:'crop',hidden:true,status:'idle'},{type:'image'})]);
 const after=graph([{...before.nodes[0],metadata:{...before.nodes[0].metadata,count:1,status:'success',localImageOperationCompletedCount:1,generationCompletedAt:'end'}},{...before.nodes[1],width:500,metadata:{...before.nodes[1].metadata,content:'/result',status:'success',localImageOperation:'crop',localImageOperationParams:{width:.8},generationStartedAt:'start',generationCompletedAt:'end'}}]);
 assert.equal(history.hasCanvasUserEdit(before,after),false);
});
test('media work is deduplicated, visible work is prioritized, and offscreen jobs are canceled',async()=>{
 const queue=media.createCanvasMediaQueue(1);let release;const order=[];
 const active=queue.request('active',()=>new Promise(r=>{release=r}));await Promise.resolve();
 const abort=new AbortController();const stale=queue.request('stale',async()=>order.push('stale'),{signal:abort.signal});const rejection=assert.rejects(stale,{name:'AbortError'});abort.abort();
 const low=queue.request('low',async()=>{order.push('low');return 1});const high=queue.request('high',async()=>{order.push('high');return 2},{priority:10});const duplicate=queue.request('high',async()=>assert.fail('duplicate execution'));
 release(0);await Promise.all([active,low,high,duplicate,rejection]);assert.deepEqual(order,['high','low']);
});
test('one canceled media consumer does not cancel another consumer of the same image',async()=>{
 const queue=media.createCanvasMediaQueue(1);let release;let signal;const abort=new AbortController();
 const first=queue.request('same',s=>{signal=s;return new Promise(r=>release=r)},{signal:abort.signal});const second=queue.request('same',async()=>99);await Promise.resolve();
 const rejected=assert.rejects(first,{name:'AbortError'});abort.abort();assert.equal(signal.aborted,false);release('image');assert.equal(await second,'image');await rejected;
});
test('preview detail increases with zoom but small thumbnails retain their explicit cap',()=>{
 assert.ok(preview.previewEdgeForScale(3)>preview.previewEdgeForScale(.25));assert.ok(preview.previewEdgeForScale(3,256)<=256);assert.equal(preview.CANVAS_PREVIEW_MAX_EDGE,2048);
});
test('review reads all text chunks and batch images, and detects missing/stale outputs',()=>{
 const text='验收内容😀'.repeat(900);const nodes=[n('config',{workflowOutputNodeIds:['text','image'],count:3},{type:'config'}),n('text',{content:text,status:'success',workflowProducerNodeId:'config'}),n('image',{status:'success',workflowProducerNodeId:'config',images:Array.from({length:7},(_,i)=>({id:'im'+i,status:'success',content:'/image'+i}))},{type:'image'})];
 const snapshot={...graph(nodes),projectId:'p',title:'p',selectedNodeIds:[],viewport:{x:0,y:0,k:1}};let offset=0;const seen=[];
 for(;;){const page=review.reviewCanvasOutputs(snapshot,{nodeIds:['config'],offset});seen.push(...page.items);if(page.nextOffset===undefined)break;offset=page.nextOffset}
 assert.equal(seen.filter(i=>i.type==='text').map(i=>i.text).join(''),text);assert.equal(new Set(seen.filter(i=>i.type==='image').map(i=>i.resourceId)).size,7);
 assert.ok(review.reviewCanvasOutputs(snapshot,{nodeIds:['missing']}).issues.length);assert.ok(review.reviewCanvasOutputs(snapshot,{nodeIds:['config'],requestId:'not-this-run'}).issues.length);
});
