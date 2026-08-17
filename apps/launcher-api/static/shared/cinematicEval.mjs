// GENERATED — do not edit. Source: packages/engine-cinematic/src/cinematicEval.js
// Regenerate: node scripts/sync-cinematic-eval.mjs   (CI/gate check: --check)
// Invisible Cinematic — Phase 0: the LAYERED STRIP EVALUATOR core.
//
// This is the module design/invisible-cinematic.md §4.3 calls "one blend engine, not two":
// the SAME code must drive the `/rigger` cinematic preview and the in-game `<Cinematic>`
// component. It is therefore written as a portable ES module with NO imports — the caller
// injects the spine enums + resolved clips (`ctx`), so it runs headless (this spike), in
// `static/rigger/cinematic.js` against the vendored minified runtime, and in the engine
// against `@esotericsoftware/spine-pixi-v8`, without a fork.
//
// THERE IS EXACTLY ONE COPY OF THIS FILE and it lives here, under `static/`, because that is the
// only place all three consumers can reach: the browser loads it as `/shared/cinematicEval.mjs`
// and the headless gates import it across the repo (`tools/rigger-spike/cinematic*.mjs`). Copying
// it into `tools/` or into the engine would re-create the hand-synced-renderer drift this module
// exists to avoid. Graduates to `packages/engine-cinematic/` in Phase 3 (the ship chain), still
// as one copy. Keep it dependency-free.
//
// ======================= WHAT THE GATE ESTABLISHED (cinematic.mjs) =======================
//
// MIX BLEND per strip — the rule that makes layering correct (mirrors how AnimationState
// treats track 0 vs tracks 1+, read off spine-core AnimationState.applyAnimation):
//   • the FIRST non-additive strip applied to an actor this frame → MixBlend.setup
//   • every later non-additive strip                              → MixBlend.replace
//   • an additive strip                                           → MixBlend.add,
//     and it must NOT consume the "first" slot: additive needs a base underneath it.
//
//   Where that rule earns its keep — measured, not assumed (mutation-tested in cinematic.mjs):
//   • For the FIRST strip, setup and replace are EQUIVALENT here, because we open with
//     setToSetupPose() and `replace` blends from the current value, which IS the setup value.
//     (Forcing the first strip to `replace` changes nothing — verified.) It is written as
//     `setup` for intent and parity with AnimationState, not for correctness.
//   • For LATER strips the rule is load-bearing: `replace` blends OVER the layers below
//     (an alpha-0.5 layer lands exactly on lerp(base, top, 0.5) in local bone space), whereas
//     `setup` would blend toward the SETUP pose and discard the base. Forcing every strip to
//     `setup` misses that identity by ~570 units on a real rig.
//
// A LAYER PASSES THROUGH BEFORE ITS OWN FIRST KEY. Under `MixBlend.replace`, a bone timeline
// applied at a time earlier than its first keyframe returns WITHOUT touching the property
// (spine-core `CurveTimeline*.apply`, the `if (time < frames[0])` branch) — while the same
// timeline under `MixBlend.setup` snaps the property to its setup value. So a partial-body
// layer leaves properties it has not started keying at whatever the layer below set, instead
// of punching a setup-pose hole in the stack. That is the behaviour authors want, it falls out
// of the rule above for free, and it is the reason a naive "compare against the clip evaluated
// alone" test reports false deviations.
//
// DETERMINISM — `evaluateActor` is a pure function of `t`: it calls setToSetupPose() and
// re-applies every active strip from scratch, so scrub(t) === play-to(t) exactly (proved
// bit-for-bit on real 86- and 73-bone rigs). The two deliberate exceptions:
//   • CUES are edge-triggered (`cuesCrossed`) — they need lastT and must never re-fire on a
//     scrub. Clip-internal spine events are suppressed here (lastTime === time ⇒ the runtime
//     collects no events); the cue track is the authored surface.
//   • Physics constraints integrate over time; the caller advances them only while playing.
//
// LOOPING is resolved into LOCAL CLIP TIME, not handed to the runtime: `clip.apply(..., loop:
// false, ...)` always. `clipLocalTime` owns once/count/fill/pingPong so a repeat boundary is a
// value we can test, and so `clipIn` trimming composes with looping (the runtime's own `loop`
// flag would wrap over the UNtrimmed duration and silently ignore the trim).
//
// MASKS are snapshot-and-restore of the bones OUTSIDE the mask — `Animation.apply` has no mask
// parameter and never will. v1 masks BONE transforms only; slot colour / attachment / deform
// channels are not masked (documented limit, not a bug).

// ---- small helpers --------------------------------------------------------

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Positive modulo — `-0.1 % 2` is `-0.1` in JS, which would read as a negative clip time. */
const mod = (a, n) => (n <= 0 ? 0 : ((a % n) + n) % n);

/** A strip's end on the cinematic timeline. */
export const stripEnd = (strip) => strip.start + strip.length;

/** Bones to include for a mask: the named bones, plus their descendants when `includeChildren`. */
export function expandBoneMask(skeleton, mask) {
	const names = new Set(mask?.bones ?? []);
	if (!mask?.includeChildren) return names;
	// Walk the (already topologically ordered) bone list once: a bone is in the mask if its
	// parent is. Spine guarantees parents precede children in `skeleton.bones`.
	for (const bone of skeleton.bones) {
		const parent = bone.parent;
		if (parent && names.has(parent.data.name)) names.add(bone.data.name);
	}
	return names;
}

// ---- strip time mapping ---------------------------------------------------

/**
 * Map cinematic time `t` to a local time inside the strip's source clip.
 * Returns `null` when the strip contributes nothing at `t`.
 *
 * `extrapolate` (Blender's strip extrapolation, same names):
 *   'holdForward' (DEFAULT) — nothing before `start`, hold the last posed frame after `end`.
 *   'hold'                  — also hold the first frame before `start`.
 *   'none'                  — contributes only inside `[start, end)`.
 * The default is 'holdForward' because 'none' makes an actor SNAP BACK TO ITS SETUP POSE the
 * instant a strip ends, which is never what an author means.
 */
export function clipLocalTime(strip, t, clipDuration) {
	const start = strip.start;
	const length = strip.length;
	const end = start + length;
	const extrapolate = strip.extrapolate ?? 'holdForward';

	let rel;
	if (t < start) {
		if (extrapolate !== 'hold') return null;
		rel = 0;
	} else if (t >= end) {
		if (extrapolate === 'none') return null;
		rel = length;
	} else {
		rel = t - start;
	}

	const speed = strip.speed ?? 1;
	const clipIn = strip.clipIn ?? 0;
	// Playable source length after the head trim, and after an optional explicit tail trim.
	const tail = strip.clipOut != null ? Math.min(strip.clipOut, clipDuration) : clipDuration;
	const avail = Math.max(tail - clipIn, 0);
	if (avail <= 0) return { local: clipIn, rel, cycle: 0 };

	const src = rel * speed; // seconds of source consumed at `rel`
	const loop = strip.loop ?? { mode: 'once' };
	let offset;
	let cycle = 0;

	switch (loop.mode) {
		case 'fill': {
			cycle = Math.floor(src / avail);
			offset = mod(src, avail);
			// Landing exactly on a repeat boundary from ABOVE (held end, or an exact multiple)
			// should read as the end of the previous cycle, not the start of the next one —
			// otherwise a held `fill` strip snaps to its first frame.
			if (src > 0 && offset === 0) {
				offset = avail;
				cycle -= 1;
			}
			break;
		}
		case 'pingPong': {
			const period = avail * 2;
			const m = mod(src, period);
			cycle = Math.floor(src / period);
			offset = m <= avail ? m : period - m;
			break;
		}
		case 'count': {
			const n = Math.max(1, loop.n ?? 1);
			const total = avail * n;
			if (src >= total) {
				offset = avail; // played out — freeze on the last frame
				cycle = n - 1;
			} else {
				cycle = Math.floor(src / avail);
				offset = mod(src, avail);
			}
			break;
		}
		case 'once':
		default:
			offset = Math.min(src, avail); // freeze on the last frame once consumed
			break;
	}

	return { local: clipIn + offset, rel, cycle };
}

/**
 * The strip's contribution weight at `t`: the blend-in/out envelope times its own `alpha`.
 * Ramps are measured from the strip's own edges and clamp outside them (a held strip past its
 * end therefore sits at the END of its blend-out ramp, which is what "fade out and stay faded"
 * should mean).
 */
export function blendEnvelope(strip, t) {
	const length = strip.length;
	const rel = Math.min(Math.max(t - strip.start, 0), length);
	const blendIn = strip.blendIn ?? 0;
	const blendOut = strip.blendOut ?? 0;
	let a = 1;
	if (blendIn > 0 && rel < blendIn) a = rel / blendIn;
	if (blendOut > 0 && rel > length - blendOut) a = Math.min(a, (length - rel) / blendOut);
	return clamp01(a) * (strip.alpha ?? 1);
}

// ---- pose evaluation ------------------------------------------------------

/** Local transform snapshot of one bone — the unit a mask restores. */
const boneLocal = (b) => ({
	x: b.x, y: b.y, rotation: b.rotation,
	scaleX: b.scaleX, scaleY: b.scaleY, shearX: b.shearX, shearY: b.shearY,
});
const restoreBone = (b, s) => {
	b.x = s.x; b.y = s.y; b.rotation = s.rotation;
	b.scaleX = s.scaleX; b.scaleY = s.scaleY; b.shearX = s.shearX; b.shearY = s.shearY;
};

/**
 * Apply one clip to a skeleton, optionally restricted to a bone mask.
 * `lastTime === time` deliberately: clip-internal spine events must not fire from the pose
 * path (the cue track is the authored event surface, and re-firing on scrub is the classic bug).
 */
function applyStrip(spine, skeleton, clip, local, alpha, blend, maskNames) {
	if (!maskNames || maskNames.size === 0) {
		clip.apply(skeleton, local, local, false, null, alpha, blend, spine.MixDirection.mixIn);
		return;
	}
	const outside = [];
	for (const bone of skeleton.bones) {
		if (!maskNames.has(bone.data.name)) outside.push([bone, boneLocal(bone)]);
	}
	clip.apply(skeleton, local, local, false, null, alpha, blend, spine.MixDirection.mixIn);
	for (const [bone, snap] of outside) restoreBone(bone, snap);
}

/**
 * Pose ONE actor at cinematic time `t`. Pure in `t` — see the determinism note in the header.
 *
 * @param spine    the runtime namespace ({ MixBlend, MixDirection, Physics }) — injected so the
 *                 module is identical headless / vendored-minified / spine-pixi-v8.
 * @param actor    { skeleton, tracks } — `tracks` are this actor's tracks, any order.
 * @param t        cinematic time in seconds.
 * @param resolveClip (strip, actor) => runtime `Animation` (or null to skip the strip).
 */
export function evaluateActor(spine, actor, t, resolveClip) {
	const { skeleton } = actor;
	skeleton.setToSetupPose();

	const tracks = actor.tracks
		.filter((tr) => tr.kind === 'animation')
		.slice()
		.sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0));

	let firstApplied = false;
	for (const track of tracks) {
		const strips = track.strips.slice().sort((a, b) => a.start - b.start);
		for (const strip of strips) {
			const clip = resolveClip(strip, actor);
			if (!clip) continue;
			const m = clipLocalTime(strip, t, clip.duration);
			if (!m) continue;
			const alpha = blendEnvelope(strip, t);
			if (alpha <= 0) continue;

			const additive = strip.blend === 'add';
			const blend = additive
				? spine.MixBlend.add
				: firstApplied
					? spine.MixBlend.replace
					: spine.MixBlend.setup;

			applyStrip(spine, skeleton, clip, m.local, alpha, blend, strip.mask && expandBoneMask(skeleton, strip.mask));
			if (!additive) firstApplied = true;
		}
	}
	return firstApplied;
}

// ---- property / camera channels -------------------------------------------
//
// A CHANNEL is a sorted list of `{ time, value, ease }` keys. `ease` belongs to the key on the
// LEFT of a segment (its outgoing interpolation) — the same convention Spine and every dope
// sheet uses, so "make this key stepped" affects the segment that leaves it.
//
// Outside the keyed range a channel HOLDS its first/last value rather than falling back to the
// actor's static placement. A channel with keys owns that property outright for the whole
// cinematic; mixing "keys in the middle, static value at the edges" would make the actor jump at
// the first and last key, which is never what an author means.

const EASE = {
	hold: () => 0,
	linear: (u) => u,
	ease: (u) => u * u * (3 - 2 * u), // smoothstep — ease in AND out
};

/**
 * Value of one channel at `t`, or `undefined` when the channel has no keys (the caller then
 * falls back to the actor's static placement).
 */
export function sampleChannel(keys, t) {
	if (!keys || !keys.length) return undefined;
	if (keys.length === 1 || t <= keys[0].time) return keys[0].value;
	const last = keys[keys.length - 1];
	if (t >= last.time) return last.value;

	let i = 0;
	while (i < keys.length - 2 && keys[i + 1].time <= t) i++;
	const a = keys[i];
	const b = keys[i + 1];
	const span = b.time - a.time;
	if (span <= 0) return b.value;
	const u = (t - a.time) / span;
	const shape = EASE[a.ease] || EASE.linear;
	return a.value + (b.value - a.value) * shape(u);
}

/** Every channel of a property/camera track sampled at `t`. Keyless channels are omitted. */
export function sampleTrack(track, t) {
	const out = {};
	if (!track || !track.channels) return out;
	for (const [name, keys] of Object.entries(track.channels)) {
		const v = sampleChannel(keys, t);
		if (v !== undefined) out[name] = v;
	}
	return out;
}

/**
 * An actor's effective placement at `t`: its static `place` overridden by any keyed channel.
 * "Place it, then animate only what you want to move."
 */
export function resolvePlace(place, propertyTracks, t) {
	const out = Object.assign({}, place);
	for (const track of propertyTracks || []) Object.assign(out, sampleTrack(track, t));
	return out;
}

/**
 * Whether an actor is on screen at `t`.
 *
 * STEPPED by nature — a boolean does not interpolate, so the value is simply the last key at or
 * before `t`. Like every other channel, a track WITH keys OWNS visibility for the whole cinematic:
 * before the first key it holds that first key's value rather than falling back to the static
 * toggle, so an actor keyed hidden-then-shown starts hidden instead of flashing on for frame 0 —
 * which is the entire reason someone keys visibility in the first place.
 *
 * No keys anywhere ⇒ the static per-actor toggle, so an un-keyed cinematic is unchanged.
 * `keys` are assumed sorted by time (every writer sorts on insert).
 */
export function resolveVisible(staticVisible, visibilityTracks, t) {
	const fallback = staticVisible !== false;
	let out = fallback;
	let keyed = false;
	for (const track of visibilityTracks || []) {
		const keys = track && track.keys;
		if (!keys || !keys.length) continue;
		keyed = true;
		let v = keys[0].visible !== false; // hold the first key backwards in time
		for (const k of keys) {
			if (k.time <= t + 1e-9) v = k.visible !== false;
			else break;
		}
		out = v;
	}
	return keyed ? out : fallback;
}

/** Insert or replace a key at `time` (exact-time match wins), keeping the channel sorted. */
export function putKey(keys, time, value, ease = 'linear') {
	const eps = 1e-6;
	const existing = keys.findIndex((k) => Math.abs(k.time - time) < eps);
	if (existing >= 0) {
		keys[existing] = { time, value, ease: keys[existing].ease || ease };
		return keys[existing];
	}
	const key = { time, value, ease };
	keys.push(key);
	keys.sort((a, b) => a.time - b.time);
	return key;
}

// ---- cues -----------------------------------------------------------------

/**
 * Cue keys crossed by advancing from `lastT` to `t`, half-open `(lastT, t]`.
 *
 * Returns NOTHING when time went backwards, or when the jump is larger than `maxStep` — that
 * is a SEEK (scrub / drag the playhead), and a seek must never fire cues. The caller sets
 * `lastT = t` after a seek without firing. `maxStep` defaults to 0.25s: comfortably above a
 * dropped-frame delta at 30/60fps, far below any deliberate jump.
 */
export function cuesCrossed(keys, lastT, t, maxStep = 0.25) {
	if (!(t > lastT)) return [];
	if (t - lastT > maxStep) return [];
	return keys.filter((k) => k.time > lastT && k.time <= t);
}
