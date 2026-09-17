// Offline fixture for the CASCADE EXPLOSION PATTERN (Invisible Symbols State Machine → Explosion
// pattern; `packages/engine-layout/src/lib/tumblePattern.ts`).
//
//   node scripts/verify-tumble-pattern.mjs
//
// WHAT IT PROVES, in three parts.
//
//   1. THE ORDERING, over the REAL `tumbleExplosionDelays`. Every pattern's shape is asserted as a
//      wave grid rather than described in a comment, plus the three rules that are easy to get
//      wrong and invisible when they are:
//        - DENSE RANKING. The waves are counted over the seats that ACTUALLY EXPLODE, not over the
//          board. A win on reels 2-4 pops on waves 0,1,2 — never on 2,3,4 with two waves of dead
//          air in front of it — which is what keeps a pattern reading the same on a three-symbol
//          line as on a full board.
//        - THE CENTRE IS THE BOARD'S. `radial` / `columnsOut` / `columnsIn` measure from the middle
//          of the BOARD, so an off-centre win is seen to be off-centre. Every other pattern is
//          monotonic and must be unaffected by the bounds it is given.
//        - `all` AND a zero step BOTH answer all-zero, because both mean "one frame" — the parity
//          case, which is every project that never opens the panel.
//
//   2. THE STEP ACTUALLY STAGGERS, driven rather than reasoned: the REAL `tumbleBoardExplode`
//      handler is sliced out of `apps/lines/src/components/TumbleBoard.svelte` and run on a VIRTUAL
//      clock, so the wave a seat pops on is a number this fixture reads back instead of a claim.
//      It asserts the pop ORDER, the exact virtual time of each pop, that the step does not resolve
//      until the last seat's beat has, and — the parity case — that an un-authored project still
//      pops every seat in the same frame.
//
//   3. THE PENDING-WAVE GUARD. A board swept out from under a wave that has not fired yet (a slam,
//      a skipped round, `tumbleBoardReset`) must not pop the symbols that are no longer on it: they
//      have no renderer, so they can never report `oncomplete`, and the beat would stall on the one
//      step every cascading spin runs.
//
// The parts that live in the launcher — the doc schema's prune, the client setters, the dirty
// signature, and the two bundle-path whitelists — are asserted by
// `pnpm --filter launcher-api check:tumble-pattern`.

import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	TUMBLE_PATTERNS,
	TUMBLE_SPREAD_MS_MAX,
	TUMBLE_STEP_MS_DEFAULT,
	TUMBLE_STEP_MS_MAX,
	clampStep,
	isTumblePattern,
	tumbleExplosionDelays,
} from '../packages/engine-layout/src/lib/tumblePattern.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The repo checks out CRLF on Windows; every slice marker below is written with `\n`.
const read = (path) => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');

let failures = 0;
let checks = 0;
const check = (label, actual, expected) => {
	checks += 1;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
};

const REELS = 5;
const ROWS = 3;
const BOUNDS = { reels: REELS, rows: ROWS };
/** Reading order, so a wave grid below can be read as the board is. */
const fullBoard = () => {
	const seats = [];
	for (let row = 0; row < ROWS; row += 1) {
		for (let reel = 0; reel < REELS; reel += 1) seats.push({ reel, row });
	}
	return seats;
};
/** The wave each seat pops on, as rows — asked for with a 1 ms step so the delay IS the wave. */
const waveGrid = (pattern, seats = fullBoard(), bounds = BOUNDS) => {
	const delays = tumbleExplosionDelays(seats, { pattern, stepMs: 1 }, bounds);
	const rows = [];
	for (let row = 0; row < ROWS; row += 1) rows.push(delays.slice(row * REELS, (row + 1) * REELS));
	return rows;
};

console.log('--- 1. the ordering ---');

check('all — one frame, which is what the cascade has always done', waveGrid('all'), [
	[0, 0, 0, 0, 0],
	[0, 0, 0, 0, 0],
	[0, 0, 0, 0, 0],
]);
check('columnsLeft — a sweep rightwards, every row of a column together', waveGrid('columnsLeft'), [
	[0, 1, 2, 3, 4],
	[0, 1, 2, 3, 4],
	[0, 1, 2, 3, 4],
]);
check('columnsRight — the same sweep pointed the other way', waveGrid('columnsRight'), [
	[4, 3, 2, 1, 0],
	[4, 3, 2, 1, 0],
	[4, 3, 2, 1, 0],
]);
check('columnsOut — the middle column first, both edges last together', waveGrid('columnsOut'), [
	[2, 1, 0, 1, 2],
	[2, 1, 0, 1, 2],
	[2, 1, 0, 1, 2],
]);
check('columnsIn — the mirror of it: both edges first', waveGrid('columnsIn'), [
	[0, 1, 2, 1, 0],
	[0, 1, 2, 1, 0],
	[0, 1, 2, 1, 0],
]);
check('rowsTop — top down, every column of a row together', waveGrid('rowsTop'), [
	[0, 0, 0, 0, 0],
	[1, 1, 1, 1, 1],
	[2, 2, 2, 2, 2],
]);
check('rowsBottom — bottom up', waveGrid('rowsBottom'), [
	[2, 2, 2, 2, 2],
	[1, 1, 1, 1, 1],
	[0, 0, 0, 0, 0],
]);
check('diagonalTopLeft — a wave off the top-left corner', waveGrid('diagonalTopLeft'), [
	[0, 1, 2, 3, 4],
	[1, 2, 3, 4, 5],
	[2, 3, 4, 5, 6],
]);
check('diagonalTopRight — off the top-right corner', waveGrid('diagonalTopRight'), [
	[4, 3, 2, 1, 0],
	[5, 4, 3, 2, 1],
	[6, 5, 4, 3, 2],
]);
check('radial — rings out of the board centre', waveGrid('radial'), [
	[4, 2, 1, 2, 4],
	[3, 1, 0, 1, 3],
	[4, 2, 1, 2, 4],
]);
check('sequential — one seat at a time, in reading order', waveGrid('sequential'), [
	[0, 1, 2, 3, 4],
	[5, 6, 7, 8, 9],
	[10, 11, 12, 13, 14],
]);
{
	// `random` is re-rolled per call by design, so what is asserted is the CONTRACT: every seat gets
	// its own wave, and the waves are exactly `0 … n-1` with none repeated and none skipped. A
	// per-seat random KEY would fail this the moment two seats drew the same number, which is the
	// bug the shuffle exists to make impossible.
	const seats = fullBoard();
	const ranks = tumbleExplosionDelays(seats, { pattern: 'random', stepMs: 1 }, BOUNDS);
	check(
		'random — one seat per wave, no ties',
		[...ranks].sort((a, b) => a - b),
		[...seats.keys()],
	);
	// Seeded, so the shuffle itself is asserted rather than only its shape.
	const seeded = tumbleExplosionDelays(seats, { pattern: 'random', stepMs: 1 }, BOUNDS, () => 0);
	check(
		'...and it is a real shuffle — a degenerate source still permutes',
		[...seeded].sort((a, b) => a - b),
		[...seats.keys()],
	);
}

{
	// DENSE RANKING. Three reels of a five-reel board win. The pattern must start on wave 0 at the
	// leftmost WINNING column — not on wave 2 with two empty waves of dead air first.
	const seats = [
		{ reel: 2, row: 1 },
		{ reel: 3, row: 1 },
		{ reel: 4, row: 1 },
	];
	check(
		'a partial win starts on wave 0, not on its own reel index',
		tumbleExplosionDelays(seats, { pattern: 'columnsLeft', stepMs: 1 }, BOUNDS),
		[0, 1, 2],
	);
	// ...and the centre-relative patterns are the exception that proves it: they measure from the
	// BOARD, so this off-centre win is correctly seen to be off-centre (reel 2 is the middle).
	check(
		'...but radial still measures from the BOARD centre, so an off-centre win reads as one',
		tumbleExplosionDelays(seats, { pattern: 'radial', stepMs: 1 }, BOUNDS),
		[0, 1, 2],
	);
	check(
		'...and the same three seats one reel left are NOT symmetric about their own middle',
		tumbleExplosionDelays(
			[
				{ reel: 0, row: 1 },
				{ reel: 1, row: 1 },
				{ reel: 2, row: 1 },
			],
			{ pattern: 'radial', stepMs: 1 },
			BOUNDS,
		),
		[2, 1, 0],
	);
	// A monotonic pattern must not care about the bounds at all — the dense ranking cancels the
	// origin out. Asserted because getting this wrong is invisible: it only shows on a partial win.
	check(
		'a monotonic pattern is unaffected by the bounds it is given',
		tumbleExplosionDelays(seats, { pattern: 'columnsRight', stepMs: 1 }, { reels: 99, rows: 99 }),
		tumbleExplosionDelays(seats, { pattern: 'columnsRight', stepMs: 1 }),
	);
}

{
	// PARITY — the two ways of saying "one frame", and the shape of an empty step.
	const seats = fullBoard();
	const zeros = seats.map(() => 0);
	check(
		'an un-authored project (no config at all) is all-zero',
		tumbleExplosionDelays(seats),
		zeros,
	);
	check(
		'...so is a pattern with a zero step, which means the same thing',
		tumbleExplosionDelays(seats, { pattern: 'columnsLeft', stepMs: 0 }),
		zeros,
	);
	check(
		'no seats — no delays, and nothing throws',
		tumbleExplosionDelays([], { pattern: 'radial' }),
		[],
	);
	check(
		'the step multiplies the wave, so the last column of a 5-reel sweep waits 4 gaps',
		tumbleExplosionDelays(seats, { pattern: 'columnsLeft', stepMs: 80 }).at(-1),
		320,
	);
}

{
	// AN UNKNOWN PATTERN degrades to the un-authored single frame instead of throwing. The Zod enum
	// stops one at save, so this is about VERSION SKEW: the launcher deploys from `main` while a
	// shipped game vendors the engine as a submodule pinned to an older commit, so a pattern added
	// today can reach a game whose `switch` has no case for it. A throw here would land inside
	// `tumbleBoardExplode` and take the round with it.
	const seats = fullBoard();
	const zeros = seats.map(() => 0);
	check(
		'an unknown pattern name explodes in one frame rather than throwing',
		tumbleExplosionDelays(seats, { pattern: 'spiral', stepMs: 80 }, BOUNDS),
		zeros,
	);
	check('...and so does a non-string', tumbleExplosionDelays(seats, { pattern: 7 }, BOUNDS), zeros);
	check(
		'isTumblePattern agrees with the list',
		TUMBLE_PATTERNS.filter((p) => !isTumblePattern(p)),
		[],
	);
	check('...and rejects what is not on it', isTumblePattern('spiral'), false);
}

{
	// THE SPREAD CEILING. `stepMs` bounds ONE gap, which bounds nothing for a pattern whose wave
	// count grows with the win — and the board CLEAR of a swap-in-place board explodes every seat on
	// every spin, where the explode step is not raced against the round-skip token.
	const seats = fullBoard();
	const worst = tumbleExplosionDelays(seats, { pattern: 'sequential', stepMs: TUMBLE_STEP_MS_MAX });
	check(
		'15 seats one-at-a-time at the maximum gap is bounded, not 7 seconds of dead air',
		Math.max(...worst) <= TUMBLE_SPREAD_MS_MAX,
		true,
	);
	check(
		'...and the PATTERN survives the clamp — every seat keeps its own wave, the pace just tightens',
		new Set(worst).size,
		15,
	);
	check(
		'...in the same order',
		worst.every((delay, i) => i === 0 || delay > worst[i - 1]),
		true,
	);
	// A pace a project would plausibly author is NOT touched — a guard, not a shaper.
	check(
		'a 5-column sweep at the maximum gap is under the ceiling and passes through untouched',
		tumbleExplosionDelays(seats, { pattern: 'columnsLeft', stepMs: TUMBLE_STEP_MS_MAX }).at(-1),
		4 * TUMBLE_STEP_MS_MAX,
	);
	check(
		'...as does one-at-a-time at the DEFAULT gap over a full board',
		Math.max(...tumbleExplosionDelays(seats, { pattern: 'sequential' })),
		14 * TUMBLE_STEP_MS_DEFAULT,
	);
}

check('an absent step is the default', clampStep(undefined), TUMBLE_STEP_MS_DEFAULT);
check('a negative step floors at 0', clampStep(-50), 0);
check(
	'a huge step is clamped, so a hand-edited doc cannot stall a round',
	clampStep(99_999),
	TUMBLE_STEP_MS_MAX,
);
check('a fractional step is floored, so no timer gets one', clampStep(80.9), 80);
check(
	'a non-numeric step falls back to the default',
	clampStep(Number.NaN),
	TUMBLE_STEP_MS_DEFAULT,
);
check(
	'every pattern in the list is orderable — none falls through the switch',
	TUMBLE_PATTERNS.filter(
		(pattern) => tumbleExplosionDelays(fullBoard(), { pattern, stepMs: 1 }, BOUNDS).length !== 15,
	),
	[],
);

{
	// THE PER-COLUMN CLEAR — the beat a swap-in-place player watches on EVERY spin, and the one this
	// pattern silently did nothing for until 2026-09-09.
	//
	// `clearOutgoingSymbols(reelIndex)` fans the board clear out ONE COLUMN PER CALL, so the seats
	// handed to the ordering function all share a column. Dense-ranked, they share ONE key and answer
	// "wave 0" — every column popped in the same frame however the pattern was authored. Board-ranked,
	// the column is placed among all the board's columns, which is the question a per-column call has
	// to answer.
	const ROWS_IN_COLUMN = 5;
	const REELS_ON_BOARD = 6;
	const column = (reel) =>
		Array.from({ length: ROWS_IN_COLUMN }, (_unused, row) => ({ reel, row }));
	const boardBounds = { reels: REELS_ON_BOARD, rows: ROWS_IN_COLUMN, rankAgainstBoard: true };

	check(
		'DENSE-ranked, one column of a columnsLeft clear collapses to a single wave — the bug',
		tumbleExplosionDelays(column(3), { pattern: 'columnsLeft', stepMs: 220 }, {
			reels: REELS_ON_BOARD,
			rows: ROWS_IN_COLUMN,
		}),
		[0, 0, 0, 0, 0],
	);
	check(
		'BOARD-ranked, that column pops on its own wave — reel 3 of 6 waits three gaps',
		tumbleExplosionDelays(column(3), { pattern: 'columnsLeft', stepMs: 220 }, boardBounds),
		[660, 660, 660, 660, 660],
	);
	check(
		'...and the whole sweep is left-to-right across every column',
		Array.from({ length: REELS_ON_BOARD }, (_u, reel) =>
			tumbleExplosionDelays(column(reel), { pattern: 'columnsLeft', stepMs: 220 }, boardBounds)[0],
		),
		[0, 220, 440, 660, 880, 1100],
	);
	check(
		'...reversed for columnsRight',
		Array.from({ length: REELS_ON_BOARD }, (_u, reel) =>
			tumbleExplosionDelays(column(reel), { pattern: 'columnsRight', stepMs: 220 }, boardBounds)[0],
		),
		[1100, 880, 660, 440, 220, 0],
	);
	check(
		'a ROW pattern still sweeps WITHIN each column, and identically in every column',
		tumbleExplosionDelays(column(4), { pattern: 'rowsTop', stepMs: 100 }, boardBounds),
		tumbleExplosionDelays(column(0), { pattern: 'rowsTop', stepMs: 100 }, boardBounds),
	);
	check(
		'...top to bottom',
		tumbleExplosionDelays(column(0), { pattern: 'rowsTop', stepMs: 100 }, boardBounds),
		[0, 100, 200, 300, 400],
	);
	check(
		'`all` is still one frame under board ranking (parity)',
		tumbleExplosionDelays(column(2), { pattern: 'all', stepMs: 220 }, boardBounds),
		[0, 0, 0, 0, 0],
	);
	check(
		'the spread ceiling is measured over the BOARD, not over the one column handed in',
		Math.max(
			...Array.from({ length: REELS_ON_BOARD }, (_u, reel) =>
				tumbleExplosionDelays(
					column(reel),
					{ pattern: 'columnsLeft', stepMs: TUMBLE_STEP_MS_MAX },
					boardBounds,
				)[0],
			),
		) <= TUMBLE_SPREAD_MS_MAX,
		true,
	);
	// `random` must agree ACROSS the six independent calls one clear makes, or the columns would each
	// draw their own shuffle and the "order" would be incoherent. Seeded so the claim is exact.
	const shuffledFirstSeat = (reel) =>
		tumbleExplosionDelays(
			column(reel),
			{ pattern: 'random', stepMs: 10 },
			boardBounds,
			() => 0.42,
		)[0];
	const twice = [shuffledFirstSeat(2), shuffledFirstSeat(2)];
	check('a board-ranked random shuffle is stable for the same column', twice[0], twice[1]);
	check(
		'...and every board seat still gets its own wave across the whole clear',
		new Set(
			Array.from({ length: REELS_ON_BOARD }, (_u, reel) =>
				tumbleExplosionDelays(column(reel), { pattern: 'random', stepMs: 10 }, boardBounds, () => 0.42),
			).flat(),
		).size,
		REELS_ON_BOARD * ROWS_IN_COLUMN,
	);
}

console.log('--- 2. the real explode step, on a virtual clock ---');

/**
 * The REAL `tumbleBoardExplode` handler, sliced out of the shipped component by brace balance.
 *
 * Types are stripped by Node's own TypeScript stripper rather than by hand-written regexes, so a
 * new annotation in the handler cannot quietly break this fixture the way it can break a stripper
 * zoo. The BODY is the shipped one — that is the whole point of slicing rather than restating it.
 */
const explodeHandlerSource = (() => {
	const component = read('apps/lines/src/components/TumbleBoard.svelte');
	const script = component.slice(component.lastIndexOf('<script lang="ts">'));
	// Matched on the handler NAME, not on its full destructuring line: the parameter list grows
	// (`patternScope` joined it when the board clear needed its own ordering scope), and a marker that
	// spelled the whole signature out turned every such addition into a fixture crash.
	const marker = 'tumbleBoardExplode: async (';
	const start = script.indexOf(marker);
	if (start < 0) throw new Error('TumbleBoard.svelte no longer declares tumbleBoardExplode');
	const open = script.indexOf('{', script.indexOf('=>', start));
	if (open < 0) throw new Error('could not find the body of tumbleBoardExplode');
	let depth = 0;
	for (let i = open; i < script.length; i += 1) {
		if (script[i] === '{') depth += 1;
		else if (script[i] === '}') {
			depth -= 1;
			if (depth === 0) {
				return script.slice(start, i + 1);
			}
		}
	}
	throw new Error('could not find the end of tumbleBoardExplode');
})();

if (!explodeHandlerSource.includes('tumbleExplosionDelays')) {
	throw new Error('the explode handler no longer orders its seats through tumbleExplosionDelays');
}

const buildExplode = (env) => {
	const names = Object.keys(env);
	const body = stripTypeScriptTypes(`const handler = { ${explodeHandlerSource} };`);
	// eslint-disable-next-line no-new-func
	const make = new Function(...names, `${body}\nreturn handler.tumbleBoardExplode;`);
	return make(...names.map((name) => env[name]));
};

/** Timers resolved in armed order at each virtual instant, so a run is deterministic. */
const createClock = () => {
	let now = 0;
	let seq = 0;
	let pending = [];
	const wait = (ms) =>
		new Promise((resolve) => {
			pending.push({ at: now + (ms ?? 0), seq: (seq += 1), resolve });
		});
	const drain = async () => {
		for (let i = 0; i < 50; i += 1) await Promise.resolve();
	};
	const run = async (body) => {
		let done = false;
		const finished = body().then(() => (done = true));
		await drain();
		while (!done) {
			if (!pending.length) throw new Error('the virtual clock deadlocked');
			now = pending.reduce((min, t) => Math.min(min, t.at), Number.POSITIVE_INFINITY);
			const due = pending.filter((t) => t.at <= now).sort((a, b) => a.seq - b.seq);
			pending = pending.filter((t) => t.at > now);
			for (const timer of due) timer.resolve();
			await drain();
		}
		await finished;
		return now;
	};
	return { wait, run, at: () => now };
};

/** The animation every symbol's `clearReel` takes here. Longer than any gap under test, so a
 *  step that resolved on the last POP rather than on the last BEAT would be caught. */
const BEAT_MS = 500;

const runExplode = async ({ pattern, stepMs, seats, sweepAfter, spliceAfter, emerge, patternScope }) => {
	const clock = createClock();
	const pops = [];
	// One symbol object per seat, keyed the way the board keys them: `base[reel][row]`.
	const base = Array.from({ length: REELS }, () =>
		Array.from({ length: ROWS }, () => ({ symbolState: 'static', rawSymbol: { name: 'H1' } })),
	);
	const stateTumble = { base, adding: [] };
	// Every explosion → intro transition the step schedules, with the virtual time it would MOUNT at.
	const bridges = [];
	const TRANSITION_DELAY_MS = 40;
	const env = {
		stateTumble,
		stateGameDerived: {
			// The transition is emerge-only, so both answers are needed: OFF is the ordering fixture's
			// default, ON exercises the catch-up that keeps a staggered pop bridging a board-wide intro.
			boardSwapsInPlace: () => Boolean(emerge),
			boardSwapStyle: () => (emerge ? 'emerge' : 'slide'),
		},
		bakedSymbolTransition: () =>
			emerge
				? { kind: 'spine', assetKey: 'x/', animationName: 'a', delayMs: TRANSITION_DELAY_MS }
				: undefined,
		bakedTumblePattern: () => (pattern ? { pattern, stepMs } : undefined),
		tumbleExplosionDelays,
		waitForTimeout: (ms) => clock.wait(ms),
		playTumbleExplosionSound: () => pops.push({ cue: 'step', at: clock.at() }),
		playSymbolClearReelSound: () => {},
		// The real one mounts `layer.delayMs + catchUpMs` after the seat's pop; what matters here is the
		// ABSOLUTE moment it lands, which is what the catch-up exists to make uniform.
		scheduleTransition: (layer, _position, _symbol, catchUpMs) =>
			bridges.push({ mountsAt: clock.at() + (layer.delayMs ?? 0) + catchUpMs, catchUpMs }),
		// The beat: a symbol reports `oncomplete` BEAT_MS after its state is set, which is what an
		// authored explosion animation does.
		awaitBeat: (arm) => {
			const started = clock.at();
			pops.push({ cue: 'pop', at: started });
			return clock.wait(BEAT_MS).then(() => arm(() => {}));
		},
	};
	const handler = buildExplode(env);
	const settledAt = await clock.run(async () => {
		const running = handler({ explodingPositions: seats, patternScope });
		if (sweepAfter !== undefined) {
			// The slam: the board is emptied part-way through the pattern, exactly as
			// `tumbleBoardReset` empties it.
			await clock.wait(sweepAfter);
			stateTumble.base = Array.from({ length: REELS }, () => []);
		}
		if (spliceAfter !== undefined) {
			// The narrower case the guard is actually WRITTEN for: one column is rebuilt (a refill
			// splices it) rather than the whole board emptied, so `base[reel]` still exists and still
			// has a symbol at that INDEX — just not the one this seat is holding. Only an identity
			// check catches it; an index check would pop a stranger.
			await clock.wait(spliceAfter.atMs);
			stateTumble.base[spliceAfter.reel] = Array.from({ length: ROWS }, () => ({
				symbolState: 'static',
				rawSymbol: { name: 'H9' },
			}));
		}
		await running;
	});
	return {
		settledAt,
		bridges,
		// The pop timeline, in the order the seats actually popped.
		popped: pops.filter((p) => p.cue === 'pop').map((p) => p.at),
		stepCueAt: pops.find((p) => p.cue === 'step')?.at,
		exploded: base.flatMap((reel, r) =>
			reel.flatMap((symbol, row) =>
				symbol.symbolState === 'clearReel' ? [`${r}:${row}`] : [],
			),
		),
	};
};

{
	// PARITY: no pattern authored ⇒ every seat pops in the same frame and the step is one beat long,
	// which is byte-for-byte the behaviour this feature must not change for an un-authored project.
	const seats = fullBoard();
	const run = await runExplode({ seats });
	check('un-authored — every seat pops at 0', new Set(run.popped), new Set([0]));
	check('...and the step is exactly one beat long', run.settledAt, BEAT_MS);
	check('...and every seat is left in the clearReel state', run.exploded.length, 15);
}

{
	// A COLUMN SWEEP: 5 columns, 80 ms apart. The pops must land on 0/80/160/240/320 — three seats
	// at each, because a column pops as one — and the step must last the last wave PLUS a full beat.
	const seats = fullBoard();
	const run = await runExplode({ seats, pattern: 'columnsLeft', stepMs: 80 });
	check(
		'columnsLeft at 80ms — three seats on each of five waves',
		[...run.popped].sort((a, b) => a - b),
		[0, 0, 0, 80, 80, 80, 160, 160, 160, 240, 240, 240, 320, 320, 320],
	);
	check('...the step cue fires ONCE, with the first wave', run.stepCueAt, 0);
	check('...and the step ends a full beat after the LAST wave', run.settledAt, 320 + BEAT_MS);
	check('...with every seat exploded', run.exploded.length, 15);
}

{
	// The gap is the knob: the same pattern at a bigger step must take proportionally longer, and at
	// a zero step must collapse back to the un-authored single frame.
	const seats = fullBoard();
	const wide = await runExplode({ seats, pattern: 'rowsTop', stepMs: 200 });
	check(
		'rowsTop at 200ms — three waves, one per row',
		[...new Set(wide.popped)].sort((a, b) => a - b),
		[0, 200, 400],
	);
	check('...and the step grows with the gap', wide.settledAt, 400 + BEAT_MS);
	const none = await runExplode({ seats, pattern: 'rowsTop', stepMs: 0 });
	check('...while a zero gap collapses to one frame', new Set(none.popped), new Set([0]));
	check('...at exactly the un-authored length', none.settledAt, BEAT_MS);
}

console.log('--- 3. the pending-wave guard ---');

{
	// The board is swept at 100 ms — after waves 0 and 1 (0 ms, 80 ms) have fired, before waves 2-4.
	// The remaining seats must be DROPPED, not popped: they are off the board, so nothing would ever
	// report their beat and the step would stall on the guard's cap.
	const seats = fullBoard();
	const run = await runExplode({ seats, pattern: 'columnsLeft', stepMs: 80, sweepAfter: 100 });
	check(
		'a board swept mid-pattern pops only the waves that had already fired',
		[...run.popped].sort((a, b) => a - b),
		[0, 0, 0, 80, 80, 80],
	);
	check(
		'...and the step still ends — one beat after the last pop that DID happen',
		run.settledAt,
		80 + BEAT_MS,
	);
}

{
	// The narrower guard case: ONE column is spliced (a refill rebuilds it) rather than the board
	// emptied. `base[0]` still has a symbol at every index — just not the ones this step is holding —
	// so an index check would pop three strangers and then wait on beats they can never report.
	const seats = fullBoard();
	// Reel 4 is the LAST wave (320 ms) and is spliced at 100 ms, so its three seats are still pending
	// when their column is rebuilt under them.
	const run = await runExplode({
		seats,
		pattern: 'columnsLeft',
		stepMs: 80,
		spliceAfter: { reel: 4, atMs: 100 },
	});
	check(
		'a spliced column drops its own seats and pops the other four columns',
		[...run.popped].sort((a, b) => a - b),
		[0, 0, 0, 80, 80, 80, 160, 160, 160, 240, 240, 240],
	);
	check(
		'...so the step ends a beat after wave 3, not after the wave that never fired',
		run.settledAt,
		240 + BEAT_MS,
	);
	check(
		'...and not one of the replacement symbols was popped in their place',
		run.exploded.filter((seat) => seat.startsWith('4:')),
		[],
	);
	check('...leaving exactly the twelve seats that did pop', run.exploded.length, 12);
}

{
	// DRIVEN, through the real handler: one column of a board clear, ordered against the board.
	// Every seat of reel 3 must pop together, three gaps into the sweep — not at 0 like every other
	// column, which is what the whole board doing it at once looked like.
	const columnSeats = Array.from({ length: ROWS }, (_unused, row) => ({ reel: 3, row }));
	const clear = await runExplode({
		seats: columnSeats,
		pattern: 'columnsLeft',
		stepMs: 220,
		patternScope: 'board',
	});
	check(
		'a board-scoped column clear pops its whole column on ONE wave, three gaps in',
		[...new Set(clear.popped)],
		[660],
	);
	check('...every seat of that column', clear.popped.length, ROWS);
	const dense = await runExplode({ seats: columnSeats, pattern: 'columnsLeft', stepMs: 220 });
	check(
		'...while the same column WITHOUT the board scope still pops at 0 (the cascade contract)',
		[...new Set(dense.popped)],
		[0],
	);
}

console.log('--- 4. the explosion → intro transition under a pattern ---');

{
	// Every seat's bridge must land at the SAME absolute moment — `delayMs` after the LAST wave —
	// because the intro it bridges is one board-wide beat, not a per-seat one. Riding each seat's own
	// pop would mount wave 0's bridge a full spread early, playing it into nothing.
	const seats = fullBoard();
	const run = await runExplode({ seats, pattern: 'columnsLeft', stepMs: 80, emerge: true });
	check('one bridge per exploding seat', run.bridges.length, 15);
	check(
		'...every one of them mounting at the same moment: the last wave plus the authored delay',
		[...new Set(run.bridges.map((b) => b.mountsAt))],
		[320 + 40],
	);
	// PARITY: with no pattern there is nothing to catch up to, so the seam is byte-identical to
	// before patterns existed.
	const flat = await runExplode({ seats, emerge: true });
	check(
		'un-patterned — every catch-up is zero, so the bridge still rides its own pop',
		[...new Set(flat.bridges.map((b) => b.catchUpMs))],
		[0],
	);
	check(
		'...mounting at the authored delay and nothing more',
		[...new Set(flat.bridges.map((b) => b.mountsAt))],
		[40],
	);
}

console.log('');
console.log(failures ? `FAILED — ${failures} of ${checks} checks` : `PASSED — ${checks} checks`);
// `exitCode`, not `process.exit()`: an abrupt exit races Node's own type-stripper teardown on
// Windows and aborts with a libuv assertion AFTER the report has printed, which reads as a failure.
process.exitCode = failures ? 1 : 0;
