import { useEffect, useRef } from "react";
import "@react/legacy-styles/generated/features/game-art/WireframeTerrainBackground.css";

const lerp = (from, to, progress) => from + (to - from) * progress;
const gaussian = (value, center, spread) => {
  const distance = (value - center) / spread;
  return Math.exp(-(distance * distance));
};

function drawLines(context, lines, strokeStyle, lineWidth) {
  context.beginPath();
  lines.forEach((points) => {
    if (points.length < 2) return;
    context.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  });
  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  context.stroke();
}

function drawRoom(context, width, height, strokeStyle) {
  const back = { left: width * 0.135, right: width * 0.865, top: height * 0.076, bottom: height * 0.846 };
  const lines = [];
  for (let column = 0; column <= 24; column += 1) {
    const progress = column / 24;
    const x = lerp(back.left, back.right, progress);
    lines.push([{ x, y: back.top }, { x, y: back.bottom }]);
  }
  for (let row = 0; row <= 23; row += 1) {
    const progress = row / 23;
    const y = lerp(back.top, back.bottom, progress);
    lines.push([{ x: back.left, y }, { x: back.right, y }]);
  }
  for (let depth = 0; depth <= 11; depth += 1) {
    const progress = Math.pow(depth / 11, 0.88);
    const left = lerp(0, back.left, progress);
    const right = lerp(width, back.right, progress);
    const top = lerp(0, back.top, progress);
    const bottom = lerp(height, back.bottom, progress);
    lines.push([{ x: left, y: top }, { x: left, y: bottom }], [{ x: right, y: top }, { x: right, y: bottom }], [{ x: left, y: top }, { x: right, y: top }], [{ x: left, y: bottom }, { x: right, y: bottom }]);
  }
  for (let row = 0; row <= 20; row += 1) {
    const progress = row / 20;
    const outerY = height * progress;
    const backY = lerp(back.top, back.bottom, progress);
    lines.push([{ x: 0, y: outerY }, { x: back.left, y: backY }], [{ x: back.right, y: backY }, { x: width, y: outerY }]);
  }
  for (let column = 0; column <= 24; column += 1) {
    const progress = column / 24;
    const outerX = width * progress;
    const backX = lerp(back.left, back.right, progress);
    lines.push([{ x: outerX, y: 0 }, { x: backX, y: back.top }], [{ x: backX, y: back.bottom }, { x: outerX, y: height }]);
  }
  drawLines(context, lines, strokeStyle, Math.max(0.55, height / 1900));
}

function topPoint(u, v, width, height) {
  const x = lerp(0.11, 1.075, u);
  const entrance = Math.max(0, (0.3 - x) / 0.19);
  const base = -0.055 + v * 0.115 - Math.pow(entrance, 1.45) * 0.17;
  const folds = 0.068 * gaussian(x, 0.39, 0.085) * gaussian(v, 0.56, 0.62) + 0.105 * gaussian(x, 0.585, 0.14) * gaussian(v, 0.38, 0.68) + 0.215 * gaussian(x, 0.83, 0.125) * gaussian(v, 0.69, 0.65) + 0.11 * gaussian(x, 1.035, 0.11) * gaussian(v, 0.34, 0.72);
  const ripples = 0.009 * Math.sin(x * 35 + v * 4.2) * gaussian(x, 0.68, 0.42) + 0.006 * Math.sin(x * 19 - v * 7.5) * gaussian(x, 0.9, 0.3);
  return { x: x * width, y: (base + folds + ripples) * height };
}

function bottomPoint(u, v, width, height) {
  const x = lerp(-0.075, 1.04, u);
  const exit = Math.max(0, (x - 0.59) / 0.38);
  const base = 1.065 - v * 0.105 + Math.pow(exit, 1.55) * 0.3;
  const folds = 0.205 * gaussian(x, 0.13, 0.12) * gaussian(v, 0.56, 0.72) + 0.118 * gaussian(x, 0.31, 0.16) * gaussian(v, 0.4, 0.72) + 0.082 * gaussian(x, 0.61, 0.12) * gaussian(v, 0.7, 0.66);
  const ripples = 0.012 * Math.sin(x * 31 - v * 5.4) * gaussian(x, 0.22, 0.34) + 0.007 * Math.sin(x * 20 + v * 8) * gaussian(x, 0.57, 0.25);
  return { x: x * width, y: (base - folds - ripples) * height };
}

function drawTerrain(context, width, height, pointAt, palette) {
  const columns = 43;
  const rows = 20;
  const horizontal = [];
  const vertical = [];
  const nodes = [];
  for (let row = 0; row <= rows; row += 1) {
    const points = [];
    for (let column = 0; column <= columns; column += 1) {
      const point = pointAt(column / columns, row / rows, width, height);
      points.push(point);
      nodes.push(point);
    }
    horizontal.push(points);
  }
  for (let column = 0; column <= columns; column += 1) {
    const points = [];
    for (let row = 0; row <= rows; row += 1) points.push(pointAt(column / columns, row / rows, width, height));
    vertical.push(points);
  }
  drawLines(context, horizontal, palette.terrain, Math.max(0.65, Math.min(width, height) / 1450));
  drawLines(context, vertical, palette.terrain, Math.max(0.65, Math.min(width, height) / 1450));
  context.fillStyle = palette.nodes;
  const radius = Math.max(0.7, Math.min(width, height) / 1050);
  nodes.forEach((point) => {
    if (point.x < -2 || point.x > width + 2 || point.y < -2 || point.y > height + 2) return;
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
  });
}

export function WireframeTerrainBackground({ light = false, className = "" }) {
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return undefined;
    const draw = () => {
      const { width, height } = host.getBoundingClientRect();
      if (width < 2 || height < 2) return;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d");
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const palette = light
        ? { background: "#e8eff2", room: "rgb(72 97 112 / 0.12)", terrain: "rgb(64 91 107 / 0.25)", nodes: "rgb(55 79 93 / 0.32)" }
        : { background: "#07121b", room: "rgb(77 111 132 / 0.2)", terrain: "rgb(106 137 157 / 0.34)", nodes: "rgb(150 189 211 / 0.5)" };
      context.fillStyle = palette.background;
      context.fillRect(0, 0, width, height);
      context.lineJoin = "round";
      context.lineCap = "round";
      drawRoom(context, width, height, palette.room);
      drawTerrain(context, width, height, topPoint, palette);
      drawTerrain(context, width, height, bottomPoint, palette);
    };
    const observer = new ResizeObserver(draw);
    observer.observe(host);
    draw();
    return () => observer.disconnect();
  }, [light]);
  return <div ref={hostRef} className={`wireframe-terrain${light ? " is-light" : ""}${className ? ` ${className}` : ""}`} aria-hidden="true"><canvas ref={canvasRef} /><span className="wireframe-terrain__vignette" /></div>;
}
