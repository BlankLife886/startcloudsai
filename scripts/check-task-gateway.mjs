#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const image = 'nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10'
const name = 'sc-gateway-check-' + randomUUID().slice(0, 8)
const temporary = await mkdtemp(join(tmpdir(), 'sc-gateway-'))
const output = join(root, '.artifacts', 'gateway-check', new Date().toISOString().replace(/[:.]/g, '-'))
await mkdir(output, { recursive: true })
const results = []
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] })
let started = false
let networkCreated = false
let privateCalls = 0

// Only synthetic endpoints exist here: no credentials, app database, task
// worker, production Redis or real image provider is connected to this check.
const upstream = createServer((request, response) => {
  if (request.url.startsWith('/internal/')) privateCalls++
  if (request.url.endsWith('/delayed')) {
    const timer = setTimeout(() => response.end('late synthetic response'), 1800)
    response.on('close', () => clearTimeout(timer))
    return
  }
  if (request.url.endsWith('/upstream-504')) {
    response.writeHead(504, { 'content-type': 'text/html' })
    response.end('<html>upstream-gateway-fixture</html>')
    return
  }
  if (request.url.endsWith('/events')) {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'x-accel-buffering': 'no' })
    response.flushHeaders()
    response.write('data: {"stage":"generating"}\n\n')
    const timer = setTimeout(() => response.end('data: {"done":true}\n\n'), 1400)
    const heartbeat = setInterval(() => response.write(': ping\n\n'), 150)
    response.on('close', () => { clearTimeout(timer); clearInterval(heartbeat) })
    return
  }
  response.writeHead(201, { 'content-type': 'application/json', 'x-request-id': 'synthetic-request' })
  response.end(JSON.stringify({ success: true, data: { id: 'synthetic-task', status: 'queued' } }))
})

async function check(title, fn) {
  const start = Date.now()
  try {
    await fn()
    results.push({ title, passed: true, durationMs: Date.now() - start })
    console.log('PASS ' + title)
  } catch (error) {
    results.push({ title, passed: false, error: String(error), durationMs: Date.now() - start })
    console.error('FAIL ' + title + ': ' + error)
  }
}

let originalConfig
try {
  const endpoint = process.env.DOCKER_HOST || docker('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}').trim()
  assert(endpoint.startsWith('unix://'), 'isolated gateway check requires a local Docker Unix socket')
  docker('image', 'inspect', image)
  docker('network', 'create', '--driver', 'bridge', name)
  networkCreated = true
  const hostEntries = docker('run', '--rm', '--pull', 'never', '--network', name,
    '--add-host', 'host.docker.internal:host-gateway', '--entrypoint', 'cat', image, '/etc/hosts')
  const hostIP = hostEntries.match(/^(\d+\.\d+\.\d+\.\d+)\s+host\.docker\.internal\s*$/m)?.[1]
  assert(hostIP, 'local Docker IPv4 host address was not resolved')
  await new Promise(resolveListening => upstream.listen(0, '0.0.0.0', resolveListening))
  const port = upstream.address().port
  originalConfig = await readFile(join(root, 'deploy/nginx.conf'), 'utf8')
  assert(originalConfig.includes('set $server_upstream http://server:8000;'))
  assert(originalConfig.includes('proxy_read_timeout 300s;'))
  // Accelerate only the temporary copy's idle timeout. Production remains 300s.
  const config = originalConfig
    .replace('set $server_upstream http://server:8000;', 'set $server_upstream http://' + hostIP + ':' + port + ';')
    .replaceAll('proxy_read_timeout 300s;', 'proxy_read_timeout 1s;')
  const configPath = join(temporary, 'nginx.conf')
  await writeFile(configPath, config)
  docker('run', '-d', '--rm', '--pull', 'never', '--name', name,
    '--network', name, '--publish', '127.0.0.1::80',
    '--add-host', 'host.docker.internal:host-gateway',
    '--mount', 'type=bind,source=' + configPath + ',target=/etc/nginx/conf.d/default.conf,readonly', image)
  started = true
  const binding = JSON.parse(docker('inspect', '--format', '{{json (index .NetworkSettings.Ports "80/tcp")}}', name))[0]
  const base = 'http://127.0.0.1:' + binding.HostPort
  const fetchLocal = path => fetch(base + path, { signal: AbortSignal.timeout(7000) })
  let ready = false
  const readyDeadline = Date.now() + 15000
  while (Date.now() < readyDeadline) {
    try { const response = await fetchLocal('/api/preflight/ready'); await response.text(); if (response.status === 201) { ready = true; break } } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  assert(ready, 'isolated gateway did not connect to the synthetic upstream')

  await check('ordinary task response stays JSON with request ID', async () => {
    const response = await fetchLocal('/api/v1/tasks')
    assert.equal(response.status, 201)
    assert.equal(response.headers.get('x-request-id'), 'synthetic-request')
    assert.equal((await response.json()).data.status, 'queued')
  })
  for (const path of ['/api/v1/assistant/runs/demo/events', '/api/v1/tasks/demo/events']) {
    await check('SSE arrives before completion and heartbeats extend idle timeout: ' + path, async () => {
      const start = Date.now()
      const response = await fetchLocal(path)
      assert.equal(response.status, 200)
      const reader = response.body.getReader()
      const first = await reader.read()
      assert.equal(first.done, false)
      assert(Date.now() - start < 1000, 'first event was buffered')
      let body = new TextDecoder().decode(first.value)
      while (true) {
        const next = await reader.read()
        if (next.done) break
        body += new TextDecoder().decode(next.value)
      }
      assert(body.includes(': ping'))
      assert(body.includes('"done":true'))
      assert(Date.now() - start >= 1200, 'stream did not span the shortened idle timeout')
    })
  }
  await check('gateway header timeout produces its own 504 HTML', async () => {
    const response = await fetchLocal('/api/preflight/delayed')
    assert.equal(response.status, 504)
    assert(response.headers.get('content-type').includes('text/html'))
    const body = await response.text()
    assert(body.includes('504 Gateway Time-out'))
    assert(!body.includes('upstream-gateway-fixture'))
  })
  await check('upstream 504 HTML is forwarded unchanged', async () => {
    const response = await fetchLocal('/api/preflight/upstream-504')
    assert.equal(response.status, 504)
    assert((await response.text()).includes('upstream-gateway-fixture'))
  })
  await check('internal callbacks are not forwarded by public gateway', async () => {
    const response = await fetchLocal('/internal/c2a/image-task-events')
    assert.equal(response.status, 404)
    assert.equal(privateCalls, 0)
  })
} catch (error) {
  results.push({ title: 'setup', passed: false, error: String(error) })
  console.error(String(error))
} finally {
  if (started) {
    try {
      const logs = spawnSync('docker', ['logs', name], { encoding: 'utf8', timeout: 30000 })
      await writeFile(join(output, 'nginx.log'), String(logs.stdout || '') + String(logs.stderr || ''))
    } catch {}
    try { docker('stop', '--timeout', '2', name) } catch (error) { console.error('Cleanup failed for ' + name + ': ' + error); process.exitCode = 1 }
  }
  if (networkCreated) {
    try { docker('network', 'rm', name) } catch (error) { console.error('Network cleanup failed for ' + name + ': ' + error); process.exitCode = 1 }
  }
  upstream.closeAllConnections()
  if (upstream.listening) await new Promise(resolveClose => upstream.close(resolveClose))
  await rm(temporary, { recursive: true, force: true })
  const report = { image, configSha256: originalConfig ? createHash('sha256').update(originalConfig).digest('hex') : null,
    scope: 'isolated local Nginx; temporary timeout shortened from 300s to 1s; synthetic HTTP only', results }
  await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n')
  await writeFile(join(output, 'results.md'), '# Isolated task gateway checks\n\n' + report.scope + '\n\n' + results.map(result => '- ' + (result.passed ? 'PASS' : 'FAIL') + ' ' + result.title + (result.error ? ': ' + result.error : '')).join('\n') + '\n')
  if (!results.length || results.some(result => !result.passed)) process.exitCode = 1
  console.log('Report: ' + join(output, 'results.md'))
}
