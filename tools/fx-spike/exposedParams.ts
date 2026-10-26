/**
 * Invisible FX — the EXPOSED PARAMETERS gate (`invisible-fx.md` §"Direction (2026-10-15)", Step 1):
 * the path grammar, the mapping, the defaults-in-config writer, the `/fx` expose model and the live
 * applier on the REAL library `Emitter`.
 *
 *   pnpm --filter fx-spike run exposed-params      (root: pnpm check:fx-params)
 *
 * Proves, offline:
 *  1. The parser takes every path in the grammar (`#n`, numeric indices, the canonical `#0`) and
 *     refuses the rest — including every art behaviour and Tier C's `spineParticle`.
 *  2. The mapping: number → number (linear, clamped), number → colour (RGB lerp), bool, colour.
 *  3. Normalize keeps `params` fail-closed, writes the defaults into the configs, is idempotent, and
 *     an effect with no parameters is byte-identical (same config object, no `params` key).
 *  4. The `/fx` expose model: rows with one leaf, several leaves, a non-linear side effect, a row
 *     whose behaviour exists only off its default, colour and toggle rows.
 *  5. The applier on the real `Emitter`: a value applies with NO reset (the same live particles, the
 *     count does not drop), the new value shows on live and new particles, the behaviour arrays keep
 *     their order and length, each behaviour is rebuilt at most once per frame and only on change,
 *     no values / default values do nothing, emitter fields match what `init` makes of the same
 *     config, the bound config's art stays, and `restore()` puts everything back.
 *  6. The effect-level applier, and the save → export → bake round-trip carrying `params` verbatim.
 */

import { Container, Texture } from 'pixi.js';
import { Emitter, type EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import {
	FX_FORCES_BEHAVIOR_TYPE,
	FxForcesBehavior,
	FxScaleBehavior,
	applyEffectParamDefaults,
	behaviorsOf,
	bindArt,
	bindEffectParams,
	canonicalEffectParamPath,
	createEffectLevelApplier,
	createEffectParamApplier,
	effectParamDriveValue,
	effectParamValue,
	hasEffectLevelDrives,
	listEffectLayerLeaves,
	normalizeEffectDoc,
	parseEffectParamPath,
	registerFxBehaviors,
	stepCollapsedValueLists,
	validateEffectParams,
	type EffectDoc,
	type EffectParam,
	type EffectParamValue,
	type EmitterLayer,
} from 'engine-fx';
import {
	applyPreset,
	defaultEmitterConfig,
	layerKeyTaken,
	newLayer,
	nextLayerKey,
	uniqueLayerKey,
	setCoreParam,
	setCurveBound,
	setCurveVaried,
	setEmissionArc,
	setForceField,
	addForce,
	setParticleColor,
	setParticleSpin,
	setSpawnRect,
	setSpawnShape,
	setSpriteTransform,
	setColorEnabled,
} from '../../apps/launcher-api/src/routes/(app)/fx/fxModel.client';
import {
	driveIssues,
	driveWithParam,
	exposeAsNewParam,
	layerDrives,
	leafExposure,
	removeDrive,
	removeLayerDrives,
	removeParam,
	renameLayerInParams,
	rowDriveState,
	rowExposure,
	setParamDefault,
	setParamRange,
	type RowExposure,
} from '../../apps/launcher-api/src/routes/(app)/fx/fxParams.client';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol;
const json = (v: unknown): string => JSON.stringify(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const num = (
	id: string,
	def: number,
	drives: EffectParam['drives'],
	min = 0,
	max = 1,
): EffectParam => ({
	id,
	kind: 'number',
	default: def,
	min,
	max,
	drives,
});

// -------------------------------------------------------------------------------------------------
console.log('fx params — the path grammar');
{
	const good: [string, string][] = [
		['emitter.frequency', 'emitter'],
		['emitter.spawnChance', 'emitter'],
		['emitter.particlesPerWave', 'emitter'],
		['emitter.maxParticles', 'emitter'],
		['emitter.emitterLifetime', 'emitter'],
		['emitter.lifetime.min', 'emitter'],
		['emitter.lifetime.max', 'emitter'],
		['emitter.pos.x', 'emitter'],
		['emitter.pos.y', 'emitter'],
		['behavior:color.color.list.0.value', 'behavior'],
		['behavior:fxForces.forces.1.strength', 'behavior'],
		['behavior:alpha#2.alpha.list.1.value', 'behavior'],
		['placement.offset.x', 'placement'],
		['placement.offset.y', 'placement'],
		['effect.alpha', 'effect'],
		['effect.scale', 'effect'],
		['effect.tint', 'effect'],
		['effect.timeScale', 'effect'],
	];
	assert(
		good.every(([p, scope]) => {
			const r = parseEffectParamPath(p);
			return r.ok && r.target.scope === scope;
		}),
		`every path in the grammar parses to its scope (${good.length} paths)`,
	);
	const indexed = parseEffectParamPath('behavior:fxForces#1.forces.12.strength');
	assert(
		indexed.ok &&
			indexed.target.scope === 'behavior' &&
			indexed.target.type === 'fxForces' &&
			indexed.target.index === 1 &&
			json(indexed.target.path) === json(['forces', 12, 'strength']),
		'`#n` picks the n-th behaviour; array steps parse as numbers',
	);
	assert(
		canonicalEffectParamPath('behavior:alpha#0.alpha.list.0.value') ===
			'behavior:alpha.alpha.list.0.value' &&
			canonicalEffectParamPath('behavior:alpha#1.alpha.list.0.value') ===
				'behavior:alpha#1.alpha.list.0.value',
		'`#0` is the canonical "first" and is written without an index',
	);
	const bad = [
		'',
		'frequency',
		'emitter.rotation',
		'emitter.lifetime',
		'behavior:alpha',
		'behavior:alpha.',
		'behavior:alpha#01.alpha.list.0.value',
		'behavior:alpha#-1.alpha',
		'behavior:alpha.__proto__.polluted',
		'behavior:alpha.alpha.constructor',
		'behavior:alpha.al pha',
		'placement.offset.z',
		'placement.bone',
		'effect.rotation',
		'effects.alpha',
	];
	assert(
		bad.every((p) => !parseEffectParamPath(p).ok),
		`malformed / unknown paths are refused (${bad.length} paths)`,
	);
	const excluded = [
		'textureSingle',
		'textureRandom',
		'textureOrdered',
		'animatedSingle',
		'animatedRandom',
		'spineParticle',
	];
	assert(
		excluded.every((t) => {
			const r = parseEffectParamPath(`behavior:${t}.anim.framerate`);
			return !r.ok && r.error.includes(t);
		}),
		'the art behaviours and Tier C spineParticle cannot be driven',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('');
console.log('fx params — the mapping');
{
	const p = num('heat', 0.5, [], 10, 20);
	const ramp = { from: 100, to: 300 };
	assert(
		effectParamDriveValue(p, ramp, 10, 'number') === 100 &&
			effectParamDriveValue(p, ramp, 20, 'number') === 300 &&
			effectParamDriveValue(p, ramp, 15, 'number') === 200,
		'number → number is linear from [min, max] to [from, to], exact at both ends',
	);
	assert(
		effectParamDriveValue(p, ramp, -50, 'number') === 100 &&
			effectParamDriveValue(p, ramp, 99, 'number') === 300,
		'…and clamped to the range',
	);
	assert(
		effectParamDriveValue(p, {}, 12.5, 'number') === 12.5 &&
			effectParamDriveValue(p, {}, 25, 'number') === 20,
		'with no from / to the (clamped) value is written as is',
	);
	const unranged: EffectParam = { id: 'u', kind: 'number', default: 0, drives: [] };
	assert(
		effectParamDriveValue(unranged, ramp, 0.25, 'number') === 150 &&
			effectParamDriveValue(unranged, {}, 42, 'number') === 42,
		'no range maps 0..1; an unranged value is written as is unclamped',
	);
	const toColour = { from: '#000000', to: '#ffffff' };
	assert(
		effectParamDriveValue(p, toColour, 15, 'color') === '#808080' &&
			effectParamDriveValue(p, toColour, 10, 'color') === '#000000' &&
			effectParamDriveValue(p, { from: '#FF0000', to: '#0000FF' }, 20, 'color') === '#0000ff',
		'number → colour is an RGB lerp',
	);
	const flag: EffectParam = { id: 'on', kind: 'bool', default: false, drives: [] };
	assert(
		effectParamDriveValue(flag, ramp, false, 'number') === 100 &&
			effectParamDriveValue(flag, ramp, true, 'number') === 300 &&
			effectParamDriveValue(flag, {}, true, 'bool') === true &&
			effectParamDriveValue(flag, { from: '#112233', to: '#AABBCC' }, true, 'color') === '#aabbcc',
		'bool writes from / to, or itself on a bool leaf',
	);
	const tint: EffectParam = { id: 't', kind: 'color', default: '#ffffff', drives: [] };
	assert(
		effectParamDriveValue(tint, {}, '#A1B2C3', 'color') === '#a1b2c3',
		'colour writes itself on a colour leaf',
	);
	assert(
		effectParamDriveValue(tint, {}, '#a1b2c3', 'number') === undefined &&
			effectParamDriveValue(flag, {}, true, 'number') === undefined &&
			effectParamDriveValue(p, {}, 12, 'bool') === undefined &&
			effectParamDriveValue(p, { from: 1, to: 2 }, 12, 'color') === undefined &&
			effectParamDriveValue(p, {}, Number.NaN, 'number') === undefined,
		'incompatible kinds and non-finite values write nothing (the drive is inert)',
	);
	assert(
		effectParamValue(p, 'hot') === 10 &&
			effectParamValue(p, 99) === 20 &&
			effectParamValue(flag, 1) === false &&
			effectParamValue(tint, '#ABCDEF') === '#abcdef',
		'a live value of the wrong kind reads as the default (here clamped into 10..20); numbers clamp, colours lower-case',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('');
console.log('fx params — normalize, defaults in the config, byte identity');
const sparks = (): EmitterConfigV3 => {
	const c = defaultEmitterConfig();
	return setColorEnabled(c, true);
};
const baseLayer = (key = 'main'): EmitterLayer => ({ ...newLayer(key), config: sparks() });
{
	// An effect with no parameters is untouched: the same config object, no `params` key.
	const plain = { version: 1, id: 'plain', name: 'Plain', layers: [baseLayer()] };
	const out = normalizeEffectDoc(plain);
	assert(
		json(Object.keys(out)) === json(['version', 'id', 'name', 'layers']) &&
			out.layers[0].config === plain.layers[0].config,
		'no params ⇒ no `params` key and the config object passes through by reference',
	);
	assert(
		json(out) ===
			`{"version":1,"id":"plain","name":"Plain","layers":[{"key":"main","config":${json(
				plain.layers[0].config,
			)},"art":{"assetKey":"","frames":[]},"placement":{"space":"free"},"particleKind":"sprite"}]}`,
		'…and its JSON is byte-identical to the pre-parameter shape',
	);
	const emptied = normalizeEffectDoc({ ...plain, params: [] });
	const junk = normalizeEffectDoc({ ...plain, params: [{ id: '', kind: 'number' }, 7, null] });
	assert(
		!('params' in emptied) &&
			!('params' in junk) &&
			json(emptied) === json(out) &&
			json(junk) === json(out),
		'`params: []` and a list of only malformed params both read as none (byte-identical)',
	);

	const authored = {
		...plain,
		id: 'p',
		params: [
			{
				id: ' rate ',
				kind: 'number',
				default: 0.05,
				min: 0.5,
				max: 0.001,
				note: 'spawn interval',
				drives: [
					{ id: 'd1', layer: 'main', path: 'emitter.frequency' },
					{ id: 'd1', layer: 'main', path: 'emitter.maxParticles' },
					{ id: 'bad-path', layer: 'main', path: 'behavior:textureRandom.textures.0' },
					{ id: 'one-sided', layer: 'main', path: 'emitter.maxParticles', from: 1 },
					{ id: 'mixed', layer: 'main', path: 'emitter.maxParticles', from: 1, to: '#ffffff' },
					{ id: 'no-layer', path: 'emitter.maxParticles' },
					{ id: 'effect-with-layer', layer: 'main', path: 'effect.alpha' },
					{ id: 'gone', layer: 'removed-layer', path: 'emitter.frequency' },
					{ id: 'd2', layer: 'main', path: 'behavior:alpha#0.alpha.list.0.value', from: 0, to: 1 },
				],
			},
			{ id: 'rate', kind: 'number', default: 1, drives: [] },
			{ id: 'mood', kind: 'vec2', default: [0, 0], drives: [] },
			{ id: 'wrongDefault', kind: 'bool', default: 'yes', drives: [] },
			{
				id: 'tint',
				kind: 'color',
				default: '#00FF00',
				drives: [
					{ id: 'c1', layer: 'main', path: 'behavior:color.color.list.0.value' },
					{
						id: 'c2',
						layer: 'main',
						path: 'behavior:color.color.list.1.value',
						from: '#000000',
						to: '#ffffff',
					},
				],
			},
			{ id: 'fade', kind: 'number', default: 0.25, drives: [{ id: 'e', path: 'effect.alpha' }] },
		],
	};
	const saved = normalizeEffectDoc(clone(authored));
	const params = saved.params ?? [];
	assert(
		json(params.map((p) => p.id)) === json(['rate', 'tint', 'fade']),
		'malformed params are dropped (unknown kind, wrong default type, duplicate id); ids trimmed',
	);
	const rate = params[0];
	assert(
		rate.min === 0.001 &&
			rate.max === 0.5 &&
			rate.default === 0.05 &&
			rate.note === 'spawn interval',
		'an inverted range is put in order; the default sits inside it; the note is kept',
	);
	assert(
		json(rate.drives.map((d) => d.id)) === json(['d1', 'gone', 'd2']) &&
			rate.drives[2].path === 'behavior:alpha.alpha.list.0.value',
		'malformed drives are dropped (excluded behaviour, one-sided / mixed from-to, missing or extra layer, duplicate id); an unresolved drive is KEPT; paths are canonical',
	);
	assert(
		json(params[1].drives.map((d) => d.id)) === json(['c1']) && params[1].default === '#00ff00',
		'a colour parameter only writes itself (a from / to drive is dropped); colours lower-case',
	);
	assert(
		saved.layers[0].config.frequency === 0.05 &&
			(
				behaviorsOf(saved.layers[0].config).find((b) => b.type === 'color')!.config.color as {
					list: { value: string }[];
				}
			).list[0].value === '#00ff00',
		'defaults are written into the config (frequency, a colour leaf)',
	);
	const alphaStart = (
		behaviorsOf(saved.layers[0].config).find((b) => b.type === 'alpha')!.config.alpha as {
			list: { value: number }[];
		}
	).list[0].value;
	assert(
		near(alphaStart, (0.05 - 0.001) / (0.5 - 0.001)),
		'a mapped drive writes its mapped default',
	);
	assert(
		json(authored.layers[0].config) === json(plain.layers[0].config),
		'normalize never mutates its input (the authored config is untouched)',
	);
	const again = normalizeEffectDoc(clone(saved));
	assert(
		json(again) === json(saved),
		'normalize is idempotent with params (save → reopen identical)',
	);
	assert(
		applyEffectParamDefaults(saved) === saved,
		'applyEffectParamDefaults on a doc already at its defaults returns the same object',
	);
	const issues = validateEffectParams(saved);
	assert(
		issues.length === 1 &&
			issues[0].drive === 'gone' &&
			issues[0].message.includes('removed-layer'),
		'validation reports exactly the drive whose layer is gone',
	);
	const dropped = {
		...saved,
		layers: [{ ...saved.layers[0], config: setColorEnabled(saved.layers[0].config, false) }],
	};
	const after = validateEffectParams(dropped);
	assert(
		after.some((i) => i.drive === 'c1' && i.message.includes('"color"')),
		'removing the behaviour a drive points at is reported, not silently forgotten',
	);
	const kept = normalizeEffectDoc(clone(dropped));
	assert(
		kept.params?.[1].drives.length === 1 &&
			json(kept.layers[0].config) === json(dropped.layers[0].config),
		'…and normalize keeps that drive while writing nothing for it',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('');
console.log('fx params — the leaf listing (the "All parameters" tree)');
{
	const layer = baseLayer();
	layer.config.behaviors.push({
		type: 'alpha',
		config: { alpha: { list: [{ time: 0, value: 0.3 }] } },
	});
	const leaves = listEffectLayerLeaves(layer);
	const paths = new Set(leaves.map((l) => l.path));
	assert(
		paths.has('emitter.frequency') &&
			paths.has('emitter.pos.y') &&
			paths.has('placement.offset.x') &&
			paths.has('behavior:alpha.alpha.list.1.value') &&
			paths.has('behavior:alpha#1.alpha.list.0.value') &&
			paths.has('behavior:color.color.list.0.value') &&
			paths.has('behavior:spawnShape.data.radius'),
		'emitter fields, every behaviour leaf (#1 on the second of a type) and the offset are listed',
	);
	assert(
		leaves.every((l) => parseEffectParamPath(l.path).ok),
		'every listed leaf parses back through the grammar',
	);
	assert(
		leaves.find((l) => l.path === 'behavior:color.color.list.0.value')?.kind === 'color' &&
			paths.has('behavior:alpha.alpha.list.0.time') &&
			!paths.has('behavior:spawnShape.type'),
		'colour strings are colour leaves, numbers anywhere are leaves; a plain string (a shape type) is not',
	);
	const bound = { ...layer, config: bindArt(layer.config, [{}, {}], false) };
	assert(
		!listEffectLayerLeaves(bound).some((l) => l.path.startsWith('behavior:texture')),
		'an art behaviour bindArt injected is never listed',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('');
console.log('fx params — ⚡ Expose from inspector rows');
const probe = (
	layer: EmitterLayer,
	label: string,
	kind: 'number' | 'color' | 'bool',
	value: EffectParamValue,
	low: EffectParamValue,
	high: EffectParamValue,
	set: (c: EmitterConfigV3, v: EffectParamValue) => EmitterConfigV3,
): RowExposure =>
	rowExposure({
		label,
		kind,
		current: layer,
		value,
		low,
		high,
		run: (v) => ({ ...layer, config: set(clone(layer.config), v) }),
	});
{
	const layer = baseLayer();
	const doc: EffectDoc = { version: 1, id: 'x', name: 'x', layers: [layer] };
	const freq = probe(layer, 'Frequency (s)', 'number', 0.012, 0.001, 0.5, (c, v) =>
		setCoreParam(c, 'frequency', Number(v)),
	);
	assert(
		json(freq.leaves.map((l) => [l.path, l.identity])) === json([['emitter.frequency', true]]) &&
			freq.ownLeaf === 'emitter.frequency' &&
			!freq.missing,
		'a one-leaf row exposes that leaf as is',
	);
	const made = exposeAsNewParam(doc, 'main', freq);
	const p = made.doc.params?.[0];
	assert(
		made.id === 'frequency' &&
			!!p &&
			p.min === 0.001 &&
			p.max === 0.5 &&
			p.default === 0.012 &&
			json(p.drives) === json([{ id: 'd1', layer: 'main', path: 'emitter.frequency' }]),
		'New parameter… takes the row label, range and value, with an as-is drive',
	);
	assert(
		json(made.doc.layers) === json(doc.layers),
		'exposing a row never changes the look (the default is the current value)',
	);
	const state = rowDriveState(layerDrives(made.doc, 'main'), freq);
	assert(
		state?.param.id === 'frequency' && state.editable,
		'the driven row shows the parameter and stays editable',
	);
	const edited = setParamDefault(made.doc, 'frequency', 0.2);
	assert(
		edited.layers[0].config.frequency === 0.2 && edited.params?.[0].default === 0.2,
		'editing an as-is driven row edits the default, and the config follows',
	);

	const preset = applyPreset(edited.layers[0], 'smoke');
	const kept = applyEffectParamDefaults({ ...edited, layers: [preset] });
	assert(
		preset.config.frequency !== 0.2 && kept.layers[0].config.frequency === 0.2,
		'a preset over a driven layer: the driven value is put back to its default (what Save stores)',
	);

	// Direction: one row, two leaves, both mapped.
	const arc = probe(layer, 'Direction (°)', 'number', 180, 0, 360, (c, v) =>
		setEmissionArc(c, Number(v), 180),
	);
	assert(
		json(arc.leaves.map((l) => [l.path, l.low, l.high, l.identity])) ===
			json([
				['behavior:rotationStatic.min', -180, 180, false],
				['behavior:rotationStatic.max', 180, 540, false],
			]),
		'a row that writes two leaves (direction ± spread) exposes both, mapped',
	);
	const arcDoc = exposeAsNewParam(doc, 'main', arc).doc;
	assert(
		json(normalizeEffectDoc(clone(arcDoc)).layers[0].config) === json(layer.config),
		'…and the mapping reproduces the row exactly (the defaults write back the same config)',
	);
	assert(
		rowDriveState(layerDrives(arcDoc, 'main'), arc)?.editable === false,
		'a row under a mapped drive is read-only',
	);

	// Lifetime min drags the max along only once it passes it — a non-linear side effect.
	const life = probe(layer, 'Lifetime min (s)', 'number', 0.5, 0.05, 5, (c, v) =>
		setCoreParam(c, 'lifetimeMin', Number(v)),
	);
	assert(
		json(life.writes) === json(['emitter.lifetime.min', 'emitter.lifetime.max']) &&
			json(life.leaves.map((l) => l.path)) === json(['emitter.lifetime.min']),
		'a non-linear side effect (lifetime max) is dropped; the row exposes its own leaf',
	);

	// Spin lives in `rotation`, which exists only while spin is non-zero.
	const spin = probe(layer, 'Spin min (°/s)', 'number', 0, -720, 720, (c, v) =>
		setParticleSpin(c, { minSpeed: Number(v), maxSpeed: 0, accel: 0 }),
	);
	assert(
		spin.missing,
		'a row whose behaviour exists only off its default reports it must move first',
	);

	// Sprite rotation wraps at ±180 and drops its behaviour at 0° — interior probes see past both.
	const rotRow = (l: EmitterLayer, v: number) =>
		probe(l, 'Rotation (°)', 'number', v, -180, 180, (c, x) =>
			setSpriteTransform(c, { rotation: Number(x) }),
		);
	const turned = { ...layer, config: setSpriteTransform(layer.config, { rotation: 10 }) };
	const rot = rotRow(turned, 10);
	assert(
		rotRow(layer, 0).missing &&
			json(rot.leaves.map((l) => [l.path, l.low, l.high, l.identity])) ===
				json([['behavior:fxSprite.rotation', -180, 180, true]]) &&
			!rot.missing,
		'a row that wraps at its ends (sprite rotation) is still exposed as is over its full range',
	);

	// A clamped min: not linear across the row, so it is exposed through its own leaf + range.
	const varied = setCurveBound(
		setCurveVaried(layer.config, 'alpha', true),
		'alpha',
		'start',
		'max',
		0.6,
	);
	const vLayer = { ...layer, config: varied };
	const minRow = probe(vLayer, 'Start min', 'number', 0.3, 0, 1, (c, v) =>
		setCurveBound(c, 'alpha', 'start', 'min', Number(v)),
	);
	assert(
		minRow.leaves.length === 1 &&
			minRow.leaves[0].path === 'behavior:fxAlpha.startMin' &&
			minRow.range?.min === 0 &&
			minRow.range?.max === 0.6,
		'a clamped row is exposed through its own leaf, over the range that leaf really spans',
	);

	// A rectangle's width writes the centred x (mapped) and w (as is).
	const rect = { ...layer, config: setSpawnShape(layer.config, 'rectangle') };
	const width = probe(rect, 'Width', 'number', 64, 0, 800, (c, v) =>
		setSpawnRect(c, Number(v), 64),
	);
	assert(
		json(width.leaves.map((l) => [l.path, l.identity])) ===
			json([
				['behavior:spawnShape.data.x', false],
				['behavior:spawnShape.data.w', true],
			]),
		'a row with an as-is leaf and a mapped one exposes both',
	);
	const wDoc = exposeAsNewParam({ ...doc, layers: [rect] }, 'main', width).doc;
	assert(
		rowDriveState(layerDrives(wDoc, 'main'), width)?.editable === true &&
			json(
				setParamDefault(wDoc, 'width', 200).layers[0].config.behaviors.find(
					(b) => b.type === 'spawnShape',
				)?.config.data,
			) === json({ x: -100, y: -32, w: 200, h: 64 }),
		'…editing it edits the default, which moves both leaves together',
	);

	// Colour + toggle rows.
	const colour = probe(layer, 'Start', 'color', '#fff1a8', '#000000', '#ffffff', (c, v) =>
		setParticleColor(c, 'start', String(v)),
	);
	assert(
		json(colour.leaves.map((l) => [l.path, l.kind, l.identity])) ===
			json([['behavior:color.color.list.0.value', 'color', true]]),
		'a colour row exposes its colour leaf as is',
	);
	const forced = { ...layer, config: addForce(layer.config, 'gravity') };
	const toggle = probe(forced, 'On', 'bool', true, false, true, (c, v) =>
		setForceField(c, 0, 'enabled', v === true),
	);
	assert(
		json(toggle.leaves.map((l) => [l.path, l.kind, l.identity])) ===
			json([['behavior:fxForces.forces.0.enabled', 'bool', true]]),
		'a toggle row exposes its on/off leaf as is',
	);

	// Drive with an existing parameter.
	const withIntensity: EffectDoc = {
		...doc,
		params: [{ id: 'intensity', kind: 'number', default: 0, min: 0, max: 1, drives: [] }],
	};
	const driven = driveWithParam(withIntensity, 'intensity', 'main', freq);
	assert(
		json(driven.params?.[0].drives) ===
			json([{ id: 'd1', layer: 'main', path: 'emitter.frequency', from: 0.001, to: 0.5 }]) &&
			driven.layers[0].config.frequency === 0.001,
		'Drive with maps the parameter over the row range and writes its default',
	);
	const tinted = driveWithParam(withIntensity, 'intensity', 'main', colour);
	assert(
		json(tinted.params?.[0].drives[0]) ===
			json({
				id: 'd1',
				layer: 'main',
				path: 'behavior:color.color.list.0.value',
				from: '#fff1a8',
				to: '#ffffff',
			}),
		'a number parameter drives a colour row through two colours',
	);
	const raw = leafExposure({ path: 'behavior:spawnShape.data.radius', kind: 'number', value: 8 });
	const rawDoc = exposeAsNewParam(doc, 'main', raw);
	assert(
		rawDoc.doc.params?.[0].min === 0 &&
			rawDoc.doc.params?.[0].max === 16 &&
			rawDoc.doc.params?.[0].default === 8,
		'a raw leaf from "All parameters" becomes a parameter over a range around its value',
	);
	const ranged = setParamRange(rawDoc.doc, rawDoc.id, 40, 20);
	assert(
		ranged.params?.[0].min === 20 &&
			ranged.params?.[0].max === 40 &&
			ranged.params?.[0].default === 20,
		'setting a range orders it and pulls the default (and the leaf) inside',
	);
	const renamed = renameLayerInParams(made.doc, 'main', 'sparks');
	assert(
		renamed.params?.[0].drives[0].layer === 'sparks',
		'a layer rename follows into the drives',
	);
	const noDrive = removeDrive(made.doc, 'frequency', 'd1');
	const none = removeParam(made.doc, 'frequency');
	assert(
		noDrive.params?.[0].drives.length === 0 && !('params' in none) && json(none) === json(doc),
		'removing the last parameter leaves the doc byte-identical to never having had one',
	);

	// A value typed past the row's range (Offset X 640 on a −500..500 row) widens the parameter.
	const far = { ...layer, placement: { space: 'free' as const, offset: { x: 640, y: 0 } } };
	const farDoc: EffectDoc = { ...doc, layers: [far] };
	const offsetRow = rowExposure({
		label: 'Offset X',
		kind: 'number',
		current: far,
		value: 640,
		low: -500,
		high: 500,
		run: (v) => ({ ...far, placement: { ...far.placement, offset: { x: Number(v), y: 0 } } }),
	});
	const farMade = exposeAsNewParam(farDoc, 'main', offsetRow);
	const farSaved = normalizeEffectDoc(clone(farMade.doc));
	assert(
		farMade.doc.params?.[0].min === -500 &&
			farMade.doc.params?.[0].max === 640 &&
			farMade.doc.params?.[0].default === 640 &&
			json(farSaved.layers) === json(farDoc.layers),
		'exposing a value outside the row range widens the range — the look and the saved config are unchanged',
	);
	const wide = { ...rect, config: setSpawnRect(rect.config, 900, 64) };
	const wideRow = probe(wide, 'Width', 'number', 900, 0, 800, (c, v) =>
		setSpawnRect(c, Number(v), 64),
	);
	const wideDoc = exposeAsNewParam({ ...doc, layers: [wide] }, 'main', wideRow).doc;
	assert(
		wideDoc.params?.[0].max === 900 &&
			json(normalizeEffectDoc(clone(wideDoc)).layers[0].config) === json(wide.config),
		'…a mapped leaf (the rectangle centring) is extended along the same line, so it still matches',
	);
}

console.log('');
console.log('fx params — layer keys and deleted layers');
{
	const two: EffectDoc = {
		version: 1,
		id: 'k',
		name: 'k',
		layers: [baseLayer('layer-1'), baseLayer('layer-2')],
		params: [
			num('rate', 0.012, [
				{ id: 'd1', layer: 'layer-2', path: 'emitter.frequency' },
				{ id: 'd2', layer: 'layer-1', path: 'emitter.maxParticles', from: 10, to: 200 },
			]),
			num('fade', 1, [{ id: 'd1', layer: 'layer-2', path: 'behavior:alpha.alpha.list.0.value' }]),
			num('glow', 0.5, [
				{ id: 'd1', layer: 'layer-1', path: 'behavior:fxColorOverlay.minIntensity' },
			]),
		],
	};
	const without = removeLayerDrives({ ...two, layers: [two.layers[0]] }, 'layer-2');
	assert(
		json(without.params?.map((p) => [p.id, p.drives.map((d) => `${d.layer}/${d.id}`)])) ===
			json([
				['rate', ['layer-1/d2']],
				['fade', []],
				['glow', ['layer-1/d1']],
			]),
		'deleting a layer drops the drives naming it; a parameter left with none stays; a drive on a missing behaviour stays (⚠)',
	);
	// A doc saved with a drive whose layer is gone: no new key may adopt it.
	const orphaned: EffectDoc = { ...two, layers: [two.layers[0]] };
	assert(
		nextLayerKey(orphaned) === 'layer-3' &&
			uniqueLayerKey(orphaned, 'layer-2') === 'layer-2-2' &&
			layerKeyTaken(orphaned, 'layer-2') &&
			!layerKeyTaken(orphaned, 'layer-9'),
		'a key an orphan drive still names counts as taken (new layer, paste / duplicate, rename)',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('');
console.log('fx params — the applier on the real Emitter');
registerFxBehaviors(Emitter);

interface LiveParticle {
	x: number;
	y: number;
	alpha: number;
	tint: number;
	age: number;
	agePercent: number;
	maxLife: number;
	config: Record<string, unknown>;
	next: LiveParticle | null;
}
interface EmitterGuts {
	initBehaviors: unknown[];
	updateBehaviors: unknown[];
	recycleBehaviors: unknown[];
	_activeParticlesFirst: LiveParticle | null;
}
const guts = (em: Emitter): EmitterGuts => em as unknown as EmitterGuts;
const live = (em: Emitter): LiveParticle[] => {
	const out: LiveParticle[] = [];
	for (let p = guts(em)._activeParticlesFirst; p; p = p.next) out.push(p);
	return out;
};
const typesOf = (list: unknown[]): string[] =>
	list.map((b) =>
		typeof b === 'object' && b ? String((b.constructor as { type?: string }).type) : 'POS',
	);
const step = (em: Emitter, seconds: number): void => {
	for (let i = 0; i < Math.round(seconds * 60); i++) em.update(1 / 60);
};

let builds = 0;
class CountingScale extends FxScaleBehavior {
	static type = 'countingScale';
	constructor(config: ConstructorParameters<typeof FxScaleBehavior>[0]) {
		super(config);
		builds++;
	}
}
Emitter.registerBehavior(CountingScale as never);

const swapConfig = (): EmitterConfigV3 =>
	({
		lifetime: { min: 4, max: 4 },
		frequency: 0.05,
		emitterLifetime: -1,
		maxParticles: 500,
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
			{
				type: 'countingScale',
				config: {
					scale: {
						list: [
							{ time: 0, value: 1 },
							{ time: 1, value: 0.5 },
						],
					},
				},
			},
			{
				type: 'color',
				config: {
					color: {
						list: [
							{ time: 0, value: '#ff0000' },
							{ time: 1, value: '#880000' },
						],
					},
				},
			},
			{ type: 'moveSpeedStatic', config: { min: 50, max: 50 } },
			{ type: 'rotationStatic', config: { min: 0, max: 360 } },
			{ type: 'spawnShape', config: { type: 'torus', data: { x: 0, y: 0, radius: 4 } } },
			{
				type: FX_FORCES_BEHAVIOR_TYPE,
				config: { forces: [{ kind: 'gravity', enabled: true, strength: 0, angle: 90 }] },
			},
		],
	}) as unknown as EmitterConfigV3;

const swapLayer: EmitterLayer = { ...newLayer('main'), config: swapConfig() };
const swapParams: EffectParam[] = [
	num('fade', 1, [{ id: 'a', layer: 'main', path: 'behavior:alpha.alpha.list.0.value' }]),
	num(
		'big',
		1,
		[{ id: 's0', layer: 'main', path: 'behavior:countingScale.scale.list.0.value' }],
		0,
		4,
	),
	num(
		'small',
		0.5,
		[{ id: 's1', layer: 'main', path: 'behavior:countingScale.scale.list.1.value' }],
		0,
		4,
	),
	{
		id: 'tint',
		kind: 'color',
		default: '#ff0000',
		drives: [{ id: 'c0', layer: 'main', path: 'behavior:color.color.list.0.value' }],
	},
	{
		id: 'tintEnd',
		kind: 'color',
		default: '#880000',
		drives: [{ id: 'c1', layer: 'main', path: 'behavior:color.color.list.1.value' }],
	},
	num(
		'pull',
		0,
		[{ id: 'g', layer: 'main', path: 'behavior:fxForces.forces.0.strength' }],
		0,
		1000,
	),
	num('rate', 0.05, [{ id: 'f', layer: 'main', path: 'emitter.frequency' }], 0.01, 0.5),
	num('slide', 0, [{ id: 'o', layer: 'other', path: 'emitter.frequency' }]),
];
{
	const doc = normalizeEffectDoc({
		version: 1,
		id: 'swap',
		name: 'swap',
		layers: [swapLayer],
		params: swapParams,
	});
	assert(
		json(doc.layers[0].config) === json(swapLayer.config),
		'the authored config is already at the defaults',
	);
	const bound = bindArt(doc.layers[0].config, [Texture.EMPTY], false);
	const boundBefore = json(behaviorsOf(bound).filter((b) => b.type !== 'textureRandom'));
	const em = new Emitter(new Container(), bound);
	em.emit = true;
	em.update(0);
	step(em, 2);
	const applier = createEffectParamApplier({
		params: doc.params,
		layer: doc.layers[0],
		emitter: em,
	});
	assert(!!applier, 'a layer with drives gets an applier');
	assert(
		createEffectParamApplier({
			params: doc.params,
			layer: { ...doc.layers[0], key: 'nobody' },
			emitter: em,
		}) === undefined &&
			createEffectParamApplier({
				params: undefined,
				layer: doc.layers[0],
				emitter: em,
			}) === undefined,
		'a layer nothing drives (or a doc with no params) gets none — no per-frame work at all',
	);

	const before = live(em);
	const init0 = [...guts(em).initBehaviors];
	const update0 = [...guts(em).updateBehaviors];
	const recycle0 = [...guts(em).recycleBehaviors];
	const buildsAtStart = builds;
	const frequency0 = em.frequency;

	applier!.apply(undefined);
	applier!.apply({});
	applier!.apply({
		fade: 1,
		big: 1,
		small: 0.5,
		tint: '#FF0000',
		tintEnd: '#880000',
		pull: 0,
		rate: 0.05,
	});
	assert(
		builds === buildsAtStart &&
			guts(em).initBehaviors.every((b, i) => b === init0[i]) &&
			em.frequency === frequency0,
		'no values, an empty record and values equal to the defaults do nothing (no rebuild, no field write)',
	);

	assert(before.length >= 30, `the emitter has live particles to protect (${before.length})`);
	const vy0 = new Map(before.map((p) => [p, (p.config.velocity as { y: number }).y]));
	applier!.apply({
		fade: 0.2,
		big: 2,
		small: 0.1,
		tint: '#00ff00',
		tintEnd: '#00ff00',
		pull: 1000,
		rate: 0.2,
	});
	assert(
		builds === buildsAtStart + 1,
		'two leaves of one behaviour changed in one call ⇒ ONE rebuild of it',
	);
	const after = live(em);
	assert(
		after.length === before.length && after.every((p, i) => p === before[i]),
		'the same live particles survive the change — nothing was reset',
	);
	assert(
		json(typesOf(guts(em).initBehaviors)) === json(typesOf(init0)) &&
			json(typesOf(guts(em).updateBehaviors)) === json(typesOf(update0)) &&
			json(typesOf(guts(em).recycleBehaviors)) === json(typesOf(recycle0)),
		'initBehaviors / updateBehaviors / recycleBehaviors keep their order and length',
	);
	const swapped = typesOf(init0).filter((t, i) => guts(em).initBehaviors[i] !== init0[i]);
	assert(
		json(swapped.sort()) ===
			json(['alpha', 'color', 'countingScale', FX_FORCES_BEHAVIOR_TYPE].sort()),
		'exactly the driven behaviours were rebuilt; every other instance is the same object',
	);
	assert(em.frequency === 0.2, 'an emitter field is set live (frequency)');
	assert(
		(em.getBehavior(FX_FORCES_BEHAVIOR_TYPE) as FxForcesBehavior).forces[0].strength === 1000,
		'the rebuilt fxForces carries the new strength',
	);
	em.update(1 / 60);
	const survivors = live(em).filter((p) => before.includes(p));
	assert(
		survivors.length === before.length,
		`no particle died on the frame after the change (${survivors.length} of ${before.length})`,
	);
	const curve = survivors.every((p) => near(p.alpha, 0.2 * (1 - p.agePercent), 1e-6));
	assert(curve, 'a LIVE particle follows the new alpha curve at once (0.2 → 0 over its life)');
	const scaleOk = survivors.every((p) => {
		const want = 2 + (0.1 - 2) * p.agePercent;
		const s = (p as unknown as { scale: { x: number } }).scale.x;
		return near(s, want, 1e-6);
	});
	assert(scaleOk, '…and the new scale curve (both ends changed in that one rebuild)');
	assert(
		survivors.every((p) => p.tint === 0x00ff00),
		'…and the new colour, live — both ends driven to one colour, which the library alone would crash on',
	);
	const fresh = live(em).filter((p) => !before.includes(p));
	assert(
		fresh.length > 0 &&
			fresh.every((p) => p.tint === 0x00ff00 && near(p.alpha, 0.2 * (1 - p.agePercent), 1e-6)),
		`a NEW particle is born with the new values (${fresh.length} spawned since)`,
	);
	// `moveSpeedStatic` owns the velocity, so gravity folds into it: one 1/60 s step at 1000 px/s².
	const pulled = survivors.every((p) =>
		near((p.config.velocity as { y: number }).y - vy0.get(p)!, 1000 / 60, 1e-6),
	);
	assert(pulled, 'the new force strength pulls the live particles (Δv = 1000 px/s² × 1/60 s)');
	const buildsBefore = builds;
	applier!.apply({
		fade: 0.2,
		big: 2,
		small: 0.1,
		tint: '#00ff00',
		tintEnd: '#00ff00',
		pull: 1000,
		rate: 0.2,
	});
	assert(builds === buildsBefore, 'the same values again ⇒ no rebuild');
	assert(
		json(behaviorsOf(bound).filter((b) => b.type !== 'textureRandom')) === boundBefore &&
			json(doc.layers[0].config) === json(swapLayer.config),
		'the applier works on its own copies — the bound config and the doc are untouched',
	);
	assert(
		guts(em).initBehaviors.some(
			(b) =>
				typeof b === 'object' && b && (b.constructor as { type?: string }).type === 'textureRandom',
		) &&
			init0.includes(
				guts(em).initBehaviors.find(
					(b) =>
						typeof b === 'object' &&
						b &&
						(b.constructor as { type?: string }).type === 'textureRandom',
				),
			),
		'the bound art behaviour (with its textures) is never rebuilt',
	);

	let threw = false;
	try {
		applier!.apply({ fade: 0, tint: '#00ff00', tintEnd: '#00ff00' });
		em.update(1 / 60);
	} catch {
		threw = true;
	}
	assert(
		!threw && live(em).every((p) => p.alpha === 0),
		'a value that collapses a curve to one point (alpha 0 → 0) updates safely instead of throwing',
	);
	const alive = live(em).length;
	applier!.restore();
	em.update(1 / 60);
	const youngest = live(em).reduce((a, b) => (b.age < a.age ? b : a));
	assert(
		em.frequency === 0.05 &&
			(em.getBehavior(FX_FORCES_BEHAVIOR_TYPE) as FxForcesBehavior).forces[0].strength === 0 &&
			live(em).length >= alive &&
			youngest.tint >> 16 > 0x80 &&
			(youngest.tint & 0xff00) === 0,
		'restore() puts every driven leaf back to the stored config (a red ramp again), still with no reset',
	);
	const contrast = live(em).length;
	em.init(bound);
	assert(
		contrast > 0 && live(em).length === 0,
		`(for contrast: emitter.init kills all ${contrast} live particles — why it is never used)`,
	);
}
{
	// Emitter fields match what `init` makes of the same value in the config.
	const cases: [string, number][] = [
		['emitter.frequency', 0.07],
		['emitter.spawnChance', 0],
		['emitter.particlesPerWave', 3.6],
		['emitter.maxParticles', 12.4],
		['emitter.emitterLifetime', 0],
		['emitter.lifetime.min', 0.3],
		['emitter.lifetime.max', 0.9],
		['emitter.pos.x', 25],
		['emitter.pos.y', -10],
	];
	const read = (em: Emitter): Record<string, number> => ({
		'emitter.frequency': em.frequency,
		'emitter.spawnChance': em.spawnChance,
		'emitter.particlesPerWave': em.particlesPerWave,
		'emitter.maxParticles': em.maxParticles,
		'emitter.emitterLifetime': em.emitterLifetime,
		'emitter.lifetime.min': em.minLifetime,
		'emitter.lifetime.max': em.maxLifetime,
		'emitter.pos.x': em.spawnPos.x,
		'emitter.pos.y': em.spawnPos.y,
	});
	const mismatches: string[] = [];
	for (const [path, value] of cases) {
		const params: EffectParam[] = [
			{ id: 'v', kind: 'number', default: 1, drives: [{ id: 'd', layer: 'main', path }] },
		];
		const layer: EmitterLayer = { ...newLayer('main'), config: swapConfig() };
		const doc = normalizeEffectDoc({ version: 1, id: 'f', name: 'f', layers: [layer], params });
		const em = new Emitter(new Container(), doc.layers[0].config);
		const applier = createEffectParamApplier({
			params: doc.params,
			layer: doc.layers[0],
			emitter: em,
		});
		applier?.apply({ v: value });
		const viaInit = normalizeEffectDoc({ ...doc, params: [{ ...params[0], default: value }] });
		const reference = new Emitter(new Container(), viaInit.layers[0].config);
		if (read(em)[path] !== read(reference)[path]) {
			mismatches.push(`${path}: live ${read(em)[path]} vs init ${read(reference)[path]}`);
		}
	}
	assert(
		mismatches.length === 0,
		`every emitter field, set live, equals Emitter.init of the same config value (${cases.length} fields${mismatches.length ? `: ${mismatches.join('; ')}` : ''})`,
	);
}
{
	// A rebuilt fxForces in Acceleration mode keeps adding into the movement's own velocity.
	const config = {
		lifetime: { min: 5, max: 5 },
		frequency: 0.05,
		emitterLifetime: -1,
		maxParticles: 50,
		pos: { x: 0, y: 0 },
		addAtBack: false,
		behaviors: [
			{
				type: 'moveAcceleration',
				config: { accel: { x: 0, y: 0 }, minStart: 0, maxStart: 0, rotate: false, maxSpeed: 0 },
			},
			{
				type: FX_FORCES_BEHAVIOR_TYPE,
				config: { forces: [{ kind: 'gravity', enabled: true, strength: 0, angle: 90 }] },
			},
		],
	} as unknown as EmitterConfigV3;
	const layer: EmitterLayer = { ...newLayer('main'), config };
	const params = [
		num(
			'pull',
			0,
			[{ id: 'g', layer: 'main', path: 'behavior:fxForces.forces.0.strength' }],
			0,
			1000,
		),
	];
	const em = new Emitter(new Container(), config);
	em.emit = true;
	em.update(0);
	step(em, 0.5);
	em.emit = false;
	const ps = live(em);
	createEffectParamApplier({ params, layer, emitter: em })!.apply({ pull: 1000 });
	em.update(0.1);
	assert(
		ps.length > 0 &&
			ps.every(
				(p) =>
					near((p.config.velocity as { y: number }).y, 100, 1e-6) &&
					(p.config.fxForceVel as { y: number }).y === 0,
			),
		"a swapped fxForces with no new spawn since still folds into moveAcceleration's velocity",
	);
}
{
	// Placement offset: the sink is called with the mapped value, only on change.
	const layer: EmitterLayer = {
		...baseLayer(),
		placement: { space: 'free', offset: { x: 5, y: 7 } },
	};
	const params = [
		num('slide', 0, [{ id: 'x', layer: 'main', path: 'placement.offset.x', from: 5, to: 105 }]),
	];
	const em = new Emitter(new Container(), layer.config);
	const calls: [number, number][] = [];
	const applier = createEffectParamApplier({
		params,
		layer,
		emitter: em,
		setOffset: (x, y) => calls.push([x, y]),
	});
	applier!.apply({ slide: 0 });
	applier!.apply({ slide: 0.5 });
	applier!.apply({ slide: 0.5 });
	applier!.restore();
	assert(
		json(calls) ===
			json([
				[55, 7],
				[5, 7],
			]),
		'a placement.offset drive moves the layer through its sink — once per change, back on restore',
	);
	assert(
		createEffectParamApplier({ params, layer, emitter: em }) === undefined,
		'with no offset sink an offset drive is inert (and builds no applier)',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('');
console.log("fx params — a curve with equal ends (the library's one-node list)");
{
	const collapsed = (): EmitterConfigV3 =>
		({
			lifetime: { min: 1, max: 1 },
			frequency: 0.02,
			emitterLifetime: -1,
			maxParticles: 50,
			pos: { x: 0, y: 0 },
			addAtBack: false,
			behaviors: [
				{
					type: 'alpha',
					config: {
						alpha: {
							list: [
								{ time: 0, value: 1 },
								{ time: 1, value: 1 },
							],
						},
					},
				},
				{ type: 'scale', config: { scale: { list: [{ time: 0, value: 0.5 }] } } },
				{
					type: 'color',
					config: {
						color: {
							list: [
								{ time: 0, value: '#ff0000' },
								{ time: 1, value: '#ff0000' },
							],
						},
					},
				},
				{
					type: 'moveSpeed',
					config: {
						speed: {
							list: [
								{ time: 0, value: 80 },
								{ time: 1, value: 80 },
							],
						},
					},
				},
				{ type: 'rotationStatic', config: { min: 0, max: 360 } },
			],
		}) as unknown as EmitterConfigV3;
	const stored = collapsed();
	const before = json(stored);
	let raw = '';
	try {
		const em = new Emitter(new Container(), collapsed());
		em.emit = true;
		em.update(0);
		em.update(1 / 60);
	} catch (e) {
		raw = (e as Error).message;
	}
	assert(raw.includes("reading 'time'"), `(the library alone throws on it: "${raw}")`);
	let threw = '';
	let shown = 0;
	try {
		const em = new Emitter(new Container(), bindArt(stored, [Texture.EMPTY], false));
		em.emit = true;
		em.update(0);
		step(em, 0.5);
		shown = live(em).length;
		assert(
			live(em).every((p) => p.alpha === 1 && p.tint === 0xff0000),
			'…a bound config renders it as the constant it is (alpha 1, red)',
		);
	} catch (e) {
		threw = (e as Error).message;
	}
	assert(
		!threw && shown > 0,
		`collapsed alpha, colour, speed and a one-point scale render through bindArt without throwing (${shown} live${threw ? `; threw ${threw}` : ''})`,
	);
	assert(
		json(stored) === before,
		'the stored config is untouched (byte-identical) — only the bound copy is stepped',
	);
	const marked = stepCollapsedValueLists(clone(stored));
	const kept = {
		list: [
			{ time: 0, value: 1 },
			{ time: 1, value: 1 },
		],
	};
	const box = new (class Box {
		list = kept.list;
	})();
	stepCollapsedValueLists({ behaviors: [{ type: 'x', config: { holder: box } }] });
	assert(
		(behaviorsOf(marked)[0].config.alpha as { isStepped?: boolean }).isStepped === true &&
			(behaviorsOf(marked)[4].config as { isStepped?: boolean }).isStepped === undefined &&
			!('isStepped' in box),
		'the guard marks only collapsed lists, and never walks into a non-plain object (a texture, a factory)',
	);

	// A default that collapses a curve is SAVED as is (the doc is never altered), renders safely,
	// and a live value that opens it again interpolates — the render-time step never sticks. `fxAlpha`
	// honours `isStepped` on any list (the stock classes ignore it on a 0 → 1 pair), so it is the case
	// that shows a sticking flag.
	const fadeConfig = {
		...swapConfig(),
		behaviors: [
			{
				type: 'fxAlpha',
				config: {
					alpha: {
						list: [
							{ time: 0, value: 1 },
							{ time: 1, value: 0 },
						],
					},
				},
			},
			{ type: 'rotationStatic', config: { min: 0, max: 360 } },
		],
	} as unknown as EmitterConfigV3;
	const params = [
		num('fadeEnd', 1, [{ id: 'd', layer: 'main', path: 'behavior:fxAlpha.alpha.list.1.value' }]),
	];
	const fadeLayer: EmitterLayer = { ...newLayer('main'), config: fadeConfig };
	const doc = normalizeEffectDoc({ version: 1, id: 'c', name: 'c', layers: [fadeLayer], params });
	const list = behaviorsOf(doc.layers[0].config)[0].config.alpha as {
		list: { value: number }[];
		isStepped?: boolean;
	};
	assert(
		list.list[0].value === 1 && list.list[1].value === 1 && list.isStepped === undefined,
		'a default equal to the other end saves the collapsed curve unaltered',
	);
	const em = new Emitter(new Container(), bindArt(doc.layers[0].config, [Texture.EMPTY], false));
	em.emit = true;
	em.update(0);
	step(em, 1);
	const applier = createEffectParamApplier({
		params: doc.params,
		layer: doc.layers[0],
		emitter: em,
	})!;
	applier.apply({ fadeEnd: 0 });
	em.update(1 / 60);
	const ps = live(em);
	assert(
		ps.length > 0 && ps.every((p) => near(p.alpha, 1 - p.agePercent, 1e-6)),
		'…and a live value that opens it again interpolates (1 → 0), not a stuck step',
	);
}

console.log('');
console.log('fx params — a driven emitter lifetime sets the burst length');
{
	const burst = (): EmitterConfigV3 =>
		({
			lifetime: { min: 0.2, max: 0.2 },
			frequency: 0.01,
			emitterLifetime: 0.5,
			maxParticles: 100,
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
	const params = [
		num('life', 0.5, [{ id: 'd', layer: 'main', path: 'emitter.emitterLifetime' }], 0, 5),
	];
	const doc = normalizeEffectDoc({
		version: 1,
		id: 'b',
		name: 'b',
		layers: [{ ...newLayer('main'), config: burst() }],
		params,
	});
	const lasts = (em: Emitter): number => {
		let t = 0;
		while (em.emit && t < 10) {
			em.update(1 / 60);
			t += 1 / 60;
		}
		return t;
	};
	// The runtime's order: construct → init (latches the config's 0.5 s) → bind.
	const fresh = (): Emitter => {
		const em = new Emitter(new Container(), doc.layers[0].config);
		em.init(doc.layers[0].config);
		return em;
	};
	const naive = fresh();
	createEffectParamApplier({ params: doc.params, layer: doc.layers[0], emitter: naive })!.apply({
		life: 3,
	});
	const bound = fresh();
	bindEffectParams({
		params: doc.params,
		layer: doc.layers[0],
		emitter: bound,
		values: { life: 3 },
	});
	const dormant = fresh();
	dormant.emit = false;
	bindEffectParams({
		params: doc.params,
		layer: doc.layers[0],
		emitter: dormant,
		values: { life: 3 },
	});
	dormant.emit = true;
	const atDefault = fresh();
	bindEffectParams({ params: doc.params, layer: doc.layers[0], emitter: atDefault });
	const tNaive = lasts(naive);
	const tBound = lasts(bound);
	const tDormant = lasts(dormant);
	const tDefault = lasts(atDefault);
	assert(
		near(tNaive, 0.5, 0.02),
		`(applying after init alone leaves the burst at the config's ${tNaive.toFixed(2)} s)`,
	);
	assert(
		near(tBound, 3, 0.02) && near(tDormant, 3, 0.02) && near(tDefault, 0.5, 0.02),
		`bindEffectParams: the burst lasts the driven 3 s (${tBound.toFixed(2)} s; ${tDormant.toFixed(2)} s when emission starts later), the default 0.5 s untouched (${tDefault.toFixed(2)} s)`,
	);
}

console.log('');
console.log("fx params — a rotated emitter's spawn position");
{
	const config = {
		lifetime: { min: 1, max: 1 },
		frequency: 0.1,
		emitterLifetime: -1,
		maxParticles: 10,
		pos: { x: 10, y: 0 },
		addAtBack: false,
		behaviors: [],
	} as unknown as EmitterConfigV3;
	const params = [num('px', 10, [{ id: 'd', layer: 'main', path: 'emitter.pos.x' }], 0, 20)];
	const doc = normalizeEffectDoc({
		version: 1,
		id: 'r',
		name: 'r',
		layers: [{ ...newLayer('main'), config }],
		params,
	});
	const em = new Emitter(new Container(), doc.layers[0].config);
	em.rotate(Math.PI / 2);
	const at = (): string => `(${em.spawnPos.x.toFixed(6)}, ${em.spawnPos.y.toFixed(6)})`;
	const start = at();
	let writes = 0;
	const update = em.updateSpawnPos.bind(em);
	em.updateSpawnPos = (x: number, y: number) => {
		writes++;
		update(x, y);
	};
	const applier = createEffectParamApplier({
		params: doc.params,
		layer: doc.layers[0],
		emitter: em,
	})!;
	applier.apply(undefined);
	applier.restore();
	assert(
		writes === 0 && at() === start,
		`apply + restore at the defaults write nothing (spawnPos stays ${start})`,
	);
	applier.apply({ px: 20 });
	const reference = new Emitter(new Container(), {
		...config,
		pos: { x: 20, y: 0 },
	} as EmitterConfigV3);
	reference.rotate(Math.PI / 2);
	assert(
		near(em.spawnPos.x, reference.spawnPos.x) && near(em.spawnPos.y, reference.spawnPos.y),
		`a driven pos.x lands where init + rotate would put it ${at()}`,
	);
}

console.log('');
console.log('fx params — two drives on one value');
{
	const shared: EffectDoc = {
		version: 1,
		id: 's',
		name: 's',
		layers: [baseLayer()],
		params: [
			num('rate', 0.05, [{ id: 'd1', layer: 'main', path: 'emitter.frequency' }], 0.001, 0.5),
			num(
				'calm',
				0.1,
				[
					{ id: 'd1', layer: 'main', path: 'emitter.frequency' },
					{ id: 'd2', layer: 'gone', path: 'emitter.frequency' },
				],
				0.001,
				0.5,
			),
		],
	};
	const found = validateEffectParams(shared);
	const dup = found.filter((i) => i.code === 'param-target-duplicate');
	assert(
		dup.length === 2 &&
			dup.some((i) => i.param === 'rate' && i.message.includes('"calm" (d1)')) &&
			dup.some((i) => i.param === 'calm' && i.message.includes('"rate" (d1)')) &&
			found.some((i) => i.code === 'unresolved' && i.param === 'calm' && i.drive === 'd2'),
		'two drives on one value are both flagged (param-target-duplicate), naming each other',
	);
	assert(
		driveIssues(shared).get('calm/d2')?.code === 'unresolved' &&
			driveIssues(shared).get('rate/d1')?.code === 'param-target-duplicate',
		'the panel reads one issue per drive, keyed param/drive',
	);
}

console.log('');
console.log('fx params — effect-level targets');
{
	const params: EffectParam[] = [
		num('fade', 0.5, [{ id: 'a', path: 'effect.alpha' }]),
		{ id: 'hue', kind: 'color', default: '#336699', drives: [{ id: 't', path: 'effect.tint' }] },
		{
			id: 'big',
			kind: 'bool',
			default: false,
			drives: [{ id: 's', path: 'effect.scale', from: 1, to: 2 }],
		},
		num('speed', 0, [{ id: 'k', path: 'effect.timeScale', from: 0.5, to: 2 }]),
	];
	assert(
		hasEffectLevelDrives(params) && !hasEffectLevelDrives(swapParams),
		'effect-level drives are detected (the wrapper is mounted only then)',
	);
	assert(
		createEffectLevelApplier(swapParams) === undefined,
		'no effect-level drive ⇒ no applier, no wrapper',
	);
	const fx = createEffectLevelApplier(params)!;
	assert(
		fx.state.alpha === 0.5 &&
			fx.state.tint === 0x336699 &&
			fx.state.scale === 1 &&
			fx.state.timeScale === 0.5,
		'the state holds the defaults from the start (these targets have no stored leaf)',
	);
	assert(
		fx.apply(undefined) === false && fx.apply({ fade: 0.5 }) === false,
		'defaults again ⇒ unchanged',
	);
	assert(
		fx.apply({ fade: 2, hue: '#ff8000', big: true, speed: 1 }) === true &&
			fx.state.alpha === 1 &&
			fx.state.tint === 0xff8000 &&
			fx.state.scale === 2 &&
			fx.state.timeScale === 2,
		'alpha (clamped), tint, scale and time scale follow the values',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('');
console.log('fx params — save → export → bake');
{
	const authored: EffectDoc = {
		version: 1,
		id: 'glow',
		name: 'Glow',
		layers: [{ ...newLayer('main'), config: swapConfig() }],
		params: [
			num('intensity', 0.5, [
				{ id: 'd1', layer: 'main', path: 'emitter.frequency', from: 0.2, to: 0.02 },
				{ id: 'd2', layer: 'main', path: 'behavior:fxForces.forces.0.strength', from: 0, to: 800 },
				{
					id: 'd3',
					layer: 'main',
					path: 'behavior:color.color.list.1.value',
					from: '#ff0000',
					to: '#ffff00',
				},
			]),
			{
				id: 'hot',
				kind: 'bool',
				default: true,
				note: 'flag',
				drives: [{ id: 'e', path: 'effect.scale', from: 1, to: 1.5 }],
			},
		],
	};
	// author → /api/fx/save (normalize) → deploy/effects (normalize + tab JSON) → bake embeds → game.
	const saved = normalizeEffectDoc(JSON.parse(JSON.stringify(authored)));
	const deployed = normalizeEffectDoc(JSON.parse(JSON.stringify(saved, null, '\t')), 'glow');
	const baked = JSON.parse(JSON.stringify({ effects: [deployed] })) as { effects: EffectDoc[] };
	const shipped = baked.effects[0];
	assert(
		json(saved.params) === json(authored.params),
		'a canonical authored `params` list is saved verbatim',
	);
	assert(
		json(shipped.params) === json(saved.params) && json(shipped) === json(saved),
		'…and travels save → export → bake verbatim (the whole doc is a fixed point)',
	);
	assert(
		near(shipped.layers[0].config.frequency, 0.11) &&
			(
				behaviorsOf(shipped.layers[0].config).find((b) => b.type === FX_FORCES_BEHAVIOR_TYPE)!
					.config.forces as { strength: number }[]
			)[0].strength === 400,
		'the shipped config is the effect at its defaults (a renderer that ignores params draws it)',
	);
	const em = new Emitter(new Container(), shipped.layers[0].config);
	em.emit = true;
	em.update(0);
	step(em, 1);
	const n = live(em).length;
	const applier = createEffectParamApplier({
		params: shipped.params,
		layer: shipped.layers[0],
		emitter: em,
	});
	applier!.apply({ intensity: 1 });
	assert(
		live(em).length === n && n > 0 && near(em.frequency, 0.02),
		'the baked doc drives a live emitter with no reset',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('');
console.log('fx params — material paths (Shader Graph step 8d.3)');
{
	const intensityPath = parseEffectParamPath('material.intensity');
	assert(
		intensityPath.ok &&
			intensityPath.target.scope === 'material' &&
			intensityPath.target.field === 'intensity',
		'`material.intensity` parses to the material strength',
	);
	const paramPath = parseEffectParamPath('material.param.glow-size');
	assert(
		paramPath.ok &&
			paramPath.target.scope === 'material' &&
			paramPath.target.field === 'param' &&
			paramPath.target.id === 'glow-size',
		'`material.param.<id>` parses to that param',
	);
	assert(
		[
			'material.param.',
			'material.param.__proto__',
			'material.param.constructor',
			'material.strength',
			'material',
		].every((p) => !parseEffectParamPath(p).ok),
		'an empty or prototype param id, and any other `material.*` field, are refused',
	);
	assert(
		canonicalEffectParamPath('material.param.tint') === 'material.param.tint' &&
			canonicalEffectParamPath('material.intensity') === 'material.intensity',
		'both paths are their own canonical spelling',
	);

	const matLayer = (material?: EmitterLayer['material']): EmitterLayer => ({
		...newLayer('main'),
		config: swapConfig(),
		...(material ? { material } : {}),
	});
	const drivenDoc = (material?: EmitterLayer['material']): EffectDoc => ({
		version: 1,
		id: 'mat',
		name: 'Mat',
		layers: [matLayer(material)],
		params: [
			num('heat', 0.5, [{ id: 's', layer: 'main', path: 'material.intensity', from: 0, to: 4 }]),
			num('size', 3, [{ id: 'g', layer: 'main', path: 'material.param.glow' }], 0, 10),
			{
				id: 'hue',
				kind: 'color',
				default: '#FF8800',
				drives: [{ id: 'c', layer: 'main', path: 'material.param.tint' }],
			},
			{
				id: 'on',
				kind: 'bool',
				default: true,
				drives: [{ id: 'b', layer: 'main', path: 'material.param.wave', from: 0, to: 2 }],
			},
		],
	});

	// The mapping and the defaults in `material`.
	const stored = normalizeEffectDoc(drivenDoc({ kind: 'custom:pulse', params: { keep: 'up' } }));
	const m = stored.layers[0].material;
	assert(
		m?.intensity === 2 &&
			m.params?.glow === 3 &&
			m.params?.tint === '#ff8800' &&
			m.params?.wave === 2 &&
			m.params?.keep === 'up',
		'the defaults are written into `material`: strength 0.5 of 0…4 = 2, a number, a colour and a mapped switch, an undriven value kept',
	);
	assert(
		json(normalizeEffectDoc(JSON.parse(json(stored)))) === json(stored) &&
			applyEffectParamDefaults(stored) === stored,
		'the defaults writer is idempotent (a stored doc comes back as the same object)',
	);
	const one = normalizeEffectDoc({
		...drivenDoc({ kind: 'custom:pulse' }),
		params: [
			num('heat', 0.25, [{ id: 's', layer: 'main', path: 'material.intensity', from: 0, to: 4 }]),
		],
	});
	assert(
		one.layers[0].material !== undefined && !('intensity' in one.layers[0].material),
		'a default strength of 1 is what an absent one means, so it is not written',
	);
	const over = normalizeEffectDoc({
		...drivenDoc({ kind: 'custom:pulse' }),
		params: [
			num('heat', 1, [{ id: 's', layer: 'main', path: 'material.intensity', from: 0, to: 9 }]),
		],
	});
	assert(
		over.layers[0].material?.intensity === 4,
		'a strength mapped past 4 is written clamped to 4',
	);
	const leafs = listEffectLayerLeaves(stored.layers[0]).filter((l) =>
		l.path.startsWith('material.'),
	);
	assert(
		json(leafs.map((l) => l.path)) ===
			json([
				'material.intensity',
				'material.param.glow',
				'material.param.tint',
				'material.param.wave',
			]),
		'the leaf listing offers the strength and each number, colour or switch the material holds (not a choice)',
	);
	assert(
		validateEffectParams(stored).length === 0,
		'every material drive on a layer with a material resolves',
	);

	// A layer with no material: the drive is kept (it parses), reported, and inert.
	const bare = normalizeEffectDoc(drivenDoc());
	assert(
		bare.layers[0].material === undefined && bare.params?.[0].drives.length === 1,
		'on a layer with no material the drive is kept and no material is made up',
	);
	assert(
		validateEffectParams(bare).filter((i) => i.code === 'unresolved').length === 4 &&
			validateEffectParams(bare)[0].message === 'The layer has no material.',
		'…and validation says the layer has no material',
	);

	// The applier: a uniform write, no behaviour rebuilt, no particle lost.
	const writes: { intensity: number[]; params: Record<string, EffectParamValue>[] } = {
		intensity: [],
		params: [],
	};
	const sink = {
		setIntensity: (v: number) => writes.intensity.push(v),
		setParams: (v: Readonly<Record<string, EffectParamValue>>) => writes.params.push({ ...v }),
	};
	const em = new Emitter(new Container(), stored.layers[0].config);
	em.emit = true;
	em.update(0);
	step(em, 1);
	const before = live(em);
	const behaviours = [...guts(em).initBehaviors];
	const applier = bindEffectParams({
		params: stored.params,
		layer: stored.layers[0],
		emitter: em,
		material: sink,
	});
	assert(
		!!applier && writes.intensity.length === 0 && writes.params.length === 0,
		'at the defaults the applier writes nothing',
	);
	applier!.apply({ heat: 0.25, size: 7, hue: '#00FF00' });
	assert(
		json(writes.intensity) === json([1]) &&
			writes.params.length === 1 &&
			json(writes.params[0]) === json({ keep: 'up', glow: 7, tint: '#00ff00', wave: 2 }),
		'a changed value writes the mapped strength and the whole param set once, in one apply',
	);
	assert(
		guts(em).initBehaviors.every((b, i) => b === behaviours[i]) &&
			live(em).length === before.length &&
			live(em).every((p, i) => p === before[i]),
		'no behaviour is rebuilt and every live particle stays (a uniform write, not a re-init)',
	);
	applier!.apply({ heat: 0.25, size: 7, hue: '#00ff00' });
	assert(
		writes.intensity.length === 1 && writes.params.length === 1,
		'the same values again write nothing',
	);
	applier!.apply({ heat: 2 });
	assert(
		writes.intensity.at(-1) === 4 &&
			json(writes.params.at(-1)) === json({ keep: 'up', glow: 3, tint: '#ff8800', wave: 2 }),
		'a value past the range is clamped; a value dropped goes back to its default',
	);
	applier!.apply({ heat: 0.25, on: false });
	applier!.restore();
	assert(
		writes.intensity.at(-1) === 2 &&
			json(writes.params.at(-1)) === json({ keep: 'up', glow: 3, tint: '#ff8800', wave: 2 }),
		'`restore()` puts the stored strength and params back',
	);
	assert(
		createEffectParamApplier({ params: stored.params, layer: stored.layers[0], emitter: em }) ===
			undefined,
		'with no material renderer (plain, or none) the material drives are inert: no applier at all',
	);
}

console.log('');
if (failures) {
	console.error(`fx params: ${failures} FAILED`);
	process.exit(1);
}
console.log('fx params: all green');
