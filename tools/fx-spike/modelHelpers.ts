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
import {
	EFFECT_DOC_VERSION,
	FX_MATERIAL_LAYER_CAP,
	FX_MATERIAL_LAYER_LOAD_BUDGET,
	fxMaterialLoadEstimate,
	fxMaterialLoadLevel,
	normalizeEffectDoc,
	normalizeEmitterMaterial,
	type EffectParamValue,
	type EmitterLayer,
} from 'engine-fx';
import type { CustomElementFx } from '../../packages/constants-shared/elementFx';
import { REFERENCE_GRAPHS, compileShaderEffect } from '../../packages/engine-shadergraph/index';
import {
	largestFrame,
	strayMaterialDrives,
	materialChoices,
	materialLayerCount,
	materialLayerLoad,
	materialNotes,
	materialParamValue,
	setLayerMaterial,
	setMaterialIntensity,
	setMaterialParam,
	setMaterialTime,
} from '../../apps/launcher-api/src/routes/(app)/fx/fxMaterial.client';
import {
	exposeAsNewParam,
	layerLeavesWithMaterial,
	rowExposure,
} from '../../apps/launcher-api/src/routes/(app)/fx/fxParams.client';
import {
	FX_PRESETS,
	applyPreset,
	setParticleKind,
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

// ---------------------------------------------------------------------------
// 4. A layer's MATERIAL (Invisible Shader Graph step 8d.5): set and clear it and its params, the
//    load estimate, the notes, Apply preset keeping it, ⚡ reaching every param of the spec.
// ---------------------------------------------------------------------------
console.log('fx model — a layer material');
const compiled = (id: string): CustomElementFx => {
	const r = compileShaderEffect(REFERENCE_GRAPHS.find((g) => g.id === id)!);
	if (!r.ok) throw new Error(`fixture graph ${id} does not compile`);
	return r.effect;
};
const dissolve = compiled('noiseDissolve');
const frost = compiled('frost');
const powerUp = compiled('powerUp');
const plainLayer = newLayer('main');
const plainBytes = JSON.stringify(plainLayer);

const picked = setLayerMaterial(plainLayer, dissolve.spec.kind);
assert(JSON.stringify(plainLayer) === plainBytes, 'setLayerMaterial does not mutate the layer');
assert(
	eq(picked.material, { kind: 'custom:noiseDissolve' }),
	'picking a material stores its kind only',
);
const tuned = setMaterialParam(
	setMaterialIntensity(setMaterialTime(picked, 'loop'), 2.5),
	'grain',
	14,
);
assert(
	eq(tuned.material, {
		kind: 'custom:noiseDissolve',
		time: 'loop',
		intensity: 2.5,
		params: { grain: 14 },
	}),
	'time, strength and a param land in the normalizer’s key order',
);
assert(
	eq(normalizeEmitterMaterial(tuned.material), tuned.material),
	'what the page holds is what the normalizer keeps',
);
assert(setMaterialTime(tuned, 'life').material?.time === undefined, 'Life is stored absent');
assert(
	setMaterialIntensity(tuned, 1).material?.intensity === undefined,
	'strength 1 is stored absent',
);
assert(setMaterialIntensity(tuned, 9).material?.intensity === 4, 'strength is clamped to 4');
assert(materialParamValue(tuned, dissolve.spec.params[1]) === 14, 'a held param reads its value');
assert(
	materialParamValue(picked, dissolve.spec.params[0]) === '#ffb347',
	'a param the material holds no value for reads the effect’s default',
);
assert(
	materialParamValue(setMaterialParam(picked, 'grain', 'x'), dissolve.spec.params[1]) === 8,
	'a held value of the wrong type reads the default',
);
const swapped = setLayerMaterial(tuned, frost.spec.kind);
assert(
	eq(swapped.material, { kind: 'custom:frost', time: 'loop', intensity: 2.5 }),
	'another kind drops the old params and keeps time and strength',
);
assert(
	setLayerMaterial(tuned, tuned.material!.kind) === tuned,
	'picking the same kind changes nothing',
);
const cleared = setLayerMaterial(tuned, '');
assert(!('material' in cleared), 'None removes the key');
assert(
	JSON.stringify(cleared) === plainBytes,
	'…leaving the layer byte-identical to one that never had one',
);
assert(
	!('material' in setLayerMaterial(setParticleKind(plainLayer, 'spine'), dissolve.spec.kind)),
	'a rig-clip layer takes no material',
);
assert(
	!('material' in setParticleKind(tuned, 'spine')),
	'turning a layer into rig clips drops its material',
);
assert(
	eq(setParticleKind(tuned, 'sprite').material, tuned.material),
	'…and a no-op switch keeps it',
);

const preset = applyPreset(tuned, FX_PRESETS[0].key);
assert(eq(preset.material, tuned.material), 'Apply preset keeps the material');
assert(!eq(preset.config, tuned.config), '…while it replaces the emitter');

const docWith = {
	...emptyEffectDoc('m', 'With material'),
	layers: [tuned, { ...newLayer('second'), art: { assetKey: 'a.json', frames: ['f'] } }],
};
const reopened = normalizeEffectDoc(JSON.parse(JSON.stringify(docWith)));
assert(
	JSON.stringify(reopened.layers[0].material) === JSON.stringify(tuned.material),
	'save → normalize → reopen gives the material back byte for byte',
);
assert(
	JSON.stringify(
		normalizeEffectDoc(JSON.parse(JSON.stringify({ ...docWith, layers: [cleared] }))).layers[0],
	) ===
		JSON.stringify(
			normalizeEffectDoc(JSON.parse(JSON.stringify({ ...docWith, layers: [plainLayer] })))
				.layers[0],
		),
	'a cleared material saves exactly as a layer that never had one',
);

assert(
	eq(
		materialChoices([powerUp, frost, dissolve]).map((c) => c.label),
		['Frost', 'Noise dissolve', 'Power-up'],
	),
	'the picker lists the compiled effects by name',
);
assert(
	eq(
		materialChoices([powerUp, frost, { ...dissolve, madeFor: 'particles' }]).map((c) => [
			c.label,
			c.particles,
		]),
		[
			['Noise dissolve', true],
			['Frost', false],
			['Power-up', false],
		],
	),
	'…an effect made for particles first (step 8d.7), each group by name',
);
assert(
	eq(
		largestFrame({ ...plainLayer, art: { assetKey: 'a', frames: ['s', 'b'] } }, [
			{ name: 's', w: 10, h: 10 },
			{ name: 'b', w: 20, h: 30 },
			{ name: 'x', w: 90, h: 90 },
		]),
		{ w: 20, h: 30 },
	),
	'the largest frame is read among the layer’s own frames',
);

// The §10 estimate: min(Max particles, per wave × max life ÷ frequency) × the frame padded as the
// renderer pads it, (w + 2p·max(w, h)) × (h + 2p·max(w, h)), × scale² × cost.
const estConfig = {
	...setCoreParam(setCoreParam(defaultEmitterConfig(), 'maxParticles', 200), 'frequency', 0.01),
	lifetime: { min: 0.5, max: 0.8 },
	particlesPerWave: 2,
	behaviors: [
		{
			type: 'scale',
			config: {
				scale: {
					list: [
						{ time: 0, value: 0.5 },
						{ time: 1, value: 1.5 },
					],
				},
			},
		},
	],
} as EmitterConfigV3;
const frame = { w: 32, h: 16 };
const est = fxMaterialLoadEstimate({ config: estConfig, frame, padding: 0.25, cost: 50 });
assert(est.live === 160, `live ≈ min(200, 2 × 0.8 ÷ 0.01) = 160 (got ${est.live})`);
assert(
	Math.abs(est.load - 160 * 48 * 32 * 1.5 * 1.5 * 50) < 1e-6,
	`load = 160 × (32 + 16) × (16 + 16) × 1.5² × 50 = ${160 * 48 * 32 * 2.25 * 50} (got ${Math.round(est.load)}): padding is the frame's larger side's, on each side`,
);
assert(
	fxMaterialLoadEstimate({
		config: { ...estConfig, maxParticles: 100 },
		frame,
		padding: 0.25,
		cost: 50,
	}).live === 100,
	'Max particles caps the live count',
);
assert(
	fxMaterialLoadEstimate({
		config: { ...estConfig, behaviors: [{ type: 'scaleStatic', config: { min: 2, max: 3 } }] },
		frame: { w: 10, h: 10 },
		padding: 0,
		cost: 1,
	}).covered ===
		160 * 100 * 9,
	'a static scale’s larger end is the largest scale',
);
assert(
	fxMaterialLoadEstimate({
		config: { ...estConfig, behaviors: [] },
		frame: { w: 10, h: 10 },
		padding: 0,
		cost: 1,
	}).covered === 16000,
	'no scale behaviour is scale 1',
);
assert(fxMaterialLoadLevel(23_999_999, 32e6) === 'ok', 'under 75 % of the budget is ok');
assert(fxMaterialLoadLevel(24e6, 32e6) === 'amber', 'from 75 % it is amber');
assert(fxMaterialLoadLevel(32_000_001, 32e6) === 'red', 'over the budget it is red');
const estLayer = { ...tuned, config: estConfig };
const estimated = materialLayerLoad({
	layer: estLayer,
	effect: dissolve,
	cost: 50,
	frame,
	measuredArea: undefined,
});
assert(
	!!estimated && !estimated.measured && estimated.budget === FX_MATERIAL_LAYER_LOAD_BUDGET,
	'before the preview has drawn, a layer’s load is the estimate, against 32 M',
);
const measured = materialLayerLoad({
	layer: estLayer,
	effect: dissolve,
	cost: 50,
	frame,
	measuredArea: 700_000,
});
assert(
	measured?.measured === true && measured.load === 35e6 && measured.level === 'red',
	'once drawn, the measured peak × cost (35 M: red)',
);
assert(
	materialLayerLoad({
		layer: plainLayer,
		effect: dissolve,
		cost: 50,
		frame: { w: 1, h: 1 },
		measuredArea: 1,
	}) === undefined,
	'a layer with no material has no load',
);

const notesFor = (layer: EmitterLayer, extra: Partial<Parameters<typeof materialNotes>[0]> = {}) =>
	materialNotes({
		layer,
		params: undefined,
		materialLayers: 1,
		effect: dissolve,
		notCompiled: false,
		skipped: [],
		cost: { id: 'noiseDissolve', shared: false, cost: 33, samples: 1 },
		load: undefined,
		stagePlain: undefined,
		...extra,
	});
const artLayer = { ...tuned, art: { assetKey: 'a.json', frames: ['f'] } };
assert(notesFor(artLayer).length === 0, 'a well-formed material under budget has no notes');
assert(notesFor(plainLayer).length === 0, 'a layer with no material has no notes');
{
	const layers = Array.from({ length: FX_MATERIAL_LAYER_CAP + 1 }, () => artLayer);
	assert(
		materialLayerCount([...layers, plainLayer]) === FX_MATERIAL_LAYER_CAP + 1,
		"the effect's material layers are counted, a layer with none left out",
	);
	const at = (n: number) => notesFor(artLayer, { materialLayers: n });
	assert(
		at(FX_MATERIAL_LAYER_CAP).length === 0,
		`${FX_MATERIAL_LAYER_CAP} material layers: no note`,
	);
	const ninth = at(FX_MATERIAL_LAYER_CAP + 1);
	assert(
		ninth.length === 1 &&
			ninth[0].level === 'warn' &&
			ninth[0].text.includes(`a game draws ${FX_MATERIAL_LAYER_CAP} at once`) &&
			ninth[0].text.includes('at least 1 of them'),
		'a ninth material layer in the effect is warned about before a game draws it plain',
	);
}
const missing = notesFor(artLayer, { effect: undefined, notCompiled: true });
assert(
	missing.length === 1 && missing[0].level === 'off' && missing[0].text.includes('deleted'),
	'a material whose graph was deleted: one note, the particles draw plain',
);
const broken = notesFor(artLayer, {
	effect: undefined,
	notCompiled: true,
	skipped: [{ id: 'noiseDissolve', name: 'Noise dissolve', errors: ['out: no Output'] }],
});
assert(
	broken.length === 1 &&
		broken[0].text.includes('does not compile') &&
		broken[0].text.includes('no Output'),
	'a material whose graph does not compile: says so, with its first error',
);
assert(
	notesFor(artLayer, { effect: powerUp }).some(
		(n) => n.level === 'info' && n.text.includes('its passes and its motion'),
	),
	'an effect with passes and motion: they do not play on particles',
);
assert(
	notesFor(artLayer, {
		effect: frost,
		cost: { id: 'frost', shared: false, cost: 169, samples: 6 },
	}).some((n) => n.level === 'warn' && n.text.includes('169') && n.text.includes('150 / 4')),
	'a graph over 150 / 4 is over the particle budget',
);
assert(
	notesFor(artLayer, { load: measured }).some(
		(n) => n.level === 'warn' && n.text.includes('load budget'),
	),
	'a load over its budget is a warning',
);
const over = { ...artLayer, config: setCoreParam(artLayer.config, 'maxParticles', 600) };
assert(
	notesFor(over).some((n) => n.level === 'off' && n.text.includes('600') && n.text.includes('512')),
	'Max particles over 512: the material is off',
);
const maxDrive = (max: number | undefined) =>
	notesFor(artLayer, {
		params: [
			{
				id: 'count',
				kind: 'number',
				default: 100,
				min: 1,
				...(max === undefined ? {} : { max }),
				drives: [{ id: 'd1', layer: 'main', path: 'emitter.maxParticles' }],
			},
		],
	});
assert(
	maxDrive(800).some((n) => n.level === 'off' && n.text.includes('800')),
	'drivable past 512: off',
);
assert(
	maxDrive(undefined).some((n) => n.level === 'off' && n.text.includes('no upper bound')),
	'driven with no bound: off',
);
assert(!maxDrive(400).some((n) => n.level === 'off'), 'drivable to 400: still on');
assert(
	notesFor(tuned).some((n) => n.level === 'off' && n.text.includes('No art')),
	'no frames yet: the material waits',
);
assert(
	notesFor(artLayer, { stagePlain: 'frames on several textures' }).some((n) =>
		n.text.includes('two atlas pages'),
	),
	'frames on two atlas pages: plain',
);

const strayDoc = [
	{
		id: 'tint',
		kind: 'color' as const,
		default: '#ffffff',
		drives: [{ id: 'd1', layer: 'main', path: 'material.param.tint' }],
	},
	{
		id: 'grain',
		kind: 'number' as const,
		default: 8,
		min: 1,
		max: 32,
		drives: [{ id: 'd1', layer: 'main', path: 'material.param.grain' }],
	},
];
assert(
	eq(strayMaterialDrives(artLayer, strayDoc, dissolve), [{ param: 'tint', id: 'tint' }]),
	'a drive on a param the material lacks is found; one it has is not',
);
assert(
	notesFor(artLayer, { params: strayDoc }).some(
		(n) => n.level === 'warn' && n.text.includes('"tint"') && n.text.includes("doesn't have"),
	),
	'…and named in a note (the parameter is kept)',
);
assert(
	notesFor(artLayer, { stagePlain: 'shell refuses the body' }).some(
		(n) => n.level === 'off' && n.text.includes('particle shell'),
	),
	'a body the particle shell refuses: plain, and said',
);
assert(
	notesFor(over, { stagePlain: 'over capacity' }).filter((n) => n.level === 'off').length === 1,
	'a plain reason a note already gives is not said twice',
);

// ⚡ reaches every param of the compiled spec, held or not.
const leaves = layerLeavesWithMaterial(picked, dissolve.spec.params).map((l) => [l.path, l.value]);
assert(
	eq(leaves.slice(-3), [
		['material.intensity', 1],
		['material.param.edge', '#ffb347'],
		['material.param.grain', 8],
	]),
	'All parameters lists every param of the spec, at its default when not held',
);
assert(
	layerLeavesWithMaterial(tuned, dissolve.spec.params).filter(
		(l) => l.path === 'material.param.grain',
	).length === 1,
	'…and a held one once, at its value',
);
const run = (v: EffectParamValue) => setMaterialParam(picked, 'grain', Number(v));
const exposure = rowExposure({
	label: 'Grain',
	kind: 'number',
	current: picked,
	value: 8,
	low: 1,
	high: 32,
	run,
});
assert(
	!exposure.missing && exposure.leaves.length === 1 && exposure.leaves[0].identity,
	'⚡ on a param the material holds no value for is offered (as is), not "move it first"',
);
const docExposed = exposeAsNewParam(
	{ ...emptyEffectDoc('e', 'E'), layers: [picked] },
	'main',
	exposure,
	'grain',
);
assert(
	docExposed.doc.layers[0].material?.params?.grain === 8 &&
		eq(docExposed.doc.params?.[0].drives, [
			{ id: 'd1', layer: 'main', path: 'material.param.grain' },
		]),
	'…and exposing it writes its default into the material, driven as is',
);
const strength = rowExposure({
	label: 'Strength',
	kind: 'number',
	current: picked,
	value: 1,
	low: 0,
	high: 4,
	run: (v) => setMaterialIntensity(picked, Number(v)),
});
assert(
	eq(
		strength.leaves.map((l) => [l.path, l.identity]),
		[['material.intensity', true]],
	) && !strength.missing,
	'⚡ on Strength drives material.intensity as is',
);

console.log('');
if (failures > 0) {
	console.error(`FX MODEL: ${failures} failure(s)`);
	process.exit(1);
}
console.log('FX MODEL: PASSED');
