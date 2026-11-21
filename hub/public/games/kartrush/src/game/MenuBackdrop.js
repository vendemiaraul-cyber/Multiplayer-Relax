import * as THREE from 'three';
import { LAYER_BLOOM } from '../core/constants.js';
import { damp } from '../core/math.js';
import { Kart } from '../kart/Kart.js';
const FRAMINGS = {
    title: {
        distance: 5.7,
        height: 1.0,
        fov: 30,
        sx: 0,
        sy: -0.3
    },
    characters: {
        distance: 5.3,
        height: 0.95,
        fov: 30,
        sx: 0.58,
        sy: -0.08
    },
    tracks: {
        distance: 5.9,
        height: 0.85,
        fov: 30,
        sx: 0,
        sy: 0.42
    }
};
const PODIUM_RADIUS = 1.55;
const PODIUM_HEIGHT = 0.32;
const KART_FOCUS_Y = 0.42;
const ORBIT_SPEED = 0.11;
const KART_SPIN = 0.22;
const FRAMING_LAMBDA = 3.2;
const FOG_COLOR = 0x1a1136;
const DUST_COUNT = 420;
const DUST_RADIUS = 7;
const DUST_HEIGHT = 4.5;
const SKY_VERT = `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const SKY_FRAG = `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uGlow;
uniform float uTime;
varying vec3 vWorldPos;
void main() {
  vec3 d = normalize(vWorldPos);
  float h = d.y;
  // Above the horizon: horizon colour → zenith. Below: stay at the horizon colour so the
  // fogged floor (same colour) meets it without a seam.
  vec3 c = h > 0.0 ? mix(uMid, uTop, pow(h, 0.5)) : uMid;
  // Soft glow hugging the horizon, slowly breathing.
  float glow = exp(-abs(h) * 6.0) * (0.55 + 0.1 * sin(uTime * 0.35 + d.x * 2.0));
  c += uGlow * glow;
  // Faint aurora band.
  float band = exp(-pow((h - 0.22 + 0.03 * sin(uTime * 0.25 + d.x * 3.0)) * 10.0, 2.0));
  c += vec3(0.05, 0.03, 0.14) * band * (0.6 + 0.4 * sin(uTime * 0.4 + d.z * 4.0));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const DUST_VERT = `
attribute float aSeed;
uniform float uTime;
uniform float uHeight;
varying float vAlpha;
void main() {
  vec3 p = position;
  float t = uTime * (0.08 + 0.06 * aSeed);
  p.y = mod(p.y + t, uHeight);
  p.x += sin(uTime * 0.3 + aSeed * 12.0) * 0.25;
  p.z += cos(uTime * 0.27 + aSeed * 9.0) * 0.25;
  // Fade in near the floor and out near the top.
  float fade = smoothstep(0.0, 0.5, p.y) * (1.0 - smoothstep(uHeight - 1.2, uHeight, p.y));
  vAlpha = fade * (0.35 + 0.65 * fract(aSeed * 7.31));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (2.0 + 4.0 * fract(aSeed * 3.17)) * (220.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const DUST_FRAG = `
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv) * 2.0;
  float a = smoothstep(1.0, 0.2, d) * vAlpha * 0.55;
  gl_FragColor = vec4(vec3(0.75, 0.82, 1.0) * a, a);
}`;
export class MenuBackdrop {
    group = new THREE.Group();
    kart = null;
    currentId = null;
    kartHolder = new THREE.Group();
    skyMaterial;
    dustMaterial;
    rings = [];
    disposables = [];
    fog = new THREE.FogExp2(FOG_COLOR, 0.03);
    background = new THREE.Color(FOG_COLOR);
    envTexture = null;
    framing = 'title';
    cur = {
        ...FRAMINGS.title
    };
    angle = 0.7;
    time = 0;
    origin = new THREE.Vector3();
    identity = new THREE.Quaternion();
    focus = new THREE.Vector3();
    camPos = new THREE.Vector3();
    dir = new THREE.Vector3();
    right = new THREE.Vector3();
    upv = new THREE.Vector3();
    target = new THREE.Vector3();
    worldUp = new THREE.Vector3(0, 1, 0);
    constructor(){
        this.group.name = 'MenuBackdrop';
        const skyGeo = new THREE.SphereGeometry(220, 32, 16);
        this.skyMaterial = new THREE.ShaderMaterial({
            vertexShader: SKY_VERT,
            fragmentShader: SKY_FRAG,
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
            uniforms: {
                uTop: {
                    value: new THREE.Color(0x05040f)
                },
                uMid: {
                    value: new THREE.Color(FOG_COLOR)
                },
                uGlow: {
                    value: new THREE.Color(0x2a1550)
                },
                uTime: {
                    value: 0
                }
            }
        });
        const sky = new THREE.Mesh(skyGeo, this.skyMaterial);
        sky.frustumCulled = false;
        this.group.add(sky);
        this.disposables.push(skyGeo, this.skyMaterial);
        const starCount = 420;
        const starPos = new Float32Array(starCount * 3);
        for(let i = 0; i < starCount; i++){
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(1 - Math.random() * 0.75);
            const r = 190;
            starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            starPos[i * 3 + 1] = r * Math.cos(phi) + 12;
            starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
        }
        const starGeo = new THREE.BufferGeometry();
        starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
        const starMat = new THREE.PointsMaterial({
            color: 0xdfe6ff,
            size: 1.4,
            sizeAttenuation: false,
            transparent: true,
            opacity: 0.6,
            depthWrite: false,
            fog: false
        });
        const stars = new THREE.Points(starGeo, starMat);
        stars.frustumCulled = false;
        this.group.add(stars);
        this.disposables.push(starGeo, starMat);
        const floorGeo = new THREE.CircleGeometry(140, 72);
        const gridTex = this.makeGridTexture();
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.3,
            metalness: 0.75,
            map: gridTex,
            envMapIntensity: 1.2
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.005;
        floor.receiveShadow = true;
        this.group.add(floor);
        this.disposables.push(floorGeo, floorMat, gridTex);
        const podiumMat = new THREE.MeshStandardMaterial({
            color: 0x15142c,
            metalness: 0.8,
            roughness: 0.22,
            envMapIntensity: 1.4
        });
        const podiumGeo = new THREE.CylinderGeometry(PODIUM_RADIUS, PODIUM_RADIUS + 0.12, PODIUM_HEIGHT, 72);
        const podium = new THREE.Mesh(podiumGeo, podiumMat);
        podium.position.y = PODIUM_HEIGHT / 2;
        podium.castShadow = true;
        podium.receiveShadow = true;
        this.group.add(podium);
        this.disposables.push(podiumGeo, podiumMat);
        const stepGeo = new THREE.CylinderGeometry(PODIUM_RADIUS + 0.75, PODIUM_RADIUS + 0.85, 0.1, 72);
        const step = new THREE.Mesh(stepGeo, podiumMat);
        step.position.y = 0.05;
        step.receiveShadow = true;
        this.group.add(step);
        this.disposables.push(stepGeo);
        this.addRing(PODIUM_RADIUS + 0.03, PODIUM_HEIGHT + 0.01, 0.016, new THREE.Color(0.45, 1.05, 1.45), 1, 0, 0.95);
        this.addRing(PODIUM_RADIUS + 0.86, 0.105, 0.014, new THREE.Color(1.3, 0.4, 1.0), 3, 0.22, 0.85);
        this.addRing(PODIUM_RADIUS + 1.9, 0.012, 0.012, new THREE.Color(0.35, 0.65, 1.3), 2, -0.14, 0.6);
        const dustPos = new Float32Array(DUST_COUNT * 3);
        const dustSeed = new Float32Array(DUST_COUNT);
        for(let i = 0; i < DUST_COUNT; i++){
            const r = Math.sqrt(Math.random()) * DUST_RADIUS;
            const a = Math.random() * Math.PI * 2;
            dustPos[i * 3] = Math.cos(a) * r;
            dustPos[i * 3 + 1] = Math.random() * DUST_HEIGHT;
            dustPos[i * 3 + 2] = Math.sin(a) * r;
            dustSeed[i] = Math.random();
        }
        const dustGeo = new THREE.BufferGeometry();
        dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
        dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dustSeed, 1));
        this.dustMaterial = new THREE.ShaderMaterial({
            vertexShader: DUST_VERT,
            fragmentShader: DUST_FRAG,
            uniforms: {
                uTime: {
                    value: 0
                },
                uHeight: {
                    value: DUST_HEIGHT
                }
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            fog: false
        });
        const dust = new THREE.Points(dustGeo, this.dustMaterial);
        dust.frustumCulled = false;
        this.group.add(dust);
        this.disposables.push(dustGeo, this.dustMaterial);
        const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
        key.position.set(3.2, 6.5, 4.2);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        key.shadow.camera.left = -3.5;
        key.shadow.camera.right = 3.5;
        key.shadow.camera.top = 3.5;
        key.shadow.camera.bottom = -3.5;
        key.shadow.camera.near = 0.5;
        key.shadow.camera.far = 20;
        key.shadow.bias = -0.0004;
        key.shadow.normalBias = 0.02;
        this.group.add(key, key.target);
        const top = new THREE.SpotLight(0xffffff, 60, 0, 0.55, 0.7, 2);
        top.position.set(0, 6.5, 0.5);
        top.target.position.set(0, PODIUM_HEIGHT, 0);
        this.group.add(top, top.target);
        const hemi = new THREE.HemisphereLight(0x3d48a8, 0x0b0716, 0.55);
        this.group.add(hemi);
        const rimA = new THREE.PointLight(0x37a8ff, 38, 22, 2);
        rimA.position.set(-4.2, 1.9, -3.2);
        const rimB = new THREE.PointLight(0xff3ab8, 38, 22, 2);
        rimB.position.set(4.2, 1.5, -3.2);
        this.group.add(rimA, rimB);
        this.kartHolder.position.y = PODIUM_HEIGHT;
        this.group.add(this.kartHolder);
        this.focus.set(0, PODIUM_HEIGHT + KART_FOCUS_Y, 0);
    }
    setCharacter(def) {
        if (def.id === this.currentId) return;
        this.currentId = def.id;
        this.disposeKart();
        try {
            const kart = new Kart(0, def, true);
            kart.setFrozen(true);
            kart.resetTo(this.origin, this.identity);
            kart.object.traverse((o)=>{
                const m = o;
                if (m.isMesh) {
                    m.castShadow = true;
                    m.receiveShadow = true;
                }
            });
            this.kartHolder.add(kart.object);
            this.kart = kart;
        } catch (err) {
            console.error('[MenuBackdrop] failed to build kart', err);
            this.kart = null;
        }
    }
    setFraming(mode, immediate = false) {
        this.framing = mode;
        if (immediate) Object.assign(this.cur, FRAMINGS[mode]);
    }
    attach(scene, camera, renderer) {
        scene.add(this.group);
        scene.fog = this.fog;
        scene.background = this.background;
        if (renderer && !this.envTexture) this.buildEnvironment(renderer);
        scene.environment = this.envTexture;
        Object.assign(this.cur, FRAMINGS[this.framing]);
        camera.fov = this.cur.fov;
        camera.updateProjectionMatrix();
        this.update(0, camera);
    }
    detach(scene) {
        scene.remove(this.group);
        if (scene.fog === this.fog) scene.fog = null;
        if (scene.environment === this.envTexture) scene.environment = null;
    }
    update(dt, camera) {
        this.time += dt;
        this.angle += dt * ORBIT_SPEED;
        this.kartHolder.rotation.y += dt * KART_SPIN;
        this.skyMaterial.uniforms.uTime.value = this.time;
        this.dustMaterial.uniforms.uTime.value = this.time;
        const pulse = 0.9 + 0.1 * Math.sin(this.time * 1.7);
        for(let i = 0; i < this.rings.length; i++){
            const r = this.rings[i];
            r.mesh.rotation.z += dt * r.speed;
            r.material.opacity = r.baseOpacity * pulse;
        }
        if (this.kart) {
            this.kart.updateVisuals(dt);
            this.kart.object.position.copy(this.origin);
        }
        const want = FRAMINGS[this.framing];
        const c = this.cur;
        c.distance = damp(c.distance, want.distance, FRAMING_LAMBDA, dt);
        c.height = damp(c.height, want.height, FRAMING_LAMBDA, dt);
        c.fov = damp(c.fov, want.fov, FRAMING_LAMBDA, dt);
        c.sx = damp(c.sx, want.sx, FRAMING_LAMBDA, dt);
        c.sy = damp(c.sy, want.sy, FRAMING_LAMBDA, dt);
        const bob = Math.sin(this.time * 0.45) * 0.1;
        const f = this.focus;
        this.camPos.set(Math.sin(this.angle) * c.distance, f.y + c.height + bob, Math.cos(this.angle) * c.distance);
        this.dir.subVectors(f, this.camPos);
        const dist = this.dir.length();
        this.dir.multiplyScalar(1 / Math.max(1e-6, dist));
        this.right.crossVectors(this.dir, this.worldUp).normalize();
        this.upv.crossVectors(this.right, this.dir);
        const halfH = dist * Math.tan(c.fov * Math.PI / 360);
        const halfW = halfH * Math.max(0.1, camera.aspect);
        this.target.copy(f).addScaledVector(this.right, -c.sx * halfW).addScaledVector(this.upv, -c.sy * halfH);
        camera.position.copy(this.camPos);
        camera.up.set(0, 1, 0);
        camera.lookAt(this.target);
        if (Math.abs(camera.fov - c.fov) > 0.01) {
            camera.fov = c.fov;
            camera.updateProjectionMatrix();
        }
    }
    dispose() {
        this.disposeKart();
        for (const d of this.disposables)d.dispose();
        this.disposables.length = 0;
        this.rings.length = 0;
        if (this.envTexture) {
            this.envTexture.dispose();
            this.envTexture = null;
        }
        this.group.clear();
    }
    disposeKart() {
        if (!this.kart) return;
        this.kartHolder.remove(this.kart.object);
        try {
            this.kart.dispose();
        } catch (err) {
            console.warn('[MenuBackdrop] kart dispose failed', err);
        }
        this.kart = null;
    }
    addRing(radius, y, tube, color, segments, speed, opacity) {
        const mat = new THREE.MeshBasicMaterial({
            color,
            toneMapped: false,
            transparent: true,
            opacity,
            fog: false
        });
        const holder = new THREE.Group();
        holder.rotation.x = Math.PI / 2;
        holder.position.y = y;
        const arc = segments === 1 ? Math.PI * 2 : Math.PI * 2 * 0.62 / segments;
        for(let i = 0; i < segments; i++){
            const geo = new THREE.TorusGeometry(radius, tube, 8, Math.max(24, Math.round(96 * (arc / (Math.PI * 2)))), arc);
            const seg = new THREE.Mesh(geo, mat);
            seg.rotation.z = i / segments * Math.PI * 2;
            seg.layers.enable(LAYER_BLOOM);
            holder.add(seg);
            this.disposables.push(geo);
        }
        this.disposables.push(mat);
        this.group.add(holder);
        this.rings.push({
            mesh: holder,
            material: mat,
            speed,
            baseOpacity: opacity
        });
    }
    buildEnvironment(renderer) {
        let pmrem = null;
        try {
            pmrem = new THREE.PMREMGenerator(renderer);
            const envScene = new THREE.Scene();
            const skyMat = this.skyMaterial.clone();
            skyMat.uniforms.uTime = {
                value: 0
            };
            const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), skyMat);
            envScene.add(sky);
            const cardMat = (c)=>new THREE.MeshBasicMaterial({
                    color: c,
                    side: THREE.DoubleSide,
                    fog: false
                });
            const cardGeo = new THREE.PlaneGeometry(12, 5);
            const cardA = new THREE.Mesh(cardGeo, cardMat(0x9ad8ff));
            cardA.position.set(-6, 9, 4);
            cardA.lookAt(0, 0, 0);
            const cardB = new THREE.Mesh(cardGeo, cardMat(0xff8fd8));
            cardB.position.set(7, 7, -3);
            cardB.lookAt(0, 0, 0);
            const cardC = new THREE.Mesh(cardGeo, cardMat(0xffffff));
            cardC.position.set(0, 12, 0);
            cardC.lookAt(0, 0, 0);
            envScene.add(cardA, cardB, cardC);
            const floor = new THREE.Mesh(new THREE.CircleGeometry(80, 24), new THREE.MeshBasicMaterial({
                color: 0x08071a,
                fog: false
            }));
            floor.rotation.x = -Math.PI / 2;
            envScene.add(floor);
            const rt = pmrem.fromScene(envScene, 0.04, 0.5, 300);
            this.envTexture = rt.texture;
            sky.geometry.dispose();
            skyMat.dispose();
            cardGeo.dispose();
            cardA.material.dispose();
            cardB.material.dispose();
            cardC.material.dispose();
            floor.geometry.dispose();
            floor.material.dispose();
        } catch (err) {
            console.warn('[MenuBackdrop] environment map failed', err);
            this.envTexture = null;
        } finally{
            pmrem?.dispose();
        }
    }
    makeGridTexture() {
        const size = 256;
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        if (ctx) {
            ctx.fillStyle = '#0b0a19';
            ctx.fillRect(0, 0, size, size);
            ctx.strokeStyle = 'rgba(90, 100, 220, 0.55)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, 1);
            ctx.lineTo(size, 1);
            ctx.moveTo(1, 0);
            ctx.lineTo(1, size);
            ctx.stroke();
        }
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(70, 70);
        tex.anisotropy = 4;
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    }
}
