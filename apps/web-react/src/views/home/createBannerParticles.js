const VERTEX_SHADER = `
attribute vec2 a_origin;
attribute vec2 a_velocity;
attribute vec4 a_seed;
uniform vec2 u_size;
uniform vec2 u_cover;
uniform float u_progress;
uniform float u_ratio;
varying vec2 v_sourceUv;
varying float v_alpha;
varying float v_glint;

void main() {
  float phase = clamp((u_progress - a_seed.x) / a_seed.y, 0.0, 1.0);
  float envelope = smoothstep(0.0, 0.18, phase) * (1.0 - smoothstep(0.66, 1.0, phase));
  float travel = sin(phase * 3.14159265);
  vec2 curl = vec2(-a_velocity.y, a_velocity.x) * sin(phase * 6.2831853) * 0.08;
  vec2 position = a_origin + (a_velocity * travel + curl) / u_size;
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
  float size = a_seed.z * u_ratio;
  gl_PointSize = max(1.0, size);
  v_sourceUv = (a_origin - 0.5) * u_cover + 0.5;
  v_alpha = a_seed.w * envelope * min(1.0, size);
  v_glint = step(3.1, a_seed.z);
}
`;

const FRAGMENT_SHADER = `
uniform sampler2D u_image;
varying vec2 v_sourceUv;
varying float v_alpha;
varying float v_glint;

void main() {
  if (v_alpha <= 0.001) discard;
  float radius = length(gl_PointCoord - 0.5) * 2.0;
  if (radius >= 1.0) discard;
  float coverage = 1.0 - smoothstep(0.55, 1.0, radius);
  // One constant source UV per point preserves the old image's local colour.
  vec4 colour = texture2D(u_image, v_sourceUv);
  float luminance = dot(colour.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 contrast = mix(vec3(0.94, 0.97, 1.0), vec3(0.16, 0.20, 0.26), smoothstep(0.45, 0.8, luminance));
  vec3 tint = mix(colour.rgb, contrast, 0.48 + v_glint * 0.18);
  gl_FragColor = vec4(tint, colour.a * coverage * v_alpha);
}
`;

function particleData(count, image) {
  let seed = 2166136261;
  const source = String(image.currentSrc || image.src || '').slice(-512);
  for (let index = 0; index < source.length; index += 1) seed = Math.imul(seed ^ source.charCodeAt(index), 16777619);
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let value = Math.imul(seed ^ (seed >>> 15), seed | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const data = new Float32Array(count * 8);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 8;
    const x = random();
    const y = random();
    const angle = random() * Math.PI * 2;
    const distance = 4 + Math.pow(random(), 1.6) * 14;
    const delay = 0.02 + random() * 0.24;
    const lifetime = 0.52 + random() * 0.18;
    const glint = random() < 0.02;
    const size = glint ? 3.2 + random() * 0.6 : 1.6 + Math.pow(random(), 1.4) * 1.4;
    data.set([
      x, y, Math.cos(angle) * distance, Math.sin(angle) * distance,
      delay, lifetime, size, glint ? 0.68 + random() * 0.17 : 0.48 + random() * 0.22,
    ], offset);
  }
  return data;
}

/** Sparse coloured specks over a DOM crossfade; both endpoint frames are clear. */
export function createBannerParticles(host, outgoingImage) {
  if (!host?.ownerDocument || !outgoingImage?.complete || !outgoingImage.naturalWidth || !outgoingImage.naturalHeight) return null;

  const view = host.ownerDocument.defaultView;
  if (!view) return null;
  const canvas = host.ownerDocument.createElement('canvas');
  canvas.className = 'home-banner__particles';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    zIndex: '3', pointerEvents: 'none',
  });

  let gl = null;
  let program = null;
  let buffer = null;
  let texture = null;
  let observer = null;
  const shaders = [];
  let disposed = false;
  let progress = 0;
  let progressUniform = null;
  let sizeUniform = null;
  let coverUniform = null;
  let ratioUniform = null;
  let particleCount = 0;

  function dispose() {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    view.removeEventListener('resize', resize);
    canvas.removeEventListener('webglcontextlost', contextLost);
    canvas.remove();
    if (!gl) return;
    const context = gl;
    gl = null;
    try {
      context.bindTexture(context.TEXTURE_2D, null);
      context.bindBuffer(context.ARRAY_BUFFER, null);
      context.useProgram(null);
      if (texture) context.deleteTexture(texture);
      if (buffer) context.deleteBuffer(buffer);
      if (program) context.deleteProgram(program);
      shaders.forEach(shader => context.deleteShader(shader));
      if (!context.isContextLost()) context.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { /* A lost context already releases its GPU resources. */ }
    texture = buffer = program = null;
    shaders.length = 0;
  }

  function contextLost(event) {
    event.preventDefault();
    // Removing the overlay immediately exposes the new DOM image underneath.
    dispose();
  }

  function draw(value) {
    if (disposed || !gl) return;
    progress = Math.max(0, Math.min(1, Number(value) || 0));
    try {
      if (gl.isContextLost()) { dispose(); return; }
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (progress <= 0 || progress >= 1) return;
      gl.uniform1f(progressUniform, progress);
      gl.drawArrays(gl.POINTS, 0, particleCount);
    } catch { dispose(); }
  }

  function resize() {
    if (disposed || !gl) return;
    try {
      const bounds = host.getBoundingClientRect();
      const width = Math.max(1, bounds.width);
      const height = Math.max(1, bounds.height);
      const ratio = Math.max(1, Math.min(1.25, view.devicePixelRatio || 1));
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(sizeUniform, width, height);
      const scale = Math.max(width / outgoingImage.naturalWidth, height / outgoingImage.naturalHeight);
      gl.uniform2f(coverUniform, width / (outgoingImage.naturalWidth * scale), height / (outgoingImage.naturalHeight * scale));
      gl.uniform1f(ratioUniform, canvas.width / width);
      draw(progress);
    } catch { dispose(); }
  }

  try {
    gl = canvas.getContext('webgl', {
      alpha: true, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: true, preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
    if (!gl) { dispose(); return null; }
    canvas.addEventListener('webglcontextlost', contextLost);

    const compile = (type, source) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Particle shader unavailable');
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Particle shader compilation failed');
      return shader;
    };
    const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ? 'highp' : 'mediump';
    const vertexShader = compile(gl.VERTEX_SHADER, `precision ${precision} float;\n${VERTEX_SHADER}`);
    const fragmentShader = compile(gl.FRAGMENT_SHADER, `precision ${precision} float;\n${FRAGMENT_SHADER}`);
    program = gl.createProgram();
    if (!program) throw new Error('Particle program unavailable');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Particle program link failed');
    gl.useProgram(program);

    buffer = gl.createBuffer();
    texture = gl.createTexture();
    if (!buffer || !texture) throw new Error('Particle resources unavailable');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const bounds = host.getBoundingClientRect();
    const area = Math.max(1, bounds.width * bounds.height);
    const mobile = bounds.width <= 800;
    particleCount = mobile
      ? Math.max(6000, Math.min(10000, Math.round(area / 36)))
      : Math.max(18000, Math.min(28000, Math.round(area / 40)));
    canvas.dataset.particleCount = String(particleCount);
    // Generate the random cloud once; every frame advances it entirely on GPU.
    gl.bufferData(gl.ARRAY_BUFFER, particleData(particleCount, outgoingImage), gl.STATIC_DRAW);
    for (const [name, size, offset] of [['a_origin', 2, 0], ['a_velocity', 2, 2], ['a_seed', 4, 4]]) {
      const attribute = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribPointer(attribute, size, gl.FLOAT, false, 8 * Float32Array.BYTES_PER_ELEMENT, offset * Float32Array.BYTES_PER_ELEMENT);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // HTML images start at the top; this aligns them with bottom-up WebGL UVs.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, outgoingImage);
    gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
    progressUniform = gl.getUniformLocation(program, 'u_progress');
    sizeUniform = gl.getUniformLocation(program, 'u_size');
    coverUniform = gl.getUniformLocation(program, 'u_cover');
    ratioUniform = gl.getUniformLocation(program, 'u_ratio');
    // Ordinary alpha blending produces a premultiplied transparent canvas.
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    resize();
    if (disposed || !gl || gl.getError() !== gl.NO_ERROR) { dispose(); return null; }

    host.appendChild(canvas);
    if (typeof view.ResizeObserver === 'function') {
      observer = new view.ResizeObserver(resize);
      observer.observe(host);
    } else {
      view.addEventListener('resize', resize);
    }
    return { draw, dispose };
  } catch {
    // CORS-restricted images and unsupported GPUs keep the DOM transition path.
    dispose();
    return null;
  }
}
