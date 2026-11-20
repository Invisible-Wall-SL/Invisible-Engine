// The character sheet's resolver (packages/engine-layout/src/lib/characterSheet.ts;
// docs/design/character-pipeline.md §3, step C2a), and the proof that lets a `characterClips`
// block move onto a sheet:
//
//  1. every cell of Flipbook's Characters grid (apps/launcher-api `check:flipbook-characters` §3:
//     the same five looks, the same seeded sets of clips, marked and not, every state and facing)
//     draws the same clip through `resolveSheetClip` over the converted sheet as through
//     `resolveCharacterClip` over the block. The launcher's `characterSet.ts` imports the whole of
//     `engine-layout`, which the root loader cannot load, so its enumeration is rebuilt here from
//     `resolveCharacterClip` exactly as that module builds it, and the cell count is held to the
//     number that gate prints;
//  2. a Salmons room, run headless and seeded on the reference config (services/game-server
//     `roomSim.ts`), drawn as `apps/lines` `online.ts` draws it: the old animator and the sheet
//     animator are fed the same frames and the same room events, and give the same clip every
//     frame. The draw loop is rebuilt here, not `online.ts` run: its own wiring is held in a
//     browser by `scripts/playtest/salmons-play.mjs --sheet`;
//  3. the rules a sheet adds: the side and top-down facings, `mirror: false`, an `anim` cell,
//     variants, an action per ability button, an event's user and its target, priorities,
//     `interrupt`, `again`;
//  4. a class's sheet read off a raw config, and none read off a config that has none;
//  5. the draw points, equal to `clipPoints`;
//  6. the proof can fail: the same comparisons run against a wrong sheet are red;
//  7. what the sheet animator costs beside the old one (printed, not judged).
//  8. a rig source and a still image (C6a): the animation and the mirror of every action and
//     facing of each rig arrangement (one rig, one rig with an animation per facing, a rig per
//     facing, a cell), stand-ins and fallbacks, an action once for its animation's length, a
//     variant's skin, a point on a bone, the draw box; a still as a clip of one frame, a character
//     whose every action falls back to one still; and each table red on a mutation.
//
// Run: pnpm check:character-sheet

import assert from 'node:assert/strict';

import {
	CLIP_FACING8_DEADBAND,
	CLIP_FACING_DEADBAND,
	CLIP_FACINGS,
	CLIP_HAND,
	CLIP_MIRROR,
	CLIP_MOVING_HOLD_MS,
	CLIP_ONE_SHOT_MS,
	CLIP_STATE_FALLBACK,
	CLIP_TURN_MS,
	clipMirrorOf,
	clipPoints,
	createCharacterAnimator,
	resolveCharacterClip,
} from '../packages/engine-layout/src/lib/characterClips.ts';
import {
	CLIP_STRAIGHTS,
	clipFacing4Of,
	clipFacingSideOf,
	createSheetAnimator,
	createSheetRigAnimator,
	resolveSheetClip,
	resolveSheetRig,
	sheetClipPoints,
	sheetDraw,
	sheetFacings,
	sheetOfCharacterClips,
	sheetPlaysClips,
	sheetPlaysRig,
	sheetPoint,
	sheetRigPlacement,
	sheetRigPoints,
	sheetSignalsOf,
	sheetStartFacing,
	sheetStillClipId,
	sheetStillClips,
} from '../packages/engine-layout/src/lib/characterSheet.ts';
import {
	ISO_PROJECTOR,
	ISO_PROJECTOR_MIRRORED,
} from '../packages/engine-layout/src/lib/projection.ts';
import { SALMONS_CHARACTER_CLIPS } from '../packages/engine-layout/src/lib/referenceLayouts/salmonsClips.ts';
import { CHARACTER_CLIP_EVENTS } from '../packages/engine-layout/src/lib/types.ts';
import { BUTTONS, MOVE_SCALE, clampInput } from '../packages/engine-mechanics/src/online.js';
import {
	createHookLines,
	flowSignalsOf,
	shownInRoom,
} from '../packages/engine-mechanics/src/onlineFlow.js';
import { STATUS } from '../packages/engine-mechanics/src/onlineRules.js';
import { salmonsConfig, salmonsRiver } from '../packages/engine-mechanics/src/salmons.js';
import {
	characterActionPlay,
	characterActionPriority,
	characterViewFacings,
	isClipSheet,
	normalizeCharacterSheet,
	normalizeGameConfigDoc,
	onlineClassSheetOf,
	onlineGameOf,
} from '../packages/game-config/index.ts';
import { createRoomSim } from '../services/game-server/src/roomSim.ts';

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

/** A small seeded generator (`check:flipbook-characters`'), so every run is the same. */
function seeded(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const { salmon, bear, fisherman } = SALMONS_CHARACTER_CLIPS;
const knight = {
	prefixes: { base: 'knight' },
	displayWidth: 64,
	idle: 'idle',
	walk: 'run',
	on: { ability: 'slash' },
};
const knight8 = { ...knight, facings: 8, prefixes: { base: 'knight', marked: 'knight_gold' } };
/** The five looks of `check:flipbook-characters` §3, in its order. */
const LOOKS = [
	['bear', bear],
	['fisherman', fisherman],
	['salmon', salmon],
	['knight', knight],
	['knight ×8 with a marked prefix', knight8],
];
/** Blocks whose states share roles, which the grid's five do not have. */
const ODD_LOOKS = [
	['a state looped and played on an event', { ...bear, on: { ability: 'idle' } }],
	['holding is the idle state', { ...fisherman, holding: 'idle' }],
	['holding is the walk state', { ...fisherman, holding: 'walk', on: { caught: 'walk' } }],
	['no walk, every event', { ...salmon, on: { ...salmon.on, ability: 'hop' } }],
	[
		'feet and hand named',
		{ ...knight8, anchorY: 0.9, hand: { x: 0.9, y: 0.25 }, holding: 'guard' },
	],
];

// ── The enumeration of `apps/launcher-api/src/lib/flipbook/characterSet.ts`, rebuilt ──────────

const at = (facing) => CLIP_FACINGS.indexOf(facing);
function characterFacings(look) {
	const all = look.facings === 8 ? [...CLIP_FACINGS] : CLIP_FACINGS.filter((f) => f in CLIP_MIRROR);
	const isMirrored = (facing) => {
		const twin = clipMirrorOf(facing);
		return twin !== undefined && at(twin) < at(facing);
	};
	return { drawn: all.filter((f) => !isMirrored(f)), mirrored: all.filter(isMirrored) };
}
function characterStates(look) {
	const out = new Set();
	for (const state of [look.idle, look.walk, look.holding]) if (state) out.add(state);
	for (const event of CHARACTER_CLIP_EVENTS) if (look.on?.[event]) out.add(look.on[event]);
	return [...out];
}
function lookedForClipIds(look) {
	const { drawn, mirrored } = characterFacings(look);
	const out = new Set();
	for (const marked of look.prefixes.marked ? [false, true] : [false])
		for (const state of characterStates(look))
			for (const facing of [...drawn, ...mirrored])
				resolveCharacterClip(look, state, facing, marked, (clipId) => {
					out.add(clipId);
					return false;
				});
	return out;
}
/** The sets of clips the grid is drawn over: none, all, each alone, and sixty seeded shares. */
function clipSets(look) {
	const pool = [...lookedForClipIds(look)];
	const random = seeded(pool.length);
	const sets = [[], pool, ...pool.map((id) => [id])];
	for (let n = 0; n < 60; n++) {
		const share = random();
		sets.push(pool.filter(() => random() < share));
	}
	return sets;
}

const statusesOf = (marked, holding = false) => [
	...(holding ? ['holding'] : []),
	...(marked ? ['marked'] : []),
];
/** A clip as either resolver found it, in the old one's words. */
const found = (clip) =>
	clip && {
		clipId: clip.clipId,
		flipX: clip.flipX,
		state: clip.state ?? clip.action,
		marked: clip.marked ?? clip.variant === 'marked',
	};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The grid of `check:flipbook-characters` §3, each cell through both resolvers: how many cells,
 * and how many where the sheet `sheetOf(look)` draws another clip than the block. `prefer` adds a
 * facing last seen to every cell; `facings` draws other facings than the grid's.
 */
function compareGrid(sheetOf, { looks = LOOKS, prefer, facings } = {}) {
	let cells = 0;
	let differ = 0;
	let first;
	for (const [name, look] of looks) {
		const sheet = sheetOf(look);
		const grid = characterFacings(look);
		for (const marked of look.prefixes.marked ? [false, true] : [false])
			for (const ids of clipSets(look)) {
				const have = new Set(ids);
				const has = (id) => have.has(id);
				for (const state of characterStates(look))
					for (const facing of facings ?? [...grid.drawn, ...grid.mirrored]) {
						cells += 1;
						const old = found(resolveCharacterClip(look, state, facing, marked, has, prefer));
						const now = found(
							resolveSheetClip(sheet, state, facing, statusesOf(marked), has, prefer),
						);
						if (same(old, now)) continue;
						differ += 1;
						first ??= `${name} ${state} ${facing}${marked ? ' marked' : ''} over [${ids}]: the block draws ${JSON.stringify(old)}, the sheet ${JSON.stringify(now)}`;
					}
			}
	}
	return { cells, differ, first };
}

// ── 1. Every cell of the grid ────────────────────────────────────────────────────────────────

/** What `pnpm --filter launcher-api check:flipbook-characters` prints. */
const GRID_CELLS = 14504;
let gridCells = 0;
let preferCells = 0;

check('a block read as a sheet is canonical, and a sheet this build plays', () => {
	for (const [name, look] of [...LOOKS, ...ODD_LOOKS]) {
		const sheet = sheetOfCharacterClips(look);
		assert.deepEqual(normalizeCharacterSheet(structuredClone(sheet)), sheet, name);
		assert.equal(isClipSheet(sheet), true, name);
		assert.equal(sheetPlaysClips(sheet), true, name);
	}
});

check('the converter: Salmons’ three characters, row for row', () => {
	assert.deepEqual(sheetOfCharacterClips(bear), {
		view: { kind: 'isometric', facings: 8 },
		source: { kind: 'clips', prefix: 'bear' },
		draw: { width: 92 },
		actions: [
			{ id: 'idle', when: { motion: 'still' }, fallback: 'walk' },
			{ id: 'walk', when: { motion: 'moving' }, fallback: 'idle' },
			{ id: 'swipe', when: [{ ability: 'ability1' }, { ability: 'ability2' }], fallback: 'idle' },
		],
	});
	assert.deepEqual(sheetOfCharacterClips(fisherman).actions, [
		{ id: 'idle', when: { motion: 'still' }, fallback: 'walk' },
		{ id: 'walk', when: { motion: 'moving' }, fallback: 'idle' },
		{ id: 'reel', when: { status: 'holding' }, fallback: 'idle' },
		{ id: 'cast', when: [{ ability: 'ability1' }, { ability: 'ability2' }], fallback: 'reel' },
	]);
	assert.deepEqual(sheetOfCharacterClips(salmon), {
		view: { kind: 'isometric' },
		source: { kind: 'clips', prefix: 'salmon_pink', variants: { marked: 'salmon_golden' } },
		draw: { width: 90 },
		actions: [
			{ id: 'swim', when: [{ motion: 'still' }, { motion: 'moving' }], fallback: 'idle' },
			{ id: 'hop', when: [{ event: 'jumped' }, { event: 'climbed' }], fallback: 'swim' },
			{ id: 'caught', when: { event: 'caught', as: 'target' } },
			{ id: 'idle', fallback: 'walk' },
			{ id: 'walk', fallback: 'idle' },
		],
	});
	const odd = sheetOfCharacterClips(ODD_LOOKS[0][1]).actions[0];
	assert.deepEqual(
		[odd.id, odd.play, odd.priority, characterActionPlay(odd), characterActionPriority(odd)],
		['idle', 'loop', 1, 'loop', 1],
		'a state looped and played on an event keeps looping, at its loop’s priority',
	);
	const handed = sheetOfCharacterClips(ODD_LOOKS[4][1]);
	assert.deepEqual(handed.draw, { width: 64, feet: 0.9, points: { hand: { x: 0.9, y: 0.25 } } });
});

check('four fallbacks (characterClips.ts) is every fallback until a state repeats', () => {
	for (const start of new Set([
		...Object.keys(CLIP_STATE_FALLBACK),
		...Object.values(CLIP_STATE_FALLBACK),
	])) {
		const four = [];
		for (let s = start, hops = 0; s && hops < 4; s = CLIP_STATE_FALLBACK[s], hops++) four.push(s);
		const untilRepeat = [];
		for (let s = start; s && !untilRepeat.includes(s); s = CLIP_STATE_FALLBACK[s])
			untilRepeat.push(s);
		assert.deepEqual([...new Set(four)], untilRepeat, start);
	}
});

check(`the grid: all ${GRID_CELLS} cells draw the same clip through the sheet`, () => {
	const { cells, differ, first } = compareGrid(sheetOfCharacterClips);
	gridCells = cells;
	assert.equal(differ, 0, first);
	assert.equal(cells, GRID_CELLS, 'the cell count of check:flipbook-characters');
});

check('…and with a facing last seen, for the looks of eight facings', () => {
	const eight = LOOKS.filter(([, look]) => look.facings === 8);
	assert.equal(eight.length, 3);
	for (const prefer of CLIP_FACINGS) {
		const { cells, differ, first } = compareGrid(sheetOfCharacterClips, { looks: eight, prefer });
		preferCells += cells;
		assert.equal(differ, 0, `prefer ${prefer}: ${first}`);
	}
});

check('…and off the grid: every look in all eight facings, the odd blocks too', () => {
	for (const prefer of [undefined, 'ne', 'w']) {
		const { differ, first } = compareGrid(sheetOfCharacterClips, {
			looks: [...LOOKS, ...ODD_LOOKS],
			facings: CLIP_FACINGS,
			prefer,
		});
		assert.equal(differ, 0, first);
	}
});

// ── 2. A Salmons room, frame for frame ───────────────────────────────────────────────────────

const STATUS_NAME = new Map(Object.entries(STATUS).map(([name, status]) => [status, name]));
const STEPS = 3600;
const SWIMMERS = ['s0', 's1', 's2', 's3', 's4', 's5'];

/**
 * A Salmons room of the reference config, seeded, with its bots: six salmon swim up the river at
 * different places across it (one the last game's winner, so golden), tapping jump, resting a
 * moment now and then and respawning when caught; a person's bear and a person's fisherman walk
 * the banks pressing their ability. Recorded as a device would draw it at two frames a step: each
 * frame's players (where, their room status, marked, holding a line) and the room's events as the
 * Flow signals they raise before it.
 */
function recordRoom(seed) {
	const game = onlineGameOf(normalizeGameConfigDoc(salmonsConfig()));
	assert.ok(game && !('refused' in game));
	const sim = createRoomSim(game, { seed });
	const river = salmonsRiver(sim.seed);
	SWIMMERS.forEach((id, i) => sim.join(id, { character: 'salmon', wonLast: i === 0 }));
	sim.join('b0', { character: 'bear' });
	sim.join('f0', { character: 'fisherman' });
	const swim = (player, step, lane) => {
		const ahead = player.body.y - 120;
		const band =
			river.bands.find((b) => ahead >= b.y && ahead < b.y + b.h) ??
			(ahead < river.bands[0].y ? river.bands[0] : river.bands.at(-1));
		const aim = band.left + (band.right - band.left) * (0.15 + 0.14 * lane);
		return {
			moveX: Math.max(-1, Math.min(1, (aim - player.body.x) / 60)) * 90,
			moveY: step % 240 < 200 ? -MOVE_SCALE : 0,
			buttons: step % 2 ? BUTTONS.jump : 0,
			respawn: 1,
		};
	};
	const walk = (step) => ({
		moveX: Math.round(Math.sin(step / 40) * MOVE_SCALE),
		moveY: Math.round(Math.cos(step / 55) * MOVE_SCALE),
		buttons: step % 20 === 0 ? BUTTONS.ability1 : 0,
	});
	const lines = createHookLines();
	const stepMs = 1000 / game.online.tickHz;
	const frames = [];
	const events = {};
	const abilities = {};
	const players = () =>
		new Map(
			[...sim.players].map(([id, p]) => [
				id,
				{ character: p.character.id, x: p.body.x, y: p.body.y, status: p.status, mark: p.mark },
			]),
		);
	let before = players();
	for (let step = 0; step < STEPS; step++) {
		const happened = [
			...sim.events(),
			...sim.step((id) => {
				const lane = SWIMMERS.indexOf(id);
				const input = lane < 0 ? walk(step) : swim(sim.players.get(id), step, lane);
				return [clampInput({ ...input, seq: step + 1 }, sim.game.field)];
			}),
		];
		for (const event of happened) {
			events[event.type] = (events[event.type] ?? 0) + 1;
			if (event.type !== 'ability') continue;
			const by = sim.players.get(event.by)?.character.id;
			abilities[by] = (abilities[by] ?? 0) + 1;
		}
		lines.events(happened);
		const now = players();
		const holders = new Set(lines.drawn(sim.players).map((line) => line.by));
		const signals = flowSignalsOf(happened, '', (id) => now.get(id));
		// Half way between the two steps (as an interpolated player is drawn), then on the step.
		const half = new Map(
			[...now].map(([id, p]) => {
				const was = before.get(id);
				return [id, was ? { ...p, x: (was.x + p.x) / 2, y: (was.y + p.y) / 2 } : p];
			}),
		);
		frames.push({ dtMs: stepMs / 2, signals, players: half, holders });
		frames.push({ dtMs: stepMs / 2, signals: [], players: now, holders });
		before = now;
	}
	return { frames, events, abilities };
}

const CAUGHT = { event: 'caught', as: 'target' };
const CAUGHT_WAIT_MS = 400;
const VELOCITY_WINDOW_MS = 150;

/** The registered clips of one run: `ids`, each a length from its name, one in four with none
 *  (`CLIP_ONE_SHOT_MS`). */
function clipSource(ids) {
	const have = new Set(ids);
	const hash = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
	return {
		has: (id) => have.has(id),
		cycleMs: (id) => (hash(id) % 4 === 0 ? undefined : 250 + (hash(id) % 900)),
	};
}

/**
 * The recorded room drawn as `apps/lines` `game/online.ts` draws it (`draw`, `drawClips`, `raise`,
 * `keptForCatch`, `restart`), each player by both animators: the old one over its block
 * (`blocks[character]`) and the sheet one over `sheetOf(block)`. How many frames × players were
 * compared, how many differed, and what played.
 */
function replayRoom(recorded, blocks, sheetOf, clips, project) {
	const sheets = Object.fromEntries(
		Object.entries(blocks).map(([character, block]) => [character, sheetOf(block, character)]),
	);
	const looks = new Map();
	const drawn = new Set();
	const oldLog = [];
	const newLog = [];
	const oneShots = {};
	let now = 0;
	let compared = 0;
	let differ = 0;
	let first;
	const differs = (what, id, old, neu) => {
		differ += 1;
		first ??= `at ${Math.round(now)} ms, ${id}: ${what}: the block ${JSON.stringify(old)}, the sheet ${JSON.stringify(neu)}`;
	};
	const restart = (look) => {
		look.oldLeaving = undefined;
		look.newLeaving = undefined;
		look.trail.length = 0;
		look.old.reset();
		look.neu.reset();
	};
	const statuses = (player, holding) => [
		...(holding ? ['holding'] : []),
		...(player.mark ? ['marked'] : []),
		STATUS_NAME.get(player.status),
	];
	/** `keptForCatch`, for either animator: `plays`, the catch's state and the one-shot in hand. */
	const kept = (leaving, plays, caught, oneShot) => {
		if (!plays) return { kept: false, leaving };
		const next = leaving ?? { until: now + CAUGHT_WAIT_MS, caught: false };
		if (oneShot === caught) return { kept: true, leaving: { ...next, caught: true } };
		return { kept: !next.caught && now < next.until, leaving: next };
	};
	for (const frame of recorded.frames) {
		for (const signal of frame.signals) {
			if (CHARACTER_CLIP_EVENTS.includes(signal.name)) {
				const subject = signal.name === 'caught' ? signal.payload.target : signal.payload.player;
				if (drawn.has(subject)) looks.get(subject)?.old.event(signal.name);
			}
			for (const { id, signal: about } of sheetSignalsOf(signal.name, signal.payload))
				if (drawn.has(id)) looks.get(id)?.neu.raise(about);
			if (signal.name === 'roundStart') for (const look of looks.values()) restart(look);
		}
		now += frame.dtMs;
		const { players, holders } = frame;
		for (const [id, look] of looks)
			if (players.get(id)?.character !== look.character) looks.delete(id);
		for (const id of drawn) {
			const player = players.get(id);
			const look = looks.get(id);
			if (player && shownInRoom(player)) continue;
			if (player && look) {
				const block = blocks[look.character];
				const old = kept(
					look.oldLeaving,
					look.old.plays('caught', player.mark),
					block.on?.caught,
					look.old.oneShot(now),
				);
				const neu = kept(
					look.newLeaving,
					look.neu.plays(CAUGHT, statuses(player, false)),
					look.neu.actionOf(CAUGHT),
					look.neu.oneShot(now),
				);
				look.oldLeaving = old.leaving;
				look.newLeaving = neu.leaving;
				if (old.kept !== neu.kept) differs('kept for its catch', id, old.kept, neu.kept);
				if (old.kept) continue;
			}
			drawn.delete(id);
			if (look) restart(look);
		}
		for (const [id, player] of players) {
			if (!shownInRoom(player)) continue;
			if (!drawn.has(id)) drawn.add(id);
			else if (looks.get(id)?.oldLeaving) restart(looks.get(id));
		}
		for (const id of drawn) {
			const player = players.get(id);
			if (!player || !blocks[player.character]) continue;
			let look = looks.get(id);
			if (!look) {
				look = {
					character: player.character,
					old: createCharacterAnimator(blocks[player.character], clips),
					neu: createSheetAnimator(sheets[player.character], clips),
					trail: [],
					shownOld: undefined,
					shownNew: undefined,
				};
				looks.set(id, look);
			}
			const { trail } = look;
			const place = shownInRoom(player) ? player : (trail.at(-1) ?? player);
			trail.push({ x: place.x, y: place.y, atMs: now });
			while (trail.length > 2 && now - trail[1].atMs >= VELOCITY_WINDOW_MS) trail.shift();
			const from = trail[0];
			const dt = now - from.atMs;
			const vx = dt > 0 ? ((place.x - from.x) * 1000) / dt : 0;
			const vy = dt > 0 ? ((place.y - from.y) * 1000) / dt : 0;
			const holding = holders.has(id);
			const old = look.old.frame({ atMs: now, vx, vy, holding, marked: player.mark, project });
			const neu = look.neu.frame({
				atMs: now,
				vx,
				vy,
				statuses: statuses(player, holding),
				project,
			});
			compared += 1;
			const drawnBy = (f) =>
				f && { clipId: f.clipId, flipX: f.flipX, loop: f.loop, play: f.play, marked: f.marked };
			if (!same(drawnBy(old), drawnBy(neu))) differs('the clip', id, drawnBy(old), drawnBy(neu));
			if (look.old.facing !== look.neu.facing)
				differs('the facing', id, look.old.facing, look.neu.facing);
			if (look.old.oneShot(now) !== look.neu.oneShot(now))
				differs('the one-shot', id, look.old.oneShot(now), look.neu.oneShot(now));
			if (old?.clipId !== look.shownOld?.clipId) oldLog.push(`${id}:${old?.clipId ?? ''}`);
			if (neu?.clipId !== look.shownNew?.clipId) newLog.push(`${id}:${neu?.clipId ?? ''}`);
			if (old && !old.loop && old.play !== look.shownOld?.play) {
				const state = look.old.oneShot(now);
				oneShots[state] = (oneShots[state] ?? 0) + 1;
			}
			look.shownOld = old;
			look.shownNew = neu;
		}
	}
	if (!same(oldLog, newLog)) differs('the clip log', 'all', oldLog.length, newLog.length);
	return { compared, differ, first, oneShots, log: oldLog };
}

const ROOM_SEED = 5;
const room = recordRoom(ROOM_SEED);
const BLOCKS = { salmon, bear, fisherman };
const ALL_CLIPS = Object.values(BLOCKS).flatMap((look) => [...lookedForClipIds(look)]);
const someOf = (share, seed) => {
	const random = seeded(seed);
	return ALL_CLIPS.filter(() => random() < share);
};
/** The clip sets a room is drawn over: every clip; the five drawn facings of each state; shares
 *  of them, so stand-ins and fallbacks play; none. */
const ROOM_CLIPS = [
	['every clip', ALL_CLIPS],
	['the drawn facings only', ALL_CLIPS.filter((id) => /_(n|ne|e|se|s)$/.test(id))],
	['half the clips', someOf(0.5, 1)],
	['one clip in five', someOf(0.2, 2)],
	['one clip in twenty', someOf(0.05, 3)],
	['no clip', []],
];
let roomCompared = 0;

check('the room: jumps, climbs, swipes, casts, hooks and catches all happened', () => {
	for (const type of ['jumped', 'climbed', 'ability', 'hooked', 'caught', 'respawned'])
		assert.ok(room.events[type] > 0, `no "${type}" in ${STEPS} steps of seed ${ROOM_SEED}`);
	assert.ok(room.abilities.bear > 0, 'no bear swiped');
	assert.ok(room.abilities.fisherman > 0, 'no fisherman cast');
	assert.ok(
		room.frames.some((f) => [...f.players.values()].some((p) => p.mark)),
		'no golden salmon',
	);
	assert.ok(
		room.frames.some((f) => f.holders.size > 0),
		'no line held a salmon',
	);
});

for (const [name, ids] of ROOM_CLIPS)
	for (const [screen, project] of [
		['Salmons’ mirrored screen', ISO_PROJECTOR_MIRRORED.project],
		['no projector', undefined],
	])
		check(`the room over ${name}, ${screen}: the same clip every frame`, () => {
			const run = replayRoom(room, BLOCKS, sheetOfCharacterClips, clipSource(ids), project);
			roomCompared += run.compared;
			assert.equal(run.differ, 0, run.first);
			assert.ok(run.compared > STEPS * 2 * 10, 'the room’s players were drawn');
			if (ids !== ALL_CLIPS) return;
			for (const state of ['hop', 'swipe', 'cast', 'caught'])
				assert.ok(run.oneShots[state] > 0, `no "${state}" played once (${name})`);
			for (const clip of ['fisherman_reel_', 'bear_walk_', 'salmon_golden_swim_'])
				assert.ok(
					run.log.some((line) => line.includes(clip)),
					`no ${clip}* drawn`,
				);
		});

check('made-up traces: every block, odd ones too, the same clip every frame', () => {
	const random = seeded(2026);
	const pick = (list) => list[Math.floor(random() * list.length)];
	let frames = 0;
	for (const [name, look] of [...LOOKS, ...ODD_LOOKS]) {
		const pool = [...lookedForClipIds(look)];
		for (let run = 0; run < 40; run++) {
			const share = run === 0 ? 1 : random();
			const clips = clipSource(pool.filter(() => random() < share));
			const old = createCharacterAnimator(look, clips);
			const neu = createSheetAnimator(sheetOfCharacterClips(look), clips);
			const project = pick([undefined, ISO_PROJECTOR.project, ISO_PROJECTOR_MIRRORED.project]);
			let atMs = 0;
			let v = { vx: 0, vy: 0 };
			let holding = false;
			let marked = false;
			for (let i = 0; i < 400; i++) {
				atMs += pick([8, 16, 16, 33, 120]);
				if (random() < 0.1) {
					const speed = pick([0, 0, 10, 200, 300]);
					const turn = random() * Math.PI * 2;
					v = { vx: Math.cos(turn) * speed, vy: Math.sin(turn) * speed };
				}
				if (random() < 0.03) holding = !holding;
				if (random() < 0.02) marked = !marked;
				if (random() < 0.08) {
					const event = pick(CHARACTER_CLIP_EVENTS);
					const signal =
						event === 'ability'
							? { ability: pick(['ability1', 'ability2']) }
							: event === 'caught'
								? CAUGHT
								: { event };
					assert.equal(old.event(event), neu.raise(signal), `${name}: has one for ${event}`);
				}
				if (random() < 0.01) {
					old.reset();
					neu.reset();
				}
				const a = old.frame({ atMs, ...v, holding, marked, project });
				const b = neu.frame({ atMs, ...v, statuses: statusesOf(marked, holding), project });
				const strip = (f) =>
					f && { clipId: f.clipId, flipX: f.flipX, loop: f.loop, play: f.play, marked: f.marked };
				assert.deepEqual(strip(b), strip(a), `${name}, run ${run}, frame ${i}`);
				assert.equal(neu.facing, old.facing, `${name}: facing`);
				assert.equal(neu.oneShot(atMs), old.oneShot(atMs), `${name}: one-shot`);
				for (const m of [false, true])
					assert.equal(
						neu.plays(CAUGHT, statusesOf(m)),
						old.plays('caught', m),
						`${name}: plays caught`,
					);
				frames += 1;
			}
		}
	}
	assert.equal(frames, 10 * 40 * 400);
});

// ── 3. What a sheet adds ─────────────────────────────────────────────────────────────────────

const hero = (view, actions, more = {}) => ({
	...(view ? { view } : {}),
	source: { kind: 'clips', prefix: 'hero', ...more.source },
	draw: { width: 64, ...more.draw },
	actions,
});
const source = (ids, cycle = {}) => ({ has: (id) => ids.includes(id), cycleMs: (id) => cycle[id] });
const MOVES = [
	{ id: 'idle', when: { motion: 'still' } },
	{ id: 'walk', when: { motion: 'moving' }, fallback: 'idle' },
];
/** What `sheet` draws for `action` facing `facing` out of `ids`: the clip, `~` when mirrored. */
const draws = (sheet, action, facing, ids, statuses = [], prefer) => {
	const clip = resolveSheetClip(sheet, action, facing, statuses, (id) => ids.includes(id), prefer);
	return clip && `${clip.clipId}${clip.flipX ? '~' : ''}`;
};
/** Frames of an animator moving at (vx, vy) from `atMs` for `ms`, a frame every 10 ms. */
const run = (animator, atMs, ms, vx = 0, vy = 0, more = {}) => {
	let frame;
	for (let t = atMs; t <= atMs + ms; t += 10) frame = animator.frame({ atMs: t, vx, vy, ...more });
	return frame;
};
const degrees = (turn) => [Math.sin((turn * Math.PI) / 180), -Math.cos((turn * Math.PI) / 180)];

check(
	'a sheet’s facings are its view’s (game-config `characterViewFacings`), and where it starts',
	() => {
		const views = [
			undefined,
			{ kind: 'side' },
			{ kind: 'side', mirror: false },
			{ kind: 'topDown' },
			{ kind: 'topDown', facings: 8 },
			{ kind: 'isometric' },
			{ kind: 'isometric', facings: 8 },
			{ kind: '3d' },
		];
		for (const view of views)
			assert.deepEqual(
				[...sheetFacings(hero(view, MOVES))].sort(),
				[...characterViewFacings(view)].sort(),
				JSON.stringify(view),
			);
		assert.deepEqual(
			views.map((view) => sheetStartFacing(hero(view, MOVES))),
			['se', 'e', 'e', 's', 's', 'se', 'se', 'se'],
		);
		assert.equal(createSheetAnimator(hero({ kind: 'topDown' }, MOVES), source([])).facing, 's');
		assert.equal(
			createSheetAnimator(hero({ kind: 'side' }, MOVES), source([]), 'n').facing,
			'e',
			'a facing its view does not have: its own start',
		);
		assert.equal(createSheetAnimator(hero({ kind: 'side' }, MOVES), source([]), 'w').facing, 'w');
	},
);

check('side: east or west by the sideways velocity; a straight jump keeps the facing', () => {
	assert.equal(clipFacingSideOf(1, 0, 'w'), 'e');
	assert.equal(clipFacingSideOf(-1, 0, 'e'), 'w');
	assert.equal(clipFacingSideOf(0, 0, 'w'), 'w', 'still keeps the last');
	assert.equal(clipFacingSideOf(0, -300, 'w'), 'w', 'straight up');
	assert.equal(clipFacingSideOf(0, 300, 'e'), 'e', 'straight down');
	const edge = CLIP_FACING_DEADBAND;
	assert.equal(clipFacingSideOf(edge - 0.01, -1, 'w'), 'w', 'inside the dead band');
	assert.equal(clipFacingSideOf(edge + 0.02, -1, 'w'), 'e', 'past it');
	const sheet = hero({ kind: 'side' }, MOVES);
	const a = createSheetAnimator(sheet, source(['hero_walk_e', 'hero_idle_e']));
	assert.equal(run(a, 0, 300, 200).clipId, 'hero_walk_e');
	const turning = a.frame({ atMs: 310, vx: -200, vy: 0 });
	assert.deepEqual([a.facing, turning.flipX], ['e', false], 'a turn waits');
	assert.equal(a.frame({ atMs: 310 + CLIP_TURN_MS - 1, vx: -200, vy: 0 }).flipX, false);
	const west = a.frame({ atMs: 310 + CLIP_TURN_MS, vx: -200, vy: 0 });
	assert.deepEqual([a.facing, west.clipId, west.flipX], ['w', 'hero_walk_e', true]);
	assert.equal(run(a, 600, 400, 0, -300).flipX, true, 'jumping straight up, it still faces west');
	assert.equal(a.facing, 'w');
	assert.equal(
		run(a, 1100, CLIP_MOVING_HOLD_MS + 20).clipId,
		'hero_idle_e',
		'standing still: its idle, facing as it was',
	);
	assert.equal(a.facing, 'w');
	// With no projector a side view reads the world's axes: (−200, −200) is leftwards. The 2:1
	// isometric projection of it is straight up, which would keep the facing.
	const b = createSheetAnimator(sheet, source(['hero_walk_e']));
	run(b, 0, 300, -200, -200);
	assert.equal(b.facing, 'w');
	const iso = createSheetAnimator(hero({ kind: 'isometric' }, MOVES), source(['hero_walk_se']));
	run(iso, 0, 300, -200, -200);
	assert.equal(iso.facing, 'ne', 'an isometric view projects it 2:1: straight up the screen');
});

check('top-down, four: the nearest of n e s w, with a dead band at the sector edges', () => {
	for (const [i, name] of CLIP_STRAIGHTS.entries()) {
		const opposite = CLIP_STRAIGHTS[(i + 2) % 4];
		for (const off of [0, -30, 30])
			assert.equal(clipFacing4Of(...degrees(i * 90 + off), opposite), name, `${name} ${off}°`);
	}
	assert.equal(clipFacing4Of(0, 0, 'w'), 'w', 'still keeps the last');
	const band = (CLIP_FACING8_DEADBAND * 180) / Math.PI;
	assert.equal(clipFacing4Of(...degrees(45), 'n'), 'n');
	assert.equal(clipFacing4Of(...degrees(45), 'e'), 'e');
	assert.equal(clipFacing4Of(...degrees(45 + band - 1), 'n'), 'n', 'inside the dead band');
	assert.equal(clipFacing4Of(...degrees(45 + band + 1), 'n'), 'e', 'past it');
	assert.equal(clipFacing4Of(...degrees(45 - band - 1), 'e'), 'n');
	let facing = 'n';
	for (let i = 0; i < 20; i++) facing = clipFacing4Of(...degrees(45 + (i % 2 ? 5 : -5)), facing);
	assert.equal(facing, 'n', 'swinging 5° either side of the edge: no flick');
	const sheet = hero({ kind: 'topDown' }, MOVES);
	const a = createSheetAnimator(sheet, source(['hero_walk_e', 'hero_walk_n']));
	assert.equal(run(a, 0, 300, 200, 0).clipId, 'hero_walk_e');
	assert.equal(a.facing, 'e', 'with no projector the world’s +x is the screen’s east');
	const west = run(a, 310, 300, -200, 0);
	assert.deepEqual([a.facing, west.clipId, west.flipX], ['w', 'hero_walk_e', true]);
	assert.equal(run(a, 620, 300, 0, -200).clipId, 'hero_walk_n');
	assert.equal(run(a, 930, 300, 0, 200).clipId, 'hero_walk_e', 'south: a side as made, east first');
	assert.equal(draws(sheet, 'walk', 'n', ['hero_walk_s', 'hero_walk_w']), 'hero_walk_w~');
	assert.equal(draws(sheet, 'walk', 'n', ['hero_walk_s']), 'hero_walk_s', 'its opposite, last');
	assert.equal(draws(sheet, 'walk', 'e', ['hero_walk_se']), undefined, 'a diagonal is no stand-in');
	assert.equal(draws(sheet, 'walk', 'n', ['hero_walk_e', 'hero_walk_w'], [], 'w'), 'hero_walk_w');
});

check('top-down, eight: flat, whatever the screen’s projection', () => {
	// A screen direction 14° below east: east on a flat screen, south-east on the 2:1 one.
	const world = ISO_PROJECTOR.unproject(400, 100);
	const ids = CLIP_FACINGS.map((f) => `hero_walk_${f}`);
	const flat = createSheetAnimator(hero({ kind: 'topDown', facings: 8 }, MOVES), source(ids));
	const iso = createSheetAnimator(hero({ kind: 'isometric', facings: 8 }, MOVES), source(ids));
	const more = { project: ISO_PROJECTOR.project };
	assert.equal(run(flat, 0, 300, world.x, world.y, more).clipId, 'hero_walk_e');
	assert.equal(run(iso, 0, 300, world.x, world.y, more).clipId, 'hero_walk_se');
	const bare = createSheetAnimator(hero({ kind: 'topDown', facings: 8 }, MOVES), source(ids));
	assert.equal(run(bare, 0, 300, 400, 100).clipId, 'hero_walk_e', 'no projector: the world’s axes');
	assert.equal(run(bare, 310, 300, 300, 300).clipId, 'hero_walk_se');
	assert.equal(run(bare, 620, 300, 0, -300).clipId, 'hero_walk_n');
	assert.equal(run(bare, 930, 20).clipId, 'hero_walk_n', 'stopping keeps the facing');
});

check('mirror: false — no clip is drawn mirrored; the other facings stand in as made', () => {
	const side = hero({ kind: 'side', mirror: false }, MOVES);
	assert.equal(draws(side, 'idle', 'w', ['hero_idle_e']), 'hero_idle_e');
	assert.equal(draws(hero({ kind: 'side' }, MOVES), 'idle', 'w', ['hero_idle_e']), 'hero_idle_e~');
	const four = hero({ kind: 'isometric', mirror: false }, MOVES);
	assert.equal(draws(four, 'idle', 'se', ['hero_idle_sw']), 'hero_idle_sw');
	assert.equal(draws(four, 'idle', 'se', ['hero_idle_sw', 'hero_idle_ne']), 'hero_idle_ne');
	assert.equal(
		draws(hero({ kind: 'isometric' }, MOVES), 'idle', 'se', ['hero_idle_sw']),
		'hero_idle_sw~',
	);
	const eight = hero({ kind: 'isometric', facings: 8, mirror: false }, MOVES);
	assert.equal(draws(eight, 'idle', 'w', ['hero_idle_e', 'hero_idle_n']), 'hero_idle_n');
	assert.equal(draws(eight, 'idle', 'w', ['hero_idle_e']), 'hero_idle_e', 'its opposite, as made');
	assert.equal(
		draws(hero({ kind: 'isometric', facings: 8 }, MOVES), 'idle', 'w', [
			'hero_idle_e',
			'hero_idle_n',
		]),
		'hero_idle_e~',
	);
	const top = hero({ kind: 'topDown', mirror: false }, MOVES);
	assert.equal(draws(top, 'idle', 'w', ['hero_idle_e', 'hero_idle_n']), 'hero_idle_n');
	for (const sheet of [side, four, eight, top])
		for (const facing of CLIP_FACINGS)
			for (const made of sheetFacings(sheet)) {
				const clip = resolveSheetClip(
					sheet,
					'idle',
					facing,
					[],
					(id) => id === `hero_idle_${made}`,
				);
				if (clip) assert.equal(clip.flipX, false);
			}
});

const BEAR = hero({ kind: 'isometric', facings: 8 }, [
	...MOVES,
	{ id: 'swipe', when: { ability: 'ability1' }, fallback: 'idle' },
	{ id: 'roar', when: { ability: 'ability2' } },
	{ id: 'grab', when: { event: 'caught' }, anim: { e: { clip: 'bear_grab_side' } } },
	{ id: 'caught', when: { event: 'caught', as: 'target' } },
	{ id: 'dizzy', when: { status: 'stunned' } },
]);

check('an `anim` cell names the clip of its facing; the others are found by name', () => {
	assert.equal(draws(BEAR, 'grab', 'e', ['bear_grab_side', 'hero_grab_e']), 'bear_grab_side');
	assert.equal(draws(BEAR, 'grab', 'w', ['bear_grab_side']), 'bear_grab_side~');
	assert.equal(draws(BEAR, 'grab', 'e', ['hero_grab_e']), undefined, 'the cell is the clip');
	assert.equal(draws(BEAR, 'grab', 'n', ['hero_grab_n', 'bear_grab_side']), 'hero_grab_n');
	assert.equal(
		resolveSheetClip(BEAR, 'grab', 'w', [], (id) => id === 'bear_grab_side').facing,
		'w',
		'seen facing west',
	);
});

check(
	'a variant’s clips are tried first while its status holds, each through the fallbacks',
	() => {
		const sheet = hero({ kind: 'isometric' }, MOVES, {
			source: { variants: { marked: 'hero_gold', stunned: 'hero_dizzy' } },
		});
		const ids = ['hero_idle_se', 'hero_gold_idle_se', 'hero_dizzy_walk_se', 'hero_walk_se'];
		const of = (action, statuses) => {
			const clip = resolveSheetClip(sheet, action, 'se', statuses, (id) => ids.includes(id));
			return [clip.clipId, clip.variant];
		};
		assert.deepEqual(of('idle', []), ['hero_idle_se', undefined]);
		assert.deepEqual(of('idle', ['marked']), ['hero_gold_idle_se', 'marked']);
		assert.deepEqual(of('walk', ['marked']), ['hero_gold_idle_se', 'marked'], 'its fallback first');
		assert.deepEqual(of('walk', ['stunned']), ['hero_dizzy_walk_se', 'stunned']);
		assert.deepEqual(
			of('walk', ['stunned', 'marked']),
			['hero_gold_idle_se', 'marked'],
			'sheet order',
		);
		assert.deepEqual(of('idle', ['stunned']), ['hero_idle_se', undefined]);
		const a = createSheetAnimator(sheet, source(ids));
		const gold = a.frame({ atMs: 0, vx: 0, vy: 0, statuses: ['marked'] });
		assert.deepEqual([gold.marked, gold.variant], [true, 'marked'], 'drawn as made, not tinted');
		const dizzy = run(a, 10, 100, 200, 0, { statuses: ['stunned'] });
		assert.deepEqual(
			[dizzy.clipId, dizzy.marked, dizzy.variant],
			['hero_dizzy_walk_se', false, 'stunned'],
		);
	},
);

const BEAR_CLIPS = ['idle', 'walk', 'swipe', 'roar', 'grab', 'caught', 'dizzy'].map(
	(action) => `hero_${action}_se`,
);

check('each ability button has its own action; the room’s signal names the button', () => {
	const a = createSheetAnimator(
		BEAR,
		source(BEAR_CLIPS, { hero_roar_se: 300, hero_swipe_se: 300 }),
	);
	a.frame({ atMs: 0, vx: 0, vy: 0 });
	const press = (button) => sheetSignalsOf('ability', { player: 'p1', button, mine: true });
	assert.deepEqual(press('ability2'), [{ id: 'p1', signal: { ability: 'ability2' } }]);
	assert.equal(a.raise(press('ability2')[0].signal), true);
	assert.equal(a.frame({ atMs: 10, vx: 0, vy: 0 }).clipId, 'hero_roar_se');
	assert.equal(a.raise(press('ability1')[0].signal), true);
	assert.equal(a.frame({ atMs: 20, vx: 0, vy: 0 }).clipId, 'hero_swipe_se');
	assert.deepEqual(press('jump'), [], 'no action for a button that is no ability');
	assert.deepEqual(
		[a.actionOf({ ability: 'ability1' }), a.actionOf({ ability: 'ability2' })],
		['swipe', 'roar'],
	);
});

check('an event starts one action for its user and another for its target', () => {
	const signals = sheetSignalsOf('caught', { by: 'bear1', target: 'fish1', effect: 'catch' });
	assert.deepEqual(signals, [
		{ id: 'bear1', signal: { event: 'caught' } },
		{ id: 'fish1', signal: { event: 'caught', as: 'target' } },
	]);
	const user = createSheetAnimator(BEAR, source(BEAR_CLIPS));
	const target = createSheetAnimator(BEAR, source(BEAR_CLIPS));
	user.raise(signals[0].signal);
	target.raise(signals[1].signal);
	assert.equal(user.frame({ atMs: 0, vx: 0, vy: 0 }).clipId, 'hero_grab_se');
	assert.equal(target.frame({ atMs: 0, vx: 0, vy: 0 }).clipId, 'hero_caught_se');
	assert.deepEqual(sheetSignalsOf('jumped', { player: 'fish1', x: 1, y: 2, me: false }), [
		{ id: 'fish1', signal: { event: 'jumped' } },
	]);
	assert.deepEqual(sheetSignalsOf('countdown', { seconds: 3 }), []);
	assert.equal(user.raise({ event: 'jumped' }), false, 'no action for it');
	assert.equal(user.plays({ event: 'caught', as: 'target' }), true);
	assert.equal(
		createSheetAnimator(BEAR, source(['hero_idle_se'])).plays({ ability: 'ability1' }),
		false,
		'only its fallback has a clip',
	);
});

check('a status loop outranks a motion loop; `priority` overrides; a tie is the first row', () => {
	const a = createSheetAnimator(BEAR, source(BEAR_CLIPS));
	assert.equal(run(a, 0, 100, 200, 0).clipId, 'hero_walk_se');
	assert.equal(run(a, 110, 100, 200, 0, { statuses: ['stunned'] }).clipId, 'hero_dizzy_se');
	assert.equal(run(a, 220, 100, 200, 0, { statuses: ['free'] }).clipId, 'hero_walk_se');
	const urgent = hero({ kind: 'isometric' }, [
		{ id: 'idle', when: { motion: 'still' } },
		{ id: 'walk', when: { motion: 'moving' }, priority: 5 },
		{ id: 'dizzy', when: { status: 'stunned' } },
		{ id: 'cold', when: { status: 'stunned' } },
	]);
	const b = createSheetAnimator(urgent, source(BEAR_CLIPS.concat('hero_cold_se')));
	assert.equal(run(b, 0, 100, 200, 0, { statuses: ['stunned'] }).clipId, 'hero_walk_se');
	assert.equal(
		run(b, 110, CLIP_MOVING_HOLD_MS + 50, 0, 0, { statuses: ['stunned'] }).clipId,
		'hero_dizzy_se',
		'of two as high, the first in the sheet',
	);
	for (const action of [...BEAR.actions, ...urgent.actions]) {
		const triggers = [action.when].flat();
		const once = triggers.some((t) => 'ability' in t || 'event' in t);
		assert.equal(characterActionPlay(action), once ? 'once' : 'loop', action.id);
	}
});

/** A sheet of three one-shots (`low` 3, `high` 7, `same` 3), `low` with `more`; all 1000 ms. */
const cutting = (more) =>
	createSheetAnimator(
		hero({ kind: 'isometric' }, [
			{ id: 'idle', when: { motion: 'still' } },
			{ id: 'low', when: { event: 'low' }, ...more },
			{ id: 'same', when: { event: 'same' } },
			{ id: 'high', when: { event: 'high' }, priority: 7 },
			{ id: 'under', when: { event: 'under' }, priority: 2 },
		]),
		source(['idle', 'low', 'same', 'high', 'under'].map((action) => `hero_${action}_se`)),
	);
/** `low` started at 0, `event` raised at 100: what plays at 110. */
const after = (more, event) => {
	const a = cutting(more);
	a.raise({ event: 'low' });
	a.frame({ atMs: 0, vx: 0, vy: 0 });
	a.raise({ event });
	return a.frame({ atMs: 110, vx: 0, vy: 0 }).clipId.slice('hero_'.length, -'_se'.length);
};

check(
	'interrupt: any other once (absent), one as high or higher (`priority`), nothing (`none`)',
	() => {
		assert.deepEqual(
			['under', 'same', 'high'].map((event) => after({}, event)),
			['under', 'same', 'high'],
		);
		assert.deepEqual(
			['under', 'same', 'high'].map((event) => after({ interrupt: 'priority' }, event)),
			['low', 'same', 'high'],
		);
		assert.deepEqual(
			['under', 'same', 'high'].map((event) => after({ interrupt: 'none' }, event)),
			['low', 'low', 'low'],
		);
		const a = cutting({ interrupt: 'none' });
		a.raise({ event: 'low' });
		a.frame({ atMs: 0, vx: 0, vy: 0 });
		a.raise({ event: 'high' });
		a.frame({ atMs: 100, vx: 0, vy: 0 });
		assert.equal(
			a.frame({ atMs: CLIP_ONE_SHOT_MS, vx: 0, vy: 0 }).clipId,
			'hero_idle_se',
			'one refused is not kept for later; a loop never cuts a once, and resumes after it',
		);
	},
);

check('again: it restarts (absent), or plays on (`ignore`)', () => {
	const again = (more) => {
		const a = cutting(more);
		a.raise({ event: 'low' });
		const first = a.frame({ atMs: 0, vx: 0, vy: 0 });
		a.raise({ event: 'low' });
		const second = a.frame({ atMs: 600, vx: 0, vy: 0 });
		return [second.play === first.play, a.oneShot(CLIP_ONE_SHOT_MS + 100)];
	};
	assert.deepEqual(again({}), [false, 'low'], 'a new play, a new length');
	assert.deepEqual(again({ again: 'ignore' }), [true, undefined], 'the same play, to its own end');
	assert.deepEqual(again({ interrupt: 'none' }), [false, 'low'], '`interrupt` is about the others');
});

check('a once starts on the next frame, the last of two wins, and it keeps its facing', () => {
	const ids = ['hero_idle_se', 'hero_walk_se', 'hero_walk_ne', 'hero_swipe_se', 'hero_roar_se'];
	const a = createSheetAnimator(BEAR, source(ids, { hero_roar_se: 500 }));
	a.frame({ atMs: 0, vx: 0, vy: 0 });
	a.raise({ ability: 'ability1' });
	a.raise({ ability: 'ability2' });
	assert.equal(a.oneShot(0), 'roar', 'waiting');
	const roar = a.frame({ atMs: 10, vx: 0, vy: 0 });
	assert.deepEqual([roar.clipId, roar.loop, roar.action], ['hero_roar_se', false, 'roar']);
	const north = ISO_PROJECTOR.unproject(0, -300);
	assert.equal(run(a, 20, 400, north.x, north.y).clipId, 'hero_roar_se');
	assert.equal(a.facing, 'n', 'it turned under the roar');
	const then = run(a, 520, 20, north.x, north.y);
	assert.deepEqual(
		[then.clipId, then.loop],
		['hero_walk_ne', true],
		'then the loop, as it faces now',
	);
	const b = createSheetAnimator(BEAR, source(['hero_idle_se']));
	b.frame({ atMs: 0, vx: 0, vy: 0 });
	b.raise({ ability: 'ability1' });
	const idle = b.frame({ atMs: 10, vx: 0, vy: 0 });
	assert.deepEqual(
		[idle.loop, b.oneShot(10)],
		[true, undefined],
		'one that falls back to the loop',
	);
});

check('a loop of fallbacks ends; an unknown action or fallback draws nothing', () => {
	const sheet = hero({ kind: 'isometric' }, [
		{ id: 'a', when: { motion: 'still' }, fallback: 'b' },
		{ id: 'b', fallback: 'c' },
		{ id: 'c', fallback: 'a' },
		{ id: 'self', fallback: 'self' },
		{ id: 'lost', fallback: 'nowhere' },
	]);
	const asked = [];
	const clip = resolveSheetClip(sheet, 'a', 'se', [], (id) => (asked.push(id), false));
	assert.equal(clip, undefined);
	assert.equal(asked.length, 3 * 4, 'each action once, in its four facings');
	assert.equal(draws(sheet, 'b', 'se', ['hero_a_se']), 'hero_a_se', 'round the loop to it');
	assert.equal(draws(sheet, 'self', 'se', []), undefined);
	assert.equal(draws(sheet, 'lost', 'se', ['hero_nowhere_se']), undefined);
	assert.equal(draws(sheet, 'nowhere', 'se', ['hero_nowhere_se']), undefined);
	const a = createSheetAnimator(sheet, source([]));
	assert.equal(a.frame({ atMs: 0, vx: 0, vy: 0 }), undefined);
});

check('a sheet with no playable source gives nothing', () => {
	const none = [
		{},
		{ view: { kind: 'isometric' }, actions: MOVES, draw: { width: 64 } },
		{ ...hero({ kind: 'isometric' }, MOVES), source: { kind: 'rig', rig: 'hero' } },
		{ ...hero({ kind: 'isometric' }, MOVES), draw: undefined },
		hero({ kind: 'isometric' }, []),
		hero({ kind: '3d' }, MOVES),
	];
	for (const sheet of none) {
		assert.equal(sheetPlaysClips(sheet), false, JSON.stringify(sheet));
		assert.equal(
			resolveSheetClip(sheet, 'idle', 'se', [], () => true),
			undefined,
		);
		const a = createSheetAnimator(sheet, source(['hero_idle_se']));
		assert.equal(a.frame({ atMs: 0, vx: 0, vy: 0 }), undefined);
		assert.equal(a.raise({ event: 'caught' }), false);
		assert.equal(a.plays({ event: 'caught' }), false);
	}
	assert.equal(sheetPlaysClips(undefined), false);
	assert.equal(sheetPlaysClips(hero(undefined, MOVES)), true, 'no view: isometric, four');
	assert.equal(draws(hero(undefined, MOVES), 'idle', 'sw', ['hero_idle_se']), 'hero_idle_se~');
});

// ── 4. A class's sheet, off the raw config ───────────────────────────────────────────────────

check('a class’s sheet is read off the raw config; a config with none yields none', () => {
	const plain = salmonsConfig();
	for (const cls of plain.arcade.online.characters)
		assert.equal(onlineClassSheetOf(plain, cls.id), undefined, `${cls.id}: Salmons has no sheet`);
	const sheet = sheetOfCharacterClips(bear);
	const withSheet = (edit) => {
		const doc = structuredClone(plain);
		const bot = doc.arcade.characters.find((c) => c.id === 'bearBot');
		Object.assign(bot, structuredClone(sheet));
		doc.arcade.online.characters.find((c) => c.id === 'bear').sheet = 'bearBot';
		edit?.(doc, bot);
		return doc;
	};
	assert.deepEqual(onlineClassSheetOf(withSheet(), 'bear'), { id: 'bearBot', sheet });
	assert.equal(sheetPlaysClips(onlineClassSheetOf(withSheet(), 'bear').sheet), true);
	assert.equal(onlineClassSheetOf(withSheet(), 'salmon'), undefined, 'a class that names none');
	const named = (id) => (doc) => {
		doc.arcade.online.characters.find((c) => c.id === 'bear').sheet = id;
	};
	assert.equal(onlineClassSheetOf(withSheet(named('nobody')), 'bear'), undefined, 'missing');
	assert.equal(
		onlineClassSheetOf(withSheet(named('fishermanBot')), 'bear'),
		undefined,
		'a character of another component',
	);
	const bare = withSheet((doc, bot) => {
		for (const field of ['view', 'source', 'draw', 'actions']) delete bot[field];
	});
	assert.equal(onlineClassSheetOf(bare, 'bear'), undefined, 'a character with no sheet fields');
	const rig = withSheet((doc, bot) => {
		bot.source = { kind: 'rig', rig: 'bear' };
	});
	assert.equal(
		sheetPlaysClips(onlineClassSheetOf(rig, 'bear')?.sheet),
		false,
		'a source this build does not play: the class plays as one with no sheet',
	);
	assert.equal(
		onlineClassSheetOf(normalizeGameConfigDoc(withSheet()), 'bear'),
		undefined,
		'carried, not normalized: the runtime reads the config as baked',
	);
	assert.deepEqual(
		normalizeGameConfigDoc(withSheet()),
		normalizeGameConfigDoc(plain),
		'and the room’s game is the same with or without it',
	);
});

// ── 5. The draw ──────────────────────────────────────────────────────────────────────────────

check('the draw: the block’s width, feet and points, mirrored and not', () => {
	const box = { w: 32, h: 64 };
	for (const [name, look] of [...LOOKS, ...ODD_LOOKS]) {
		const sheet = sheetOfCharacterClips(look);
		assert.deepEqual(
			sheetDraw(sheet),
			{ width: look.displayWidth, anchorY: look.anchorY ?? 1 },
			name,
		);
		for (const flipX of [false, true])
			assert.deepEqual(sheetClipPoints(sheet, box, flipX), clipPoints(look, box, flipX), name);
	}
	const sheet = hero({ kind: 'side' }, MOVES, {
		draw: { feet: 0.75, points: { head: { x: 0.5, y: 0 }, toe: { x: 1, y: 0.75 } } },
	});
	assert.deepEqual(sheetPoint(sheet, 'head', box, false), { dx: 0, lift: 0.75 * 128 });
	assert.deepEqual(sheetPoint(sheet, 'toe', box, true), { dx: -32, lift: 0 });
	assert.equal(sheetPoint(sheet, 'hand', box, false), undefined, 'a point it does not name');
	assert.deepEqual(
		sheetClipPoints(sheet, box, false).hand,
		{ dx: (CLIP_HAND.x - 0.5) * 64, lift: (0.75 - CLIP_HAND.y) * 128 },
		'its hand, where a line starts, is CLIP_HAND when it names none',
	);
});

// ── 6. The proof can fail ────────────────────────────────────────────────────────────────────

/** `sheetOfCharacterClips`, then `edit` on a copy of the sheet. */
const mutant = (edit) => (look) => {
	const sheet = structuredClone(sheetOfCharacterClips(look));
	edit(sheet);
	return sheet;
};
const withoutTrigger = (id, drop) => (sheet) => {
	const action = sheet.actions.find((a) => a.id === id);
	if (!action) return;
	const kept = [action.when].flat().filter((trigger) => !drop(trigger));
	action.when = kept.length === 1 ? kept[0] : kept.length ? kept : undefined;
};
const GRID_MUTANTS = [
	[
		'a converter that writes no fallback',
		(sheet) => sheet.actions.forEach((a) => delete a.fallback),
	],
	[
		'a converter that writes no row for a state only a fallback reaches',
		(sheet) => (sheet.actions = sheet.actions.filter((a) => a.when)),
	],
	['a stand-in order with no mirrored clip', (sheet) => (sheet.view.mirror = false)],
	['every look read as four facings', (sheet) => delete sheet.view.facings],
	['a top-down stand-in order', (sheet) => (sheet.view.kind = 'topDown')],
	['no marked variant', (sheet) => delete sheet.source.variants],
	['a clip named by a cell', (sheet) => (sheet.actions[0].anim = { se: { clip: 'elsewhere' } })],
	[
		'fallbacks reversed',
		(sheet) => sheet.actions.forEach((a) => a.fallback && (a.fallback = sheet.actions[0].id)),
	],
];

for (const [name, edit] of GRID_MUTANTS)
	check(`the grid goes red on: ${name}`, () => {
		const { differ } = compareGrid(mutant(edit));
		assert.ok(differ > 0, 'the grid did not see it');
	});

const ROOM_MUTANTS = [
	['caught heard as its user, not its target', withoutTrigger('caught', (t) => t.as === 'target')],
	['no action on ability1', withoutTrigger('swipe', (t) => t.ability === 'ability1')],
	['a cast that is not started by an ability', withoutTrigger('cast', (t) => 'ability' in t)],
	['a climb that plays no hop', withoutTrigger('hop', (t) => t.event === 'climbed')],
	['a jump that plays no hop', withoutTrigger('hop', (t) => t.event === 'jumped')],
	['no reel while the line holds', withoutTrigger('reel', (t) => 'status' in t)],
	[
		'walking that outranks reeling',
		(sheet) => {
			const walk = sheet.actions.find((a) => a.id === 'walk' && a.when);
			if (walk) walk.priority = 5;
		},
	],
	[
		'a salmon that does not swim while moving',
		withoutTrigger('swim', (t) => t.motion === 'moving'),
	],
	[
		'a swipe that does not start again',
		(sheet) => {
			const swipe = sheet.actions.find((a) => a.id === 'swipe');
			if (swipe) swipe.again = 'ignore';
		},
	],
	['a side view', (sheet) => (sheet.view = { kind: 'side' })],
	['no marked variant', (sheet) => delete sheet.source.variants],
];

for (const [name, edit] of ROOM_MUTANTS)
	check(`the room goes red on: ${name}`, () => {
		const clips = clipSource(ALL_CLIPS);
		const run = replayRoom(room, BLOCKS, mutant(edit), clips, ISO_PROJECTOR_MIRRORED.project);
		assert.ok(run.differ > 0, 'the room did not see it');
	});

check('the room goes red on a bear played by the fisherman’s sheet', () => {
	const swapped = replayRoom(
		room,
		BLOCKS,
		(block, character) => sheetOfCharacterClips(character === 'bear' ? fisherman : block),
		clipSource(ALL_CLIPS),
		undefined,
	);
	assert.ok(swapped.differ > 0, 'the room did not see it');
});

// ── 7. What it costs ─────────────────────────────────────────────────────────────────────────

const COST_FRAMES = 1000;

/** Mean ns a player-frame: 100 players of `make()` for `frames` frames, an ability now and then. */
function cost(make, sample, raise, frames = COST_FRAMES) {
	const players = Array.from({ length: 100 }, make);
	const random = seeded(7);
	const moves = players.map(() => {
		const turn = random() * Math.PI * 2;
		return { vx: Math.cos(turn) * 200, vy: Math.sin(turn) * 200 };
	});
	const start = process.hrtime.bigint();
	for (let f = 0; f < frames; f++)
		for (let p = 0; p < players.length; p++) {
			if ((f + p * 7) % 90 === 0) raise(players[p]);
			const still = (f + p * 13) % 300 < 60;
			players[p].frame(
				sample(f * 16.7, still ? 0 : moves[p].vx, still ? 0 : moves[p].vy, p % 9 === 0),
			);
		}
	return Number(process.hrtime.bigint() - start) / (frames * players.length);
}

function costs() {
	const rows = [];
	for (const [name, look] of [
		['bear (8 facings)', bear],
		['fisherman (8 facings)', fisherman],
		['salmon (4 facings, marked prefix)', salmon],
	]) {
		const sheet = sheetOfCharacterClips(look);
		for (const [set, ids] of [
			['every clip', [...lookedForClipIds(look)]],
			['no clip', []],
		]) {
			const clips = clipSource(ids);
			const old = () =>
				cost(
					() => createCharacterAnimator(look, clips),
					(atMs, vx, vy, flag) => ({
						atMs,
						vx,
						vy,
						holding: flag,
						marked: flag,
						project: ISO_PROJECTOR_MIRRORED.project,
					}),
					(a) => a.event('ability'),
				);
			const neu = () =>
				cost(
					() => createSheetAnimator(sheet, clips),
					(atMs, vx, vy, flag) => ({
						atMs,
						vx,
						vy,
						statuses: flag ? ['holding', 'marked', 'free'] : ['free'],
						project: ISO_PROJECTOR_MIRRORED.project,
					}),
					(a) => a.raise({ ability: 'ability1' }),
				);
			// Warm both, then take the best of three of each, in turn.
			old();
			neu();
			const best = (fn) => Math.min(fn(), fn(), fn());
			rows.push([name, set, best(old), best(neu)]);
		}
	}
	return rows;
}

// ── 8. A rig source and a still image (C6a) ──────────────────────────────────────────────────

const VIEWS = [
	{ kind: 'side' },
	{ kind: 'topDown' },
	{ kind: 'topDown', facings: 8 },
	{ kind: 'isometric' },
	{ kind: 'isometric', facings: 8 },
];
const RIG_ACTIONS = [
	{ id: 'idle', when: { motion: 'still' } },
	{ id: 'walk', when: { motion: 'moving' }, fallback: 'idle' },
	{ id: 'swipe', when: { ability: 'ability1' }, fallback: 'idle' },
];
const rigged = (view, source, actions = RIG_ACTIONS, draw = {}) => ({
	...(view ? { view } : {}),
	source: { kind: 'rig', ...source },
	draw: { width: 64, ...draw },
	actions,
});
/** A rig source over `{ rig: { animation: ms } }`, and the skins each rig has. */
const rigs = (animations, skins) => ({
	has: (rig, animation) => Object.hasOwn(animations[rig] ?? {}, animation),
	durationMs: (rig, animation) => animations[rig]?.[animation],
	...(skins ? { hasSkin: (rig, skin) => (skins[rig] ?? []).includes(skin) } : {}),
});
const each = (names, ms = 500) => Object.fromEntries(names.map((name) => [name, ms]));
/** What `sheet` draws for `action` facing `facing`: `<rig>/<animation>`, `~` when mirrored. */
const rigDraws = (sheet, action, facing, source, statuses = [], prefer) => {
	const found = resolveSheetRig(sheet, action, facing, statuses, source, prefer);
	return found && `${found.rig}/${found.animation}${found.flipX ? '~' : ''}`;
};
const LOOKS_WEST = ['w', 'sw', 'nw'];
/** Every action and facing of a sheet, against what `expected(action, facing)` says. */
const rigTable = (sheet, source, expected) => {
	let cells = 0;
	for (const action of sheet.actions)
		for (const facing of sheetFacings(sheet)) {
			assert.equal(
				rigDraws(sheet, action.id, facing, source),
				expected(action.id, facing),
				`${JSON.stringify(sheet.view)} ${action.id} ${facing}`,
			);
			cells += 1;
		}
	return cells;
};
let rigCells = 0;

const ONE_RIG = rigs({ hero: each(['idle', 'walk', 'swipe']) });
const oneRig = (action, facing) => `hero/${action}${LOOKS_WEST.includes(facing) ? '~' : ''}`;
check('one rig: the action’s animation in every facing, mirrored in those that look west', () => {
	for (const view of [undefined, ...VIEWS])
		rigCells += rigTable(rigged(view, { rig: 'hero' }), ONE_RIG, oneRig);
	for (const view of VIEWS)
		rigCells += rigTable(
			rigged({ ...view, mirror: false }, { rig: 'hero' }),
			ONE_RIG,
			(action) => `hero/${action}`,
		);
});

/** The animations of one rig named for the facings a view draws as made (not looking west). */
const perFacing = (view, actions = ['idle', 'walk', 'swipe']) =>
	actions.flatMap((action) =>
		characterViewFacings(view)
			.filter((facing) => !LOOKS_WEST.includes(facing))
			.map((facing) => `${action}_${facing}`),
	);
const byFacing = (rig) => (action, facing) =>
	LOOKS_WEST.includes(facing)
		? `${rig}/${action}_${clipMirrorOf(facing)}~`
		: `${rig}/${action}_${facing}`;
check(
	'one rig, an animation per facing: each as made, a facing that looks west by its twin',
	() => {
		for (const view of VIEWS)
			rigCells += rigTable(
				rigged(view, { rig: 'hero' }),
				rigs({ hero: each(perFacing(view)) }),
				byFacing('hero'),
			);
		const source = rigs({ hero: each([...perFacing({ kind: 'side' }), 'idle', 'walk', 'swipe']) });
		assert.equal(
			rigDraws(rigged({ kind: 'side' }, { rig: 'hero' }), 'walk', 'w', source),
			'hero/walk_e~',
			'an animation named for a facing is tried, through every stand-in, before the action’s own',
		);
	},
);

check('a rig per facing: each facing its own rig, the others stood in for as clips are', () => {
	for (const view of VIEWS) {
		const made = characterViewFacings(view).filter((facing) => !LOOKS_WEST.includes(facing));
		const sheet = rigged(view, {
			rigs: Object.fromEntries(made.map((facing) => [facing, `hero_${facing}`])),
		});
		const source = rigs(
			Object.fromEntries(made.map((f) => [`hero_${f}`, each(['idle', 'walk', 'swipe'])])),
		);
		rigCells += rigTable(sheet, source, (action, facing) =>
			LOOKS_WEST.includes(facing)
				? `hero_${clipMirrorOf(facing)}/${action}~`
				: `hero_${facing}/${action}`,
		);
	}
	const frontBack = rigged({ kind: 'isometric' }, { rigs: { se: 'front', ne: 'back' } });
	const source = rigs({ front: each(['idle', 'walk_se']), back: each(['idle']) });
	assert.equal(rigDraws(frontBack, 'walk', 'se', source), 'front/walk_se', 'named for its facing');
	assert.equal(
		rigDraws(frontBack, 'walk', 'nw', source),
		'front/walk_se~',
		'a facing whose rigs lack the action: the last stand-in’s, before the fallback action',
	);
	assert.equal(rigDraws(frontBack, 'idle', 'nw', source), 'back/idle~');
	const eight = rigged({ kind: 'isometric', facings: 8 }, { rigs: { s: 'front', n: 'back' } });
	const two = rigs({ front: each(['idle']), back: each(['idle']) });
	assert.deepEqual(
		['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].map((f) => rigDraws(eight, 'idle', f, two)),
		[
			'back/idle',
			'back/idle',
			'front/idle',
			'front/idle',
			'front/idle',
			'front/idle',
			'front/idle',
			'back/idle',
		],
		'two rigs for eight facings: the nearest outward, towards the viewer of two as near',
	);
	const both = rigged({ kind: 'isometric' }, { rig: 'hero', rigs: { ne: 'back' } });
	const mixed = rigs({ hero: each(['idle']), back: each(['idle']) });
	assert.deepEqual(
		['ne', 'se', 'sw', 'nw'].map((f) => rigDraws(both, 'idle', f, mixed)),
		['back/idle', 'back/idle', 'back/idle~', 'back/idle~'],
		'a facing’s own rig stands in before the one rig’s plain animation',
	);
	assert.equal(
		rigDraws(both, 'idle', 'se', rigs({ hero: each(['idle']), back: {} })),
		'hero/idle',
		'…which is drawn when no facing has one',
	);
});

check('a cell names the animation, and another rig; the other facings are found by name', () => {
	const sheet = rigged({ kind: 'side' }, { rig: 'hero' }, [
		{ id: 'idle', when: { motion: 'still' } },
		{
			id: 'swipe',
			when: { ability: 'ability1' },
			anim: { e: { anim: 'attack' }, w: { anim: 'slash_left', rig: 'lefty' } },
		},
		{ id: 'roar', when: { ability: 'ability2' }, anim: { e: { anim: 'shout' } } },
	]);
	const source = rigs({
		hero: each(['idle', 'attack', 'shout', 'swipe']),
		lefty: each(['slash_left']),
	});
	assert.equal(rigDraws(sheet, 'swipe', 'e', source), 'hero/attack');
	assert.equal(rigDraws(sheet, 'swipe', 'w', source), 'lefty/slash_left', 'as made: not mirrored');
	assert.equal(rigDraws(sheet, 'roar', 'w', source), 'hero/shout~', 'its twin’s cell, mirrored');
	assert.equal(rigDraws(sheet, 'idle', 'w', source), 'hero/idle~');
	assert.equal(
		rigDraws(sheet, 'swipe', 'e', rigs({ hero: each(['idle', 'swipe']), lefty: {} })),
		'hero/swipe',
		'a cell whose animation the rig lacks: the next stand-in, then the action’s own name',
	);
});

check('a rig: the fallback action, a rig not loaded, a sheet that is not a rig', () => {
	const sheet = rigged({ kind: 'isometric' }, { rig: 'hero' });
	assert.equal(rigDraws(sheet, 'walk', 'sw', rigs({ hero: each(['idle']) })), 'hero/idle~');
	assert.equal(rigDraws(sheet, 'walk', 'sw', rigs({})), undefined, 'not loaded: nothing yet');
	assert.equal(rigDraws(sheet, 'nowhere', 'se', ONE_RIG), undefined);
	assert.equal(sheetPlaysRig(sheet), true);
	assert.equal(sheetPlaysClips(sheet), false);
	const none = [
		hero({ kind: 'isometric' }, MOVES),
		rigged({ kind: '3d' }, { rig: 'hero' }),
		rigged({ kind: 'side' }, {}),
		rigged({ kind: 'side' }, { rigs: {} }),
		{ ...rigged({ kind: 'side' }, { rig: 'hero' }), draw: undefined },
		rigged({ kind: 'side' }, { rig: 'hero' }, []),
	];
	for (const other of none) {
		assert.equal(sheetPlaysRig(other), false, JSON.stringify(other));
		assert.equal(resolveSheetRig(other, 'idle', 'e', [], ONE_RIG), undefined);
		const a = createSheetRigAnimator(other, ONE_RIG);
		assert.equal(a.frame({ atMs: 0, vx: 0, vy: 0 }), undefined);
		assert.equal(a.raise({ ability: 'ability1' }), false);
	}
	assert.equal(sheetPlaysRig(undefined), false);
	assert.equal(
		createSheetAnimator(sheet, source(['hero_idle_se'])).frame({ atMs: 0, vx: 0, vy: 0 }),
		undefined,
		'a rig is not drawn through clips',
	);
});

check('a rig’s animator: the loop, an action once for its animation’s length, the facing', () => {
	const sheet = rigged({ kind: 'side' }, { rig: 'hero' });
	const a = createSheetRigAnimator(sheet, rigs({ hero: { idle: 800, walk: 600, swipe: 300 } }));
	assert.deepEqual(a.frame({ atMs: 0, vx: 0, vy: 0 }), {
		rig: 'hero',
		animation: 'idle',
		skin: undefined,
		flipX: false,
		loop: true,
		play: 0,
		action: 'idle',
		variant: undefined,
	});
	const walking = run(a, 10, 400, -100, 0);
	assert.deepEqual(
		[walking.animation, walking.flipX, walking.loop, a.facing],
		['walk', true, true, 'w'],
		'moving west: the walk, mirrored',
	);
	assert.equal(a.raise({ ability: 'ability1' }), true);
	assert.equal(a.plays({ ability: 'ability1' }), true);
	const swipe = a.frame({ atMs: 420, vx: -100, vy: 0 });
	assert.deepEqual(
		[swipe.animation, swipe.flipX, swipe.loop, swipe.play, a.oneShot(420)],
		['swipe', true, false, 1, 'swipe'],
	);
	assert.equal(a.frame({ atMs: 710, vx: 100, vy: 0 }).animation, 'swipe', 'for its 300 ms');
	assert.equal(a.frame({ atMs: 710, vx: 100, vy: 0 }).flipX, true, 'in the facing it began in');
	assert.equal(a.frame({ atMs: 721, vx: -100, vy: 0 }).animation, 'walk', 'then the loop again');
	a.raise({ ability: 'ability1' });
	a.frame({ atMs: 730, vx: 0, vy: 0 });
	a.raise({ ability: 'ability1' });
	assert.equal(a.frame({ atMs: 740, vx: 0, vy: 0 }).play, 3, 'started again: another play');
	const unknown = createSheetRigAnimator(sheet, rigs({ hero: { idle: 800, swipe: undefined } }));
	unknown.frame({ atMs: 0, vx: 0, vy: 0 });
	unknown.raise({ ability: 'ability1' });
	unknown.frame({ atMs: 10, vx: 0, vy: 0 });
	assert.equal(unknown.oneShot(CLIP_ONE_SHOT_MS), 'swipe');
	assert.equal(unknown.oneShot(10 + CLIP_ONE_SHOT_MS), undefined, 'no length: CLIP_ONE_SHOT_MS');
	const lazy = { hero: {} };
	const loading = createSheetRigAnimator(sheet, rigs(lazy));
	assert.equal(loading.frame({ atMs: 0, vx: 0, vy: 0 }), undefined);
	lazy.hero = { idle: 800 };
	assert.equal(loading.frame({ atMs: 16, vx: 0, vy: 0 }).animation, 'idle', 'once it is loaded');
});

check('a variant is a skin: the first whose status holds and that the rig has', () => {
	const sheet = rigged(
		{ kind: 'side' },
		{ rig: 'hero', variants: { marked: 'gold', stunned: 'dizzy' } },
	);
	const skinned = rigs({ hero: each(['idle']) }, { hero: ['gold', 'dizzy'] });
	const skinOf = (statuses, src = skinned) => {
		const found = resolveSheetRig(sheet, 'idle', 'e', statuses, src);
		return [found.skin, found.variant, found.animation];
	};
	assert.deepEqual(skinOf([]), [undefined, undefined, 'idle']);
	assert.deepEqual(skinOf(['marked']), ['gold', 'marked', 'idle']);
	assert.deepEqual(skinOf(['stunned', 'marked']), ['gold', 'marked', 'idle'], 'the sheet’s order');
	assert.deepEqual(skinOf(['stunned']), ['dizzy', 'stunned', 'idle']);
	assert.deepEqual(
		skinOf(['marked', 'stunned'], rigs({ hero: each(['idle']) }, { hero: ['dizzy'] })),
		['dizzy', 'stunned', 'idle'],
		'a skin the rig lacks is passed over',
	);
	assert.deepEqual(skinOf(['marked'], rigs({ hero: each(['idle']) }, {})), [
		undefined,
		undefined,
		'idle',
	]);
	assert.deepEqual(skinOf(['marked'], ONE_RIG), ['gold', 'marked', 'idle'], 'no `hasSkin`: worn');
	const a = createSheetRigAnimator(sheet, skinned);
	assert.equal(a.frame({ atMs: 0, vx: 0, vy: 0, statuses: ['marked'] }).skin, 'gold');
	assert.equal(a.frame({ atMs: 16, vx: 0, vy: 0 }).skin, undefined);
});

check('a rig is drawn its box `draw.width` wide, its feet at the place; a point on a bone', () => {
	const box = { x: -40, y: -180, w: 100, h: 200 };
	const sheet = rigged({ kind: 'side' }, { rig: 'hero' }, RIG_ACTIONS, {
		width: 50,
		feet: 0.9,
		bones: { hand: 'hand_r' },
		points: { hand: { x: 0, y: 0 } },
	});
	const placed = sheetRigPlacement(sheet, box);
	assert.deepEqual(
		placed,
		{ scale: 0.5, x: -5, y: 0 },
		'box middle (10) and feet (0) at the place',
	);
	assert.deepEqual(
		sheetRigPlacement({ ...sheet, draw: { width: 50 } }, box),
		{ scale: 0.5, x: -5, y: -10 },
		'feet absent: the bottom of the box',
	);
	const bones = { hand_r: { x: 30, y: -120 } };
	const bone = (name) => bones[name];
	assert.deepEqual(sheetRigPoints(sheet, box, false, bone).hand, { dx: 10, lift: 60 });
	assert.deepEqual(sheetRigPoints(sheet, box, true, bone).hand, { dx: -10, lift: 60 }, 'mirrored');
	assert.deepEqual(
		sheetRigPoints(sheet, box, false, () => undefined),
		sheetClipPoints(sheet, box, false),
		'a bone the rig lacks: the point on the box, as a clip’s',
	);
	assert.deepEqual(
		sheetRigPoints({ ...sheet, draw: { width: 50 } }, box, true, bone),
		sheetClipPoints({ ...sheet, draw: { width: 50 } }, box, true),
		'no bone named: on the box',
	);
	assert.equal(
		sheetRigPoints(sheet, box, false, bone).middle,
		sheetClipPoints(sheet, box, false).middle,
	);
});

const CRATE = { assetKey: 'iw/demo/manifests/atlas_manifest_S_Props.json', region: 'crate' };
const FIN = { assetKey: 'iw/demo/manifests/atlas_manifest_S_Props.json', region: 'fin' };
const stills = (view, actions, kind = { kind: 'stills' }) => ({
	...(view ? { view } : {}),
	source: kind,
	draw: { width: 48 },
	actions,
});

check('a still image is a clip of one frame, under an id no clip has', () => {
	const sheet = stills({ kind: 'isometric' }, [
		{ id: 'idle', when: { motion: 'still' }, anim: { se: { still: CRATE }, ne: { still: FIN } } },
		{ id: 'walk', when: { motion: 'moving' }, anim: { se: { still: CRATE } } },
	]);
	assert.equal(sheetStillClipId(CRATE), `still::${CRATE.assetKey}::crate`);
	assert.deepEqual(sheetStillClips(sheet), [
		{
			id: sheetStillClipId(CRATE),
			name: 'crate',
			assetKey: CRATE.assetKey,
			frames: ['crate'],
			fps: 1,
			loop: false,
		},
		{
			id: sheetStillClipId(FIN),
			name: 'fin',
			assetKey: FIN.assetKey,
			frames: ['fin'],
			fps: 1,
			loop: false,
		},
	]);
	assert.deepEqual(sheetStillClips(rigged({ kind: 'side' }, { rig: 'hero' })), []);
	assert.deepEqual(sheetStillClips(hero({ kind: 'side' }, MOVES)), []);
	assert.deepEqual(sheetStillClips(undefined), []);
});

check('still images: every action and facing, by its cell, its stand-ins and its fallback', () => {
	const crate = sheetStillClipId(CRATE);
	const fin = sheetStillClipId(FIN);
	const sheet = stills({ kind: 'isometric' }, [
		{ id: 'idle', when: { motion: 'still' }, anim: { se: { still: CRATE }, ne: { still: FIN } } },
		{ id: 'walk', when: { motion: 'moving' }, fallback: 'idle' },
		{ id: 'swipe', when: { ability: 'ability1' }, fallback: 'walk' },
	]);
	const ids = sheetStillClips(sheet).map((clip) => clip.id);
	assert.equal(sheetPlaysClips(sheet), true);
	assert.equal(sheetPlaysRig(sheet), false);
	for (const action of ['idle', 'walk', 'swipe'])
		assert.deepEqual(
			['ne', 'se', 'sw', 'nw'].map((facing) => draws(sheet, action, facing, ids)),
			[fin, crate, `${crate}~`, `${fin}~`],
			`${action}: its own cells, or idle’s through its fallbacks`,
		);
	assert.equal(
		draws(sheet, 'idle', 'se', [...ids, '_idle_se', 'idle_se', 'undefined_idle_se']),
		crate,
	);
	const named = stills({ kind: 'isometric' }, [{ id: 'idle', when: { motion: 'still' } }]);
	assert.equal(
		draws(named, 'idle', 'se', ['_idle_se', 'idle_se', 'undefined_idle_se']),
		undefined,
		'still images find nothing by name',
	);
	assert.equal(draws(sheet, 'idle', 'se', []), undefined, 'not registered: nothing');
	const one = stills(undefined, [
		{ id: 'still', anim: { se: { still: CRATE } } },
		{ id: 'idle', when: { motion: 'still' }, fallback: 'still' },
		{ id: 'walk', when: { motion: 'moving' }, fallback: 'still' },
		{ id: 'swipe', when: { ability: 'ability1' }, fallback: 'still' },
		{ id: 'caught', when: { event: 'caught', as: 'target' }, fallback: 'still' },
	]);
	const a = createSheetAnimator(one, source([crate], { [crate]: 1000 }));
	const still = {
		clipId: crate,
		loop: true,
		play: 0,
		marked: false,
		action: 'still',
		variant: undefined,
	};
	assert.deepEqual(a.frame({ atMs: 0, vx: 0, vy: 0 }), { ...still, flipX: false });
	assert.deepEqual(run(a, 10, 400, -100, 0), { ...still, flipX: true }, 'moving west');
	a.raise({ ability: 'ability1' });
	assert.deepEqual(
		a.frame({ atMs: 500, vx: 0, vy: 0 }),
		{ ...still, flipX: true },
		'every action falls back to the one image: an action once changes nothing',
	);
	assert.equal(a.oneShot(500), undefined);
	assert.equal(a.plays({ event: 'caught', as: 'target' }), false, 'so no catch is waited for');
});

check('a clips sheet: a still in a cell, the other facings by name, a variant by name only', () => {
	const fin = sheetStillClipId(FIN);
	const sheet = hero(
		{ kind: 'side' },
		[
			{ id: 'idle', when: { motion: 'still' }, anim: { e: { still: FIN } } },
			{ id: 'walk', when: { motion: 'moving' }, fallback: 'idle' },
			{ id: 'wave', when: { ability: 'ability1' }, anim: { e: { still: CRATE } } },
		],
		{ source: { variants: { marked: 'gold' } } },
	);
	assert.deepEqual(
		sheetStillClips(sheet).map((clip) => clip.id),
		[fin, sheetStillClipId(CRATE)],
	);
	const ids = [fin, sheetStillClipId(CRATE), 'hero_walk_e', 'hero_idle_w', 'gold_idle_e'];
	assert.equal(draws(sheet, 'idle', 'e', ids), fin);
	assert.equal(draws(sheet, 'idle', 'w', ids), 'hero_idle_w', 'a facing with no cell: by name');
	assert.equal(draws(sheet, 'idle', 'w', [fin]), `${fin}~`, 'the still stands in, mirrored');
	assert.equal(draws(sheet, 'walk', 'w', ids), 'hero_walk_e~');
	assert.equal(draws(sheet, 'idle', 'e', ids, ['marked']), 'gold_idle_e', 'the variant’s clip');
	const a = createSheetAnimator(sheet, source(ids, { [sheetStillClipId(CRATE)]: 1000 }));
	a.frame({ atMs: 0, vx: 0, vy: 0 });
	a.raise({ ability: 'ability1' });
	const wave = a.frame({ atMs: 10, vx: 0, vy: 0 });
	assert.deepEqual([wave.clipId, wave.loop, wave.play], [sheetStillClipId(CRATE), false, 1]);
	assert.equal(a.frame({ atMs: 1009, vx: 0, vy: 0 }).clipId, sheetStillClipId(CRATE), 'held 1 s');
	assert.equal(a.frame({ atMs: 1010, vx: 0, vy: 0 }).clipId, fin);
	const rigCell = hero({ kind: 'side' }, [
		{ id: 'idle', when: { motion: 'still' }, anim: { e: { anim: 'rest' } } },
	]);
	assert.equal(
		draws(rigCell, 'idle', 'e', ['hero_idle_e', 'rest']),
		'hero_idle_e',
		'not a clip’s cell',
	);
});

check('a room’s game is the same with a rig or a still on a class’s sheet', () => {
	const plain = salmonsConfig();
	for (const sheet of [
		rigged({ kind: 'isometric' }, { rig: 'bearRig' }),
		stills({ kind: 'isometric' }, [
			{ id: 'idle', when: { motion: 'still' }, anim: { se: { still: CRATE } } },
		]),
	]) {
		const doc = structuredClone(plain);
		Object.assign(
			doc.arcade.characters.find((c) => c.id === 'bearBot'),
			structuredClone(sheet),
		);
		doc.arcade.online.characters.find((c) => c.id === 'bear').sheet = 'bearBot';
		assert.deepEqual(onlineClassSheetOf(doc, 'bear'), { id: 'bearBot', sheet });
		assert.deepEqual(normalizeCharacterSheet(sheet), sheet, 'canonical');
		assert.deepEqual(normalizeGameConfigDoc(doc), normalizeGameConfigDoc(plain));
	}
});

// The same tables against a wrong sheet, a wrong source or a wrong expectation are red.
const red = (name, fn) =>
	check(`mutation: ${name}`, () => assert.throws(fn, assert.AssertionError, 'it must be red'));
red('one rig, not mirrored (mirror: false) against the mirrored table', () =>
	rigTable(rigged({ kind: 'isometric', mirror: false }, { rig: 'hero' }), ONE_RIG, oneRig),
);
red('one rig that lacks the walk draws its fallback', () =>
	rigTable(
		rigged({ kind: 'side' }, { rig: 'hero' }),
		rigs({ hero: each(['idle', 'swipe']) }),
		oneRig,
	),
);
red('one rig read as a rig per facing', () =>
	rigTable(
		rigged({ kind: 'side' }, { rigs: { e: 'hero' } }),
		ONE_RIG,
		(action) => `hero/${action}`,
	),
);
red('an animation per facing with one facing missing', () => {
	const view = { kind: 'isometric', facings: 8 };
	const names = perFacing(view).filter((name) => name !== 'walk_e');
	rigTable(rigged(view, { rig: 'hero' }), rigs({ hero: each(names) }), byFacing('hero'));
});
red('a rig per facing with two facings swapped', () => {
	const sheet = rigged({ kind: 'isometric' }, { rigs: { ne: 'hero_se', se: 'hero_ne' } });
	const source = rigs({
		hero_ne: each(['idle', 'walk', 'swipe']),
		hero_se: each(['idle', 'walk', 'swipe']),
	});
	rigTable(sheet, source, (action, facing) =>
		LOOKS_WEST.includes(facing)
			? `hero_${clipMirrorOf(facing)}/${action}~`
			: `hero_${facing}/${action}`,
	);
});
red('a cell’s animation ignored', () => {
	const sheet = rigged({ kind: 'side' }, { rig: 'hero' }, [
		{ id: 'idle', when: { motion: 'still' }, anim: { e: { anim: 'rest' } } },
	]);
	rigTable(sheet, rigs({ hero: each(['idle', 'rest']) }), oneRig);
});
red('a still cell read as a clip found by name', () => {
	const sheet = hero({ kind: 'side' }, [
		{ id: 'idle', when: { motion: 'still' }, anim: { e: { still: FIN } } },
	]);
	assert.equal(draws(sheet, 'idle', 'e', [sheetStillClipId(FIN), 'hero_idle_e']), 'hero_idle_e');
});
red('the placement without the feet', () =>
	assert.deepEqual(
		sheetRigPlacement(rigged({ kind: 'side' }, { rig: 'hero' }, RIG_ACTIONS, { feet: 0.5 }), {
			x: 0,
			y: 0,
			w: 64,
			h: 64,
		}),
		{ scale: 1, x: -32, y: -64 },
	),
);

/** What the rig animator costs beside the sheet's clip animator (printed, not judged). */
function rigCost() {
	const view = { kind: 'isometric', facings: 8 };
	const sheet = rigged(view, { rig: 'hero' });
	const clipSheet = hero(view, RIG_ACTIONS);
	const clipIds = new Set(
		RIG_ACTIONS.flatMap((action) =>
			characterViewFacings(view).map((f) => `hero_${action.id}_${f}`),
		),
	);
	const animations = { hero: { idle: 800, walk: 600, swipe: 300 } };
	const fast = {
		has: (rig, animation) => animations[rig]?.[animation] !== undefined,
		durationMs: (rig, animation) => animations[rig]?.[animation],
	};
	const time = (make) => {
		const players = Array.from({ length: 100 }, make);
		const started = process.hrtime.bigint();
		for (let f = 0; f < COST_FRAMES; f++)
			for (let p = 0; p < players.length; p++) {
				const turn = ((f + p * 37) % 360) * (Math.PI / 180);
				if ((f + p) % 97 === 0) players[p].raise({ ability: 'ability1' });
				players[p].frame({ atMs: f * 16, vx: Math.cos(turn) * 100, vy: Math.sin(turn) * 100 });
			}
		return Number(process.hrtime.bigint() - started) / (100 * COST_FRAMES);
	};
	const best = (make) => Math.min(time(make), time(make), time(make));
	return {
		clips: best(() =>
			createSheetAnimator(clipSheet, { has: (id) => clipIds.has(id), cycleMs: () => 300 }),
		),
		rig: best(() => createSheetRigAnimator(sheet, fast)),
	};
}

console.log(
	`\n  the grid: ${gridCells} cells (+ ${preferCells} with a facing last seen)` +
		`\n  the room: seed ${ROOM_SEED}, ${STEPS} steps, ${room.frames.length} frames; ` +
		`${roomCompared} frames × players compared over ${ROOM_CLIPS.length} clip sets × 2 screens` +
		`\n  its events: ${Object.entries(room.events)
			.map(([type, n]) => `${type} ${n}`)
			.join(', ')} (abilities: bear ${room.abilities.bear}, fisherman ${room.abilities.fisherman})`,
);
console.log(
	`\n  cost, mean ns a player-frame (100 players × ${COST_FRAMES} frames, Node, best of 3; not a gate):`,
);
for (const [name, set, old, neu] of costs())
	console.log(
		`    ${name}, ${set}: old animator ${old.toFixed(0)} ns, sheet animator ${neu.toFixed(0)} ns (${(neu / old).toFixed(2)}×)`,
	);
console.log(
	'    (measures the two animators’ `frame` alone, over a Set of clip ids: not the registry’s\n' +
		'     lookup, the velocity trail, the draw, a browser’s JIT or its garbage collector)',
);

{
	const { clips, rig } = rigCost();
	console.log(
		`\n  a rig source: ${rigCells} cells (action × facing × arrangement) against their tables` +
			`\n    its animator, eight facings, one rig: ${rig.toFixed(0)} ns a player-frame beside the clip ` +
			`animator’s ${clips.toFixed(0)} ns (${(rig / clips).toFixed(2)}×; the resolver alone, not the rig’s draw)`,
	);
}

console.log(
	process.exitCode
		? `\ncharacter sheet: FAILED (${passed} passed)`
		: `\ncharacter sheet: ${passed} passed`,
);
