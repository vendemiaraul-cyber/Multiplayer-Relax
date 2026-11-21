const MIN_GAIN = 0.0001;
export function dbToGain(db) {
    return Math.pow(10, db / 20);
}
export function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
}
const noiseCache = new WeakMap();
export function noiseBuffer(ctx, color = 'white', seconds = 2) {
    let map = noiseCache.get(ctx);
    if (!map) {
        map = new Map();
        noiseCache.set(ctx, map);
    }
    const cached = map.get(color);
    if (cached) return cached;
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    if (color === 'white') {
        for(let i = 0; i < length; i++)data[i] = Math.random() * 2 - 1;
    } else if (color === 'pink') {
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for(let i = 0; i < length; i++){
            const w = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + w * 0.0555179;
            b1 = 0.99332 * b1 + w * 0.0750759;
            b2 = 0.969 * b2 + w * 0.153852;
            b3 = 0.8665 * b3 + w * 0.3104856;
            b4 = 0.55 * b4 + w * 0.5329522;
            b5 = -0.7616 * b5 - w * 0.016898;
            data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
            b6 = w * 0.115926;
        }
    } else {
        let last = 0;
        for(let i = 0; i < length; i++){
            const w = Math.random() * 2 - 1;
            last = (last + 0.02 * w) / 1.02;
            data[i] = last * 3.5;
        }
    }
    map.set(color, buffer);
    return buffer;
}
export function adsr(param, when, peak, duration, env = {}) {
    const a = Math.max(0.001, env.attack ?? 0.005);
    const d = Math.max(0.001, env.decay ?? 0.05);
    const s = Math.min(1, Math.max(0, env.sustain ?? 0.6));
    const r = Math.max(0.005, env.release ?? 0.05);
    const p = Math.max(MIN_GAIN, peak);
    const sustainLevel = Math.max(MIN_GAIN, p * s);
    param.cancelScheduledValues(when);
    param.setValueAtTime(MIN_GAIN, when);
    param.linearRampToValueAtTime(p, when + a);
    param.exponentialRampToValueAtTime(sustainLevel, when + a + d);
    const relStart = Math.max(when + a + d, when + duration);
    param.setValueAtTime(sustainLevel, relStart);
    param.exponentialRampToValueAtTime(MIN_GAIN, relStart + r);
    return relStart + r;
}
export function sweep(param, from, to, when, duration, exponential = true) {
    if (exponential) {
        param.setValueAtTime(Math.max(MIN_GAIN, from), when);
        param.exponentialRampToValueAtTime(Math.max(MIN_GAIN, to), when + Math.max(0.001, duration));
    } else {
        param.setValueAtTime(from, when);
        param.linearRampToValueAtTime(to, when + Math.max(0.001, duration));
    }
}
export function glide(param, value, now, timeConstant) {
    param.setTargetAtTime(value, now, timeConstant);
}
export function softClipCurve(amount = 2, samples = 1024) {
    const curve = new Float32Array(new ArrayBuffer(samples * 4));
    const norm = Math.tanh(amount);
    for(let i = 0; i < samples; i++){
        const x = i / (samples - 1) * 2 - 1;
        curve[i] = Math.tanh(x * amount) / norm;
    }
    return curve;
}
function applyFilter(ctx, head, f, when, duration) {
    const filter = ctx.createBiquadFilter();
    filter.type = f.type;
    filter.Q.value = f.q ?? 1;
    if (f.endFreq !== undefined) {
        sweep(filter.frequency, f.freq, f.endFreq, when, f.sweepTime ?? duration);
    } else {
        filter.frequency.value = f.freq;
    }
    head.connect(filter);
    return filter;
}
function connectOut(ctx, head, dest, pan) {
    if (pan !== undefined && pan !== 0 && typeof ctx.createStereoPanner === 'function') {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        head.connect(p);
        p.connect(dest);
        return p;
    }
    head.connect(dest);
    return head;
}
export function playTone(ctx, dest, o) {
    const when = o.when ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    if (o.detune) osc.detune.value = o.detune;
    osc.frequency.setValueAtTime(Math.max(MIN_GAIN, o.freq), when);
    if (o.endFreq !== undefined) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(MIN_GAIN, o.endFreq), when + Math.max(0.001, o.sweepTime ?? o.duration));
    }
    const gain = ctx.createGain();
    const end = adsr(gain.gain, when, o.gain ?? 0.2, o.duration, o.env);
    let head = osc;
    if (o.filter) head = applyFilter(ctx, head, o.filter, when, o.duration);
    head.connect(gain);
    connectOut(ctx, gain, dest, o.pan);
    let lfo = null;
    if (o.vibrato && o.vibrato.depth > 0) {
        lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = o.vibrato.rate;
        const lg = ctx.createGain();
        lg.gain.value = o.vibrato.depth;
        lfo.connect(lg);
        lg.connect(osc.detune);
        lfo.start(when);
        lfo.stop(end + 0.02);
    }
    osc.start(when);
    osc.stop(end + 0.02);
    osc.onended = ()=>{
        osc.disconnect();
        gain.disconnect();
        if (lfo) lfo.disconnect();
    };
    return end;
}
export function playNoiseBurst(ctx, dest, o) {
    const when = o.when ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    const buffer = noiseBuffer(ctx, o.color ?? 'white');
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = buffer.duration;
    if (o.rate !== undefined) src.playbackRate.value = o.rate;
    const gain = ctx.createGain();
    const end = adsr(gain.gain, when, o.gain ?? 0.2, o.duration, o.env ?? {
        attack: 0.002,
        decay: o.duration * 0.6,
        sustain: 0.3,
        release: 0.05
    });
    let head = src;
    if (o.filter) head = applyFilter(ctx, head, o.filter, when, o.duration);
    head.connect(gain);
    connectOut(ctx, gain, dest, o.pan);
    src.start(when, Math.random() * Math.max(0, buffer.duration - 0.5));
    src.stop(end + 0.02);
    src.onended = ()=>{
        src.disconnect();
        gain.disconnect();
    };
    return end;
}
export function playSequence(ctx, dest, notes, opts = {}) {
    let t = opts.when ?? ctx.currentTime;
    const gap = opts.gap ?? 0;
    const base = opts.baseMidi ?? 0;
    let end = t;
    for (const [n, d] of notes){
        end = playTone(ctx, dest, {
            freq: midiToFreq(base + n),
            type: opts.type ?? 'square',
            duration: d,
            gain: opts.gain ?? 0.15,
            env: opts.env ?? {
                attack: 0.005,
                decay: 0.05,
                sustain: 0.7,
                release: 0.06
            },
            when: t,
            filter: opts.filter,
            vibrato: opts.vibrato
        });
        t += d + gap;
    }
    return end;
}
export function playChord(ctx, dest, midis, opts) {
    const when = opts.when ?? ctx.currentTime;
    let end = when;
    for (const m of midis){
        end = Math.max(end, playTone(ctx, dest, {
            freq: midiToFreq(m),
            type: opts.type ?? 'sawtooth',
            duration: opts.duration,
            gain: opts.gain ?? 0.08,
            env: opts.env,
            when,
            detune: opts.detune ? (Math.random() * 2 - 1) * opts.detune : 0,
            filter: opts.filter
        }));
    }
    return end;
}
