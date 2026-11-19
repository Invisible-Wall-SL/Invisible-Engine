// An arcade character's clips, the resolver half (packages/engine-layout/src/lib/characterClips.ts;
// Salmons' S0 art, docs/status/salmons.md "S0 on the engine"): the facing from the drawn world
// velocity projected 2:1 (still keeps the last), the nearest facing (mirror twin drawn mirrored,
// vertical twin, its mirror) before a near state, the golden prefix before the base one, the loops
// from moving / holding, a one-shot played to its end before the loop, and `caught` with no
// stand-in. A look of eight facings (game-families §9 #28; Salmons' bear and fisherman): the eight
// 45° sectors on the ground and their deadband, the mirror twin and the stand-ins outward by
// angle, five drawn facings covering all eight, the diagonals alone still playing, and the hand
// on the clip's box, mirrored with it. The launcher half (shipping by prefix, the save keeping
// it) is apps/launcher-api's check:character-clips; the browser half is
// scripts/playtest/salmons-play.mjs.
//
// Run: pnpm check:character-clips

import assert from 'node:assert/strict';

import {
	CLIP_FACING8_DEADBAND,
	CLIP_FACINGS,
	CLIP_HAND,
	CLIP_MOVING_HOLD_MS,
	CLIP_ONE_SHOT_MS,
	CLIP_TURN_MS,
	characterClipsIn,
	clipBox,
	clipFacing8Of,
	clipFacingOf,
	clipMirrorOf,
	clipPoints,
	createCharacterAnimator,
	normalizeCharacterClips,
	projectedVelocity,
	resolveCharacterClip,
	screenFlattening,
} from '../packages/engine-layout/src/lib/characterClips.ts';
import {
	ISO_PROJECTOR,
	ISO_PROJECTOR_MIRRORED,
	screenToWorldDirection,
} from '../packages/engine-layout/src/lib/projection.ts';
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

// ── Eight facings (`facings: 8`: Salmons' bear and fisherman) ────────────────────────────────

/** The screen direction of each facing's middle on the 2:1 isometric screen. */
const SCREEN = {
	n: [0, -1],
	ne: [1, -0.5],
	e: [1, 0],
	se: [1, 0.5],
	s: [0, 1],
	sw: [-1, 0.5],
	w: [-1, 0],
	nw: [-1, -0.5],
};
/** A direction `degrees` clockwise of north on the ground, as the isometric screen draws it. */
const ground = (degrees) => {
	const a = (degrees * Math.PI) / 180;
	return [Math.sin(a) * 300, (-Math.cos(a) / 2) * 300];
};
const opposite = (name) => CLIP_FACINGS[(CLIP_FACINGS.indexOf(name) + 4) % 8];
const close = (actual, expected, message) =>
	assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} is not ${expected}`);
/** What a bear with these walk clips draws facing `facing`: the clip's facing, `~` when mirrored. */
const bearWalk = (facing, drawn, prefer) => {
	const has = set(...drawn.map((f) => `bear_walk_${f}`));
	const found = resolveCharacterClip(bear, 'walk', facing, false, has, prefer);
	return found && `${found.clipId.slice('bear_walk_'.length)}${found.flipX ? '~' : ''}`;
};

check('Salmons: the bear and the fisherman take eight facings, the salmon keeps four', () => {
	assert.equal(bear.facings, 8);
	assert.equal(fisherman.facings, 8);
	assert.equal(salmon.facings, undefined);
});

check('eight facings: the nearest of eight, 45° apart on the ground', () => {
	for (const [i, name] of CLIP_FACINGS.entries()) {
		const [dx, dy] = SCREEN[name];
		assert.equal(clipFacing8Of(dx, dy, opposite(name)), name, `${name}'s middle`);
		for (const off of [-20, 20]) {
			const [x, y] = ground(i * 45 + off);
			assert.equal(clipFacing8Of(x, y, opposite(name)), name, `${name}, ${off}° off its middle`);
		}
	}
	assert.equal(clipFacing8Of(0, 0, 'w'), 'w', 'still keeps the last');
	assert.equal(clipFacing8Of(2, 0.5, 'n'), 'se', 'the isometric screen: down a cell’s edge');
	assert.equal(clipFacing8Of(2, 0.5, 'n', 1), 'e', 'a flat screen draws the same direction east');
});

check('eight facings: the screen’s keys move a character along the eight middles', () => {
	for (const projector of [ISO_PROJECTOR, ISO_PROJECTOR_MIRRORED]) {
		const flattening = screenFlattening(projector.project);
		assert.equal(flattening, 2, 'the 2:1 screen, mirrored or not');
		for (const name of CLIP_FACINGS) {
			const [dx, dy] = SCREEN[name];
			const world = screenToWorldDirection(projector, Math.sign(dx), Math.sign(dy));
			const on = projector.project(world.x * 200, world.y * 200);
			assert.equal(
				clipFacing8Of(on.x, on.y, opposite(name), flattening),
				name,
				`${name} (mirrored: ${projector.mirrored})`,
			);
		}
	}
	assert.equal(
		screenFlattening((x, y) => ({ x, y })),
		1,
		'a flat screen',
	);
});

check('eight facings: a direction on a sector’s edge keeps the facing it has', () => {
	const at = (degrees, previous) => clipFacing8Of(...ground(degrees), previous);
	// East is 90° clockwise of north and south-east 135°: their sectors meet at 112.5°.
	const edge = 112.5;
	const band = 7.5;
	close((CLIP_FACING8_DEADBAND * 180) / Math.PI, band, 'the deadband, degrees');
	assert.equal(at(edge, 'e'), 'e');
	assert.equal(at(edge, 'se'), 'se');
	assert.equal(at(edge + band - 1, 'e'), 'e', 'inside the deadband');
	assert.equal(at(edge + band + 1, 'e'), 'se', 'past it');
	assert.equal(at(edge - band + 1, 'se'), 'se', 'and back: inside it');
	assert.equal(at(edge - band - 1, 'se'), 'e', 'past it');
	let facing = 'e';
	for (let i = 0; i < 20; i++) facing = at(edge + (i % 2 ? 5 : -5), facing);
	assert.equal(facing, 'e', 'swinging 5° either side of the edge: no flick');
});

check('eight facings: five drawn, three mirrored', () => {
	const drawn = ['n', 'ne', 'e', 'se', 's'];
	assert.deepEqual(
		Object.fromEntries(CLIP_FACINGS.map((facing) => [facing, bearWalk(facing, drawn)])),
		{ n: 'n', ne: 'ne', e: 'e', se: 'se', s: 's', sw: 'se~', w: 'e~', nw: 'ne~' },
	);
	assert.deepEqual(
		CLIP_FACINGS.map((facing) => clipMirrorOf(facing)),
		[undefined, 'nw', 'w', 'sw', undefined, 'se', 'e', 'ne'],
		'n and s have no mirror twin',
	);
	assert.equal(bearWalk('w', [...drawn, 'w']), 'w', 'a west clip that is drawn is drawn as made');
});

check('eight facings: the mirror twin, then the nearest outward, each before its mirror', () => {
	assert.equal(bearWalk('e', ['e', 'w', 'se']), 'e', 'as made first');
	assert.equal(bearWalk('e', ['w', 'se', 'ne']), 'w~', 'its mirror twin before a neighbour');
	assert.equal(bearWalk('se', ['sw', 's', 'e']), 'sw~');
	assert.equal(bearWalk('e', ['se', 'ne']), 'se', 'of two neighbours, the one towards the viewer');
	assert.equal(bearWalk('e', ['sw', 'ne']), 'sw~', '…or its mirror twin’s clip, mirrored');
	assert.equal(bearWalk('e', ['ne', 'nw']), 'ne', 'a neighbour as made before its mirror twin');
	assert.equal(bearWalk('n', ['ne', 'nw']), 'ne', 'as near and as far north: the eastern');
	assert.equal(bearWalk('s', ['sw', 'se']), 'se');
	assert.equal(bearWalk('e', ['s', 'ne']), 'ne', '45° away before 90°');
	assert.equal(bearWalk('e', ['n', 's']), 's', '90° away: towards the viewer');
	assert.equal(bearWalk('w', ['n']), 'n');
	assert.equal(bearWalk('n', ['s']), 's', 'its opposite, last');
	assert.equal(bearWalk('e', ['se', 'ne'], 'ne'), 'ne', 'a tie keeps the facing last seen');
	assert.equal(bearWalk('e', ['se', 'ne'], 'se'), 'se');
	assert.equal(bearWalk('e', ['se', 'ne'], 'w'), 'se', 'last seen in neither: as with none');
	assert.equal(bearWalk('e', ['sw', 'nw'], 'ne'), 'nw~', 'the facing seen, not the clip’s');
	assert.equal(
		resolveCharacterClip(bear, 'walk', 'e', false, set('bear_walk_n', 'bear_idle_e')).clipId,
		'bear_walk_n',
		'the right action facing wrong beats the wrong action',
	);
	assert.equal(resolveCharacterClip(bear, 'swipe', 'w', false, set('bear_idle_n')).state, 'idle');
	assert.equal(resolveCharacterClip(bear, 'walk', 'w', false, set()), undefined);
});

check('eight facings: a character drawn only in the diagonals still plays', () => {
	assert.deepEqual(
		Object.fromEntries(CLIP_FACINGS.map((facing) => [facing, bearWalk(facing, ['se', 'ne'])])),
		{ n: 'ne', ne: 'ne', e: 'se', se: 'se', s: 'se', sw: 'se~', w: 'se~', nw: 'ne~' },
	);
	assert.deepEqual(
		Object.fromEntries(
			CLIP_FACINGS.map((facing) => [facing, bearWalk(facing, ['se', 'ne', 'sw', 'nw'])]),
		),
		{ n: 'ne', ne: 'ne', e: 'se', se: 'se', s: 'se', sw: 'sw', w: 'sw', nw: 'nw' },
	);
});

/** A character walking towards facing `name`'s middle on Salmons' mirrored screen, at `atMs`. */
const walk = (animator, atMs, name) => {
	const [dx, dy] = SCREEN[name];
	const v = ISO_PROJECTOR_MIRRORED.unproject(dx * 200, dy * 200);
	return animator.frame({
		atMs,
		vx: v.x,
		vy: v.y,
		holding: false,
		marked: false,
		project: ISO_PROJECTOR_MIRRORED.project,
	});
};
/** The same, held until the turn is made: what it draws then, `~` when mirrored. */
let clock = 0;
const turnTo = (animator, name) => {
	walk(animator, (clock += 16), name);
	const drawn = walk(animator, (clock += CLIP_TURN_MS), name);
	return drawn && `${drawn.clipId}${drawn.flipX ? '~' : ''}`;
};

check('eight facings: the animator turns to each facing after the turn delay', () => {
	const ids = ['n', 'ne', 'e', 'se', 's'].map((f) => `bear_walk_${f}`);
	const a = createCharacterAnimator(bear, source([...ids, 'bear_swipe_e']));
	assert.equal(walk(a, (clock += 16), 'e').clipId, 'bear_walk_se', 'a turn waits');
	assert.equal(walk(a, (clock += CLIP_TURN_MS - 1), 'e').clipId, 'bear_walk_se');
	assert.equal(turnTo(a, 'e'), 'bear_walk_e');
	assert.equal(a.facing, 'e');
	assert.equal(turnTo(a, 'w'), 'bear_walk_e~', 'west: its east twin mirrored');
	assert.equal(turnTo(a, 'n'), 'bear_walk_n');
	assert.equal(turnTo(a, 'nw'), 'bear_walk_ne~');
	assert.equal(turnTo(a, 'sw'), 'bear_walk_se~');
	assert.equal(turnTo(a, 's'), 'bear_walk_s');
	assert.equal(turnTo(a, 'w'), 'bear_walk_e~');
	assert.equal(a.event('ability'), true);
	const swipe = walk(a, (clock += 16), 'w');
	assert.deepEqual(
		[swipe.clipId, swipe.flipX, swipe.loop],
		['bear_swipe_e', true, false],
		'a one-shot in a straight facing, mirrored for the west',
	);
	const iso = createCharacterAnimator(bear, source(ids));
	iso.frame({ atMs: 0, vx: 150, vy: -150, holding: false, marked: false });
	const east = iso.frame({ atMs: CLIP_TURN_MS, vx: 150, vy: -150, holding: false, marked: false });
	assert.equal(east.clipId, 'bear_walk_e', 'with no projector: the 2:1 isometric screen');
	assert.equal(
		createCharacterAnimator(bear, source(['bear_swipe_n'])).plays('ability', false),
		true,
		'a one-shot drawn in any facing plays',
	);
});

check('eight facings: straight between two diagonals keeps the one it shows', () => {
	const a = createCharacterAnimator(bear, source(['bear_walk_se', 'bear_walk_ne']));
	assert.equal(turnTo(a, 'ne'), 'bear_walk_ne');
	assert.equal(turnTo(a, 'e'), 'bear_walk_ne', 'east after north-east: no flick to se');
	assert.equal(a.facing, 'e');
	assert.equal(turnTo(a, 'se'), 'bear_walk_se');
	assert.equal(turnTo(a, 'e'), 'bear_walk_se', 'east after south-east keeps se');
	assert.equal(turnTo(a, 'n'), 'bear_walk_ne');
	assert.equal(turnTo(a, 'w'), 'bear_walk_se~', 'west: the diagonal towards the viewer, mirrored');
	assert.equal(turnTo(a, 'nw'), 'bear_walk_ne~');
	assert.equal(turnTo(a, 'w'), 'bear_walk_ne~', 'west after north-west keeps nw');
});

check('four facings (no `facings`, or 4): no straight facing and no straight clip', () => {
	const a = createCharacterAnimator(salmon, source(['salmon_pink_swim_se', 'salmon_pink_swim_e']));
	assert.equal(turnTo(a, 'e'), 'salmon_pink_swim_se');
	assert.equal(a.facing, 'se', 'straight right on the screen keeps a diagonal');
	assert.equal(
		resolveCharacterClip(salmon, 'swim', 'se', false, set('salmon_pink_swim_e')),
		undefined,
		'a straight clip is not a stand-in',
	);
	const four = { ...bear, facings: 4 };
	assert.equal(resolveCharacterClip(four, 'walk', 'se', false, set('bear_walk_e')), undefined);
	assert.equal(
		resolveCharacterClip(bear, 'walk', 'se', false, set('bear_walk_e')).clipId,
		'bear_walk_e',
		'of eight it is',
	);
});

check('the saved shape keeps `facings` and `hand`', () => {
	assert.deepEqual(normalizeCharacterClips(structuredClone(bear)), bear);
	const handed = { ...structuredClone(fisherman), hand: { x: 0.9, y: 0.25 } };
	assert.deepEqual(normalizeCharacterClips(structuredClone(handed)), handed);
	assert.equal(normalizeCharacterClips({ ...structuredClone(bear), facings: 4 }).facings, 4);
	const odd = normalizeCharacterClips({
		...structuredClone(bear),
		facings: 6,
		hand: { x: '0.5', y: 0.2 },
	});
	assert.deepEqual([odd.facings, odd.hand], [undefined, undefined], 'malformed: dropped');
	assert.deepEqual(
		normalizeCharacterClips({ ...structuredClone(bear), hand: { x: 0.1, y: 0.2, z: 3 } }).hand,
		{ x: 0.1, y: 0.2 },
	);
});

check('a game’s own clips: for a component with none, and the facings of a block with none', () => {
	// A block as the export wrote it before a character could have eight facings.
	const { facings: _, ...before } = bear;
	assert.deepEqual(characterClipsIn(undefined, bear), bear, 'no block: the game’s own');
	assert.deepEqual(
		characterClipsIn(before, bear),
		{ ...before, facings: 8 },
		'a block with no facings takes the game’s, and keeps the rest of itself',
	);
	const four = { ...before, displayWidth: 120, facings: 4 };
	assert.deepEqual(
		characterClipsIn(four, bear),
		four,
		'a block that names four is played as written',
	);
	assert.deepEqual(characterClipsIn(salmon, salmon), salmon, 'the salmon’s names none: four');
	assert.deepEqual(characterClipsIn(before, undefined), before, 'another game names none');
	assert.equal(characterClipsIn(undefined, undefined), undefined);
	const moved = createCharacterAnimator(
		characterClipsIn(before, bear),
		source(['bear_walk_e', 'bear_walk_se']),
	);
	assert.equal(turnTo(moved, 'e'), 'bear_walk_e', 'so an old block walks east by its east clip');
});

check('the hand: on the clip’s box, mirrored with the clip', () => {
	// A 32 × 64 box drawn 56 wide (the fisherman's body) is 112 tall, its feet at the bottom.
	const box = { w: 32, h: 64 };
	const made = clipPoints(fisherman, box, false);
	close(made.hand.dx, (CLIP_HAND.x - 0.5) * 56, 'the default hand, across');
	close(made.hand.lift, (1 - CLIP_HAND.y) * 112, 'the default hand, up');
	close(made.middle, 56, 'its middle');
	const mirrored = clipPoints(fisherman, box, true);
	close(mirrored.hand.dx, -made.hand.dx, 'mirrored with the clip');
	close(mirrored.hand.lift, made.hand.lift, 'at the same height');
	const own = { ...fisherman, anchorY: 0.9, hand: { x: 0.9, y: 0.25 } };
	const named = clipPoints(own, box, false);
	close(named.hand.dx, 0.4 * 56, 'a named hand, across');
	close(named.hand.lift, (0.9 - 0.25) * 112, 'a named hand, up from the feet');
	close(named.middle, (0.9 - 0.5) * 112, 'the middle, from the feet');
	close(clipPoints(own, box, true).hand.dx, -0.4 * 56, 'a named hand, mirrored');
});

check('a clip’s box: its Bounds box, else its first frame, once that frame is loaded', () => {
	const sheet = 'invisible_wall/salmons/manifests/atlas_manifest_bear.json';
	const clip = { id: 'bear_walk_e', name: 'bear_walk_e', assetKey: sheet, frames: ['e_0', 'e_1'] };
	const bounds = { x: 8, y: 0, w: 80, h: 120 };
	const loaded = { [`${sheet}::e_0`]: { width: 96, height: 128 } };
	assert.equal(clipBox(clip, undefined), undefined);
	assert.equal(clipBox(clip, {}), undefined, 'not loaded: not drawn');
	assert.equal(clipBox({ ...clip, bounds }, {}), undefined, 'a box alone is not a loaded frame');
	assert.deepEqual(clipBox(clip, loaded), { w: 96, h: 128 }, 'its frame');
	assert.deepEqual(clipBox({ ...clip, bounds }, loaded), { w: 80, h: 120 }, 'its Bounds box');
	assert.deepEqual(clipBox({ ...clip, bounds: { ...bounds, h: 0 } }, loaded), { w: 96, h: 128 });
	assert.deepEqual(clipBox(clip, { e_0: { width: 10, height: 20 } }), { w: 10, h: 20 });
	assert.equal(clipBox({ ...clip, frames: [] }, loaded), undefined);
});

console.log(
	process.exitCode
		? `\ncharacter clips: FAILED (${passed} passed)`
		: `\ncharacter clips: ${passed} passed`,
);
