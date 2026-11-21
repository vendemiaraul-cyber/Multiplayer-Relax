import { ALL_ITEM_TYPES } from '../core/types.js';
import { events } from '../core/events.js';
import { BASE_TOP_SPEED } from '../core/constants.js';
import { clamp01, damp, formatRaceTime, ordinal } from '../core/math.js';
import { el, restartAnimation, TextField } from './dom.js';
import { Minimap } from './Minimap.js';
const ITEM_LABEL = {
    none: '',
    banana: 'BANANA',
    triple_banana: 'BANANA ×3',
    green_shell: 'GREEN SHELL',
    triple_green_shell: 'GREEN ×3',
    red_shell: 'RED SHELL',
    triple_red_shell: 'RED ×3',
    blue_shell: 'BLUE SHELL',
    mushroom: 'MUSHROOM',
    triple_mushroom: 'MUSHROOM ×3',
    golden_mushroom: 'GOLDEN',
    star: 'STAR',
    lightning: 'LIGHTNING',
    bob_omb: 'BOB-OMB'
};
const ITEM_FALLBACK_COLOR = {
    none: '#333',
    banana: '#ffd23f',
    triple_banana: '#ffd23f',
    green_shell: '#3ddc5a',
    triple_green_shell: '#3ddc5a',
    red_shell: '#ff4040',
    triple_red_shell: '#ff4040',
    blue_shell: '#3f7fff',
    mushroom: '#ff5a3a',
    triple_mushroom: '#ff5a3a',
    golden_mushroom: '#ffc800',
    star: '#ffe14a',
    lightning: '#ffef70',
    bob_omb: '#333344'
};
const GAUGE_ARC = 184.3;
const ROULETTE_FALLBACK_INTERVAL = 0.09;
const SPEED_MAX_KMH = BASE_TOP_SPEED * 3.6 * 1.7;
export class HUD {
    buildIcon;
    rootNode;
    minimap;
    unsubs = [];
    visible = false;
    playerId = 0;
    itemFrame;
    itemIconHost;
    itemCount;
    itemLabel;
    iconCache = new Map();
    shownIcon = 'none';
    shownCount = 0;
    rouletteTimer = 0;
    rouletteVisual = false;
    placeNode;
    placeNum;
    placeSuffix;
    lastPlace = 0;
    lapText;
    timerText;
    speedText;
    gaugeFill;
    gaugeValue = -1;
    speedSmooth = 0;
    center;
    wrongWay;
    wrongWayShown = false;
    vignette;
    vignetteAlpha = 0;
    vignetteApplied = -1;
    timed = [];
    boostGlow;
    boostGlowApplied = -1;
    constructor(root, buildIcon){
        this.buildIcon = buildIcon;
        this.rootNode = el('div', 'hud hidden', undefined, root);
        const itemWrap = el('div', 'hud-item', undefined, this.rootNode);
        this.itemFrame = el('div', 'item-frame', undefined, itemWrap);
        this.itemIconHost = el('div', 'item-icon', undefined, this.itemFrame);
        this.itemCount = new TextField(el('div', 'item-count', '', this.itemFrame));
        this.itemLabel = new TextField(el('div', 'item-label', '', itemWrap));
        const topRight = el('div', 'hud-topright', undefined, this.rootNode);
        const lapBox = el('div', 'hud-lap glass', undefined, topRight);
        el('span', 'hud-lap-label', 'LAP', lapBox);
        this.lapText = new TextField(el('span', 'hud-lap-value', '', lapBox));
        this.timerText = new TextField(el('div', 'hud-timer glass', '0:00.000', topRight));
        this.placeNode = el('div', 'hud-place', undefined, this.rootNode);
        this.placeNum = new TextField(el('span', 'place-num', '', this.placeNode));
        this.placeSuffix = new TextField(el('span', 'place-suffix', '', this.placeNode));
        const speedWrap = el('div', 'hud-speed', undefined, this.rootNode);
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.classList.add('gauge');
        const bg = document.createElementNS(svgNS, 'circle');
        bg.setAttribute('cx', '50');
        bg.setAttribute('cy', '50');
        bg.setAttribute('r', '44');
        bg.classList.add('gauge-bg');
        bg.setAttribute('stroke-dasharray', `${GAUGE_ARC} 276.5`);
        svg.appendChild(bg);
        this.gaugeFill = document.createElementNS(svgNS, 'circle');
        this.gaugeFill.setAttribute('cx', '50');
        this.gaugeFill.setAttribute('cy', '50');
        this.gaugeFill.setAttribute('r', '44');
        this.gaugeFill.classList.add('gauge-fill');
        this.gaugeFill.setAttribute('stroke-dasharray', `0 276.5`);
        svg.appendChild(this.gaugeFill);
        speedWrap.appendChild(svg);
        const speedInner = el('div', 'speed-inner', undefined, speedWrap);
        this.speedText = new TextField(el('div', 'speed-value', '0', speedInner));
        el('div', 'speed-unit', 'km/h', speedInner);
        const mapWrap = el('div', 'hud-minimap glass', undefined, this.rootNode);
        this.minimap = new Minimap(mapWrap);
        this.center = el('div', 'hud-center', undefined, this.rootNode);
        this.wrongWay = el('div', 'hud-wrongway', undefined, this.rootNode);
        el('span', 'wrongway-arrow', '⟲', this.wrongWay);
        el('span', 'wrongway-text', 'WRONG WAY', this.wrongWay);
        this.vignette = el('div', 'hud-vignette', undefined, this.rootNode);
        this.boostGlow = el('div', 'hud-boostglow', undefined, this.rootNode);
        this.subscribe();
    }
    setTrack(track) {
        this.minimap.setTrack(track);
    }
    show() {
        this.rootNode.classList.remove('hidden');
        this.visible = true;
    }
    hide() {
        this.rootNode.classList.add('hidden');
        this.visible = false;
    }
    update(dt, player, karts, raceTime, totalLaps) {
        if (!this.visible) return;
        const s = player.state;
        this.playerId = s.id;
        const place = s.place > 0 ? s.place : karts.length;
        if (place !== this.lastPlace) {
            this.lastPlace = place;
            const ord = ordinal(place);
            this.placeNum.set(String(place));
            this.placeSuffix.set(ord.slice(String(place).length));
            this.placeNode.classList.toggle('gold', place === 1);
            this.placeNode.classList.toggle('silver', place === 2);
            this.placeNode.classList.toggle('bronze', place === 3);
            restartAnimation(this.placeNode, 'punch');
        }
        const lapShown = Math.min(Math.max(1, s.lap), totalLaps);
        this.lapText.set(`${lapShown}/${totalLaps}`);
        this.timerText.set(formatRaceTime(raceTime));
        const kmh = Math.abs(s.speed) * 3.6;
        this.speedSmooth = damp(this.speedSmooth, kmh, 12, dt);
        this.speedText.set(String(Math.round(this.speedSmooth)));
        const g = clamp01(this.speedSmooth / SPEED_MAX_KMH);
        if (Math.abs(g - this.gaugeValue) > 0.004) {
            this.gaugeValue = g;
            this.gaugeFill.setAttribute('stroke-dasharray', `${(g * GAUGE_ARC).toFixed(1)} 276.5`);
        }
        const boost = s.isBoosting ? 1 : 0;
        if (boost !== this.boostGlowApplied) {
            this.boostGlowApplied = boost;
            this.boostGlow.classList.toggle('on', boost === 1);
            this.rootNode.classList.toggle('boosting', boost === 1);
        }
        this.updateItemSlot(dt, s.item, s.itemCount, s.itemRouletteActive);
        if (s.wrongWay !== this.wrongWayShown) {
            this.wrongWayShown = s.wrongWay;
            this.wrongWay.classList.toggle('visible', s.wrongWay);
        }
        if (this.vignetteAlpha > 0.001) {
            this.vignetteAlpha = damp(this.vignetteAlpha, 0, 3.5, dt);
            if (this.vignetteAlpha < 0.001) this.vignetteAlpha = 0;
        }
        if (Math.abs(this.vignetteAlpha - this.vignetteApplied) > 0.01) {
            this.vignetteApplied = this.vignetteAlpha;
            this.vignette.style.opacity = this.vignetteAlpha.toFixed(2);
        }
        for(let i = this.timed.length - 1; i >= 0; i--){
            const t = this.timed[i];
            t.ttl -= dt;
            if (t.ttl <= 0) {
                t.node.remove();
                this.timed.splice(i, 1);
            }
        }
        this.minimap.update(dt, karts, s.id);
    }
    dispose() {
        for (const u of this.unsubs)u();
        this.unsubs.length = 0;
        this.minimap.dispose();
        this.rootNode.remove();
    }
    subscribe() {
        const on = events.on.bind(events);
        this.unsubs.push(on('item:rouletteTick', (e)=>{
            if (!e.isPlayer && e.kartId !== this.playerId) return;
            this.rouletteVisual = true;
            this.rouletteTimer = 0;
            this.setIcon(this.randomItem(), false);
            this.itemFrame.classList.add('spinning');
        }), on('item:rouletteEnd', (e)=>{
            if (!e.isPlayer && e.kartId !== this.playerId) return;
            this.rouletteVisual = false;
            this.itemFrame.classList.remove('spinning');
            this.setIcon(e.item, true);
        }), on('race:countdown', (e)=>{
            this.flashCenter(String(e.count), 'hud-count', 0.95);
        }), on('race:start', ()=>{
            this.flashCenter('GO!', 'hud-count hud-go', 1.1);
        }), on('race:lap', (e)=>{
            if (!e.isPlayer) return;
            if (e.isFinalLap) this.flashCenter('FINAL LAP!', 'hud-banner final', 2.4);
            else if (e.lap > 1) this.flashCenter(`LAP ${e.lap}`, 'hud-banner lap', 1.4);
        }), on('race:positionChange', (e)=>{
            if (!e.isPlayer) return;
            const up = e.to < e.from;
            this.flashCenter(`${up ? '▲' : '▼'} ${ordinal(e.to).toUpperCase()}`, `hud-posflash ${up ? 'up' : 'down'}`, 1.0);
        }), on('item:hit', (e)=>{
            if (!e.isPlayer) return;
            this.vignetteAlpha = 1;
            restartAnimation(this.rootNode, 'hit-shake');
        }), on('race:finish', (e)=>{
            if (!e.isPlayer) return;
            const node = this.flashCenter('FINISH', 'hud-finish', 4.5);
            el('div', 'hud-finish-place', ordinal(e.place).toUpperCase() + ' PLACE', node);
        }), on('kart:respawn', (e)=>{
            if (e.kartId !== this.playerId) return;
            this.vignetteAlpha = Math.max(this.vignetteAlpha, 0.6);
        }));
    }
    randomItem() {
        return ALL_ITEM_TYPES[Math.floor(Math.random() * ALL_ITEM_TYPES.length)];
    }
    updateItemSlot(dt, item, count, rouletteActive) {
        if (rouletteActive) {
            this.rouletteTimer += dt;
            if (this.rouletteTimer >= ROULETTE_FALLBACK_INTERVAL) {
                this.rouletteTimer = 0;
                this.rouletteVisual = true;
                this.setIcon(this.randomItem(), false);
                this.itemFrame.classList.add('spinning');
            }
            if (this.shownCount !== 0) {
                this.shownCount = 0;
                this.itemCount.set('');
            }
            return;
        }
        if (this.rouletteVisual) {
            this.rouletteVisual = false;
            this.itemFrame.classList.remove('spinning');
            this.setIcon(item, true);
        } else if (item !== this.shownIcon) {
            this.setIcon(item, item !== 'none');
        }
        const shownCount = item === 'none' || count <= 1 ? 0 : count;
        if (shownCount !== this.shownCount) {
            this.shownCount = shownCount;
            this.itemCount.set(shownCount > 0 ? `×${shownCount}` : '');
        }
    }
    setIcon(item, pop) {
        if (item === this.shownIcon && !pop) return;
        this.shownIcon = item;
        this.itemIconHost.replaceChildren();
        if (item !== 'none') {
            this.itemIconHost.appendChild(this.getIcon(item));
        }
        this.itemFrame.classList.toggle('has-item', item !== 'none');
        this.itemLabel.set(this.rouletteVisual ? '' : ITEM_LABEL[item]);
        if (pop) restartAnimation(this.itemFrame, 'pop');
    }
    getIcon(item) {
        let icon = this.iconCache.get(item);
        if (icon) return icon;
        try {
            icon = this.buildIcon(item);
            if (!(icon instanceof HTMLCanvasElement)) throw new Error('buildItemIcon did not return a canvas');
        } catch (err) {
            console.warn('[HUD] item icon fallback for', item, err);
            icon = this.fallbackIcon(item);
        }
        icon.classList.add('item-icon-canvas');
        this.iconCache.set(item, icon);
        return icon;
    }
    fallbackIcon(item) {
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 64;
        const ctx = c.getContext('2d');
        if (ctx) {
            ctx.fillStyle = ITEM_FALLBACK_COLOR[item];
            ctx.beginPath();
            ctx.arc(32, 32, 26, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 22px Impact, "Arial Narrow", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(item.replace(/^triple_/, '')[0]?.toUpperCase() ?? '?', 32, 34);
        }
        return c;
    }
    flashCenter(text, cls, ttl) {
        const node = el('div', `hud-msg ${cls}`, text, this.center);
        node.style.setProperty('--ttl', `${ttl}s`);
        this.timed.push({
            node,
            ttl
        });
        return node;
    }
}
