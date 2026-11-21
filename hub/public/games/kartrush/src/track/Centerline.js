import * as THREE from 'three';
import { wrap01 } from '../core/math.js';
export const LUT_SIZE = 2048;
export class Centerline {
    curve;
    n = LUT_SIZE;
    length;
    px;
    py;
    pz;
    tx;
    ty;
    tz;
    bx;
    bz;
    hw;
    whw;
    minX;
    maxX;
    minZ;
    maxZ;
    minY;
    maxY;
    maxWallHalfWidth;
    maxHalfWidth;
    constructor(def){
        const n = this.n;
        const points = def.controlPoints.map((p)=>new THREE.Vector3(p.x, p.y, p.z));
        this.curve = new THREE.CatmullRomCurve3(points, true, 'centripetal', 0.5);
        this.curve.arcLengthDivisions = 4096;
        this.length = this.curve.getLength();
        this.px = new Float64Array(n);
        this.py = new Float64Array(n);
        this.pz = new Float64Array(n);
        this.tx = new Float64Array(n);
        this.ty = new Float64Array(n);
        this.tz = new Float64Array(n);
        this.bx = new Float64Array(n);
        this.bz = new Float64Array(n);
        this.hw = new Float64Array(n);
        this.whw = new Float64Array(n);
        const cpCount = def.controlPoints.length;
        const hws = def.halfWidths && def.halfWidths.length === cpCount ? def.halfWidths : null;
        const tmp = new THREE.Vector3();
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        let maxHW = 0;
        for(let i = 0; i < n; i++){
            const u = i / n;
            this.curve.getPointAt(u, tmp);
            this.px[i] = tmp.x;
            this.py[i] = tmp.y;
            this.pz[i] = tmp.z;
            if (tmp.x < minX) minX = tmp.x;
            if (tmp.x > maxX) maxX = tmp.x;
            if (tmp.z < minZ) minZ = tmp.z;
            if (tmp.z > maxZ) maxZ = tmp.z;
            if (tmp.y < minY) minY = tmp.y;
            if (tmp.y > maxY) maxY = tmp.y;
            let hw = def.halfWidth;
            if (hws) {
                const tau = this.curve.getUtoTmapping(u, 0);
                const kf = tau * cpCount;
                const k0 = Math.floor(kf) % cpCount;
                const k1 = (k0 + 1) % cpCount;
                let f = kf - Math.floor(kf);
                f = f * f * (3 - 2 * f);
                hw = hws[k0] + (hws[k1] - hws[k0]) * f;
            }
            this.hw[i] = hw;
            this.whw[i] = hw * Math.max(1, def.wallHalfWidthFactor);
            if (hw > maxHW) maxHW = hw;
        }
        const smoothed = new Float64Array(n);
        for(let i = 0; i < n; i++){
            let acc = 0;
            for(let k = -8; k <= 8; k++)acc += this.hw[(i + k + n) % n];
            smoothed[i] = acc / 17;
        }
        for(let i = 0; i < n; i++){
            this.hw[i] = smoothed[i];
            this.whw[i] = smoothed[i] * Math.max(1, def.wallHalfWidthFactor);
        }
        this.maxHalfWidth = maxHW;
        this.maxWallHalfWidth = maxHW * Math.max(1, def.wallHalfWidthFactor);
        this.minX = minX;
        this.maxX = maxX;
        this.minZ = minZ;
        this.maxZ = maxZ;
        this.minY = minY;
        this.maxY = maxY;
        for(let i = 0; i < n; i++){
            const ip = (i + 1) % n;
            const im = (i - 1 + n) % n;
            let dx = this.px[ip] - this.px[im];
            let dy = this.py[ip] - this.py[im];
            let dz = this.pz[ip] - this.pz[im];
            const len = Math.hypot(dx, dy, dz) || 1;
            dx /= len;
            dy /= len;
            dz /= len;
            this.tx[i] = dx;
            this.ty[i] = dy;
            this.tz[i] = dz;
            const h = Math.hypot(dx, dz) || 1;
            this.bx[i] = -dz / h;
            this.bz[i] = dx / h;
        }
    }
    indexOf(t) {
        return wrap01(t) * this.n;
    }
    sOf(t) {
        return wrap01(t) * this.length;
    }
    tOf(s) {
        return wrap01(s / this.length);
    }
    sample(t, out) {
        const tw = wrap01(t);
        const n = this.n;
        const f = tw * n;
        const i0 = Math.floor(f) % n;
        const i1 = (i0 + 1) % n;
        const a = f - Math.floor(f);
        const b = 1 - a;
        out.position.set(this.px[i0] * b + this.px[i1] * a, this.py[i0] * b + this.py[i1] * a, this.pz[i0] * b + this.pz[i1] * a);
        let tx = this.tx[i0] * b + this.tx[i1] * a;
        let ty = this.ty[i0] * b + this.ty[i1] * a;
        let tz = this.tz[i0] * b + this.tz[i1] * a;
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl;
        ty /= tl;
        tz /= tl;
        out.tangent.set(tx, ty, tz);
        const h = Math.hypot(tx, tz) || 1;
        const bx = -tz / h;
        const bz = tx / h;
        out.binormal.set(bx, 0, bz);
        out.normal.set(-bz * ty, bz * tx - bx * tz, bx * ty).normalize();
        out.halfWidth = this.hw[i0] * b + this.hw[i1] * a;
        out.wallHalfWidth = this.whw[i0] * b + this.whw[i1] * a;
        out.t = tw;
        return out;
    }
    dist2(i, x, z) {
        const dx = this.px[i] - x;
        const dz = this.pz[i] - z;
        return dx * dx + dz * dz;
    }
    closestT(x, z, hintT) {
        const n = this.n;
        let best = -1;
        let bestD = Infinity;
        if (hintT !== undefined && Number.isFinite(hintT)) {
            const c = Math.round(wrap01(hintT) * n);
            const W = 48;
            for(let k = -W; k <= W; k++){
                const i = (c + k + n * 4) % n;
                const d = this.dist2(i, x, z);
                if (d < bestD) {
                    bestD = d;
                    best = i;
                }
            }
            const off = ((best - c) % n + n) % n;
            const edge = off === W || off === n - W;
            if (edge) best = -1;
        }
        if (best < 0) {
            bestD = Infinity;
            for(let i = 0; i < n; i += 8){
                const d = this.dist2(i, x, z);
                if (d < bestD) {
                    bestD = d;
                    best = i;
                }
            }
            const c = best;
            for(let k = -8; k <= 8; k++){
                const i = (c + k + n) % n;
                const d = this.dist2(i, x, z);
                if (d < bestD) {
                    bestD = d;
                    best = i;
                }
            }
        }
        const im = (best - 1 + n) % n;
        const ip = (best + 1) % n;
        let bestT = best / n;
        let bestSeg = bestD;
        {
            const ax = this.px[im];
            const az = this.pz[im];
            const abx = this.px[best] - ax;
            const abz = this.pz[best] - az;
            const ab2 = abx * abx + abz * abz;
            if (ab2 > 1e-12) {
                let s = ((x - ax) * abx + (z - az) * abz) / ab2;
                s = s < 0 ? 0 : s > 1 ? 1 : s;
                const qx = ax + abx * s - x;
                const qz = az + abz * s - z;
                const d = qx * qx + qz * qz;
                if (d < bestSeg) {
                    bestSeg = d;
                    bestT = (im + s) / n;
                }
            }
        }
        {
            const ax = this.px[best];
            const az = this.pz[best];
            const abx = this.px[ip] - ax;
            const abz = this.pz[ip] - az;
            const ab2 = abx * abx + abz * abz;
            if (ab2 > 1e-12) {
                let s = ((x - ax) * abx + (z - az) * abz) / ab2;
                s = s < 0 ? 0 : s > 1 ? 1 : s;
                const qx = ax + abx * s - x;
                const qz = az + abz * s - z;
                const d = qx * qx + qz * qz;
                if (d < bestSeg) {
                    bestSeg = d;
                    bestT = (best + s) / n;
                }
            }
        }
        return wrap01(bestT);
    }
}
