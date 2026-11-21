import * as THREE from 'three';
import { events } from '../core/events.js';
import { BASE_TOP_SPEED, GRAVITY, KART_COUNT } from '../core/constants.js';
import { clamp01, TAU } from '../core/math.js';
import { PARTICLE_FRAGMENT, PARTICLE_VERTEX } from './shaders.js';
const ATLAS_CIRCLE = 0;
const ATLAS_STREAK = 1;
const ATLAS_SMOKE = 2;
const ATLAS_STAR = 3;
const ATLAS_SQUARE = 4;
const ATLAS_RING = 5;
const ATLAS_BOLT = 6;
const ATLAS_HEX = 7;
const ATLAS_FLAME = 8;
const ATLAS_SHARD = 9;
const ATLAS_DOT = 10;
const ADDITIVE_CAPACITY = 6144;
const ALPHA_CAPACITY = 4096;
const MAX_KARTS = Math.max(KART_COUNT, 16);
const MAX_PER_EMITTER_PER_FRAME = 14;
const S = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 1,
    size0: 0.3,
    size1: 0.1,
    r0: 1,
    g0: 1,
    b0: 1,
    r1: 1,
    g1: 1,
    b1: 1,
    a0: 1,
    a1: 0,
    rot: 0,
    rotSpeed: 0,
    gravity: 0,
    atlas: 0,
    align: 0,
    drag: 0
};
function rnd(min, max) {
    return min + Math.random() * (max - min);
}
function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const colorCache = new Map();
function rgb(hex) {
    let c = colorCache.get(hex);
    if (!c) {
        c = {
            r: srgbToLinear((hex >> 16 & 255) / 255),
            g: srgbToLinear((hex >> 8 & 255) / 255),
            b: srgbToLinear((hex & 255) / 255)
        };
        colorCache.set(hex, c);
    }
    return c;
}
const scratchHsl = {
    r: 0,
    g: 0,
    b: 0
};
function hueChannel(p, q, t) {
    t = t - Math.floor(t);
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
}
function hslToRgb(h, s, l, out = scratchHsl) {
    h = h - Math.floor(h);
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    out.r = hueChannel(p, q, h + 1 / 3);
    out.g = hueChannel(p, q, h);
    out.b = hueChannel(p, q, h - 1 / 3);
    return out;
}
function setColor0(c, mul = 1) {
    S.r0 = c.r * mul;
    S.g0 = c.g * mul;
    S.b0 = c.b * mul;
}
function setColor1(c, mul = 1) {
    S.r1 = c.r * mul;
    S.g1 = c.g * mul;
    S.b1 = c.b * mul;
}
function setColors(hex0, hex1, mul0 = 1, mul1 = mul0) {
    setColor0(rgb(hex0), mul0);
    setColor1(rgb(hex1), mul1);
}
function randomSphereVelocity(speed, upBias = 0) {
    const z = Math.random() * 2 - 1;
    const a = Math.random() * TAU;
    const rxy = Math.sqrt(Math.max(0, 1 - z * z));
    S.vx = rxy * Math.cos(a) * speed;
    S.vy = z * speed + upBias;
    S.vz = rxy * Math.sin(a) * speed;
}
function jitterPosition(cx, cy, cz, radius) {
    S.x = cx + rnd(-radius, radius);
    S.y = cy + rnd(-radius, radius);
    S.z = cz + rnd(-radius, radius);
}
function buildAtlas() {
    const size = 512;
    const cell = size / 4;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('ParticleSystem: 2D canvas unavailable');
    ctx.clearRect(0, 0, size, size);
    const withCell = (index, draw)=>{
        const cx = index % 4 * cell + cell / 2;
        const cy = Math.floor(index / 4) * cell + cell / 2;
        ctx.save();
        ctx.translate(cx, cy);
        draw(ctx, cell / 2);
        ctx.restore();
    };
    const softRadial = (c, radius, inner = 0, power = 1)=>{
        const g = c.createRadialGradient(0, 0, 0, 0, 0, radius);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(Math.max(0.01, inner), `rgba(255,255,255,${power >= 1 ? 1 : 0.9})`);
        g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
        g.addColorStop(0.85, 'rgba(255,255,255,0.08)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.fillRect(-radius, -radius, radius * 2, radius * 2);
    };
    withCell(ATLAS_CIRCLE, (c, h)=>softRadial(c, h * 0.92, 0.15));
    withCell(ATLAS_STREAK, (c, h)=>{
        c.scale(1, 0.22);
        softRadial(c, h * 0.95, 0.1);
    });
    withCell(ATLAS_SMOKE, (c, h)=>{
        const blobs = 9;
        for(let i = 0; i < blobs; i++){
            const a = i / blobs * TAU + 0.4;
            const d = i === 0 ? 0 : h * 0.28;
            const x = Math.cos(a) * d;
            const y = Math.sin(a) * d;
            const rr = h * (i === 0 ? 0.55 : 0.42);
            const g = c.createRadialGradient(x, y, 0, x, y, rr);
            g.addColorStop(0, 'rgba(255,255,255,0.55)');
            g.addColorStop(0.6, 'rgba(255,255,255,0.22)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            c.fillStyle = g;
            c.fillRect(-h, -h, h * 2, h * 2);
        }
    });
    withCell(ATLAS_STAR, (c, h)=>{
        softRadial(c, h * 0.55, 0.05);
        c.globalAlpha = 1;
        c.fillStyle = '#fff';
        c.beginPath();
        const outer = h * 0.9;
        const inner = h * 0.18;
        for(let i = 0; i < 8; i++){
            const rr = i % 2 === 0 ? outer : inner;
            const a = i / 8 * TAU - Math.PI / 2;
            const x = Math.cos(a) * rr;
            const y = Math.sin(a) * rr;
            if (i === 0) c.moveTo(x, y);
            else c.lineTo(x, y);
        }
        c.closePath();
        c.fill();
    });
    withCell(ATLAS_SQUARE, (c, h)=>{
        const s = h * 0.72;
        const g = c.createLinearGradient(-s, -s, s, s);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(200,200,200,1)');
        c.fillStyle = g;
        c.fillRect(-s, -s * 0.7, s * 2, s * 1.4);
    });
    withCell(ATLAS_RING, (c, h)=>{
        const g = c.createRadialGradient(0, 0, 0, 0, 0, h * 0.95);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.62, 'rgba(255,255,255,0)');
        g.addColorStop(0.78, 'rgba(255,255,255,1)');
        g.addColorStop(0.9, 'rgba(255,255,255,0.5)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.fillRect(-h, -h, h * 2, h * 2);
    });
    withCell(ATLAS_BOLT, (c, h)=>{
        c.lineCap = 'round';
        c.lineJoin = 'round';
        const pts = [
            [
                -h * 0.05,
                -h * 0.95
            ],
            [
                h * 0.25,
                -h * 0.45
            ],
            [
                -h * 0.15,
                -h * 0.25
            ],
            [
                h * 0.3,
                h * 0.15
            ],
            [
                -h * 0.1,
                h * 0.3
            ],
            [
                h * 0.12,
                h * 0.95
            ]
        ];
        const stroke = (w, alpha)=>{
            c.strokeStyle = `rgba(255,255,255,${alpha})`;
            c.lineWidth = w;
            c.beginPath();
            c.moveTo(pts[0][0], pts[0][1]);
            for(let i = 1; i < pts.length; i++)c.lineTo(pts[i][0], pts[i][1]);
            c.stroke();
        };
        stroke(h * 0.55, 0.12);
        stroke(h * 0.3, 0.3);
        stroke(h * 0.12, 1);
    });
    withCell(ATLAS_HEX, (c, h)=>{
        c.fillStyle = '#fff';
        c.beginPath();
        for(let i = 0; i < 6; i++){
            const a = i / 6 * TAU;
            const x = Math.cos(a) * h * 0.8;
            const y = Math.sin(a) * h * 0.8;
            if (i === 0) c.moveTo(x, y);
            else c.lineTo(x, y);
        }
        c.closePath();
        c.fill();
    });
    withCell(ATLAS_FLAME, (c, h)=>{
        const g = c.createRadialGradient(0, h * 0.25, 0, 0, h * 0.2, h * 0.75);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(0, -h * 0.95);
        c.bezierCurveTo(h * 0.75, -h * 0.1, h * 0.75, h * 0.6, 0, h * 0.85);
        c.bezierCurveTo(-h * 0.75, h * 0.6, -h * 0.75, -h * 0.1, 0, -h * 0.95);
        c.closePath();
        c.fill();
    });
    withCell(ATLAS_SHARD, (c, h)=>{
        const g = c.createLinearGradient(-h, 0, h, 0);
        g.addColorStop(0, 'rgba(255,255,255,0.7)');
        g.addColorStop(0.5, 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,0.7)');
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(-h * 0.9, 0);
        c.lineTo(-h * 0.1, -h * 0.32);
        c.lineTo(h * 0.9, 0);
        c.lineTo(-h * 0.1, h * 0.32);
        c.closePath();
        c.fill();
    });
    withCell(ATLAS_DOT, (c, h)=>{
        const g = c.createRadialGradient(0, 0, 0, 0, 0, h * 0.8);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.75, 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.fillRect(-h, -h, h * 2, h * 2);
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
}
class ParticleGroup {
    points;
    material;
    geometry;
    capacity;
    head = 0;
    runStart = 0;
    runLength = 0;
    position;
    velocity;
    time;
    size;
    color0;
    color1;
    alpha;
    rot;
    misc;
    attributes;
    supportsRanges;
    drawSize = new THREE.Vector2();
    constructor(capacity, additive, atlas, renderOrder){
        this.capacity = capacity;
        this.position = new Float32Array(capacity * 3);
        this.velocity = new Float32Array(capacity * 3);
        this.time = new Float32Array(capacity * 2);
        this.size = new Float32Array(capacity * 2);
        this.color0 = new Float32Array(capacity * 3);
        this.color1 = new Float32Array(capacity * 3);
        this.alpha = new Float32Array(capacity * 2);
        this.rot = new Float32Array(capacity * 2);
        this.misc = new Float32Array(capacity * 4);
        for(let i = 0; i < capacity; i++){
            this.time[i * 2] = -1e6;
            this.time[i * 2 + 1] = 0.001;
        }
        const geometry = new THREE.BufferGeometry();
        const make = (arr, itemSize)=>{
            const attr = new THREE.BufferAttribute(arr, itemSize);
            attr.setUsage(THREE.DynamicDrawUsage);
            return attr;
        };
        const attrs = {
            position: make(this.position, 3),
            aVelocity: make(this.velocity, 3),
            aTime: make(this.time, 2),
            aSize: make(this.size, 2),
            aColor0: make(this.color0, 3),
            aColor1: make(this.color1, 3),
            aAlpha: make(this.alpha, 2),
            aRot: make(this.rot, 2),
            aMisc: make(this.misc, 4)
        };
        for (const [name, attr] of Object.entries(attrs))geometry.setAttribute(name, attr);
        this.attributes = Object.values(attrs);
        this.supportsRanges = typeof attrs.position.addUpdateRange === 'function';
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
        this.geometry = geometry;
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: {
                    value: 0
                },
                uGravity: {
                    value: GRAVITY
                },
                uHeightPx: {
                    value: 1080
                },
                uAspect: {
                    value: 16 / 9
                },
                uAtlas: {
                    value: atlas
                }
            },
            vertexShader: PARTICLE_VERTEX,
            fragmentShader: PARTICLE_FRAGMENT,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
            fog: false
        });
        const points = new THREE.Points(geometry, this.material);
        points.frustumCulled = false;
        points.renderOrder = renderOrder;
        points.matrixAutoUpdate = false;
        points.name = additive ? 'ParticlesAdditive' : 'ParticlesAlpha';
        points.onBeforeRender = (renderer)=>{
            renderer.getDrawingBufferSize(this.drawSize);
            this.material.uniforms.uHeightPx.value = this.drawSize.y;
            this.material.uniforms.uAspect.value = this.drawSize.x / Math.max(1, this.drawSize.y);
        };
        this.points = points;
    }
    setTime(t) {
        this.material.uniforms.uTime.value = t;
    }
    spawn(p, now) {
        const i = this.head;
        const i2 = i * 2;
        const i3 = i * 3;
        const i4 = i * 4;
        this.position[i3] = p.x;
        this.position[i3 + 1] = p.y;
        this.position[i3 + 2] = p.z;
        this.velocity[i3] = p.vx;
        this.velocity[i3 + 1] = p.vy;
        this.velocity[i3 + 2] = p.vz;
        this.time[i2] = now;
        this.time[i2 + 1] = Math.max(0.01, p.life);
        this.size[i2] = p.size0;
        this.size[i2 + 1] = p.size1;
        this.color0[i3] = p.r0;
        this.color0[i3 + 1] = p.g0;
        this.color0[i3 + 2] = p.b0;
        this.color1[i3] = p.r1;
        this.color1[i3 + 1] = p.g1;
        this.color1[i3 + 2] = p.b1;
        this.alpha[i2] = p.a0;
        this.alpha[i2 + 1] = p.a1;
        this.rot[i2] = p.rot;
        this.rot[i2 + 1] = p.rotSpeed;
        this.misc[i4] = p.gravity;
        this.misc[i4 + 1] = p.atlas;
        this.misc[i4 + 2] = p.align;
        this.misc[i4 + 3] = p.drag;
        if (this.runLength === 0) this.runStart = i;
        if (this.runLength < this.capacity) this.runLength++;
        this.head = i + 1 >= this.capacity ? 0 : i + 1;
    }
    flush() {
        if (this.runLength === 0) return;
        const full = !this.supportsRanges || this.runLength >= this.capacity;
        for (const attr of this.attributes){
            if (!full) {
                const n = attr.itemSize;
                const end = this.runStart + this.runLength;
                if (end <= this.capacity) {
                    attr.addUpdateRange(this.runStart * n, this.runLength * n);
                } else {
                    attr.addUpdateRange(this.runStart * n, (this.capacity - this.runStart) * n);
                    attr.addUpdateRange(0, (end - this.capacity) * n);
                }
            }
            attr.needsUpdate = true;
        }
        this.runLength = 0;
    }
    clear() {
        for(let i = 0; i < this.capacity; i++){
            this.time[i * 2] = -1e6;
            this.time[i * 2 + 1] = 0.001;
        }
        this.head = 0;
        this.runStart = 0;
        this.runLength = this.capacity;
    }
    dispose() {
        this.geometry.dispose();
        this.material.dispose();
    }
}
const BOOST_SOURCE_NONE = 0;
const BOOST_SOURCE_DRIFT = 1;
const BOOST_SOURCE_MUSHROOM = 2;
const BOOST_SOURCE_PAD = 3;
function boostSourceCode(source) {
    switch(source){
        case 'mushroom':
        case 'golden':
            return BOOST_SOURCE_MUSHROOM;
        case 'pad':
        case 'start':
            return BOOST_SOURCE_PAD;
        default:
            return BOOST_SOURCE_DRIFT;
    }
}
const CONFETTI_COLORS = [
    0xff4b4b,
    0xffd23f,
    0x3ddc84,
    0x3ec6ff,
    0xff5ce1,
    0x8f7bff,
    0xffffff,
    0xff9a2e
];
const DRIFT_STAGE_COLORS = [
    0xffffff,
    0x3ec6ff,
    0xff9a2e,
    0xd64dff
];
export class ParticleSystem {
    object;
    atlas;
    additive;
    alpha;
    time = 0;
    karts = [];
    unsubs = [];
    accDrift = new Float32Array(MAX_KARTS);
    accFlame = new Float32Array(MAX_KARTS);
    accSmoke = new Float32Array(MAX_KARTS);
    accDust = new Float32Array(MAX_KARTS);
    accStar = new Float32Array(MAX_KARTS);
    accStreak = 0;
    boostSource = new Uint8Array(MAX_KARTS);
    confettiTimer = 0;
    confettiScale = 1;
    accConfetti = 0;
    playerPodiumPlace = 0;
    camPos = new THREE.Vector3();
    camFwd = new THREE.Vector3();
    camRight = new THREE.Vector3();
    camUp = new THREE.Vector3();
    tmp = new THREE.Vector3();
    constructor(){
        this.atlas = buildAtlas();
        this.additive = new ParticleGroup(ADDITIVE_CAPACITY, true, this.atlas, 20);
        this.alpha = new ParticleGroup(ALPHA_CAPACITY, false, this.atlas, 19);
        const root = new THREE.Group();
        root.name = 'ParticleSystem';
        root.matrixAutoUpdate = false;
        root.add(this.alpha.points);
        root.add(this.additive.points);
        this.object = root;
        this.subscribe();
    }
    subscribe() {
        const u = this.unsubs;
        u.push(events.on('item:explosion', (e)=>{
            this.emit('explosion', e.position, {
                scale: Math.max(0.6, e.radius / 4)
            });
        }));
        u.push(events.on('item:hit', (e)=>{
            this.emit('hitSparks', e.position, {
                scale: 1.1
            });
            if (e.item === 'banana' || e.item === 'triple_banana') this.emit('bananaSplat', e.position);
            else if (e.item.includes('shell')) this.emit('shellBreak', e.position, {
                color: shellColor(e.item)
            });
        }));
        u.push(events.on('item:destroyed', (e)=>{
            if (e.item === 'banana' || e.item === 'triple_banana') this.emit('bananaSplat', e.position);
            else if (e.item === 'bob_omb') this.emit('explosion', e.position, {
                scale: 0.7
            });
            else this.emit('shellBreak', e.position, {
                color: shellColor(e.item)
            });
        }));
        u.push(events.on('item:shellBounce', (e)=>this.emit('hitSparks', e.position, {
                scale: 0.55
            })));
        u.push(events.on('kart:land', (e)=>{
            const k = this.kartById(e.kartId);
            if (!k) return;
            this.emit('landPuff', k.state.position, {
                scale: 0.7 + clamp01(e.impact) * 0.8
            });
        }));
        u.push(events.on('kart:collision', (e)=>{
            const s = 0.4 + clamp01(e.impulse / 8) * 0.9;
            if (e.otherId === null) this.emit('hitSparks', e.position, {
                scale: s,
                color: 0xffe08a
            });
            else this.emit('hitSparks', e.position, {
                scale: s * 0.6,
                color: 0xffffff
            });
        }));
        u.push(events.on('item:pickup', (e)=>this.emit('itemBoxBurst', e.position)));
        u.push(events.on('race:finish', (e)=>{
            if (!e.isPlayer) return;
            this.playerPodiumPlace = e.place <= 3 ? e.place : 0;
            if (e.place > 3) return;
            const k = this.kartById(e.kartId);
            if (!k) return;
            this.tmp.copy(k.state.position);
            this.tmp.y += 2.5;
            this.emit('confetti', this.tmp, {
                scale: e.place === 1 ? 1.4 : 1
            });
            this.emit('lapFlash', k.state.position);
        }));
        u.push(events.on('game:stateChange', (e)=>{
            if (e.to === 'results' && this.playerPodiumPlace > 0) {
                this.confettiScale = this.playerPodiumPlace === 1 ? 1.4 : this.playerPodiumPlace === 2 ? 1.1 : 0.85;
                this.confettiTimer = this.playerPodiumPlace === 1 ? 6 : 4;
                this.accConfetti = 0;
            } else if (e.to !== 'results' && e.to !== 'finished') {
                this.confettiTimer = 0;
                this.playerPodiumPlace = 0;
            }
        }));
        u.push(events.on('item:lightning', (e)=>{
            for (const k of this.karts){
                const st = k.state;
                if (st.id === e.sourceKartId || st.isInvincible) continue;
                this.emit('lightningStrike', st.position);
            }
        }));
        u.push(events.on('kart:boost', (e)=>{
            const idx = this.slot(e.kartId);
            this.boostSource[idx] = boostSourceCode(e.source);
            const k = this.kartById(e.kartId);
            if (!k) return;
            const color = e.source === 'mushroom' || e.source === 'golden' ? 0xff9a2e : e.source === 'pad' ? 0x3ef2ff : 0x9fd8ff;
            this.tmp.copy(k.state.position);
            this.tmp.y += 0.4;
            this.emit('boostRing', this.tmp, {
                color,
                scale: 0.6 + clamp01(e.strength) * 0.8
            });
        }));
        u.push(events.on('kart:shrink', (e)=>{
            const k = this.kartById(e.kartId);
            if (!k) return;
            this.shrinkPuff(k.state.position);
        }));
        u.push(events.on('kart:unshrink', (e)=>{
            const k = this.kartById(e.kartId);
            if (!k) return;
            this.shrinkPuff(k.state.position);
        }));
        u.push(events.on('kart:squish', (e)=>{
            const k = this.kartById(e.kartId);
            if (!k) return;
            this.emit('landPuff', k.state.position, {
                scale: 1.3
            });
        }));
        u.push(events.on('race:lap', (e)=>{
            if (!e.isPlayer) return;
            const k = this.kartById(e.kartId);
            if (!k) return;
            this.tmp.copy(k.state.position);
            this.tmp.y += 1.2;
            this.emit('lapFlash', this.tmp, {
                scale: e.isFinalLap ? 1.4 : 1
            });
        }));
    }
    slot(kartId) {
        return kartId >= 0 && kartId < MAX_KARTS ? kartId : (kartId % MAX_KARTS + MAX_KARTS) % MAX_KARTS;
    }
    kartById(id) {
        const karts = this.karts;
        if (id >= 0 && id < karts.length && karts[id].state.id === id) return karts[id];
        for(let i = 0; i < karts.length; i++)if (karts[i].state.id === id) return karts[i];
        return null;
    }
    update(dt, karts, camera) {
        this.karts = karts;
        dt = Math.min(Math.max(dt, 0), 0.1);
        this.time += dt;
        const now = this.time;
        this.additive.setTime(now);
        this.alpha.setTime(now);
        const e = camera.matrixWorld.elements;
        this.camPos.set(e[12], e[13], e[14]);
        this.camFwd.set(-e[8], -e[9], -e[10]).normalize();
        this.camUp.set(e[4], e[5], e[6]).normalize();
        this.camRight.set(e[0], e[1], e[2]).normalize();
        for(let i = 0; i < karts.length; i++){
            const st = karts[i].state;
            if (st.finished && !st.isBoosting && !st.isDrifting) continue;
            this.updateKartEmitters(dt, st, now);
            if (st.isPlayer && st.isBoosting && st.boostStrength >= 0.35 && Math.abs(st.speed) > BASE_TOP_SPEED * 1.12) {
                this.updateSpeedStreaks(dt, now);
            } else if (st.isPlayer) {
                this.accStreak = 0;
            }
        }
        if (this.confettiTimer > 0) this.updateResultsConfetti(dt, now);
        this.additive.flush();
        this.alpha.flush();
    }
    updateKartEmitters(dt, st, now) {
        const idx = this.slot(st.id);
        const p = st.position;
        const h = st.heading;
        const fx = -Math.sin(h);
        const fz = -Math.cos(h);
        const rx = Math.cos(h);
        const rz = -Math.sin(h);
        const speed = Math.abs(st.speed);
        const shrink = st.isShrunk ? 0.6 : 1;
        if (st.isDrifting && !st.isAirborne) {
            const stage = st.driftStage;
            const rate = stage === 0 ? 40 : 110 + stage * 20;
            const n = this.take(this.accDrift, idx, rate, dt);
            const c = rgb(DRIFT_STAGE_COLORS[stage]);
            for(let k = 0; k < n; k++){
                const side = k % 2 === 0 ? 1 : -1;
                const bx = p.x - fx * 0.7 + rx * 0.55 * side;
                const bz = p.z - fz * 0.7 + rz * 0.55 * side;
                S.x = bx + rnd(-0.06, 0.06);
                S.y = p.y + 0.08 + rnd(0, 0.06);
                S.z = bz + rnd(-0.06, 0.06);
                const back = rnd(2.5, 5.5) + speed * 0.15;
                S.vx = -fx * back + rx * side * rnd(0.5, 2.5) + rnd(-0.6, 0.6);
                S.vy = rnd(0.8, 2.8);
                S.vz = -fz * back + rz * side * rnd(0.5, 2.5) + rnd(-0.6, 0.6);
                S.life = stage === 0 ? rnd(0.15, 0.3) : rnd(0.25, 0.45);
                S.size0 = (stage === 0 ? 0.12 : 0.2 + stage * 0.03) * shrink;
                S.size1 = 0.03;
                setColor0(c, stage === 0 ? 1.6 : 2.2);
                setColor1(c, 0.8);
                S.a0 = 1;
                S.a1 = 0;
                S.rot = 0;
                S.rotSpeed = 0;
                S.gravity = 0.9;
                S.atlas = ATLAS_STREAK;
                S.align = 1;
                S.drag = 1.5;
                this.additive.spawn(S, now);
            }
            const ns = this.take(this.accSmoke, idx, 24, dt);
            for(let k = 0; k < ns; k++){
                const side = k % 2 === 0 ? 1 : -1;
                S.x = p.x - fx * 0.75 + rx * 0.55 * side + rnd(-0.08, 0.08);
                S.y = p.y + 0.12;
                S.z = p.z - fz * 0.75 + rz * 0.55 * side + rnd(-0.08, 0.08);
                S.vx = -fx * rnd(0.8, 2.0) + rx * side * rnd(0.2, 0.9) + rnd(-0.25, 0.25);
                S.vy = rnd(0.12, 0.4);
                S.vz = -fz * rnd(0.8, 2.0) + rz * side * rnd(0.2, 0.9) + rnd(-0.25, 0.25);
                S.life = rnd(0.55, 0.9);
                S.size0 = 0.3 * shrink;
                S.size1 = 0.95 * shrink;
                S.r0 = 0.66;
                S.g0 = 0.66;
                S.b0 = 0.68;
                S.r1 = 0.52;
                S.g1 = 0.52;
                S.b1 = 0.54;
                S.a0 = 0.34;
                S.a1 = 0;
                S.rot = rnd(0, TAU);
                S.rotSpeed = rnd(-1.2, 1.2);
                S.gravity = 0;
                S.atlas = ATLAS_SMOKE;
                S.align = 0;
                S.drag = 2.2;
                this.alpha.spawn(S, now);
            }
        } else {
            this.accDrift[idx] = 0;
            this.accSmoke[idx] = 0;
        }
        if (st.isBoosting) {
            const n = this.take(this.accFlame, idx, 72, dt);
            const src = this.boostSource[idx];
            for(let k = 0; k < n; k++){
                const side = k % 2 === 0 ? 1 : -1;
                S.x = p.x - fx * 0.9 + rx * 0.25 * side + rnd(-0.025, 0.025);
                S.y = p.y + 0.42 * shrink + rnd(-0.025, 0.025);
                S.z = p.z - fz * 0.9 + rz * 0.25 * side + rnd(-0.025, 0.025);
                const back = rnd(4, 7);
                S.vx = st.velocity.x * 0.8 - fx * back + rnd(-0.3, 0.3);
                S.vy = rnd(-0.1, 0.5);
                S.vz = st.velocity.z * 0.8 - fz * back + rnd(-0.3, 0.3);
                S.life = rnd(0.09, 0.18);
                S.size0 = 0.24 * shrink;
                S.size1 = 0.05;
                if (src === BOOST_SOURCE_MUSHROOM) {
                    S.r0 = 1.5;
                    S.g0 = 0.72;
                    S.b0 = 0.2;
                    S.r1 = 0.9;
                    S.g1 = 0.2;
                    S.b1 = 0.02;
                } else if (src === BOOST_SOURCE_PAD) {
                    S.r0 = 0.45;
                    S.g0 = 1.2;
                    S.b0 = 1.5;
                    S.r1 = 0.08;
                    S.g1 = 0.5;
                    S.b1 = 0.9;
                } else {
                    S.r0 = 0.7;
                    S.g0 = 0.95;
                    S.b0 = 1.5;
                    S.r1 = 0.2;
                    S.g1 = 0.4;
                    S.b1 = 1.1;
                }
                S.a0 = 0.7;
                S.a1 = 0;
                S.rot = 0;
                S.rotSpeed = 0;
                S.gravity = -0.03;
                S.atlas = k % 3 === 0 ? ATLAS_CIRCLE : ATLAS_FLAME;
                S.align = 1;
                S.drag = 4;
                this.additive.spawn(S, now);
            }
        } else {
            this.accFlame[idx] = 0;
        }
        if (st.surface === 'offroad' && speed > 5 && !st.isAirborne) {
            const n = this.take(this.accDust, idx, 18 + speed * 1.4, dt);
            for(let k = 0; k < n; k++){
                const side = k % 2 === 0 ? 1 : -1;
                S.x = p.x - fx * rnd(0.3, 0.8) + rx * 0.5 * side + rnd(-0.2, 0.2);
                S.y = p.y + 0.1;
                S.z = p.z - fz * rnd(0.3, 0.8) + rz * 0.5 * side + rnd(-0.2, 0.2);
                S.vx = -fx * rnd(1, 3) + rx * side * rnd(0.5, 2) + rnd(-0.5, 0.5);
                S.vy = rnd(0.8, 2.2);
                S.vz = -fz * rnd(1, 3) + rz * side * rnd(0.5, 2) + rnd(-0.5, 0.5);
                S.life = rnd(0.6, 1.1);
                S.size0 = 0.45;
                S.size1 = 1.6;
                S.r0 = 0.55;
                S.g0 = 0.45;
                S.b0 = 0.3;
                S.r1 = 0.45;
                S.g1 = 0.38;
                S.b1 = 0.26;
                S.a0 = 0.42;
                S.a1 = 0;
                S.rot = rnd(0, TAU);
                S.rotSpeed = rnd(-1, 1);
                S.gravity = 0.02;
                S.atlas = ATLAS_SMOKE;
                S.align = 0;
                S.drag = 2.2;
                this.alpha.spawn(S, now);
            }
        } else {
            this.accDust[idx] = 0;
        }
        if (st.isInvincible) {
            const n = this.take(this.accStar, idx, 70, dt);
            for(let k = 0; k < n; k++){
                const a = rnd(0, TAU);
                const rr = rnd(0.5, 1.1) * shrink;
                S.x = p.x + Math.cos(a) * rr;
                S.y = p.y + rnd(0.1, 1.1) * shrink;
                S.z = p.z + Math.sin(a) * rr;
                S.vx = Math.cos(a) * rnd(0.3, 1.2) + st.velocity.x * 0.35;
                S.vy = rnd(1, 2.5);
                S.vz = Math.sin(a) * rnd(0.3, 1.2) + st.velocity.z * 0.35;
                S.life = rnd(0.4, 0.8);
                S.size0 = rnd(0.24, 0.4);
                S.size1 = 0.03;
                const c = hslToRgb(now * 0.9 + k * 0.13, 1, 0.6);
                S.r0 = c.r * 2.2;
                S.g0 = c.g * 2.2;
                S.b0 = c.b * 2.2;
                S.r1 = 1.5;
                S.g1 = 1.5;
                S.b1 = 1.5;
                S.a0 = 1;
                S.a1 = 0;
                S.rot = rnd(0, TAU);
                S.rotSpeed = rnd(-3, 3);
                S.gravity = -0.08;
                S.atlas = ATLAS_STAR;
                S.align = 0;
                S.drag = 1.5;
                this.additive.spawn(S, now);
            }
        } else {
            this.accStar[idx] = 0;
        }
    }
    updateSpeedStreaks(dt, now) {
        this.accStreak += 38 * dt;
        let n = Math.floor(this.accStreak);
        this.accStreak -= n;
        if (n > MAX_PER_EMITTER_PER_FRAME) n = MAX_PER_EMITTER_PER_FRAME;
        const cp = this.camPos;
        const f = this.camFwd;
        const r = this.camRight;
        const u = this.camUp;
        for(let k = 0; k < n; k++){
            const ahead = rnd(8, 16);
            const ang = rnd(0, TAU);
            const rad = rnd(3.2, 7.5);
            const ox = Math.cos(ang) * rad * 1.6;
            const oy = Math.sin(ang) * rad;
            S.x = cp.x + f.x * ahead + r.x * ox + u.x * oy;
            S.y = cp.y + f.y * ahead + r.y * ox + u.y * oy;
            S.z = cp.z + f.z * ahead + r.z * ox + u.z * oy;
            const spd = rnd(36, 52);
            S.vx = -f.x * spd;
            S.vy = -f.y * spd;
            S.vz = -f.z * spd;
            S.life = rnd(0.14, 0.22);
            S.size0 = 0.26;
            S.size1 = 0.12;
            S.r0 = 0.85;
            S.g0 = 0.9;
            S.b0 = 1.0;
            S.r1 = 0.6;
            S.g1 = 0.65;
            S.b1 = 0.8;
            S.a0 = 0.16;
            S.a1 = 0;
            S.rot = 0;
            S.rotSpeed = 0;
            S.gravity = 0;
            S.atlas = ATLAS_STREAK;
            S.align = 1;
            S.drag = 0;
            this.additive.spawn(S, now);
        }
    }
    updateResultsConfetti(dt, now) {
        this.confettiTimer -= dt;
        const s = this.confettiScale;
        this.accConfetti += 55 * s * dt;
        let n = Math.floor(this.accConfetti);
        this.accConfetti -= n;
        if (n > MAX_PER_EMITTER_PER_FRAME) n = MAX_PER_EMITTER_PER_FRAME;
        const cp = this.camPos;
        const f = this.camFwd;
        const r = this.camRight;
        const u = this.camUp;
        for(let k = 0; k < n; k++){
            const ahead = rnd(4, 9);
            const ox = rnd(-1, 1) * ahead * 0.9;
            const oy = rnd(2.5, 4.5);
            S.x = cp.x + f.x * ahead + r.x * ox + u.x * oy;
            S.y = cp.y + f.y * ahead + r.y * ox + u.y * oy;
            S.z = cp.z + f.z * ahead + r.z * ox + u.z * oy;
            S.vx = rnd(-0.8, 0.8);
            S.vy = rnd(-0.6, 0.2);
            S.vz = rnd(-0.8, 0.8);
            S.life = rnd(2.2, 3.4);
            S.size0 = rnd(0.12, 0.2);
            S.size1 = S.size0;
            const c = rgb(CONFETTI_COLORS[k % CONFETTI_COLORS.length]);
            setColor0(c, 1.1);
            setColor1(c, 0.9);
            S.a0 = 1;
            S.a1 = 1;
            S.rot = rnd(0, TAU);
            S.rotSpeed = rnd(-6, 6);
            S.gravity = 0.09;
            S.atlas = k % 5 === 0 ? ATLAS_HEX : ATLAS_SQUARE;
            S.align = 0;
            S.drag = 1.6;
            this.alpha.spawn(S, now);
        }
    }
    take(acc, idx, rate, dt) {
        acc[idx] += rate * dt;
        let n = Math.floor(acc[idx]);
        acc[idx] -= n;
        if (n > MAX_PER_EMITTER_PER_FRAME) n = MAX_PER_EMITTER_PER_FRAME;
        return n;
    }
    emit(preset, position, options) {
        const now = this.time;
        const s = options?.scale ?? 1;
        const color = options?.color;
        const dir = options?.direction ?? null;
        const x = position.x, y = position.y, z = position.z;
        switch(preset){
            case 'explosion':
                this.explosion(x, y, z, s, now);
                break;
            case 'hitSparks':
                this.hitSparks(x, y, z, s, color ?? 0xffd27a, dir, now);
                break;
            case 'itemBoxBurst':
                this.itemBoxBurst(x, y, z, s, now);
                break;
            case 'confetti':
                this.confetti(x, y, z, s, now);
                break;
            case 'dust':
                this.dust(x, y, z, s, color ?? 0xc9b48a, now);
                break;
            case 'boostRing':
                this.boostRing(x, y, z, s, color ?? 0x66e6ff, now);
                break;
            case 'starSparkle':
                this.starSparkle(x, y, z, s, now);
                break;
            case 'lightningStrike':
                this.lightningStrike(x, y, z, s, now);
                break;
            case 'shellBreak':
                this.shellBreak(x, y, z, s, color ?? 0x3ddc84, now);
                break;
            case 'bananaSplat':
                this.bananaSplat(x, y, z, s, now);
                break;
            case 'waterSplash':
                this.waterSplash(x, y, z, s, now);
                break;
            case 'lapFlash':
                this.lapFlash(x, y, z, s, color ?? 0xffffff, now);
                break;
            case 'landPuff':
                this.landPuff(x, y, z, s, now);
                break;
            default:
                break;
        }
    }
    ring(x, y, z, size0, size1, life, c, mul, now) {
        S.x = x;
        S.y = y;
        S.z = z;
        S.vx = 0;
        S.vy = 0;
        S.vz = 0;
        S.life = life;
        S.size0 = size0;
        S.size1 = size1;
        setColor0(c, mul);
        setColor1(c, mul * 0.6);
        S.a0 = 0.9;
        S.a1 = 0;
        S.rot = 0;
        S.rotSpeed = 0;
        S.gravity = 0;
        S.atlas = ATLAS_RING;
        S.align = 0;
        S.drag = 0;
        this.additive.spawn(S, now);
    }
    flashSprite(x, y, z, size0, size1, life, r, g, b, now) {
        S.x = x;
        S.y = y;
        S.z = z;
        S.vx = 0;
        S.vy = 0;
        S.vz = 0;
        S.life = life;
        S.size0 = size0;
        S.size1 = size1;
        S.r0 = r;
        S.g0 = g;
        S.b0 = b;
        S.r1 = r * 0.5;
        S.g1 = g * 0.5;
        S.b1 = b * 0.5;
        S.a0 = 1;
        S.a1 = 0;
        S.rot = 0;
        S.rotSpeed = 0;
        S.gravity = 0;
        S.atlas = ATLAS_CIRCLE;
        S.align = 0;
        S.drag = 0;
        this.additive.spawn(S, now);
    }
    explosion(x, y, z, s, now) {
        for(let i = 0; i < 18; i++){
            jitterPosition(x, y + 0.3 * s, z, 0.25 * s);
            randomSphereVelocity(rnd(1.5, 4.5) * s, 1.2 * s);
            S.life = rnd(0.3, 0.55);
            S.size0 = rnd(0.9, 1.4) * s;
            S.size1 = rnd(1.6, 2.3) * s;
            S.r0 = 1.9;
            S.g0 = 1.35;
            S.b0 = 0.5;
            S.r1 = 1.1;
            S.g1 = 0.25;
            S.b1 = 0.03;
            S.a0 = 0.8;
            S.a1 = 0;
            S.rot = rnd(0, TAU);
            S.rotSpeed = rnd(-2, 2);
            S.gravity = -0.1;
            S.atlas = ATLAS_SMOKE;
            S.align = 0;
            S.drag = 3;
            this.additive.spawn(S, now);
        }
        for(let i = 0; i < 40; i++){
            jitterPosition(x, y + 0.3 * s, z, 0.15 * s);
            randomSphereVelocity(rnd(6, 15) * s, 2 * s);
            S.life = rnd(0.4, 0.9);
            S.size0 = 0.3 * s;
            S.size1 = 0.06 * s;
            S.r0 = 2.2;
            S.g0 = 1.8;
            S.b0 = 0.9;
            S.r1 = 1.5;
            S.g1 = 0.5;
            S.b1 = 0.08;
            S.a0 = 1;
            S.a1 = 0;
            S.rot = 0;
            S.rotSpeed = 0;
            S.gravity = 1;
            S.atlas = ATLAS_STREAK;
            S.align = 1;
            S.drag = 0.8;
            this.additive.spawn(S, now);
        }
        for(let i = 0; i < 24; i++){
            jitterPosition(x, y + 0.4 * s, z, 0.4 * s);
            randomSphereVelocity(rnd(0.6, 2.2) * s, rnd(1.2, 3.0) * s);
            S.life = rnd(1.05, 1.4);
            S.size0 = rnd(0.9, 1.4) * s;
            S.size1 = rnd(2.4, 3.4) * s;
            S.r0 = 0.3;
            S.g0 = 0.27;
            S.b0 = 0.25;
            S.r1 = 0.1;
            S.g1 = 0.1;
            S.b1 = 0.1;
            S.a0 = 0.62;
            S.a1 = 0;
            S.rot = rnd(0, TAU);
            S.rotSpeed = rnd(-1.2, 1.2);
            S.gravity = -0.1;
            S.atlas = ATLAS_SMOKE;
            S.align = 0;
            S.drag = 1.8;
            this.alpha.spawn(S, now);
        }
        this.ring(x, y + 0.35 * s, z, 1.0 * s, 11 * s, 0.5, rgb(0xffc37a), 1.6, now);
        this.ring(x, y + 0.35 * s, z, 0.6 * s, 7 * s, 0.28, rgb(0xffffff), 1.2, now);
        this.flashSprite(x, y + 0.5 * s, z, 2.6 * s, 5.5 * s, 0.16, 1.9, 1.7, 1.4, now);
    }
    hitSparks(x, y, z, s, hex, dir, now) {
        const c = rgb(hex);
        const n = Math.round(22 * s);
        for(let i = 0; i < n; i++){
            jitterPosition(x, y, z, 0.1);
            randomSphereVelocity(rnd(3.5, 8) * s, 1.5);
            if (dir) {
                S.vx += dir.x * 5 * s;
                S.vy += dir.y * 5 * s;
                S.vz += dir.z * 5 * s;
            }
            S.life = rnd(0.25, 0.6);
            S.size0 = 0.26 * s;
            S.size1 = 0.04;
            setColor0(c, 2.2);
            setColor1(c, 1.2);
            S.a0 = 1;
            S.a1 = 0;
            S.rot = 0;
            S.rotSpeed = 0;
            S.gravity = 1;
            S.atlas = ATLAS_STREAK;
            S.align = 1;
            S.drag = 1;
            this.additive.spawn(S, now);
        }
        this.flashSprite(x, y, z, 0.8 * s, 1.6 * s, 0.14, c.r * 2.2, c.g * 2.2, c.b * 2.2, now);
    }
    itemBoxBurst(x, y, z, s, now) {
        for(let i = 0; i < 36; i++){
            jitterPosition(x, y, z, 0.25);
            randomSphereVelocity(rnd(3, 7.5) * s, 2.5);
            S.life = rnd(0.32, 0.6);
            S.size0 = rnd(0.22, 0.36) * s;
            S.size1 = 0.06;
            const c = hslToRgb(i / 36, 1, 0.55);
            S.r0 = c.r * 1.8;
            S.g0 = c.g * 1.8;
            S.b0 = c.b * 1.8;
            S.r1 = c.r;
            S.g1 = c.g;
            S.b1 = c.b;
            S.a0 = 1;
            S.a1 = 0;
            S.rot = rnd(0, TAU);
            S.rotSpeed = rnd(-9, 9);
            S.gravity = 0.9;
            S.atlas = i % 3 === 0 ? ATLAS_SQUARE : ATLAS_SHARD;
            S.align = 0;
            S.drag = 1.4;
            this.additive.spawn(S, now);
        }
        for(let i = 0; i < 8; i++){
            jitterPosition(x, y, z, 0.4);
            randomSphereVelocity(rnd(0.5, 1.5), 0.8);
            S.life = rnd(0.22, 0.4);
            S.size0 = 0.32 * s;
            S.size1 = 0.02;
            S.r0 = 1.8;
            S.g0 = 1.8;
            S.b0 = 2.0;
            S.r1 = 1.0;
            S.g1 = 1.0;
            S.b1 = 1.5;
            S.a0 = 1;
            S.a1 = 0;
            S.rot = rnd(0, TAU);
            S.rotSpeed = rnd(-3, 3);
            S.gravity = -0.1;
            S.atlas = ATLAS_STAR;
            S.align = 0;
            S.drag = 1;
            this.additive.spawn(S, now);
        }
        this.ring(x, y, z, 0.5 * s, 4.0 * s, 0.3, rgb(0xffffff), 1.4, now);
    }
    confetti(x, y, z, s, now) {
        const n = Math.round(150 * s);
        for(let i = 0; i < n; i++){
            jitterPosition(x, y, z, 0.6 * s);
            const a = rnd(0, TAU);
            const sp = rnd(1, 4.5) * s;
            S.vx = Math.cos(a) * sp;
            S.vz = Math.sin(a) * sp;
            S.vy = rnd(4, 9.5) * s;
            S.life = rnd(2.8, 4.8);
            S.size0 = rnd(0.14, 0.22);
            S.size1 = S.size0;
            const c = rgb(CONFETTI_COLORS[i % CONFETTI_COLORS.length]);
            setColor0(c, 1.1);
            setColor1(c, 0.9);
            S.a0 = 1;
            S.a1 = 1;
            S.rot = rnd(0, TAU);
            S.rotSpeed = rnd(-5, 5);
            S.gravity = 0.16;
            S.atlas = i % 5 === 0 ? ATLAS_HEX : ATLAS_SQUARE;
            S.align = 0;
            S.drag = 1.3;
            this.alpha.spawn(S, now);
        }
    }
    dust(x, y, z, s, hex, now) {
        const c = rgb(hex);
        const n = Math.round(10 * s);
        for(let i = 0; i < n; i++){
            jitterPosition(x, y + 0.1, z, 0.2 * s);
            randomSphereVelocity(rnd(0.4, 1.6) * s, rnd(0.4, 1.2));
            S.life = rnd(0.6, 1.1);
            S.size0 = 0.5 * s;
            S.size1 = 1.7 * s;
            setColor0(c, 0.8);
            setColor1(c, 0.65);
            S.a0 = 0.45;
            S.a1 = 0;
            S.rot = rnd(0, TAU);
            S.rotSpeed = rnd(-1, 1);
            S.gravity = -0.02;
            S.atlas = ATLAS_SMOKE;
            S.align = 0;
            S.drag = 2;
            this.alpha.spawn(S, now);
        }
    }
    boostRing(x, y, z, s, hex, now) {
        const c = rgb(hex);
        this.ring(x, y, z, 0.8 * s, 3.6 * s, 0.35, c, 1.8, now);
        for(let i = 0; i < 12; i++){
            const a = i / 12 * TAU;
            S.x = x;
            S.y = y;
            S.z = z;
            S.vx = Math.cos(a) * 5 * s;
            S.vy = rnd(0.5, 1.5);
            S.vz = Math.sin(a) * 5 * s;
            S.life = 0.35;
            S.size0 = 0.25 * s;
            S.size1 = 0.04;
            setColor0(c, 2.2);
            setColor1(c, 1.0);
            S.a0 = 1;
            S.a1 = 0;
            S.rot = 0;
            S.rotSpeed = 0;
            S.gravity = 0.2;
            S.atlas = ATLAS_STREAK;
            S.align = 1;
            S.drag = 2;
            this.additive.spawn(S, now);
        }
    }
    starSparkle(x, y, z, s, now) {
        const n = Math.round(14 * s);
        for(let i = 0; i < n; i++){
            jitterPosition(x, y, z, 0.6 * s);
            randomSphereVelocity(rnd(0.8, 2.4), 1.2);
            S.life = rnd(0.4, 0.8);
            S.size0 = rnd(0.2, 0.34) * s;
            S.size1 = 0.0;
            const c = hslToRgb(Math.random(), 1, 0.6);
            S.r0 = c.r * 2.2;
            S.g0 = c.g * 2.2;
            S.b0 = c.b * 2.2;
            S.r1 = 1.6;
            S.g1 = 1.6;
            S.b1 = 1.6;
            S.a0 = 1;
            S.a1 = 0;
            S.rot = rnd(0, TAU);
            S.rotSpeed = rnd(-3, 3);
            S.gravity = -0.1;
            S.atlas = ATLAS_STAR;
            S.align = 0;
            S.drag = 1.5;
            this.additive.spawn(S, now);
        }
    }
    lightningStrike(x, y, z, s, now) {
        const segments = 7;
        const segH = 2.3 * s;
        let bx = x, bz = z;
        for(let i = 0; i < segments; i++){
            const by = y + 0.8 + i * segH * 0.92;
            S.x = bx;
            S.y = by;
            S.z = bz;
            S.vx = 0;
            S.vy = 0;
            S.vz = 0;
            S.life = 0.22 + i * 0.01;
            S.size0 = segH * 1.1;
            S.size1 = segH * 0.9;
            S.r0 = 2.2;
            S.g0 = 2.6;
            S.b0 = 3.2;
            S.r1 = 0.8;
            S.g1 = 1.0;
            S.b1 = 2.2;
            S.a0 = 1;
            S.a1 = 0;
            S.rot = rnd(-0.25, 0.25);
            S.rotSpeed = 0;
            S.gravity = 0;
            S.atlas = ATLAS_BOLT;
            S.align = 0;
            S.drag = 0;
            this.additive.spawn(S, now);
            bx += rnd(-0.35, 0.35);
            bz += rnd(-0.35, 0.35);
        }
        for(let i = 0; i < 3; i++){
            this.flashSprite(x, y + 0.6 + i * 0.5, z, 2.5 * s, 5 * s, 0.16 + i * 0.03, 1.8, 2.2, 3.0, now);
        }
        for(let i = 0; i < 26; i++){
            jitterPosition(x, y + 0.4, z, 0.2);
            randomSphereVelocity(rnd(3, 8), 3);
            S.life = rnd(0.3, 0.6);
            S.size0 = 0.24;
            S.size1 = 0.03;
            S.r0 = 2.0;
            S.g0 = 2.4;
            S.b0 = 3.2;
            S.r1 = 0.6;
            S.g1 = 0.8;
            S.b1 = 2.0;
            S.a0 = 1;
            S.a1 = 0;
            S.rot = 0;
            S.rotSpeed = 0;
            S.gravity = 0.9;
            S.atlas = ATLAS_STREAK;
            S.align = 1;
            S.drag = 1;
            this.additive.spawn(S, now);
        }
        this.ring(x, y + 0.2, z, 0.5, 5 * s, 0.35, rgb(0xbfe4ff), 2.0, now);
    }
    shellBreak(x, y, z, s, hex, now) {
        const c = rgb(hex);
        for(let i = 0; i < 18; i++){
            jitterPosition(x, y + 0.1, z, 0.15);
            randomSphereVelocity(rnd(3, 7) * s, 3);
            S.life = rnd(0.4, 0.7);
            S.size0 = rnd(0.22, 0.34);
            S.size1 = 0.12;
            setColor0(c, 1.1);
            setColor1(c, 0.55);
            S.a0 = 1;
            S.a1 = 0;
            S.rot = rnd(0, TAU);
            S.rotSpeed = rnd(-10, 10);
            S.gravity = 1.1;
            S.atlas = i % 2 === 0 ? ATLAS_SHARD : ATLAS_HEX;
            S.align = 0;
            S.drag = 0.6;
            this.alpha.spawn(S, now);
        }
        this.hitSparks(x, y, z, 0.6 * s, 0xffffff, null, now);
    }
    bananaSplat(x, y, z, s, now) {
        const c = rgb(0xffe135);
        for(let i = 0; i < 14; i++){
            jitterPosition(x, y + 0.1, z, 0.12);
            randomSphereVelocity(rnd(1, 3.2) * s, 2.2);
            S.life = rnd(0.45, 0.8);
            S.size0 = rnd(0.16, 0.26);
            S.size1 = rnd(0.25, 0.4);
            setColor0(c, 1.0);
            setColor1(c, 0.75);
            S.a0 = 1;
            S.a1 = 0;
            S.rot = rnd(0, TAU);
            S.rotSpeed = rnd(-4, 4);
            S.gravity = 1.2;
            S.atlas = i % 3 === 0 ? ATLAS_HEX : ATLAS_DOT;
            S.align = 0;
            S.drag = 0.8;
            this.alpha.spawn(S, now);
        }
        this.dust(x, y, z, 0.6 * s, 0xc9b48a, now);
    }
    waterSplash(x, y, z, s, now) {
        for(let i = 0; i < 30; i++){
            jitterPosition(x, y, z, 0.2 * s);
            const a = rnd(0, TAU);
            const sp = rnd(0.8, 2.8) * s;
            S.vx = Math.cos(a) * sp;
            S.vz = Math.sin(a) * sp;
            S.vy = rnd(3, 7) * s;
            S.life = rnd(0.5, 0.9);
            S.size0 = 0.16 * s;
            S.size1 = 0.05;
            S.r0 = 1.0;
            S.g0 = 1.5;
            S.b0 = 1.9;
            S.r1 = 0.6;
            S.g1 = 0.9;
            S.b1 = 1.3;
            S.a0 = 0.9;
            S.a1 = 0;
            S.rot = 0;
            S.rotSpeed = 0;
            S.gravity = 1;
            S.atlas = ATLAS_DOT;
            S.align = 0;
            S.drag = 0.4;
            this.additive.spawn(S, now);
        }
        for(let i = 0; i < 8; i++){
            jitterPosition(x, y + 0.2, z, 0.3 * s);
            randomSphereVelocity(rnd(0.3, 1.2), 1);
            S.life = rnd(0.6, 1.0);
            S.size0 = 0.6 * s;
            S.size1 = 1.6 * s;
            S.r0 = 0.85;
            S.g0 = 0.9;
            S.b0 = 0.95;
            S.r1 = 0.8;
            S.g1 = 0.85;
            S.b1 = 0.9;
            S.a0 = 0.4;
            S.a1 = 0;
            S.rot = rnd(0, TAU);
            S.rotSpeed = rnd(-1, 1);
            S.gravity = -0.05;
            S.atlas = ATLAS_SMOKE;
            S.align = 0;
            S.drag = 2;
            this.alpha.spawn(S, now);
        }
    }
    lapFlash(x, y, z, s, hex, now) {
        const c = rgb(hex);
        this.ring(x, y, z, 0.6 * s, 6.5 * s, 0.45, c, 2.0, now);
        for(let i = 0; i < 22; i++){
            const a = i / 22 * TAU;
            S.x = x;
            S.y = y;
            S.z = z;
            S.vx = Math.cos(a) * rnd(3, 5) * s;
            S.vy = rnd(1.5, 4);
            S.vz = Math.sin(a) * rnd(3, 5) * s;
            S.life = rnd(0.5, 0.9);
            S.size0 = 0.3 * s;
            S.size1 = 0.02;
            const hc = hslToRgb(i / 22, 1, 0.6);
            S.r0 = hc.r * 2.2;
            S.g0 = hc.g * 2.2;
            S.b0 = hc.b * 2.2;
            S.r1 = 1.5;
            S.g1 = 1.5;
            S.b1 = 1.5;
            S.a0 = 1;
            S.a1 = 0;
            S.rot = rnd(0, TAU);
            S.rotSpeed = rnd(-4, 4);
            S.gravity = 0.3;
            S.atlas = ATLAS_STAR;
            S.align = 0;
            S.drag = 1.2;
            this.additive.spawn(S, now);
        }
    }
    landPuff(x, y, z, s, now) {
        const n = Math.round(10 * s);
        for(let i = 0; i < n; i++){
            const a = rnd(0, TAU);
            S.x = x + Math.cos(a) * 0.4;
            S.y = y + 0.08;
            S.z = z + Math.sin(a) * 0.4;
            const sp = rnd(1.2, 3) * s;
            S.vx = Math.cos(a) * sp;
            S.vy = rnd(0.3, 0.9);
            S.vz = Math.sin(a) * sp;
            S.life = rnd(0.45, 0.8);
            S.size0 = 0.4 * s;
            S.size1 = 1.4 * s;
            S.r0 = 0.6;
            S.g0 = 0.58;
            S.b0 = 0.52;
            S.r1 = 0.5;
            S.g1 = 0.48;
            S.b1 = 0.44;
            S.a0 = 0.45;
            S.a1 = 0;
            S.rot = rnd(0, TAU);
            S.rotSpeed = rnd(-1.5, 1.5);
            S.gravity = 0.0;
            S.atlas = ATLAS_SMOKE;
            S.align = 0;
            S.drag = 2.5;
            this.alpha.spawn(S, now);
        }
    }
    shrinkPuff(p) {
        const now = this.time;
        for(let i = 0; i < 16; i++){
            jitterPosition(p.x, p.y + 0.5, p.z, 0.4);
            randomSphereVelocity(rnd(0.8, 2.2), 0.8);
            S.life = rnd(0.5, 0.9);
            S.size0 = 0.5;
            S.size1 = 1.3;
            S.r0 = 0.9;
            S.g0 = 0.9;
            S.b0 = 1.0;
            S.r1 = 0.7;
            S.g1 = 0.7;
            S.b1 = 0.8;
            S.a0 = 0.5;
            S.a1 = 0;
            S.rot = rnd(0, TAU);
            S.rotSpeed = rnd(-2, 2);
            S.gravity = -0.05;
            S.atlas = ATLAS_SMOKE;
            S.align = 0;
            S.drag = 2;
            this.alpha.spawn(S, now);
        }
        this.starSparkle(p.x, p.y + 0.5, p.z, 0.8, now);
    }
    reset() {
        this.additive.clear();
        this.alpha.clear();
        this.accDrift.fill(0);
        this.accFlame.fill(0);
        this.accSmoke.fill(0);
        this.accDust.fill(0);
        this.accStar.fill(0);
        this.boostSource.fill(BOOST_SOURCE_NONE);
        this.accStreak = 0;
        this.confettiTimer = 0;
        this.accConfetti = 0;
        this.playerPodiumPlace = 0;
    }
    dispose() {
        for (const off of this.unsubs)off();
        this.unsubs.length = 0;
        this.additive.dispose();
        this.alpha.dispose();
        this.atlas.dispose();
        this.object.removeFromParent();
        this.karts = [];
    }
}
function shellColor(item) {
    if (item.startsWith('red')) return 0xff3b30;
    if (item.startsWith('blue')) return 0x3a7bff;
    if (item === 'bob_omb') return 0x222233;
    return 0x3ddc84;
}
