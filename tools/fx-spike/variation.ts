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
	FX_SCALE_BEHAVIOR_TYPE,
	FX_SPEED_BEHAVIOR_TYPE,
	FxAlphaBehavior,
	FxColorOverlayBehavior,
	FxScaleBehavior,
	FxSpeedBehavior,
	behaviorsOf,
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
	FX_PRESETS,
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
assert(
	!!a0 && !a0.varied && a0.startMult === 1 && a0.endMult === 1,
	'a fresh curve is uniform (both floors 1)',
);
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

// `max` moves the authored curve; `min` sets THAT END's floor and nothing else.
const scaled = setCurveBound(base, 'scale', 'start', 'max', 2);
assert(curveRange(scaled, 'scale')?.startMax === 2, 'setting a max writes the curve endpoint');
const floored = setCurveBound(scaled, 'scale', 'start', 'min', 0.5);
const fr = curveRange(floored, 'scale')!;
assert(near(fr.startMult, 0.25), 'setting a min derives that end floor = min / max');
assert(near(fr.startMin, 0.5), 'the authored min reads straight back');
assert(near(fr.endMult, 1), 'the OTHER end is untouched — the floors are independent');
assert(
	near(curveRange(setCurveBound(floored, 'scale', 'start', 'min', 99), 'scale')!.startMult, 1),
	'a min above its max clamps that end to no spread',
);

// Speed swaps onto its own varied twin (the stock `minMult` cannot express two floors).
const fastVary = setCurveVaried(base, 'speed', true);
assert(
	count(fastVary, FX_SPEED_BEHAVIOR_TYPE) === 1,
	'speed variation ON swaps moveSpeed → fxSpeed',
);
assert(count(fastVary, 'moveSpeed') === 0, 'the stock moveSpeed is gone (never both)');
assert(
	count(setCurveVaried(fastVary, 'speed', false), 'moveSpeed') === 1,
	'…and variation OFF puts the stock moveSpeed back',
);
const scaleVary = setCurveVaried(base, 'scale', true);
assert(count(scaleVary, FX_SCALE_BEHAVIOR_TYPE) === 1, 'scale variation ON swaps scale → fxScale');
assert(
	typesOf(setCurveVaried(scaleVary, 'scale', false)).every((t) => !t.startsWith('fx')),
	'a config with variation off carries NO custom type',
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
// 1b. The two bugs the first cut shipped (owner-reported, 2026-08-28). Both came from
//     mapping FOUR authored bounds onto the library's THREE degrees of freedom (one
//     whole-curve `minMult`), and from deriving the mode from the numbers.
// ---------------------------------------------------------------------------
console.log('');
console.log('fx variation — regression: independent bounds + a mode that stays put');

// BUG 1: with `End max` at 0, dragging `End min` reset the shared ratio to 1, which flipped
// `varied` false — the checkbox unticked itself and the four sliders collapsed to two.
let z = setCurveVaried(base, 'scale', true);
z = setCurveBound(z, 'scale', 'end', 'max', 0);
assert(curveRange(z, 'scale')?.varied === true, 'a zero End max leaves Min/Max ON');
z = setCurveBound(z, 'scale', 'end', 'min', 0.3);
assert(
	curveRange(z, 'scale')?.varied === true,
	'dragging End min against a zero End max keeps it ON',
);
assert(near(curveRange(z, 'scale')!.startMin, 0.25), '…and does not disturb the Start range');
// The same self-disable fired whenever ANY min was dragged up to its max.
const atMax = setCurveBound(setCurveVaried(base, 'scale', true), 'scale', 'start', 'min', 99);
assert(
	curveRange(atMax, 'scale')?.varied === true,
	'a min dragged to or above its max keeps Min/Max ON',
);
assert(
	near(curveRange(atMax, 'scale')!.startMin, curveRange(atMax, 'scale')!.startMax),
	'…it just clamps that end to no spread',
);
assert(
	curveRange(setCurveVaried(atMax, 'scale', false), 'scale')?.varied === false,
	'only the toggle itself turns Min/Max off',
);

// BUG 2: the four bounds shared ONE ratio, so moving an End dragged the Start with it.
let q = setCurveVaried(base, 'speed', true);
q = setCurveBound(q, 'speed', 'start', 'max', 1656);
q = setCurveBound(q, 'speed', 'start', 'min', 249.85);
q = setCurveBound(q, 'speed', 'end', 'max', 1613);
const beforeEnd = curveRange(q, 'speed')!;
q = setCurveBound(q, 'speed', 'end', 'min', 800);
const afterEnd = curveRange(q, 'speed')!;
assert(near(afterEnd.endMin, 800, 1e-3), 'End min lands exactly where it was dragged');
assert(near(afterEnd.startMin, beforeEnd.startMin), 'moving End min leaves Start min ALONE');
assert(near(afterEnd.startMax, beforeEnd.startMax), 'moving End min leaves Start max alone');
// …and dragging a max holds its own min at the value the author set.
const grown = setCurveBound(q, 'speed', 'start', 'max', 1800);
assert(
	near(curveRange(grown, 'speed')!.startMin, 249.85, 1e-3),
	'dragging Start max holds Start min at its ABSOLUTE value',
);
assert(near(curveRange(grown, 'speed')!.endMin, 800, 1e-3), '…and leaves the End range alone');

// BUG 3 (owner-reported after the first fix): "when I move the start and end MAX, the min also
// moves". A range slider fires on EVERY drag tick, so a drag is many setCurveBound calls — and
// the min was STORED as a ratio, re-derived against each new max. Now it is stored absolute.
const drag = (
	c: EmitterConfigV3,
	which: 'start' | 'end',
	from: number,
	to: number,
	step: number,
): EmitterConfigV3 => {
	const dir = to > from ? step : -step;
	for (let v = from + dir; dir > 0 ? v <= to + 1e-9 : v >= to - 1e-9; v += dir) {
		c = setCurveBound(c, 'alpha', which, 'max', Number(v.toFixed(4)));
	}
	return c;
};
let shot = setCurveVaried(setCurveEnabled(base, 'alpha', true), 'alpha', true);
shot = setCurveBound(shot, 'alpha', 'start', 'max', 0.56);
shot = setCurveBound(shot, 'alpha', 'start', 'min', 0.25);
shot = setCurveBound(shot, 'alpha', 'end', 'max', 0.73);
shot = setCurveBound(shot, 'alpha', 'end', 'min', 0.32);
const shot0 = curveRange(shot, 'alpha')!;
assert(shot0.startMin === 0.25 && shot0.endMin === 0.32, 'authored mins are stored VERBATIM');

const draggedStart = drag(shot, 'start', 0.56, 0.9, 0.01);
const ds = curveRange(draggedStart, 'alpha')!;
assert(ds.startMin === 0.25, 'a 34-tick Start max drag leaves Start min EXACTLY 0.25');
assert(ds.endMin === 0.32, '…and never touches End min');
assert(near(ds.startMax, 0.9), '…while Start max lands where it was dragged');

const draggedEnd = drag(draggedStart, 'end', 0.73, 1, 0.01);
const de = curveRange(draggedEnd, 'alpha')!;
assert(de.endMin === 0.32, 'an End max drag leaves End min EXACTLY 0.32');
assert(de.startMin === 0.25, '…and never touches Start min');
// Round-tripping a max up and back down must not smear the min through float drift.
const roundTrip = drag(drag(shot, 'start', 0.56, 0.99, 0.01), 'start', 0.99, 0.56, 0.01);
assert(
	curveRange(roundTrip, 'alpha')!.startMin === 0.25,
	'86 drag ticks up and back leave the min bit-identical (no derived-product drift)',
);
// The one case where a max legitimately moves its min: dragged BELOW it.
const collapsed = drag(shot, 'start', 0.56, 0.1, 0.01);
const cr = curveRange(collapsed, 'alpha')!;
assert(
	near(cr.startMin, 0.1) && near(cr.startMax, 0.1),
	'a max dragged BELOW its min takes it down',
);
assert(curveRange(collapsed, 'alpha')!.endMin === 0.32, '…and still leaves the other end alone');

// A preset's stock `minMult` is still honoured, and shows as a real (editable) range.
const fireCfg = FX_PRESETS.find((p) => p.key === 'fire')!.build();
const fireSpeed = curveRange(fireCfg, 'speed');
assert(!!fireSpeed && fireSpeed.varied, 'a preset carrying the library minMult reads as varied');
assert(
	!!fireSpeed && near(fireSpeed.startMin, fireSpeed.startMax * 0.8),
	'…with the legacy ratio applied to both ends',
);
const migrated = setCurveBound(fireCfg, 'speed', 'start', 'min', 100);
const mb = behaviorsOf(migrated).find((b) => b.type === FX_SPEED_BEHAVIOR_TYPE);
assert(!!mb, 'editing it migrates the behavior onto the fxSpeed twin');
assert(mb?.config.minMult === undefined, 'and drops the now double-counting legacy minMult');
assert(feeds(migrated), 'the migrated config still feeds upgradeConfig');

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
const chain = (n: number, rotation = 0): FxParticleLike => {
	let head: FxParticleLike | null = null;
	for (let i = 0; i < n; i++) {
		head = {
			alpha: 1,
			tint: 0xffffff,
			agePercent: 0,
			x: 0,
			y: 0,
			rotation,
			scale: { x: 1, y: 1 },
			config: {},
			next: head,
		};
	}
	return head as FxParticleLike;
};
const walk = (first: FxParticleLike): FxParticleLike[] => {
	const out: FxParticleLike[] = [];
	for (let p: FxParticleLike | null = first; p; p = p.next) out.push(p);
	return out;
};

const ramp = (a: number, b: number) => ({
	list: [
		{ time: 0, value: a },
		{ time: 1, value: b },
	],
});

// The load-bearing property: the two ends are randomised INDEPENDENTLY, which is the whole
// reason for these classes (the library's single `minMult` locks them to one ratio).
const alphaBeh = new FxAlphaBehavior({ alpha: ramp(1, 0.5), startMult: 0.4, endMult: 0.9 });
const alphaParticles = chain(400);
alphaBeh.initParticles(alphaParticles);
const f0s = walk(alphaParticles).map((p) => Number(p.config.fxAlphaF0));
const f1s = walk(alphaParticles).map((p) => Number(p.config.fxAlphaF1));
assert(
	f0s.every((m) => m >= 0.4 - 1e-9 && m <= 1 + 1e-9),
	'fxAlpha draws every START factor inside [startMult, 1]',
);
assert(
	f1s.every((m) => m >= 0.9 - 1e-9 && m <= 1 + 1e-9),
	'…and every END factor inside its own [endMult, 1]',
);
assert(new Set(f0s).size > 1 && new Set(f1s).size > 1, 'both factors differ per particle');
assert(
	f0s.some((v, i) => Math.abs(v - f1s[i]) > 0.05),
	'the two ends are drawn INDEPENDENTLY, not from one shared multiplier',
);
const one = walk(alphaParticles)[0];
const [k0, k1] = [Number(one.config.fxAlphaF0), Number(one.config.fxAlphaF1)];
assert(near(one.alpha, 1 * k0), 'fxAlpha spawns at curve(0) × its start factor');
one.agePercent = 1;
alphaBeh.updateParticle(one);
assert(near(one.alpha, 0.5 * k1), 'and ends at curve(1) × its end factor');
one.agePercent = 0.5;
alphaBeh.updateParticle(one);
assert(
	near(one.alpha, 0.75 * ((k0 + k1) / 2)),
	'mid-life interpolates BOTH the curve and the factor',
);
assert(
	Number(one.config.fxAlphaF0) === k0 && Number(one.config.fxAlphaF1) === k1,
	'a particle keeps the SAME pair of factors for its whole life',
);

// Scale drives `particle.scale.x/y`, exactly like the stock ScaleBehavior.
const scaleBeh = new FxScaleBehavior({ scale: ramp(2, 0.5), startMult: 0.5, endMult: 1 });
const sp = chain(1);
scaleBeh.initParticles(sp);
assert(sp.scale.x === sp.scale.y && sp.scale.x >= 1 && sp.scale.x <= 2, 'fxScale spawns in [1, 2]');
sp.agePercent = 1;
scaleBeh.updateParticle(sp);
assert(near(sp.scale.x, 0.5), 'fxScale ends exactly on the curve when that end has no spread');

// Speed must reproduce the stock integration. With both floors at 1 there is no randomness, so
// the result is checkable in closed form: a constant 100 u/s along 0° for 1s is +100 in x.
const speedBeh = new FxSpeedBehavior({ speed: ramp(100, 100) });
const mv = chain(1, 0);
speedBeh.initParticles(mv);
for (let i = 0; i < 10; i++) speedBeh.updateParticle(mv, 0.1);
assert(near(mv.x, 100, 1e-9) && near(mv.y, 0, 1e-9), 'fxSpeed integrates along the launch angle');
const up = chain(1, Math.PI / 2);
speedBeh.initParticles(up);
speedBeh.updateParticle(up, 1);
assert(near(up.x, 0, 1e-9) && near(up.y, 100, 1e-9), 'fxSpeed honours the particle rotation');
// The stock behavior divides by a zero-length velocity when the curve starts at 0; ours cannot.
const zero = new FxSpeedBehavior({ speed: ramp(0, 200) });
const zp = chain(1, 0);
zero.initParticles(zp);
zp.agePercent = 1;
zero.updateParticle(zp, 0.5);
assert(Number.isFinite(zp.x) && near(zp.x, 100), 'a zero start speed stays finite (no NaN)');

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
assert(!!known[FX_SCALE_BEHAVIOR_TYPE], '…and fxScale');
assert(!!known[FX_SPEED_BEHAVIOR_TYPE], '…and fxSpeed');
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
