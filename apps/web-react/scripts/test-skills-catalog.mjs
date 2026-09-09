import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OFFICIAL_SKILLS,compileSkillPrompt } from '../src/features/skills/catalog.js';
test('official skills have unique identities and versioned prompts',()=>{
  assert.equal(new Set(OFFICIAL_SKILLS.map(skill=>skill.id)).size,OFFICIAL_SKILLS.length);
  for(const skill of OFFICIAL_SKILLS){const values=Object.fromEntries(skill.fields.map(field=>[field.key,field.options?.[0]||'测试内容']));const prompt=compileSkillPrompt(skill,values);assert.ok(prompt.includes(skill.version));assert.ok(prompt.includes(skill.instruction));assert.equal(skill.mode,'chat');}
});
test('missing inputs, oversize content and invalid enums are rejected',()=>{
  const skill=OFFICIAL_SKILLS[0];assert.throws(()=>compileSkillPrompt(skill,{}));assert.throws(()=>compileSkillPrompt(skill,{product:'x'.repeat(2001),audience:'people',style:'简洁棚拍'}));assert.throws(()=>compileSkillPrompt(skill,{product:'产品',audience:'人群',style:'未知'}));
});
