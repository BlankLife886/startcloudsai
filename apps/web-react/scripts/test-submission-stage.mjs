import assert from 'node:assert/strict';
import test from 'node:test';
import { showBatchRecovery, submissionStageState } from '../src/features/text-to-image/useSubmissionStage.js';
import { resolveStageGroupAspect } from '../src/features/text-to-image/stageGroupGeometry.js';

const old = { id:'old', batchId:'previous', serverJobId:'old', status:'completed' };
const pending = Array.from({length:4},(_,index)=>({id:`new-${index}`,batchId:'new',status:'submitting',serverJobId:''}));

test('a short submission keeps the existing scene and does not focus an unfinished placeholder',()=>{
  const stage=submissionStageState([old,...pending],'new','');
  assert.equal(stage.focusBatchId,'');
  assert.equal(stage.waiting,true);
  assert.deepEqual(stage.tasks,[old]);
});

test('one accepted image exposes the full four-image batch together',()=>{
  const tasks=[old,{...pending[0],status:'running',serverJobId:'accepted'},...pending.slice(1)];
  const stage=submissionStageState(tasks,'new','');
  assert.equal(stage.focusBatchId,'new');
  assert.equal(stage.waiting,false);
  assert.equal(stage.tasks.filter(task=>task.batchId==='new').length,4);
});

test('a slow submission and a capacity rejection remain visible with their real status',()=>{
  assert.equal(submissionStageState(pending,'new','new').tasks.length,4);
  const stage=submissionStageState([{...pending[0],status:'queue_full'}],'new','');
  assert.equal(stage.focusBatchId,'new');
  assert.equal(stage.tasks[0].status,'queue_full');
});

test('the recovery message is hidden during normal submission but retained for actual failures',()=>{
  const batch={entries:[{payload:{}},{payload:{}}]};
  assert.equal(showBatchRecovery(batch,true),false);
  batch.entries[0].task={id:'accepted'};
  assert.equal(showBatchRecovery(batch,true),false);
  assert.equal(showBatchRecovery(batch,false),true);
  batch.entries[1].error={code:'user_task_limit'};
  assert.equal(showBatchRecovery(batch,true),true);
  batch.entries[1].task={id:'also-accepted'};
  assert.equal(showBatchRecovery(batch,false),false);
});

test('one completed image cannot rearrange its three queued siblings',()=>{
  const initial=resolveStageGroupAspect({key:'mixed',count:4,active:true,requested:'16 / 9',measured:'16 / 9'},null);
  const firstFinished=resolveStageGroupAspect({key:'mixed',count:4,active:true,requested:'16 / 9',measured:'9 / 16'},initial);
  assert.equal(firstFinished.aspect,'16 / 9');
  const allFinished=resolveStageGroupAspect({key:'mixed',count:4,active:false,requested:'16 / 9',measured:'9 / 16'},firstFinished);
  assert.equal(allFinished.aspect,'16 / 9');
  const elsewhere=resolveStageGroupAspect({key:'other',count:1,active:false,requested:'16 / 9',measured:'1 / 1'},allFinished);
  const revisit=resolveStageGroupAspect({key:'mixed',count:4,active:false,requested:'16 / 9',measured:'9 / 16'},elsewhere);
  assert.equal(revisit.aspect,'9 / 16');
});
