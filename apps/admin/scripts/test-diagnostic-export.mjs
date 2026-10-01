import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeDiagnostics } from '../src/diagnosticExport.ts'
test('diagnostic exports remove credentials and retain correlatable anonymous subjects', () => {
  const input = { userEmail: 'person@example.test', ip: '192.168.1.2', apiKey: 'secret', metadata: { authorization: 'Bearer secret', prompt: 'private creation', inputTokens: 42 }, message: 'person@example.test 192.168.1.2 Bearer abcd https://host/api?token=secret' }
  const result = sanitizeDiagnostics(input)
  const json = JSON.stringify(result)
  assert.ok(!json.includes('secret'))
  assert.ok(!json.includes('person@example.test'))
  assert.ok(!json.includes('192.168.1.2'))
  assert.ok(!json.includes('private creation'))
  assert.equal(result.metadata.inputTokens, 42)
  assert.ok(result.message.includes(result.userEmail))
  assert.ok(result.message.includes(result.ip))
  assert.equal(input.apiKey, 'secret')
})
