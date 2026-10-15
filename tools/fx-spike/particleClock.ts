/**
 * Invisible FX — the PARTICLE CLOCK gate (`invisible-fx.md` "Decided (owner, 2026-10-15)": turbo
 * speeds up the particles too). Drives `pixi-svelte`'s `particleClock` against the real library
 * `Emitter`, and holds the runtime's wiring to it.
 *
 *   pnpm --filter fx-spike run particle-clock      (root: pnpm check:fx-particle-clock)
 *
 * Proves, offline:
 *  1. Parity: with the clock unset (or at 1) every step is bit-identical to today's
 *     (`emitterDeltaSeconds × effect.timeScale`) and every timer length is unchanged.
 *  2. At 2 the step doubles exactly and a timer halves; a bad read (NaN, ∞, 0, negative, a non-number,
 *     a throw) is 1; unsetting it is 1 again.
 *  3. On the real `Emitter`: a burst spawns the same particles in half the frames, they age twice as
 *     fast, and a Tier-C rig particle's clip advances by the doubled step.
 *  4. A timer reads the clock when it starts: a later turbo toggle does not re-time it.
 *  5. The wiring: `<ParticleEmitter>` steps through `particleStepSeconds`; every emission timer in
 *     `<EffectLayer>` / `<RiggedEffect>` (and the game's one-shot symbol FX and flight-trail settle)
 *     divides through `particleWallMs`; the game sets the clock from its turbo scalar; no tool does.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Container } from 'pixi.js';
import { Emitter, type EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import { emitterDeltaSeconds } from 'engine-fx';
import {
	particleStepSeconds,
	particleTimeScale,
	particleWallMs,
	setParticleTimeScale,
} from '../../packages/pixi-svelte/src/lib/particleClock';
import {
	RIG_PARTICLE_BEHAVIOR_TYPE,
	registerRigParticleBehavior,
} from '../../packages/pixi-svelte/src/lib/rigParticleBehavior';
import type { RigBacking } from '../../packages/pixi-svelte/src/lib/rigBacking';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const FRAMES_MS = [0, 1, 1000 / 144, 1000 / 60, 16.7, 1000 / 30, 50, 250, 0.001];
const SPEEDS = [undefined, 0.00234, 0.001, 0.0123];
const EFFECT_SCALES = [1, 0.5, 1.75, 3];
const TIMERS_MS = [0, 1, 123.456, 1500, 426.7350427350427, 1e9];

// -------------------------------------------------------------------------------------------------
console.log('fx particle clock — parity at 1');
{
	setParticleTimeScale(undefined);
	assert(particleTimeScale() === 1, 'unset, the clock is 1');
	const steps = FRAMES_MS.flatMap((d) => SPEEDS.map((s) => [d, s] as const));
	assert(
		steps.every(([d, s]) => Object.is(particleStepSeconds(d, s), emitterDeltaSeconds(d, s))),
		`with no effect scale the step is bit-identical to emitterDeltaSeconds (${steps.length} cases)`,
	);
	assert(
		steps.every(([d, s]) =>
			EFFECT_SCALES.every((t) =>
				Object.is(particleStepSeconds(d, s, t), emitterDeltaSeconds(d, s) * t),
			),
		),
		'…and with an effect.timeScale, bit-identical to the step before the clock existed',
	);
	assert(
		TIMERS_MS.every((ms) => Object.is(particleWallMs(ms), ms)),
		'every timer length is unchanged',
	);
	setParticleTimeScale(() => 1);
	assert(
		steps.every(([d, s]) =>
			Object.is(particleStepSeconds(d, s, 1.75), emitterDeltaSeconds(d, s) * 1.75),
		) && TIMERS_MS.every((ms) => Object.is(particleWallMs(ms), ms)),
		'a clock set to 1 (turbo off) is the same as unset',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('');
console.log('fx particle clock — turbo and bad reads');
{
	setParticleTimeScale(() => 2);
	assert(particleTimeScale() === 2, 'set to 2, the clock reads 2');
	assert(
		FRAMES_MS.every((d) =>
			SPEEDS.every((s) => particleStepSeconds(d, s, 1.5) === emitterDeltaSeconds(d, s) * 1.5 * 2),
		),
		'the step doubles exactly',
	);
	assert(particleWallMs(1500) === 750 && particleWallMs(0) === 0, 'a timer halves (1500 → 750 ms)');
	const bad: [string, () => number][] = [
		['NaN', () => Number.NaN],
		['Infinity', () => Number.POSITIVE_INFINITY],
		['-Infinity', () => Number.NEGATIVE_INFINITY],
		['0', () => 0],
		['-2', () => -2],
		['a string', () => '2' as unknown as number],
		['undefined', () => undefined as unknown as number],
		[
			'a throw',
			() => {
				throw new Error('no turbo state');
			},
		],
	];
	const fellBack = bad.filter(([, f]) => {
		setParticleTimeScale(f);
		return particleTimeScale() === 1 && particleWallMs(1500) === 1500;
	});
	assert(
		fellBack.length === bad.length,
		`a bad read is 1 (${fellBack.map(([n]) => n).join(', ')})`,
	);
	setParticleTimeScale(() => 2);
	setParticleTimeScale(undefined);
	assert(particleTimeScale() === 1, 'unsetting it puts it back to 1');
}

// -------------------------------------------------------------------------------------------------
console.log('');
console.log('fx particle clock — the real Emitter');
interface LiveParticle {
	age: number;
	next: LiveParticle | null;
}
const live = (em: Emitter): LiveParticle[] => {
	const out: LiveParticle[] = [];
	for (
		let p = (em as unknown as { _activeParticlesFirst: LiveParticle | null })._activeParticlesFirst;
		p;
		p = p.next
	) {
		out.push(p);
	}
	return out;
};
const FRAME_MS = 1000 / 60;
/** A burst: 0.5 emitter-seconds of emission, particles that outlive the run. */
const burst = (): EmitterConfigV3 =>
	({
		lifetime: { min: 60, max: 60 },
		frequency: 0.01,
		emitterLifetime: 0.5,
		maxParticles: 10000,
		pos: { x: 0, y: 0 },
		addAtBack: false,
		behaviors: [
			{
				type: 'alpha',
				config: {
					alpha: {
						list: [
							{ time: 0, value: 1 },
							{ time: 1, value: 0 },
						],
					},
				},
			},
		],
	}) as unknown as EmitterConfigV3;
/** Run a burst to its end as `<ParticleEmitter>`'s tick does; frames taken and particles spawned. */
const runBurst = (scale: number): { frames: number; spawned: number; oldestAt: number } => {
	setParticleTimeScale(() => scale);
	const em = new Emitter(new Container(), burst());
	em.emit = true;
	let frames = 0;
	let oldestAt = 0;
	while (em.emit && frames < 10000) {
		em.update(particleStepSeconds(FRAME_MS));
		frames++;
		if (frames === 5) oldestAt = Math.max(...live(em).map((p) => p.age));
	}
	return { frames, spawned: em.particleCount, oldestAt };
};
{
	const normal = runBurst(1);
	const turbo = runBurst(2);
	setParticleTimeScale(undefined);
	assert(
		turbo.spawned === normal.spawned && normal.spawned > 0,
		`a burst spawns the same particles at 2 (${turbo.spawned}) as at 1 (${normal.spawned}) — the shape is kept, not doubled`,
	);
	assert(
		Math.abs(turbo.frames - normal.frames / 2) <= 1,
		`…in half the wall time (${turbo.frames} frames vs ${normal.frames})`,
	);
	assert(
		Math.abs(turbo.oldestAt - 2 * normal.oldestAt) <= 2 * emitterDeltaSeconds(FRAME_MS),
		`particles age twice as fast (oldest after 5 frames: ${turbo.oldestAt.toFixed(4)} s vs ${normal.oldestAt.toFixed(4)} s)`,
	);

	// Tier C: each particle's clip advances by the emitter's step, so it speeds up with it.
	registerRigParticleBehavior();
	const advanced = (scale: number): number[] => {
		setParticleTimeScale(() => scale);
		const steps: number[] = [];
		const backing = (): RigBacking => ({
			view: new Container(),
			activate() {},
			advance(dt: number) {
				steps.push(dt);
			},
			reset() {},
			destroy() {},
		});
		const config = {
			...burst(),
			emitterLifetime: -1,
			maxParticles: 1,
			behaviors: [
				{
					type: RIG_PARTICLE_BEHAVIOR_TYPE,
					config: {
						animation: 'spin',
						loop: true,
						prewarm: 1,
						layerHost: new Container(),
						createBacking: backing,
					},
				},
			],
		} as unknown as EmitterConfigV3;
		const em = new Emitter(new Container(), config);
		em.emit = true;
		em.update(0);
		for (let i = 0; i < 5; i++) em.update(particleStepSeconds(FRAME_MS));
		return steps.filter((dt) => dt > 0);
	};
	const clip1 = advanced(1);
	const clip2 = advanced(2);
	setParticleTimeScale(undefined);
	assert(
		clip1.length > 0 &&
			clip1.length === clip2.length &&
			clip2.every((dt, i) => dt === clip1[i] * 2),
		`a Tier-C rig particle's clip advances by the doubled step (${clip1[0]?.toFixed(5)} → ${clip2[0]?.toFixed(5)} s a frame)`,
	);
}

// -------------------------------------------------------------------------------------------------
console.log('');
console.log('fx particle clock — a timer reads the clock when it starts');
{
	// An injected clock in place of setTimeout: the length scheduled, and when the stop lands.
	let now = 0;
	const due: { at: number; fire: () => void }[] = [];
	const schedule = (fire: () => void, ms: number): void => void due.push({ at: now + ms, fire });
	const advance = (ms: number): void => {
		now += ms;
		for (let i = due.length - 1; i >= 0; i--) {
			if (due[i].at > now) continue;
			due[i].fire();
			due.splice(i, 1);
		}
	};
	let emitting = true;
	setParticleTimeScale(() => 2);
	// `<EffectLayer>`'s trigger `duration`, exactly as it starts it.
	schedule(() => (emitting = false), particleWallMs(1500));
	setParticleTimeScale(() => 1); // turbo switched off mid-burst
	advance(749);
	const still = emitting;
	advance(1);
	assert(
		still && !emitting && now === 750,
		'a 1500 ms duration started in turbo stops at 750 ms, though turbo went off mid-burst',
	);
	setParticleTimeScale(undefined);
}

// -------------------------------------------------------------------------------------------------
console.log('');
console.log('fx particle clock — the wiring');
/** Every `setTimeout(…)` call in `src`, as the text of its last (delay) argument. */
const timerDelays = (src: string): string[] => {
	const out: string[] = [];
	for (let at = src.indexOf('setTimeout('); at !== -1; at = src.indexOf('setTimeout(', at + 1)) {
		let depth = 0;
		let lastComma = -1;
		let end = -1;
		for (let i = at + 'setTimeout('.length - 1; i < src.length; i++) {
			const c = src[i];
			if (c === '(' || c === '{' || c === '[') depth++;
			else if (c === ')' || c === '}' || c === ']') {
				depth--;
				if (depth === 0) {
					end = i;
					break;
				}
			} else if (c === ',' && depth === 1) lastComma = i;
		}
		out.push(
			src
				.slice(lastComma + 1, end)
				.trim()
				.replace(/,$/, '')
				.trim(),
		);
	}
	return out;
};
{
	const timers = [
		'packages/pixi-svelte/src/lib/components/EffectLayer.svelte',
		'packages/pixi-svelte/src/lib/components/RiggedEffect.svelte',
	].flatMap((file) => timerDelays(read(file)).map((delay) => ({ file, delay })));
	const raw = timers.filter((t) => !t.delay.startsWith('particleWallMs('));
	assert(
		timers.length >= 3 && raw.length === 0,
		`every emission timer in <EffectLayer> / <RiggedEffect> divides by the clock (${timers.length} timers${raw.length ? `; raw: ${raw.map((t) => t.delay).join(', ')}` : ''})`,
	);
	const emitter = read('packages/pixi-svelte/src/lib/components/ParticleEmitter.svelte');
	assert(
		emitter.includes('particleStepSeconds(') && !emitter.includes('emitterDeltaSeconds('),
		'<ParticleEmitter> steps only through particleStepSeconds',
	);
	assert(
		read('apps/lines/src/components/SymbolLayer.svelte').includes(
			'particleWallMs(fxEmitMs + fxSettleMs)',
		) && read('apps/lines/src/game/flights.svelte.ts').includes('particleWallMs(flight.settleMs)'),
		"the game's one-shot symbol FX completion and flight-trail settle wait out the faster particles",
	);
	assert(
		read('apps/lines/src/components/Game.svelte').includes(
			'setParticleTimeScale(stateBetDerived.timeScale)',
		) &&
			read('packages/state-shared/src/stateBet.svelte.ts').includes(
				'const timeScale = () => (stateBet.isTurbo ? 2 : 1);',
			),
		'the game sets the clock from its turbo scalar (isTurbo ? 2 : 1)',
	);
	const toolFiles: string[] = [];
	const walk = (dir: string): void => {
		for (const name of readdirSync(join(ROOT, dir))) {
			const path = `${dir}/${name}`;
			if (statSync(join(ROOT, path)).isDirectory()) walk(path);
			else if (/\.(ts|svelte|js)$/.test(name)) toolFiles.push(path);
		}
	};
	walk('apps/launcher-api/src');
	const setters = toolFiles.filter((file) => read(file).includes('setParticleTimeScale'));
	assert(
		toolFiles.length > 100 && setters.length === 0,
		`no tool sets the clock — /fx, the Scene Editor and the Rigger / Symbols previews play at 1 (${toolFiles.length} launcher files)`,
	);
}

console.log('');
if (failures) {
	console.error(`fx particle clock: ${failures} FAILED`);
	process.exit(1);
}
console.log('fx particle clock: all green');
