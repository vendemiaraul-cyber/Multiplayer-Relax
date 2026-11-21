import * as THREE from 'three';
import { events } from '../core/events.js';
import { clamp01 } from '../core/math.js';
import { KART_COUNT } from '../core/constants.js';
import { dbToGain, softClipCurve } from './synth.js';
import { EngineVoice, setListenerPose } from './engine.js';
import { Crowd, SfxBank } from './sfx.js';
import { MusicPlayer, Sequencer, buildStarJingle, warmMusic } from './music.js';
const MUSIC_BUS_DB = -6;
const ENGINES_BUS_GAIN = 0.85;
const UI_BUS_GAIN = 0.5;
const STAR_DUCK_DB = -8;
const LIGHTNING_DUCK_DB = -10;
const LIGHTNING_DUCK_SECONDS = 1.0;
const STAR_AUDIBLE_DISTANCE = 25;
const RICH_VOICE_COUNT = 4;
const VOICE_TIER_INTERVAL = 0.5;
const MAX_VOICES = Math.max(KART_COUNT, 16);
export class AudioEngine {
    ctx = null;
    master = null;
    compressor = null;
    limiter = null;
    musicBus = null;
    musicDuck = null;
    sfxBus = null;
    enginesBus = null;
    enginesClip = null;
    uiBus = null;
    sfx = null;
    music = null;
    crowd = null;
    starJingle = null;
    engines = new Array(MAX_VOICES).fill(null);
    frame = 0;
    voiceTierTimer = 0;
    _ready = false;
    _muted = false;
    masterVolume = 1;
    pendingTrack = 'none';
    starFlags = new Uint8Array(MAX_VOICES);
    lightningDuck = 0;
    lastDuckDb = 0;
    disposed = false;
    initPromise = null;
    unsubs = [];
    camPos = new THREE.Vector3();
    camFwd = new THREE.Vector3();
    camUp = new THREE.Vector3();
    camRight = new THREE.Vector3();
    constructor(){
        const u = this.unsubs;
        u.push(events.on('kart:starStart', (e)=>{
            if (e.kartId >= 0 && e.kartId < MAX_VOICES) this.starFlags[e.kartId] = 1;
        }));
        u.push(events.on('kart:starEnd', (e)=>{
            if (e.kartId >= 0 && e.kartId < MAX_VOICES) this.starFlags[e.kartId] = 0;
        }));
        u.push(events.on('item:lightning', ()=>{
            this.lightningDuck = LIGHTNING_DUCK_SECONDS;
        }));
        u.push(events.on('race:lap', (e)=>{
            if (!e.isPlayer) return;
            this.crowd?.cheerBurst(0.5);
            if (e.isFinalLap && this.music && this.music.track === 'race') this.playMusic('finalLap');
        }));
        u.push(events.on('race:start', ()=>this.crowd?.cheerBurst(1)));
        u.push(events.on('race:finish', (e)=>{
            if (e.isPlayer) this.crowd?.cheerBurst(1);
        }));
    }
    get ready() {
        return this._ready;
    }
    get muted() {
        return this._muted;
    }
    init() {
        if (this.disposed) return Promise.resolve();
        if (this.initPromise) return this.initPromise;
        this.initPromise = this.doInit().finally(()=>{
            this.initPromise = null;
        });
        return this.initPromise;
    }
    async doInit() {
        if (!this.ctx) {
            const Ctor = window.AudioContext ?? window.webkitAudioContext;
            if (!Ctor) {
                console.warn('[AudioEngine] Web Audio API unavailable');
                return;
            }
            try {
                const ctx = new Ctor({
                    latencyHint: 'interactive'
                });
                this.ctx = ctx;
                this.buildGraph(ctx);
            } catch (err) {
                console.warn('[AudioEngine] failed to create AudioContext', err);
                this.ctx = null;
                return;
            }
        }
        const ctx = this.ctx;
        if (ctx.state !== 'running') {
            try {
                await ctx.resume();
            } catch (err) {
                console.warn('[AudioEngine] resume failed (needs a user gesture)', err);
            }
        }
        if (ctx.state === 'running' && !this._ready && !this.disposed) {
            this._ready = true;
            if (this.pendingTrack !== 'none' && this.music) this.music.play(this.pendingTrack);
        }
    }
    buildGraph(ctx) {
        const master = ctx.createGain();
        master.gain.value = this._muted ? 0 : this.masterVolume;
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -12;
        compressor.knee.value = 20;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -3;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.001;
        limiter.release.value = 0.08;
        master.connect(compressor);
        compressor.connect(limiter);
        limiter.connect(ctx.destination);
        const bus = (gain, dest)=>{
            const g = ctx.createGain();
            g.gain.value = gain;
            g.connect(dest);
            return g;
        };
        const musicDuck = bus(1, master);
        const musicBus = bus(dbToGain(MUSIC_BUS_DB), musicDuck);
        const sfxBus = bus(1, master);
        const enginesClip = ctx.createWaveShaper();
        enginesClip.curve = softClipCurve(1.6, 2048);
        enginesClip.oversample = 'none';
        enginesClip.connect(master);
        const enginesBus = bus(ENGINES_BUS_GAIN, enginesClip);
        const uiBus = bus(UI_BUS_GAIN, master);
        this.master = master;
        this.compressor = compressor;
        this.limiter = limiter;
        this.musicDuck = musicDuck;
        this.musicBus = musicBus;
        this.sfxBus = sfxBus;
        this.enginesBus = enginesBus;
        this.enginesClip = enginesClip;
        this.uiBus = uiBus;
        this.lastDuckDb = 0;
        warmMusic(ctx);
        this.sfx = new SfxBank(ctx, {
            sfx: sfxBus,
            ui: uiBus
        });
        this.music = new MusicPlayer(ctx, musicBus);
        this.crowd = new Crowd(ctx, sfxBus);
    }
    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        for (const off of this.unsubs)off();
        this.unsubs.length = 0;
        for(let i = 0; i < this.engines.length; i++){
            const slot = this.engines[i];
            if (slot) slot.voice.dispose();
            this.engines[i] = null;
        }
        this.starFlags.fill(0);
        this.music?.dispose();
        this.music = null;
        this.starJingle?.dispose();
        this.starJingle = null;
        this.crowd?.dispose();
        this.crowd = null;
        this.sfx?.dispose();
        this.sfx = null;
        const ctx = this.ctx;
        this.ctx = null;
        this._ready = false;
        if (ctx) {
            const close = ()=>{
                ctx.close().catch(()=>undefined);
            };
            setTimeout(close, 400);
        }
        this.master = null;
        this.compressor = null;
        this.limiter = null;
        this.musicBus = null;
        this.musicDuck = null;
        this.sfxBus = null;
        this.enginesBus = null;
        this.enginesClip = null;
        this.uiBus = null;
    }
    update(dt, karts, playerKartId, camera) {
        const ctx = this.ctx;
        if (!this._ready || !ctx || this.disposed || !this.sfx || !this.enginesBus) return;
        dt = Math.min(Math.max(dt, 0), 0.1);
        const now = ctx.currentTime;
        this.frame++;
        const e = camera.matrixWorld.elements;
        this.camPos.set(e[12], e[13], e[14]);
        this.camFwd.set(-e[8], -e[9], -e[10]).normalize();
        this.camUp.set(e[4], e[5], e[6]).normalize();
        this.camRight.crossVectors(this.camFwd, this.camUp).normalize();
        setListenerPose(ctx.listener, this.camPos.x, this.camPos.y, this.camPos.z, this.camFwd.x, this.camFwd.y, this.camFwd.z, this.camUp.x, this.camUp.y, this.camUp.z);
        const L = this.sfx.listener;
        L.pos.copy(this.camPos);
        L.forward.copy(this.camFwd);
        L.up.copy(this.camUp);
        L.right.copy(this.camRight);
        this.sfx.karts = karts;
        this.sfx.playerKartId = playerKartId;
        const engines = this.engines;
        let playerKart = null;
        for(let i = 0; i < karts.length; i++){
            const kart = karts[i];
            const st = kart.state;
            const id = st.id;
            if (id === playerKartId) playerKart = kart;
            if (id < 0 || id >= MAX_VOICES) continue;
            const isPlayer = id === playerKartId || st.isPlayer;
            let slot = engines[id];
            if (!slot) {
                slot = {
                    voice: new EngineVoice(ctx, this.enginesBus, id, st.character.weightClass, isPlayer),
                    lastSeen: this.frame,
                    distance: 0
                };
                engines[id] = slot;
            }
            slot.lastSeen = this.frame;
            slot.distance = st.position.distanceTo(this.camPos);
            slot.voice.update(dt, st, kart.input.throttle, kart.topSpeed());
        }
        for(let i = 0; i < engines.length; i++){
            const slot = engines[i];
            if (slot && slot.lastSeen !== this.frame) {
                slot.voice.dispose();
                engines[i] = null;
            }
        }
        this.voiceTierTimer -= dt;
        if (this.voiceTierTimer <= 0) {
            this.voiceTierTimer = VOICE_TIER_INTERVAL;
            this.assignVoiceTiers();
        }
        let starAudible = false;
        const flags = this.starFlags;
        for(let id = 0; id < flags.length; id++){
            if (flags[id] === 0) continue;
            const kart = findKart(karts, id);
            if (!kart || !kart.state.isInvincible) {
                flags[id] = 0;
                continue;
            }
            if (kart.state.isPlayer || id === playerKartId || kart.state.position.distanceTo(this.camPos) <= STAR_AUDIBLE_DISTANCE) {
                starAudible = true;
            }
        }
        if (starAudible && !this.starJingle && this.sfxBus) {
            const seq = new Sequencer(ctx, this.sfxBus, buildStarJingle());
            seq.start(now + 0.05, 0.15);
            this.starJingle = seq;
        } else if (!starAudible && this.starJingle) {
            this.starJingle.stop(0.35);
            this.starJingle = null;
        }
        let duckDb = 0;
        if (starAudible) duckDb = Math.min(duckDb, STAR_DUCK_DB);
        if (this.lightningDuck > 0) {
            this.lightningDuck -= dt;
            duckDb = Math.min(duckDb, LIGHTNING_DUCK_DB);
        }
        if (duckDb !== this.lastDuckDb && this.musicDuck) {
            this.lastDuckDb = duckDb;
            this.musicDuck.gain.setTargetAtTime(dbToGain(duckDb), now, 0.12);
        }
        this.crowd?.update(dt, playerKart ? playerKart.state.trackT : null);
    }
    assignVoiceTiers() {
        const engines = this.engines;
        let richLeft = RICH_VOICE_COUNT;
        for(let i = 0; i < engines.length; i++){
            const slot = engines[i];
            if (slot && slot.voice.isPlayer) {
                slot.voice.setRich(true);
                richLeft--;
            }
        }
        let picked = 0;
        while(picked < richLeft){
            let best = null;
            for(let i = 0; i < engines.length; i++){
                const slot = engines[i];
                if (!slot || slot.voice.isPlayer || slot.distance < 0) continue;
                if (!best || slot.distance < best.distance) best = slot;
            }
            if (!best) break;
            best.voice.setRich(true);
            best.distance = -1 - best.distance;
            picked++;
        }
        for(let i = 0; i < engines.length; i++){
            const slot = engines[i];
            if (!slot || slot.voice.isPlayer) continue;
            if (slot.distance < 0) {
                slot.distance = -1 - slot.distance;
            } else {
                slot.voice.setRich(false);
            }
        }
    }
    playMusic(track) {
        this.pendingTrack = track;
        if (!this._ready || !this.music) return;
        this.music.play(track);
    }
    stopMusic() {
        this.pendingTrack = 'none';
        this.music?.stop();
    }
    setMasterVolume(v) {
        this.masterVolume = clamp01(v);
        if (this.master && this.ctx && !this._muted) {
            this.master.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.05);
        }
    }
    setMuted(muted) {
        this._muted = muted;
        if (this.master && this.ctx) {
            const g = this.master.gain;
            const now = this.ctx.currentTime;
            g.cancelScheduledValues(now);
            g.setValueAtTime(g.value, now);
            g.linearRampToValueAtTime(muted ? 0 : this.masterVolume, now + 0.12);
        }
    }
}
function findKart(karts, id) {
    if (id >= 0 && id < karts.length && karts[id].state.id === id) return karts[id];
    for(let i = 0; i < karts.length; i++)if (karts[i].state.id === id) return karts[i];
    return null;
}
