/**
 * Repro fixture for "the FX bound on the 1s key plays on the 0.01s key with the flipbook".
 *
 * Models the runtime half of a rig binding: the manifest hands `<RiggedEffect>` / `<RiggedFlipbook>`
 * one binding per KEYFRAME (event name + animation + time), the spine `AnimationState` fires each
 * event with its keyframe time and its track's animation, and `riggedBeatMatches` decides which
 * mounts fire. Two keys of the default `event` name — a clip at 0.01s and an effect at 1s — are
 * driven through it and the fires per mount are asserted.
 *
 * Run: node --experimental-strip-types packages/pixi-svelte/fixtures/riggedBeat.fixture.ts
 */
import assert from 'node:assert/strict';

import { riggedBeatMatches, type RiggedBeatBinding } from '../src/lib/riggedBeat.ts';

/** What the spine runtime hands a listener on one keyframe crossing. */
const fire = (animation: string, time: number, name = 'event') => ({ name, animation, time });

/** A mount per binding, counting its fires — the `runId` bumps of the real components. */
const mounts = (bindings: RiggedBeatBinding[]) => {
	const fires = bindings.map(() => 0);
	const cross = (ev: ReturnType<typeof fire>) => {
		bindings.forEach((b, i) => {
			if (riggedBeatMatches(b, ev)) fires[i] += 1;
		});
	};
	return { fires, cross };
};

// ── The reported bug: two keys of one name, one clip + one effect ──────────────────────────────
{
	const clip: RiggedBeatBinding = { event: 'event', animation: 'win', time: 0.01 };
	const fx: RiggedBeatBinding = { event: 'event', animation: 'win', time: 1 };
	const m = mounts([clip, fx]);
	m.cross(fire('win', 0.01));
	assert.deepEqual(m.fires, [1, 0], 'at 0.01s only the clip plays — the effect waits for its key');
	m.cross(fire('win', 1));
	assert.deepEqual(m.fires, [1, 1], 'at 1s only the effect plays — the clip does not replay');
}

// ── A key at t=0 is a beat like any other ──────────────────────────────────────────────────────
{
	const b: RiggedBeatBinding = { event: 'event', animation: 'win', time: 0 };
	assert.equal(riggedBeatMatches(b, fire('win', 0)), true, 'a t=0 key matches a t=0 fire');
	assert.equal(riggedBeatMatches(b, fire('win', 0.01)), false, 'but not the 0.01s key');
}

// ── The same name in another animation is another beat ─────────────────────────────────────────
{
	const b: RiggedBeatBinding = { event: 'event', animation: 'win', time: 0 };
	assert.equal(riggedBeatMatches(b, fire('static', 0)), false, 'static@0 is not win@0');
}

// ── Name still gates everything ────────────────────────────────────────────────────────────────
{
	const b: RiggedBeatBinding = { event: 'boom', animation: 'win', time: 0.5 };
	assert.equal(riggedBeatMatches(b, fire('win', 0.5, 'other')), false, 'another name never fires');
	assert.equal(riggedBeatMatches(b, { name: undefined, animation: 'win', time: 0.5 }), false);
}

// ── A manifest baked before beats existed keeps name-only firing ───────────────────────────────
{
	const legacy: RiggedBeatBinding = { event: 'event' };
	assert.equal(riggedBeatMatches(legacy, fire('win', 0.01)), true);
	assert.equal(riggedBeatMatches(legacy, fire('static', 1)), true);
	const animOnly: RiggedBeatBinding = { event: 'event', animation: 'win' };
	assert.equal(riggedBeatMatches(animOnly, fire('win', 7)), true, 'no time ⇒ any time');
	assert.equal(riggedBeatMatches(animOnly, fire('static', 7)), false);
}

// ── Float noise is absorbed; a neighbouring key is not ─────────────────────────────────────────
{
	const b: RiggedBeatBinding = { event: 'event', animation: 'win', time: 0.3 };
	assert.equal(riggedBeatMatches(b, fire('win', 0.30000000000000004)), true);
	assert.equal(
		riggedBeatMatches(b, fire('win', 0.3005)),
		false,
		'the next authorable key is 1e-4 away',
	);
	assert.equal(riggedBeatMatches(b, { name: 'event', animation: 'win', time: undefined }), false);
}

console.log('riggedBeat fixture: all assertions passed');
