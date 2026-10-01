// 页脚大字的粒子版：把「星空云绘」采样成点阵，按进度从四周聚合成字。
// 只在进度变化时重绘（拉动 / 回弹期间），静止时不占用任何动画帧。

const TEXT = "星空云绘";
const FONT_FAMILY = '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';
const BRAND = [
  [109, 77, 255],
  [179, 71, 217],
  [255, 138, 91],
];

function brandColor(t) {
  const [from, to, k] = t < 0.5 ? [BRAND[0], BRAND[1], t * 2] : [BRAND[1], BRAND[2], (t - 0.5) * 2];
  return from.map((value, index) => Math.round(value + (to[index] - value) * k));
}

// 固定种子的伪随机，保证每次重绘的散布位置一致
function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

export function createParticleWordmark(canvas) {
  const ctx = canvas.getContext("2d");
  let particles = [];
  let width = 0;
  let height = 0;
  let alpha = 0.6;

  const layout = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    if (!width || !height) return;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 在离屏画布上写字，按网格采样出落在笔画内的点
    const probe = document.createElement("canvas");
    probe.width = Math.ceil(width);
    probe.height = Math.ceil(height);
    const pctx = probe.getContext("2d", { willReadFrequently: true });
    // 字号按宽度撑满，底部略微出血（被裁掉一截），与原来的大字构图一致
    let size = height * 1.2;
    pctx.font = `900 ${size}px ${FONT_FAMILY}`;
    size *= width / pctx.measureText(TEXT).width;
    pctx.font = `900 ${size}px ${FONT_FAMILY}`;
    pctx.textAlign = "center";
    pctx.textBaseline = "alphabetic";
    pctx.fillStyle = "#fff";
    pctx.fillText(TEXT, width / 2, height + size * 0.08);
    const data = pctx.getImageData(0, 0, probe.width, probe.height).data;

    const step = width > 900 ? 4 : 3;
    const random = seeded(7);
    particles = [];
    for (let y = 0; y < probe.height; y += step) {
      for (let x = 0; x < probe.width; x += step) {
        if (data[(y * probe.width + x) * 4 + 3] < 140) continue;
        const [r, g, b] = brandColor(x / width);
        particles.push({
          // 轻微抖动，避免像 LED 点阵一样规整
          x: x + (random() - 0.5) * step * 0.7,
          y: y + (random() - 0.5) * step * 0.7,
          // 起点散布在字的上方与两侧，拉出时像被吸进字形
          sx: x + (random() - 0.5) * width * 0.6,
          sy: y - height * (0.4 + random() * 0.9),
          delay: random() * 0.35,
          fade: Math.max(0.1, 1 - (y / height) * 0.85),
          color: `${r}, ${g}, ${b}`,
        });
      }
    }
  };

  const draw = (progress) => {
    if (!width) return;
    ctx.clearRect(0, 0, width, height);
    const dot = width > 900 ? 1.8 : 1.5;
    for (const p of particles) {
      const local = Math.min(1, Math.max(0, (progress - p.delay) / (1 - p.delay)));
      if (local <= 0) continue;
      const eased = 1 - (1 - local) ** 3;
      const x = p.sx + (p.x - p.sx) * eased;
      const y = p.sy + (p.y - p.sy) * eased;
      ctx.fillStyle = `rgba(${p.color}, ${alpha * p.fade * (0.25 + 0.75 * eased)})`;
      ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    }
  };

  return {
    layout,
    draw,
    setAlpha(value) {
      alpha = value;
    },
  };
}
