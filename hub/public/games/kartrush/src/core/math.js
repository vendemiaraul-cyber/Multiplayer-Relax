export const TAU = Math.PI * 2;
export function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
}
export function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}
export function lerp(a, b, t) {
    return a + (b - a) * t;
}
export function inverseLerp(a, b, v) {
    return a === b ? 0 : clamp01((v - a) / (b - a));
}
export function remap(v, inMin, inMax, outMin, outMax) {
    return lerp(outMin, outMax, inverseLerp(inMin, inMax, v));
}
export function smoothstep(edge0, edge1, x) {
    const t = clamp01((x - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
}
export function damp(current, target, lambda, dt) {
    return lerp(current, target, 1 - Math.exp(-lambda * dt));
}
export function wrapAngle(a) {
    a = a % TAU;
    if (a > Math.PI) a -= TAU;
    if (a < -Math.PI) a += TAU;
    return a;
}
export function angleDelta(a, b) {
    return wrapAngle(b - a);
}
export function wrap01(t) {
    t = t % 1;
    return t < 0 ? t + 1 : t;
}
export function trackDelta(a, b) {
    let d = wrap01(b) - wrap01(a);
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    return d;
}
export function randRange(min, max) {
    return min + Math.random() * (max - min);
}
export function randInt(min, maxInclusive) {
    return Math.floor(randRange(min, maxInclusive + 1));
}
export function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
export function seededRandom(seed) {
    let s = seed >>> 0;
    return ()=>{
        s = s + 0x6d2b79f5 >>> 0;
        let t = s;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
export function hash2(x, y) {
    let h = Math.imul(Math.floor(x) | 0, 374761393) + Math.imul(Math.floor(y) | 0, 668265263);
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
}
export function valueNoise2(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi);
    const b = hash2(xi + 1, yi);
    const c = hash2(xi, yi + 1);
    const d = hash2(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for(let i = 0; i < octaves; i++){
        sum += valueNoise2(x * freq, y * freq) * amp;
        norm += amp;
        amp *= gain;
        freq *= lacunarity;
    }
    return sum / norm;
}
export function formatRaceTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor(seconds * 1000 % 1000);
    return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}
export function ordinal(n) {
    const s = [
        'th',
        'st',
        'nd',
        'rd'
    ];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
