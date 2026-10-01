import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, openSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = 8144
if (process.argv.slice(2).some(arg => ![String(port), '--restart'].includes(arg))) throw new Error('Use the single payment sandbox on port 8144')
const restart = process.argv.includes('--restart')
const webPort = port + 1
const adminPort = port + 2
const output = resolve(root, '.artifacts/payment-sandbox-8144')
const manifestPath = resolve(output, 'processes.json')
const statePath = resolve(output, 'session-state.json')
const base = `http://127.0.0.1:${port}`
let running = false
try {
  const response = await fetch(`${base}/__sandbox/state`, { signal: AbortSignal.timeout(10000) })
  const state = await response.json()
  if (String(state.db).startsWith('sc_payment_lab_')) {
    running = true
    if (!restart) { console.log(`Payment sandbox is running: ${base}/__sandbox/`); process.exit(0) }
  }
} catch {}

async function available(port) {
  await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => server.close(resolve))
  })
}
if (!running) for (const selectedPort of [port, webPort, adminPort]) await available(selectedPort)
mkdirSync(output, { recursive: true })
const binary = resolve(output, 'payment-sandbox')
const scenarioBinary = resolve(output, 'billing-scenarios.test')
const scenarioBuild = spawnSync('go', ['test', '-race', '-p', '1', '-c', '-o', scenarioBinary, './internal/worker'], { cwd: resolve(root, 'apps/server'), stdio: 'inherit' })
if (scenarioBuild.status !== 0) process.exit(scenarioBuild.status || 1)
const build = spawnSync('go', ['build', '-o', binary, './cmd/payment-sandbox'], { cwd: resolve(root, 'apps/server'), stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status || 1)

if (running) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.base !== base || manifest.processes.length !== 3) throw new Error('Unexpected sandbox process manifest')
  for (const child of manifest.processes) {
    const current = spawnSync('ps', ['-p', String(child.pid), '-o', 'command='], { encoding: 'utf8' })
    const expected = [child.command, ...child.args].join(' ')
    if (current.status !== 0 || current.stdout.trim() !== expected) throw new Error(`Sandbox process ${child.pid} changed; refusing to stop it`)
  }
  const state = await (await fetch(`${base}/__sandbox/state`)).json()
  if (!/^sc_payment_lab_[a-f0-9]{12}$/.test(state.db)) throw new Error('Unexpected sandbox database')
  writeFileSync(resolve(output, `before-restart-${Date.now()}.json`), JSON.stringify(state, null, 2), { mode: 0o600, flag: 'wx' })
  writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 })
  for (const child of manifest.processes) process.kill(child.pid, 'SIGTERM')
  for (let attempt = 0; attempt < 50; attempt++) {
    try { for (const selectedPort of [port, webPort, adminPort]) await available(selectedPort); break }
    catch (error) { if (attempt === 49) throw error; await new Promise(resolve => setTimeout(resolve, 200)) }
  }
  console.log(`Restarting the same sandbox and database: ${state.db}`)
}

const children = []
function launch(command, args, cwd, logName, env) {
  const log = openSync(resolve(output, logName), 'a', 0o600)
  const child = spawn(command, args, { cwd, detached: true, stdio: ['ignore', log, log], env })
  child.unref()
  children.push({ pid: child.pid, command, args, log: resolve(output, logName) })
  return child
}
try {
  launch(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], resolve(root, 'apps/web-react'), 'web.log', { ...process.env, VITE_API_PROXY_TARGET: base })
  launch(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(adminPort), '--strictPort'], resolve(root, 'apps/admin'), 'admin.log', { ...process.env, VITE_API_PROXY_TARGET: base })
  launch(binary, ['-port', String(port), '-web', `http://127.0.0.1:${webPort}`, '-admin', `http://127.0.0.1:${adminPort}`, '-state-file', statePath, '-scenario-bin', scenarioBinary, ...(existsSync(statePath) ? ['-resume', statePath] : [])], root, 'sandbox.log', {})
  writeFileSync(manifestPath, JSON.stringify({ base, startedAt: new Date().toISOString(), processes: children }, null, 2), { mode: 0o600 })
  let ready = false
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`${base}/__sandbox/state`, { signal: AbortSignal.timeout(5000) })
      const state = await response.json()
      if (response.ok && String(state.db).startsWith('sc_payment_lab_')) {
        writeFileSync(resolve(output, 'session.json'), JSON.stringify({ base, database: state.db, adminEmail: state.adminEmail, adminPassword: state.adminPassword }, null, 2), { mode: 0o600 })
        ready = true
        break
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  if (!ready) throw new Error(`Sandbox did not become ready. ${readFileSync(resolve(output, 'sandbox.log'), 'utf8').slice(-3500)}`)
  console.log(`Ready: ${base}/__sandbox/`)
  console.log(`Logs and process IDs: ${output}`)
} catch (error) {
  for (const child of children) {
    if (child.pid) try { process.kill(child.pid, 'SIGTERM') } catch {}
  }
  throw error
}
