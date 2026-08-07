import assert from 'node:assert/strict'
import {
  spatialAssetAffinity,
  stabilizeAnalysisNodes,
} from '../src/features/design-workshop/analysisNodeGeometry.js'

const stable = stabilizeAnalysisNodes(
  [
    { id: 'page', type: 'frame', x: 0, y: 0, width: 1000, height: 700, confidence: 0.99 },
    { id: 'card', type: 'frame', x: 100, y: 100, width: 500, height: 300, confidence: 0.95 },
    {
      id: 'save-text',
      type: 'text',
      name: '保存',
      text: '保存',
      x: 430,
      y: 330,
      width: 80,
      height: 32,
      confidence: 0.7,
    },
    {
      id: 'save-button',
      type: 'button',
      name: '保存',
      text: '保存',
      x: 430,
      y: 330,
      width: 80,
      height: 32,
      confidence: 0.95,
    },
    { id: 'avatar', type: 'image', x: 130, y: 140, width: 80, height: 80, confidence: 0.96 },
    {
      id: 'danger-row',
      type: 'button',
      name: '删除账号操作',
      x: 100,
      y: 620,
      width: 780,
      height: 44,
      confidence: 0.9,
    },
    {
      id: 'timezone',
      type: 'button',
      name: '时区选择',
      x: 300,
      y: 450,
      width: 240,
      height: 36,
      confidence: 0.9,
    },
  ],
  { width: 1000, height: 700 },
)

assert.equal(
  stable.some((node) => node.id === 'save-text'),
  false,
)
assert.equal(stable.find((node) => node.id === 'save-button').parentId, 'card')
assert.equal(stable.find((node) => node.id === 'avatar').parentId, 'card')
assert.equal(stable.find((node) => node.id === 'danger-row').type, 'frame')
assert.equal(stable.find((node) => node.id === 'timezone').type, 'input')

const viewport = { width: 1000, height: 700 }
const asset = { region: { x: 0.12, y: 0.18, width: 0.12, height: 0.18 } }
const near = spatialAssetAffinity(asset, { x: 130, y: 140, width: 80, height: 80 }, viewport)
const far = spatialAssetAffinity(asset, { x: 800, y: 500, width: 80, height: 80 }, viewport)
assert.ok(near > 0.7)
assert.equal(far, 0)

console.log('analysis node geometry tests passed')
