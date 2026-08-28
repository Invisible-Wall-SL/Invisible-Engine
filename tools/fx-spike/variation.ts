/**
 * Invisible FX — headless harness for the MIN/MAX variation seam and the knobs added with it:
 * the per-particle curve ranges (alpha / scale / speed), the `fxColorOverlay` colour overlay,
 * the rotation lock + additive emission section, flipbook playback (`art.framerate`/`loop`),
 * and the layer stack operations (duplicate / copy-paste / reorder).
 *
 *   pnpm --filter fx-spike run variation
 *
 * Proves, offline (the discipline `feedback_validate_data_contracts_offline` asks for):
 *  1. Every setter is PURE and round-trips through its reader.
 *  2. The alpha curve swaps `alpha` ⇄ `fxAlpha` by TYPE ONLY as variation is toggled, and a
 *     config with variation OFF carries NO custom type — an untouched effect stays 100% stock.
 *  3. Every edited config still feeds `upgradeConfig` (the guard the real renderers run).
 *  4. The two custom behaviors actually DO their job: `fxAlpha` gives each particle a multiplier
 *     inside `[minMult, 1]` and keeps it for life; `fxColorOverlay` blends toward its colour by a
 *     per-particle intensity, composes on top of a colour behavior, and — the trap — does NOT
 *     compound its own output when nothing else rewrites the tint.
 *  5. `registerFxBehaviors` really teaches the library's `Emitter` both types.
 *  6. `bindArt` folds authored flipbook speed/loop into `animatedSingle`, and drops `loop` in
 *     match-life mode (where the library ignores it anyway).
 */

import { Emitter, upgradeConfig, type EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import {
	bindArt,
	FX_ALPHA_BEHAVIOR_TYPE,
	FX_COLOR_OVERLAY_BEHAVIOR_TYPE,
	FxAlphaBehavior,
	FxColorOverlayBehavior,
	normalizeEffectDoc,
	registerFxBehaviors,
	type EffectDoc,
	type FxParticleLike,
} from 'engine-fx';
import {
	colorOverlay,
	curveRange,
	defaultEmitterConfig,
	duplicateLayer,
	emptyEffectDoc,
	flipbookPlay,
	hasEmission,
	insertLayerCopy,
	moveLayer,
	newLayer,
	rotationLock,
	setColorOverlayEnabled,
	setColorOverlayField,
	setCurveBound,
	setCurveEnabled,
	setCurveVaried,
	setEmissionEnabled,
	setFlipbookFps,
	setFlipbookLoop,
	setRotationLock,
	uniqueLayerKey,
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

const stubTextures = [{}, {}] as unknown as Parameters<typeof upgradeConfig>[1];
const feeds = (c: EmitterConfigV3): boolean => {
	try {
		upgradeConfig(JSON.parse(JSON.stringify(c)), stubTextures);
		return true;
	} catch {
		return false;
	}
};
const typesOf = (c: EmitterConfigV3): string[] =>
	(Array.isArray(c.behaviors) ? c.behaviors : []).map((b) => (b as { type: string }).type);
const count = (c: EmitterConfigV3, type: string): number =>
	typesOf(c).filter((t) => t === type).length;
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;

const base = defaultEmitterConfig();
const baseSnap = JSON.stringify(base);

// ---------------------------------------------------------------------------
// 1. Curve ranges — the min/max seam over alpha / scale / speed.
// ---------------------------------------------------------------------------
console.log('fx variation — curve min/max');
const a0 = curveRange(base, 'alpha');
assert(!!a0 && a0.startMax === 1 && a0.endMax === 0, 'alpha reads its authored endpoints (1 → 0)');
assert(!!a0 && !a0.varied && a0.minMult === 1, 'a fresh curve is uniform (minMult 1)');
assert(!!a0 && a0.startMin === a0.startMax, 'uniform ⇒ min equals max');

const variedAlpha = setCurveVaried(base, 'alpha', true);
assert(JSON.stringify(base) === baseSnap, 'setCurveVaried does not mutate the source');
assert(count(variedAlpha, FX_ALPHA_BEHAVIOR_TYPE) === 1, 'variation ON swaps alpha → fxAlpha');
assert(count(variedAlpha, 'alpha') === 0, 'the stock alpha behavior is gone (never both)');
assert(curveRange(variedAlpha, 'alpha')?.varied === true, 'the varied alpha reads back as varied');
assert(
	near(curveRange(variedAlpha, 'alpha')!.startMin, 0.5),
	'default variation floors start at 50% of max',
);

const backToPlain = setCurveVaried(variedAlpha, 'alpha', false);
assert(count(backToPlain, 'alpha') === 1, 'variation OFF downgrades back to the stock alpha');
assert(
	count(backToPlain, FX_ALPHA_BEHAVIOR_TYPE) === 0,
	'no custom type survives in a non-varying config',
);
assert(
	(backToPlain.behaviors as { config: Record<string, unknown> }[]).every(
		(b) => b.config.minMult === undefined,
	),
	'the dead minMult is dropped on downgrade',
);

// `max` moves the authored curve; `min` re-derives the shared ratio.
const scaled = setCurveBound(base, 'scale', 'start', 'max', 2);
assert(curveRange(scaled, 'scale')?.startMax === 2, 'setting a max writes the curve endpoint');
const floored = setCurveBound(scaled, 'scale', 'start', 'min', 0.5);
const fr = curveRange(floored, 'scale')!;
assert(near(fr.minMult, 0.25), 'setting a min derives minMult = min / max');
assert(near(fr.startMin, 0.5), 'the authored min reads straight back');
assert(near(fr.endMin, fr.endMax * 0.25), 'the SAME ratio floors the other end (library physics)');
assert(
	near(curveRange(setCurveBound(floored, 'scale', 'start', 'min', 99), 'scale')!.minMult, 1),
	'a min above its max clamps to no variation',
);

// Speed rides the stock `moveSpeed` minMult — no custom behavior at all.
const fastVary = setCurveVaried(base, 'speed', true);
assert(count(fastVary, 'moveSpeed') === 1, 'speed variation stays on the stock moveSpeed behavior');
assert(
	typesOf(fastVary).every((t) => !t.startsWith('fx')),
	'speed variation adds NO custom behavior type',
);

// Enable / disable a whole curve.
const noAlpha = setCurveEnabled(base, 'alpha', false);
assert(curveRange(noAlpha, 'alpha') === undefined, 'disabling removes the curve behavior');
const reAdded = setCurveEnabled(noAlpha, 'alpha', true);
assert(curveRange(reAdded, 'alpha')?.startMax === 1, 're-enabling seeds the default curve');
assert(setCurveEnabled(reAdded, 'alpha', true) === reAdded, 'enabling an enabled curve is a no-op');
assert(
	setCurveEnabled(setCurveVaried(base, 'alpha', true), 'alpha', false) !== base &&
		curveRange(setCurveEnabled(setCurveVaried(base, 'alpha', true), 'alpha', false), 'alpha') ===
			undefined,
	'disabling removes the VARIED twin too',
);
assert(
	[variedAlpha, backToPlain, floored, fastVary, reAdded].every(feeds),
	'every edited config still feeds upgradeConfig',
);

// ---------------------------------------------------------------------------
// 2. Colour overlay.
// ---------------------------------------------------------------------------
console.log('');
console.log('fx variation — colour overlay');
assert(colorOverlay(base) === undefined, 'a fresh config has no overlay');
const ov = setColorOverlayEnabled(base, true);
assert(JSON.stringify(base) === baseSnap, 'setColorOverlayEnabled does not mutate the source');
assert(!!colorOverlay(ov), 'enabling adds the overlay');
assert(count(ov, FX_COLOR_OVERLAY_BEHAVIOR_TYPE) === 1, 'exactly one overlay behavior');
const tuned = setColorOverlayField(setColorOverlayField(ov, 'color', '#3366ff'), 'min', 0.25);
assert(colorOverlay(tuned)?.color === '#3366ff', 'the overlay colour round-trips');
assert(colorOverlay(tuned)?.min === 0.25, 'the intensity floor round-trips');
const pushed = setColorOverlayField(tuned, 'min', 0.9);
assert(
	colorOverlay(pushed)!.max >= colorOverlay(pushed)!.min,
	'dragging min past max pushes max (never an inverted, dead range)',
);
assert(colorOverlay(setColorOverlayField(base, 'max', 0.4)) !== undefined, 'a field seeds it');
assert(colorOverlay(setColorOverlayEnabled(ov, false)) === undefined, 'disabling removes it');
assert(feeds(tuned), 'an overlay config still feeds upgradeConfig');

// ---------------------------------------------------------------------------
// 3. Rotation lock + the additive emission section.
// ---------------------------------------------------------------------------
console.log('');
console.log('fx variation — rotation lock + emission on/off');
assert(hasEmission(base), 'the default config has a launch direction');
const noDir = setEmissionEnabled(base, false);
assert(!hasEmission(noDir), 'emission can be removed');
assert(hasEmission(setEmissionEnabled(noDir, true)), 'and added back (the section is additive)');
assert(
	count(setEmissionEnabled(noDir, true), 'rotationStatic') === 1,
	're-adding lands exactly one rotation behavior',
);
assert(rotationLock(base) === undefined, 'no lock by default');
const locked = setRotationLock(base, 45);
assert(rotationLock(locked) === 45, 'the locked angle round-trips');
assert(count(locked, 'noRotation') === 1, 'the lock is one noRotation behavior');
assert(rotationLock(setRotationLock(locked, null)) === undefined, 'null releases the lock');
assert(feeds(locked), 'a locked config still feeds upgradeConfig');

// ---------------------------------------------------------------------------
// 4. The custom behaviors, run against the duck type the library calls.
// ---------------------------------------------------------------------------
console.log('');
console.log('fx variation — custom behavior runtime');
const chain = (n: number): FxParticleLike => {
	let head: FxParticleLike | null = null;
	for (let i = 0; i < n; i++) {
		head = { alpha: 1, tint: 0xffffff, agePercent: 0, config: {}, next: head };
	}
	return head as FxParticleLike;
};
const walk = (first: FxParticleLike): FxParticleLike[] => {
	const out: FxParticleLike[] = [];
	for (let p: FxParticleLike | null = first; p; p = p.next) out.push(p);
	return out;
};

const alphaBeh = new FxAlphaBehavior({
	alpha: {
		list: [
			{ time: 0, value: 1 },
			{ time: 1, value: 0 },
		],
	},
	minMult: 0.4,
});
const alphaParticles = chain(200);
alphaBeh.initParticles(alphaParticles);
const mults = walk(alphaParticles).map((p) => Number(p.config.fxAlphaMult));
assert(
	mults.every((m) => m >= 0.4 - 1e-9 && m <= 1 + 1e-9),
	'fxAlpha picks every multiplier inside [minMult, 1]',
);
assert(new Set(mults).size > 1, 'the multipliers actually differ per particle');
const one = walk(alphaParticles)[0];
const mult = Number(one.config.fxAlphaMult);
one.agePercent = 0.5;
alphaBeh.updateParticle(one);
assert(near(one.alpha, 0.5 * mult), 'fxAlpha interpolates the curve and applies the multiplier');
one.agePercent = 1;
alphaBeh.updateParticle(one);
assert(near(one.alpha, 0), 'fxAlpha reaches the curve end');
assert(
	Number(one.config.fxAlphaMult) === mult,
	'a particle keeps the SAME multiplier for its whole life',
);

const overlayBeh = new FxColorOverlayBehavior({
	color: '#ff0000',
	minIntensity: 1,
	maxIntensity: 1,
});
const red = chain(1);
overlayBeh.initParticles(red);
assert(red.tint === 0xff0000, 'a full-intensity overlay replaces the tint');
const half = new FxColorOverlayBehavior({ color: '#000000', minIntensity: 0.5, maxIntensity: 0.5 });
const grey = chain(1);
half.initParticles(grey);
assert(grey.tint === 0x808080 || grey.tint === 0x7f7f7f, 'half intensity blends halfway to black');
// The trap: with NOTHING else rewriting the tint, repeated updates must be idempotent.
const held = grey.tint;
for (let i = 0; i < 50; i++) half.updateParticle(grey);
assert(grey.tint === held, 'the overlay never compounds its own output (no runaway tint)');
// Composed with a colour behavior that rewrites the tint each frame, it re-bases.
grey.tint = 0xffffff;
half.updateParticle(grey);
assert(grey.tint === held, 'a new base from a colour behavior is picked up and re-blended');
const spread = new FxColorOverlayBehavior({ color: '#ff0000', minIntensity: 0, maxIntensity: 1 });
const many = chain(200);
spread.initParticles(many);
assert(
	new Set(walk(many).map((p) => p.tint)).size > 10,
	'a min≠max intensity gives a real per-particle spread',
);

registerFxBehaviors(Emitter);
const known = (Emitter as unknown as { knownBehaviors: Record<string, unknown> }).knownBehaviors;
assert(!!known[FX_ALPHA_BEHAVIOR_TYPE], 'registerFxBehaviors registers fxAlpha with the Emitter');
assert(!!known[FX_COLOR_OVERLAY_BEHAVIOR_TYPE], '…and fxColorOverlay');

// ---------------------------------------------------------------------------
// 5. Flipbook playback through bindArt.
// ---------------------------------------------------------------------------
console.log('');
console.log('fx variation — flipbook speed + loop');
const frames = [{}, {}, {}];
const animOf = (c: EmitterConfigV3): { framerate?: number; loop?: boolean } =>
	((c.behaviors as { type: string; config: Record<string, unknown> }[]).find(
		(b) => b.type === 'animatedSingle',
	)?.config.anim ?? {}) as { framerate?: number; loop?: boolean };

assert(animOf(bindArt(base, frames, true)).framerate === -1, 'no authored fps ⇒ match-life (-1)');
assert(animOf(bindArt(base, frames, true)).loop === undefined, 'match-life never claims to loop');
const at24 = animOf(bindArt(base, frames, true, undefined, { framerate: 24, loop: true }));
assert(at24.framerate === 24 && at24.loop === true, 'an authored fps + loop reaches the config');
assert(
	animOf(bindArt(base, frames, true, undefined, { framerate: 0, loop: true })).loop === undefined,
	'loop is dropped with a non-positive fps (the library would ignore it)',
);

const flip = setFlipbookFps({ ...newLayer('l1'), art: { assetKey: 'a', frames: ['f'] } }, 30);
assert(flipbookPlay(flip).fps === 30, 'the authored fps round-trips on the layer');
assert(flipbookPlay(setFlipbookLoop(flip, true)).loop === true, 'loop round-trips');
assert(flipbookPlay(setFlipbookFps(flip, null)).fps === null, 'null restores match-life');
assert(
	setFlipbookFps(setFlipbookLoop(flip, true), null).art.loop === undefined,
	'restoring match-life clears the now-meaningless loop',
);

// ---------------------------------------------------------------------------
// 6. Layer stack — duplicate / copy-paste / reorder.
// ---------------------------------------------------------------------------
console.log('');
console.log('fx variation — layer stack');
let doc: EffectDoc = emptyEffectDoc();
doc = { ...doc, layers: [...doc.layers, newLayer('sparks'), newLayer('smoke')] };
const docSnap = JSON.stringify(doc);

assert(uniqueLayerKey(doc, 'sparks') === 'sparks-2', 'a taken key gets a numeric suffix');
assert(uniqueLayerKey(doc, 'glow') === 'glow', 'a free key is used as-is');

const dup = duplicateLayer(doc, 'sparks');
assert(JSON.stringify(doc) === docSnap, 'duplicateLayer does not mutate the source doc');
assert(dup.doc.layers.length === 4, 'duplicate adds one layer');
assert(dup.doc.layers[2].key === 'sparks-2', 'the copy lands directly beneath the original');
assert(dup.key === 'sparks-2', 'the new key comes back for selection');
dup.doc.layers[2].config.maxParticles = 999;
assert(
	dup.doc.layers[1].config.maxParticles !== 999,
	'the copy is DEEP — editing it leaves the original alone',
);

const pasted = insertLayerCopy(doc, newLayer('sparks'), 'layer-1');
assert(
	pasted.doc.layers[1].key === 'sparks-2',
	'a pasted layer is re-keyed and lands after the target',
);
assert(insertLayerCopy(doc, newLayer('glow')).doc.layers[3].key === 'glow', 'no target ⇒ appended');

assert(
	moveLayer(doc, 'smoke', -1)
		.layers.map((l) => l.key)
		.join() === 'layer-1,smoke,sparks',
	'move up reorders',
);
assert(
	moveLayer(doc, 'layer-1', 1)
		.layers.map((l) => l.key)
		.join() === 'sparks,layer-1,smoke',
	'move down reorders',
);
assert(moveLayer(doc, 'layer-1', -1) === doc, 'moving the first layer up is a no-op');
assert(
	moveLayer(doc, 'smoke', 5)
		.layers.map((l) => l.key)
		.join() === 'layer-1,sparks,smoke',
	'moves clamp at the end',
);
assert(moveLayer(doc, 'nope', 1) === doc, 'moving an unknown layer is a no-op');
assert(JSON.stringify(doc) === docSnap, 'moveLayer does not mutate the source doc');

// ---------------------------------------------------------------------------
// 7. Save → reopen. Everything above has to survive `normalizeEffectDoc` (what
//    `POST /api/fx/save` runs) — a knob that authors but doesn't persist is worse
//    than one that never shipped.
// ---------------------------------------------------------------------------
console.log('');
console.log('fx variation — save → reopen');
const authored: EffectDoc = {
	...emptyEffectDoc('demo', 'Demo'),
	layers: [
		{
			...newLayer('l1'),
			config: setColorOverlayField(setCurveVaried(base, 'alpha', true), 'color', '#3366ff'),
			art: {
				assetKey: 'atlas.json',
				frames: ['a', 'b'],
				animated: true,
				framerate: 18,
				loop: true,
			},
		},
	],
};
const saved = normalizeEffectDoc(JSON.parse(JSON.stringify(authored)));
const savedLayer = saved.layers[0];
assert(savedLayer.art.framerate === 18, 'the flipbook fps survives normalize');
assert(savedLayer.art.loop === true, 'the flipbook loop survives normalize');
assert(
	count(savedLayer.config, FX_ALPHA_BEHAVIOR_TYPE) === 1,
	'the varied alpha behavior survives normalize (config is verbatim)',
);
assert(
	colorOverlay(savedLayer.config)?.color === '#3366ff',
	'the colour overlay survives normalize',
);
assert(
	JSON.stringify(normalizeEffectDoc(JSON.parse(JSON.stringify(saved)))) === JSON.stringify(saved),
	'normalize is still a fixed point (idempotent)',
);
const notAnimated = normalizeEffectDoc({
	...authored,
	layers: [{ ...authored.layers[0], art: { ...authored.layers[0].art, animated: false } }],
});
assert(
	notAnimated.layers[0].art.framerate === undefined,
	'a non-flipbook layer drops the fps (it would be dead config)',
);

console.log('');
if (failures > 0) {
	console.error(`FX VARIATION: ${failures} failure(s)`);
	process.exit(1);
}
console.log('FX VARIATION: PASSED');
