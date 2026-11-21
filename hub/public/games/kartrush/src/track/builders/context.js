import * as THREE from 'three';
export function track(ctx, ...items) {
    for (const it of items)ctx.disposables.push(it);
    return items[0];
}
export function trackMesh(ctx, mesh) {
    ctx.disposables.push(mesh.geometry);
    const m = mesh.material;
    if (Array.isArray(m)) ctx.disposables.push(...m);
    else ctx.disposables.push(m);
}
export function color(hex, dl = 0, ds = 0) {
    const c = new THREE.Color(hex);
    if (dl !== 0 || ds !== 0) {
        const hsl = {
            h: 0,
            s: 0,
            l: 0
        };
        c.getHSL(hsl);
        c.setHSL(hsl.h, THREE.MathUtils.clamp(hsl.s + ds, 0, 1), THREE.MathUtils.clamp(hsl.l + dl, 0, 1));
    }
    return c;
}
export function indexAtS(cl, s) {
    const n = cl.n;
    const i = Math.round(s / cl.length * n);
    return (i % n + n) % n;
}
export function headingFromDir(dx, dz) {
    return Math.atan2(-dx, -dz);
}
export function paintGeometry(geo, c) {
    const count = geo.getAttribute('position').count;
    const arr = new Float32Array(count * 3);
    for(let i = 0; i < count; i++){
        arr[i * 3] = c.r;
        arr[i * 3 + 1] = c.g;
        arr[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
}
export function normalizeForMerge(geo) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    const count = g.getAttribute('position').count;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    if (!g.getAttribute('color')) paintGeometry(g, new THREE.Color(1, 1, 1));
    return g;
}
