import assert from 'node:assert/strict'
import {
  buildTileRefinePrompt,
  nearestTileAspectLabel,
  planQuadrantTiles,
  planTilePad,
  ratioLabel,
  resolveTileOutputLongSide,
  smoothstep,
  tileBlendWeight,
  tileOwnershipWeight,
} from '../src/legacy-modules/features/design-workshop/tilePrecisionRefine.js'

const tiles = planQuadrantTiles(1152, 2048)
assert.equal(tiles.length, 4)
assert.equal(tiles[0].id, 'tl')
assert.equal(tiles[0].x, 0)
assert.equal(tiles[0].y, 0)
assert.equal(tiles[0].w, 576)
assert.equal(tiles[0].h, 1024)
assert.equal(tiles[0].overlapX, 0)
assert.equal(tiles[0].overlapY, 0)

const tr = tiles.find((tile) => tile.id === 'tr')
const bl = tiles.find((tile) => tile.id === 'bl')
const br = tiles.find((tile) => tile.id === 'br')
assert.equal(tr.x, 576)
assert.equal(tr.y, 0)
assert.equal(tr.w, 576)
assert.equal(tr.h, 1024)
assert.equal(bl.x, 0)
assert.equal(bl.y, 1024)
assert.equal(br.x, 576)
assert.equal(br.y, 1024)

// Odd dimensions: remainder goes to right / bottom.
const odd = planQuadrantTiles(1001, 777)
assert.equal(odd[0].w + odd[1].w, 1001)
assert.equal(odd[0].h + odd[2].h, 777)
assert.equal(odd[0].w * odd[0].h + odd[1].w * odd[1].h + odd[2].w * odd[2].h + odd[3].w * odd[3].h, 1001 * 777)

function SUPPORTED_LIKE(label) {
  return /^(1:1|2:3|3:2|3:4|4:3|4:5|5:4|9:16|16:9|21:9|9:21)$/.test(String(label))
}

assert.ok(SUPPORTED_LIKE(tiles[0].aspectLabel), tiles[0].aspectLabel)
assert.ok(tiles[0].pad.padW >= tiles[0].w)
assert.ok(tiles[0].pad.padH >= tiles[0].h)
assert.equal(tiles[0].pad.contentW, tiles[0].w)
assert.equal(tiles[0].pad.contentH, tiles[0].h)

// Full exclusive coverage: every pixel belongs to exactly one tile.
for (const [x, y] of [
  [0, 0],
  [1151, 0],
  [0, 2047],
  [1151, 2047],
  [576, 1024],
  [575, 1023],
  [500, 900],
]) {
  const hits = tiles.filter(
    (tile) => x >= tile.x && y >= tile.y && x < tile.x + tile.w && y < tile.y + tile.h,
  )
  assert.equal(hits.length, 1, `pixel ${x},${y} should belong to exactly one tile`)
}

const midX = 576
const sampleY = 200
const left = tiles.find((tile) => tile.id === 'tl')
const right = tiles.find((tile) => tile.id === 'tr')

assert.equal(tileOwnershipWeight(midX - 1, sampleY, left), 1)
assert.equal(tileOwnershipWeight(midX - 1, sampleY, right), 0)
assert.equal(tileOwnershipWeight(midX, sampleY, left), 0)
assert.equal(tileOwnershipWeight(midX, sampleY, right), 1)

assert.ok(tileBlendWeight(40, 40, left) > 0.95)
assert.equal(smoothstep(0, 10, -1), 0)
assert.equal(smoothstep(0, 10, 10), 1)
assert.ok(smoothstep(0, 10, 5) > 0.4 && smoothstep(0, 10, 5) < 0.6)

assert.equal(ratioLabel(100, 50), '2:1')
assert.equal(nearestTileAspectLabel(100, 100), '1:1')
assert.equal(nearestTileAspectLabel(900, 1600), '9:16')

const pad = planTilePad(200, 300, '2:3')
assert.equal(pad.padW, 200)
assert.equal(pad.padH, 300)
assert.equal(pad.padX, 0)
assert.equal(pad.padY, 0)

const padWide = planTilePad(300, 200, '1:1')
assert.equal(padWide.padW, 300)
assert.equal(padWide.padH, 300)
assert.equal(padWide.padY, 50)

assert.match(buildTileRefinePrompt({ quadrantLabel: '左上', aspectLabel: '3:4' }), /左上/)
assert.match(buildTileRefinePrompt({ aspectLabel: '3:4' }), /3:4/)
assert.match(buildTileRefinePrompt({}), /禁止补全切片外/)

assert.ok(resolveTileOutputLongSide(tiles[0]) >= 2048)

console.log('test-tile-precision-refine: ok')
