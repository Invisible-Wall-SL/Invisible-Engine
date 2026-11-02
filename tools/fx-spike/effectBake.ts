/**
 * Invisible FX — BAKED effects (`invisible-fx.md` §"Baked effects"). Run:
 *
 *   pnpm --filter fx-spike run effect-bake
 *
 * Covers, against the real `engine-fx` functions:
 *  1. the doc field — absent stays absent (byte-identical), clamping, a malformed result dropped,
 *     idempotence through `normalizeEffectDoc`;
 *  2. the stale hash — stable under key order, blind to name / `enabled` / the result, moved by any
 *     layer or capture-setting change;
 *  3. what may bake (`effectBakeBlockers`) and the warm-up;
 *  4. the sheet plan and its TexturePacker JSON (fits the page, cells never overlap);
 *  5. the runtime choice — bake on + every frame loaded ⇒ baked; off / absent / driven / one frame
 *     missing ⇒ live — and that the default path reads no asset at all;
 *  6. the per-instance desync — deterministic, spread, and `Math.random` never drawn;
 *  7. the export — only a shipping bake survives `exportableEffectDoc`; the rest are stripped;
 *  8. a rig beat — the fades (in briefly, out over the longest particle life at the beat's speed),
 *     the opacity envelope, and the loop rate under `emitSpeed`.
 */

import {
	DEFAULT_EMIT_SPEED,
	EFFECT_BAKE_BEAT_FADE_IN_SECONDS,
	EFFECT_BAKE_LIMITS,
	effectBakeBeatAlpha,
	effectBakeBeatFades,
	effectBakeBeatRate,
	effectBakeBlend,
	effectBakeBlockers,
	effectBakeChoice,
	effectBakeFrameAt,
	effectBakeFrameCount,
	effectBakeFrameName,
	effectBakeHash,
	effectBakeInstanceKey,
	effectBakeLongestLife,
	effectBakeSeamFrames,
	effectBakeSeamWeight,
	effectBakeSheetJson,
	effectBakeShips,
	effectBakeStale,
	effectBakeStartFrame,
	effectBakeWarmup,
	exportableEffectDoc,
	normalizeEffectBake,
	normalizeEffectDoc,
	planEffectBakeSheet,
	type EffectDoc,
} from 'engine-fx';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) console.log(`  ✓ ${msg}`);
	else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const sparkConfig = (extra: Record<string, unknown> = {}) => ({
	lifetime: { min: 0.4, max: 1.2 },
	frequency: 0.008,
	emitterLifetime: -1,
	maxParticles: 1000,
	pos: { x: 0, y: 0 },
	addAtBack: false,
	behaviors: [
		{ type: 'alpha', config: { alpha: { list: [{ time: 0, value: 1 }] } } },
		{ type: 'blendMode', config: { blendMode: 'add' } },
	],
	...extra,
});

const rawDoc = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
	version: 1,
	id: 'firecracker',
	name: 'Firecracker',
	layers: [
		{
			key: 'spark',
			config: sparkConfig(),
			art: { assetKey: 'c/p/manifests/fx.json', frames: ['Spark_Mini'] },
			placement: { space: 'free' },
			particleKind: 'sprite',
		},
	],
	...extra,
});

const RESULT = {
	assetKey: 'c/p/fx-bakes/firecracker/fxbake_firecracker_00000000.json',
	frames: ['bake_00000000_000', 'bake_00000000_001', 'bake_00000000_002'],
	fps: 24,
	bounds: { x: -60, y: -80, w: 120, h: 140 },
	blendMode: 'add',
	hash: '00000000',
	sheet: { w: 200, h: 80 },
};

/** A doc whose bake is current: its result carries the doc's own hash. */
const freshDoc = (
	bakeExtra: Record<string, unknown> = {},
	docExtra: Record<string, unknown> = {},
) => {
	const settings = { enabled: true, fps: 24, loopSeconds: 2, scale: 0.5, seam: 'crossfade' };
	const draft = normalizeEffectDoc(rawDoc({ bake: { ...settings, ...bakeExtra }, ...docExtra }));
	const hash = effectBakeHash(draft);
	return normalizeEffectDoc({
		...draft,
		bake: { ...draft.bake, result: { ...RESULT, hash } },
	}) as EffectDoc;
};

console.log('1. the doc field');
{
	const plain = normalizeEffectDoc(rawDoc());
	assert(!('bake' in plain), 'a doc without bake normalizes without the key (byte-identical)');
	assert(
		eq(normalizeEffectDoc(rawDoc({ bake: 'yes' })), plain),
		'a non-object bake is no bake at all',
	);
	const d = normalizeEffectBake({ enabled: 1, fps: 500, loopSeconds: 0, scale: 9, seam: 'x' });
	assert(d?.enabled === false, 'enabled must be literally true');
	assert(d?.fps === EFFECT_BAKE_LIMITS.fps.max, 'fps clamps to its max');
	assert(d?.loopSeconds === EFFECT_BAKE_LIMITS.loopSeconds.min, 'loopSeconds clamps to its min');
	assert(d?.scale === EFFECT_BAKE_LIMITS.scale.max, 'scale clamps to its max');
	assert(d?.seam === 'crossfade', 'an unknown seam is crossfade');
	const bad = normalizeEffectBake({ enabled: true, result: { ...RESULT, frames: [] } });
	assert(bad?.enabled === true && !bad.result, 'a result with no frames is dropped (plays live)');
	const badKey = normalizeEffectBake({ enabled: true, result: { ...RESULT, assetKey: 'x.png' } });
	assert(!badKey?.result, 'a result whose assetKey is not a manifest key is dropped');
	const doc = freshDoc();
	assert(eq(normalizeEffectDoc(doc), doc), 'normalize is idempotent with a bake');
	assert(
		eq(normalizeEffectDoc(JSON.parse(JSON.stringify(doc))), doc),
		'a baked doc survives save → reload',
	);
	const withParams = normalizeEffectDoc(
		rawDoc({
			bake: { enabled: false },
			params: [{ id: 'k', kind: 'number', default: 1, drives: [] }],
		}),
	);
	assert(!!withParams.bake && !!withParams.params, 'bake and params both survive normalize');
}

console.log('2. the stale hash');
{
	const doc = freshDoc();
	assert(!effectBakeStale(doc), 'a just-baked doc is current');
	assert(!effectBakeStale({ ...doc, name: 'Renamed' } as EffectDoc), 'renaming does not stale it');
	assert(
		!effectBakeStale({ ...doc, bake: { ...doc.bake!, enabled: false } }),
		'turning it off does not stale it',
	);
	const reordered = JSON.parse(JSON.stringify(doc)) as EffectDoc;
	const cfg = reordered.layers[0].config as unknown as Record<string, unknown>;
	const flipped: Record<string, unknown> = {};
	for (const k of Object.keys(cfg).reverse()) flipped[k] = cfg[k];
	reordered.layers[0].config = flipped as unknown as EffectDoc['layers'][0]['config'];
	assert(!effectBakeStale(reordered), 'config key order does not matter');
	const tuned = JSON.parse(JSON.stringify(doc)) as EffectDoc;
	(tuned.layers[0].config as unknown as Record<string, unknown>).frequency = 0.01;
	assert(effectBakeStale(tuned), 'a tuned emitter makes the bake stale');
	assert(
		effectBakeStale({ ...doc, bake: { ...doc.bake!, fps: 30 } }),
		'a changed capture setting makes the bake stale',
	);
	const noResult = { ...doc, bake: { ...doc.bake!, result: undefined } };
	assert(effectBakeStale(noResult), 'no result is stale');
	assert(/^[0-9a-f]{8}$/.test(effectBakeHash(doc)), 'the hash is 8 hex digits');
}

console.log('3. what may bake, and the warm-up');
{
	const ok = normalizeEffectDoc(rawDoc());
	assert(effectBakeBlockers(ok).length === 0, 'an ambient sprite effect can bake');
	const layer = (patch: Record<string, unknown>) =>
		normalizeEffectDoc(
			rawDoc({ layers: [{ ...(rawDoc().layers as Record<string, unknown>[])[0], ...patch }] }),
		);
	const cases: [string, EffectDoc][] = [
		['a rig-particle layer', layer({ particleKind: 'spine' })],
		['a bone layer', layer({ placement: { space: 'bone', bone: 'hand' } })],
		['an event layer', layer({ trigger: { on: 'event', eventType: 'win' } })],
		['a timed ambient layer', layer({ trigger: { on: 'always', duration: 500 } })],
		['a one-shot burst', layer({ config: sparkConfig({ emitterLifetime: 0.3 }) })],
		[
			'an effect with parameters',
			normalizeEffectDoc(rawDoc({ params: [{ id: 'k', kind: 'number', default: 1, drives: [] }] })),
		],
		['an effect with no layers', normalizeEffectDoc(rawDoc({ layers: [] }))],
	];
	for (const [label, doc] of cases)
		assert(effectBakeBlockers(doc).length > 0, `${label} is refused with a reason`);
	assert(
		Math.abs(effectBakeWarmup(ok) - (1.2 * 1.25 + 0.1)) < 1e-9,
		'warm-up covers the longest particle life plus a margin',
	);
	assert(
		effectBakeWarmup(layer({ config: sparkConfig({ lifetime: { min: 1, max: 900 } }) })) ===
			EFFECT_BAKE_LIMITS.warmupEmitterSeconds,
		'warm-up is capped',
	);
	assert(effectBakeBlend(ok.layers) === 'add', 'all-additive layers bake as add');
	const mixed = normalizeEffectDoc(
		rawDoc({
			layers: [
				...(rawDoc().layers as unknown[]),
				{
					key: 'smoke',
					config: sparkConfig({ behaviors: [] }),
					art: { assetKey: '', frames: [] },
					placement: { space: 'free' },
					particleKind: 'sprite',
				},
			],
		}),
	);
	assert(effectBakeBlend(mixed.layers) === 'normal', 'a normal layer makes the bake normal');
}

console.log('4. the sheet plan');
{
	assert(effectBakeFrameCount({ fps: 24, loopSeconds: 2 }) === 48, '24 fps × 2 s = 48 frames');
	assert(
		effectBakeFrameCount({ fps: 60, loopSeconds: 8 }) === EFFECT_BAKE_LIMITS.frames.max,
		'frame count is capped',
	);
	assert(effectBakeSeamFrames({ seam: 'crossfade' }, 48) === 12, 'crossfade blends a quarter');
	assert(effectBakeSeamFrames({ seam: 'cut' }, 48) === 0, 'a cut blends nothing');
	assert(effectBakeSeamWeight(0, 12) === 0, 'loop frame 0 is all the post-loop capture');
	assert(effectBakeSeamWeight(6, 12) === 0.5, 'half way through the seam is half and half');
	assert(effectBakeSeamWeight(12, 12) === 1, 'past the seam is pure capture');

	const plan = planEffectBakeSheet(300, 200, 48, 0.5)!;
	assert(plan.scale === 0.5, 'a small effect keeps its requested scale');
	assert(plan.cols * plan.rows >= 48, 'every frame has a cell');
	const big = planEffectBakeSheet(2048, 2048, 120, 1)!;
	assert(
		big.width <= EFFECT_BAKE_LIMITS.sheetSide && big.height <= EFFECT_BAKE_LIMITS.sheetSide,
		'a huge effect is scaled down to fit one page',
	);
	assert(big.scale < 1, '… and reports the lower scale');
	assert(planEffectBakeSheet(1e6, 1e6, 120, 1) === undefined, 'an impossible sheet is refused');

	const json = effectBakeSheetJson(plan, 48, 'fxbake_x_00000000.png', '0badf00d');
	const rects = Object.values(json.frames).map(
		(f) => (f as { frame: { x: number; y: number; w: number; h: number } }).frame,
	);
	assert(rects.length === 48, 'the JSON lists every frame');
	assert(
		Object.keys(json.frames)[0] === effectBakeFrameName('0badf00d', 0) &&
			Object.keys(json.frames)[0] === 'bake_0badf00d_000',
		'frames are named in order, by the bake',
	);
	assert(
		rects.every((r) => r.x + r.w <= plan.width && r.y + r.h <= plan.height),
		'every cell lies on the page',
	);
	let overlap = false;
	for (let i = 0; i < rects.length; i++)
		for (let j = i + 1; j < rects.length; j++) {
			const a = rects[i];
			const b = rects[j];
			if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap = true;
		}
	assert(!overlap, 'no two cells overlap');
}

console.log('5. the runtime choice');
{
	const doc = freshDoc();
	const loaded = new Map<string, string>(
		RESULT.frames.map((f) => [`${RESULT.assetKey}::${f}`, `tex:${f}`]),
	);
	const lookup = (k: string) => loaded.get(k);
	const on = effectBakeChoice(doc, lookup);
	assert(on.mode === 'baked', 'bake on + every frame loaded ⇒ baked');
	assert(on.mode === 'baked' && on.textures.length === 3, '… with the frames in order');

	const reads: string[] = [];
	const spy = (k: string) => {
		reads.push(k);
		return loaded.get(k);
	};
	const plain = normalizeEffectDoc(rawDoc());
	const none = effectBakeChoice(plain, spy);
	assert(none.mode === 'live' && none.reason === 'no-bake', 'no bake ⇒ live');
	const off = effectBakeChoice({ ...doc, bake: { ...doc.bake!, enabled: false } }, spy);
	assert(off.mode === 'live' && off.reason === 'off', 'bake off ⇒ live');
	assert(reads.length === 0, 'the live default reads no asset');
	const driven = effectBakeChoice(doc, spy, true);
	assert(driven.mode === 'live' && driven.reason === 'driven', 'a driven mount ⇒ live');

	loaded.delete(`${RESULT.assetKey}::bake_00000000_001`);
	const missing = effectBakeChoice(doc, lookup);
	assert(missing.mode === 'live' && missing.reason === 'missing-art', 'one frame missing ⇒ live');
	loaded.set('bake_00000000_001', 'tex:bare');
	assert(effectBakeChoice(doc, lookup).mode === 'baked', 'a bare frame key also resolves');

	const event = JSON.parse(JSON.stringify(doc)) as EffectDoc;
	event.layers[0].trigger = { on: 'event', eventType: 'win' };
	const refused = effectBakeChoice(event, lookup);
	assert(refused.mode === 'live' && refused.reason === 'not-bakeable', 'an unbakeable doc ⇒ live');
}

console.log('6. per-instance desync');
{
	const realRandom = Math.random;
	let draws = 0;
	Math.random = () => {
		draws++;
		return realRandom();
	};
	const starts = new Set<number>();
	for (let i = 0; i < 11; i++)
		starts.add(effectBakeStartFrame(effectBakeInstanceKey('firecracker', 'pot', i * 90, 400), 48));
	const again = effectBakeStartFrame(effectBakeInstanceKey('firecracker', 'pot', 90, 400), 48);
	const first = effectBakeStartFrame(effectBakeInstanceKey('firecracker', 'pot', 90, 400), 48);
	Math.random = realRandom;
	assert(draws === 0, 'Math.random is never drawn');
	assert(again === first, 'the same instance starts on the same frame every run');
	assert(starts.size >= 8, `eleven firecrackers spread over the loop (${starts.size} distinct)`);
	assert(
		effectBakeInstanceKey('e', undefined, 10.4, -3.6) === 'e||10,-4',
		'the key rounds the position',
	);
	assert(effectBakeStartFrame('anything', 1) === 0, 'a one-frame loop starts at 0');
	assert(effectBakeFrameAt(40, 0.5, 24, 48) === 4, 'playback wraps around the loop');
	assert(effectBakeFrameAt(3, -1, 24, 48) === 3, 'negative time holds the start');
}

console.log('7. the export');
{
	const doc = freshDoc();
	assert(effectBakeShips(doc), 'a current, enabled bake ships');
	assert(eq(exportableEffectDoc(doc), doc), '… and is exported as is');
	const plain = normalizeEffectDoc(rawDoc());
	assert(exportableEffectDoc(plain) === plain, 'a doc without bake is exported untouched');
	const off = { ...doc, bake: { ...doc.bake!, enabled: false } };
	assert(!('bake' in exportableEffectDoc(off)), 'a disabled bake is stripped from the export');
	const tuned = JSON.parse(JSON.stringify(doc)) as EffectDoc;
	(tuned.layers[0].config as unknown as Record<string, unknown>).frequency = 0.02;
	assert(!effectBakeShips(tuned), 'a stale bake does not ship');
	assert(!('bake' in exportableEffectDoc(tuned)), '… and is stripped, so the game plays live');
	const exported = exportableEffectDoc(doc);
	assert(
		effectBakeChoice(exported, (k) => (k.startsWith(RESULT.assetKey) ? 1 : undefined)).mode ===
			'baked',
		'the exported doc still chooses baked once its sheet is loaded',
	);
}

console.log('8. a rig beat');
{
	const doc = freshDoc();
	const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
	assert(effectBakeLongestLife(doc) === 1.2, 'the longest life is the largest lifetime.max');
	const fades = effectBakeBeatFades(doc);
	const life = 1.2 / DEFAULT_EMIT_SPEED / 1000;
	assert(near(fades.fadeOut, life), `it fades out over that life at the default speed (${life} s)`);
	assert(
		fades.fadeIn === EFFECT_BAKE_BEAT_FADE_IN_SECONDS,
		`and in over ${EFFECT_BAKE_BEAT_FADE_IN_SECONDS} s`,
	);
	const fast = effectBakeBeatFades(doc, DEFAULT_EMIT_SPEED * 2);
	assert(near(fast.fadeOut, life / 2), 'twice the emit speed halves the fade-out');
	assert(effectBakeBeatRate() === 1, 'the default speed plays the loop at 1');
	assert(effectBakeBeatRate(DEFAULT_EMIT_SPEED * 2) === 2, 'twice the emit speed plays it at 2');
	const short = {
		...doc.layers[0],
		config: { ...doc.layers[0].config, lifetime: { min: 0.01, max: 0.02 } },
	};
	const tiny = effectBakeBeatFades({ layers: [short] });
	assert(tiny.fadeIn === tiny.fadeOut, 'the fade-in is never longer than the life');

	const f = { fadeIn: 0.1, fadeOut: 0.5 };
	assert(effectBakeBeatAlpha(0, undefined, f) === 0, 'nothing drawn on the beat itself');
	assert(near(effectBakeBeatAlpha(0.05, undefined, f), 0.5), 'half-way up the fade-in');
	assert(effectBakeBeatAlpha(3, undefined, f) === 1, 'full while emitting, without end');
	assert(effectBakeBeatAlpha(0.9, 1, f) === 1, 'full until emission ends');
	assert(near(effectBakeBeatAlpha(1.25, 1, f), 0.5), 'half-way down the fade-out');
	assert(effectBakeBeatAlpha(1.5, 1, f) === 0, 'gone once the longest life has passed');
	assert(effectBakeBeatAlpha(9, 1, f) === 0, 'and stays gone');
	assert(
		near(effectBakeBeatAlpha(0.05, 0.05, f), 0.5) && near(effectBakeBeatAlpha(0.3, 0.05, f), 0.25),
		'released mid fade-in ⇒ fades out from where it had got to',
	);
	assert(effectBakeBeatAlpha(0, 0, f) === 0, 'released at once ⇒ never drawn');
	assert(
		effectBakeBeatAlpha(1, 1, { fadeIn: 0, fadeOut: 0 }) === 0,
		'no lifetime ⇒ off at the end',
	);
	assert(
		effectBakeBeatAlpha(0, undefined, { fadeIn: 0, fadeOut: 0 }) === 1,
		'… and full before it',
	);
}

if (failures) {
	console.error(`\n${failures} failure(s)`);
	process.exit(1);
}
console.log('\nall effect-bake checks passed');
