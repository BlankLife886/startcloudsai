#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// An existing local, pinned image; this check never pulls an image or connects
// to the app database, real image providers, wallets, or user API keys.
const image = 'sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10'
const name = 'sc-openai-gateway-' + randomUUID().slice(0, 8)
const temporary = await mkdtemp(join(tmpdir(), 'sc-openai-gateway-'))
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
let containerStarted = false
let networkCreated = false
let failed = false
let receivedPOSTs = 0
const upstream = createServer((request, response) => {
  if (request.method === 'POST') receivedPOSTs++
  if (request.url.endsWith('/delayed')) {
    const timer = setTimeout(() => response.end('late fixture'), 1800)
    response.on('close', () => clearTimeout(timer))
    return
  }
  if (request.url.endsWith('/disconnected')) {
    request.socket.destroy()
    return
  }
  if (request.url.endsWith('/upstream-timeout')) {
    response.writeHead(504, { 'content-type': 'application/json', 'x-request-id': 'fixture-request', 'x-task-id': 'fixture-task' })
    response.end(JSON.stringify({ error: { message: '任务仍在处理', type: 'server_error', param: null, code: 'image_generation_timeout' } }))
    return
  }
  response.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'fixture-request' })
  response.end(JSON.stringify(request.url.startsWith('/v1/')
    ? { object: 'list', data: [{ id: 'fixture-image', object: 'model', owned_by: 'fixture', created: 0 }] }
    : { success: true, data: { fixture: true } }))
})

async function check(title, action) {
  try {
    await action()
    console.log('PASS ' + title)
  } catch (error) {
    failed = true
    console.error('FAIL ' + title + ': ' + error.message)
  }
}

async function compatError(response, status, code, retryHint = 'false') {
  assert.equal(response.status, status)
  assert(response.headers.get('content-type').includes('application/json'))
  assert(response.headers.get('x-request-id'))
  assert.equal(response.headers.get('x-should-retry'), retryHint)
  const body = await response.json()
  assert.deepEqual(Object.keys(body), ['error'])
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message', 'param', 'type'])
  assert.equal(body.error.code, code)
  return body
}

try {
  const endpoint = process.env.DOCKER_HOST || docker('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}')
  assert(endpoint.startsWith('unix://'), 'gateway check requires a local Docker socket')
  docker('image', 'inspect', image)
  docker('network', 'create', '--driver', 'bridge', name)
  networkCreated = true
  const hostEntries = docker('run', '--rm', '--pull', 'never', '--network', name,
    '--add-host', 'host.docker.internal:host-gateway', '--entrypoint', 'cat', image, '/etc/hosts')
  const hostIP = hostEntries.match(/^(\d+\.\d+\.\d+\.\d+)\s+host\.docker\.internal\s*$/m)?.[1]
  assert(hostIP, 'local Docker host address was not resolved')
  await new Promise(done => upstream.listen(0, '0.0.0.0', done))
  const original = await readFile(join(root, 'deploy/nginx.conf'), 'utf8')
  const config = original
    .replace('set $server_upstream http://server:8000;', `set $server_upstream http://${hostIP}:${upstream.address().port};`)
    .replaceAll('proxy_read_timeout 300s;', 'proxy_read_timeout 1s;')
  const configPath = join(temporary, 'nginx.conf')
  await writeFile(configPath, config)
  docker('run', '-d', '--rm', '--pull', 'never', '--name', name,
    '--network', name, '--publish', '127.0.0.1::80',
    '--mount', `type=bind,source=${configPath},target=/etc/nginx/conf.d/default.conf,readonly`, image)
  containerStarted = true
  const binding = JSON.parse(docker('inspect', '--format', '{{json (index .NetworkSettings.Ports "80/tcp")}}', name))[0]
  const base = `http://127.0.0.1:${binding.HostPort}`
  const fetchLocal = (path, options = {}) => fetch(base + path, { ...options, signal: AbortSignal.timeout(7000) })
  let ready = false
  const deadline = Date.now() + 15000
  while (!ready && Date.now() < deadline) {
    try { const result = await fetchLocal('/v1/models'); ready = result.status === 200; await result.text() } catch {}
    if (!ready) await new Promise(done => setTimeout(done, 100))
  }
  assert(ready, 'isolated gateway did not connect to its fixture')

  await check('model requests reach the API and retain its request ID', async () => {
    const response = await fetchLocal('/v1/models')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('x-request-id'), 'fixture-request')
    assert.equal((await response.json()).object, 'list')
  })
  await check('gateway timeout uses the compatibility error object', async () => {
    const body = await compatError(await fetchLocal('/v1/delayed'), 504, 'gateway_timeout')
    assert(body.error.message.includes('Idempotency-Key'))
  })
  await check('upstream timeout keeps the task ID and original JSON error', async () => {
    const response = await fetchLocal('/v1/upstream-timeout')
    assert.equal(response.headers.get('x-task-id'), 'fixture-task')
    assert.equal(response.headers.get('x-request-id'), 'fixture-request')
    await compatError(response, 504, 'image_generation_timeout', null)
  })
  await check('a failed POST is not automatically replayed', async () => {
    const before = receivedPOSTs
    await compatError(await fetchLocal('/v1/disconnected', { method: 'POST', body: '{}' }), 502, 'bad_gateway')
    assert.equal(receivedPOSTs - before, 1)
  })
  await check('oversized requests get JSON before the body is uploaded', async () => {
    const response = await new Promise((done, reject) => {
      const request = httpRequest(base + '/v1/images/edits', {
        method: 'POST', headers: { 'Content-Length': String((33 << 20) + 1), Expect: '100-continue' },
      }, result => {
        const chunks = []
        result.on('data', chunk => chunks.push(chunk))
        result.on('end', () => done(new Response(Buffer.concat(chunks), { status: result.statusCode, headers: result.headers })))
      })
      request.setTimeout(7000, () => request.destroy(new Error('oversize fixture timed out')))
      request.on('error', reject)
      request.flushHeaders()
    })
    await compatError(response, 413, 'request_too_large')
  })
  await check('legacy API keeps its original response envelope', async () => {
    const response = await fetchLocal('/api/fixture')
    assert.equal((await response.json()).success, true)
  })
  await check('legacy gateway timeout keeps its original behavior', async () => {
    const response = await fetchLocal('/api/delayed')
    assert.equal(response.status, 504)
    assert(response.headers.get('content-type').includes('text/html'))
    await response.text()
  })
} finally {
  if (containerStarted) docker('stop', name)
  if (networkCreated) docker('network', 'rm', name)
  await new Promise(done => upstream.close(done))
  await rm(temporary, { recursive: true, force: true })
}

if (failed) process.exitCode = 1
