import * as THREE from 'three';
import { createEmptyInput } from '../core/types.js';
import { events } from '../core/events.js';
import { COUNTDOWN_STEP_SECONDS, FIXED_DT, KART_COUNT, MAX_FRAME_DT } from '../core/constants.js';
import { clamp, clamp01, damp } from '../core/math.js';
import { Kart } from '../kart/Kart.js';
import { InputManager } from '../kart/InputManager.js';
import { CHARACTERS, getCharacter } from '../kart/roster.js';
import { Track } from '../track/Track.js';
import { TRACKS, getTrackDef } from '../track/tracks/index.js';
import { ItemManager } from '../items/ItemManager.js';
import { buildItemIcon } from '../items/itemVisuals.js';
import { AIDriver } from '../ai/AIDriver.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { ParticleSystem } from '../fx/ParticleSystem.js';
import { PostFX } from '../fx/PostFX.js';
import { RaceManager } from './RaceManager.js';
import { FollowCamera } from './FollowCamera.js';
import { MenuBackdrop } from './MenuBackdrop.js';
import { HUD } from '../ui/HUD.js';
import { MainMenu } from '../ui/MainMenu.js';
import { ResultsScreen } from '../ui/ResultsScreen.js';
import { PauseMenu } from '../ui/PauseMenu.js';
import { LoadingScreen } from '../ui/LoadingScreen.js';
import { el } from '../ui/dom.js';
import { showToast } from '../ui/toast.js';
const MIN_LOADING_SECONDS = 0.8;
const MAX_COMPILE_WAIT_SECONDS = 8;
const RESULTS_DELAY_SECONDS = 1.6;
const MAX_STEPS_PER_FRAME = 8;
const SUN_DISTANCE = 90;
const SHADOW_HALF_EXTENT = 30;
const EMPTY_KARTS = [];
function framingFor(panel) {
    return panel === 'characterSelect' ? 'characters' : panel === 'trackSelect' ? 'tracks' : 'title';
}
export class Game {
    container;
    renderer;
    scene = new THREE.Scene();
    camera;
    uiRoot;
    input;
    audio;
    particles;
    postfx;
    postfxOk = true;
    backdrop;
    mainMenu;
    results;
    pauseMenu;
    loading;
    muteIndicator;
    state = 'boot';
    prePauseState = 'racing';
    race = null;
    pendingSettings = null;
    loadingElapsed = 0;
    loadingFrames = 0;
    loadingProgress = 0;
    shadersReady = false;
    rafId = 0;
    lastTime = -1;
    elapsed = 0;
    accumulator = 0;
    pendingUseItem = false;
    currentMusic = 'none';
    audioStarted = false;
    disposed = false;
    playerInput = createEmptyInput();
    unsubs = [];
    sunDir = new THREE.Vector3(0.4, 0.8, 0.3);
    tmpA = new THREE.Vector3();
    tmpB = new THREE.Vector3();
    tmpC = new THREE.Vector3();
    speedFx = 0;
    boostFx = 0;
    hitFx = 0;
    constructor(container){
        this.container = container;
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.domElement.className = 'game-canvas';
        container.appendChild(this.renderer.domElement);
        this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1200);
        this.camera.position.set(0, 3, 8);
        this.scene.add(this.camera);
        this.uiRoot = el('div', '', undefined, container);
        this.uiRoot.id = 'ui';
        this.input = new InputManager();
        this.audio = new AudioEngine();
        this.particles = new ParticleSystem();
        this.scene.add(this.particles.object);
        this.postfx = new PostFX();
        try {
            this.postfx.init(this.renderer, this.scene, this.camera);
        } catch (err) {
            console.error('[Game] PostFX init failed, using plain rendering', err);
            this.postfxOk = false;
        }
        this.backdrop = new MenuBackdrop();
        this.mainMenu = new MainMenu(this.uiRoot, CHARACTERS, TRACKS);
        this.mainMenu.onHighlight = (id)=>this.backdrop.setCharacter(getCharacter(id));
        this.mainMenu.onPanelChange = (panel)=>this.onMenuPanel(panel);
        this.mainMenu.onStart = (settings)=>this.startRace(settings);
        this.results = new ResultsScreen(this.uiRoot);
        this.results.onRaceAgain = ()=>{
            if (this.race) this.startRace(this.race.settings);
        };
        this.results.onChangeTrack = ()=>this.returnToMenu('trackSelect');
        this.results.onMainMenu = ()=>this.returnToMenu('title');
        this.pauseMenu = new PauseMenu(this.uiRoot);
        this.pauseMenu.onResume = ()=>this.resume();
        this.pauseMenu.onRestart = ()=>{
            const settings = this.race?.settings;
            this.leavePause();
            if (settings) this.startRace(settings);
            else this.returnToMenu('title');
        };
        this.pauseMenu.onQuit = ()=>{
            this.leavePause();
            this.returnToMenu('title');
        };
        this.loading = new LoadingScreen(this.uiRoot);
        this.muteIndicator = el('div', 'mute-indicator', '🔇 MUTED', this.uiRoot);
        window.addEventListener('resize', this.onResize);
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('pointerdown', this.onGesture, {
            passive: true
        });
        window.addEventListener('keydown', this.onGesture);
        window.addEventListener('blur', this.onBlur);
        document.addEventListener('visibilitychange', this.onVisibility);
        this.onResize();
    }
    start() {
        if (this.state !== 'boot') return;
        this.showMenu('title');
        this.lastTime = -1;
        this.rafId = requestAnimationFrame(this.loop);
    }
    get currentState() {
        return this.state;
    }
    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        cancelAnimationFrame(this.rafId);
        window.removeEventListener('resize', this.onResize);
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('pointerdown', this.onGesture);
        window.removeEventListener('keydown', this.onGesture);
        window.removeEventListener('blur', this.onBlur);
        document.removeEventListener('visibilitychange', this.onVisibility);
        for (const u of this.unsubs)u();
        this.unsubs.length = 0;
        this.disposeRace();
        this.backdrop.detach(this.scene);
        this.backdrop.dispose();
        this.mainMenu.dispose();
        this.results.dispose();
        this.pauseMenu.dispose();
        this.loading.dispose();
        this.muteIndicator.remove();
        this.input.dispose();
        this.safe(()=>this.audio.dispose());
        this.safe(()=>this.particles.dispose());
        this.safe(()=>this.postfx.dispose());
        this.renderer.dispose();
        this.renderer.domElement.remove();
        this.uiRoot.remove();
    }
    loop = (now)=>{
        if (this.disposed) return;
        this.rafId = requestAnimationFrame(this.loop);
        if (this.lastTime < 0) this.lastTime = now;
        let dt = (now - this.lastTime) / 1000;
        this.lastTime = now;
        if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
        if (dt < 0) dt = 0;
        this.elapsed += dt;
        const input = this.input.update();
        try {
            this.frame(dt, input);
        } catch (err) {
            console.error('[Game] frame error', err);
            events.emit('ui:error', {});
        }
    };
    frame(dt, input) {
        switch(this.state){
            case 'boot':
                return;
            case 'title':
            case 'characterSelect':
            case 'trackSelect':
                this.mainMenu.handleInput(input);
                this.backdrop.update(dt, this.camera);
                this.particles.update(dt, EMPTY_KARTS, this.camera);
                this.audio.update(dt, EMPTY_KARTS, -1, this.camera);
                this.render(dt);
                return;
            case 'loading':
                this.frameLoading(dt);
                return;
            case 'countdown':
            case 'racing':
            case 'finished':
                if (input.pause) {
                    this.pause();
                    this.render(dt);
                    return;
                }
                this.simulate(dt, input);
                this.renderRace(dt, this.state === 'racing' && input.lookBack);
                return;
            case 'paused':
                this.pauseMenu.handleInput(input);
                if (input.pause && this.state === 'paused') this.resume();
                this.render(dt);
                return;
            case 'results':
                this.results.handleInput(input);
                if (this.race && this.state === 'results') {
                    this.simulate(dt, input);
                    this.renderRace(dt, false);
                } else {
                    this.render(dt);
                }
                return;
        }
    }
    frameLoading(dt) {
        this.loading.update(dt);
        this.loadingElapsed += dt;
        this.loadingFrames++;
        if (!this.race && this.loadingFrames >= 2 && this.pendingSettings) {
            const settings = this.pendingSettings;
            try {
                this.buildRace(settings);
            } catch (err) {
                console.error('[Game] failed to build race', err);
                showToast('Could not build the race. Check the console for details.', 'error');
                this.pendingSettings = null;
                this.loading.hide();
                this.showMenu('title');
                return;
            }
            this.warmShaders();
        }
        const ready = this.race !== null && (this.shadersReady || this.loadingElapsed > MAX_COMPILE_WAIT_SECONDS);
        const target = !this.race ? 0.12 : ready ? 1 : 0.9;
        this.loadingProgress = damp(this.loadingProgress, target, ready ? 14 : 1.4, dt);
        this.loading.setProgress(this.loadingProgress);
        if (this.race && ready) {
            this.renderRace(dt, false);
            if (this.loadingElapsed >= MIN_LOADING_SECONDS && this.loadingProgress > 0.985) this.enterCountdown();
        }
    }
    warmShaders() {
        const r = this.race;
        this.shadersReady = false;
        if (!r) return;
        const renderer = this.renderer;
        if (typeof renderer.compileAsync !== 'function') {
            this.shadersReady = true;
            return;
        }
        let promise;
        try {
            promise = renderer.compileAsync.call(this.renderer, this.scene, this.camera);
        } catch (err) {
            console.warn('[Game] compileAsync threw; falling back to synchronous compile', err);
            this.shadersReady = true;
            return;
        }
        const done = ()=>{
            if (this.race === r) this.shadersReady = true;
        };
        promise.then(done, (err)=>{
            console.warn('[Game] compileAsync failed; falling back to synchronous compile', err);
            done();
        });
    }
    simulate(dt, input) {
        const r = this.race;
        if (!r) return;
        if (input.useItem) this.pendingUseItem = true;
        this.accumulator += dt;
        let steps = 0;
        while(this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME){
            this.step(FIXED_DT, r, input, this.pendingUseItem);
            this.pendingUseItem = false;
            this.accumulator -= FIXED_DT;
            steps++;
        }
        if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }
    step(dt, r, input, useItem) {
        const { track, karts, items } = r;
        const player = karts[0];
        if (r.playerAutoDriver) {
            r.playerAutoDriver.update(dt, track, karts, items, null);
        } else {
            const p = this.playerInput;
            p.throttle = input.throttle;
            p.brake = input.brake;
            p.steer = input.steer;
            p.drift = input.drift;
            p.useItem = useItem;
            p.useItemHeld = input.useItemHeld;
            p.lookBack = input.lookBack;
            p.pause = false;
            p.confirm = false;
            p.back = false;
            p.menuUp = false;
            p.menuDown = false;
            p.menuLeft = false;
            p.menuRight = false;
            player.setInput(p);
        }
        for(let i = 0; i < r.aiDrivers.length; i++){
            r.aiDrivers[i].update(dt, track, karts, items, player);
        }
        for(let i = 0; i < karts.length; i++){
            karts[i].update(dt, track, karts);
        }
        for(let i = 0; i < karts.length; i++){
            const k = karts[i];
            const inp = k.input;
            if (inp.useItem && !k.state.itemRouletteActive && k.state.item !== 'none') {
                items.requestUse(k, inp.brake > 0.5 || inp.lookBack);
            }
        }
        items.update(dt);
        r.raceManager.update(dt);
    }
    renderRace(dt, lookBack) {
        const r = this.race;
        if (!r) {
            this.render(dt);
            return;
        }
        const player = r.karts[0];
        for(let i = 0; i < r.karts.length; i++)r.karts[i].updateVisuals(dt);
        r.track.update(dt, this.elapsed);
        r.followCamera.update(dt, player, lookBack);
        this.updateSun(r, player);
        this.particles.update(dt, r.karts, this.camera);
        this.audio.update(dt, r.karts, player.state.id, this.camera);
        r.hud.update(dt, player, r.karts, r.raceManager.raceTime, r.raceManager.totalLaps);
        this.updatePostFxFeel(dt, player);
        if (this.state === 'finished' && r.resultsTimer > 0) {
            r.resultsTimer -= dt;
            if (r.resultsTimer <= 0) this.enterResults();
        }
        this.render(dt);
    }
    render(dt) {
        if (this.postfxOk) {
            try {
                this.postfx.render(dt);
                return;
            } catch (err) {
                console.error('[Game] PostFX render failed; falling back to plain rendering', err);
                this.postfxOk = false;
                this.safe(()=>this.postfx.setEnabled(false));
            }
        }
        this.renderer.render(this.scene, this.camera);
    }
    updateSun(r, player) {
        const p = player.state.position;
        const snap = 2;
        this.tmpA.set(Math.round(p.x / snap) * snap, Math.round(p.y / snap) * snap, Math.round(p.z / snap) * snap);
        r.sun.target.position.copy(this.tmpA);
        r.sun.position.copy(this.tmpA).addScaledVector(this.sunDir, SUN_DISTANCE);
        if (r.fill.visible) {
            r.fill.position.copy(this.camera.position);
            r.fill.position.y += 2;
            r.fill.target.position.copy(p);
        }
    }
    updatePostFxFeel(dt, player) {
        if (!this.postfxOk) return;
        const s = player.state;
        const top = Math.max(1, player.topSpeed());
        const speedTarget = clamp01((Math.abs(s.speed) - top * 0.55) / (top * 0.9));
        const boostTarget = s.isBoosting ? clamp01(0.45 + s.boostStrength) : s.isInvincible ? 0.35 : 0;
        this.speedFx = damp(this.speedFx, speedTarget, 5, dt);
        this.boostFx = damp(this.boostFx, boostTarget, s.isBoosting ? 12 : 4, dt);
        if (this.hitFx > 0) {
            this.hitFx = damp(this.hitFx, 0, 3, dt);
            if (this.hitFx < 0.005) this.hitFx = 0;
        }
        this.postfx.setSpeedEffect(this.speedFx);
        this.postfx.setBoostEffect(this.boostFx);
        this.postfx.setHitEffect(this.hitFx);
    }
    setState(next) {
        if (next === this.state) return;
        const from = this.state;
        this.state = next;
        this.uiRoot.dataset.state = next;
        events.emit('game:stateChange', {
            from,
            to: next
        });
    }
    showMenu(panel) {
        this.results.hide();
        this.pauseMenu.hide();
        this.loading.hide();
        this.backdrop.setCharacter(this.mainMenu.highlightedCharacter);
        this.backdrop.setFraming(framingFor(panel), true);
        this.backdrop.attach(this.scene, this.camera, this.renderer);
        this.mainMenu.show(panel);
        this.setState(panel);
        this.playMusic('menu');
    }
    onMenuPanel(panel) {
        if (this.state === 'title' || this.state === 'characterSelect' || this.state === 'trackSelect') {
            this.setState(panel);
            this.backdrop.setFraming(framingFor(panel));
        }
    }
    returnToMenu(panel) {
        this.disposeRace();
        this.showMenu(panel);
    }
    startRace(settings) {
        this.disposeRace();
        this.backdrop.detach(this.scene);
        this.mainMenu.hide();
        this.results.hide();
        this.pauseMenu.hide();
        this.safe(()=>this.particles.reset());
        let trackDef;
        try {
            trackDef = getTrackDef(settings.trackId);
        } catch  {
            trackDef = TRACKS[0];
        }
        if (!trackDef) {
            showToast('No tracks are available yet.', 'error');
            this.showMenu('title');
            return;
        }
        this.pendingSettings = {
            ...settings,
            trackId: trackDef.id
        };
        this.loadingElapsed = 0;
        this.loadingFrames = 0;
        this.loadingProgress = 0;
        this.shadersReady = false;
        this.loading.show(trackDef);
        this.scene.background = new THREE.Color(0x0b0b1a);
        this.scene.fog = null;
        this.setState('loading');
    }
    buildRace(settings) {
        const partial = {
            track: null,
            karts: [],
            items: null,
            followCamera: null,
            hud: null
        };
        try {
            this.buildRaceInner(settings, partial);
        } catch (err) {
            const { hud, followCamera, items, karts, track } = partial;
            if (hud) this.safe(()=>hud.dispose());
            if (followCamera) this.safe(()=>followCamera.dispose());
            if (items) this.safe(()=>items.dispose());
            for (const k of karts)this.safe(()=>k.dispose());
            if (track) this.safe(()=>track.dispose());
            throw err;
        }
    }
    buildRaceInner(settings, partial) {
        const trackDef = getTrackDef(settings.trackId);
        const track = new Track(trackDef);
        partial.track = track;
        const env = trackDef.environment;
        const karts = partial.karts;
        let playerChar;
        try {
            playerChar = getCharacter(settings.characterId);
        } catch  {
            playerChar = CHARACTERS[0];
        }
        const others = CHARACTERS.filter((c)=>c.id !== playerChar.id);
        for(let i = others.length - 1; i > 0; i--){
            const j = Math.floor(Math.random() * (i + 1));
            const t = others[i];
            others[i] = others[j];
            others[j] = t;
        }
        karts.push(new Kart(0, playerChar, true));
        for(let id = 1; id < KART_COUNT; id++){
            const def = others.length > 0 ? others[(id - 1) % others.length] : playerChar;
            karts.push(new Kart(id, def, false));
        }
        const difficulty = settings.difficulty;
        const aiDrivers = [];
        for(let id = 1; id < karts.length; id++){
            aiDrivers.push(new AIDriver(karts[id], difficulty, id));
        }
        const items = new ItemManager(this.particles);
        partial.items = items;
        items.init(track, karts);
        const raceManager = new RaceManager(track, karts, settings);
        const followCamera = new FollowCamera(this.camera);
        partial.followCamera = followCamera;
        followCamera.setTrack(track);
        const hud = new HUD(this.uiRoot, buildItemIcon);
        partial.hud = hud;
        hud.setTrack(track);
        const sun = new THREE.DirectionalLight(env.sunColor, env.sunIntensity);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        const sc = sun.shadow.camera;
        sc.left = -SHADOW_HALF_EXTENT;
        sc.right = SHADOW_HALF_EXTENT;
        sc.top = SHADOW_HALF_EXTENT;
        sc.bottom = -SHADOW_HALF_EXTENT;
        sc.near = 1;
        sc.far = SUN_DISTANCE + SHADOW_HALF_EXTENT * 3;
        sc.updateProjectionMatrix();
        sun.shadow.bias = -0.0005;
        sun.shadow.normalBias = 0.03;
        this.sunDir.set(env.sunDirection.x, env.sunDirection.y, env.sunDirection.z);
        if (this.sunDir.lengthSq() < 1e-6) this.sunDir.set(0.4, 0.8, 0.3);
        if (this.sunDir.y < 0) this.sunDir.y = -this.sunDir.y;
        if (this.sunDir.y < 0.15) this.sunDir.y = 0.15;
        this.sunDir.normalize();
        const hemi = new THREE.HemisphereLight(env.ambientSky, env.ambientGround, env.ambientIntensity);
        const darkness = clamp(0.9 - env.ambientIntensity, 0, 0.6) + clamp((1.6 - env.sunIntensity) * 0.3, 0, 0.3);
        const fill = new THREE.DirectionalLight(0xd9e4ff, darkness);
        fill.castShadow = false;
        fill.visible = darkness > 0.01;
        const fog = env.fogDensity > 0 ? new THREE.FogExp2(env.fogColor, env.fogDensity) : null;
        const background = new THREE.Color(env.skyHorizon);
        this.scene.add(track.object);
        for (const k of karts)this.scene.add(k.object);
        this.scene.add(items.object);
        this.scene.add(sun, sun.target, hemi, fill, fill.target);
        this.scene.fog = fog;
        this.scene.background = background;
        const r = {
            settings,
            trackDef,
            track,
            karts,
            aiDrivers,
            playerAutoDriver: null,
            items,
            raceManager,
            followCamera,
            hud,
            sun,
            hemi,
            fill,
            fog,
            background,
            unsubs: [],
            resultsTimer: 0
        };
        this.race = r;
        this.accumulator = 0;
        this.pendingUseItem = false;
        this.speedFx = 0;
        this.boostFx = 0;
        this.hitFx = 0;
        if (false) {
            if (new URLSearchParams(location.search).has('auto')) {
                r.playerAutoDriver = new AIDriver(karts[0], 'hard', 0);
            }
            window.__tkr = {
                game: this,
                getRace: ()=>this.race,
                renderer: this.renderer,
                events
            };
        }
        for (const k of karts)k.updateVisuals(0);
        followCamera.snapTo(karts[0]);
        this.updateSun(r, karts[0]);
        r.unsubs.push(events.on('race:start', ()=>{
            if (this.race === r && this.state === 'countdown') this.setState('racing');
        }), events.on('race:lap', (e)=>{
            if (this.race !== r || !e.isPlayer) return;
            if (e.isFinalLap) this.playMusic('finalLap');
        }), events.on('race:finish', (e)=>{
            if (this.race !== r || !e.isPlayer) return;
            this.onPlayerFinished(r);
        }), events.on('race:allFinished', ()=>{
            if (this.race !== r) return;
            if (this.state === 'finished') r.resultsTimer = RESULTS_DELAY_SECONDS;
            else if (this.state === 'racing' || this.state === 'countdown') this.enterResults();
        }), events.on('item:hit', (e)=>{
            if (this.race !== r || !e.isPlayer) return;
            this.hitFx = 1;
        }), events.on('item:lightning', ()=>{
            if (this.race !== r || !this.postfxOk) return;
            this.safe(()=>this.postfx.flash(0xffffff, 0.3));
        }));
    }
    enterCountdown() {
        const r = this.race;
        if (!r) return;
        this.pendingSettings = null;
        this.loading.hide();
        r.hud.show();
        const grid = r.track.startGrid;
        const center = this.tmpA.set(0, 0, 0);
        const n = Math.min(grid.length, KART_COUNT);
        if (n > 0) {
            for(let i = 0; i < n; i++)center.add(grid[i].position);
            center.multiplyScalar(1 / n);
        } else {
            center.copy(r.karts[0].state.position);
        }
        const forward = this.tmpB;
        r.karts[0].forwardDir(forward);
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        forward.y = 0;
        forward.normalize();
        const right = this.tmpC.set(-forward.z, 0, forward.x);
        const from = center.clone().addScaledVector(forward, 18).addScaledVector(right, 11);
        from.y += 6.5;
        const look = center.clone();
        look.y += 0.8;
        r.followCamera.setCinematic(from, look, 3 * COUNTDOWN_STEP_SECONDS, 46);
        r.raceManager.startCountdown();
        this.setState('countdown');
        this.playMusic('race');
    }
    onPlayerFinished(r) {
        if (this.state !== 'racing' && this.state !== 'countdown') return;
        try {
            r.playerAutoDriver = new AIDriver(r.karts[0], 'normal', 0);
        } catch (err) {
            console.warn('[Game] could not create auto-driver for the player', err);
            r.playerAutoDriver = null;
        }
        if (this.postfxOk) this.safe(()=>this.postfx.flash(0xffffff, 0.35));
        this.setState('finished');
        if (r.raceManager.allFinished) r.resultsTimer = RESULTS_DELAY_SECONDS;
    }
    enterResults() {
        const r = this.race;
        if (!r || this.state === 'results') return;
        r.hud.hide();
        this.results.show(r.raceManager.getStandings());
        this.setState('results');
        this.playMusic('results');
    }
    pause() {
        if (this.state !== 'countdown' && this.state !== 'racing' && this.state !== 'finished') return;
        this.prePauseState = this.state;
        this.setState('paused');
        this.pauseMenu.show();
        events.emit('game:pause', {});
    }
    resume() {
        if (this.state !== 'paused') return;
        this.pauseMenu.hide();
        this.accumulator = 0;
        this.pendingUseItem = false;
        this.setState(this.prePauseState);
        events.emit('game:resume', {});
    }
    leavePause() {
        this.pauseMenu.hide();
        if (this.state === 'paused') {
            events.emit('game:resume', {});
        }
    }
    disposeRace() {
        const r = this.race;
        if (!r) return;
        this.race = null;
        for (const u of r.unsubs)u();
        r.unsubs.length = 0;
        this.scene.remove(r.track.object);
        for (const k of r.karts)this.scene.remove(k.object);
        this.scene.remove(r.items.object);
        this.scene.remove(r.sun, r.sun.target, r.hemi, r.fill, r.fill.target);
        r.sun.dispose();
        r.hemi.dispose();
        r.fill.dispose();
        this.scene.fog = null;
        this.safe(()=>r.items.dispose());
        for (const k of r.karts)this.safe(()=>k.dispose());
        this.safe(()=>r.track.dispose());
        r.raceManager.dispose();
        r.followCamera.dispose();
        r.hud.dispose();
        this.safe(()=>this.particles.reset());
        if (this.postfxOk) {
            this.safe(()=>{
                this.postfx.setSpeedEffect(0);
                this.postfx.setBoostEffect(0);
                this.postfx.setHitEffect(0);
            });
        }
        this.accumulator = 0;
        this.pendingUseItem = false;
    }
    playMusic(track) {
        this.currentMusic = track;
        this.safe(()=>this.audio.playMusic(track));
    }
    onGesture = ()=>{
        if (this.audioStarted) return;
        this.audioStarted = true;
        window.removeEventListener('pointerdown', this.onGesture);
        window.removeEventListener('keydown', this.onGesture);
        this.audio.init().then(()=>{
            if (this.currentMusic !== 'none') this.safe(()=>this.audio.playMusic(this.currentMusic));
        }).catch((err)=>{
            console.warn('[Game] audio init failed', err);
            this.audioStarted = false;
            window.addEventListener('pointerdown', this.onGesture, {
                passive: true
            });
            window.addEventListener('keydown', this.onGesture);
        });
    };
    toggleMute() {
        const muted = !this.audio.muted;
        this.safe(()=>this.audio.setMuted(muted));
        this.muteIndicator.classList.toggle('visible', muted);
    }
    onResize = ()=>{
        const w = Math.max(1, this.container.clientWidth || window.innerWidth);
        const h = Math.max(1, this.container.clientHeight || window.innerHeight);
        const pr = Math.min(window.devicePixelRatio || 1, 2);
        this.renderer.setPixelRatio(pr);
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        if (this.postfxOk) {
            try {
                this.postfx.setSize(w, h, pr);
            } catch (err) {
                console.error('[Game] PostFX resize failed', err);
                this.postfxOk = false;
            }
        }
    };
    onKeyDown = (ev)=>{
        if (ev.repeat) return;
        if (ev.key === 'm' || ev.key === 'M') this.toggleMute();
    };
    onBlur = ()=>{
        if (this.state === 'racing' || this.state === 'countdown') this.pause();
    };
    onVisibility = ()=>{
        if (document.hidden) this.onBlur();
    };
    safe(fn) {
        try {
            fn();
        } catch (err) {
            console.error('[Game]', err);
        }
    }
}
