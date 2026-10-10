import { useId } from "react";

// 顶栏按钮用的黏土立体图标：兑换渐变紫 / 语言蓝 / 公告绿 / 通知紫，各按钮一色。
// 立体感 = 模糊接触投影 + 向下挤出的厚度 + 渐变主体 + 背光暗部 + 柔化高光。
// 每个图标由几组路径描述：back 在主体后面，body 是主体，light / inner 是开口，front 在主体前面。
// 颜色都是 [亮, 中, 暗] 三档：亮/中/暗做渐变，暗色同时用于厚度和暗部。

const WAVE = ["#a7f3d0", "#10b981", "#047857"];

const circle = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
const ellipse = (cx, cy, rx, ry) => `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z`;

const SHAPES = {
  ticket: {
    main: ["#f0abfc", "#a855f7", "#5b21b6"],
    accent: ["#fde68a", "#fbbf24", "#b45309"],
    transform: "rotate(-12 12 12)",
    back: [],
    body: ["M5 6h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8a2 2 0 0 1 2-2z"],
    light: [],
    inner: [],
    front: ["M9.3 8.3l1.05 2.1 2.3.33-1.67 1.62.4 2.3-2.08-1.1-2.06 1.1.4-2.3-1.67-1.62 2.3-.33z"],
    lines: [{ d: "M15.4 7.6v8.8", width: 1, dash: "1.1 1.5" }],
    highlight: "M5.4 7.5h8.2",
  },
  globe: {
    main: ["#bfdbfe", "#3b82f6", "#1e40af"],
    accent: ["#a7f3d0", "#34d399", "#047857"],
    back: [],
    body: [circle(12, 11.2, 8.3)],
    light: [],
    inner: [],
    front: [
      "M7 6.4c1.5-.4 2.7.2 3 1.3.3 1-.6 1.7-.4 2.7.2 1.1 1.6 1.3 1.4 2.7-.2 1.1-1.6 1.4-2.4 2.5-1-.8-1.7-2.1-2-3.3-.4-1.9-.1-4 .4-5.9zM13.5 4.4c1.7.3 3.6 1.5 4.5 3-1 .3-2 0-2.7.6-.8.6-.4 1.8-1.4 2.2-.9.4-2-.4-2.1-1.5-.1-1.3 1.6-1.7 1.7-2.8 0-.6-.2-1.1 0-1.5zM15.6 13.3c1-.6 2.5-.5 3.6.1-.5 2-1.9 3.6-3.6 4.6-.5-.9-1-1.9-.8-2.9.1-.8.3-1.4.8-1.8z",
    ],
    lines: [
      { d: ellipse(12, 11.2, 3.6, 8.3), width: 0.7, opacity: 0.45 },
      { d: "M3.7 11.2h16.6", width: 0.7, opacity: 0.45 },
    ],
    highlight: "M5.6 7.6a7.6 7.6 0 0 1 4.6-3.6",
  },
  megaphone: {
    main: ["#a7f3d0", "#10b981", "#065f46"],
    accent: ["#fde68a", "#fbbf24", "#b45309"],
    back: ["M8 14.3l1.4 4.9a1.4 1.4 0 0 0 2.7-.75l-1.2-4z"],
    body: ["M5.4 8.7l8.6-4.3c1-.5 2.1.2 2.1 1.3v11.6c0 1.1-1.1 1.8-2.1 1.3l-8.6-4.3z"],
    light: [ellipse(16.1, 11.6, 2.1, 6.4)],
    inner: [ellipse(16.35, 11.6, 1.4, 5.5)],
    front: ["M3.6 8.4h1.5a1.2 1.2 0 0 1 1.2 1.2v3.6a1.2 1.2 0 0 1-1.2 1.2H3.6a1.2 1.2 0 0 1-1.2-1.2V9.6a1.2 1.2 0 0 1 1.2-1.2z"],
    lines: [{ d: "M19.4 9.2a3.4 3.4 0 0 1 0 5M21.1 7.3a6 6 0 0 1 0 8.8", width: 1.8, wave: true }],
    highlight: "M7.2 9.3l6.2-3.1",
  },
  bell: {
    main: ["#ddd6fe", "#8b5cf6", "#5b21b6"],
    accent: ["#fde68a", "#fbbf24", "#b45309"],
    back: [circle(12, 19, 2.2), circle(12, 3.5, 1.6)],
    body: [
      "M12 3.9c-3.6 0-6.1 2.8-6.1 6.4v3.5c0 1-.5 1.8-1.3 2.4h14.8c-.8-.6-1.3-1.4-1.3-2.4v-3.5c0-3.6-2.5-6.4-6.1-6.4z",
      "M4.7 15.4h14.6a1.3 1.3 0 0 1 0 2.6H4.7a1.3 1.3 0 0 1 0-2.6z",
    ],
    light: [],
    inner: [],
    front: [],
    lines: [],
    highlight: "M8.5 13.2v-2.8c0-1.9 1-3.4 2.6-4.1",
  },
  sun: {
    main: ["#fff1a8", "#fbbf24", "#c2410c"],
    accent: ["#fde68a", "#f59e0b", "#b45309"],
    back: [],
    body: [circle(12, 11.2, 5)],
    light: [],
    inner: [],
    front: [],
    lines: [],
    rays: true,
    highlight: "M9.2 9.3a3.6 3.6 0 0 1 2.4-2",
  },
  moon: {
    main: ["#e0e7ff", "#a5b4fc", "#4338ca"],
    accent: ["#fde68a", "#fbbf24", "#b45309"],
    back: [],
    body: ["M14.6 3.6a8 8 0 1 0 5.6 12.6 6.4 6.4 0 0 1-5.6-12.6z"],
    light: [],
    inner: [circle(9, 13.2, 1.1), circle(12.4, 16.6, 0.8)],
    innerOpacity: 0.45,
    front: ["M18.4 3.2l.55 1.3 1.3.55-1.3.55-.55 1.3-.55-1.3-1.3-.55 1.3-.55z"],
    lines: [],
    highlight: "M6.4 9.4a6.2 6.2 0 0 1 3.6-4.2",
  },
};

// 太阳的 8 道光芒：围绕圆心均匀分布的圆头短线
const SUN_RAYS = Array.from({ length: 8 }, (_, index) => {
  const angle = (index * Math.PI) / 4;
  const point = (radius) => [12 + Math.sin(angle) * radius, 11.2 - Math.cos(angle) * radius];
  return [point(7.1), point(9.4)];
});

function paths(list, props) {
  return list.map((d, index) => <path key={index} d={d} {...props} />);
}

function gradientStops(colors) {
  return colors.map((color, index) => <stop key={index} offset={index / (colors.length - 1)} stopColor={color} />);
}

function ClayGlyph({ name }) {
  const id = useId().replace(/:/g, "");
  const shape = SHAPES[name];
  const [mainLight, , mainDark] = shape.main;
  const accentDark = shape.accent[2];
  return (
    <svg className={`nav-glyph3d nav-glyph3d--${name}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-main`} x1="0" y1="0" x2="1" y2="1">{gradientStops(shape.main)}</linearGradient>
        <linearGradient id={`${id}-accent`} x1="0" y1="0" x2="0" y2="1">{gradientStops(shape.accent)}</linearGradient>
        <linearGradient id={`${id}-wave`} x1="0" y1="0" x2="0" y2="1">{gradientStops(WAVE.slice(0, 2))}</linearGradient>
        <linearGradient id={`${id}-light`} x1="0" y1="0" x2="0" y2="1">{gradientStops(["#fffaf4", mainLight])}</linearGradient>
        <radialGradient id={`${id}-shade`} cx="0.8" cy="0.95" r="0.8">
          <stop offset="0" stopColor={mainDark} stopOpacity="0.55" />
          <stop offset="1" stopColor={mainDark} stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-shadow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.9" />
        </filter>
        <filter id={`${id}-soft`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.45" />
        </filter>
      </defs>
      <ellipse cx="12" cy="21.4" rx="7" ry="1.2" fill="#2b2160" opacity="0.3" filter={`url(#${id}-shadow)`} />
      <g transform={shape.transform}>
        {shape.rays &&
          SUN_RAYS.map(([[x1, y1], [x2, y2]], index) => (
            <g key={index} strokeWidth="1.9" strokeLinecap="round">
              <line x1={x1} y1={y1 + 0.8} x2={x2} y2={y2 + 0.8} stroke={accentDark} />
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={`url(#${id}-accent)`} />
            </g>
          ))}
        {paths(shape.back, { fill: accentDark, transform: "translate(0 .9)" })}
        {paths(shape.back, { fill: `url(#${id}-accent)` })}
        {paths(shape.body, { fill: mainDark, transform: "translate(0 1.1)" })}
        {paths(shape.body, { fill: `url(#${id}-main)` })}
        {paths(shape.body, { fill: `url(#${id}-shade)` })}
        {paths(shape.light, { fill: `url(#${id}-light)` })}
        {paths(shape.inner, { fill: mainDark, opacity: shape.innerOpacity ?? 1 })}
        {paths(shape.front, { fill: accentDark, transform: "translate(0 .7)" })}
        {paths(shape.front, { fill: `url(#${id}-accent)` })}
        {shape.lines.map((line, index) => (
          <g key={index}>
            {line.wave && (
              <path d={line.d} fill="none" stroke={WAVE[2]} strokeWidth={line.width} strokeLinecap="round" transform="translate(0 .7)" />
            )}
            <path
              d={line.d}
              fill="none"
              stroke={line.wave ? `url(#${id}-wave)` : "#fff"}
              strokeWidth={line.width}
              strokeLinecap="round"
              strokeDasharray={line.dash}
              opacity={line.opacity ?? 1}
            />
          </g>
        ))}
        <path d={shape.highlight} fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" opacity="0.85" filter={`url(#${id}-soft)`} />
      </g>
    </svg>
  );
}

export const TicketGlyph3D = () => <ClayGlyph name="ticket" />;
export const GlobeGlyph3D = () => <ClayGlyph name="globe" />;
export const MegaphoneGlyph3D = () => <ClayGlyph name="megaphone" />;
export const BellGlyph3D = () => <ClayGlyph name="bell" />;
export const SunGlyph3D = () => <ClayGlyph name="sun" />;
export const MoonGlyph3D = () => <ClayGlyph name="moon" />;
