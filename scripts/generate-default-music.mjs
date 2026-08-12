import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = resolve(root, 'apps/web-react/public/music')
const sampleRate = 22050
const duration = 36

const tracks = [
  { name: 'cloud-drift', root: 220, bpm: 76, progression: [0, 5, 3, 7], seed: 17 },
  { name: 'midnight-canvas', root: 164.81, bpm: 68, progression: [0, 3, 7, 5], seed: 29 },
  { name: 'pixel-sunrise', root: 246.94, bpm: 92, progression: [0, 7, 5, 3], seed: 43 },
]

function seededNoise(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0xffffffff - 0.5
  }
}

function oscillator(phase) {
  return Math.sin(phase) + Math.sin(phase * 2) * 0.18 + Math.sin(phase * 0.5) * 0.1
}

function makeTrack(config) {
  const sampleCount = sampleRate * duration
  const samples = new Int16Array(sampleCount)
  const beat = 60 / config.bpm
  const noise = seededNoise(config.seed)
  const scale = [0, 2, 4, 7, 9, 12]

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate
    const bar = Math.floor(time / (beat * 4))
    const chordStep = config.progression[bar % config.progression.length]
    const root = config.root * 2 ** (chordStep / 12)
    const localBar = time % (beat * 4)
    const padFade = Math.min(1, localBar / 0.8, (beat * 4 - localBar) / 0.8)
    const pad = [1, 1.25, 1.5].reduce(
      (sum, ratio, voice) => sum + oscillator(Math.PI * 2 * root * ratio * time + voice * 0.7),
      0,
    ) * 0.055 * Math.max(0, padFade)

    const eighth = Math.floor(time / (beat / 2))
    const note = scale[(eighth + config.seed) % scale.length]
    const noteTime = time % (beat / 2)
    const melodyFrequency = config.root * 2 ** ((12 + note) / 12)
    const melodyEnvelope = Math.exp(-noteTime * 7.2)
    const melody = Math.sin(Math.PI * 2 * melodyFrequency * time) * melodyEnvelope * 0.1

    const beatTime = time % beat
    const kick = Math.sin(Math.PI * 2 * (56 - beatTime * 22) * beatTime) * Math.exp(-beatTime * 16) * 0.12
    const hatTime = time % (beat / 2)
    const hat = noise() * Math.exp(-hatTime * 45) * 0.025
    const intro = Math.min(1, time / 1.8, (duration - time) / 1.8)
    const sample = Math.tanh((pad + melody + kick + hat) * 1.7) * Math.max(0, intro)
    samples[index] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)))
  }

  const buffer = Buffer.alloc(44 + samples.byteLength)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + samples.byteLength, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples.byteLength, 40)
  Buffer.from(samples.buffer).copy(buffer, 44)
  return buffer
}

mkdirSync(outputDir, { recursive: true })
for (const track of tracks) {
  const wavPath = resolve(outputDir, `${track.name}.wav`)
  const m4aPath = resolve(outputDir, `${track.name}.m4a`)
  writeFileSync(wavPath, makeTrack(track))
  rmSync(m4aPath, { force: true })
  const result = spawnSync('afconvert', ['-f', 'm4af', '-d', 'aac', wavPath, m4aPath], {
    stdio: 'inherit',
  })
  if (result.status !== 0) throw new Error(`Failed to encode ${track.name}`)
  rmSync(wavPath)
}
