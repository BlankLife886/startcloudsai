/** @jsquash encode() 常把 WASM 堆 ArrayBuffer 整段返回，需按 Uint8Array 视图截出真实码流。 */

export function exactEncodedBuffer(encoded) {
  if (!encoded) throw new Error('编码结果为空')
  if (encoded instanceof Uint8Array) {
    return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)
  }
  if (encoded instanceof ArrayBuffer) {
    return trimImageArrayBuffer(encoded)
  }
  if (ArrayBuffer.isView(encoded)) {
    return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)
  }
  throw new Error('无法识别的编码结果')
}

function trimImageArrayBuffer(buffer) {
  const bytes = new Uint8Array(buffer)
  const webpSize = readWebpSize(bytes)
  if (webpSize) return buffer.slice(0, webpSize)
  const jpegSize = readJpegSize(bytes)
  if (jpegSize) return buffer.slice(0, jpegSize)
  const pngSize = readPngSize(bytes)
  if (pngSize) return buffer.slice(0, pngSize)
  // 已是紧凑缓冲时直接返回副本
  return buffer.slice(0)
}

function readWebpSize(bytes) {
  if (
    bytes.length < 12 ||
    bytes[0] !== 0x52 ||
    bytes[1] !== 0x49 ||
    bytes[2] !== 0x46 ||
    bytes[3] !== 0x46 ||
    bytes[8] !== 0x57 ||
    bytes[9] !== 0x45 ||
    bytes[10] !== 0x42 ||
    bytes[11] !== 0x50
  ) {
    return 0
  }
  const size = 8 + (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24))
  return size > 12 && size <= bytes.length ? size : 0
}

function readJpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 0
  for (let i = bytes.length - 2; i >= 2; i -= 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return i + 2
  }
  return 0
}

function readPngSize(bytes) {
  if (
    bytes.length < 12 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    return 0
  }
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length =
      ((bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]) >>>
      0
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    )
    const next = offset + 12 + length
    if (next > bytes.length) return 0
    if (type === 'IEND') return next
    offset = next
  }
  return 0
}
