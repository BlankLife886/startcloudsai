/**
 * 首页「夜场美术馆」three.js 场景。
 *
 * 层次（由远及近）：
 * - 星系核心：双层脉动光晕，压住画面右上的视觉重心。
 * - 彩色星云：7 片加色混合的光斑，紫/蓝/品红/青互相晕染。
 * - 极光带：2 条 shader 驱动的波动光幕，缓慢变色。
 * - 星场：最多 1600 颗三色调闪烁星，带星芒，按景深随滚动视差。
 * - 流星：高亮拖尾，随机划过。
 *
 * 交互输入：setPointer（视差）/ setScroll（星轨）/ setWarp（滚动加速曲速感）。
 * 性能：设备分档 + 帧率自适应降档 + 不可见暂停（由外层组件控制）。
 */
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from 'three'

const STAR_VERTEX_SHADER = /* glsl */ `
  attribute float aScale;
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aTint;
  uniform float uTime;
  uniform float uScroll;
  uniform float uWarp;
  uniform float uPixelRatio;
  varying float vTwinkle;
  varying float vTint;

  void main() {
    vec3 p = position;
    p.x += cos(uTime * 0.05 + aPhase * 5.1) * 0.6;
    p.y += sin(uTime * 0.06 + aPhase * 6.2831) * 0.7;
    // 滚动时按“景深”不同速度上移，形成星轨视差；warp 时加速
    p.y += (uScroll * (5.0 + aScale * 8.0)) * (1.0 + uWarp * 1.6);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aScale * uPixelRatio * (120.0 + uWarp * 40.0) / -mv.z;
    vTwinkle = 0.6 + 0.4 * sin(uTime * aSpeed + aPhase * 12.566);
    vTint = aTint;
  }
`

const STAR_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uOpacity;
  varying float vTwinkle;
  varying float vTint;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float core = smoothstep(0.5, 0.03, d);
    float halo = smoothstep(0.5, 0.14, d) * 0.6;
    float alpha = (core + halo) * vTwinkle * uOpacity;
    // 十字星芒
    float flare = max(0.0, 1.0 - abs(uv.x) * 11.0) + max(0.0, 1.0 - abs(uv.y) * 11.0);
    alpha += flare * 0.14 * vTwinkle * uOpacity * step(d, 0.5);
    if (alpha < 0.012) discard;
    vec3 color = vTint < 0.5
      ? mix(uColorA, uColorB, vTint * 2.0)
      : mix(uColorB, uColorC, vTint * 2.0 - 1.0);
    gl_FragColor = vec4(color, alpha);
  }
`

const AURORA_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    float wave =
      sin(vUv.x * 9.42 + uTime * 0.34) * 0.13 +
      sin(vUv.x * 15.7 - uTime * 0.21) * 0.06 +
      sin(vUv.x * 4.4 + uTime * 0.12) * 0.1;
    float band = vUv.y - 0.5 - wave;
    float intensity = exp(-band * band * 26.0);
    float shimmer = 0.72 + 0.28 * sin(vUv.x * 46.0 - uTime * 1.35);
    float edge = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);
    vec3 color = mix(uColorA, uColorB, clamp(vUv.x + 0.25 * sin(uTime * 0.1), 0.0, 1.0));
    float alpha = intensity * shimmer * edge * uOpacity;
    if (alpha < 0.008) discard;
    gl_FragColor = vec4(color, alpha);
  }
`

const AURORA_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const QUALITY_TIERS = [
  { name: 'low', stars: 620, dprCap: 1, meteors: 1, nebulae: 4, aurora: 1 },
  { name: 'medium', stars: 1050, dprCap: 1.5, meteors: 2, nebulae: 5, aurora: 2 },
  { name: 'high', stars: 1600, dprCap: 2, meteors: 3, nebulae: 7, aurora: 2 },
]

const PALETTE = {
  starA: '#ffffff',
  starB: '#a894ff',
  starC: '#6fe3ff',
  nebulae: ['#7c3aed', '#2563eb', '#c026d3', '#0891b2', '#6d28d9', '#4f46e5', '#db2777'],
  nebulaOpacity: 0.26,
  auroraA: '#7c5cff',
  auroraB: '#22d3ee',
  meteor: '#eef2ff',
  galaxyOuter: '#6d4df0',
  galaxyInner: '#cdc4ff',
}

function pickInitialTier() {
  if (typeof window === 'undefined') return 1
  const smallScreen = window.matchMedia('(max-width: 768px)').matches
  const lowMemory = Number(navigator.deviceMemory || 8) <= 4
  const lowCores = Number(navigator.hardwareConcurrency || 8) <= 4
  if (smallScreen && (lowMemory || lowCores)) return 0
  if (smallScreen || lowMemory || lowCores) return 1
  return 2
}

function makeGlowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)')
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.34)')
  gradient.addColorStop(0.68, 'rgba(255,255,255,0.09)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 256, 256)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

function makeTrailTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 16
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createLinearGradient(0, 0, 128, 0)
  gradient.addColorStop(0, 'rgba(255,255,255,0)')
  gradient.addColorStop(0.68, 'rgba(255,255,255,0.4)')
  gradient.addColorStop(0.93, 'rgba(255,255,255,1)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 128, 16)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

function buildStarGeometry(count) {
  const positions = new Float32Array(count * 3)
  const scales = new Float32Array(count)
  const phases = new Float32Array(count)
  const speeds = new Float32Array(count)
  const tints = new Float32Array(count)
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 86
    positions[i * 3 + 1] = (Math.random() - 0.5) * 54
    positions[i * 3 + 2] = -Math.random() * 34 + 6
    scales[i] = 0.4 + Math.random() ** 2.1 * 1.75
    phases[i] = Math.random()
    speeds[i] = 0.4 + Math.random() * 2.1
    tints[i] = Math.random()
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aScale', new Float32BufferAttribute(scales, 1))
  geometry.setAttribute('aPhase', new Float32BufferAttribute(phases, 1))
  geometry.setAttribute('aSpeed', new Float32BufferAttribute(speeds, 1))
  geometry.setAttribute('aTint', new Float32BufferAttribute(tints, 1))
  return geometry
}

export function createCelestialScene(canvas) {
  let tierIndex = pickInitialTier()

  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: false,
  })
  renderer.setClearColor(0x000000, 0)

  const scene = new Scene()
  const camera = new PerspectiveCamera(55, 1, 0.1, 140)
  camera.position.set(0, 0, 30)

  const glowTexture = makeGlowTexture()
  const trailTexture = makeTrailTexture()

  /* —— 星场 —— */
  const starGeometry = buildStarGeometry(QUALITY_TIERS[2].stars)
  const starMaterial = new ShaderMaterial({
    vertexShader: STAR_VERTEX_SHADER,
    fragmentShader: STAR_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uWarp: { value: 0 },
      uPixelRatio: { value: 1 },
      uOpacity: { value: 1 },
      uColorA: { value: new Color(PALETTE.starA) },
      uColorB: { value: new Color(PALETTE.starB) },
      uColorC: { value: new Color(PALETTE.starC) },
    },
  })
  const stars = new Points(starGeometry, starMaterial)
  stars.frustumCulled = false
  scene.add(stars)

  /* —— 星系核心：双层脉动光晕 —— */
  const galaxyGroup = new Group()
  const galaxyOuter = new Mesh(
    new PlaneGeometry(46, 34),
    new MeshBasicMaterial({
      map: glowTexture,
      color: new Color(PALETTE.galaxyOuter),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      opacity: 0.34,
    }),
  )
  const galaxyInner = new Mesh(
    new PlaneGeometry(18, 13),
    new MeshBasicMaterial({
      map: glowTexture,
      color: new Color(PALETTE.galaxyInner),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      opacity: 0.3,
    }),
  )
  galaxyGroup.add(galaxyOuter)
  galaxyGroup.add(galaxyInner)
  galaxyGroup.position.set(13, 5, -24)
  scene.add(galaxyGroup)

  /* —— 彩色星云 —— */
  const nebulaGroup = new Group()
  const nebulaMeshes = []
  const nebulaSeeds = []
  for (let i = 0; i < QUALITY_TIERS[2].nebulae; i += 1) {
    const size = 22 + Math.random() * 26
    const material = new MeshBasicMaterial({
      map: glowTexture,
      color: new Color(PALETTE.nebulae[i % PALETTE.nebulae.length]),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      opacity: 0,
    })
    const mesh = new Mesh(new PlaneGeometry(size, size * (0.56 + Math.random() * 0.5)), material)
    mesh.position.set(
      (Math.random() - 0.5) * 62,
      (Math.random() - 0.32) * 36,
      -19 - Math.random() * 11,
    )
    mesh.rotation.z = Math.random() * Math.PI
    nebulaSeeds.push({
      baseX: mesh.position.x,
      baseY: mesh.position.y,
      drift: 0.4 + Math.random() * 0.9,
      phase: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.024,
      baseOpacity: 0.6 + Math.random() * 0.4,
    })
    nebulaMeshes.push(mesh)
    nebulaGroup.add(mesh)
  }
  scene.add(nebulaGroup)

  /* —— 极光带 —— */
  const auroraMeshes = []
  for (let i = 0; i < QUALITY_TIERS[2].aurora; i += 1) {
    const material = new ShaderMaterial({
      vertexShader: AURORA_VERTEX_SHADER,
      fragmentShader: AURORA_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: Math.random() * 60 },
        uOpacity: { value: i === 0 ? 0.34 : 0.2 },
        uColorA: { value: new Color(PALETTE.auroraA) },
        uColorB: { value: new Color(PALETTE.auroraB) },
      },
    })
    const mesh = new Mesh(new PlaneGeometry(96, i === 0 ? 15 : 11), material)
    mesh.position.set(i === 0 ? -6 : 10, i === 0 ? 13 : 17.5, -22 - i * 4)
    mesh.rotation.z = i === 0 ? -0.1 : 0.14
    auroraMeshes.push(mesh)
    scene.add(mesh)
  }

  /* —— 流星池 —— */
  const meteorGroup = new Group()
  const meteors = []
  for (let i = 0; i < QUALITY_TIERS[2].meteors; i += 1) {
    const material = new MeshBasicMaterial({
      map: trailTexture,
      color: new Color(PALETTE.meteor),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      opacity: 0,
    })
    const mesh = new Mesh(new PlaneGeometry(13, 0.2), material)
    mesh.visible = false
    meteors.push({
      mesh,
      life: 0,
      duration: 1,
      dirX: -1,
      dirY: -0.5,
      speed: 30,
      startX: 0,
      startY: 0,
    })
    meteorGroup.add(mesh)
  }
  scene.add(meteorGroup)
  let nextMeteorAt = 1.6

  /* —— 状态 —— */
  const pointer = { x: 0, y: 0 }
  let scrollProgress = 0
  let warpTarget = 0
  let warp = 0
  let elapsed = 0
  let rafId = 0
  let running = false
  let disposed = false
  let lastFrameTime = 0
  let slowFrames = 0
  let width = 1
  let height = 1

  function applyTier() {
    const tier = QUALITY_TIERS[tierIndex]
    const dpr = Math.min(window.devicePixelRatio || 1, tier.dprCap)
    renderer.setPixelRatio(dpr)
    renderer.setSize(width, height, false)
    starMaterial.uniforms.uPixelRatio.value = dpr
    starGeometry.setDrawRange(0, tier.stars)
    nebulaMeshes.forEach((mesh, index) => {
      mesh.visible = index < tier.nebulae
    })
    auroraMeshes.forEach((mesh, index) => {
      mesh.visible = index < tier.aurora
    })
    meteors.forEach((meteor, index) => {
      if (index >= tier.meteors) {
        meteor.mesh.visible = false
        meteor.life = 0
      }
    })
  }

  function spawnMeteor() {
    const tier = QUALITY_TIERS[tierIndex]
    const idle = meteors.slice(0, tier.meteors).find((meteor) => meteor.life <= 0)
    if (!idle) return
    const fromLeft = Math.random() < 0.4
    idle.startX = fromLeft ? -34 - Math.random() * 8 : 10 + Math.random() * 26
    idle.startY = 9 + Math.random() * 13
    const angle = fromLeft ? -0.3 - Math.random() * 0.22 : Math.PI + 0.26 + Math.random() * 0.24
    idle.dirX = Math.cos(angle)
    idle.dirY = -Math.abs(Math.sin(angle)) - 0.16
    idle.speed = 30 + Math.random() * 22
    idle.duration = 0.85 + Math.random() * 0.75
    idle.life = idle.duration
    idle.mesh.visible = true
    idle.mesh.rotation.z = Math.atan2(idle.dirY, idle.dirX)
    idle.mesh.position.z = -13 - Math.random() * 8
  }

  function updateMeteors(delta) {
    const tier = QUALITY_TIERS[tierIndex]
    if (tier.meteors > 0) {
      nextMeteorAt -= delta * (1 + warp * 2)
      if (nextMeteorAt <= 0) {
        spawnMeteor()
        nextMeteorAt = 2.2 + Math.random() * 4.2
      }
    }
    for (const meteor of meteors) {
      if (meteor.life <= 0) continue
      meteor.life -= delta
      const t = 1 - meteor.life / meteor.duration
      const travelled = t * meteor.duration * meteor.speed
      meteor.mesh.position.x = meteor.startX + meteor.dirX * travelled
      meteor.mesh.position.y = meteor.startY + meteor.dirY * travelled
      meteor.mesh.material.opacity = Math.sin(Math.PI * t)
      if (meteor.life <= 0) meteor.mesh.visible = false
    }
  }

  function adaptQuality(delta) {
    if (tierIndex === 0) return
    if (delta > 0.024) {
      slowFrames += 1
      if (slowFrames > 110) {
        tierIndex -= 1
        slowFrames = 0
        applyTier()
      }
    } else if (slowFrames > 0) {
      slowFrames -= 2
    }
  }

  function frame(now) {
    if (!running || disposed) return
    rafId = requestAnimationFrame(frame)
    const delta = Math.min(0.05, lastFrameTime ? (now - lastFrameTime) / 1000 : 0.016)
    lastFrameTime = now

    warp += (warpTarget - warp) * Math.min(1, delta * 5)
    elapsed += delta * (1 + warp * 1.8)

    starMaterial.uniforms.uTime.value = elapsed
    starMaterial.uniforms.uScroll.value = scrollProgress
    starMaterial.uniforms.uWarp.value = warp
    starMaterial.uniforms.uOpacity.value = 1 + warp * 0.5

    // 惯性相机视差 + 滚动镜头推进（越滚越深入星空）+ warp 前冲
    camera.position.x += (pointer.x * 2.8 - camera.position.x) * 0.045
    camera.position.y += (-pointer.y * 1.8 - scrollProgress * 5.2 - camera.position.y) * 0.045
    camera.position.z = 30 - scrollProgress * 4.5 - warp * 5
    camera.lookAt(0, 0, -6)

    // 滚动时整幕星空缓慢滚转，像侧身穿过星河
    stars.rotation.z = scrollProgress * 0.06
    nebulaGroup.rotation.z = scrollProgress * 0.1

    // 星系核心脉动
    const pulse = 1 + Math.sin(elapsed * 0.4) * 0.06
    galaxyGroup.scale.setScalar(pulse)
    galaxyGroup.position.y = 5 + scrollProgress * 6
    galaxyOuter.material.opacity = 0.34 + Math.sin(elapsed * 0.27) * 0.07 + warp * 0.12
    galaxyInner.material.opacity = 0.3 + Math.sin(elapsed * 0.5 + 1.4) * 0.08
    galaxyInner.rotation.z += delta * 0.05

    // 星云漂移
    nebulaGroup.position.y = scrollProgress * 7.5
    nebulaGroup.position.x = pointer.x * -1.6
    for (let i = 0; i < nebulaMeshes.length; i += 1) {
      const mesh = nebulaMeshes[i]
      if (!mesh.visible) continue
      const seed = nebulaSeeds[i]
      mesh.position.x = seed.baseX + Math.sin(elapsed * 0.07 * seed.drift + seed.phase) * 3
      mesh.position.y = seed.baseY + Math.cos(elapsed * 0.05 * seed.drift + seed.phase) * 2.1
      mesh.rotation.z += seed.spin * delta
      const breath = 0.8 + Math.sin(elapsed * 0.17 + seed.phase * 3.0) * 0.2
      mesh.material.opacity = PALETTE.nebulaOpacity * seed.baseOpacity * breath * (1 + warp * 0.4)
    }

    // 极光
    for (const mesh of auroraMeshes) {
      if (mesh.visible) mesh.material.uniforms.uTime.value = elapsed
    }

    updateMeteors(delta)
    adaptQuality(delta)
    renderer.render(scene, camera)
  }

  function start() {
    if (running || disposed) return
    running = true
    lastFrameTime = 0
    rafId = requestAnimationFrame(frame)
  }

  function stop() {
    running = false
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
  }

  function resize(nextWidth, nextHeight) {
    if (disposed || !nextWidth || !nextHeight) return
    width = nextWidth
    height = nextHeight
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    applyTier()
    if (!running) renderer.render(scene, camera)
  }

  function setPointer(x, y) {
    pointer.x = x
    pointer.y = y
  }

  function setScroll(progress) {
    scrollProgress = Math.min(1, Math.max(0, progress))
  }

  function setWarp(value) {
    warpTarget = Math.min(1, Math.max(0, value))
  }

  function dispose() {
    if (disposed) return
    disposed = true
    stop()
    starGeometry.dispose()
    starMaterial.dispose()
    ;[galaxyOuter, galaxyInner, ...nebulaMeshes].forEach((mesh) => {
      mesh.geometry.dispose()
      mesh.material.dispose()
    })
    auroraMeshes.forEach((mesh) => {
      mesh.geometry.dispose()
      mesh.material.dispose()
    })
    meteors.forEach((meteor) => {
      meteor.mesh.geometry.dispose()
      meteor.mesh.material.dispose()
    })
    glowTexture.dispose()
    trailTexture.dispose()
    renderer.dispose()
  }

  applyTier()

  return { start, stop, resize, setPointer, setScroll, setWarp, dispose }
}
