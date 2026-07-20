/**
 * Invisible FX — Phase 1 increment 2 headless harness for the `/fx` page's PURE config
 * helpers (`fxModel.client.ts`). The `/fx` page itself is a launcher-authed WebGL surface
 * (not browser-verifiable here), so — exactly as the sibling tools do — we verify the
 * data/config logic the inspector stands on OFFLINE, in Node:
 *
 *   pnpm --filter fx-spike run model
 *
 * Proves: (1) the DEFAULT new-layer config is a real `EmitterConfigV3` that feeds the
 * library's `upgradeConfig(config, textures)` — the EXACT call `ParticleEmitter.svelte`
 * (and `FxStage.svelte`) makes — without throwing; (2) every inspector mutator
 * (`setCoreParam` / `setListEndpoint` / `setSpawnRadius`) is PURE (returns a new config,
 * never mutates its input) and the readouts (`listEndpoints` / `spawnRadius`) round-trip
 * what those setters write; (3) the empty-doc/new-layer factories produce a valid
 * `EffectDoc` shape. WebGL pixels still need live owner-verify (see the design doc).
 */

import { upgradeConfig, type EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import { EFFECT_DOC_VERSION } from 'engine-fx';
import {
	bindArt,
	defaultEmitterConfig,
	emptyEffectDoc,
	listEndpoints,
	newLayer,
	nextLayerKey,
	setCoreParam,
	setListEndpoint,
	setSpawnRadius,
	setSpawnRect,
	setSpawnRing,
	setSpawnShape,
	spawnRadius,
	spawnShape,
} from '../../apps/launcher-api/src/routes/(app)/fx/fxModel.client';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// 1. Default config feeds the library verbatim (the runtime contract).
// ---------------------------------------------------------------------------
console.log('fx model — default config ↔ library');
const def = defaultEmitterConfig();
const before = JSON.stringify(def);
const stubTextures = [{}, {}] as unknown as Parameters<typeof upgradeConfig>[1];
let upgraded: EmitterConfigV3 | undefined;
try {
	upgraded = upgradeConfig(def, stubTextures);
} catch (err) {
	failures++;
	console.error(`  ✗ upgradeConfig threw on the default config: ${(err as Error).message}`);
}
assert(JSON.stringify(def) === before, 'defaultEmitterConfig is not mutated by upgradeConfig');
if (upgraded) {
	assert(
		Array.isArray(upgraded.behaviors),
		'default config upgrades to a V3 config with behaviors',
	);
}

// ---------------------------------------------------------------------------
// 2. Inspector mutators are pure + round-trip with the readouts.
// ---------------------------------------------------------------------------
console.log('fx model — core params (pure + round-trip)');
const base = defaultEmitterConfig();
const baseSnapshot = JSON.stringify(base);
const freq = setCoreParam(base, 'frequency', 0.05);
assert(JSON.stringify(base) === baseSnapshot, 'setCoreParam does not mutate the source config');
assert(freq.frequency === 0.05, 'frequency set');
assert(setCoreParam(base, 'maxParticles', 500).maxParticles === 500, 'maxParticles set');
assert(setCoreParam(base, 'lifetimeMin', 0.2).lifetime.min === 0.2, 'lifetime min set');
assert(setCoreParam(base, 'lifetimeMax', 1.5).lifetime.max === 1.5, 'lifetime max set');
// A 0 (or NaN) lifetime makes the library's age/lifetime lerp Infinity → it walks an
// alpha/scale/speed curve off its end and throws (null.time), freezing the preview. Clamp it.
assert(setCoreParam(base, 'lifetimeMin', 0).lifetime.min >= 0.01, 'lifetime min clamped off 0');
assert(setCoreParam(base, 'lifetimeMax', 0).lifetime.max >= 0.01, 'lifetime max clamped off 0');
assert(setCoreParam(base, 'lifetimeMin', NaN).lifetime.min >= 0.01, 'lifetime min clamps a NaN');
assert(setCoreParam(base, 'frequency', 0).frequency >= 0.001, 'frequency clamped off 0');
assert(setCoreParam(base, 'maxParticles', 0).maxParticles >= 1, 'maxParticles clamped to >= 1');

console.log('fx model — list endpoints (alpha/scale/speed) round-trip');
const a0 = listEndpoints(base, 'alpha', 'alpha');
assert(!!a0 && a0.start === 1 && a0.end === 0, 'alpha endpoints read from default');
const a1 = setListEndpoint(base, 'alpha', 'alpha', 'start', 0.7);
const a1read = listEndpoints(a1, 'alpha', 'alpha');
assert(!!a1read && a1read.start === 0.7, 'alpha start setter round-trips through reader');
assert(JSON.stringify(base) === baseSnapshot, 'setListEndpoint does not mutate the source');

const s1 = setListEndpoint(base, 'scale', 'scale', 'end', 0.9);
assert(listEndpoints(s1, 'scale', 'scale')?.end === 0.9, 'scale end setter round-trips');
const v1 = setListEndpoint(base, 'moveSpeed', 'speed', 'start', 450);
assert(listEndpoints(v1, 'moveSpeed', 'speed')?.start === 450, 'speed start setter round-trips');

console.log('fx model — spawn radius round-trip');
assert(spawnRadius(base) === 8, 'spawn radius read from default');
const r1 = setSpawnRadius(base, 25);
assert(spawnRadius(r1) === 25, 'spawn radius setter round-trips');
assert(JSON.stringify(base) === baseSnapshot, 'setSpawnRadius does not mutate the source');

// ---------------------------------------------------------------------------
// 2c. Spawn SHAPE picker — the four authoring shapes map onto the library's
//     `torus`/`rect` `spawnShape` `{ type, data }`, switching is immutable, and
//     ONLY the `spawnShape` behavior changes (all others byte-identical).
// ---------------------------------------------------------------------------
console.log('fx model — spawn shape picker');

// The default config's torus radius-8 reads back as a CIRCLE (radius>0, no inner ring).
const sh0 = spawnShape(base);
assert(!!sh0 && sh0.kind === 'circle' && sh0.radius === 8, 'default config reads as a circle r=8');

// The set of NON-spawnShape behaviors, JSON-stringified — must be byte-identical after any
// shape edit (the verbatim-config contract: a shape edit touches ONLY `spawnShape`).
const others = (c: EmitterConfigV3): string =>
	JSON.stringify(
		(Array.isArray(c.behaviors) ? c.behaviors : []).filter(
			(b) => (b as { type: string }).type !== 'spawnShape',
		),
	);
const otherSnapshot = others(base);
const spawnEntry = (c: EmitterConfigV3): { type?: string; data?: Record<string, number> } => {
	const b = (Array.isArray(c.behaviors) ? c.behaviors : []).find(
		(x) => (x as { type: string }).type === 'spawnShape',
	) as { config: { type?: string; data?: Record<string, number> } } | undefined;
	return { type: b?.config.type, data: b?.config.data };
};

// Point ⇒ torus radius 0.
const pt = setSpawnShape(base, 'point');
const ptE = spawnEntry(pt);
assert(ptE.type === 'torus' && ptE.data?.radius === 0, 'point ⇒ torus radius 0');
assert(spawnShape(pt)?.kind === 'point', 'point round-trips through the readout');
assert(others(pt) === otherSnapshot, 'point switch leaves other behaviors byte-identical');
assert(JSON.stringify(base) === baseSnapshot, 'setSpawnShape does not mutate the source');

// Circle ⇒ torus radius R (innerRadius absent/0).
const circ = setSpawnShape(base, 'circle');
const circE = spawnEntry(circ);
assert(
	circE.type === 'torus' && (circE.data?.radius ?? 0) > 0 && !circE.data?.innerRadius,
	'circle ⇒ torus radius>0, no inner ring',
);
assert(spawnShape(circ)?.kind === 'circle', 'circle round-trips through the readout');

// Ring ⇒ torus radius + innerRadius>0.
const ring = setSpawnShape(base, 'ring');
const ringE = spawnEntry(ring);
assert(
	ringE.type === 'torus' && (ringE.data?.innerRadius ?? 0) > 0,
	'ring ⇒ torus with innerRadius>0',
);
assert(spawnShape(ring)?.kind === 'ring', 'ring round-trips through the readout');
const ring2 = setSpawnRing(base, 60, 20);
const ring2sh = spawnShape(ring2);
assert(
	ring2sh?.kind === 'ring' && ring2sh.radius === 60 && ring2sh.innerRadius === 20,
	'setSpawnRing writes outer + inner radius',
);
assert(others(ring2) === otherSnapshot, 'ring edit leaves other behaviors byte-identical');

// Rectangle ⇒ rect centred (x/y = -w/2, -h/2).
const rect = setSpawnRect(base, 100, 40);
const rectE = spawnEntry(rect);
assert(
	rectE.type === 'rect' &&
		rectE.data?.w === 100 &&
		rectE.data?.h === 40 &&
		rectE.data?.x === -50 &&
		rectE.data?.y === -20,
	'rectangle ⇒ rect centred (x/y = -w/2, -h/2)',
);
const rectSh = spawnShape(rect);
assert(
	rectSh?.kind === 'rectangle' && rectSh.width === 100 && rectSh.height === 40,
	'rectangle round-trips width/height through the readout',
);
assert(others(rect) === otherSnapshot, 'rectangle switch leaves other behaviors byte-identical');

// A config with NO spawnShape behavior degrades gracefully: readout undefined, picker ADDS one.
const noShape: EmitterConfigV3 = JSON.parse(JSON.stringify(base));
noShape.behaviors = (noShape.behaviors ?? []).filter(
	(b) => (b as { type: string }).type !== 'spawnShape',
);
assert(spawnShape(noShape) === undefined, 'no spawnShape behavior ⇒ readout undefined');
const added = setSpawnShape(noShape, 'circle');
assert(
	spawnShape(added)?.kind === 'circle',
	'picker ADDS a spawnShape to a config that lacked one',
);

// Every shape still feeds upgradeConfig cleanly (the verbatim-config contract holds post-edit).
console.log('fx model — every spawn shape still feeds the library');
for (const c of [pt, circ, ring, rect, added]) {
	let ok = true;
	try {
		upgradeConfig(JSON.parse(JSON.stringify(c)), stubTextures);
	} catch {
		ok = false;
	}
	assert(ok, `shape config (${spawnShape(c)?.kind}) feeds upgradeConfig without throwing`);
}

// A still-valid config after every edit (chained) must still upgrade cleanly.
console.log('fx model — chained edits stay a valid library config');
let chained = base;
chained = setCoreParam(chained, 'frequency', 0.02);
chained = setListEndpoint(chained, 'alpha', 'alpha', 'end', 0.1);
chained = setSpawnRadius(chained, 40);
let chainedOk = true;
try {
	upgradeConfig(JSON.parse(JSON.stringify(chained)), stubTextures);
} catch {
	chainedOk = false;
}
assert(chainedOk, 'chained-edit config still feeds upgradeConfig without throwing');

// ---------------------------------------------------------------------------
// 2b. bindArt — the load-bearing texture seam (a V3 config carries its art as a
//     behavior; upgradeConfig's `art` arg is a no-op for V3, so bindArt injects it).
// ---------------------------------------------------------------------------
console.log('fx model — bindArt injects the art behavior into a V3 config');
const ART_TYPES = new Set(['textureSingle', 'textureRandom', 'animatedSingle', 'animatedRandom']);
const artBehaviors = (c: EmitterConfigV3): { type: string; config: Record<string, unknown> }[] =>
	(Array.isArray(c.behaviors) ? c.behaviors : []).filter((b) =>
		ART_TYPES.has((b as { type: string }).type),
	) as { type: string; config: Record<string, unknown> }[];

// The default config ships with NO art behavior — proving that without bindArt the emitter
// would spawn invisible particles (the bug the prior shell had).
assert(artBehaviors(defaultEmitterConfig()).length === 0, 'default config has no art behavior');

// Fake textures: opaque objects, the way the stage passes live PIXI.Texture instances.
const tex = (n: number): unknown[] => Array.from({ length: n }, (_, i) => ({ __tex: i }));

const baseBind = defaultEmitterConfig();
const baseBindSnap = JSON.stringify(baseBind);

// 0 textures ⇒ no art behavior (an unbound layer renders nothing, by design).
assert(artBehaviors(bindArt(baseBind, [], false)).length === 0, 'no textures ⇒ no art behavior');

// 1 texture ⇒ textureRandom carrying that texture.
const oneTex = tex(1);
const bound1 = bindArt(baseBind, oneTex, false);
const ab1 = artBehaviors(bound1);
assert(ab1.length === 1 && ab1[0].type === 'textureRandom', '1 texture ⇒ a single textureRandom');
assert(
	Array.isArray(ab1[0].config.textures) &&
		(ab1[0].config.textures as unknown[]).length === 1 &&
		(ab1[0].config.textures as unknown[])[0] === oneTex[0],
	'textureRandom carries the live texture (not JSON-cloned away)',
);

// >1 textures + animated ⇒ animatedSingle flipbook (framerate -1 = match-life).
const fourTex = tex(4);
const boundAnim = bindArt(baseBind, fourTex, true);
const abAnim = artBehaviors(boundAnim);
assert(
	abAnim.length === 1 && abAnim[0].type === 'animatedSingle',
	'>1 textures + animated ⇒ animatedSingle',
);
const anim = abAnim[0].config.anim as { framerate: number; loop?: boolean; textures: unknown[] };
assert(
	anim.framerate === -1 && anim.textures.length === 4,
	'animatedSingle anim is match-life, carries all frames',
);
// `loop` must stay ABSENT: the library forces loop:false whenever framerate <= 0, so emitting
// `loop: true` was dead config that misread as "flipbooks loop". Authored looping arrives with
// the clip doc (docs/design/invisible-flipbook.md).
assert(!('loop' in anim), 'animatedSingle does NOT emit a dead loop flag');

// >1 textures but NOT animated ⇒ textureRandom (random static of the set).
assert(
	artBehaviors(bindArt(baseBind, fourTex, false))[0].type === 'textureRandom',
	'>1 textures + not animated ⇒ textureRandom',
);

// bindArt must NOT mutate its input config, and must replace (not duplicate) a prior art behavior.
assert(JSON.stringify(baseBind) === baseBindSnap, 'bindArt does not mutate the source config');
assert(
	artBehaviors(bindArt(bound1, fourTex, true)).length === 1,
	'bindArt replaces an existing art behavior (never stacks two)',
);

// A bound config must still feed the library Emitter path without throwing.
let boundOk = true;
try {
	// V3 config is returned by upgradeConfig untouched; constructing real behaviors happens
	// in the Emitter, but upgradeConfig is the guard ParticleEmitter.svelte runs — prove it
	// passes a bound config through unchanged (the verbatim contract).
	const passed = upgradeConfig(bound1, stubTextures);
	boundOk = artBehaviors(passed as EmitterConfigV3).length === 1;
} catch {
	boundOk = false;
}
assert(boundOk, 'a bound V3 config passes through upgradeConfig with its art behavior intact');

// ---------------------------------------------------------------------------
// 3. Doc / layer factories.
// ---------------------------------------------------------------------------
console.log('fx model — doc + layer factories');
const doc = emptyEffectDoc('e1', 'Effect One');
assert(doc.version === EFFECT_DOC_VERSION, 'emptyEffectDoc stamps the schema version');
assert(doc.id === 'e1' && doc.name === 'Effect One', 'emptyEffectDoc carries id + name');
assert(
	doc.layers.length === 1 && doc.layers[0].particleKind === 'sprite',
	'one default sprite layer',
);
assert(eq(doc.layers[0].art, { assetKey: '', frames: [] }), 'default layer has no art bound');
const k = nextLayerKey(doc);
assert(k === 'layer-2' && !doc.layers.some((l) => l.key === k), 'nextLayerKey is unique');
assert(newLayer('x').key === 'x', 'newLayer takes its key');

console.log('');
if (failures > 0) {
	console.error(`FX MODEL: ${failures} failure(s)`);
	process.exit(1);
}
console.log('FX MODEL: PASSED');
