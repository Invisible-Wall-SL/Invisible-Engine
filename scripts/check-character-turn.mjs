// A character sheet's smooth turn (`view.turn`; packages/engine-layout/src/lib/characterTurn.ts and
// the animators of characterSheet.ts; packages/game-config/src/characterSheet.ts;
// docs/design/character-pipeline.md §13). Each animator is driven as `apps/lines` `online.ts`
// drives it, a sample a frame, with no browser:
//
//  1. off is off: a sheet with no `turn` gives frames with no `lean` and no `blend`, field for
//     field what they were, a side and a `3d` view never take one, and what such a sheet draws is
//     `check:character-sheet`'s to hold (unchanged);
//  2. THE TILT (sample B, picked by the owner by eye): the lean is a rotation on the screen in
//     proportion to the heading's distance from its facing's middle, `frac × most`, the same for
//     every facing and mirrored too; the picture switches at the halfway point, +most before and
//     −most after. An isometric view's default most is 8°; a top-down view's is half the sector,
//     where the drawn direction is continuous across every change (the numbers it had before);
//  3. the lean never passes the sheet's, and a smaller one is respected;
//  4. the turn speed limits the sweep, and a reversal passes through the facings in between;
//  5. a mirrored facing leans the way the character turns;
//  6. a heading that sits on the edge of two facings does not flicker between their pictures;
//  7. a view of four facings turns over its own sectors;
//  8. a rig and a still image lean as a clip does; a one-shot leans from the facing it started in;
//     a picture kept while the heading leaves its sector eases its lean, and never flips;
//  9. the schema: carried by the normalizer, sparse, held in range, refused on a side and a `3d`
//     view, the defaults a saved `turn: {}` reads as on each kind of view, and the validator's
//     words;
// 10. the look a turning clip is drawn through (packages/engine-layout/src/lib/sheetClipLook.ts),
//     on pixi's own sprite with no renderer: it draws what `SpawnLayer.svelte` draws for the same
//     published clip (frames, Bounds box, speed, loop, restart, mirror, anchor, width, gold), turned
//     by the lean about its pivot (the feet, or the middle of its box), the same way mirrored; its
//     gold is `SpawnLayer.svelte`'s;
// 11. the blend (off by default: a saved `turn: {}` has no blend object in any frame, and its
//     walk keeps its phase across a change of picture): its weights, the frames an animator carries it on (a loop's change of facing,
//     turned back, swept, never on a one-shot, a hold, a change of action or after `reset`), the
//     phase a cycle is carried on at, and which two pictures are one pose;
// 12. the looks that draw a blend, on pixi's own objects and the rig runtime's with no renderer:
//     the clip look cross-fades two sprites, the rig look (sheetRigLook.ts) mixes one pose in one
//     view or cross-fades two, each carried on at the phase the other had reached, and leans about
//     the sheet's pivot;
// 13. each of 2 to 8 and of 10 to 12 goes red on a mutation written here.
//
// Run: pnpm check:character-turn

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

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
	sheetClipPoints,
	sheetLeanPivot,
	sheetTurns,
} from '../packages/engine-layout/src/lib/characterSheet.ts';
import {
	SHEET_TURN_BLEND,
	SHEET_TURN_ISO_LEAN,
	SHEET_TURN_SPEED,
	blendWeight,
	drawnDirection,
	facingHeading,
	fadeAlphas,
	frameKept,
	leanOf,
	leanedPoint,
	phaseKept,
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
	CHARACTER_TURN_BLEND,
	CHARACTER_TURN_BLEND_MAX,
	CHARACTER_TURN_ISO_LEAN,
	CHARACTER_TURN_SPEED,
	CHARACTER_TURN_SPEED_MAX,
	characterTurnLean,
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
/** An isometric view leans none unless its sheet says so: these two lean half their sector, where
 *  the drawn direction is continuous as it is on a top-down view by default. */
const ISO_EIGHT_LEANT = { kind: 'isometric', facings: 8, turn: { lean: 22.5 } };
const ISO_FOUR_LEANT = { kind: 'isometric', turn: { lean: 45 } };
const ISO_SCREEN = { velocity: iso, project: ISO_PROJECTOR.project };
/** A sheet that sets a blend (none is the default): the cross-fade checks run on it. */
const BLEND_MS = 160;
const BLENDS = { blend: BLEND_MS };

/** What a frame draws, whichever source it is of: two frames of one picture are not blended. */
const pictureOf = (frame) => `${frame.clipId ?? frame.animation}|${frame.flipX}`;
/** The frames at which the picture drawn is another than the frame before's. */
const changesOf = (frames) =>
	frames.flatMap((f, i) =>
		i > 0 && pictureOf(f.frame) !== pictureOf(frames[i - 1].frame) ? [i] : [],
	);

/** A full turn at `rate` degrees a second, starting north, after the animator has settled. */
const circling = (rate) => (ms) => ((ms / 1000) * rate * DEG) % (Math.PI * 2);

// ── 1. off is off ────────────────────────────────────────────────────────────────────────────

/** A frame's fields as they were before a sheet could turn smoothly, of each source. */
const CLIP_FRAME_KEYS = ['clipId', 'flipX', 'loop', 'play', 'marked', 'action', 'variant'];
const RIG_FRAME_KEYS = ['rig', 'animation', 'skin', 'flipX', 'loop', 'play', 'action', 'variant'];
const PLAIN_RIGS = {
	has: (rig, animation) => rig === 'hero' && ['idle', 'walk'].includes(animation),
	durationMs: () => 400,
};

const plainFrames = (keysOf) => {
	for (const view of [
		undefined,
		{ kind: 'topDown', facings: 8 },
		{ kind: 'isometric' },
		{ kind: 'side' },
	]) {
		const sheet = sheetOf(view);
		assert.equal(sheetTurns(sheet), false);
		// A circle, an about-turn and a stop: every way a turning sheet's picture changes.
		const path = (ms) => (ms < 4000 ? circling(90)(ms) : ms < 5000 ? Math.PI : undefined);
		const frames = drive(createSheetAnimator(sheet, clipsOf()), path, 6000);
		assert.ok(frames.every((f) => f.frame && !Object.hasOwn(f.frame, 'lean')));
		assert.ok(frames.every((f) => !Object.hasOwn(f.frame, 'blend')));
		for (const { frame } of frames) assert.deepEqual(keysOf(frame), CLIP_FRAME_KEYS);
		const rig = sheetOf(view, { kind: 'rig', rig: 'hero' });
		for (const { frame } of drive(createSheetRigAnimator(rig, PLAIN_RIGS), path, 6000))
			assert.deepEqual(keysOf(frame), RIG_FRAME_KEYS);
	}
	const walking = createSheetAnimator(sheetOf({ kind: 'topDown', facings: 8 }), clipsOf());
	assert.deepEqual(drive(walking, () => Math.PI / 2, 1000).at(-1).frame, {
		clipId: 'hero_walk_e',
		flipX: false,
		loop: true,
		play: 0,
		marked: false,
		action: 'walk',
		variant: undefined,
	});
};

check('a sheet with no `turn`: no `lean`, no `blend`, its frames field for field as before', () => {
	plainFrames((frame) => Object.keys(frame));
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
/** What sample B draws at `heading` for a facing of `sector`: the tilt, on the screen. */
const sampleTilt = (heading, facing, sector, most) => {
	const rest = wrapAngle(heading - facingHeading(facing));
	return (rest / (sector / 2)) * most;
};

/** `leanOf` against the sample over a sweep of headings, every facing, straight and mirrored
 *  alike (the lean is the facing SEEN's, after any mirror). */
const linearTilt = (leanAt) => {
	for (const [facings, sector] of [
		[CLIP_FACINGS, 45 * DEG],
		[['ne', 'se', 'sw', 'nw'], 90 * DEG],
	])
		for (const most of [SHEET_TURN_ISO_LEAN * DEG, 3 * DEG, sector / 2])
			for (const facing of facings)
				for (let rest = -sector / 2; rest <= sector / 2 + 1e-9; rest += sector / 36) {
					const heading = facingHeading(facing) + rest;
					const want = sampleTilt(heading, facing, sector, most);
					const lean = leanAt(heading, facing, most, sector);
					assert.ok(
						Math.abs(lean - want) < 1e-9,
						`${facing} ${(rest / DEG).toFixed(1)}° off: ${lean / DEG}°, the sample ${want / DEG}°`,
					);
				}
};

check(
	'the tilt is `frac × most` on the screen, for every facing, the same in four and eight',
	() => {
		linearTilt(leanOf);
	},
);

/** The switch at the halfway point: +most just before it, −most just after, on the next picture. */
const switchAtHalf = (leanAt) => {
	const most = SHEET_TURN_ISO_LEAN * DEG;
	for (let i = 0; i < 8; i++) {
		const a = CLIP_FACINGS[i];
		const b = CLIP_FACINGS[(i + 1) % 8];
		const edge = facingHeading(a) + 22.5 * DEG;
		assert.ok(Math.abs(leanAt(edge - 1e-6, a, most, 45 * DEG) - most) < 1e-5, `${a} before`);
		assert.ok(Math.abs(leanAt(edge + 1e-6, b, most, 45 * DEG) + most) < 1e-5, `${b} after`);
	}
};

check(
	'the switch: tilted +most just before the halfway point, the next one −most just after',
	() => {
		switchAtHalf(leanOf);
	},
);

/** An isometric eight on its own screen at `turn: {}`, aimed at once (speed 0): each frame's lean
 *  is the sample's at the heading aimed, and the picture is the facing of that heading. */
const isoSaved = (view) => {
	const animator = createSheetAnimator(
		sheetOf(view),
		clipsOf(
			new Set(ACTIONS.flatMap((a) => ['n', 'ne', 'e', 'se', 's'].map((f) => `hero_${a.id}_${f}`))),
		),
	);
	let seen = 0;
	for (let h = 0; h < 360; h += 2.5) {
		const heading = h * DEG;
		// A fresh look a while along the heading: the facing rule has settled on its facing.
		const frames = drive(animator, () => heading, 600, {
			...ISO_SCREEN,
			from: (h / 2.5) * 1000,
		});
		const { frame, facing } = frames.at(-1);
		const step = CLIP_FACINGS[((Math.round(h / 45) % 8) + 8) % 8];
		if (facing !== step) continue;
		seen += 1;
		const want = sampleTilt(heading, facing, 45 * DEG, SHEET_TURN_ISO_LEAN * DEG);
		assert.ok(
			Math.abs(frame.lean - want) < 0.1 * DEG,
			`${h}°: ${facing}${frame.flipX ? ' mirrored' : ''} ${frame.lean / DEG}°, the sample ${want / DEG}°`,
		);
	}
	assert.ok(seen >= 100, `${seen} headings drawn in the sample's facing`);
};

check(
	'an isometric eight saved `turn: {}` tilts as sample B: 8° at the switch, linear between',
	() => {
		isoSaved({ ...ISO_EIGHT, turn: { speed: 0 } });
		assert.equal(sheetTurnOf(ISO_EIGHT).lean, 8 * DEG);
		assert.equal(sheetTurnOf(ISO_FOUR).lean, 8 * DEG);
	},
);

/**
 * A circle at a constant `rate` (degrees a second): every change of picture comes within one
 * frame's turn of the halfway point between the two facings (`headingAt` is where the frame
 * heads, on the ground), the frame before tilted +most towards the next facing and the frame of
 * the change −most, each within that frame's turn. No wait at the edge, no hold.
 */
const switchesAtHalf = (view, rate, headingAt = (f) => circling(rate)(f.atMs)) => {
	const turn = sheetTurnOf(view) ?? { lean: 8 * DEG, sector: 45 * DEG };
	const half = turn.sector / 2;
	// Started facing north, where the circle starts: the drawn heading is the circle's throughout.
	const frames = drive(
		createSheetAnimator(sheetOf(view), clipsOf(), 'n'),
		circling(rate),
		(360 / rate) * 1000 * 2,
		view.kind === 'isometric' ? ISO_SCREEN : {},
	).filter((f) => f.atMs > 100);
	const changes = changesOf(frames);
	assert.ok(changes.length >= 8, `${changes.length} changes`);
	const step = (rate * DEG * FRAME_MS) / 1000;
	for (const i of changes) {
		const from = frames[i - 1].facing;
		const edge = facingHeading(from) + half;
		const off = Math.abs(wrapAngle(headingAt(frames[i]) - edge));
		assert.ok(off <= step + 1e-9, `${from} → ${frames[i].facing} ${off / DEG}° past the edge`);
		const tilt = (lean) => Math.abs(lean) >= turn.lean * (1 - step / half) - 1e-9;
		assert.ok(frames[i - 1].frame.lean > 0 && tilt(frames[i - 1].frame.lean), 'before: +most');
		assert.ok(frames[i].frame.lean < 0 && tilt(frames[i].frame.lean), 'after: −most');
	}
};

check('a circle at 70° and at 360° a second switches within a frame of the halfway point', () => {
	switchesAtHalf(ISO_EIGHT, 70);
	switchesAtHalf(ISO_EIGHT, 360);
	switchesAtHalf(EIGHT, 70);
	switchesAtHalf({ ...ISO_EIGHT, turn: { lean: 3 } }, 70);
});

/** A top-down view's default lean (half the sector) against the lean before sample B, as it
 *  was on a top-down screen (flattening 1), over every heading and facing. */
const sameAsBefore = (leanAt) => {
	const old = (heading, facing, most, sector) => {
		const from = wrapAngle(heading - facingHeading(facing));
		const far = Math.abs(from);
		const kept = Math.min(Math.max((Math.PI - far) / (Math.PI - sector / 2), 0), 1);
		return Math.sign(from) * Math.min(far, most) * kept;
	};
	for (const sector of [45 * DEG, 90 * DEG])
		for (const facing of CLIP_FACINGS)
			for (let h = 0; h < 360; h += 1.5) {
				const now = leanAt(h * DEG, facing, sector / 2, sector);
				assert.ok(Math.abs(now - old(h * DEG, facing, sector / 2, sector)) < 1e-12);
			}
};

check('a top-down view at its default lean draws the numbers it had before (flattening 1)', () => {
	sameAsBefore(leanOf);
});

/** The exact statement: at the instant a sweep changes its picture, both pictures are drawn in the
 *  same direction. A swept heading is sampled either side of every edge. */
const edgeGap = (view) => {
	const turn = sheetTurnOf(view);
	const facings = view.facings === 8 ? CLIP_FACINGS : ['n', 'e', 's', 'w'];
	let gap = 0;
	for (let i = 0; i < facings.length; i++) {
		const a = facings[i];
		const b = facings[(i + 1) % facings.length];
		const edge = facingHeading(a) + turn.sector / 2;
		const seen = (f) => facingHeading(f) + leanOf(edge, f, turn.lean, turn.sector);
		gap = Math.max(gap, Math.abs(wrapAngle(seen(a) - seen(b))));
	}
	return gap;
};

check('top-down: on the edge of two sectors both pictures are drawn in one direction', () => {
	for (const view of [EIGHT, FOUR]) assert.ok(edgeGap(view) < 1e-9);
});

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
const reversal = (turn) => {
	const animator = createSheetAnimator(sheetOf({ ...EIGHT, turn }), clipsOf());
	// The last frame of the settled walk north leads, so a change in the first frame is seen.
	return [
		drive(animator, () => 0, SETTLE_MS).at(-1),
		...drive(animator, () => Math.PI, 3000, { from: AFTER }),
	];
};
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
	// No wait for the facing rule's hold: 180° at 360° a second.
	const ms = sweeps({ blend: 0 }, SHEET_TURN_SPEED);
	assert.ok(Math.abs(ms - 500) <= 3 * FRAME_MS, `it took ${ms} ms`);
	const slow = sweeps({ speed: 90, blend: 0 }, 90);
	assert.ok(Math.abs(slow - 2000) <= 3 * FRAME_MS, `at 90° a second: ${slow} ms`);
	// A blend in hand keeps the heading at the edge of the next sector until it is done: the same
	// facings, no faster, each of the three in between drawn for the blend's time (a sector at
	// 360° a second is 125 ms, less than a blend), and half a sector at either end.
	const blended = sweeps(BLENDS, SHEET_TURN_SPEED);
	const whole = 125 + 3 * BLEND_MS;
	assert.ok(Math.abs(blended - whole) <= 3 * FRAME_MS, `blended, it took ${blended} ms`);
	// A sweep slower than the blend is not held.
	assert.equal(sweeps({ ...BLENDS, speed: 90 }, 90), slow);
	// And the default draws no blend: the same as `blend: 0`.
	assert.equal(sweeps({}, SHEET_TURN_SPEED), ms);
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
		// Within the 2° band a heading may go back past the edge it has crossed.
		for (const by of [0, 0.5, 1.5]) {
			const animator = createSheetAnimator(sheetOf(view), clipsOf());
			// Its first turn, from the facing it starts in, is over: up to four blended changes.
			const frames = drive(animator, jitter(edge, by), 4000).filter((f) => f.atMs > 1500);
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
	const view = { ...ISO_FOUR, turn: { speed: 0, lean: 45 } };
	const animator = createSheetAnimator(sheetOf(view), clipsOf());
	const options = { ...ISO_SCREEN, flattening: 2 };
	// North-east on the ground is the middle of `ne`; 10° past it leans towards `se`.
	const before = drive(animator, () => 55 * DEG, 1000, options).at(-1);
	assert.equal(before.facing, 'ne');
	// Tilted on the screen by its share of the half sector: 10° of 45°, of a most of 45°.
	assert.ok(Math.abs(before.frame.lean - 10 * DEG) < 1e-9, `it leans ${before.frame.lean / DEG}°`);
});

// ── 8. a rig, a still, a one-shot ────────────────────────────────────────────────────────────

check('a rig leans as a clip does, mirrored or not', () => {
	const rigs = PLAIN_RIGS;
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
	// Its heading has swept out of the north sector: the lean has eased back from 22.5°, and is
	// more than it will be a quarter turn away.
	const last = frames.at(-1).frame.lean / DEG;
	const quarter = (22.5 * (180 - 90)) / (180 - 22.5);
	assert.ok(last < 22.5 - 1e-6 && last >= quarter - 1e-9, `it leans ${last}°`);
	assert.ok(Math.max(...frames.map((f) => f.frame.lean)) <= 22.5 * DEG + 1e-9);
});

/** Only the south pictures are made, mirror off: every other facing is stood in for by `s`. */
const SOUTH_ONLY = new Set(ACTIONS.map((a) => `hero_${a.id}_s`));

/** A character heading north with a little noise, drawn by its south picture: the leans drawn,
 *  as `leanAt(heading)` has them. */
const oppositeLeans = (leanAt) => {
	const animator = createSheetAnimator(
		sheetOf({ kind: 'topDown', mirror: false, turn: { speed: 0 } }),
		clipsOf(SOUTH_ONLY),
	);
	const noisy = (ms) => (Math.round(ms / FRAME_MS) % 2 ? 0.5 : -0.5) * DEG;
	const frames = drive(animator, noisy, 2000).filter((f) => f.atMs > 600);
	assert.ok(frames.every((f) => f.frame.clipId === 'hero_walk_s'));
	const leans = frames.map((f) => leanAt(noisy(f.atMs), f.frame));
	const widest = Math.max(...leans.slice(1).map((lean, i) => Math.abs(lean - leans[i])));
	assert.ok(widest < 2 * DEG, `the lean steps ${widest / DEG}° between two frames`);
};

check('a picture opposite the heading does not flip from one side to the other', () => {
	oppositeLeans((heading, frame) => frame.lean);
	// And one a quarter turn away is steady, less than the lean.
	const animator = createSheetAnimator(
		sheetOf({ kind: 'topDown', mirror: false, turn: { speed: 0 } }),
		clipsOf(SOUTH_ONLY),
	);
	const { frame } = drive(animator, () => Math.PI / 2, 1000).at(-1);
	assert.ok(Math.abs(frame.lean + 45 * DEG * (2 / 3)) < 1e-9, `it leans ${frame.lean / DEG}°`);
});

// ── 9. the schema ────────────────────────────────────────────────────────────────────────────

const normalized = (view) => normalizeCharacterSheet({ view })?.view;

check(
	'the normalizer carries `turn`, sparse and in range, and its output comes back the same',
	() => {
		assert.deepEqual(normalized({ kind: 'topDown', facings: 8, turn: {} }), EIGHT);
		const defaults = { speed: 360, blend: CHARACTER_TURN_BLEND, pivot: 'middle' };
		assert.deepEqual(
			normalized({ kind: 'isometric', turn: { lean: 8, ...defaults } }),
			ISO_FOUR,
			'defaults are not stored',
		);
		assert.deepEqual(
			normalized({ kind: 'topDown', turn: { lean: 45, ...defaults } }),
			FOUR,
			'defaults are not stored: a top-down view leans half its sector',
		);
		assert.deepEqual(
			normalized({ kind: 'topDown', facings: 8, turn: { lean: 45 } }),
			EIGHT,
			'past half the sector is the half, a top-down view`s default',
		);
		// The half is not an isometric view's default, nor none a top-down one's: each is kept.
		assert.deepEqual(
			normalized({ kind: 'isometric', facings: 8, turn: { lean: 45 } }),
			ISO_EIGHT_LEANT,
		);
		assert.deepEqual(normalized({ kind: 'isometric', turn: { lean: 45 } }), ISO_FOUR_LEANT);
		assert.deepEqual(normalized({ kind: 'topDown', turn: { lean: 0 } }).turn, { lean: 0 });
		assert.deepEqual(normalized({ kind: 'isometric', turn: { lean: 0 } }).turn, { lean: 0 });
		assert.deepEqual(normalized({ kind: 'isometric', turn: { blend: 160, pivot: 'feet' } }).turn, {
			blend: 160,
			pivot: 'feet',
		});
		assert.deepEqual(normalized({ kind: 'topDown', turn: { blend: 1e9 } }).turn, {
			blend: CHARACTER_TURN_BLEND_MAX,
		});
		assert.deepEqual(normalized({ kind: 'topDown', turn: { blend: -40, pivot: 'head' } }).turn, {});
		assert.deepEqual(normalized({ kind: 'topDown', turn: { blend: 'x', pivot: 1 } }).turn, {});
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
		for (const view of [
			EIGHT,
			ISO_EIGHT_LEANT,
			{ kind: 'topDown', turn: { lean: 30, speed: 0, blend: 300, pivot: 'feet' } },
		])
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
	assert.equal(SHEET_TURN_BLEND, CHARACTER_TURN_BLEND);
	assert.equal(SHEET_TURN_ISO_LEAN, CHARACTER_TURN_ISO_LEAN);
	for (const view of [
		EIGHT,
		FOUR,
		ISO_EIGHT,
		ISO_FOUR,
		ISO_EIGHT_LEANT,
		{ ...ISO_FOUR, turn: { lean: 12, speed: 90, blend: 40, pivot: 'feet' } },
		{ ...EIGHT, turn: { blend: 0, pivot: 'middle' } },
	]) {
		const read = characterTurnOf(view);
		const drawn = sheetTurnOf(view);
		assert.ok(Math.abs(drawn.lean - read.lean * DEG) < 1e-12);
		assert.ok(Math.abs(drawn.speed - read.speed * DEG) < 1e-12);
		assert.ok(Math.abs(drawn.sector - read.sector * DEG) < 1e-12);
		assert.equal(drawn.blend, read.blend);
		assert.equal(drawn.feet, read.pivot === 'feet');
	}
	assert.equal(characterTurnOf({ kind: 'topDown' }), undefined);
	assert.equal(characterTurnOf({ kind: 'side' }), undefined);
});

/** What a saved `turn: {}` is read as: by the config, and by the animator (radians). */
const savedDefaults = (leanOf) => {
	for (const [kind, facings, sector] of [
		['topDown', 8, 45],
		['topDown', undefined, 90],
		['isometric', 8, 45],
		['isometric', undefined, 90],
	]) {
		const saved = { kind, ...(facings ? { facings } : {}), turn: {} };
		const { view } = normalizeCharacterSheet({ view: saved });
		assert.deepEqual(view, saved, 'it stays `{}`');
		const lean = leanOf(kind, sector);
		assert.equal(characterTurnLean(view), lean);
		assert.deepEqual(characterTurnOf(view), {
			blend: 0,
			lean,
			pivot: 'middle',
			speed: 360,
			sector,
		});
		assert.deepEqual(sheetTurnOf(view), {
			sector: sector * DEG,
			lean: lean * DEG,
			speed: 360 * DEG,
			blend: 0,
			feet: false,
		});
	}
};

check('a saved `turn: {}` stays `{}` and is read at the defaults of its kind of view', () => {
	// Seen from above a picture leans half its sector; isometric, the 8° picked by eye. No blend.
	savedDefaults((kind, sector) => (kind === 'isometric' ? 8 : sector / 2));
	assert.equal(CHARACTER_TURN_BLEND, 0);
	assert.equal(CHARACTER_TURN_ISO_LEAN, 8);
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
		assert.deepEqual(issuesOf({ kind: 'isometric', turn: { blend: 0, pivot: 'feet' } }), []);
		assert.deepEqual(issuesOf({ kind: 'isometric', turn: { blend: 1000, pivot: 'middle' } }), []);
		const [blend] = issuesOf({ kind: 'topDown', turn: { blend: 1001 } });
		assert.equal(blend.severity, 'warning');
		assert.equal(blend.path, 'arcade.characters[0].view.turn.blend');
		assert.match(blend.message, /0 to 1000 ms.*read as 1000/);
		const [pivot] = issuesOf({ kind: 'topDown', turn: { pivot: 'head' } });
		assert.equal(pivot.path, 'arcade.characters[0].view.turn.pivot');
		assert.match(pivot.message, /middle or its feet.*read as middle/);
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
		// Two more walks, for a blend: one twice as long as `hero_walk_e`, one as long.
		{
			id: 'hero_walk_n',
			name: 'walk',
			assetKey: SHEET_KEY,
			frames: ['w0', 'w1', 'w2', 'w0', 'w1', 'w2'],
			fps: 12,
		},
		{ id: 'hero_walk_s', name: 'walk', assetKey: SHEET_KEY, frames: ['w2', 'w1', 'w0'], fps: 12 },
	]);
	const assets = {
		[`${SHEET_KEY}::w0`]: walk[0],
		[`${SHEET_KEY}::w1`]: walk[1],
		[`${SHEET_KEY}::w2`]: walk[2],
		// The bare name of another sheet: the scoped one wins.
		w0: still,
		still,
	};
	const app = { loaded: true };
	const look = createSheetClipLook({ assets: () => assets, loaded: () => app.loaded });
	const into = new Container();
	const unmount = look.mount(into);
	// The mount holds the look's root, and the root its sprite: one, until two clips are faded.
	assert.equal(into.children.length, 1);
	const [root] = into.children;
	assert.ok(root instanceof Container);
	assert.equal(root.children.length, 1);
	return { look, into, root, unmount, assets, app, walk, still, sprite: root.children[0] };
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
/** Where a point `up` px above the feet is drawn, from the character's place (x right, y down). */
const headOf = (sprite, up = 10) => {
	sprite.updateLocalTransform();
	// Local px: the head is up the texture from the anchor, whatever the scale.
	return sprite.localTransform.apply({ x: 0, y: -up / Math.abs(sprite.scale.y) });
};

check('it is the sprite `SpawnLayer` draws: frames, Bounds box, speed, loop, anchor, width', () => {
	const { look, root, sprite, walk } = stage();
	assert.equal(sprite.visible, false, 'nothing is drawn before its first frame');
	look.frame(published(), UPRIGHT);
	assert.equal(sprite.visible, true);
	assert.ok(root.children.length === 1 && root.children[0] === sprite, 'it has one sprite');
	assert.deepEqual([sprite.x, sprite.y, sprite.alpha], [0, 0, 1]);
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
			blend: undefined,
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

/** The sheet `published()` is of, turning: 120 wide, its feet 0.9 down its box of 80 by 100. */
const turningSheet = (turn) => ({
	...sheetOf({ ...EIGHT, turn }),
	draw: { width: 120, feet: 0.9 },
});
const CLIP_BOX = { w: 80, h: 100 };
const near = (a, b) => Math.abs(a - b) < 1e-9;
/** `actual` is the very objects of `expected`, in order. (Not `deepEqual`: a failure would print
 *  two display objects whole.) */
const same = (actual, expected, message) =>
	assert.ok(
		actual.length === expected.length && actual.every((item, i) => item === expected[i]),
		message,
	);

/**
 * The look leans a clip about the point `pivot` px above its place when it is handed `about`
 * (left out ⇒ handed none: its place, the feet).
 */
const leansAbout = (rotationOf, about, pivot = about ?? 0) => {
	const { look, sprite } = stage();
	for (const flipX of [false, true]) {
		for (const lean of [20 * DEG, -20 * DEG]) {
			look.frame(published({ flipX }), {
				lean,
				marked: false,
				...(about === undefined ? {} : { about }),
			});
			sprite.rotation = rotationOf(sprite);
			assert.equal(sprite.scale.x < 0, flipX);
			if (!pivot) assert.deepEqual([sprite.x, sprite.y], [0, 0], 'the feet stay on the place');
			// The pivot stays where it is, and the feet, the head and a point above the pivot go
			// where a point of the body does (`leanedPoint`), mirrored or not.
			for (const up of [pivot, 0, 10, pivot + 25]) {
				const drawn = headOf(sprite, up);
				const turned = leanedPoint({ dx: 0, lift: up }, lean, pivot);
				assert.ok(near(drawn.x, turned.dx) && near(-drawn.y, turned.lift), `${up} px up`);
			}
			const held = headOf(sprite, pivot);
			assert.ok(near(held.x, 0) && near(-held.y, pivot), 'the pivot does not move');
			assert.equal(look.drawn().lean, sprite.rotation);
		}
	}
	look.destroy();
};
check('pivot feet: it leans about the feet, the same way mirrored, clockwise to the right', () => {
	assert.equal(sheetLeanPivot(turningSheet({ pivot: 'feet' }), CLIP_BOX), 0);
	leansAbout((sprite) => sprite.rotation);
	leansAbout((sprite) => sprite.rotation, 0);
});
check('pivot middle, the default: it leans about the middle of its box, mirrored or not', () => {
	// The box is drawn 150 high with its feet 0.9 down it: its middle is 60 above them.
	const about = sheetLeanPivot(turningSheet({}), CLIP_BOX);
	assert.ok(near(about, 60));
	leansAbout((sprite) => sprite.rotation, about);
});

const pivots = (pivotOf) => {
	const box = CLIP_BOX;
	for (const kind of ['topDown', 'isometric'])
		for (const [turn, middle] of [
			[{}, true],
			[{ pivot: 'middle' }, true],
			[{ lean: 10, speed: 0, blend: 0 }, true],
			[{ pivot: 'feet' }, false],
		]) {
			const sheet = { ...turningSheet(turn), view: { kind, facings: 8, turn } };
			const { middle: height } = sheetClipPoints(sheet, box, false);
			assert.ok(near(height, 60));
			assert.equal(pivotOf(sheet, box), middle ? height : 0, `${kind} ${JSON.stringify(turn)}`);
		}
	// A box of another shape, and feet at the bottom of it: half its drawn height.
	const tall = { ...turningSheet({}), draw: { width: 64 } };
	assert.ok(near(pivotOf(tall, { w: 40, h: 100 }), 80));
	// A sheet that does not turn leans about nothing.
	assert.equal(pivotOf(sheetOf({ kind: 'topDown', facings: 8 }), box), 0);
	assert.equal(pivotOf(sheetOf({ kind: 'side', turn: {} }), box), 0);
	assert.equal(pivotOf(sheetOf(undefined), box), 0);
};
check('a sheet`s pivot is the middle of its box, its feet when its turn says so', () => {
	pivots(sheetLeanPivot);
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
	const { look, sprite, assets, app, walk } = stage();
	const late = assets[`${SHEET_KEY}::w0`];
	delete assets[`${SHEET_KEY}::w0`];
	delete assets.w0;
	app.loaded = false;
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
		// While the app loads, a frame not there yet is no error.
		assert.equal(sprite.totalFrames, 2);
		assert.equal(errors.length, 0);
		app.loaded = true;
		look.frame(published(), UPRIGHT);
		look.frame(published(), UPRIGHT);
		// Once it has, a frame missing from a clip that is drawn plays short, and says so once.
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
	const { look, root, sprite, into, unmount, walk, still } = stage();
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
	assert.equal(root.destroyed, true);
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

// ── 11. the blend ────────────────────────────────────────────────────────────────────────────

/** The weights of a blend, all the way through it: how much of the picture taken is drawn
 *  (`weightOf(progress)`) and the opacity of each picture of a cross-fade (`alphasOf(weight)`). */
const weights = (weightOf, alphasOf) => {
	let last = 0;
	for (let i = 0; i <= 1000; i++) {
		const progress = i / 1000;
		const weight = weightOf(progress);
		assert.ok(weight >= 0 && weight <= 1, `weight ${weight}`);
		assert.ok(i === 0 || weight > last, `it never goes back (at ${progress})`);
		last = weight;
		// The picture left has the rest, and a blend turned back at `progress` goes on from
		// `1 - progress` at the weights it had: the two are 1 together.
		assert.ok(Math.abs(weight + weightOf(1 - progress) - 1) < 1e-12, `turned back at ${progress}`);
		const { from, to } = alphasOf(weight);
		assert.ok(from >= 0 && from <= 1 && to >= 0 && to <= 1);
		// Where both pictures have paint the character is never seen through.
		assert.ok(Math.abs(to + (1 - to) * from - 1) < 1e-12, `seen through at ${progress}`);
	}
	assert.deepEqual([weightOf(0), weightOf(1), weightOf(-3), weightOf(4)], [0, 1, 0, 1]);
	assert.deepEqual(alphasOf(0), { from: 1, to: 0 });
	assert.deepEqual(alphasOf(1), { from: 0, to: 1 });
	assert.deepEqual(alphasOf(0.5), { from: 1, to: 1 });
	assert.deepEqual([alphasOf(-1), alphasOf(2)], [alphasOf(0), alphasOf(1)]);
};

check(
	'a blend goes from 0 to 1 and never back, its two weights 1 together, never seen through',
	() => {
		weights(blendWeight, fadeAlphas);
	},
);

/**
 * A character walking north turns north-east: the frames from then on, the ones that carry a
 * blend and the frame the picture changed in.
 */
const turnOf = (turn, heading = 45 * DEG) => {
	const animator = createSheetAnimator(sheetOf({ ...EIGHT, turn }), clipsOf());
	// The last frame of the settled walk north leads, so a change in the first frame is seen.
	const frames = [
		drive(animator, () => 0, SETTLE_MS).at(-1),
		...drive(animator, () => heading, 1500, { from: AFTER }),
	];
	const [start, ...more] = changesOf(frames);
	assert.ok(start !== undefined && more.length === 0, 'its picture changes once');
	return { frames, start, run: frames.filter((f) => f.frame.blend) };
};

/** The blend of one change of facing of a loop, frame by frame, as `shareOf` and `leftOf` say it
 *  should be `ms` into a blend `blend` ms long. */
const blendsOver = (turn, blend, shareOf = blendWeight, leftOf = (ms) => blend - ms) => {
	const { frames, start, run } = turnOf(turn);
	// It is carried from the frame the picture changes in, on every frame until it is done.
	assert.deepEqual(
		run.map((f) => f.atMs),
		frames.slice(start, start + run.length).map((f) => f.atMs),
	);
	assert.equal(run.length, Math.ceil(blend / FRAME_MS), `${run.length} frames of blend`);
	let last = -1;
	for (const { atMs, frame } of run) {
		const ms = atMs - frames[start].atMs;
		assert.equal(frame.clipId, 'hero_walk_ne');
		const { from, weight, leftMs, pose } = frame.blend;
		// The picture left, as it would be drawn: its own lean, no blend of its own.
		assert.deepEqual({ ...from, lean: undefined }, { ...frames[start - 1].frame, lean: undefined });
		assert.ok(typeof from.lean === 'number' && !Object.hasOwn(from, 'blend'));
		assert.ok(weight > last && weight >= 0 && weight < 1, `the weight rises (${weight})`);
		last = weight;
		assert.ok(Math.abs(weight - shareOf(ms / blend)) < 1e-12, `${ms} ms in: ${weight}`);
		assert.ok(Math.abs(leftMs - leftOf(ms)) < 1e-9, `${ms} ms in: ${leftMs} ms left`);
		assert.equal(pose, false, 'two clips are two pictures');
	}
	assert.equal(run[0].frame.blend.weight, 0, 'it starts as the picture left');
	// Done within its time, and then the frame is the picture's own.
	assert.ok(run.at(-1).atMs - run[0].atMs < blend);
	const after = frames.slice(start + run.length);
	assert.ok(after.length > 10 && after.every((f) => !Object.hasOwn(f.frame, 'blend')));
};

check('a loop whose facing changes carries a blend that rises to done within `blend` ms', () => {
	blendsOver(BLENDS, BLEND_MS);
	blendsOver({ blend: 400 }, 400);
	blendsOver({ blend: 50, speed: 0 }, 50);
});

const neverBlends = (turn) => {
	for (const view of [EIGHT, FOUR, ISO_EIGHT]) {
		const sheet = sheetOf({ ...view, turn: { ...view.turn, ...turn } });
		const options = view.kind === 'isometric' ? ISO_SCREEN : {};
		const path = (ms) => (ms < 4000 ? circling(90)(ms) : ms < 5500 ? Math.PI : undefined);
		const frames = drive(createSheetAnimator(sheet, clipsOf()), path, 6500, options);
		assert.ok(changesOf(frames).length >= 4, 'its picture changes');
		assert.ok(frames.every((f) => f.frame && !Object.hasOwn(f.frame, 'blend')));
		const rig = { ...sheet, source: { kind: 'rig', rig: 'hero' } };
		const posed = drive(createSheetRigAnimator(rig, PLAIN_RIGS), path, 6500, options);
		assert.ok(posed.every((f) => f.frame && !Object.hasOwn(f.frame, 'blend')));
	}
};
check('`blend: 0` and the default: the picture changes at once, no frame carries a blend', () => {
	neverBlends({ blend: 0 });
	neverBlends({});
	assert.equal(sheetTurnOf({ ...EIGHT, turn: { blend: 0 } }).blend, 0);
	assert.equal(sheetTurnOf({ ...EIGHT, turn: { blend: -5 } }).blend, 0);
});

/**
 * A blend turned back half way: north, north-east for `outMs`, north again. The share of the
 * north picture drawn must go on from where it was, as `jumpOf` reads it across the turn back.
 */
const turnedBack = (jumpOf) => {
	const BLEND = 1000;
	for (const outMs of [400, 560, 800]) {
		const animator = settled({ ...EIGHT, turn: { blend: BLEND } });
		const out = drive(animator, () => 45 * DEG, outMs, { from: AFTER });
		const home = drive(animator, () => 0, 2500, { from: AFTER + outMs + FRAME_MS });
		const frames = [...out, ...home];
		const [first, back, ...more] = changesOf(frames);
		assert.ok(back > out.length && more.length === 0, 'it turns out and back');
		const before = frames[back - 1].frame;
		const { frame } = frames[back];
		assert.equal(before.clipId, 'hero_walk_ne');
		assert.equal(before.blend.from.clipId, 'hero_walk_n');
		assert.ok(
			before.blend.weight > 0.05 && before.blend.weight < 0.95,
			'it is turned back mid-way',
		);
		// Now the north picture is the frame's and the north-east one the picture left.
		assert.equal(frame.clipId, 'hero_walk_n');
		assert.equal(frame.blend.from.clipId, 'hero_walk_ne');
		// North had `1 - weight` of the frame before: it has that now, give or take the most a
		// frame of blend changes a weight by (the ease is steepest half way, 1.5 over its time).
		const most = (1.5 * FRAME_MS) / BLEND + 1e-9;
		const jump = Math.abs(jumpOf(frame.blend.weight, before.blend.weight));
		assert.ok(jump <= most, `north's share jumps ${jump} (out ${outMs} ms)`);
		// And it goes on to its end over what was left of it, not the whole time again.
		const run = frames.slice(back).filter((f) => f.frame.blend);
		const gone = (frames[back - 1].atMs - frames[first].atMs + FRAME_MS) / BLEND;
		assert.ok(Math.abs(run.length * FRAME_MS - gone * BLEND) <= FRAME_MS, `${run.length} frames`);
		assert.ok(Math.abs(frame.blend.leftMs - gone * BLEND) < 1e-6);
		run.forEach((f, i) =>
			assert.ok(i === 0 || f.frame.blend.weight > run[i - 1].frame.blend.weight),
		);
		assert.ok(run.every((f) => f.frame.blend.from.clipId === 'hero_walk_ne'));
		assert.ok(!Object.hasOwn(frames.at(-1).frame, 'blend'));
	}
};
check('a blend turned back mid-way goes on from the weights it had: no jump', () => {
	turnedBack((weight, before) => weight - (1 - before));
});

/** An about-turn's sweep, blended: every change of picture as `[the frame before, the frame]`. */
const sweepBlends = (turn, blend, wholeOf) => {
	const frames = reversal(turn);
	const changes = changesOf(frames);
	assert.deepEqual(
		[frames[0], ...changes.map((i) => frames[i])].map((f) => f.frame.clipId.slice(-2)),
		['_n', 'ne', '_e', 'se', '_s'],
	);
	// A blend's last frame: the one before it would be done.
	const whole = blendWeight(1 - FRAME_MS / blend) - 1e-9;
	changes.forEach((at, i) => {
		const { frame } = frames[at];
		const before = frames[at - 1].frame;
		assert.ok(frame.blend, `change ${i} is blended`);
		assert.equal(frame.blend.weight, 0);
		// Never a third picture: the blend before it had run to its end, and this one is of the
		// picture just drawn and the frame's.
		assert.ok(
			wholeOf(before.blend) >= whole,
			`change ${i} cuts a blend at ${before.blend?.weight}`,
		);
		assert.equal(pictureOf(frame.blend.from), pictureOf(before));
		assert.ok(!Object.hasOwn(frame.blend.from, 'blend'));
		const until = changes[i + 1] ?? frames.length;
		const run = frames.slice(at, until).filter((f) => f.frame.blend);
		assert.ok(run.every((f) => pictureOf(f.frame.blend.from) === pictureOf(before)));
		assert.ok(wholeOf(run.at(-1).frame.blend) >= whole, `blend ${i} runs to its end`);
		assert.ok(run.length >= Math.ceil(blend / FRAME_MS));
	});
	assert.ok(!Object.hasOwn(frames.at(-1).frame, 'blend'));
};
check('a reversal`s sweep blends each step whole, never a third picture', () => {
	const wholeOf = (left) => left?.weight ?? 1;
	sweepBlends(BLENDS, BLEND_MS, wholeOf);
	sweepBlends({ blend: 400 }, 400, wholeOf);
	sweepBlends({ blend: 300, speed: 1440 }, 300, wholeOf);
	sweepBlends({ blend: 60, speed: 90 }, 60, wholeOf);
});

/** The frames from when a walk north is cut by `cut(animator)`, heading east from then on. */
const cutBy = (cut, actions = ACTIONS, heading = Math.PI / 2) => {
	const animator = createSheetAnimator(
		{ ...sheetOf({ ...EIGHT, turn: BLENDS }), actions },
		clipsOf(),
	);
	drive(animator, () => 0, SETTLE_MS);
	cut(animator);
	return drive(animator, () => heading, 1500, { from: AFTER });
};

const onceKeeps = (blendOf) => {
	// An about-turn: the sweep is still on its way when the one-shot ends.
	const frames = cutBy((animator) => animator.raise({ ability: 'ability1' }), ACTIONS, Math.PI);
	const hop = frames.filter((f) => f.frame.action === 'hop');
	assert.ok(hop.length >= 15, 'the one-shot plays');
	for (const { frame } of hop) {
		assert.equal(frame.clipId, 'hero_hop_n', 'in the facing it started in');
		assert.equal(frame.loop, false);
		assert.equal(blendOf(frame), false);
	}
	// The heading swept on under it: the loop comes back in another facing, and that is not a
	// change of facing of a loop. The next one is.
	const back = frames[hop.length].frame;
	assert.equal(back.action, 'walk');
	assert.notEqual(back.clipId, 'hero_walk_n');
	assert.equal(blendOf(back), false, 'the loop comes back unblended');
	assert.ok(frames.slice(hop.length).some((f) => f.frame.blend));
};
check(
	'an action played once keeps its picture: no blend on it, nor when the loop comes back',
	() => {
		onceKeeps((frame) => Object.hasOwn(frame, 'blend'));
	},
);

const HELD = ACTIONS.map((action) => (action.id === 'walk' ? { ...action, play: 'hold' } : action));
const holdKeeps = (blendOf) => {
	const frames = cutBy(() => {}, HELD);
	const [first] = frames;
	assert.equal(first.frame.action, 'walk');
	for (const { frame } of frames) {
		assert.equal(frame.clipId, first.frame.clipId, 'in the facing it started in');
		assert.deepEqual([frame.loop, frame.play], [false, first.frame.play]);
		assert.equal(blendOf(frame), false);
	}
	// The lean still follows the heading: it is the blend a hold does not take.
	assert.ok(frames.some((f) => Math.abs(f.frame.lean - first.frame.lean) > 1 * DEG));
};
check('a hold keeps its picture while the heading turns: no blend on it', () => {
	holdKeeps((frame) => Object.hasOwn(frame, 'blend'));
});

/** A sheet whose `carry` loop is in force while the status `holding` holds, over the walk. */
const CARRYING = [...ACTIONS, { id: 'carry', when: { status: 'holding' } }];
const CARRY_CLIPS = new Set([...EVERY, ...CLIP_FACINGS.map((facing) => `hero_carry_${facing}`)]);
/** North, then east at once (speed 0): the frame the facing changes in, the status `holding`
 *  starting in that same frame when `carried`. */
const facingChange = (carried, at) => {
	const sheet = { ...sheetOf({ ...EIGHT, turn: { ...BLENDS, speed: 0 } }), actions: CARRYING };
	const animator = createSheetAnimator(sheet, clipsOf(CARRY_CLIPS));
	const frames = [drive(animator, () => 0, SETTLE_MS).at(-1)];
	for (let atMs = AFTER; atMs <= AFTER + 600; atMs += FRAME_MS) {
		const statuses = carried && atMs >= at ? ['holding'] : [];
		frames.push({ atMs, frame: animator.frame({ atMs, ...flat(Math.PI / 2), statuses }) });
	}
	return frames;
};
const actionChange = (blendOf) => {
	const plain = facingChange(false);
	const [at] = changesOf(plain);
	assert.equal(plain[at].frame.clipId, 'hero_walk_e');
	assert.equal(plain[at].frame.blend.from.clipId, 'hero_walk_n', 'the same action is blended');
	const { frame } = facingChange(true, plain[at].atMs)[at];
	assert.equal(frame.clipId, 'hero_carry_e');
	assert.equal(blendOf(frame), false, 'another action changes at once');
};
check('a change of action is not blended, even in the frame the facing changes', () => {
	actionChange((frame) => Object.hasOwn(frame, 'blend'));
});

const resetEnds = (blendOf) => {
	const animator = settled({ ...EIGHT, turn: { blend: 1000 } });
	const out = drive(animator, () => 45 * DEG, 500, { from: AFTER });
	assert.ok(out.at(-1).frame.blend.weight > 0.05, 'a blend is in hand');
	animator.reset();
	const after = drive(animator, () => 45 * DEG, 300, { from: AFTER + 500 + FRAME_MS });
	assert.ok(after.every((f) => f.frame.clipId === 'hero_walk_ne' && !blendOf(f.frame)));
	// And a character that stops drawing (no loop) and starts again starts unblended.
	const again = settled({ ...EIGHT, turn: { blend: 1000 } });
	again.reset();
	const [first] = drive(again, () => Math.PI, 0, { from: AFTER });
	assert.equal(blendOf(first.frame), false);
};
check('`reset` ends a blend in hand', () => {
	resetEnds((frame) => Object.hasOwn(frame, 'blend'));
});

const keepsPhase = (kept, frameOf) => {
	for (const length of [0.6, 1, 2.5])
		for (const time of [0, 0.2, 0.59, 1.3, 7.75]) {
			const phase = (time % length) / length;
			// Into a cycle as long it is the same time; else the same share of the other's length.
			assert.ok(Math.abs(kept(time, length, length) - (time % length)) < 1e-12);
			for (const into of [0.4, 1, 3]) {
				const at = kept(time, length, into);
				assert.ok(at >= 0 && at < into);
				assert.ok(Math.abs(at / into - phase) < 1e-12, `${time} of ${length} into ${into}`);
			}
		}
	assert.ok(Math.abs(kept(-0.25, 1, 2) - 1.5) < 1e-12, 'a time before 0 is in the cycle before');
	assert.deepEqual([kept(3, 0, 2), kept(3, 2, 0), kept(3, -1, 2)], [0, 0, 0]);
	for (let count = 1; count <= 12; count++)
		for (let frame = 0; frame < count; frame++) {
			assert.equal(frameOf(frame, count, count), frame, `frame ${frame} of ${count}`);
			for (let into = 1; into <= 24; into++) {
				const at = frameOf(frame, count, into);
				assert.ok(Number.isInteger(at) && at >= 0 && at < into);
				assert.ok(Math.abs(at - (frame * into) / count) < 1, `${frame}/${count} into ${into}`);
				if (into % count === 0) assert.equal(at, (frame * into) / count);
			}
		}
	assert.deepEqual(
		[frameOf(2, 4, 8), frameOf(3, 6, 3), frameOf(5, 6, 2), frameOf(7, 3, 3), frameOf(2, 3, 0)],
		[4, 1, 1, 1, 0],
	);
};
check(
	'a cycle is carried on at its phase: the same frame of a clip as long, else its share',
	() => {
		keepsPhase(phaseKept, frameKept);
	},
);

// ── 12. the looks that draw a blend ──────────────────────────────────────────────────────────

/** A clip look half way from one walk to another: `to` is the frame's clip, `from` the one left. */
const fadeTo = (look, to, from, weight, turn = UPRIGHT) =>
	look.frame(published({ clipId: to }), {
		...turn,
		blend: { clip: published({ clipId: from }), turn: { lean: -(turn.lean ?? 0) }, weight },
	});

const clipFades = (startOf) => {
	const { look, root, sprite: first } = stage();
	look.frame(published(), UPRIGHT);
	first.currentFrame = 2;
	// Three frames into six: the clip taken starts at the frame the one left has reached.
	fadeTo(look, 'hero_walk_n', 'hero_walk_e', 0.25, { lean: 0.2, marked: false });
	assert.equal(root.children.length, 2, 'a second sprite, for the fade');
	const [back, front] = root.children;
	assert.equal(back, first, 'the sprite of the clip left goes behind, and plays on');
	assert.deepEqual([back.currentFrame, back.playing, back.visible], [2, true, true]);
	assert.equal(front.totalFrames, 6);
	assert.equal(front.currentFrame, startOf(2, 3, 6));
	assert.deepEqual([front.playing, front.loop, front.visible], [true, true, true]);
	assert.deepEqual([front.alpha, back.alpha], [0.5, 1]);
	assert.deepEqual([front.rotation, back.rotation], [0.2, -0.2], 'each at its own lean');
	assert.deepEqual(look.drawn().blend, {
		from: 'hero_walk_e',
		alpha: fadeAlphas(0.25),
		frame: { from: 2, to: startOf(2, 3, 6) },
	});
	assert.equal(look.drawn().clipId, 'hero_walk_n');
	// Further on neither starts again, and the alphas are the fade's.
	front.currentFrame = 5;
	fadeTo(look, 'hero_walk_n', 'hero_walk_e', 0.75);
	assert.deepEqual([front.currentFrame, back.currentFrame], [5, 2]);
	assert.deepEqual([front.alpha, back.alpha], [1, 0.5]);
	// Turned back: the two change places, and neither starts again.
	fadeTo(look, 'hero_walk_e', 'hero_walk_n', 0.25);
	same(root.children, [front, back], 'the two sprites change places');
	assert.deepEqual([front.currentFrame, back.currentFrame], [5, 2]);
	assert.deepEqual([back.alpha, front.alpha], [0.5, 1]);
	assert.deepEqual(look.drawn().blend, {
		from: 'hero_walk_n',
		alpha: fadeAlphas(0.25),
		frame: { from: 5, to: 2 },
	});
	// Done: one clip, opaque; the other is not drawn.
	look.frame(published(), UPRIGHT);
	assert.deepEqual([back.visible, back.alpha, front.visible], [true, 1, false]);
	assert.equal(look.drawn().blend, undefined);
	assert.equal(root.children.length, 2);
	// A clip as long is taken at the same frame, from a sprite the look already has.
	back.currentFrame = 1;
	fadeTo(look, 'hero_walk_s', 'hero_walk_e', 0);
	same(root.children, [back, front], 'the two sprites change places again');
	assert.deepEqual([front.totalFrames, front.currentFrame], [3, startOf(1, 3, 3)]);
	assert.deepEqual([front.alpha, back.alpha], [0, 1]);
	look.destroy();
	assert.ok(front.destroyed && back.destroyed && root.destroyed);
};
/** A clip look with no blend handed a change of clip: `kept` carries the frame reached on. */
const clipKept = (turnOf, timeOf = (sprite) => sprite._currentTime) => {
	const { look, sprite } = stage();
	look.frame(published(), UPRIGHT);
	// Six tenths of the way through its third frame.
	sprite._currentTime = 2.6;
	look.frame(published({ clipId: 'hero_walk_s' }), turnOf({ ...UPRIGHT, kept: true }));
	assert.equal(look.drawn().clipId, 'hero_walk_s');
	assert.equal(sprite.currentFrame, 2, 'the same frame of a clip as long');
	assert.ok(Math.abs(timeOf(sprite) - 2.6) < 1e-9, `as far into it: ${timeOf(sprite)}`);
	assert.equal(look.drawn().blend, undefined);
	sprite.currentFrame = 1;
	look.frame(published({ clipId: 'hero_walk_n' }), turnOf({ ...UPRIGHT, kept: true }));
	assert.equal(sprite.currentFrame, frameKept(1, 3, 6), 'its share of one twice as long');
	// Not kept (a change of action, a sheet without the turn): it starts again.
	look.frame(published(), UPRIGHT);
	assert.equal(sprite.currentFrame, 0);
	look.destroy();
};
check('the clip look with no blend: a kept change of clip carries the cycle on', () => {
	clipKept((turn) => turn);
});

check(
	'the clip look cross-fades two sprites, the clip taken at the frame the other reached',
	() => {
		clipFades(frameKept);
	},
);

// The rig look reads `pixi-svelte` for the scale a rig was loaded at (1 here: the fixture is made
// in place), and the rig runtime is TypeScript that Node's type stripping does not take
// (parameter properties): it is transformed as it is loaded.
registerHooks({
	resolve: (specifier, context, next) =>
		specifier === 'pixi-svelte'
			? {
					url: 'data:text/javascript,export const getRigLoadScale = () => 1;',
					shortCircuit: true,
				}
			: next(specifier, context),
	load: (url, context, next) =>
		url.includes('/packages/engine-rig/') && url.endsWith('.ts')
			? {
					format: 'module',
					shortCircuit: true,
					source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), {
						mode: 'transform',
					}),
				}
			: next(url, context),
});
const RIG = await import('../packages/engine-rig/pixi.ts');
const { createSheetRigLook, rigPoseMixes } =
	await import('../packages/engine-layout/src/lib/sheetRigLook.ts');

/** The facings a rig's artist draws: the western three are their twins mirrored. */
const RIG_MADE = ['n', 'ne', 'e', 'se', 's'];
/** How long each walk of the fixture rig is, seconds: no two alike, so a phase is not a time. */
const RIG_WALKS = { walk_n: 1, walk_ne: 2, walk_e: 1.5, walk_se: 0.8, walk_s: 1.2 };
/**
 * A rig of one slot and two drawings of its body: `walk_n` and `walk_ne` draw the one it is set
 * up in and key no attachment, `walk_s` keys that same one, `walk_e` and `walk_se` key the
 * other. Its Bounds box is off its origin, so a placement is not a no-op.
 */
const RIG_DATA = (() => {
	const atlas = new RIG.TextureAtlas(
		[
			'hero.png',
			'size: 64,32',
			'filter: Linear,Linear',
			'front',
			'bounds: 0,0,32,32',
			'side',
			'bounds: 32,0,32,32',
			'',
		].join('\n'),
	);
	atlas.pages[0].setTexture(RIG.RigPageTexture.from(new TextureSource({ width: 64, height: 32 })));
	const swing = (seconds) => ({
		bones: {
			arm: {
				rotate: [{ value: 0 }, { time: seconds / 2, value: 60 }, { time: seconds, value: 0 }],
			},
		},
	});
	const showing = (name, seconds) => ({
		...swing(seconds),
		slots: { body: { attachment: [{ name }] } },
	});
	return new RIG.SkeletonJson(new RIG.AtlasAttachmentLoader(atlas)).readSkeletonData({
		skeleton: { spine: '4.2.0', x: -10, y: -8, width: 40, height: 80 },
		bones: [{ name: 'root' }, { name: 'arm', parent: 'root', x: 6, y: 40 }],
		slots: [{ name: 'body', bone: 'arm', attachment: 'front' }],
		skins: [
			{
				name: 'default',
				attachments: {
					body: { front: { width: 32, height: 32 }, side: { width: 32, height: 32 } },
				},
			},
		],
		animations: {
			walk_n: swing(RIG_WALKS.walk_n),
			walk_ne: swing(RIG_WALKS.walk_ne),
			walk_e: showing('side', RIG_WALKS.walk_e),
			walk_se: showing('side', RIG_WALKS.walk_se),
			walk_s: showing('front', RIG_WALKS.walk_s),
		},
	});
})();
/** The rig's Bounds box in its own px, y down, and its place (the feet) in it. */
const RIG_BOX = { x: -10, y: -72, w: 40, h: 80 };
const RIG_SOURCE = {
	has: (rig, animation) => rig === 'hero' && !!RIG_DATA.findAnimation(animation),
	durationMs: (rig, animation) => (RIG_DATA.findAnimation(animation)?.duration ?? 0) * 1000,
};
/** A sheet that draws the rig 64 wide, its feet 0.9 down its box, an animation a facing. */
const rigSheet = (turn) => ({
	view: { ...EIGHT, turn },
	source: { kind: 'rig', rig: 'hero' },
	draw: { width: 64, feet: 0.9, bones: { hand: 'arm' } },
	actions: [
		{
			id: 'walk',
			when: [{ motion: 'moving' }, { motion: 'still' }],
			anim: Object.fromEntries(RIG_MADE.map((f) => [f, { anim: `walk_${f}` }])),
		},
	],
});

check('two animations of a rig are one pose only when they draw the same parts', () => {
	for (const [a, b, mixes] of [
		['walk_n', 'walk_ne', true],
		['walk_e', 'walk_se', true],
		// One keys the drawing the other is set up in: the same parts.
		['walk_n', 'walk_s', true],
		['walk_n', 'walk_n', true],
		['walk_n', 'walk_e', false],
		['walk_ne', 'walk_se', false],
		['walk_s', 'walk_e', false],
		['walk_n', 'walk_w', false],
	]) {
		assert.equal(rigPoseMixes(RIG_DATA, a, b), mixes, `${a} and ${b}`);
		assert.equal(rigPoseMixes(RIG_DATA, b, a), mixes, `${b} and ${a}`);
	}
});

/** A rig look of `sheet` on a mount, with its animator. */
const rigStage = (sheet, facing = 'n') => {
	const animator = createSheetRigAnimator(sheet, RIG_SOURCE, facing);
	const look = createSheetRigLook('hero', RIG_DATA, sheet);
	const into = new Container();
	const unmount = look.mount(into);
	assert.equal(into.children.length, 1);
	const [root] = into.children;
	assert.ok(root instanceof Container && !(root instanceof RIG.RigView));
	assert.equal(root.children.length, 1, 'a look that has not cross-faded has one view');
	const entryOf = (view) => view.state.getCurrent(0);
	/** Where in its cycle a view is, 0 to 1. */
	const phaseOf = (view) => {
		const entry = entryOf(view);
		return phaseKept(entry.trackTime, entry.animationEnd - entry.animationStart, 1);
	};
	return { sheet, animator, look, into, root, unmount, entryOf, phaseOf };
};

/**
 * Drive a rig's animator and its look together along `headingAt` (degrees), as `online.ts` does:
 * each frame with what the look drew, its views, and the phase of each.
 */
function rigDrive(stage, headingAt, ms, from = 0, handOver = (frame) => frame) {
	const { animator, look, root, entryOf, phaseOf } = stage;
	const samples = [];
	for (let atMs = from; atMs <= from + ms; atMs += FRAME_MS) {
		const frame = animator.frame({ atMs, ...flat(headingAt(atMs) * DEG) });
		look.frame(handOver(frame), atMs);
		// The views are the look's own and are used again: what each is NOW is read off here.
		const views = root.children.map((view) => ({
			view,
			visible: view.visible,
			flipX: view.scale.x < 0,
			lean: view.rotation,
			// The alpha of the filter that flattens it while it fades; none ⇒ it is opaque.
			fade: (view.filters ?? []).map((filter) => filter.alpha),
			animation: entryOf(view).animation.name,
			phase: phaseOf(view),
		}));
		const front = views.at(-1);
		const entry = entryOf(front.view);
		samples.push({
			atMs,
			frame,
			drawn: look.drawn(),
			views,
			front,
			seen: views.filter((view) => view.visible),
			mix: { from: entry.mixingFrom?.animation.name, seconds: entry.mixDuration },
			phase: front.phase,
		});
	}
	return samples;
}
const turnBy = (phase) => phase - Math.floor(phase);

/** North-east, then round by the west to the south, a facing every 700 ms (degrees). */
const ROUND = (ms) =>
	[45, 0, 315, 270, 225, 180][ms < 1100 ? 0 : Math.min(Math.floor((ms - 1100) / 700) + 1, 5)];
/** Each change of that round: the animation left, the one taken, mirrored or not, and whether the
 *  two are one pose (the same parts, the same way round). */
const ROUND_CHANGES = [
	['walk_ne', 'walk_n', false, true],
	// North-west is north-east mirrored: another picture.
	['walk_n', 'walk_ne', true, false],
	// The same way round, but other parts.
	['walk_ne', 'walk_e', true, false],
	// Mirrored both, the same parts: one pose, mirrored.
	['walk_e', 'walk_se', true, true],
	['walk_se', 'walk_s', false, false],
];

/**
 * THE WALK NEVER STARTS AGAIN: frame to frame the picture drawn moves on by one frame of its own
 * cycle from where the picture drawn before it was, through every pose mix and cross-fade.
 */
const walksOn = (samples, phaseStep = (moved) => moved) =>
	samples.forEach((sample, i) => {
		if (i === 0) return;
		const moved = turnBy(sample.phase - samples[i - 1].phase);
		const step = FRAME_MS / 1000 / RIG_WALKS[sample.frame.animation];
		assert.ok(
			Math.abs(phaseStep(moved, sample) - step) < 1e-9,
			`${sample.atMs} ms, ${sample.frame.animation}: its phase moved ${moved}, a frame is ${step}`,
		);
	});

const rigRound = ({ phaseStep, posesOf = (frame) => frame.blend.pose }) => {
	const stage = rigStage(rigSheet(BLENDS), 'ne');
	const samples = rigDrive(stage, ROUND, 1100 + 700 * 5 + 400);
	const changes = changesOf(samples);
	assert.equal(changes.length, ROUND_CHANGES.length, 'every change of the round is drawn');
	walksOn(samples, phaseStep);
	let fades = 0;
	changes.forEach((at, i) => {
		const [from, to, flipX, pose] = ROUND_CHANGES[i];
		const sample = samples[at];
		const before = samples[at - 1];
		const { frame, drawn } = sample;
		assert.deepEqual([frame.blend.from.animation, frame.animation, frame.flipX], [from, to, flipX]);
		// The animator: one rig the same way round may be one pose; its mirrored twin may not.
		assert.equal(frame.blend.pose, frame.blend.from.flipX === flipX, `${from} to ${to}`);
		// The look: and only when the two draw the same parts.
		assert.equal(drawn.blend.pose, pose, `${from} to ${to}`);
		assert.equal(posesOf(frame), frame.blend.pose);
		assert.deepEqual([drawn.blend.from, drawn.blend.weight], [from, frame.blend.weight]);
		const run = samples.slice(at, changes[i + 1] ?? samples.length).filter((s) => s.frame.blend);
		assert.equal(run.length, Math.ceil(BLEND_MS / FRAME_MS));
		const done = samples[at + run.length];
		if (pose) {
			// ONE POSE, IN ONE VIEW: the runtime mixes the animation in over the blend's time, from
			// the one that was playing, started at the phase that one had reached.
			assert.equal(sample.views.length, fades ? 2 : 1, 'no view is added for a pose mix');
			for (const s of run) {
				same(s.seen, [s.front], 'one view is drawn');
				assert.equal(s.front.view, before.front.view, 'the same view');
				assert.equal(s.front.flipX, flipX);
				assert.equal(s.drawn.blend.pose, true);
				assert.deepEqual(s.drawn.blend.alpha, { from: 0, to: 1 });
				assert.deepEqual(s.front.fade, [], 'opaque');
				// One pose leans as far between its two pictures as it is mixed.
				const { from: left, weight } = s.frame.blend;
				assert.ok(near(s.front.lean, left.lean + (s.frame.lean - left.lean) * weight));
				assert.equal(s.drawn.lean, s.front.lean);
				assert.deepEqual(s.drawn.blend.phase, { from: s.phase, to: s.phase });
			}
			assert.equal(sample.front.animation, to);
			assert.equal(sample.mix.from, from);
			assert.ok(Math.abs(sample.mix.seconds - BLEND_MS / 1000) < 1e-9);
		} else {
			// TWO PICTURES, CROSS-FADED: the view that drew the one left goes behind and plays on,
			// a second takes the frame's at the same phase.
			fades += 1;
			const [back, front] = sample.views;
			assert.equal(sample.views.length, 2);
			assert.equal(back.view, before.front.view, 'the view of the picture left is behind');
			assert.ok(front.view !== back.view, 'a second view');
			assert.deepEqual([front.animation, back.animation], [to, from]);
			// A view used again may be handed its last animation to mix from: over no time.
			assert.ok(!sample.mix.from || sample.mix.seconds === 0, 'two pictures are not one pose');
			assert.deepEqual([front.flipX, back.flipX], [flipX, frame.blend.from.flipX]);
			// Both a frame on from the phase the picture left was at, each in its own cycle.
			const stepOf = (name) => FRAME_MS / 1000 / RIG_WALKS[name];
			const { phase } = drawn.blend;
			assert.ok(Math.abs(turnBy(phase.to - before.phase) - stepOf(to)) < 1e-9);
			assert.ok(Math.abs(turnBy(phase.from - before.phase) - stepOf(from)) < 1e-9);
			assert.deepEqual([phase.to, phase.from], [front.phase, back.phase]);
			for (const s of run) {
				same(
					s.views.map((v) => v.view),
					[back.view, front.view],
					'the same two views all through the fade',
				);
				assert.equal(s.seen.length, 2, 'both are drawn');
				// Each picture at its own lean.
				assert.deepEqual(
					s.views.map((v) => v.lean),
					[s.frame.blend.from.lean, s.frame.lean],
				);
				assert.equal(s.drawn.blend.pose, false);
				const alpha = fadeAlphas(s.frame.blend.weight);
				assert.deepEqual(s.drawn.blend.alpha, alpha);
				// A view that fades is flattened by a filter at its alpha; an opaque one has none.
				assert.deepEqual(s.views[1].fade, alpha.to < 1 ? [alpha.to] : []);
				assert.deepEqual(s.views[0].fade, alpha.from < 1 ? [alpha.from] : []);
			}
			// Done: the picture left is not drawn, the frame's is opaque.
			same(
				done.seen.map((v) => v.view),
				[front.view],
				'only the frame`s view is drawn',
			);
			assert.deepEqual(done.front.fade, [], 'opaque');
		}
		assert.equal(done.drawn.blend, undefined);
		assert.equal(done.drawn.animation, to);
	});
	assert.equal(samples.at(-1).views.length, 2, 'three cross-fades are drawn by two views');
	stage.look.destroy();
};
check(
	'the rig look: the same parts are one pose in one view, others two views cross-faded, the walk carried on',
	() => {
		rigRound({ phaseStep: (moved) => moved });
	},
);

const rigMirrored = (viewsOf) => {
	// East, then west at once: west is east's animation, mirrored.
	const stage = rigStage(rigSheet({ ...BLENDS, speed: 0 }), 'e');
	const samples = rigDrive(stage, (ms) => (ms < 1100 ? 90 : 270), 1100 + 600);
	const [at, ...more] = changesOf(samples);
	assert.equal(more.length, 0);
	const { frame, drawn, views } = samples[at];
	assert.deepEqual(
		[frame.blend.from.animation, frame.blend.from.flipX, frame.animation, frame.flipX],
		['walk_e', false, 'walk_e', true],
	);
	assert.equal(rigPoseMixes(RIG_DATA, 'walk_e', 'walk_e'), true, 'the same parts, but mirrored');
	assert.equal(frame.blend.pose, false, 'a mirrored twin is another picture');
	assert.equal(drawn.blend.pose, false);
	assert.equal(viewsOf(views), 2, 'two views, cross-faded');
	const [back, front] = views;
	assert.deepEqual([back.flipX, front.flipX], [false, true]);
	assert.deepEqual([back.visible, front.visible], [true, true]);
	assert.deepEqual([back.animation, front.animation], ['walk_e', 'walk_e']);
	// The same animation: both at the same point of the walk.
	assert.ok(Math.abs(turnBy(drawn.blend.phase.to - drawn.blend.phase.from)) < 1e-9);
	walksOn(samples);
	stage.look.destroy();
};
check(
	'a rig`s mirrored twin is cross-faded by two views, not posed: east to west at speed 0',
	() => {
		rigMirrored((views) => views.length);
	},
);

/** A rig look drawing `walk_n` at `lean`, mirrored or not: its view. */
const rigLeant = (turn, lean, flipX) => {
	const stage = rigStage(rigSheet(turn));
	const frame = {
		rig: 'hero',
		animation: 'walk_n',
		skin: undefined,
		flipX,
		loop: true,
		play: 0,
		action: 'walk',
		variant: undefined,
		lean,
	};
	stage.look.frame(frame, 0);
	const [view] = stage.root.children;
	view.updateLocalTransform();
	return { ...stage, view };
};
/** Where the point `up` px (as drawn) above the rig's place is drawn, from the place. */
const rigPoint = (view, sheet, up) => {
	const { anchorY } = { anchorY: sheet.draw.feet };
	const scale = sheet.draw.width / RIG_BOX.w;
	return view.localTransform.apply({
		x: RIG_BOX.x + RIG_BOX.w / 2,
		y: RIG_BOX.y + anchorY * RIG_BOX.h - up / scale,
	});
};
const rigLeansAbout = (turn, pivotOf) => {
	for (const flipX of [false, true])
		for (const lean of [0, 20 * DEG, -20 * DEG]) {
			const { look, view, sheet } = rigLeant(turn, lean, flipX);
			const pivot = pivotOf(sheet);
			assert.equal(view.rotation, lean);
			assert.equal(look.drawn().lean, lean);
			assert.equal(view.scale.x < 0, flipX);
			assert.ok(near(Math.abs(view.scale.x), 1.6) && near(view.scale.y, 1.6));
			for (const up of [pivot, 0, 10, pivot + 25]) {
				const drawn = rigPoint(view, sheet, up);
				const turned = leanedPoint({ dx: 0, lift: up }, lean, pivot);
				assert.ok(
					near(drawn.x, turned.dx) && near(-drawn.y, turned.lift),
					`${up} px up at ${lean / DEG}°${flipX ? ', mirrored' : ''}: ${drawn.x}, ${-drawn.y}`,
				);
			}
			// Its hand (a bone) turns with the body about the same point, and its middle is how
			// high the turned middle is.
			const straight = rigLeant(turn, 0, flipX);
			const { hand, middle } = straight.look.points();
			assert.ok(near(middle, (0.9 - 0.5) * 80 * 1.6));
			const points = look.points();
			const turned = leanedPoint(hand, lean, pivot);
			assert.ok(near(points.hand.dx, turned.dx) && near(points.hand.lift, turned.lift));
			assert.ok(near(points.middle, leanedPoint({ dx: 0, lift: middle }, lean, pivot).lift));
			look.destroy();
			straight.look.destroy();
		}
};
/**
 * North, east (other parts: a cross-fade), and north again once that fade is long done: the view
 * that drew north, not drawn since, draws it again, at the phase the east walk has reached.
 */
const rigComesBack = (phaseStep) => {
	const stage = rigStage(rigSheet({ ...BLENDS, speed: 0 }));
	const samples = rigDrive(stage, (ms) => (ms < 1100 || ms >= 1800 ? 0 : 90), 2600);
	const [out, back, ...more] = changesOf(samples);
	assert.ok(back > out && more.length === 0, 'it turns out and back');
	assert.equal(samples[back - 1].frame.blend, undefined, 'the first fade is done');
	assert.deepEqual(
		[samples[back].frame.blend.from.animation, samples[back].frame.animation],
		['walk_e', 'walk_n'],
	);
	assert.equal(samples[back].views.length, 2, 'two views draw every cross-fade');
	walksOn(samples, phaseStep);
	stage.look.destroy();
};
check('a rig turned back to a picture after its cross-fade is done carries the walk on', () => {
	rigComesBack();
});

/** The round on a rig sheet saved `turn: {}`: no blend anywhere, one view, never faded, and the
 *  walk carried on at its phase through every change of picture (`kept` on the frame of each). */
const savedRigWalksOn = (handOver) => {
	const stage = rigStage(rigSheet({}), 'ne');
	const samples = rigDrive(stage, ROUND, 1100 + 700 * 5 + 400, 0, handOver);
	const changes = changesOf(samples);
	assert.equal(changes.length, ROUND_CHANGES.length, 'every change of the round is drawn');
	assert.ok(
		samples.every((s) => !Object.hasOwn(s.frame, 'blend')),
		'no blend object',
	);
	assert.ok(samples.every((s) => s.views.length === 1 && s.drawn.blend === undefined));
	assert.ok(
		samples.every((s) => s.front.fade.length === 0),
		'never filtered',
	);
	for (const at of changes) assert.equal(samples[at].frame.kept, true);
	assert.equal(samples.filter((s) => s.frame.kept).length, changes.length);
	walksOn(samples);
	stage.look.destroy();
};
check('a rig saved `turn: {}`: no blend, one view, the walk carried on through each switch', () => {
	savedRigWalksOn((frame) => frame);
});

check('pivot middle, the default: a rig leans about the middle of its box, mirrored or not', () => {
	const about = sheetLeanPivot(rigSheet({}), RIG_BOX);
	assert.ok(near(about, (0.9 - 0.5) * 80 * 1.6) && about > 0);
	rigLeansAbout({}, () => about);
	rigLeansAbout({ pivot: 'middle', lean: 10 }, () => about);
});
check('pivot feet: a rig leans about its place, mirrored or not', () => {
	assert.equal(sheetLeanPivot(rigSheet({ pivot: 'feet' }), RIG_BOX), 0);
	rigLeansAbout({ pivot: 'feet' }, () => 0);
});

check('a rig look is its root on the mount: gone with the unmount, destroyed with the look', () => {
	const stage = rigStage(rigSheet(BLENDS));
	rigDrive(stage, ROUND, 2200);
	const views = [...stage.root.children];
	assert.equal(views.length, 2);
	assert.equal(stage.look.drawn().mounted, true);
	stage.unmount();
	assert.equal(stage.into.children.length, 0);
	assert.equal(stage.look.drawn().mounted, false);
	stage.look.destroy();
	assert.ok(stage.root.destroyed && views.every((view) => view.destroyed));
});

// ── 13. each goes red ────────────────────────────────────────────────────────────────────────

mutation('a lean below half the sector is not continuous', () => {
	assert.ok(edgeGap({ ...EIGHT, turn: { lean: 10 } }) < 1e-9);
});
/** The lean before sample B: the heading's distance held at `most`, as the flattened screen
 *  draws that ground angle. */
const saturating = (flattening) => (heading, facing, most, sector) => {
	const centre = facingHeading(facing);
	const from = wrapAngle(heading - centre);
	const far = Math.abs(from);
	const kept = Math.min(Math.max((Math.PI - far) / (Math.PI - sector / 2), 0), 1);
	const screen = (h) => Math.atan2(Math.sin(h), Math.cos(h) / flattening);
	return wrapAngle(screen(centre + Math.sign(from) * Math.min(far, most) * kept) - screen(centre));
};
mutation('the old lean, held at its most for most of the sector, is not linear', () => {
	linearTilt(saturating(1));
});
mutation('a lean passed through the isometric flattening differs per facing', () => {
	linearTilt((h, f, most, sector) => leanOf(h, f, most, sector) * (f.length === 1 ? 1 : 1.2));
});
mutation('a tilt spread over a whole sector each way is not `most` at the switch', () => {
	switchAtHalf((h, f, most, sector) => leanOf(h, f, most, sector * 2));
});
mutation('an isometric `turn: {}` read with no tilt is not sample B', () => {
	isoSaved({ ...ISO_EIGHT, turn: { speed: 0, lean: 0 } });
});
mutation('a switch read where the facing rule turns (7.5° past the edge, after its hold)', () => {
	switchesAtHalf(ISO_EIGHT, 70, (f) => circling(70)(f.atMs - CLIP_TURN_MS) - 7.5 * DEG);
});
mutation('a sheet without the turn switches where the facing rule does', () => {
	switchesAtHalf({ kind: 'isometric', facings: 8 }, 70);
});
mutation('an isometric `turn: {}` that tilts against the turn', () => {
	switchesAtHalf({ ...ISO_EIGHT, turn: { lean: 0 } }, 70);
});
mutation('a top-down view read through the saturating lean on a flattened screen', () => {
	sameAsBefore(saturating(2));
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
mutation('a rig look that does not carry a kept walk on starts it again at a switch', () => {
	savedRigWalksOn((frame) => ({ ...frame, kept: undefined }));
});
mutation('a kept clip that starts its frame afresh holds the walk at each change', () => {
	clipKept(
		(turn) => turn,
		(sprite) => sprite.currentFrame,
	);
});
mutation('a clip look that does not carry a kept clip on starts it again', () => {
	clipKept((turn) => ({ ...turn, kept: undefined }));
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
mutation('a lean held at its most all the way round flips opposite the picture', () => {
	oppositeLeans((heading) => {
		const off = wrapAngle(heading - facingHeading('s'));
		return Math.min(Math.max(off, -45 * DEG), 45 * DEG);
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
mutation('a clip handed its middle and turned about its feet', () => {
	leansAbout((sprite) => sprite.rotation, undefined, 60);
});
mutation('a clip handed no pivot and turned about its middle', () => {
	leansAbout((sprite) => sprite.rotation, 60, 0);
});
mutation('a sheet whose pivot is always its feet', () => {
	pivots(() => 0);
});
mutation('an isometric view read at a top-down view`s default lean', () => {
	savedDefaults((kind, sector) => sector / 2);
});
mutation('a frame with a `blend` key, absent or not, is not the frame it was', () => {
	plainFrames((frame) => Object.keys({ ...frame, blend: undefined }));
});
mutation('a clip keyed without its `play` does not start a repeat again', () => {
	restarts((clip) => `${clip.clipId}|${clip.flipX}|${clip.loop}|0`);
});
mutation('a marked player`s own clip drawn gold', () => {
	goldWhen((marked) => marked);
});
mutation('a cross-fade of two alphas that are 1 together is seen through', () => {
	weights(blendWeight, (weight) => ({ from: 1 - weight, to: weight }));
});
mutation('a blend eased in only is not the same weights turned back', () => {
	weights((progress) => Math.min(Math.max(progress, 0), 1) ** 2, fadeAlphas);
});
mutation('a blend of 160 ms is not done in 100', () => {
	blendsOver(BLENDS, 100);
});
mutation('a blend whose weight is its time is not eased', () => {
	blendsOver(BLENDS, BLEND_MS, (progress) => progress);
});
mutation('a sheet that blends carries a blend', () => {
	neverBlends(BLENDS);
});
mutation('a blend turned back that started again from 0 jumps', () => {
	turnedBack((weight) => weight);
});
mutation('a sweep read as cutting each blend half way', () => {
	sweepBlends(BLENDS, BLEND_MS, (left) => (left ? left.weight / 2 : 1));
});
mutation('a one-shot read as blended', () => {
	onceKeeps((frame) => frame.action === 'hop' || Object.hasOwn(frame, 'blend'));
});
mutation('a hold read as blended', () => {
	holdKeeps((frame) => !frame.loop);
});
mutation('a change of action read as blended', () => {
	actionChange((frame) => frame.action === 'carry');
});
mutation('a blend that outlived `reset`', () => {
	resetEnds((frame) => frame.clipId === 'hero_walk_ne');
});
mutation('a cycle carried on at its time, not its phase', () => {
	keepsPhase((time, length) => time % length, frameKept);
});
mutation('a clip carried on from its first frame', () => {
	keepsPhase(phaseKept, () => 0);
});
mutation('a clip taken from its first frame in a cross-fade', () => {
	clipFades(() => 0);
});
mutation('a rig`s walk that started again at a change of picture', () => {
	rigRound({ phaseStep: (moved, sample) => (sample.frame.blend?.weight === 0 ? 0 : moved) });
});
mutation('a rig`s walk that started again when it turned back', () => {
	rigComesBack((moved, sample) => (sample.frame.blend?.weight === 0 ? 0 : moved));
});
mutation('a mirrored twin read as one pose', () => {
	rigRound({ phaseStep: (moved) => moved, posesOf: () => true });
});
mutation('a mirrored twin posed in one view', () => {
	rigMirrored(() => 1);
});
mutation('a rig turned about its feet when its sheet says its middle', () => {
	rigLeansAbout({}, () => 0);
});
mutation('a rig turned about its middle when its sheet says its feet', () => {
	rigLeansAbout({ pivot: 'feet' }, (sheet) => sheetClipPoints(sheet, RIG_BOX, false).middle);
});

console.log(
	process.exitCode
		? `\ncharacter turn: FAILED (${passed} passed)`
		: `\ncharacter turn: ${passed} passed`,
);
