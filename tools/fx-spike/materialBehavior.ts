/**
 * Invisible FX — the MATERIAL behaviour gate: `fxMaterial` (`engine-fx` `material.ts`, Invisible
 * Shader Graph step 8d.2) through the real library `Emitter`, offline.
 *
 *   pnpm --filter fx-spike run material-behavior
 *
 * Proves:
 *  1. `bindFxMaterial` adds the behaviour once, as a new config, touching neither the input nor its
 *     live values; `registerFxBehaviors` teaches it, and it stays out of the authored list.
 *  2. At spawn each particle gets a whole seed 0…97, its place in its wave ÷ (size − 1) (0 alone) and
 *     its spawn number ÷ Max particles, wrapping, with Max particles read live; `emitNow` too.
 *  3. A recycled particle is cleared to 0.
 */

import { Container } from 'pixi.js';
import { Emitter, type EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import {
	FX_BEHAVIOR_TYPES,
	FX_MATERIAL_BEHAVIOR_TYPE,
	FX_MATERIAL_KEYS,
	FX_MATERIAL_SEEDS,
	FxMaterialBehavior,
	behaviorsOf,
	bindFxMaterial,
	registerFxBehaviors,
} from 'engine-fx';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};

interface Live {
	config: Record<string, number>;
	next: Live | null;
}
const live = (em: Emitter): Live[] => {
	const out: Live[] = [];
	for (
		let p = (em as unknown as { _activeParticlesFirst: Live | null })._activeParticlesFirst;
		p;
		p = p.next
	)
		out.push(p);
	return out;
};
const values = (p: Live) => ({
	seed: p.config[FX_MATERIAL_KEYS.seed],
	wave: p.config[FX_MATERIAL_KEYS.wave],
	order: p.config[FX_MATERIAL_KEYS.order],
});

console.log('fx material — binding');
const texture = { live: true };
const config = {
	lifetime: { min: 10, max: 10 },
	frequency: 1,
	emitterLifetime: -1,
	maxParticles: 10,
	particlesPerWave: 4,
	pos: { x: 0, y: 0 },
	addAtBack: false,
	behaviors: [{ type: 'textureRandom', config: { textures: [texture] } }],
} as unknown as EmitterConfigV3;
const before = JSON.stringify(config);
const bound = bindFxMaterial(config);
const twice = bindFxMaterial(bound);
assert(JSON.stringify(config) === before, 'the input config is untouched');
assert(
	behaviorsOf(twice).filter((b) => b.type === FX_MATERIAL_BEHAVIOR_TYPE).length === 1,
	'binding twice still adds the behaviour once',
);
assert(
	(behaviorsOf(bound)[0].config.textures as unknown[])[0] === texture,
	'live values in the config are kept, not cloned',
);
registerFxBehaviors(Emitter);
const known = (Emitter as unknown as { knownBehaviors: Record<string, unknown> }).knownBehaviors;
assert(known[FX_MATERIAL_BEHAVIOR_TYPE] === FxMaterialBehavior, 'registerFxBehaviors registers it');
assert(
	!FX_BEHAVIOR_TYPES.includes(FX_MATERIAL_BEHAVIOR_TYPE),
	'it is not an authored behaviour type (no stored config carries it)',
);

console.log('');
console.log('fx material — the real Emitter');
const em = new Emitter(new Container(), bound);
em.update(0.01);
let wave = live(em);
assert(wave.length === 4, 'one wave of four spawned');
assert(
	wave.every((p) => {
		const v = values(p);
		return Number.isInteger(v.seed) && v.seed >= 0 && v.seed < FX_MATERIAL_SEEDS;
	}),
	'seeds are whole numbers 0…97',
);
assert(
	wave.map((p) => values(p).wave).join() === [0, 1 / 3, 2 / 3, 1].join(),
	'wave index is 0, 1/3, 2/3, 1 across a wave of four',
);
assert(
	wave.map((p) => values(p).order).join() === [0, 0.1, 0.2, 0.3].join(),
	'spawn order is the spawn number ÷ Max particles',
);
em.update(1);
em.update(1);
const orders = live(em).map((p) => values(p).order);
assert(
	orders.join() === [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].join(),
	'Max particles caps the third wave at two, their orders 0.8 and 0.9',
);
const recycled = live(em)[0];
em.cleanup();
assert(
	Object.values(values(recycled)).every((v) => v === 0),
	'a recycled particle is cleared to 0',
);
em.maxParticles = 5;
em.emitNow();
assert(
	live(em)
		.map((p) => values(p).order)
		.join() === [0, 0.2, 0.4, 0.6].join(),
	'emitNow spawns through it; the order wraps at the live Max particles (spawn 10 → 0)',
);
const single = new Emitter(
	new Container(),
	bindFxMaterial({ ...config, particlesPerWave: 1 } as EmitterConfigV3),
);
single.update(0.01);
wave = live(single);
assert(wave.length === 1 && values(wave[0]).wave === 0, 'a wave of one reads wave index 0');

console.log('');
if (failures) {
	console.error(`fx material: ${failures} FAILED`);
	process.exit(1);
}
console.log('fx material: all green');
