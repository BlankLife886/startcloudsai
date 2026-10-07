import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import * as admin from '../src/utils/skillMarkdown.ts'
import * as web from '../../web-react/src/features/skills/skillComposition.js'

const officialSkill = name =>
  readFileSync(new URL(`../../server/internal/prompt/skills/${name}/SKILL.md`, import.meta.url), 'utf8')

// 两端共用的样例：后台导出的文件必须能被用户端原样读回，反之亦然。
const samples = [
  {
    label: 'full frontmatter with chinese display name',
    text: '---\nname: soft-light\ndescription: "柔和顶光人像"\nmetadata:\n  display-name: "柔光人像"\n  tags: ["人像", "柔光"]\n  category: "人像"\n---\n\n使用柔和顶光，背景纯净。\n',
  },
  {
    label: 'block list tags and folded description',
    text: '---\nname: Clean Render\ndescription: >\n  first line\n  second line\nmetadata:\n  tags:\n    - a\n    - b\n---\n# 标题\n正文\n',
  },
  { label: 'no frontmatter falls back to heading', text: '# 只有标题\n\n直接写的指令' },
  {
    label: 'usage block under metadata',
    text: '---\nname: usage-demo\ndescription: x\nmetadata:\n  usage: |\n    第一行\n\n    示例：@用法 写点什么\n---\nbody',
  },
  {
    label: 'usage keeps nested indentation',
    text: '---\nname: indent-demo\nmetadata:\n  usage: |\n    步骤：\n      - 第一步\n        - 子步骤\n---\nbody',
  },
  { label: 'chinese name cannot derive slug', text: '---\nname: 人像导演\ndescription: x\n---\nbody' },
  { label: 'over-long instruction is truncated', text: `---\nname: long\n---\n${'字'.repeat(4100)}` },
  { label: 'unsafe characters are stripped', text: '---\nname: safe\ndescription: "a‮b"\n---\nhi​there' },
  { label: 'official portrait director', text: officialSkill('female-portrait-director') },
  { label: 'official material illustration', text: officialSkill('material-illustration') },
]

for (const sample of samples) {
  test(`parse matches web: ${sample.label}`, () => {
    assert.deepEqual(admin.parseSkillMarkdown(sample.text), web.parseSkillMarkdown(sample.text))
  })

  test(`serialize matches web and round-trips: ${sample.label}`, () => {
    const { skill } = admin.parseSkillMarkdown(sample.text)
    const exported = admin.serializeSkillMarkdown(skill)
    assert.equal(exported, web.serializeSkillMarkdown(skill))
    assert.deepEqual(admin.parseSkillMarkdown(exported).skill, skill)
  })
}

test('official skills fit the stored limits without warnings', () => {
  for (const name of ['female-portrait-director', 'material-illustration']) {
    const { skill, warnings } = admin.parseSkillMarkdown(officialSkill(name))
    assert.deepEqual(warnings, [], name)
    assert.equal(skill.slug, name)
    assert.ok(skill.name && skill.description && skill.instruction, name)
    assert.ok(skill.usageGuide.includes(`@${skill.name}`), `${name} usage guide should show how to @ it`)
    assert.ok(Array.from(skill.instruction).length <= admin.SKILL_INSTRUCTION_MAX_LENGTH, name)
  }
})

test('zip export writes one <slug>/SKILL.md per skill and de-duplicates folders', () => {
  const skills = [
    { slug: 'a-skill', name: 'A', description: '', instruction: 'one', tags: [], category: null },
    { slug: '', name: '中文名', description: '', instruction: 'two', tags: [], category: null },
    { slug: 'a-skill', name: 'A2', description: '', instruction: 'three', tags: [], category: null },
  ]
  const files = unzipSync(admin.buildSkillZip(skills))
  assert.deepEqual(Object.keys(files).sort(), ['a-skill-2/SKILL.md', 'a-skill/SKILL.md', 'skill/SKILL.md'])
  assert.equal(admin.parseSkillMarkdown(strFromU8(files['a-skill-2/SKILL.md'])).skill.instruction, 'three')
})

test('usage indentation survives export and re-import', () => {
  const skill = { slug: 'edge', name: '边界', description: 'x', instruction: 'body', tags: [], category: null,
    usageGuide: '步骤：\n  - 第一步\n    - 子步骤\n\n示例：@边界 画图' }
  const back = admin.parseSkillMarkdown(admin.serializeSkillMarkdown(skill)).skill
  assert.equal(back.usageGuide, skill.usageGuide)
  assert.equal(web.parseSkillMarkdown(admin.serializeSkillMarkdown(skill)).skill.usageGuide, skill.usageGuide)
})

test('zip import reads back exactly what zip export wrote and ignores other files', () => {
  const skills = [
    { slug: 'a-skill', name: 'A 技能', description: 'a', instruction: 'one', usageGuide: '示例：\n@a-skill 画图', tags: ['x'], category: '插画' },
    { slug: 'b-skill', name: 'b-skill', description: '', instruction: 'two', usageGuide: '', tags: [], category: null },
  ]
  const exported = unzipSync(admin.buildSkillZip(skills))
  exported['notes/readme.txt'] = strToU8('ignore me')
  exported['evil/../SKILL.md.exe'] = strToU8('nope')
  const { skills: back, skipped } = admin.readSkillZip(zipSync(exported))
  assert.deepEqual(skipped, [])
  assert.deepEqual(back.map((item) => item.path), ['a-skill/SKILL.md', 'b-skill/SKILL.md'])
  for (const [index, item] of back.entries()) {
    for (const field of ['slug', 'name', 'description', 'instruction', 'usageGuide', 'tags', 'category']) {
      assert.deepEqual(item.skill[field] ?? null, skills[index][field] ?? null, `${item.path} ${field}`)
    }
  }
})

test('zip import skips oversized entries and rejects non-zip data', () => {
  const big = zipSync({ 'big/SKILL.md': strToU8('x'.repeat(admin.SKILL_FILE_MAX_BYTES + 1)), 'ok/SKILL.md': strToU8('---\nname: ok\n---\nbody') })
  const { skills, skipped } = admin.readSkillZip(big)
  assert.equal(skills.length, 1)
  assert.equal(skipped.length, 1)
  assert.throws(() => admin.readSkillZip(strToU8('not a zip')), /zip/)
})

test('zip export carries references and their purposes back on import', () => {
  const skill = {
    slug: 'with-refs', name: '带资料', description: 'd', instruction: 'body', usageGuide: '', tags: [], category: null,
    references: [
      { path: 'references/style.md', purpose: '写提示词前读', content: '# Style\n\nbody one' },
      { path: 'assets/template.md', purpose: '', content: 'template body' },
    ],
  }
  const { skills, skipped } = admin.readSkillZip(admin.buildSkillZip([skill]))
  assert.deepEqual(skipped, [])
  assert.equal(skills.length, 1)
  assert.deepEqual(skills[0].references.map(({ path, title, purpose, content }) => ({ path, title, purpose, content })), [
    { path: 'assets/template.md', title: 'template.md', purpose: '', content: 'template body' },
    { path: 'references/style.md', title: 'Style', purpose: '写提示词前读', content: '# Style\n\nbody one' },
  ])
  // 资料用途写在 SKILL.md 的 metadata 里，不影响技能本身的字段，用户端解析结果也不变
  const markdown = admin.serializeSkillMarkdown(skill, skill.references)
  assert.deepEqual(admin.parseSkillMarkdown(markdown), web.parseSkillMarkdown(markdown))
})

test('the material illustration folder in the repo imports with all 7 references', () => {
  const root = new URL('../../server/internal/prompt/skills/material-illustration/', import.meta.url)
  const files = { 'material-illustration/SKILL.md': strToU8(readFileSync(new URL('SKILL.md', root), 'utf8')) }
  for (const dir of ['references', 'assets']) {
    for (const name of readdirSync(new URL(`${dir}/`, root))) {
      files[`material-illustration/${dir}/${name}`] = strToU8(readFileSync(new URL(`${dir}/${name}`, root), 'utf8'))
    }
  }
  const { skills, skipped } = admin.readSkillZip(zipSync(files))
  assert.deepEqual(skipped, [])
  assert.equal(skills[0].skill.slug, 'material-illustration')
  assert.equal(skills[0].references.length, 7)
  for (const ref of skills[0].references) assert.ok(ref.purpose, `${ref.path} needs a purpose note`)
})

// 第三方改编的官方技能：每个目录都要能整包导入，正文不超限，资料都写了用途，并带上游来源地址。
const THIRD_PARTY_SKILLS = [
  'handdrawn-ppt',
  'academic-figure',
  'content-illustration',
  'ecom-details',
  'xhs-visual-director',
  'xiaohei-illustrations',
  'hand-drawn-styles',
  'wedding-photo',
]

function zipSkillFolder(name) {
  const root = new URL(`../../server/internal/prompt/skills/${name}/`, import.meta.url)
  const files = { [`${name}/SKILL.md`]: strToU8(readFileSync(new URL('SKILL.md', root), 'utf8')) }
  let total = 0
  for (const dir of ['references', 'assets']) {
    let entries = []
    try {
      entries = readdirSync(new URL(`${dir}/`, root))
    } catch {
      continue
    }
    for (const file of entries) {
      const bytes = strToU8(readFileSync(new URL(`${dir}/${file}`, root), 'utf8'))
      assert.ok(bytes.length <= admin.SKILL_REFERENCE_MAX_BYTES, `${name}/${dir}/${file} exceeds 64 KB`)
      total += bytes.length
      files[`${name}/${dir}/${file}`] = bytes
    }
  }
  assert.ok(total <= 512 * 1024, `${name} references exceed 512 KB`)
  return files
}

for (const name of THIRD_PARTY_SKILLS) {
  test(`third-party skill ${name} imports cleanly with source url and reference notes`, () => {
    const { skill, warnings } = admin.parseSkillMarkdown(officialSkill(name))
    assert.deepEqual(warnings, [], name)
    assert.equal(skill.slug, name)
    assert.ok(skill.name && !/\s/.test(skill.name), `${name} display name must be @-able (no spaces)`)
    assert.ok(skill.description && skill.instruction, name)
    assert.ok(skill.usageGuide.includes(`@${skill.name}`), `${name} usage guide should show how to @ it`)
    assert.ok(Array.from(skill.instruction).length <= admin.SKILL_INSTRUCTION_MAX_LENGTH, `${name} body too long`)
    assert.match(skill.sourceUrl, /^https:\/\/github\.com\//, name)
    const { skills, skipped } = admin.readSkillZip(zipSync(zipSkillFolder(name)))
    assert.deepEqual(skipped, [], name)
    assert.ok(skills[0].references.length <= admin.SKILL_REFERENCE_MAX_FILES, name)
    for (const ref of skills[0].references) assert.ok(ref.purpose, `${name}: ${ref.path} needs a purpose note`)
    const noted = new Set(skills[0].references.map(ref => ref.path))
    for (const line of skill.instruction.matchAll(/(?:references|assets)\/[A-Za-z0-9._-]+\.md/g)) {
      assert.ok(noted.has(line[0]), `${name} body mentions ${line[0]} which is not imported`)
    }
  })
}

test('source-url round-trips through SKILL.md and rejects non-https links', () => {
  const skill = { slug: 'handdrawn-ppt', name: '手绘 PPT', description: 'x', instruction: 'body', tags: [], category: null,
    sourceUrl: 'https://github.com/helloianneo/ian-handdrawn-ppt' }
  const text = admin.serializeSkillMarkdown(skill)
  assert.match(text, /source-url: "https:\/\/github\.com\/helloianneo\/ian-handdrawn-ppt"/)
  assert.equal(admin.parseSkillMarkdown(text).skill.sourceUrl, skill.sourceUrl)

  const bad = admin.parseSkillMarkdown('---\nname: x\nmetadata:\n  source-url: "javascript:alert(1)"\n---\nbody')
  assert.equal(bad.skill.sourceUrl, '')
  assert.ok(bad.warnings.some(w => w.includes('source-url')))
  assert.equal(admin.skillSourceUrlError(''), '')
  assert.ok(admin.skillSourceUrlError('http://github.com/a/b'))
  assert.ok(admin.skillSourceUrlError('https://u:p@github.com/a'))
})
