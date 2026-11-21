import * as THREE from 'three';
import { createEmptyInput } from '../core/types.js';
import { events } from '../core/events.js';
import { BASE_TOP_SPEED, GRAVITY, KART_RADIUS } from '../core/constants.js';
import { TAU, clamp, clamp01, damp, lerp, smoothstep, wrapAngle } from '../core/math.js';
import { buildKartModel } from './KartModel.js';
const ACCEL_BASE = 9.0;
const ACCEL_APPROACH = 2.2;
const BOOST_ACCEL = 45;
const BOOST_APPROACH = 7;
const OVER_SPEED_DECEL_MAX = 10;
const OVER_SPEED_APPROACH = 2.0;
const BRAKE_DECEL = 16;
const COAST_DECEL = 4.5;
const REVERSE_FRACTION = 0.35;
const REVERSE_ACCEL = 5;
const STEER_RATE = 1.9;
const DRIFT_STEER_RATE = 1.9;
const HOP_VELOCITY = 4.5;
const HOP_DRIFT_DELAY = 0.15;
const DRIFT_MIN_SPEED = 0.45;
const DRIFT_KEEP_SPEED = 0.3;
const DRIFT_SLIP_MAX = 0.49;
const DRIFT_SPEED_FACTOR = 0.965;
const DRIFT_STAGE_THRESHOLDS = [
    1.0,
    2.0,
    3.2
];
const DRIFT_BOOST_DURATIONS = [
    0,
    0.7,
    1.2,
    1.8
];
const DRIFT_BOOST_STRENGTH = 0.4;
const SPIN_DURATION = 1.1;
const LATERAL_GRIP_ROAD = 8;
const LATERAL_GRIP_OFFROAD = 4;
const WALL_RESTITUTION = 0.3;
const WALL_MARGIN = KART_RADIUS * 0.6;
const OFFROAD_FACTOR = 0.55;
const SHRUNK_FACTOR = 0.65;
const STAR_FACTOR = 1.2;
const SQUISH_FACTOR = 0.5;
const GROUND_STICK = 0.12;
const GROUND_LAUNCH_VY = 1.0;
const ACCENT_EMISSIVE = 0.32;
const DRIFT_STAGE_COLORS = [
    0,
    0x4db8ff,
    0xffa53d,
    0xd46bff
];
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _impulse = new THREE.Vector3();
const _contact = new THREE.Vector3();
const _qYaw = new THREE.Quaternion();
const _qTilt = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _color = new THREE.Color();
const _query = {
    t: 0,
    surface: 'road',
    groundY: 0,
    groundNormal: new THREE.Vector3(0, 1, 0),
    lateral: 0,
    halfWidth: 6,
    wallHalfWidth: 7,
    tangent: new THREE.Vector3(0, 0, -1),
    binormal: new THREE.Vector3(1, 0, 0),
    center: new THREE.Vector3()
};
function approachZero(v, step) {
    if (v > 0) return Math.max(0, v - step);
    if (v < 0) return Math.min(0, v + step);
    return 0;
}
export class Kart {
    state;
    object;
    input = createEmptyInput();
    parts;
    visual;
    lateralVel = 0;
    vy = 0;
    freeY = 0;
    slip = 0;
    groundVy = 0;
    lastGroundY = 0;
    hasGroundSample = false;
    groundNormal = new THREE.Vector3(0, 1, 0);
    absCharge = 0;
    hopTimer = 0;
    prevDriftHeld = false;
    padCooldown = 0;
    wallCooldown = 0;
    collisionCooldown = new Float32Array(32);
    frozenThrottleTime = 0;
    disposed = false;
    time = 0;
    visYawOffset = 0;
    visRoll = 0;
    visPitch = 0;
    visSquash = 0;
    visSquashVel = 0;
    visShrink = 1;
    visSquishY = 1;
    visGlow = 0;
    visHeadYaw = 0;
    visHeadLean = 0;
    accelEst = 0;
    prevSpeedVis = 0;
    pendingLandImpact = 0;
    pendingHop = false;
    starVisualActive = false;
    accentStage = -1;
    constructor(id, character, isPlayer){
        this.state = {
            id,
            isPlayer,
            character,
            position: new THREE.Vector3(),
            quaternion: new THREE.Quaternion(),
            velocity: new THREE.Vector3(),
            speed: 0,
            heading: 0,
            steerVisual: 0,
            isDrifting: false,
            driftDirection: 0,
            driftCharge: 0,
            driftStage: 0,
            isBoosting: false,
            boostTimer: 0,
            boostStrength: 0,
            isAirborne: false,
            airTime: 0,
            isHopping: false,
            isSpinning: false,
            spinTimer: 0,
            isSquished: false,
            squishTimer: 0,
            isInvincible: false,
            starTimer: 0,
            isShrunk: false,
            shrinkTimer: 0,
            isFrozen: false,
            lap: 0,
            checkpointIndex: 0,
            trackT: 0,
            raceProgress: 0,
            place: id + 1,
            finished: false,
            finishTime: 0,
            wrongWay: false,
            item: 'none',
            itemCount: 0,
            itemRouletteActive: false,
            surface: 'road',
            wheelSpin: 0
        };
        this.parts = buildKartModel(character);
        this.visual = this.parts.root;
        this.object = new THREE.Group();
        this.object.name = `kart-${id}-${character.id}`;
        this.object.add(this.visual);
    }
    setInput(input) {
        const i = this.input;
        i.throttle = clamp01(input.throttle);
        i.brake = clamp01(input.brake);
        i.steer = clamp(input.steer, -1, 1);
        i.drift = input.drift;
        i.useItem = input.useItem;
        i.useItemHeld = input.useItemHeld;
        i.lookBack = input.lookBack;
        i.pause = input.pause;
        i.confirm = input.confirm;
        i.back = input.back;
        i.menuUp = input.menuUp;
        i.menuDown = input.menuDown;
        i.menuLeft = input.menuLeft;
        i.menuRight = input.menuRight;
    }
    update(dt, track, others) {
        if (dt <= 0 || this.disposed) return;
        const s = this.state;
        this.tickTimers(dt);
        this.syncFromVelocity();
        if (s.isFrozen) {
            s.speed = 0;
            this.lateralVel = 0;
            this.slip = 0;
            this.frozenThrottleTime = this.input.throttle > 0.5 ? this.frozenThrottleTime + dt : 0;
            s.steerVisual = damp(s.steerVisual, this.input.steer, 10, dt);
            this.vy -= GRAVITY * dt;
            this.freeY += this.vy * dt;
            this.composeVelocity();
            this.resolveTrack(dt, track);
            this.syncFromVelocity();
            this.writeQuaternion();
            return;
        }
        const top = this.topSpeed();
        const canControl = !s.isSpinning;
        s.steerVisual = damp(s.steerVisual, canControl ? this.input.steer : 0, 12, dt);
        this.updateSpeed(dt, top, canControl);
        this.updateHopDrift(dt, canControl);
        this.updateYaw(dt, canControl);
        const slipTarget = s.isDrifting ? s.driftDirection * DRIFT_SLIP_MAX * (0.75 + 0.25 * clamp01(this.input.steer * s.driftDirection)) : 0;
        this.slip = damp(this.slip, slipTarget, s.isDrifting ? 5 : 7, dt);
        if (!s.isAirborne) {
            const grip = s.surface === 'offroad' ? LATERAL_GRIP_OFFROAD : LATERAL_GRIP_ROAD;
            this.lateralVel = damp(this.lateralVel, 0, grip, dt);
        }
        this.vy -= GRAVITY * dt;
        this.freeY += this.vy * dt;
        this.composeVelocity();
        s.position.x += s.velocity.x * dt;
        s.position.z += s.velocity.z * dt;
        this.resolveTrack(dt, track);
        this.resolveKarts(others);
        this.syncFromVelocity();
        this.writeQuaternion();
    }
    updateVisuals(dt) {
        if (this.disposed) return;
        dt = clamp(dt, 0, 0.1);
        const s = this.state;
        const p = this.parts;
        this.time += dt;
        this.object.position.copy(s.position);
        this.object.quaternion.copy(s.quaternion);
        if (dt > 1e-4) {
            const accel = (s.speed - this.prevSpeedVis) / dt;
            this.accelEst = damp(this.accelEst, clamp(accel, -30, 40), 6, dt);
        }
        this.prevSpeedVis = s.speed;
        const wheelRadius = p.wheelRadii[0] || 0.2;
        s.wheelSpin += s.speed / wheelRadius * dt;
        if (s.wheelSpin > TAU) s.wheelSpin -= TAU;
        else if (s.wheelSpin < 0) s.wheelSpin += TAU;
        const wheels = p.wheels;
        for(let i = 0; i < wheels.length; i++)wheels[i].rotation.x = -s.wheelSpin * (wheelRadius / (p.wheelRadii[i] || wheelRadius));
        const steerAngle = -s.steerVisual * 0.42;
        const front = p.frontWheels;
        for(let i = 0; i < front.length; i++)front[i].rotation.y = steerAngle;
        p.steeringWheel.rotation.z = -s.steerVisual * 1.2;
        const speedRatio = clamp01(Math.abs(s.speed) / BASE_TOP_SPEED);
        const yawTarget = s.isDrifting ? -s.driftDirection * 0.16 : 0;
        this.visYawOffset = damp(this.visYawOffset, yawTarget, 6, dt);
        const rollTarget = s.steerVisual * 0.06 * speedRatio + (s.isDrifting ? s.driftDirection * 0.05 : 0);
        this.visRoll = damp(this.visRoll, rollTarget, 8, dt);
        let pitchTarget = clamp(this.accelEst * 0.008, -0.08, 0.06);
        if (s.isAirborne) pitchTarget += clamp(s.velocity.y * 0.035, -0.3, 0.3);
        this.visPitch = damp(this.visPitch, pitchTarget, 6, dt);
        let spinYaw = 0;
        let spinHop = 0;
        if (s.isSpinning) {
            const prog = clamp01(1 - s.spinTimer / SPIN_DURATION);
            const eased = 1 - (1 - prog) * (1 - prog);
            spinYaw = eased * TAU;
            spinHop = Math.sin(prog * Math.PI) * 0.22;
        }
        if (this.pendingHop) {
            this.visSquashVel += 2.2;
            this.pendingHop = false;
        }
        if (this.pendingLandImpact > 0) {
            this.visSquashVel -= Math.min(4, this.pendingLandImpact * 0.7);
            this.pendingLandImpact = 0;
        }
        this.visSquashVel += (-180 * this.visSquash - 14 * this.visSquashVel) * dt;
        this.visSquash = clamp(this.visSquash + this.visSquashVel * dt, -0.35, 0.35);
        const sy = 1 + this.visSquash;
        const sxz = 1 - this.visSquash * 0.5;
        this.visSquishY = damp(this.visSquishY, s.isSquished ? 0.35 : 1, 12, dt);
        const squishXZ = 1 + (1 - this.visSquishY) * 0.45;
        this.visShrink = damp(this.visShrink, s.isShrunk ? 0.55 : 1, 8, dt);
        const v = this.visual;
        v.scale.set(sxz * squishXZ * this.visShrink, sy * this.visSquishY * this.visShrink, sxz * squishXZ * this.visShrink);
        v.position.y = spinHop;
        _euler.set(this.visPitch, this.visYawOffset + spinYaw, this.visRoll, 'YXZ');
        v.quaternion.setFromEuler(_euler);
        const lookTarget = -s.steerVisual * 0.5 - (s.isDrifting ? s.driftDirection * 0.35 : 0);
        this.visHeadYaw = damp(this.visHeadYaw, lookTarget, 8, dt);
        const leanTarget = -s.steerVisual * 0.15 - (s.isDrifting ? s.driftDirection * 0.08 : 0);
        this.visHeadLean = damp(this.visHeadLean, leanTarget, 8, dt);
        p.driverHead.rotation.set(0, this.visHeadYaw, this.visHeadLean);
        p.driver.rotation.set(clamp(this.accelEst * 0.004, -0.08, 0.1), 0, this.visHeadLean * 0.35);
        if (s.isInvincible) {
            const hue = this.time * 1.6 % 1;
            p.bodyMaterial.emissive.setHSL(hue, 1, 0.5);
            p.bodyMaterial.emissiveIntensity = 0.85;
            p.accentMaterial.emissiveIntensity = 1.8;
            this.starVisualActive = true;
            this.accentStage = -1;
        } else if (this.starVisualActive) {
            p.bodyMaterial.emissive.setRGB(0, 0, 0);
            p.bodyMaterial.emissiveIntensity = 1;
            p.accentMaterial.emissiveIntensity = ACCENT_EMISSIVE;
            this.starVisualActive = false;
        }
        if (!s.isInvincible) {
            const stage = s.isDrifting ? s.driftStage : 0;
            if (stage !== this.accentStage) {
                this.accentStage = stage;
                if (stage === 0) {
                    p.accentMaterial.emissive.setHex(s.character.accent);
                    p.accentMaterial.emissiveIntensity = ACCENT_EMISSIVE;
                } else {
                    p.accentMaterial.emissive.setHex(DRIFT_STAGE_COLORS[stage]);
                    p.accentMaterial.emissiveIntensity = 1.1;
                }
            }
        }
        this.visGlow = damp(this.visGlow, s.isBoosting ? 1 : 0, 10, dt);
        const flicker = 0.75 + 0.25 * Math.sin(this.time * 47) * Math.sin(this.time * 31 + 1);
        p.exhaustGlowMaterial.emissiveIntensity = this.visGlow * 3 * flicker;
        const ex = p.exhausts;
        const exs = 1 + 0.12 * this.visGlow * flicker;
        const exz = 1 + 0.25 * this.visGlow * flicker;
        for(let i = 0; i < ex.length; i++)ex[i].scale.set(exs, exs, exz);
    }
    applyBoost(strength, duration, source) {
        const s = this.state;
        if (strength <= 0 || duration <= 0) return;
        s.isBoosting = true;
        s.boostStrength = Math.max(s.boostStrength, strength);
        s.boostTimer = Math.max(s.boostTimer, duration);
        events.emit('kart:boost', {
            kartId: s.id,
            strength,
            duration,
            source
        });
    }
    applyHit(cause, sourceKartId) {
        const s = this.state;
        if (s.isInvincible || s.isSpinning) return false;
        s.isSpinning = true;
        s.spinTimer = SPIN_DURATION;
        if (s.isDrifting) this.endDrift(false);
        s.isBoosting = false;
        s.boostTimer = 0;
        s.boostStrength = 0;
        this.syncFromVelocity();
        s.speed *= 0.15;
        this.lateralVel *= 0.5;
        if (cause === 'explosion') {
            this.vy = Math.max(this.vy, 6);
            this.freeY = s.position.y + 0.01;
            s.isAirborne = true;
            s.airTime = 0;
        }
        this.composeVelocity();
        events.emit('kart:spin', {
            kartId: s.id,
            cause,
            sourceKartId
        });
        return true;
    }
    applySquish(duration) {
        const s = this.state;
        if (s.isInvincible || duration <= 0) return;
        const wasSquished = s.isSquished;
        s.isSquished = true;
        s.squishTimer = Math.max(s.squishTimer, duration);
        if (s.isDrifting) this.endDrift(false);
        if (!wasSquished) events.emit('kart:squish', {
            kartId: s.id
        });
    }
    applyStar(duration) {
        const s = this.state;
        if (duration <= 0) return;
        const was = s.isInvincible;
        s.isInvincible = true;
        s.starTimer = Math.max(s.starTimer, duration);
        if (s.isSpinning) {
            s.isSpinning = false;
            s.spinTimer = 0;
        }
        if (!was) events.emit('kart:starStart', {
            kartId: s.id
        });
    }
    applyShrink(duration) {
        const s = this.state;
        if (s.isInvincible || duration <= 0) return;
        const was = s.isShrunk;
        s.isShrunk = true;
        s.shrinkTimer = Math.max(s.shrinkTimer, duration);
        if (!was) events.emit('kart:shrink', {
            kartId: s.id
        });
    }
    applyImpulse(impulse) {
        const s = this.state;
        if (s.isFrozen) return;
        s.velocity.add(impulse);
        if (impulse.y > 0.5 && !s.isAirborne) this.freeY = s.position.y + 0.01;
    }
    setFrozen(frozen) {
        const s = this.state;
        if (s.isFrozen && !frozen) {
            const t = this.frozenThrottleTime;
            if (t > 0 && t < 0.45) this.applyBoost(0.3, 1.2, 'start');
        }
        s.isFrozen = frozen;
        if (frozen) {
            if (s.isDrifting) this.endDrift(false);
            s.speed = 0;
            s.velocity.set(0, 0, 0);
            this.lateralVel = 0;
            this.slip = 0;
            this.frozenThrottleTime = 0;
        }
    }
    resetTo(position, quaternion) {
        const s = this.state;
        s.position.copy(position);
        s.quaternion.copy(quaternion);
        _v.set(0, 0, -1).applyQuaternion(quaternion);
        s.heading = Math.atan2(-_v.x, -_v.z);
        s.velocity.set(0, 0, 0);
        s.speed = 0;
        this.lateralVel = 0;
        this.vy = 0;
        this.slip = 0;
        this.freeY = position.y;
        this.groundVy = 0;
        this.lastGroundY = position.y;
        this.hasGroundSample = false;
        this.groundNormal.set(0, 1, 0);
        s.isAirborne = false;
        s.airTime = 0;
        s.isHopping = false;
        this.hopTimer = 0;
        this.prevDriftHeld = true;
        if (s.isDrifting) this.endDrift(false);
        s.isBoosting = false;
        s.boostTimer = 0;
        s.boostStrength = 0;
        s.isSpinning = false;
        s.spinTimer = 0;
        s.steerVisual = 0;
        this.padCooldown = 0.5;
        this.wallCooldown = 0;
        this.visYawOffset = 0;
        this.visRoll = 0;
        this.visPitch = 0;
        this.visSquash = 0;
        this.visSquashVel = 0;
        this.accelEst = 0;
        this.prevSpeedVis = 0;
        this.pendingLandImpact = 0;
        this.pendingHop = false;
        this.writeQuaternion();
        this.object.position.copy(s.position);
        this.object.quaternion.copy(s.quaternion);
    }
    forwardDir(out) {
        return (out ?? new THREE.Vector3()).set(0, 0, -1).applyQuaternion(this.state.quaternion);
    }
    topSpeed() {
        const s = this.state;
        let v = this.baseTopSpeed();
        const protectedSpeed = s.isBoosting || s.isInvincible;
        if (s.surface === 'offroad' && !protectedSpeed) v *= OFFROAD_FACTOR;
        if (s.isShrunk) v *= SHRUNK_FACTOR;
        if (s.isInvincible) v *= STAR_FACTOR;
        if (s.isBoosting) v *= 1 + s.boostStrength;
        if (s.isSquished) v *= SQUISH_FACTOR;
        return v;
    }
    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.parts.dispose();
        this.object.removeFromParent();
    }
    baseTopSpeed() {
        return BASE_TOP_SPEED * (0.93 + 0.14 * this.state.character.stats.speed);
    }
    tickTimers(dt) {
        const s = this.state;
        if (s.isBoosting) {
            s.boostTimer -= dt;
            if (s.boostTimer <= 0) {
                s.isBoosting = false;
                s.boostTimer = 0;
                s.boostStrength = 0;
            }
        }
        if (s.isSpinning) {
            s.spinTimer -= dt;
            if (s.spinTimer <= 0) {
                s.isSpinning = false;
                s.spinTimer = 0;
            }
        }
        if (s.isSquished) {
            s.squishTimer -= dt;
            if (s.squishTimer <= 0) {
                s.isSquished = false;
                s.squishTimer = 0;
            }
        }
        if (s.isInvincible) {
            s.starTimer -= dt;
            if (s.starTimer <= 0) {
                s.isInvincible = false;
                s.starTimer = 0;
                events.emit('kart:starEnd', {
                    kartId: s.id
                });
            }
        }
        if (s.isShrunk) {
            s.shrinkTimer -= dt;
            if (s.shrinkTimer <= 0) {
                s.isShrunk = false;
                s.shrinkTimer = 0;
                events.emit('kart:unshrink', {
                    kartId: s.id
                });
            }
        }
        if (this.padCooldown > 0) this.padCooldown -= dt;
        if (this.wallCooldown > 0) this.wallCooldown -= dt;
        const cc = this.collisionCooldown;
        for(let i = 0; i < cc.length; i++)if (cc[i] > 0) cc[i] -= dt;
    }
    syncFromVelocity() {
        const s = this.state;
        const a = s.heading + this.slip;
        const sa = Math.sin(a);
        const ca = Math.cos(a);
        const vx = s.velocity.x;
        const vz = s.velocity.z;
        s.speed = -vx * sa - vz * ca;
        this.lateralVel = vx * ca - vz * sa;
        this.vy = s.velocity.y;
    }
    composeVelocity() {
        const s = this.state;
        const a = s.heading + this.slip;
        const sa = Math.sin(a);
        const ca = Math.cos(a);
        s.velocity.x = -sa * s.speed + ca * this.lateralVel;
        s.velocity.z = -ca * s.speed - sa * this.lateralVel;
        s.velocity.y = this.vy;
    }
    updateSpeed(dt, top, canControl) {
        const s = this.state;
        const inp = this.input;
        let speed = s.speed;
        if (s.isAirborne && !s.isHopping) {
            speed = approachZero(speed, 0.4 * dt);
            s.speed = speed;
            return;
        }
        if (!canControl) {
            speed = approachZero(speed, 6 * dt);
            s.speed = speed;
            return;
        }
        const maxAccel = ACCEL_BASE * (0.5 + s.character.stats.acceleration);
        const throttle = s.isBoosting ? 1 : inp.throttle;
        const brake = inp.brake;
        if (brake > 0.05 && speed > 0.3 && brake >= throttle) {
            speed = Math.max(0, speed - BRAKE_DECEL * brake * dt);
        } else if (throttle > 0.05 && throttle >= brake) {
            let target = top * throttle;
            if (s.isDrifting) target *= DRIFT_SPEED_FACTOR;
            if (speed < target) {
                const cap = s.isBoosting ? BOOST_ACCEL : maxAccel;
                const approach = s.isBoosting ? BOOST_APPROACH : ACCEL_APPROACH;
                speed += Math.min(cap, (target - speed) * approach + 0.8) * dt;
                if (speed > target) speed = target;
            } else {
                speed += Math.max(-OVER_SPEED_DECEL_MAX, (target - speed) * OVER_SPEED_APPROACH) * dt;
                if (speed < target) speed = target;
            }
        } else if (brake > 0.05) {
            const target = -REVERSE_FRACTION * top * brake;
            if (speed > target) {
                speed -= Math.min(REVERSE_ACCEL, (speed - target) * 2 + 0.5) * dt;
                if (speed < target) speed = target;
            } else {
                speed += Math.min(6, (target - speed) * 2) * dt;
            }
        } else {
            speed = approachZero(speed, (COAST_DECEL + 0.06 * Math.abs(speed)) * dt);
            if (speed > top) {
                speed += Math.max(-OVER_SPEED_DECEL_MAX, (top - speed) * OVER_SPEED_APPROACH) * dt;
                if (speed < top) speed = top;
            }
        }
        s.speed = speed;
    }
    updateHopDrift(dt, canControl) {
        const s = this.state;
        const inp = this.input;
        const base = this.baseTopSpeed();
        const driftHeld = canControl && inp.drift;
        const driftPressed = driftHeld && !this.prevDriftHeld;
        this.prevDriftHeld = driftHeld;
        if (s.isHopping) this.hopTimer += dt;
        if (driftPressed && !s.isAirborne && Math.abs(s.speed) > 0.3 * base) {
            this.hop();
        }
        if (!s.isDrifting && driftHeld && s.isHopping && this.hopTimer >= HOP_DRIFT_DELAY) {
            this.tryStartDrift();
        }
        if (!s.isDrifting) return;
        if (!driftHeld) {
            this.endDrift(true);
        } else if (Math.abs(s.speed) < DRIFT_KEEP_SPEED * base) {
            this.endDrift(false);
        } else if (s.isAirborne && (!s.isHopping && s.airTime > 0.4 || s.airTime > 0.9)) {
            this.endDrift(false);
        } else if (!s.isAirborne) {
            const inward = clamp01(inp.steer * s.driftDirection);
            this.absCharge += (0.55 + 0.6 * s.character.stats.miniTurbo) * (0.6 + 0.8 * inward) * dt;
            let stage = 0;
            if (this.absCharge >= DRIFT_STAGE_THRESHOLDS[2]) stage = 3;
            else if (this.absCharge >= DRIFT_STAGE_THRESHOLDS[1]) stage = 2;
            else if (this.absCharge >= DRIFT_STAGE_THRESHOLDS[0]) stage = 1;
            if (stage > s.driftStage) {
                s.driftStage = stage;
                events.emit('kart:driftStage', {
                    kartId: s.id,
                    stage: stage
                });
            }
            if (stage === 3) {
                s.driftCharge = 1;
            } else {
                const lo = stage === 0 ? 0 : DRIFT_STAGE_THRESHOLDS[stage - 1];
                const hi = DRIFT_STAGE_THRESHOLDS[stage];
                s.driftCharge = clamp01((this.absCharge - lo) / (hi - lo));
            }
        }
    }
    hop() {
        const s = this.state;
        s.isHopping = true;
        s.isAirborne = true;
        s.airTime = 0;
        this.hopTimer = 0;
        this.vy = HOP_VELOCITY + Math.max(0, this.groundVy);
        this.freeY = s.position.y + 0.001;
        this.pendingHop = true;
        events.emit('kart:hop', {
            kartId: s.id
        });
    }
    tryStartDrift() {
        const s = this.state;
        const inp = this.input;
        if (s.isDrifting || s.isSpinning) return;
        if (Math.abs(inp.steer) <= 0.3) return;
        if (s.speed <= DRIFT_MIN_SPEED * this.baseTopSpeed()) return;
        s.isDrifting = true;
        s.driftDirection = inp.steer > 0 ? 1 : -1;
        s.driftStage = 0;
        s.driftCharge = 0;
        this.absCharge = 0;
        events.emit('kart:driftStart', {
            kartId: s.id,
            direction: s.driftDirection
        });
    }
    endDrift(withBoost) {
        const s = this.state;
        if (!s.isDrifting) return;
        const boostStage = withBoost ? s.driftStage : 0;
        s.isDrifting = false;
        s.driftDirection = 0;
        s.driftStage = 0;
        s.driftCharge = 0;
        this.absCharge = 0;
        events.emit('kart:driftEnd', {
            kartId: s.id,
            boostStage
        });
        if (boostStage > 0) this.applyBoost(DRIFT_BOOST_STRENGTH, DRIFT_BOOST_DURATIONS[boostStage], 'drift');
    }
    updateYaw(dt, canControl) {
        const s = this.state;
        if (!canControl) return;
        const inp = this.input;
        const handling = 0.7 + 0.6 * s.character.stats.handling;
        const absSpeed = Math.abs(s.speed);
        const ratio = absSpeed / BASE_TOP_SPEED;
        let yawRate;
        if (s.isDrifting) {
            const inward = (inp.steer * s.driftDirection + 1) * 0.5;
            const falloff = lerp(1, 0.72, smoothstep(0.2, 1, ratio));
            yawRate = s.driftDirection * (0.55 + 0.45 * inward) * DRIFT_STEER_RATE * handling * falloff;
        } else {
            const falloff = lerp(1, 0.6, smoothstep(0.15, 1, ratio));
            const lowSpeed = Math.min(1, absSpeed / 2.5);
            const steer = s.speed < -0.5 ? -inp.steer : inp.steer;
            yawRate = steer * STEER_RATE * handling * falloff * lowSpeed;
            if (s.isSquished) yawRate *= 0.6;
        }
        if (s.isAirborne) yawRate *= s.isHopping ? 0.45 : 0.15;
        s.heading = wrapAngle(s.heading - yawRate * dt);
    }
    resolveTrack(dt, track) {
        const s = this.state;
        const q = track.query(s.position, s.trackT, _query);
        s.trackT = q.t;
        if (q.surface !== s.surface) {
            const from = s.surface;
            s.surface = q.surface;
            events.emit('kart:surfaceChange', {
                kartId: s.id,
                from,
                to: q.surface
            });
            if (q.surface === 'boost' && this.padCooldown <= 0) {
                this.padCooldown = 1.0;
                this.applyBoost(0.45, 1.3, 'pad');
            }
        }
        const isVoid = q.surface === 'void';
        if (!isVoid && !s.isFrozen) {
            const limit = q.wallHalfWidth - WALL_MARGIN;
            const lat = q.lateral;
            if (Math.abs(lat) > limit) {
                const sign = lat > 0 ? 1 : -1;
                const pen = Math.abs(lat) - limit;
                const b = q.binormal;
                s.position.x -= b.x * sign * pen;
                s.position.z -= b.z * sign * pen;
                const vel = s.velocity;
                const vOut = (vel.x * b.x + vel.z * b.z) * sign;
                if (vOut > 0) {
                    const hSpeed = Math.hypot(vel.x, vel.z);
                    const sinAngle = clamp01(vOut / Math.max(0.5, hSpeed));
                    vel.x -= b.x * sign * vOut * (1 + WALL_RESTITUTION);
                    vel.z -= b.z * sign * vOut * (1 + WALL_RESTITUTION);
                    if (vOut > 1.0 && this.wallCooldown <= 0) {
                        const keep = 1 - lerp(0.25, 0.45, sinAngle);
                        vel.x *= keep;
                        vel.z *= keep;
                        this.wallCooldown = 0.3;
                        events.emit('kart:collision', {
                            kartId: s.id,
                            otherId: null,
                            impulse: vOut,
                            position: s.position
                        });
                    } else {
                        const friction = Math.max(0, 1 - 1.5 * dt);
                        vel.x *= friction;
                        vel.z *= friction;
                    }
                }
            }
        }
        const wasAirborne = s.isAirborne;
        if (isVoid) {
            s.isAirborne = true;
            s.airTime += dt;
            s.isHopping = false;
            s.position.y = this.freeY;
            this.hasGroundSample = false;
            this.groundVy = damp(this.groundVy, 0, 4, dt);
        } else {
            const gy = q.groundY;
            if (this.hasGroundSample) {
                const slopeVy = clamp((gy - this.lastGroundY) / dt, -25, 25);
                this.groundVy = damp(this.groundVy, slopeVy, 40, dt);
            } else {
                this.groundVy = 0;
            }
            this.lastGroundY = gy;
            this.hasGroundSample = true;
            let grounded;
            let impact = 0;
            if (this.freeY <= gy) {
                grounded = true;
                this.freeY = gy;
                impact = Math.max(0, this.groundVy - this.vy);
                if (this.vy < this.groundVy) this.vy = this.groundVy;
            } else {
                grounded = this.freeY - gy < GROUND_STICK && Math.abs(this.vy - this.groundVy) < GROUND_LAUNCH_VY;
            }
            if (grounded) {
                s.position.y = gy;
                if (wasAirborne) this.land(impact);
                s.isAirborne = false;
                s.isHopping = false;
                s.airTime = 0;
            } else {
                s.isAirborne = true;
                s.airTime += dt;
                s.position.y = this.freeY;
            }
        }
        s.velocity.y = this.vy;
        const n = q.groundNormal;
        const target = s.isAirborne ? UP : n;
        const lambda = s.isAirborne ? 3 : 12;
        const k = 1 - Math.exp(-lambda * dt);
        this.groundNormal.lerp(target, k);
        if (this.groundNormal.lengthSq() < 1e-6) this.groundNormal.copy(UP);
        else this.groundNormal.normalize();
    }
    land(impact) {
        const s = this.state;
        const wasHopping = s.isHopping;
        if (impact > 9) s.speed *= 0.9;
        this.pendingLandImpact = impact;
        if (impact > 0.5 || s.airTime > 0.12) {
            events.emit('kart:land', {
                kartId: s.id,
                impact
            });
        }
        const driftHeld = !s.isSpinning && !s.isFrozen && this.input.drift;
        if (driftHeld && !s.isDrifting && (wasHopping || s.airTime < 0.6)) this.tryStartDrift();
    }
    resolveKarts(others) {
        const s = this.state;
        if (s.isFrozen) return;
        const rA = KART_RADIUS * (s.isShrunk ? 0.6 : 1);
        const wA = 0.7 + 0.6 * s.character.stats.weight;
        const invA = 1 / wA;
        for(let i = 0; i < others.length; i++){
            const other = others[i];
            if (other === this) continue;
            const o = other.state;
            if (o.id <= s.id) continue;
            if (o.isFrozen) continue;
            const dx = o.position.x - s.position.x;
            const dz = o.position.z - s.position.z;
            const dy = o.position.y - s.position.y;
            if (Math.abs(dy) > 1.2) continue;
            const rB = KART_RADIUS * (o.isShrunk ? 0.6 : 1);
            const minDist = rA + rB;
            const distSq = dx * dx + dz * dz;
            if (distSq >= minDist * minDist) continue;
            const dist = Math.sqrt(distSq);
            let nx;
            let nz;
            if (dist > 1e-4) {
                nx = dx / dist;
                nz = dz / dist;
            } else {
                nx = Math.cos(s.heading);
                nz = -Math.sin(s.heading);
            }
            const pen = minDist - dist;
            const wB = 0.7 + 0.6 * o.character.stats.weight;
            const invB = 1 / wB;
            const invSum = invA + invB;
            const shareA = invA / invSum * pen;
            const shareB = invB / invSum * pen;
            s.position.x -= nx * shareA;
            s.position.z -= nz * shareA;
            o.position.x += nx * shareB;
            o.position.z += nz * shareB;
            const vRel = (o.velocity.x - s.velocity.x) * nx + (o.velocity.z - s.velocity.z) * nz;
            if (vRel < 0) {
                const j = -(1 + 0.4) * vRel / invSum + 1.2;
                s.velocity.x -= nx * j * invA;
                s.velocity.z -= nz * j * invA;
                _impulse.set(nx * j * invB, 0, nz * j * invB);
                other.applyImpulse(_impulse);
            }
            const slot = o.id & 31;
            if (this.collisionCooldown[slot] <= 0 && vRel < -0.8) {
                this.collisionCooldown[slot] = 0.3;
                _contact.set(s.position.x + nx * rA, (s.position.y + o.position.y) * 0.5 + 0.4, s.position.z + nz * rA);
                events.emit('kart:collision', {
                    kartId: s.id,
                    otherId: o.id,
                    impulse: -vRel,
                    position: _contact
                });
            }
            if (s.isInvincible && !o.isInvincible) other.applyHit('star', s.id);
            else if (o.isInvincible && !s.isInvincible) this.applyHit('star', o.id);
        }
    }
    writeQuaternion() {
        const s = this.state;
        _qYaw.setFromAxisAngle(UP, s.heading);
        _qTilt.setFromUnitVectors(UP, this.groundNormal);
        s.quaternion.copy(_qTilt).multiply(_qYaw);
    }
}
