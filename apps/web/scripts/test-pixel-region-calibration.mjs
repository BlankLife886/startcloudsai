import assert from 'node:assert/strict'
import {
  calibrateFlatRegion,
  calibrateOutlinedRegion,
  calibrateRegionByType,
} from '../src/features/design-workshop/pixelRegionCalibration.js'

const width = 220
const height = 100
const data = new Uint8ClampedArray(width * height * 4)
for (let index = 0; index < data.length; index += 4) {
  data[index] = 250
  data[index + 1] = 250
  data[index + 2] = 250
  data[index + 3] = 255
}
for (let y = 30; y < 66; y += 1) {
  for (let x = 108; x < 188; x += 1) {
    const index = (y * width + x) * 4
    data[index] = 109
    data[index + 1] = 92
    data[index + 2] = 255
  }
}

assert.deepEqual(
  calibrateFlatRegion({ data, width, height }, { x: 128, y: 28, width: 80, height: 36 }),
  { x: 108, y: 30, width: 80, height: 36 },
)

const textWidth = 160
const textHeight = 60
const textData = new Uint8ClampedArray(textWidth * textHeight * 4)
for (let index = 0; index < textData.length; index += 4) {
  textData[index] = 255
  textData[index + 1] = 255
  textData[index + 2] = 255
  textData[index + 3] = 255
}
for (const [startX, endX] of [
  [40, 50],
  [58, 68],
  [76, 86],
]) {
  for (let y = 22; y < 38; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const index = (y * textWidth + x) * 4
      textData[index] = 30
      textData[index + 1] = 30
      textData[index + 2] = 30
    }
  }
}
assert.deepEqual(
  calibrateRegionByType(
    { data: textData, width: textWidth, height: textHeight },
    { x: 36, y: 20, width: 54, height: 20 },
    'text',
  ),
  { x: 40, y: 22, width: 46, height: 16 },
)

const inputWidth = 360
const inputHeight = 100
const inputData = new Uint8ClampedArray(inputWidth * inputHeight * 4)
for (let index = 0; index < inputData.length; index += 4) {
  inputData[index] = 250
  inputData[index + 1] = 250
  inputData[index + 2] = 250
  inputData[index + 3] = 255
}
// A low-contrast input outline with a dark label beside it and text inside it.
for (let x = 92; x <= 322; x += 1) {
  for (const y of [31, 67]) {
    const index = (y * inputWidth + x) * 4
    inputData[index] = 226
    inputData[index + 1] = 226
    inputData[index + 2] = 230
  }
}
for (let y = 31; y <= 67; y += 1) {
  for (const x of [92, 322]) {
    const index = (y * inputWidth + x) * 4
    inputData[index] = 226
    inputData[index + 1] = 226
    inputData[index + 2] = 230
  }
}
for (let y = 42; y < 56; y += 1) {
  for (let x = 35; x < 72; x += 1) {
    const index = (y * inputWidth + x) * 4
    inputData[index] = 45
    inputData[index + 1] = 45
    inputData[index + 2] = 48
  }
  for (let x = 105; x < 150; x += 1) {
    const index = (y * inputWidth + x) * 4
    inputData[index] = 80
    inputData[index + 1] = 80
    inputData[index + 2] = 84
  }
}
assert.deepEqual(
  calibrateOutlinedRegion(
    { data: inputData, width: inputWidth, height: inputHeight },
    { x: 82, y: 28, width: 250, height: 40 },
  ),
  { x: 92, y: 31, width: 231, height: 37 },
)

const avatarWidth = 180
const avatarHeight = 180
const avatarData = new Uint8ClampedArray(avatarWidth * avatarHeight * 4)
for (let index = 0; index < avatarData.length; index += 4) {
  avatarData[index] = 252
  avatarData[index + 1] = 252
  avatarData[index + 2] = 252
  avatarData[index + 3] = 255
}
for (let y = 28; y < 108; y += 1) {
  for (let x = 48; x < 128; x += 1) {
    const distance = Math.hypot(x - 88, y - 68)
    if (distance > 40) continue
    const index = (y * avatarWidth + x) * 4
    avatarData[index] = 150
    avatarData[index + 1] = 115
    avatarData[index + 2] = 100
  }
}
// Nearby descriptive text must not be merged into the image crop.
for (let y = 126; y < 134; y += 1) {
  for (let x = 28; x < 150; x += 5) {
    const index = (y * avatarWidth + x) * 4
    avatarData[index] = 90
    avatarData[index + 1] = 90
    avatarData[index + 2] = 90
  }
}
assert.deepEqual(
  calibrateRegionByType(
    { data: avatarData, width: avatarWidth, height: avatarHeight },
    { x: 34, y: 22, width: 112, height: 120 },
    'image',
  ),
  { x: 49, y: 29, width: 79, height: 79 },
)

const iconWidth = 80
const iconHeight = 60
const iconData = new Uint8ClampedArray(iconWidth * iconHeight * 4)
for (let index = 0; index < iconData.length; index += 4) {
  iconData[index] = 255
  iconData[index + 1] = 255
  iconData[index + 2] = 255
  iconData[index + 3] = 255
}
// Two disconnected sides of an outlined icon must remain one crop.
for (let y = 17; y < 43; y += 1) {
  for (const x of [27, 28, 51, 52]) {
    const index = (y * iconWidth + x) * 4
    iconData[index] = 40
    iconData[index + 1] = 45
    iconData[index + 2] = 55
  }
}
for (let x = 27; x <= 52; x += 1) {
  for (const y of [17, 18, 41, 42]) {
    const index = (y * iconWidth + x) * 4
    iconData[index] = 40
    iconData[index + 1] = 45
    iconData[index + 2] = 55
  }
}
assert.deepEqual(
  calibrateRegionByType(
    { data: iconData, width: iconWidth, height: iconHeight },
    { x: 45, y: 15, width: 9, height: 30 },
    'icon',
  ),
  { x: 27, y: 17, width: 26, height: 26 },
)

console.log('pixel region calibration tests passed')
