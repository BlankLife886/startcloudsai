#!/usr/bin/env node
// API 调用 手动测试用的假上游（OpenAI 兼容），不连接任何真实服务商。
// 用法：node scripts/devapi-mock-upstream.mjs [端口，默认 18080]
// 后台新建服务商：协议选 OpenAI 兼容，Base URL 填 http://127.0.0.1:18080/v1。
//
// 在 prompt（或对话最后一条消息）里写入以下标记即可控制上游行为：
//   #fail500   上游返回 500
//   #reject    上游返回 400 内容安全拒绝
//   #rate      上游返回 429
//   #empty     上游返回 200 但没有图片数据
//   #slow      延迟 20 秒再成功（测断开、并发上限）
//   #hang      一直不返回（测 240 秒超时）
//   #drop      直接断开连接
//   #cut       流式对话：先发两段内容再断开
//   #cutearly  流式对话：一段内容都不发就断开
import { createServer } from 'node:http'

const port = Number(process.argv[2] || 18080)
// 1x1 透明 PNG
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
let seq = 0

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': `mock-${seq}` })
  res.end(JSON.stringify(body))
}
const error = (res, status, code, message) => json(res, status, { error: { message, type: 'invalid_request_error', param: null, code } })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

createServer(async (req, res) => {
  const id = ++seq
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks)
  const text = raw.toString('latin1')
  const has = (tag) => text.includes(tag)
  const started = Date.now()
  res.on('close', () => console.log(`#${id} ${req.method} ${req.url} ${raw.length}B ${Date.now() - started}ms${res.writableFinished ? '' : ' (对方已断开)'}`))

  if (req.method === 'GET' && req.url === '/img.png') {
    res.writeHead(200, { 'content-type': 'image/png' })
    return res.end(Buffer.from(png, 'base64'))
  }
  if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
    return json(res, 200, { object: 'list', data: [{ id: 'mock-image', object: 'model' }, { id: 'mock-chat', object: 'model' }] })
  }

  if (has('#drop')) return req.socket.destroy()
  if (has('#hang')) return
  if (has('#slow')) await sleep(20000)
  if (has('#fail500')) return error(res, 500, 'server_error', 'mock upstream exploded, see https://secret.example.com/?key=sk-live-123')
  if (has('#reject')) return error(res, 400, 'content_policy_violation', 'Your request was rejected by the safety system.')
  if (has('#rate')) return error(res, 429, 'rate_limit_exceeded', 'Rate limit reached for requests')

  if (req.url === '/v1/images/generations' || req.url === '/v1/images/edits') {
    if (has('#empty')) return json(res, 200, { created: Math.floor(Date.now() / 1000), data: [] })
    let n = 1
    let format = 'b64_json'
    if (req.url.endsWith('generations')) {
      try {
        const body = JSON.parse(raw.toString('utf8'))
        n = Number(body.n) || 1
        format = body.response_format || 'b64_json'
      } catch {}
    } else {
      n = Number(/name="n"\r\n\r\n(\d+)/.exec(text)?.[1]) || 1
      format = /name="response_format"\r\n\r\n(\w+)/.exec(text)?.[1] || 'b64_json'
      console.log(`#${id} edits 收到参考图 ${(text.match(/name="image(\[\])?"/g) || []).length} 张`)
    }
    const item = format === 'url' ? { url: `http://127.0.0.1:${port}/img.png` } : { b64_json: png }
    return json(res, 200, { created: Math.floor(Date.now() / 1000), data: Array.from({ length: n }, () => item), usage: { total_tokens: 0 } })
  }

  if (req.url === '/v1/chat/completions') {
    let body = {}
    try {
      body = JSON.parse(raw.toString('utf8'))
    } catch {}
    const model = body.model || 'mock-chat'
    const created = Math.floor(Date.now() / 1000)
    if (!body.stream) {
      return json(res, 200, {
        id: `chatcmpl-mock-${id}`,
        object: 'chat.completion',
        created,
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: `mock 回答 #${id}` }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    if (has('#cutearly')) return req.socket.destroy()
    const send = (delta, finish = null) =>
      res.write(`data: ${JSON.stringify({ id: `chatcmpl-mock-${id}`, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
    send({ role: 'assistant', content: '' })
    for (const word of ['mock ', '流式 ', '回答']) {
      send({ content: word })
      await sleep(300)
      if (has('#cut') && word === '流式 ') return req.socket.destroy()
    }
    send({}, 'stop')
    return res.end('data: [DONE]\n\n')
  }

  error(res, 404, 'not_found', `mock 没有实现 ${req.method} ${req.url}`)
}).listen(port, '127.0.0.1', () => console.log(`mock upstream: http://127.0.0.1:${port}/v1`))
