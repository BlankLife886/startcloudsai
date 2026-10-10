// Geometry shared by the panorama viewer (shader), picking, hotspot projection and exports.
// Conventions: lon (yaw) and lat (pitch) in degrees; lon 0 looks at the image centre, positive lon turns right,
// positive lat looks up. fov is the vertical field of view of the rectilinear (sphere) view.

export type PanoramaMode = "sphere" | "flat" | "planet";
export type PanoramaView = { lon: number; lat: number; fov: number };

export const DEFAULT_VIEW: PanoramaView = { lon: 0, lat: 0, fov: 75 };
export const FOV_RANGE = { min: 30, max: 100 };
export const PLANET_FOV_RANGE = { min: 180, max: 330 };
export const DEFAULT_PLANET_FOV = 270;

const RAD = Math.PI / 180;

export function clampLat(lat: number) {
    return Math.max(-89, Math.min(89, lat));
}

export function normalizeLon(lon: number) {
    return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** World direction for a lon / lat pair. */
export function directionOf(lon: number, lat: number) {
    const l = lon * RAD;
    const b = lat * RAD;
    return { x: Math.cos(b) * Math.sin(l), y: Math.sin(b), z: -Math.cos(b) * Math.cos(l) };
}

export function lonLatOf(direction: { x: number; y: number; z: number }) {
    const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
    return { lon: normalizeLon(Math.atan2(direction.x, -direction.z) / RAD), lat: Math.asin(Math.max(-1, Math.min(1, direction.y / length))) / RAD };
}

/** Screen point (pixels) → the lon / lat under it, in the rectilinear sphere view. */
export function pickLonLat(view: PanoramaView, x: number, y: number, width: number, height: number) {
    const aspect = width / height;
    const px = ((x / width) * 2 - 1) * aspect;
    const py = 1 - (y / height) * 2;
    const f = 1 / Math.tan((view.fov * RAD) / 2);
    let rx = px;
    let ry = py;
    let rz = -f;
    // pitch, then yaw (the shader applies the same rotations)
    const a = view.lat * RAD;
    [ry, rz] = [ry * Math.cos(a) - rz * Math.sin(a), ry * Math.sin(a) + rz * Math.cos(a)];
    const l = view.lon * RAD;
    [rx, rz] = [rx * Math.cos(l) - rz * Math.sin(l), rx * Math.sin(l) + rz * Math.cos(l)];
    return lonLatOf({ x: rx, y: ry, z: rz });
}

/** lon / lat → screen point (pixels) in the sphere view, or null when it is behind the camera. */
export function projectLonLat(view: PanoramaView, lon: number, lat: number, width: number, height: number) {
    const d = directionOf(lon, lat);
    const l = view.lon * RAD;
    const x1 = d.x * Math.cos(l) + d.z * Math.sin(l);
    const z1 = -d.x * Math.sin(l) + d.z * Math.cos(l);
    const a = view.lat * RAD;
    const y2 = d.y * Math.cos(a) + z1 * Math.sin(a);
    const z2 = -d.y * Math.sin(a) + z1 * Math.cos(a);
    if (z2 >= -0.02) return null;
    const f = 1 / Math.tan((view.fov * RAD) / 2);
    const aspect = width / height;
    const px = (x1 * f) / -z2;
    const py = (y2 * f) / -z2;
    return { x: ((px / aspect + 1) / 2) * width, y: ((1 - py) / 2) * height };
}

/** Horizontal field of view for a vertical fov and an aspect ratio. */
export function horizontalFov(fov: number, aspect: number) {
    return (2 * Math.atan(Math.tan((fov * RAD) / 2) * aspect)) / RAD;
}

/** The shots "split into directions" produces: four around the horizon, optionally up and down. */
export function directionShots(withVertical = false) {
    const around = [
        { name: "前", lon: 0, lat: 0 },
        { name: "右", lon: 90, lat: 0 },
        { name: "后", lon: 180, lat: 0 },
        { name: "左", lon: -90, lat: 0 },
    ];
    return withVertical ? [...around, { name: "上", lon: 0, lat: 89 }, { name: "下", lon: 0, lat: -89 }] : around;
}

/** Shifts an equirectangular image by half a turn (used to bring the left/right seam to the middle and back). */
export function rollHalf(source: CanvasImageSource & { width: number; height: number }) {
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext("2d")!;
    const half = Math.round(source.width / 2);
    context.drawImage(source, half, 0, source.width - half, source.height, 0, 0, source.width - half, source.height);
    context.drawImage(source, 0, 0, half, source.height, source.width - half, 0, half, source.height);
    return canvas;
}

/** Whether an image looks like an equirectangular panorama (about 2:1). */
export function isPanoramaShaped(width?: number, height?: number) {
    if (!width || !height) return false;
    const ratio = width / height;
    return ratio > 1.8 && ratio < 2.2;
}
