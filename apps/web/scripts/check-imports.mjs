// 构建前静态检查：扫描 src 下所有 js/ts/vue 文件的 import/动态 import，
// 报告解析不到的本地模块（@/ 别名与相对路径）。
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'

const SRC = resolve(process.cwd(), 'src')
const exts = ['', '.js', '.ts', '.mjs', '.vue', '.json', '/index.js', '/index.ts']

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (/\.(js|ts|mjs|vue)$/.test(name)) out.push(full)
  }
  return out
}

function resolveImport(fromFile, rawSpec) {
  const spec = rawSpec.split('?')[0]
  let base
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else return true // bare module (npm package)
  return exts.some((ext) => existsSync(base + ext))
}

const importRe = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g

let missing = 0
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(importRe)) {
    const spec = match[1] || match[2] || match[3]
    if (!spec || (!spec.startsWith('@/') && !spec.startsWith('.'))) continue
    if (!resolveImport(file, spec)) {
      console.log(`${file.replace(process.cwd() + '/', '')} -> ${spec}`)
      missing += 1
    }
  }
}
console.log(missing ? `\n${missing} missing imports` : 'OK: no missing imports')
process.exit(missing ? 1 : 0)
