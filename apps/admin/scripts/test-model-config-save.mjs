import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import ts from 'typescript';

// Execute the production handlers with an isolated API; never contact a real backend.
const vue=readFileSync(new URL('../src/views/ModelConfigView.vue',import.meta.url),'utf8');
const script=vue.split('<script setup lang="ts">')[1].split('</script>')[0];
const ast=ts.createSourceFile('model-config.ts',script,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const names=new Set(['load','save','signature','warnBeforeUnload']);
const selected=ast.statements.filter(s=>ts.isFunctionDeclaration(s)&&names.has(s.name?.text)||ts.isExpressionStatement(s)&&ts.isCallExpression(s.expression)&&['onBeforeRouteLeave','onBeforeUnmount'].includes(s.expression.expression.getText(ast)));
const executable=ts.transpileModule(selected.map(s=>s.getText(ast)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(){
 const writes=[],hooks={};const c={configLoaded:{value:false},loadFailed:{value:false},loading:{value:false},saving:{value:false},savedSignature:{value:''},config:{models:[],providers:[]},ElMessage:{success(){},warning(){},error(){}},ElMessageBox:{async confirm(){}},window:{removeEventListener(){}},sanitizeWorkspaceBindings(){},sanitizeEditableFileConfig(){},retainSubmittedReasoning:v=>v,handleToolbarShortcut(){},loadAPIReferences(){},ApiError:class ApiError extends Error{constructor(code,message,status){super(message);this.code=code;this.status=status}},onBeforeRouteLeave:fn=>hooks.leave=fn,onBeforeUnmount:fn=>hooks.unmount=fn};
 c.isDirty={get value(){return c.configLoaded.value&&JSON.stringify(c.config)!==c.savedSignature.value}};
 c.hydrate=v=>{c.config=JSON.parse(JSON.stringify(v));c.savedSignature.value=JSON.stringify(c.config)};
 c.request=async(path,options)=>{if(!options)return {models:[{id:'m'}],providers:[{id:'p'}]};writes.push(options);return options.body};
 vm.createContext(c);vm.runInContext(executable,c);return {c,writes,hooks};
}
test('failed initial read cannot save on click, route leave, or unmount',async()=>{
 const {c,writes,hooks}=fixture();c.request=async()=>{throw Error('network')};await c.load();assert.equal(c.configLoaded.value,false);assert.equal(c.loadFailed.value,true);await c.save();assert.equal(await hooks.leave(),true);hooks.unmount();assert.equal(writes.length,0);
});
test('malformed successful read also keeps saving disabled',async()=>{
 const {c}=fixture();c.request=async()=>({});await c.load();assert.equal(c.configLoaded.value,false);assert.equal(c.loadFailed.value,true);
});
test('editing and leaving never writes; only explicit save writes once',async()=>{
 const {c,writes,hooks}=fixture();await c.load();c.config.models[0].name='draft';await Promise.resolve();assert.equal(writes.length,0);assert.equal(await hooks.leave(),true);hooks.unmount();assert.equal(writes.length,0);await c.save();assert.equal(writes.length,1);assert.equal(writes[0].method,'PUT');assert.equal(c.isDirty.value,false);await c.save();assert.equal(writes.length,1);
});
test('edits made during a save remain dirty and are not automatically submitted',async()=>{
 const {c,writes}=fixture();await c.load();c.config.models[0].name='first';let resolve;c.request=async(path,options)=>{writes.push(options);return new Promise(r=>resolve=r)};const saving=c.save();c.config.models[0].name='second';await c.save();assert.equal(writes.length,1);resolve(writes[0].body);await saving;assert.equal(c.config.models[0].name,'second');assert.equal(c.isDirty.value,true);assert.equal(writes.length,1);
});
test('failed save preserves the draft; canceled reload preserves pending edits',async()=>{
 const {c}=fixture();await c.load();c.config.models[0].name='keep';c.request=async()=>{throw Error('save failed')};await c.save();assert.equal(c.isDirty.value,true);assert.equal(c.saving.value,false);c.ElMessageBox.confirm=async()=>{throw Error('cancel')};await c.load();assert.equal(c.configLoaded.value,true);assert.equal(c.config.models[0].name,'keep');
});
test('dirty navigation can be canceled and tab closure only warns',async()=>{
 const {c,writes,hooks}=fixture();await c.load();c.config.models[0].name='draft';c.ElMessageBox.confirm=async()=>{throw Error('cancel')};assert.equal(await hooks.leave(),false);let warned=false;c.warnBeforeUnload({preventDefault(){warned=true}});assert.equal(warned,true);assert.equal(writes.length,0);
});
test('no hidden save calls or autosave timers remain in the production script',()=>{
 // The only programmatic call is the explicit Cmd/Ctrl+S shortcut.
 const calls=[];function visit(n,owner){if(ts.isFunctionDeclaration(n))owner=n.name?.text;if(ts.isCallExpression(n)&&n.expression.getText(ast)==='save')calls.push(owner);ts.forEachChild(n,child=>visit(child,owner))}visit(ast);assert.deepEqual(calls,['handleToolbarShortcut']);assert.doesNotMatch(script,/autoSave|scheduleSave|saveQueued/);assert.match(vue,/@click="save"/);
});
test('a save that would stop API models asks once, then resends with confirmation',async()=>{
 const {c,writes}=fixture();await c.load();c.config.models[0].name='disable';
 let calls=0;c.request=async(path,options)=>{writes.push(options);if(calls++===0)throw new c.ApiError('api_model_impact','会让 API 模型不可用',409);return options.body};
 let asked=0;c.ElMessageBox.confirm=async()=>{asked++};
 await c.save();assert.equal(asked,1);assert.equal(writes.length,2);assert.equal(writes[0].query,undefined);assert.equal(JSON.stringify(writes[1].query),'{"confirmApiImpact":1}');assert.equal(c.isDirty.value,false);
 c.config.models[0].name='again';calls=0;c.ElMessageBox.confirm=async()=>{throw Error('cancel')};
 await c.save();assert.equal(writes.length,3);assert.equal(c.isDirty.value,true);assert.equal(c.saving.value,false);
});
