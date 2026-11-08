// An arcade character's clips, the resolver half (packages/engine-layout/src/lib/characterClips.ts;
// Salmons' S0 art, docs/status/salmons.md "S0 on the engine"): the facing from the drawn world
// velocity projected 2:1 (still keeps the last), the nearest facing (mirror twin drawn mirrored,
// vertical twin, its mirror) before a near state, the golden prefix before the base one, the loops
// from moving / holding, a one-shot played to its end before the loop, and `caught` with no
// stand-in. The launcher half (shipping by prefix, the save keeping it) is apps/launcher-api's
// check:character-clips; the browser half is scripts/playtest/salmons-play.mjs.
//
// Run: pnpm check:character-clips

import assert from 'node:assert/strict';

import {
	CLIP_MOVING_HOLD_MS,
	CLIP_ONE_SHOT_MS,
	CLIP_TURN_MS,
	clipFacingOf,
	createCharacterAnimator,
	normalizeCharacterClips,
	projectedVelocity,
	resolveCharacterClip,
} from '../packages/engine-layout/src/lib/characterClips.ts';
import { SALMONS_CHARACTER_CLIPS } from '../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';

let passed = 0;
const check = (name, fn) => {
	try {
		fn();
		passed += 1;
	} catch (error) {
		console.error(`✗ ${name}\n${error.message}`);
		process.exitCode = 1;
	}
};

const set =
	(...ids) =>
	(id) =>
		ids.includes(id);
const facing = (vx, vy, previous = 'se') => {
	const { dx, dy } = projectedVelocity(vx, vy);
	return clipFacingOf(dx, dy, previous);
};
const { salmon, bear, fisherman } = SALMONS_CHARACTER_CLIPS;

check('facing: world velocity projected 2:1 onto the four diagonals', () => {
	assert.equal(facing(0, -1), 'ne', 'upstream (world −y) faces up-right');
	assert.equal(facing(0, 1), 'sw', 'downstream (world +y) faces down-left');
	assert.equal(facing(1, 0), 'se', 'world +x faces down-right');
	assert.equal(facing(-1, 0), 'nw', 'world −x faces up-left');
	assert.equal(facing(0, 0, 'nw'), 'nw', 'still keeps the last');
	assert.deepEqual(projectedVelocity(3, 1), { dx: 2, dy: 2 });
	assert.equal(clipFacingOf(10, -1, 'se'), 'se', 'near the screen x axis keeps its north / south');
	assert.equal(clipFacingOf(10, -4, 'se'), 'ne', 'clearly off it turns');
	assert.equal(clipFacingOf(0.5, 10, 'nw'), 'sw', 'near the y axis keeps its east / west');
});

check('the facing drawn as made, or its nearest stand-in', () => {
	const has = set('salmon_pink_swim_se', 'salmon_pink_swim_ne');
	const at = (f) => resolveCharacterClip(salmon, 'swim', f, false, has);
	assert.deepEqual(at('se'), {
		clipId: 'salmon_pink_swim_se',
		flipX: false,
		state: 'swim',
		marked: false,
	});
	assert.deepEqual(at('ne').clipId, 'salmon_pink_swim_ne');
	assert.deepEqual(
		[at('sw').clipId, at('sw').flipX],
		['salmon_pink_swim_se', true],
		'sw = se mirrored',
	);
	assert.deepEqual(
		[at('nw').clipId, at('nw').flipX],
		['salmon_pink_swim_ne', true],
		'nw = ne mirrored',
	);
	const onlySe = set('salmon_pink_swim_se');
	assert.deepEqual(
		resolveCharacterClip(salmon, 'swim', 'ne', false, onlySe),
		{ clipId: 'salmon_pink_swim_se', flipX: false, state: 'swim', marked: false },
		'ne with no ne or nw: its vertical twin',
	);
	assert.equal(
		resolveCharacterClip(salmon, 'swim', 'nw', false, onlySe).flipX,
		true,
		"nw with only se: the vertical twin's mirror",
	);
});

check('the right action facing wrong beats the wrong action; then a near state', () => {
	const has = set('salmon_pink_hop_se', 'salmon_pink_swim_ne');
	assert.equal(resolveCharacterClip(salmon, 'hop', 'ne', false, has).clipId, 'salmon_pink_hop_se');
	assert.equal(
		resolveCharacterClip(salmon, 'hop', 'ne', false, set('salmon_pink_swim_ne')).state,
		'swim',
		'hop → swim',
	);
	assert.equal(resolveCharacterClip(bear, 'swipe', 'se', false, set('bear_idle_se')).state, 'idle');
	assert.equal(
		resolveCharacterClip(fisherman, 'cast', 'se', false, set('fisherman_reel_ne')).state,
		'reel',
		'cast → reel',
	);
	assert.equal(
		resolveCharacterClip(fisherman, 'cast', 'se', false, set('fisherman_idle_ne')).state,
		'idle',
		'cast → reel → idle',
	);
	assert.equal(resolveCharacterClip(bear, 'walk', 'se', false, set('bear_idle_se')).state, 'idle');
	assert.equal(resolveCharacterClip(bear, 'idle', 'se', false, set('bear_walk_se')).state, 'walk');
	assert.equal(
		resolveCharacterClip(salmon, 'caught', 'se', false, set('salmon_pink_swim_se')),
		undefined,
		'caught has no stand-in',
	);
	assert.equal(
		resolveCharacterClip(bear, 'idle', 'se', false, set()),
		undefined,
		'no clips: the placeholder',
	);
});

check('the golden salmon: its own clips win, else the pink ones (drawn gold)', () => {
	const pink = set('salmon_pink_swim_se');
	assert.deepEqual(resolveCharacterClip(salmon, 'swim', 'se', true, pink), {
		clipId: 'salmon_pink_swim_se',
		flipX: false,
		state: 'swim',
		marked: false,
	});
	const both = set('salmon_pink_swim_se', 'salmon_golden_swim_se');
	assert.deepEqual(resolveCharacterClip(salmon, 'swim', 'se', true, both), {
		clipId: 'salmon_golden_swim_se',
		flipX: false,
		state: 'swim',
		marked: true,
	});
	assert.equal(
		resolveCharacterClip(salmon, 'swim', 'se', false, both).clipId,
		'salmon_pink_swim_se',
		'an unmarked salmon plays pink',
	);
});

const source = (ids, cycle = {}) => ({ has: set(...ids), cycleMs: (id) => cycle[id] });

check('loops: walk while moving (held a moment), idle still, reel while the line holds', () => {
	const ids = ['bear_idle_se', 'bear_walk_se', 'fisherman_idle_se', 'fisherman_reel_se'];
	const a = createCharacterAnimator(bear, source(ids));
	const step = (atMs, vx, vy = 0, holding = false) =>
		a.frame({ atMs, vx, vy, holding, marked: false })?.clipId;
	assert.equal(step(0, 0), 'bear_idle_se');
	assert.equal(step(16, 200), 'bear_walk_se');
	assert.equal(step(32, 0), 'bear_walk_se', 'a still frame right after moving keeps the walk');
	assert.equal(step(32 + CLIP_MOVING_HOLD_MS + 1, 0), 'bear_idle_se');
	assert.equal(step(400, 10), 'bear_idle_se', 'below the still speed');
	const f = createCharacterAnimator(fisherman, source(ids));
	assert.equal(
		f.frame({ atMs: 0, vx: 0, vy: 0, holding: true, marked: false }).clipId,
		'fisherman_reel_se',
	);
	assert.equal(
		f.frame({ atMs: 16, vx: 0, vy: 0, holding: false, marked: false }).clipId,
		'fisherman_idle_se',
	);
});

check('a one-shot plays to its end before the loop, and again when repeated', () => {
	const ids = ['salmon_pink_swim_se', 'salmon_pink_swim_ne', 'salmon_pink_hop_se'];
	const a = createCharacterAnimator(salmon, source(ids, { salmon_pink_hop_se: 500 }));
	const step = (atMs, vy = 0) => a.frame({ atMs, vx: 0, vy, holding: false, marked: false });
	assert.equal(step(0, -200).clipId, 'salmon_pink_swim_se', 'a turn waits');
	assert.equal(
		step(CLIP_TURN_MS, -200).clipId,
		'salmon_pink_swim_ne',
		'swimming upstream faces ne',
	);
	assert.equal(a.event('jumped'), true);
	assert.equal(a.oneShot(200), 'hop', 'the one-shot waits for the next frame');
	const hop = step(216);
	assert.deepEqual([hop.clipId, hop.flipX, hop.loop], ['salmon_pink_hop_se', false, false]);
	assert.equal(step(500, -200).clipId, 'salmon_pink_hop_se', 'still hopping');
	assert.equal(a.oneShot(500), 'hop');
	const after = step(720, -200);
	assert.deepEqual([after.clipId, after.loop], ['salmon_pink_swim_ne', true], 'then swims on');
	assert.equal(a.oneShot(720), undefined);
	a.event('climbed');
	const again = step(740);
	assert.equal(again.clipId, 'salmon_pink_hop_se');
	assert.notEqual(again.play, hop.play, 'a repeat is a new play');
});

check('pushed back and forth, a character keeps its facing; a held turn turns it', () => {
	const a = createCharacterAnimator(salmon, source(['salmon_pink_swim_se', 'salmon_pink_swim_ne']));
	const step = (atMs, vy) => a.frame({ atMs, vx: 0, vy, holding: false, marked: false }).clipId;
	for (let t = 0; t < 1000; t += 50) step(t, t % 100 ? 200 : -200);
	assert.equal(a.facing, 'se', 'up and down every 50 ms: no turn');
	step(1000, -200);
	assert.equal(step(1000 + CLIP_TURN_MS - 1, -200), 'salmon_pink_swim_se');
	assert.equal(step(1000 + CLIP_TURN_MS, -200), 'salmon_pink_swim_ne');
});

check(
	'a reset forgets the one-shot; still, a turn in hand is dropped; no length: a real one',
	() => {
		const ids = ['salmon_pink_swim_se', 'salmon_pink_swim_ne', 'salmon_pink_hop_se'];
		const a = createCharacterAnimator(salmon, source(ids));
		const step = (atMs, vy = 0) => a.frame({ atMs, vx: 0, vy, holding: false, marked: false });
		a.event('jumped');
		assert.equal(step(0).clipId, 'salmon_pink_hop_se');
		assert.equal(a.oneShot(CLIP_ONE_SHOT_MS - 1), 'hop', 'no cycle length: CLIP_ONE_SHOT_MS');
		a.reset();
		assert.equal(a.oneShot(1), undefined);
		assert.equal(step(2).clipId, 'salmon_pink_swim_se');
		step(10, -200);
		step(20);
		step(30 + CLIP_TURN_MS, -200);
		assert.equal(a.facing, 'se', 'a stop in between restarts the turn');
		step(40 + 2 * CLIP_TURN_MS, -200);
		assert.equal(a.facing, 'ne');
	},
);

check('a one-shot that falls back to the loop playing is not played (no restart)', () => {
	const a = createCharacterAnimator(salmon, source(['salmon_pink_swim_se']));
	a.frame({ atMs: 0, vx: 0, vy: 0, holding: false, marked: false });
	a.event('jumped');
	const next = a.frame({ atMs: 16, vx: 0, vy: 0, holding: false, marked: false });
	assert.deepEqual([next.clipId, next.loop], ['salmon_pink_swim_se', true]);
	assert.equal(a.oneShot(16), undefined);
});

check('caught: played once if it has a clip, with no stand-in', () => {
	const withCaught = createCharacterAnimator(
		salmon,
		source(['salmon_pink_swim_se', 'salmon_pink_caught_ne'], { salmon_pink_caught_ne: 800 }),
	);
	assert.equal(withCaught.plays('caught', false), true);
	withCaught.event('caught');
	const c = withCaught.frame({ atMs: 0, vx: 0, vy: 0, holding: false, marked: false });
	assert.deepEqual([c.clipId, c.loop], ['salmon_pink_caught_ne', false]);
	assert.equal(withCaught.oneShot(799), 'caught');
	assert.equal(withCaught.oneShot(801), undefined);
	const without = createCharacterAnimator(salmon, source(['salmon_pink_swim_se']));
	assert.equal(without.plays('caught', false), false, 'no caught clip: hidden at once, as before');
	assert.equal(
		createCharacterAnimator(bear, source(['bear_idle_se'])).plays('caught', false),
		false,
	);
	assert.equal(createCharacterAnimator(bear, source(['bear_swipe_se'])).event('jumped'), false);
});

check('the saved shape: known fields kept, a malformed look dropped', () => {
	assert.deepEqual(normalizeCharacterClips(structuredClone(salmon)), salmon);
	assert.deepEqual(normalizeCharacterClips(structuredClone(fisherman)), fisherman);
	assert.equal(
		normalizeCharacterClips({ prefixes: { base: 'a' }, idle: 'x', displayWidth: 0 }),
		undefined,
	);
	assert.equal(normalizeCharacterClips('salmon'), undefined);
});

console.log(
	process.exitCode
		? `\ncharacter clips: FAILED (${passed} passed)`
		: `\ncharacter clips: ${passed} passed`,
);
