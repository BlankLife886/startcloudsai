import assert from 'node:assert/strict'

const moduleUrl = new URL(
  '../src/features/ai-illustration-coloring/domain/prepareColoringUpload.js',
  import.meta.url,
)
const { prepareColoringUploadBlob } = await import(moduleUrl)

const originalBytes = new Uint8Array([1, 2, 3, 4, 5, 6])
const original = new Blob([originalBytes], { type: 'image/png' })

let imageConstructed = false
globalThis.Image = class {
  constructor() {
    imageConstructed = true
  }
}

for (const enableCompress of [false, undefined, 'false', 0, null]) {
  const result = await prepareColoringUploadBlob({
    blob: original,
    settings: {
      enableCompress,
      inputFormat: 'image/jpeg',
      compressMaxKb: 64,
    },
  })

  assert.equal(result.blob, original, `关闭值 ${String(enableCompress)} 必须返回原 Blob`)
  assert.equal(result.changed, false)
  assert.equal(result.processedBytes, original.size)
  assert.equal(result.compressionEnabled, false)
}

assert.equal(imageConstructed, false, '关闭压缩时不能进入 Image/Canvas 重编码链路')
console.log('coloring upload compression tests passed')
