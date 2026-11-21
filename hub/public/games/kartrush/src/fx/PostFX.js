import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { events } from '../core/events.js';
import { clamp01, damp } from '../core/math.js';
import { COMPOSITE_FRAGMENT, COMPOSITE_VERTEX } from './shaders.js';
const BLOOM_STRENGTH = 0.35;
const BLOOM_RADIUS = 0.35;
const BLOOM_THRESHOLD = 0.9;
const HIT_EVENT_DECAY = 0.6;
const GRAIN_REST = 0.012;
const GRAIN_BOOST = 0.008;
export class PostFX {
    renderer = null;
    scene = null;
    camera = null;
    composer = null;
    renderPass = null;
    bloomPass = null;
    compositePass = null;
    outputPass = null;
    enabled = true;
    failed = false;
    speedTarget = 0;
    boostTarget = 0;
    hitTarget = 0;
    speed = 0;
    boost = 0;
    hit = 0;
    hitPulse = 0;
    flashLevel = 0;
    flashDuration = 0;
    flashPeak = 0;
    time = 0;
    width = 1;
    height = 1;
    pixelRatio = 1;
    flashColor = new THREE.Color(1, 1, 1);
    unsubs = [];
    constructor(){
        this.unsubs.push(events.on('item:lightning', ()=>this.flash(0xcfe6ff, 0.5)));
        this.unsubs.push(events.on('item:hit', (e)=>{
            if (e.isPlayer) this.hitPulse = 1;
        }));
        this.unsubs.push(events.on('kart:spin', (e)=>{
            if (e.kartId === 0) this.hitPulse = Math.max(this.hitPulse, 0.8);
        }));
    }
    init(renderer, scene, camera) {
        this.disposePipeline();
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.failed = false;
        const size = renderer.getSize(new THREE.Vector2());
        this.width = Math.max(1, size.x);
        this.height = Math.max(1, size.y);
        this.pixelRatio = renderer.getPixelRatio();
        try {
            const bufW = Math.max(1, Math.floor(this.width * this.pixelRatio));
            const bufH = Math.max(1, Math.floor(this.height * this.pixelRatio));
            const target = new THREE.WebGLRenderTarget(bufW, bufH, {
                type: THREE.HalfFloatType,
                samples: 0,
                depthBuffer: true,
                stencilBuffer: false
            });
            const composer = new EffectComposer(renderer, target);
            composer.setPixelRatio(this.pixelRatio);
            composer.setSize(this.width, this.height);
            const renderPass = new RenderPass(scene, camera);
            const bloom = new UnrealBloomPass(new THREE.Vector2(bufW, bufH), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
            const composite = new ShaderPass({
                uniforms: {
                    tDiffuse: {
                        value: null
                    },
                    uResolution: {
                        value: new THREE.Vector2(bufW, bufH)
                    },
                    uTime: {
                        value: 0
                    },
                    uSpeed: {
                        value: 0
                    },
                    uBoost: {
                        value: 0
                    },
                    uHit: {
                        value: 0
                    },
                    uFlash: {
                        value: 0
                    },
                    uFlashColor: {
                        value: new THREE.Color(1, 1, 1)
                    },
                    uGrain: {
                        value: GRAIN_REST
                    }
                },
                vertexShader: COMPOSITE_VERTEX,
                fragmentShader: COMPOSITE_FRAGMENT
            });
            const output = new OutputPass();
            composer.addPass(renderPass);
            composer.addPass(bloom);
            composer.addPass(composite);
            composer.addPass(output);
            this.composer = composer;
            this.renderPass = renderPass;
            this.bloomPass = bloom;
            this.compositePass = composite;
            this.outputPass = output;
        } catch (err) {
            console.warn('[PostFX] failed to build pipeline, falling back to plain rendering', err);
            this.failed = true;
            this.disposePipeline();
        }
    }
    setCamera(camera) {
        this.camera = camera;
        if (this.renderPass) this.renderPass.camera = camera;
    }
    render(dt) {
        const renderer = this.renderer;
        const scene = this.scene;
        const camera = this.camera;
        if (!renderer || !scene || !camera) return;
        dt = Math.min(Math.max(dt, 0), 0.1);
        this.time += dt;
        this.speed = damp(this.speed, this.speedTarget, 6, dt);
        this.boost = damp(this.boost, this.boostTarget, this.boostTarget > this.boost ? 10 : 4, dt);
        if (this.hitPulse > 0) this.hitPulse = Math.max(0, this.hitPulse - dt / HIT_EVENT_DECAY);
        this.hit = damp(this.hit, Math.max(this.hitTarget, this.hitPulse), 12, dt);
        if (this.flashLevel > 0 && this.flashDuration > 0) {
            this.flashLevel = Math.max(0, this.flashLevel - dt / this.flashDuration);
        } else {
            this.flashLevel = 0;
        }
        if (!this.enabled || this.failed || !this.composer || !this.compositePass) {
            renderer.render(scene, camera);
            return;
        }
        const u = this.compositePass.uniforms;
        u.uTime.value = this.time;
        u.uSpeed.value = this.speed;
        u.uBoost.value = this.boost;
        u.uHit.value = this.hit;
        u.uGrain.value = GRAIN_REST + GRAIN_BOOST * this.boost;
        const f = this.flashLevel;
        u.uFlash.value = this.flashPeak * f * f;
        u.uFlashColor.value.copy(this.flashColor);
        try {
            this.composer.render(dt);
        } catch (err) {
            console.warn('[PostFX] composer render failed, disabling post-processing', err);
            this.failed = true;
            renderer.render(scene, camera);
        }
    }
    setSize(width, height, pixelRatio) {
        this.width = Math.max(1, width);
        this.height = Math.max(1, height);
        this.pixelRatio = Math.max(0.5, pixelRatio);
        if (this.composer) {
            this.composer.setPixelRatio(this.pixelRatio);
            this.composer.setSize(this.width, this.height);
        }
        if (this.compositePass) {
            this.compositePass.uniforms.uResolution.value.set(Math.max(1, Math.floor(this.width * this.pixelRatio)), Math.max(1, Math.floor(this.height * this.pixelRatio)));
        }
    }
    setSpeedEffect(intensity) {
        this.speedTarget = clamp01(intensity);
    }
    setBoostEffect(intensity) {
        this.boostTarget = clamp01(intensity);
    }
    setHitEffect(intensity) {
        this.hitTarget = clamp01(intensity);
    }
    flash(color, duration) {
        this.flashColor.setHex(color);
        this.flashDuration = Math.max(0.05, duration);
        this.flashLevel = 1;
        this.flashPeak = 0.9;
    }
    setEnabled(enabled) {
        this.enabled = enabled;
    }
    disposePipeline() {
        this.bloomPass?.dispose();
        this.compositePass?.dispose();
        this.outputPass?.dispose();
        this.renderPass?.dispose();
        this.composer?.dispose();
        this.composer = null;
        this.renderPass = null;
        this.bloomPass = null;
        this.compositePass = null;
        this.outputPass = null;
    }
    dispose() {
        for (const off of this.unsubs)off();
        this.unsubs.length = 0;
        this.disposePipeline();
        this.renderer = null;
        this.scene = null;
        this.camera = null;
    }
}
