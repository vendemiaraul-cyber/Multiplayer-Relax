import { fbm2, smoothstep, lerp, trackDelta } from '../core/math.js';
export const TERRAIN_EXTENT = 1600;
const CELL = 2.5;
const INFLUENCE_RADIUS = 96;
export const TERRAIN_ROAD_DROP = 0.25;
export const VOID_BASIN_DEPTH = 42;
const THEME_PARAMS = {
    grassland: {
        hills: 16,
        detail: 3.5,
        bumps: 0.5,
        rim: 70,
        base: -1.5
    },
    desert: {
        hills: 20,
        detail: 5,
        bumps: 0.6,
        rim: 90,
        base: -1
    },
    snow: {
        hills: 26,
        detail: 5,
        bumps: 0.6,
        rim: 120,
        base: -1
    },
    beach: {
        hills: 10,
        detail: 2.5,
        bumps: 0.4,
        rim: 50,
        base: -1
    },
    volcano: {
        hills: 30,
        detail: 6,
        bumps: 0.8,
        rim: 120,
        base: -1
    },
    neon: {
        hills: 3,
        detail: 0.8,
        bumps: 0.15,
        rim: 20,
        base: -0.6
    }
};
export class TerrainField {
    extent = TERRAIN_EXTENT;
    centerX;
    centerZ;
    minX;
    minZ;
    cells;
    dist;
    roadY;
    voidW;
    params;
    flatRadius;
    seed;
    hasVoid;
    fDist = 0;
    fRoadY = 0;
    fVoid = 0;
    constructor(def, cl){
        this.params = THEME_PARAMS[def.theme] ?? THEME_PARAMS.grassland;
        this.centerX = (cl.minX + cl.maxX) * 0.5;
        this.centerZ = (cl.minZ + cl.maxZ) * 0.5;
        this.minX = this.centerX - this.extent * 0.5;
        this.minZ = this.centerZ - this.extent * 0.5;
        this.cells = Math.ceil(this.extent / CELL) + 1;
        const total = this.cells * this.cells;
        this.dist = new Float32Array(total).fill(INFLUENCE_RADIUS);
        this.roadY = new Float32Array(total);
        this.voidW = new Float32Array(total);
        this.flatRadius = cl.maxWallHalfWidth + 6;
        this.seed = hashString(def.id);
        const voids = def.voidRanges ?? [];
        this.hasVoid = voids.length > 0;
        const step = 2;
        const voidOf = (t)=>{
            let vw = 0;
            for (const [a, b] of voids){
                const inA = smoothstep(-0.03, 0, trackDelta(a, t));
                const inB = smoothstep(-0.03, 0, trackDelta(t, b));
                vw = Math.max(vw, Math.min(inA, inB));
            }
            return vw;
        };
        this.forEachCellNear(cl, step, INFLUENCE_RADIUS, (idx, d, i)=>{
            if (d < this.dist[idx]) {
                this.dist[idx] = d;
                this.roadY[idx] = cl.py[i];
                this.voidW[idx] = voidOf(i / cl.n);
            }
        });
        const minY = new Float32Array(total).fill(Infinity);
        this.forEachCellNear(cl, step, this.flatRadius + 30, (idx, d, i)=>{
            if (d <= this.dist[idx] + 2.5 && cl.py[i] < minY[idx]) minY[idx] = cl.py[i];
        });
        for(let i = 0; i < total; i++)if (minY[i] < Infinity) this.roadY[i] = minY[i];
    }
    forEachCellNear(cl, step, radius, fn) {
        const rCells = Math.ceil(radius / CELL);
        for(let i = 0; i < cl.n; i += step){
            const x = cl.px[i];
            const z = cl.pz[i];
            const cx = Math.round((x - this.minX) / CELL);
            const cz = Math.round((z - this.minZ) / CELL);
            const x0 = Math.max(0, cx - rCells);
            const x1 = Math.min(this.cells - 1, cx + rCells);
            const z0 = Math.max(0, cz - rCells);
            const z1 = Math.min(this.cells - 1, cz + rCells);
            for(let gz = z0; gz <= z1; gz++){
                const dz = this.minZ + gz * CELL - z;
                const row = gz * this.cells;
                for(let gx = x0; gx <= x1; gx++){
                    const dx = this.minX + gx * CELL - x;
                    const d = Math.sqrt(dx * dx + dz * dz);
                    if (d <= radius) fn(row + gx, d, i);
                }
            }
        }
    }
    sampleField(x, z) {
        const fx = (x - this.minX) / CELL;
        const fz = (z - this.minZ) / CELL;
        const c = this.cells;
        if (fx < 0 || fz < 0 || fx >= c - 1 || fz >= c - 1) {
            this.fDist = INFLUENCE_RADIUS;
            this.fRoadY = 0;
            this.fVoid = 0;
            return;
        }
        const x0 = Math.floor(fx);
        const z0 = Math.floor(fz);
        const ax = fx - x0;
        const az = fz - z0;
        const i00 = z0 * c + x0;
        const i10 = i00 + 1;
        const i01 = i00 + c;
        const i11 = i01 + 1;
        const w00 = (1 - ax) * (1 - az);
        const w10 = ax * (1 - az);
        const w01 = (1 - ax) * az;
        const w11 = ax * az;
        this.fDist = this.dist[i00] * w00 + this.dist[i10] * w10 + this.dist[i01] * w01 + this.dist[i11] * w11;
        this.fRoadY = this.roadY[i00] * w00 + this.roadY[i10] * w10 + this.roadY[i01] * w01 + this.roadY[i11] * w11;
        this.fVoid = this.voidW[i00] * w00 + this.voidW[i10] * w10 + this.voidW[i01] * w01 + this.voidW[i11] * w11;
    }
    distanceToTrack(x, z) {
        this.sampleField(x, z);
        return this.fDist;
    }
    rawTerrain(x, z) {
        const p = this.params;
        const sx = x + this.seed * 0.37;
        const sz = z - this.seed * 0.53;
        const broad = (fbm2(sx * 0.0035 + 7.1, sz * 0.0035 + 3.3, 3) - 0.5) * p.hills;
        const detail = (fbm2(sx * 0.02 + 1.7, sz * 0.02 + 9.2, 3) - 0.5) * p.detail;
        const bumps = (fbm2(sx * 0.11, sz * 0.11, 2) - 0.5) * p.bumps;
        const rx = x - this.centerX;
        const rz = z - this.centerZ;
        const r = Math.sqrt(rx * rx + rz * rz);
        const rim = smoothstep(430, 780, r) * p.rim * (0.6 + 0.4 * fbm2(sx * 0.01, sz * 0.01, 2));
        return p.base + broad + detail + bumps + rim;
    }
    heightAt(x, z) {
        this.sampleField(x, z);
        const d = this.fDist;
        const roadY = this.fRoadY - TERRAIN_ROAD_DROP;
        const raw = this.rawTerrain(x, z);
        let h;
        if (d >= this.flatRadius + 26) {
            h = raw;
        } else {
            const k = smoothstep(this.flatRadius, this.flatRadius + 26, d);
            h = lerp(roadY, raw, k);
        }
        if (this.hasVoid && this.fVoid > 0.001) {
            const wall = this.flatRadius - 6;
            const drop = smoothstep(wall - 1.5, wall + 9, d);
            const basin = lerp(roadY, roadY - VOID_BASIN_DEPTH, drop);
            const back = smoothstep(95, 150, d);
            const hv = lerp(basin, raw, back);
            h = lerp(h, hv, this.fVoid);
        }
        return h;
    }
}
function hashString(s) {
    let h = 2166136261;
    for(let i = 0; i < s.length; i++){
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 100000;
}
