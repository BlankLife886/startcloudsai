import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    get length() {
      return map.size;
    },
  };
}

const local = createMemoryStorage();
const session = createMemoryStorage();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: local });
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: session });

const {
  createSkill,
  deleteSkill,
  expandSkillMentions,
  invalidateSkillLibrary,
  listLocalSkills,
  loadSkillLibrary,
  safeSkillImageUrl,
  updateSkill,
} = await import("../src/features/skills/skillLibrary.js");
const { SKILL_LOCAL_MAX } = await import("../src/features/skills/skillComposition.js");

before(() => {
  session.clear();
  local.clear();
  invalidateSkillLibrary();
});

afterEach(() => {
  session.clear();
  local.clear();
  invalidateSkillLibrary();
});

test("unsigned-in create/update/delete stay on the local path", async () => {
  const created = await createSkill({
    name: "柔光人像",
    description: "柔和顶光",
    instruction: "使用柔和顶光，背景纯净。",
  });
  assert.equal(created.storage, "local");
  assert.equal(created.name, "柔光人像");
  assert.ok(created.slug);

  const updated = await updateSkill(created, {
    name: "柔光人像加强",
    description: "更柔",
    instruction: "使用更柔和的顶光。",
    slug: created.slug,
  });
  assert.equal(updated.name, "柔光人像加强");
  assert.equal(updated.storage, "local");
  assert.equal(listLocalSkills().length, 1);

  await deleteSkill(updated);
  assert.deepEqual(listLocalSkills(), []);
});

test("local library enforces the 50-skill cap and rejects a duplicate slug", async () => {
  for (let index = 0; index < SKILL_LOCAL_MAX; index += 1) {
    await createSkill({
      name: `技能 ${index}`,
      slug: `skill-${index}`,
      instruction: `指令 ${index}`,
    });
  }
  await assert.rejects(
    () => createSkill({ name: "溢出", slug: "overflow-skill", instruction: "太多了" }),
    /本地最多保存/,
  );

  local.clear();
  invalidateSkillLibrary();
  await createSkill({ name: "Soft Light", slug: "soft-light", instruction: "柔光" });
  await assert.rejects(
    () => createSkill({ name: "Another Soft", slug: "soft-light", instruction: "另一份" }),
    /调用名在本地已经被占用/,
  );
});

test("expandSkillMentions expands a local @skill and never throws", async () => {
  await createSkill({
    name: "柔光人像",
    slug: "soft-portrait",
    instruction: "使用柔和顶光",
  });
  const expanded = await expandSkillMentions("@柔光人像 一只猫");
  assert.equal(expanded.prompt, "使用柔和顶光\n\n一只猫");
  assert.equal(expanded.skills.length, 1);
  assert.equal(expanded.skills[0].name, "柔光人像");

  const untouched = await expandSkillMentions("一只猫");
  assert.equal(untouched.prompt, "一只猫");
  assert.deepEqual(untouched.skills, []);

  const library = await loadSkillLibrary({ fresh: true });
  assert.equal(library.signedIn, false);
  assert.equal(library.items.length, 1);
  assert.equal(library.items[0].storage, "local");
});

test("official skill images only load from this site's skill-images files", () => {
  assert.equal(safeSkillImageUrl("/api/v1/files/skill-images/abc/cover-1.webp"), "/api/v1/files/skill-images/abc/cover-1.webp");
  for (const bad of [
    "https://evil.example/x.png",
    "/api/v1/files/tasks/u/t/0.png",
    "/api/v1/files/skill-images/../tasks/x.png",
    'javascript:alert(1)',
    "/api/v1/files/skill-images/a b.png",
  ]) {
    assert.equal(safeSkillImageUrl(bad), "", bad);
  }
});

test("a local skill keeps its usage guide through create and update", async () => {
  const created = await createSkill({ name: "柔光人像", instruction: "使用柔和顶光", usageGuide: "示例：\n@柔光人像 一只猫" });
  assert.equal(created.usageGuide, "示例：\n@柔光人像 一只猫");
  const updated = await updateSkill(created, { ...created, instruction: "使用柔和侧光" });
  assert.equal(updated.usageGuide, "示例：\n@柔光人像 一只猫");
  assert.equal(listLocalSkills()[0].usageGuide, "示例：\n@柔光人像 一只猫");
});

test("skill source links only accept https urls without credentials", async () => {
  const { skillSourceUrlError } = await import("../src/features/skills/skillComposition.js");
  assert.equal(skillSourceUrlError(""), "");
  assert.equal(skillSourceUrlError("https://github.com/helloianneo/ian-xiaohei-illustrations"), "");
  for (const bad of ["http://github.com/a/b", "javascript:alert(1)", "github.com/a/b", "https://u:p@github.com/a"]) {
    assert.ok(skillSourceUrlError(bad), bad);
  }
});

test("a local skill never carries a source link", async () => {
  const created = await createSkill({ name: "带来源", instruction: "x", sourceUrl: "https://github.com/a/b" });
  assert.equal(created.sourceUrl, "");
});
