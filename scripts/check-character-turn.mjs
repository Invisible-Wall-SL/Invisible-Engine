// A character sheet's smooth turn (`view.turn`; packages/engine-layout/src/lib/characterTurn.ts and
// the animators of characterSheet.ts; packages/game-config/src/characterSheet.ts;
// docs/design/character-pipeline.md §13). Each animator is driven as `apps/lines` `online.ts`
// drives it, a sample a frame, with no browser:
//
//  1. off is off: a sheet with no `turn` gives frames with no `lean`, a side and a `3d` view never
//     take one, and what such a sheet draws is `check:character-sheet`'s to hold (unchanged);
//  2. the drawn direction is continuous: across every change of picture of a full sweep, at the
//     default lean, on a flat screen and on the isometric one, in eight facings and in four;
//  3. the lean never passes the sheet's, and a smaller one is respected;
//  4. the turn speed limits the sweep, and a reversal passes through the facings in between;
//  5. a mirrored facing leans the way the character turns;
//  6. a heading that sits on the edge of two facings does not flicker between their pictures;
//  7. a view of four facings turns over its own sectors;
//  8. a rig and a still image lean as a clip does; a one-shot leans from the facing it started in;
//  9. the schema: carried by the normalizer, sparse, held in range, refused on a side and a `3d`
//     view, and the validator's words;
// 10. the look a turning clip is drawn through (packages/engine-layout/src/lib/sheetClipLook.ts),
//     on pixi's own sprite with no renderer: it draws what `SpawnLayer.svelte` draws for the same
//     published clip (frames, Bounds box, speed, loop, restart, mirror, anchor, width, gold), turned
//     by the lean about the feet, the same way mirrored; its gold is `SpawnLayer.svelte`'s;
// 11. each of 2 to 7 and of 10 goes red on a mutation.
//
// Run: pnpm check:character-turn

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// pixi as `engine-layout` resolves it (the root has none): the module the look itself imports.
import {
	Container,
	Rectangle,
	Texture,
	TextureSource,
} from '../packages/engine-layout/node_modules/pixi.js/lib/index.mjs';

import { CLIP_FACINGS, CLIP_TURN_MS } from '../packages/engine-layout/src/lib/characterClips.ts';
import {
	createSheetAnimator,
	createSheetRigAnimator,
	sheetTurns,
} from '../packages/engine-layout/src/lib/characterSheet.ts';
import {
	SHEET_TURN_SPEED,
	drawnDirection,
	facingHeading,
	leanedPoint,
	sheetTurnOf,
	wrapAngle,
} from '../packages/engine-layout/src/lib/characterTurn.ts';
import { ISO_PROJECTOR } from '../packages/engine-layout/src/lib/projection.ts';
import {
	clearFlipbooks,
	registerFlipbooks,
} from '../packages/engine-layout/src/lib/registerFlipbooks.ts';
import {
	SHEET_CLIP_GOLD,
	createSheetClipLook,
	sheetClipDrawing,
} from '../packages/engine-layout/src/lib/sheetClipLook.ts';
import {
	CHARACTER_TURN_SPEED,
	CHARACTER_TURN_SPEED_MAX,
	characterTurnOf,
	normalizeCharacterSheet,
	validateCharacterSheets,
} from '../packages/game-config/index.ts';

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
const mutation = (name, fn) =>
	check(`mutation: ${name}`, () => assert.throws(fn, assert.AssertionError, 'it must be red'));

const DEG = Math.PI / 180;
const FRAME_MS = 16;
const SPEED = 120;

const ACTIONS = [
	{ id: 'idle', when: { motion: 'still' } },
	{ id: 'walk', when: { motion: 'moving' } },
	{ id: 'hop', when: { ability: 'ability1' } },
];
const sheetOf = (view, source = { kind: 'clips', prefix: 'hero' }) => ({
	view,
	source,
	draw: { width: 64 },
	actions: ACTIONS,
});
const EVERY = new Set(
	ACTIONS.flatMap((a) => CLIP_FACINGS.map((facing) => `hero_${a.id}_${facing}`)),
);
const clipsOf = (ids = EVERY) => ({ has: (id) => ids.has(id), cycleMs: () => 300 });

/** A flat screen's velocity along a heading (clockwise from north, y down). */
const flat = (heading) => ({ vx: Math.sin(heading) * SPEED, vy: -Math.cos(heading) * SPEED });

/**
 * The isometric screen's world velocity whose GROUND heading is `heading`: the screen direction
 * (sin, −cos / 2) un-projected, so the facing rule (which takes the flattening out) reads it back.
 */
const iso = (heading) => {
	const sx = Math.sin(heading);
	const sy = -Math.cos(heading) / 2;
	// ISO_PROJECTOR draws (x, y) at ((x − y)·k, (x + y)·k / 2): its inverse, up to a scale.
	const vx = sx / 2 + sy;
	const vy = sy - sx / 2;
	const length = Math.hypot(vx, vy);
	return { vx: (vx / length) * SPEED, vy: (vy / length) * SPEED };
};

/**
 * Drive an animator along `headingAt(ms)` (radians; `undefined` ⇒ it stands) for `ms`, and return
 * every frame with the facing drawn and the direction its picture is seen heading on the screen.
 */
function drive(
	animator,
	headingAt,
	ms,
	{ velocity = flat, project, flattening = 1, from = 0 } = {},
) {
	const frames = [];
	for (let atMs = from; atMs <= from + ms; atMs += FRAME_MS) {
		const heading = headingAt(atMs);
		const v = heading === undefined ? { vx: 0, vy: 0 } : velocity(heading);
		const frame = animator.frame({ atMs, ...v, ...(project ? { project } : {}) });
		frames.push({
			atMs,
			frame,
			facing: animator.facing,
			direction:
				frame?.lean === undefined
					? undefined
					: drawnDirection(animator.facing, frame.lean, flattening),
		});
	}
	return frames;
}

const pictureChanges = (frames) =>
	frames.filter((f, i) => i > 0 && f.frame.clipId !== frames[i - 1].frame.clipId).length;

/** The widest step of the drawn direction between two frames, and the widest across a change of
 *  picture. */
function steps(frames) {
	let widest = 0;
	let atChange = 0;
	let changes = 0;
	for (let i = 1; i < frames.length; i++) {
		const step = Math.abs(wrapAngle(frames[i].direction - frames[i - 1].direction));
		widest = Math.max(widest, step);
		if (frames[i].facing !== frames[i - 1].facing) {
			changes += 1;
			atChange = Math.max(atChange, step);
		}
	}
	return { widest, atChange, changes };
}

const EIGHT = { kind: 'topDown', facings: 8, turn: {} };
const FOUR = { kind: 'topDown', turn: {} };
const ISO_EIGHT = { kind: 'isometric', facings: 8, turn: {} };
const ISO_FOUR = { kind: 'isometric', turn: {} };

/** A full turn at `rate` degrees a second, starting north, after the animator has settled. */
const circling = (rate) => (ms) => ((ms / 1000) * rate * DEG) % (Math.PI * 2);

// ── 1. off is off ────────────────────────────────────────────────────────────────────────────

check('a sheet with no `turn` gives no lean, and its frames have no `lean` key', () => {
	for (const view of [
		undefined,
		{ kind: 'topDown', facings: 8 },
		{ kind: 'isometric' },
		{ kind: 'side' },
	]) {
		const sheet = sheetOf(view);
		assert.equal(sheetTurns(sheet), false);
		const frames = drive(createSheetAnimator(sheet, clipsOf()), circling(90), 4000);
		assert.ok(frames.every((f) => f.frame && !Object.hasOwn(f.frame, 'lean')));
	}
});

check('a side view and a `3d` view never turn smoothly, whatever they are handed', () => {
	assert.equal(sheetTurnOf({ kind: 'side', turn: {} }), undefined);
	assert.equal(sheetTurnOf({ kind: '3d', turn: {} }), undefined);
	assert.equal(sheetTurns(sheetOf({ kind: 'side', turn: { lean: 10 } })), false);
	const frames = drive(
		createSheetAnimator(sheetOf({ kind: 'side', turn: {} }), clipsOf()),
		circling(90),
		2000,
	);
	assert.ok(frames.every((f) => !Object.hasOwn(f.frame, 'lean')));
});

check(
	'a sheet with `turn` draws the same facing as one without while it moves along a facing',
	() => {
		for (const facing of CLIP_FACINGS) {
			const heading = () => facingHeading(facing);
			const plain = drive(
				createSheetAnimator(sheetOf({ kind: 'topDown', facings: 8 }), clipsOf()),
				heading,
				2000,
			);
			const smooth = drive(createSheetAnimator(sheetOf(EIGHT), clipsOf()), heading, 2000);
			assert.equal(smooth.at(-1).frame.clipId, plain.at(-1).frame.clipId, facing);
			assert.ok(Math.abs(smooth.at(-1).frame.lean) < 1e-9, `${facing}: upright on its facing`);
		}
	},
);

// ── 2. continuity ────────────────────────────────────────────────────────────────────────────

/** A slow full circle: the heading stays the facing rule's all the way, the sweep never lags. */
const circle = (view, options = {}) =>
	drive(createSheetAnimator(sheetOf(view), clipsOf()), circling(30), 14000, options).filter(
		(f) => f.atMs > 1000,
	);

/** The most the heading moves in a frame of {@link circle}, on the screen (a flattened ground
 *  stretches the angles near its long axis: at most `flattening` times). */
const frameTurn = (flattening = 1) => (30 * DEG * FRAME_MS * flattening) / 1000;

const continuous = (view, options, flattening = 1) => {
	const { widest, atChange, changes } = steps(circle(view, { ...options, flattening }));
	assert.ok(changes >= (view.facings === 8 ? 8 : 4), `every facing was drawn (${changes})`);
	// A picture changes in the frame its sector's edge is crossed, and the rule's dead band lets
	// the aim catch up from the edge when it turns: a step is the frames it waited, never a jump.
	const most = frameTurn(flattening) + 1e-6;
	const caught = (7.5 * DEG + (CLIP_TURN_MS / 1000) * 30 * DEG) * flattening + most;
	assert.ok(widest <= caught, `the widest step is ${widest / DEG}°`);
	assert.ok(atChange <= SHEET_TURN_SPEED * DEG * (FRAME_MS / 1000) * flattening + 1e-6);
	return { widest, atChange };
};

check(
	'eight facings, flat screen: the drawn direction is continuous across every picture change',
	() => {
		continuous(EIGHT);
	},
);
check('four facings, flat screen: continuous across every picture change', () => {
	continuous(FOUR);
});
check('eight facings on the isometric screen: continuous on the screen', () => {
	continuous(ISO_EIGHT, { velocity: iso, project: ISO_PROJECTOR.project }, 2);
});
check('four facings on the isometric screen: continuous on the screen', () => {
	continuous(ISO_FOUR, { velocity: iso, project: ISO_PROJECTOR.project }, 2);
});

/** The exact statement: at the instant a sweep changes its picture, both pictures are drawn in the
 *  same direction. A swept heading is sampled either side of every edge. */
const edgeGap = (view, lean, flattening = 1, asGround = false) => {
	const turn = sheetTurnOf({ ...view, turn: lean === undefined ? {} : { lean } });
	const facings =
		view.facings === 8
			? CLIP_FACINGS
			: view.kind === 'topDown'
				? ['n', 'e', 's', 'w']
				: ['ne', 'se', 'sw', 'nw'];
	let gap = 0;
	for (let i = 0; i < facings.length; i++) {
		const a = facings[i];
		const b = facings[(i + 1) % facings.length];
		const off = (h, f) =>
			Math.min(Math.max(wrapAngle(h - facingHeading(f)), -turn.lean), turn.lean);
		const edge = facingHeading(a) + turn.sector / 2;
		const onScreen = (h) => Math.atan2(Math.sin(h), Math.cos(h) / flattening);
		// `asGround`: the lean taken as the ground's angle, as it is not on a flattened screen.
		const seen = (f) =>
			asGround
				? onScreen(facingHeading(f)) + off(edge, f)
				: onScreen(facingHeading(f) + off(edge, f));
		gap = Math.max(gap, Math.abs(wrapAngle(seen(a) - seen(b))));
	}
	return gap;
};

check(
	'on the edge of two sectors both pictures are drawn in one direction, at the default lean',
	() => {
		for (const view of [EIGHT, FOUR]) assert.ok(edgeGap(view) < 1e-9);
		for (const view of [ISO_EIGHT, ISO_FOUR]) assert.ok(edgeGap(view, undefined, 2) < 1e-9);
	},
);

// ── 3. the maximum ───────────────────────────────────────────────────────────────────────────

const leansWithin = (view, most) => {
	const frames = drive(createSheetAnimator(sheetOf(view), clipsOf()), circling(200), 6000);
	const widest = Math.max(...frames.map((f) => Math.abs(f.frame.lean)));
	assert.ok(widest <= most * DEG + 1e-9, `leans ${widest / DEG}°, at most ${most}°`);
	return widest / DEG;
};

check('the lean never passes half the sector at the default: 22.5° of eight, 45° of four', () => {
	assert.ok(leansWithin(EIGHT, 22.5) > 22);
	assert.ok(leansWithin(FOUR, 45) > 44);
});
check('a smaller lean is respected, and one past half the sector is read as the half', () => {
	assert.ok(leansWithin({ ...EIGHT, turn: { lean: 8 } }, 8) > 7.9);
	assert.equal(leansWithin({ ...EIGHT, turn: { lean: 0 } }, 0), 0);
	leansWithin({ ...EIGHT, turn: { lean: 80 } }, 22.5);
	assert.equal(sheetTurnOf({ ...EIGHT, turn: { lean: 80 } }).lean, 22.5 * DEG);
	assert.equal(sheetTurnOf({ ...EIGHT, turn: { lean: -3 } }).lean, 0);
});

// ── 4. the turn speed ────────────────────────────────────────────────────────────────────────

/** How long a character is driven before a test reads it: its first turn, from the facing it
 *  starts in, is over at any speed used here. */
const SETTLE_MS = 4000;
const AFTER = SETTLE_MS + FRAME_MS;

/** An animator of `view` that has been heading `heading` (north when left out) for a while. */
const settled = (view, heading = 0, clips = clipsOf()) => {
	const animator = createSheetAnimator(sheetOf(view), clips);
	drive(animator, () => heading, SETTLE_MS);
	return animator;
};

/** North, then south: the frames of the reversal. */
const reversal = (turn) => drive(settled({ ...EIGHT, turn }), () => Math.PI, 3000, { from: AFTER });
const facingsSeen = (frames) => frames.map((f) => f.facing).filter((f, i, all) => f !== all[i - 1]);

const sweeps = (turn, rate) => {
	const frames = reversal(turn);
	const seen = facingsSeen(frames);
	assert.ok(
		['n,ne,e,se,s', 'n,nw,w,sw,s'].includes(seen.join(',')),
		`a reversal is drawn through ${seen.join(' ')}`,
	);
	const { widest } = steps(frames);
	assert.ok(widest <= rate * DEG * (FRAME_MS / 1000) + 1e-9, `${widest / DEG}° in a frame`);
	const turning = frames.filter((f) => f.facing !== 's' || Math.abs(f.frame.lean) > 1e-9);
	return turning.length * FRAME_MS;
};

check('a reversal sweeps through the facings in between, no faster than the turn speed', () => {
	// The facing rule holds a new facing for CLIP_TURN_MS first; then 180° at 360° a second.
	const ms = sweeps({}, SHEET_TURN_SPEED);
	assert.ok(Math.abs(ms - (CLIP_TURN_MS + 500)) <= 3 * FRAME_MS, `it took ${ms} ms`);
	const slow = sweeps({ speed: 90 }, 90);
	assert.ok(Math.abs(slow - (CLIP_TURN_MS + 2000)) <= 3 * FRAME_MS, `at 90° a second: ${slow} ms`);
});

check('speed 0 is the lean alone: the heading is where the character is aimed, at once', () => {
	const frames = reversal({ speed: 0 });
	assert.deepEqual(facingsSeen(frames), ['n', 's']);
	// And within a facing the lean follows the heading in the same frame.
	const animator = settled({ ...EIGHT, turn: { speed: 0 } });
	const [first] = drive(animator, () => 15 * DEG, 0, { from: AFTER });
	assert.ok(Math.abs(first.frame.lean - 15 * DEG) < 1e-9);
});

check('a heading that changes inside a facing leans at the turn speed, with no hold', () => {
	const frames = drive(settled(EIGHT), () => 15 * DEG, 200, { from: AFTER });
	const perFrame = SHEET_TURN_SPEED * DEG * (FRAME_MS / 1000);
	assert.ok(Math.abs(frames[0].frame.lean - perFrame) < 1e-9, 'it starts in the first frame');
	assert.ok(Math.abs(frames.at(-1).frame.lean - 15 * DEG) < 1e-9);
	assert.ok(frames.every((f) => f.facing === 'n'));
});

check('it is drawing only: a turn finishes while the character stands, and `reset` ends it', () => {
	const animator = settled({ ...EIGHT, turn: { speed: 90 } });
	drive(animator, () => Math.PI / 2, 400, { from: AFTER });
	assert.notEqual(animator.facing, 'e', 'mid-sweep');
	const stood = drive(animator, () => undefined, 2000, { from: AFTER + 500 });
	assert.equal(stood.at(-1).facing, 'e');
	assert.ok(Math.abs(stood.at(-1).frame.lean) < 1e-9);
	const again = settled({ ...EIGHT, turn: { speed: 90 } });
	drive(again, () => Math.PI / 2, 400, { from: AFTER });
	again.reset();
	assert.equal(again.facing, 'e');
});

// ── 5. a mirrored facing ─────────────────────────────────────────────────────────────────────

/** Only the facings that look east or straight are made: the west ones are their twins mirrored. */
const EAST_ONLY = new Set(
	ACTIONS.flatMap((a) => ['n', 'ne', 'e', 'se', 's'].map((facing) => `hero_${a.id}_${facing}`)),
);

const mirroredLean = (leanOfFrame) => {
	for (const [made, seen] of [
		['e', 'w'],
		['ne', 'nw'],
		['se', 'sw'],
	])
		for (const off of [-12, 9]) {
			const heading = facingHeading(seen) + off * DEG;
			const mirrored = createSheetAnimator(
				sheetOf({ ...EIGHT, turn: { speed: 0 } }),
				clipsOf(EAST_ONLY),
			);
			const { frame } = drive(mirrored, () => heading, 1000).at(-1);
			assert.equal(frame.clipId, `hero_walk_${made}`);
			assert.equal(frame.flipX, true);
			const lean = leanOfFrame(frame, off * DEG);
			// The lean turns what is SEEN: towards where the character turns, as an unmirrored
			// picture of the same facing leans.
			assert.ok(
				Math.abs(lean - off * DEG) < 1e-9,
				`${seen} leans ${lean / DEG}°, heading ${off}° off`,
			);
			assert.ok(Math.abs(wrapAngle(drawnDirection(seen, lean) - heading)) < 1e-9);
			const whole = createSheetAnimator(sheetOf({ ...EIGHT, turn: { speed: 0 } }), clipsOf());
			const made_ = drive(whole, () => heading, 1000).at(-1).frame;
			assert.equal(made_.flipX, false);
			assert.ok(Math.abs(made_.lean - lean) < 1e-9, 'as the facing drawn as made leans');
		}
};

check('a west facing drawn as its east twin mirrored leans the way the character turns', () => {
	mirroredLean((frame) => frame.lean);
});

check('a point of the body turns with it about its place', () => {
	const hand = { dx: 20, lift: 40 };
	const turned = leanedPoint(hand, 90 * DEG);
	assert.ok(Math.abs(turned.dx - 40) < 1e-9 && Math.abs(turned.lift + 20) < 1e-9);
	assert.deepEqual(leanedPoint(hand, 0), hand);
	const back = leanedPoint(leanedPoint(hand, 17 * DEG), -17 * DEG);
	assert.ok(Math.abs(back.dx - 20) < 1e-9 && Math.abs(back.lift - 40) < 1e-9);
});

// ── 6. no flicker on an edge ─────────────────────────────────────────────────────────────────

/** A heading that jitters about `edge` (degrees) a frame at a time, `by` degrees either side. */
const jitter = (edge, by) => (ms) => (edge + (Math.round(ms / FRAME_MS) % 2 ? by : -by)) * DEG;

const steady = (changesOf) => {
	for (const [view, edge] of [
		[EIGHT, 22.5],
		[EIGHT, 247.5],
		[FOUR, 45],
		[{ ...EIGHT, turn: { speed: 0 } }, 22.5],
	])
		for (const by of [0, 0.5, 3]) {
			const animator = createSheetAnimator(sheetOf(view), clipsOf());
			const frames = drive(animator, jitter(edge, by), 3000).filter((f) => f.atMs > 600);
			assert.equal(changesOf(frames, edge, by), 0, `edge ${edge}°, ±${by}°`);
		}
};

check('a heading that sits on the edge of two facings keeps one picture', () => {
	steady(pictureChanges);
});

// ── 7. four facings ──────────────────────────────────────────────────────────────────────────

const fourOwnSector = (view) => {
	const animator = createSheetAnimator(sheetOf({ ...view, turn: { speed: 0 } }), clipsOf());
	const { frame, facing } = drive(animator, () => 38 * DEG, 1000).at(-1);
	assert.equal(facing, 'n', 'inside the north facing of four');
	assert.ok(Math.abs(frame.lean - 38 * DEG) < 1e-9, `it leans ${frame.lean / DEG}°`);
};

check('a top-down view of four leans up to 45° before its picture changes', () => {
	fourOwnSector(FOUR);
	assert.equal(sheetTurnOf(FOUR).sector, Math.PI / 2);
	assert.equal(sheetTurnOf(EIGHT).sector, Math.PI / 4);
});

check('an isometric view of four turns over its four diagonals', () => {
	const animator = createSheetAnimator(sheetOf({ ...ISO_FOUR, turn: { speed: 0 } }), clipsOf());
	const options = { velocity: iso, project: ISO_PROJECTOR.project, flattening: 2 };
	// North-east on the ground is the middle of `ne`; 10° past it leans towards `se`.
	const before = drive(animator, () => 55 * DEG, 1000, options).at(-1);
	assert.equal(before.facing, 'ne');
	assert.ok(before.frame.lean > 0);
	const heading = Math.atan2(Math.sin(55 * DEG), Math.cos(55 * DEG) / 2);
	assert.ok(Math.abs(wrapAngle(before.direction - heading)) < 1e-9, 'drawn where it heads');
});

// ── 8. a rig, a still, a one-shot ────────────────────────────────────────────────────────────

check('a rig leans as a clip does, mirrored or not', () => {
	const rigs = {
		has: (rig, animation) => rig === 'hero' && ['idle', 'walk'].includes(animation),
		durationMs: () => 400,
	};
	const sheet = sheetOf({ ...EIGHT, turn: { speed: 0 } }, { kind: 'rig', rig: 'hero' });
	for (const [heading, flipX] of [
		[100, false],
		[280, true],
	]) {
		const animator = createSheetRigAnimator(sheet, rigs);
		const { frame, facing } = drive(animator, () => heading * DEG, 1000).at(-1);
		assert.equal(frame.animation, 'walk');
		assert.equal(frame.flipX, flipX);
		assert.ok(Math.abs(frame.lean - 10 * DEG) < 1e-9, `${facing} leans ${frame.lean / DEG}°`);
	}
	const plain = createSheetRigAnimator(
		sheetOf({ kind: 'topDown', facings: 8 }, { kind: 'rig', rig: 'hero' }),
		rigs,
	);
	assert.ok(!Object.hasOwn(drive(plain, () => 1, 500).at(-1).frame, 'lean'));
});

check('a still image leans as a clip does', () => {
	const still = { assetKey: 'iw/demo/manifests/atlas_manifest_S.json', region: 'boat' };
	const sheet = {
		view: { ...FOUR, turn: { speed: 0 } },
		source: { kind: 'stills' },
		draw: { width: 64 },
		actions: [
			{
				id: 'idle',
				when: [{ motion: 'still' }, { motion: 'moving' }],
				anim: { n: { still }, e: { still }, s: { still }, w: { still } },
			},
		],
	};
	const animator = createSheetAnimator(sheet, { has: () => true, cycleMs: () => undefined });
	const { frame } = drive(animator, () => 100 * DEG, 1000).at(-1);
	assert.ok(frame.clipId.startsWith('still::'));
	assert.ok(Math.abs(frame.lean - 10 * DEG) < 1e-9);
});

check('a one-shot keeps the facing it started in and leans from it, at most the lean', () => {
	const animator = settled(EIGHT);
	animator.raise({ ability: 'ability1' });
	const frames = drive(animator, () => Math.PI / 2, 280, { from: AFTER });
	assert.ok(frames.every((f) => f.frame.clipId === 'hero_hop_n'));
	assert.ok(Math.abs(frames.at(-1).frame.lean - 22.5 * DEG) < 1e-9, 'held at the lean');
});

// ── 9. the schema ────────────────────────────────────────────────────────────────────────────

const normalized = (view) => normalizeCharacterSheet({ view })?.view;

check(
	'the normalizer carries `turn`, sparse and in range, and its output comes back the same',
	() => {
		assert.deepEqual(normalized({ kind: 'topDown', facings: 8, turn: {} }), EIGHT);
		assert.deepEqual(
			normalized({ kind: 'isometric', turn: { lean: 45, speed: 360 } }),
			ISO_FOUR,
			'defaults are not stored',
		);
		assert.deepEqual(
			normalized({ kind: 'isometric', facings: 8, turn: { lean: 45 } }),
			ISO_EIGHT,
			'past half the sector is the default',
		);
		assert.deepEqual(normalized({ kind: 'topDown', turn: { lean: 30, speed: 0 } }).turn, {
			lean: 30,
			speed: 0,
		});
		assert.deepEqual(normalized({ kind: 'topDown', turn: { lean: -5, speed: 1e9 } }).turn, {
			lean: 0,
			speed: CHARACTER_TURN_SPEED_MAX,
		});
		assert.deepEqual(
			normalized({ kind: 'topDown', turn: { lean: 'x', speed: -4, more: 1 } }).turn,
			{ speed: 0 },
		);
		for (const view of [EIGHT, { kind: 'topDown', turn: { lean: 30, speed: 0 } }])
			assert.deepEqual(normalized(normalized(view)), normalized(view));
	},
);

check('absent, or anything but an object, is no turn: the view is what it was', () => {
	for (const turn of [undefined, null, true, 1, 'on', []]) {
		const view = normalized({ kind: 'topDown', facings: 8, mirror: false, turn });
		assert.deepEqual(view, { kind: 'topDown', facings: 8, mirror: false });
		assert.ok(!Object.hasOwn(view, 'turn'));
	}
});

check('a side view and a `3d` view drop it', () => {
	assert.deepEqual(normalized({ kind: 'side', turn: {} }), { kind: 'side' });
	assert.deepEqual(normalized({ kind: '3d', turn: {} }), { kind: '3d' });
});

check('the two packages agree on the defaults', () => {
	assert.equal(SHEET_TURN_SPEED, CHARACTER_TURN_SPEED);
	for (const view of [EIGHT, FOUR, ISO_EIGHT, { ...ISO_FOUR, turn: { lean: 12, speed: 90 } }]) {
		const read = characterTurnOf(view);
		const drawn = sheetTurnOf(view);
		assert.ok(Math.abs(drawn.lean - read.lean * DEG) < 1e-12);
		assert.ok(Math.abs(drawn.speed - read.speed * DEG) < 1e-12);
		assert.ok(Math.abs(drawn.sector - read.sector * DEG) < 1e-12);
	}
	assert.equal(characterTurnOf({ kind: 'topDown' }), undefined);
	assert.equal(characterTurnOf({ kind: 'side' }), undefined);
});

const issuesOf = (view) =>
	validateCharacterSheets({
		arcade: {
			characters: [{ id: 'hero', component: 'Hero', ...sheetOf(view) }],
		},
	}).filter((issue) => issue.path.includes('.turn'));

check(
	'the validator: nothing to say of a turn in range, a warning for one that is not read',
	() => {
		assert.deepEqual(issuesOf(EIGHT), []);
		assert.deepEqual(issuesOf({ kind: 'topDown', turn: { lean: 45, speed: 0 } }), []);
		const [lean] = issuesOf({ kind: 'topDown', facings: 8, turn: { lean: 30 } });
		assert.equal(lean.severity, 'warning');
		assert.equal(lean.path, 'arcade.characters[0].view.turn.lean');
		assert.match(lean.message, /0 to 22\.5 degrees.*read as 22\.5/);
		const [speed] = issuesOf({ kind: 'topDown', turn: { speed: -1 } });
		assert.equal(speed.path, 'arcade.characters[0].view.turn.speed');
		assert.match(speed.message, /read as 0/);
		assert.match(issuesOf({ kind: 'side', turn: {} })[0].message, /side view has two facings/);
		assert.match(issuesOf({ kind: '3d', turn: {} })[0].message, /3D view has no facings/);
		assert.match(issuesOf({ kind: 'topDown', turn: true })[0].message, /not read/);
	},
);

// ── 10. the look a turning clip is drawn through ─────────────────────────────────────────────

// A playing sprite joins pixi's shared ticker, which asks the browser for a frame, and a filter's
// program asks a canvas how precise its shaders are (none here: pixi takes its default).
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => {};
globalThis.document ??= { createElement: () => ({ getContext: () => null }) };

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const matrixIn = (text, after) => {
	const from = text.indexOf(after);
	assert.ok(from >= 0, `"${after}" is not in the source`);
	const open = text.indexOf('[', from + after.length);
	return text
		.slice(open + 1, text.indexOf(']', open))
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean)
		.map(Number);
};
const goldTwins = (spawnLayerGold) => {
	const mine = matrixIn(
		source('packages/engine-layout/src/lib/sheetClipLook.ts'),
		'export const SHEET_CLIP_GOLD =',
	);
	assert.equal(mine.length, 20);
	assert.deepEqual(mine, [...SHEET_CLIP_GOLD]);
	assert.deepEqual(spawnLayerGold, mine);
};
const spawnLayerGold = () =>
	matrixIn(source('packages/engine-layout/src/lib/SpawnLayer.svelte'), 'filter.matrix =');

check('the gold of a turning clip is the gold `SpawnLayer.svelte` tints a published clip', () => {
	goldTwins(spawnLayerGold());
});

const SHEET_KEY = 'studio/game/sheets/hero.json';
const page = new TextureSource({ width: 256, height: 256 });
/** A frame as a sheet's loader makes it: its rect on the page, its own box from the origin. */
const frameTexture = (x, w = 40, h = 60) =>
	new Texture({ source: page, frame: new Rectangle(x, 0, w, h), orig: new Rectangle(0, 0, w, h) });
/** A walk of three frames on a scoped sheet with a Bounds box, a still of one bare frame, and
 *  the app's loaded assets. */
const stage = () => {
	clearFlipbooks();
	const walk = [frameTexture(0), frameTexture(40), frameTexture(80)];
	const still = frameTexture(120, 50, 50);
	registerFlipbooks([
		{
			id: 'hero_walk_e',
			name: 'walk',
			assetKey: SHEET_KEY,
			frames: ['w0', 'w1', 'w2'],
			fps: 12,
			bounds: { x: -40, y: -50, w: 80, h: 100 },
		},
		{ id: 'hero_idle_e', name: 'idle', assetKey: 'heroStill', frames: ['still'], flipX: true },
	]);
	const assets = {
		[`${SHEET_KEY}::w0`]: walk[0],
		[`${SHEET_KEY}::w1`]: walk[1],
		[`${SHEET_KEY}::w2`]: walk[2],
		// The bare name of another sheet: the scoped one wins.
		w0: still,
		still,
	};
	const look = createSheetClipLook(() => assets);
	const into = new Container();
	const unmount = look.mount(into);
	return { look, into, unmount, assets, walk, still, sprite: into.children[0] };
};
const published = (over = {}) => ({
	clipId: 'hero_walk_e',
	flipX: false,
	loop: true,
	play: 0,
	width: 120,
	anchorY: 0.9,
	own: false,
	...over,
});
const UPRIGHT = { lean: 0, marked: false };
/** Where a point `up` px above the feet is drawn, from the feet (x right, y down). */
const headOf = (sprite, up = 10) => {
	sprite.updateLocalTransform();
	// Local px: the head is up the texture from the anchor, whatever the scale.
	return sprite.localTransform.apply({ x: 0, y: -up / Math.abs(sprite.scale.y) });
};

check('it is the sprite `SpawnLayer` draws: frames, Bounds box, speed, loop, anchor, width', () => {
	const { look, sprite, walk } = stage();
	assert.equal(sprite.visible, false, 'nothing is drawn before its first frame');
	look.frame(published(), UPRIGHT);
	assert.equal(sprite.visible, true);
	assert.equal(sprite.totalFrames, 3);
	// The scoped frames in order, each re-stated on the Bounds box over its own page rect.
	sprite.textures.forEach((texture, i) => {
		assert.equal(texture.source, page);
		assert.deepEqual({ ...texture.frame }, { ...walk[i].frame });
		assert.deepEqual([texture.orig.width, texture.orig.height], [80, 100]);
		assert.deepEqual([texture.trim.x, texture.trim.y], [20, 20]);
	});
	assert.equal(sprite.animationSpeed, 12 / 60);
	assert.equal(sprite.loop, true);
	assert.equal(sprite.playing, true);
	assert.deepEqual([sprite.anchor.x, sprite.anchor.y], [0.5, 0.9]);
	// 120 wide over a box of 80.
	assert.deepEqual([sprite.scale.x, sprite.scale.y], [1.5, 1.5]);
	assert.equal(sprite.rotation, 0);
	assert.deepEqual(
		{ ...look.drawn(), playing: undefined },
		{
			clipId: 'hero_walk_e',
			flipX: false,
			lean: 0,
			loop: true,
			gold: false,
			mounted: true,
			visible: true,
			frames: 3,
			playing: undefined,
			width: 120,
			height: 150,
		},
	);
	look.destroy();
});

check('a still image is a clip of one frame: its own width, the clip`s mirror, 24 frames', () => {
	const { look, sprite, still } = stage();
	look.frame(published({ clipId: 'hero_idle_e', width: 100, loop: false }), UPRIGHT);
	assert.deepEqual(sprite.textures, [still]);
	// The clip is made mirrored: published unmirrored it is drawn mirrored, and the other way.
	assert.deepEqual([sprite.scale.x, sprite.scale.y], [-2, 2]);
	assert.equal(sprite.animationSpeed, 24 / 60);
	assert.equal(sprite.loop, false);
	look.frame(published({ clipId: 'hero_idle_e', width: 100, loop: false, flipX: true }), UPRIGHT);
	assert.deepEqual([sprite.scale.x, sprite.scale.y], [2, 2]);
	look.destroy();
});

const leansAbout = (rotationOf) => {
	const { look, sprite } = stage();
	for (const flipX of [false, true]) {
		for (const lean of [20 * DEG, -20 * DEG]) {
			look.frame(published({ flipX }), { lean, marked: false });
			sprite.rotation = rotationOf(sprite);
			assert.equal(sprite.scale.x < 0, flipX);
			assert.deepEqual([sprite.x, sprite.y], [0, 0], 'the feet stay on the place');
			// The head goes where a point of the body does (`leanedPoint`), mirrored or not.
			const head = headOf(sprite);
			const turned = leanedPoint({ dx: 0, lift: 10 }, lean);
			assert.ok(Math.abs(head.x - turned.dx) < 1e-9 && Math.abs(-head.y - turned.lift) < 1e-9);
			assert.equal(look.drawn().lean, sprite.rotation);
		}
	}
	look.destroy();
};
check('it leans about the feet, the same way mirrored: clockwise is to the right', () => {
	leansAbout((sprite) => sprite.rotation);
});

const restarts = (keyOf) => {
	const { look, sprite } = stage();
	const playedOn = (clip, turn = UPRIGHT) => {
		sprite.currentFrame = 2;
		look.frame(clip, turn);
		return sprite.currentFrame === 2;
	};
	look.frame(published(), UPRIGHT);
	// What `SpawnLayer` keys the clip by (`sheetClipDrawing().key`) starts it again.
	const key = keyOf(published());
	assert.equal(key, 'hero_walk_e|false|true|0');
	assert.equal(playedOn(published({ play: 1 })), key === keyOf(published({ play: 1 })));
	assert.equal(playedOn(published({ play: 1, flipX: true })), false);
	assert.equal(playedOn(published({ play: 1, flipX: true, loop: false })), false);
	assert.equal(playedOn(published({ clipId: 'hero_idle_e' })), false);
	look.frame(published(), UPRIGHT);
	// A lean, a width, a mark: the clip plays on.
	assert.equal(playedOn(published(), { lean: 0.3, marked: true }), true);
	assert.equal(playedOn(published({ width: 90, anchorY: 1 })), true);
	assert.equal(sprite.playing, true);
	look.destroy();
};
check(
	'the clip starts again when it, its mirror, its loop or its `play` changes, only then',
	() => {
		restarts((clip) => sheetClipDrawing(clip, {}, 40).key);
	},
);

const goldWhen = (isGold) => {
	const { look, sprite } = stage();
	for (const marked of [false, true])
		for (const own of [false, true]) {
			look.frame(published({ own }), { lean: 0.1, marked });
			assert.equal((sprite.filters ?? []).length === 1, isGold(marked, own));
			assert.equal(look.drawn().gold, isGold(marked, own));
		}
	look.frame(published(), { lean: 0, marked: true });
	assert.deepEqual([...sprite.filters[0].matrix], [...SHEET_CLIP_GOLD]);
	look.destroy();
};
check('a marked player`s base clip is gold, its own clip and an unmarked one as made', () => {
	goldWhen((marked, own) => marked && !own);
});

check('nothing is drawn until the first frame is loaded, then frames that arrive are taken', () => {
	const { look, sprite, assets, walk } = stage();
	const late = assets[`${SHEET_KEY}::w0`];
	delete assets[`${SHEET_KEY}::w0`];
	delete assets.w0;
	const errors = [];
	const { error } = console;
	console.error = (message) => errors.push(message);
	try {
		look.frame(published(), UPRIGHT);
		assert.equal(sprite.visible, false);
		assert.equal(look.drawn().clipId, undefined);
		delete assets[`${SHEET_KEY}::w2`];
		assets[`${SHEET_KEY}::w0`] = late;
		look.frame(published(), UPRIGHT);
		look.frame(published(), UPRIGHT);
		// A frame missing from a clip that is drawn plays short, and says so once.
		assert.equal(sprite.totalFrames, 2);
		assert.equal(errors.length, 1);
		assert.match(errors[0], /Flipbook "hero_walk_e": 1 frame\(s\) missing/);
		assets[`${SHEET_KEY}::w2`] = walk[2];
		look.frame(published(), UPRIGHT);
		assert.equal(sprite.totalFrames, 3);
	} finally {
		console.error = error;
	}
	look.destroy();
});

check('its re-stated frames are its own: gone with the clip and with the look, not the art', () => {
	const { look, sprite, into, unmount, walk, still } = stage();
	look.frame(published(), UPRIGHT);
	const restated = [...sprite.textures];
	look.frame(published({ clipId: 'hero_idle_e' }), UPRIGHT);
	assert.ok(restated.every((texture) => texture.destroyed));
	look.frame(published(), { lean: 0, marked: true });
	const again = [...sprite.textures];
	const filter = sprite.filters[0];
	unmount();
	assert.equal(into.children.length, 0);
	assert.equal(look.drawn().mounted, false);
	look.destroy();
	assert.equal(sprite.destroyed, true);
	assert.ok(again.every((texture) => texture.destroyed));
	assert.equal(filter.glProgram, null, 'its filter is destroyed');
	assert.ok([...walk, still].every((texture) => !texture.destroyed && texture.source === page));
});

check('how a clip is drawn: the mirror over the clip`s own, the width over its box', () => {
	const drawing = (clip, entry, width = 40) => sheetClipDrawing(published(clip), entry, width);
	assert.equal(drawing({}, {}).scale, 3);
	assert.equal(drawing({}, { bounds: { x: 0, y: 0, w: 60, h: 0 } }).scale, 2);
	assert.equal(drawing({}, { bounds: { x: 0, y: 0, w: 0, h: 60 } }).scale, 3);
	assert.equal(drawing({ flipX: true }, { flipX: true }).flipX, false);
	assert.equal(drawing({ flipX: true }, {}).flipX, true);
	assert.equal(drawing({}, { flipY: true }).flipY, true);
	assert.equal(drawing({}, { fps: 30 }).animationSpeed, 0.5);
});

// ── 11. each goes red ────────────────────────────────────────────────────────────────────────

mutation('a lean below half the sector is not continuous', () => {
	assert.ok(edgeGap(EIGHT, 10) < 1e-9);
});
mutation('the lean read as a ground angle is not continuous on the isometric screen', () => {
	assert.ok(edgeGap(ISO_EIGHT, undefined, 2, true) < 1e-9);
});
mutation('the isometric circle, its directions read without the flattening', () => {
	const frames = circle(ISO_EIGHT, {
		velocity: iso,
		project: ISO_PROJECTOR.project,
		flattening: 1,
	});
	assert.ok(steps(frames).atChange <= SHEET_TURN_SPEED * DEG * (FRAME_MS / 1000) + 1e-6);
});
mutation('with no turn speed a quick circle jumps at its picture changes', () => {
	// The same sweep with the option off: the direction drawn is the facing's own.
	const animator = createSheetAnimator(sheetOf({ kind: 'topDown', facings: 8 }), clipsOf());
	const frames = drive(animator, circling(30), 14000).map((f) => ({
		...f,
		direction: drawnDirection(f.facing, 0),
	}));
	assert.ok(steps(frames).atChange <= SHEET_TURN_SPEED * DEG * (FRAME_MS / 1000) + 1e-6);
});
mutation('a lean of 22.5° is past a maximum of 8°', () => {
	leansWithin(EIGHT, 8);
});
mutation('a view of four leans past 22.5°', () => {
	leansWithin(FOUR, 22.5);
});
mutation('at speed 0 a reversal passes through no facing in between', () => {
	sweeps({ speed: 0 }, SHEET_TURN_SPEED);
});
mutation('a sweep at 360° a second is faster than 90° a second allows', () => {
	sweeps({}, 90);
});
mutation('a mirrored facing that leaned as its made twin would turn the wrong way', () => {
	mirroredLean((frame) => -frame.lean);
});
mutation('the nearest facing of the raw heading flickers on an edge', () => {
	steady((frames, edge, by) => {
		const facings = frames.map((f) => Math.round(jitter(edge, by)(f.atMs) / (Math.PI / 4)) % 8);
		return facings.filter((f, i) => i > 0 && f !== facings[i - 1]).length;
	});
});
mutation('a view of four read over the sectors of eight', () => {
	fourOwnSector({ ...FOUR, facings: 8 });
});
mutation('a gold that drifted from `SpawnLayer.svelte`', () => {
	goldTwins(spawnLayerGold().with(0, 0.5));
});
mutation('a mirrored clip turned against its mirror leans the wrong way', () => {
	leansAbout((sprite) => sprite.rotation * Math.sign(sprite.scale.x));
});
mutation('a clip keyed without its `play` does not start a repeat again', () => {
	restarts((clip) => `${clip.clipId}|${clip.flipX}|${clip.loop}|0`);
});
mutation('a marked player`s own clip drawn gold', () => {
	goldWhen((marked) => marked);
});

console.log(
	process.exitCode
		? `\ncharacter turn: FAILED (${passed} passed)`
		: `\ncharacter turn: ${passed} passed`,
);
