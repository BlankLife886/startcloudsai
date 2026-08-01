<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'

const props = defineProps({
  color: { type: String, default: '#73f7d1' },
  accent: { type: String, default: '#ffcf5a' },
  speed: { type: Number, default: 0.27 },
  focusX: { type: Number, default: 0.72 },
  focusY: { type: Number, default: 0.66 },
})

const mountRef = ref(null)
const unavailable = ref(false)
let disposeScene = null

const vertexShader = `
precision highp float;
attribute vec3 position;
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position, 1.0);
}
`

const fragmentShader = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uPointer;
uniform vec2 uFocus;
uniform vec3 uColor;
uniform vec3 uAccent;
uniform float uSpeed;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.56;
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise(p);
    p = p * 2.03 + vec2(11.7, 7.9);
    amplitude *= 0.5;
  }
  return value;
}
void main() {
  vec2 p = vUv - 0.5;
  p.x *= uResolution.x / max(uResolution.y, 1.0);
  float t = uTime * uSpeed;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 focus = vec2((uFocus.x - 0.5) * aspect, 0.5 - uFocus.y);
  vec2 pointer = (uPointer - 0.5) * vec2(0.09, 0.045);
  float beamY = focus.y + pointer.y + sin(p.x * 2.2 + t * 0.55) * 0.012;
  float distanceToBeam = abs(p.y - beamY);
  float softBeam = exp(-distanceToBeam * 42.0);
  float beamCore = exp(-distanceToBeam * 250.0);
  float beamGate = smoothstep(-1.2, -0.82, p.x) * (1.0 - smoothstep(0.42, 1.12, p.x));
  float columnX = focus.x + pointer.x + sin(t * 0.43) * 0.012;
  float verticalDistance = abs(p.x - columnX);
  float columnCore = exp(-verticalDistance * 170.0);
  float columnGlow = exp(-verticalDistance * 28.0);
  float columnGate = smoothstep(-0.48, beamY, p.y) * (1.0 - smoothstep(0.42, 0.64, p.y));
  float flareDistance = length(vec2((p.x - columnX) * 1.15, (p.y - beamY) * 2.8));
  float flare = exp(-flareDistance * 7.4);
  vec2 fogUv = vec2(p.x * 2.0, p.y * 4.2 - t * 0.24);
  float fog = fbm(fogUv + vec2(fbm(fogUv + 3.7), fbm(fogUv - 4.2)) * 0.45);
  fog = smoothstep(0.42, 0.9, fog) * exp(-distanceToBeam * 9.0);
  float streakCells = fract((p.y - t * 0.75) * 22.0);
  float streakMask = smoothstep(0.06, 0.0, abs(streakCells - 0.5));
  float wisps = streakMask * exp(-verticalDistance * 38.0) * columnGate;
  vec3 color = uColor * (softBeam * 0.34 + beamCore * 1.12) * beamGate;
  color += uColor * (columnGlow * 0.22 + columnCore * 1.12) * columnGate;
  color += mix(uColor, uAccent, 0.52) * flare * 0.94;
  color += uColor * fog * 0.13;
  color += uAccent * wisps * 0.32;
  float edgeFade = (1.0 - smoothstep(0.1, 0.74, abs(p.x))) * (1.0 - smoothstep(0.16, 0.64, abs(p.y)));
  color *= 0.44 + edgeFade * 0.78;
  float alpha = clamp(max(max(color.r, color.g), color.b), 0.0, 0.88);
  gl_FragColor = vec4(color, alpha);
}
`

function parseColor(value, fallback) {
  try { return new THREE.Color(value) } catch { return new THREE.Color(fallback) }
}

function motionDisabled() {
  return document.documentElement.classList.contains('settings-no-animations') || window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function setupScene() {
  const mount = mountRef.value
  if (!mount) return

  let renderer
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance', premultipliedAlpha: false, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: true })
  } catch {
    unavailable.value = true
    return
  }

  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.domElement.setAttribute('aria-hidden', 'true')
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block'
  mount.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
  const uniforms = {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uPointer: { value: new THREE.Vector2(0.5, 0.5) },
    uFocus: {
      value: new THREE.Vector2(
        Math.min(1, Math.max(0, props.focusX)),
        Math.min(1, Math.max(0, props.focusY)),
      ),
    },
    uColor: { value: parseColor(props.color, '#73f7d1') },
    uAccent: { value: parseColor(props.accent, '#ffcf5a') },
    uSpeed: { value: props.speed },
  }
  const material = new THREE.RawShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true, depthTest: false, depthWrite: false })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  scene.add(mesh)

  let frame = 0
  let inView = false
  let pageVisible = !document.hidden
  let lastTime = performance.now()
  let elapsed = 0
  const reduced = motionDisabled()
  const pointerTarget = new THREE.Vector2(0.5, 0.5)
  const pointerCurrent = new THREE.Vector2(0.5, 0.5)

  function resize() {
    const width = Math.max(1, mount.clientWidth)
    const height = Math.max(1, mount.clientHeight)
    const mobile = window.matchMedia('(max-width: 760px)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1 : 1.3)
    renderer.setPixelRatio(dpr)
    renderer.setSize(width, height, false)
    uniforms.uResolution.value.set(width * dpr, height * dpr)
    renderer.render(scene, camera)
  }

  function stop() {
    if (!frame) return
    cancelAnimationFrame(frame)
    frame = 0
  }

  function render(now) {
    frame = 0
    if (!inView || !pageVisible || reduced) return
    const delta = Math.min(0.04, Math.max(0, (now - lastTime) / 1000))
    lastTime = now
    elapsed += delta
    pointerCurrent.lerp(pointerTarget, 1 - Math.exp(-delta * 4.8))
    uniforms.uTime.value = elapsed
    uniforms.uPointer.value.copy(pointerCurrent)
    renderer.render(scene, camera)
    frame = requestAnimationFrame(render)
  }

  function start() {
    if (frame || reduced || !inView || !pageVisible) return
    lastTime = performance.now()
    frame = requestAnimationFrame(render)
  }

  function onPointerMove(event) {
    if (reduced) return
    const rect = mount.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    pointerTarget.set(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height)))
  }

  function onVisibilityChange() {
    pageVisible = !document.hidden
    if (pageVisible) start()
    else stop()
  }

  function onContextLost(event) {
    event.preventDefault()
    stop()
    unavailable.value = true
  }

  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(mount)
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    inView = entry?.isIntersecting ?? false
    if (inView) start()
    else stop()
  }, { rootMargin: '100px 0px', threshold: 0 })
  intersectionObserver.observe(mount)
  mount.addEventListener('pointermove', onPointerMove, { passive: true })
  renderer.domElement.addEventListener('webglcontextlost', onContextLost)
  document.addEventListener('visibilitychange', onVisibilityChange, { passive: true })
  resize()

  disposeScene = () => {
    stop()
    resizeObserver.disconnect()
    intersectionObserver.disconnect()
    mount.removeEventListener('pointermove', onPointerMove)
    renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    geometry.dispose()
    material.dispose()
    renderer.dispose()
    renderer.forceContextLoss?.()
    renderer.domElement.remove()
  }
}

onMounted(setupScene)
onBeforeUnmount(() => disposeScene?.())
</script>

<template>
  <div
    ref="mountRef"
    class="laser-flow-hero"
    :class="{ 'is-unavailable': unavailable }"
    :style="{
      '--laser-focus-x': `${focusX * 100}%`,
      '--laser-focus-y': `${focusY * 100}%`,
    }"
    aria-hidden="true"
  ></div>
</template>

<style scoped>
.laser-flow-hero { position: absolute; inset: 0; overflow: hidden; pointer-events: auto; }
.laser-flow-hero.is-unavailable {
  background:
    radial-gradient(ellipse at var(--laser-focus-x) var(--laser-focus-y), rgba(255, 207, 90, 0.16), transparent 14%),
    linear-gradient(178deg, transparent 45%, rgba(115, 247, 209, 0.32) 49.8%, rgba(115, 247, 209, 0.08) 51.5%, transparent 56%),
    #050707;
}
</style>
