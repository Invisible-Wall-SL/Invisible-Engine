// Offline fixture for the CASCADE EXPLOSION PATTERN (Invisible Symbols State Machine → Explosion
// pattern; `packages/engine-layout/src/lib/tumblePattern.ts`).
//
//   node scripts/verify-tumble-pattern.mjs
//
// WHAT IT PROVES, in five parts.
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
//   4. THE EXPLOSION → INTRO TRANSITION rides its OWN seat's pop — a fixed authored delay after the
//      wave that seat is in, so the bridges sweep with the waves instead of bunching onto the last
//      one. That regressed once, at the CALL SITE, which is why the stub still applies a fourth
//      argument if one is passed rather than ignoring it.
//
//   5. A SPENT SEAT IS UNDRAWN. Removal is board-wide and stays so (it would otherwise shift every
//      index below it), but a pattern pushes it a spread later than the seat's own animation, and a
//      symbol drawn through that gap goes on looping. So it stops being rendered the moment it
//      REPORTS — which is not the same as when the beat resolves, because the beat is raced against
//      a cap. The clock therefore keeps draining past settlement: a pop longer than the cap reports
//      late, and taking it off the board at the right moment depends on that late report arriving.
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
		tumbleExplosionDelays(
			column(3),
			{ pattern: 'columnsLeft', stepMs: 220 },
			{
				reels: REELS_ON_BOARD,
				rows: ROWS_IN_COLUMN,
			},
		),
		[0, 0, 0, 0, 0],
	);
	check(
		'BOARD-ranked, that column pops on its own wave — reel 3 of 6 waits three gaps',
		tumbleExplosionDelays(column(3), { pattern: 'columnsLeft', stepMs: 220 }, boardBounds),
		[660, 660, 660, 660, 660],
	);
	check(
		'...and the whole sweep is left-to-right across every column',
		Array.from(
			{ length: REELS_ON_BOARD },
			(_u, reel) =>
				tumbleExplosionDelays(
					column(reel),
					{ pattern: 'columnsLeft', stepMs: 220 },
					boardBounds,
				)[0],
		),
		[0, 220, 440, 660, 880, 1100],
	);
	check(
		'...reversed for columnsRight',
		Array.from(
			{ length: REELS_ON_BOARD },
			(_u, reel) =>
				tumbleExplosionDelays(
					column(reel),
					{ pattern: 'columnsRight', stepMs: 220 },
					boardBounds,
				)[0],
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
			...Array.from(
				{ length: REELS_ON_BOARD },
				(_u, reel) =>
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
				tumbleExplosionDelays(
					column(reel),
					{ pattern: 'random', stepMs: 10 },
					boardBounds,
					() => 0.42,
				),
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

/**
 * The REAL `awaitExplosion`, sliced the same way and for the same reason as the handler above.
 *
 * It is what decides that a symbol stops being DRAWN the moment its own pop reports — the half of
 * the step that keeps an early column from re-playing its explosion while the later ones are still
 * going. Restating it here instead of slicing it would leave the rule the fixture exists to protect
 * untested, which is how it would come back.
 */
const awaitExplosionSource = (() => {
	const component = read('apps/lines/src/components/TumbleBoard.svelte');
	const script = component.slice(component.lastIndexOf('<script lang="ts">'));
	const start = script.indexOf('\tconst awaitExplosion =');
	if (start < 0) throw new Error('TumbleBoard.svelte no longer declares awaitExplosion');
	// To the blank line that ends the declaration — Prettier separates top-level declarations, so
	// this is stable, and it throws rather than silently truncating if that ever stops being true.
	const end = script.indexOf('\n\n', start);
	if (end < 0) throw new Error('could not find the end of awaitExplosion');
	return script.slice(start, end);
})();

const buildAwaitExplosion = (awaitBeat) =>
	// eslint-disable-next-line no-new-func
	new Function(
		'awaitBeat',
		`${stripTypeScriptTypes(awaitExplosionSource)}\nreturn awaitExplosion;`,
	)(awaitBeat);

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
		const settledAt = now;
		// KEEP GOING past the step, because the game does. A timer armed before the step ended does
		// not evaporate when it ends: a symbol whose animation outran the beat cap still reports on
		// its own last frame, into a promise that has already settled — `symbolBeat.ts` says so in
		// as many words, and `awaitExplosion` depends on it to take a long pop off the board at the
		// right moment rather than at the cap. Stopping the clock at settlement would silently drop
		// exactly that timer and make the late report untestable.
		//
		// Bounded, and it does NOT move the reported settle time — that is captured above.
		for (let guard = 0; pending.length && guard < 100; guard += 1) {
			now = pending.reduce((min, t) => Math.min(min, t.at), Number.POSITIVE_INFINITY);
			const due = pending.filter((t) => t.at <= now).sort((a, b) => a.seq - b.seq);
			pending = pending.filter((t) => t.at > now);
			for (const timer of due) timer.resolve();
			await drain();
		}
		return settledAt;
	};
	return { wait, run, at: () => now };
};

/** The animation every symbol's `clearReel` takes here. Longer than any gap under test, so a
 *  step that resolved on the last POP rather than on the last BEAT would be caught. */
const BEAT_MS = 500;

/**
 * The cap the explosion beat is RACED against, read out of the shipped source so the fixture and the
 * game cannot drift apart on it.
 *
 * It matters here — rather than being a detail of a helper this fixture does not slice — because the
 * two ends of that race behave differently on purpose: a symbol that REPORTS is taken off the board,
 * and one that only ever hits the cap is left alone. Without modelling the cap, both a correct
 * implementation and one that marks the symbol after the `await` look identical.
 */
const TRANSIT_BEAT_CAP_MS = (() => {
	const source = read('apps/lines/src/game/symbolBeat.ts');
	const match = source.match(/export const TRANSIT_BEAT_CAP_MS = ([\d_]+);/);
	if (!match) throw new Error('symbolBeat.ts no longer declares TRANSIT_BEAT_CAP_MS');
	return Number(match[1].replaceAll('_', ''));
})();

const runExplode = async ({
	pattern,
	stepMs,
	seats,
	sweepAfter,
	spliceAfter,
	emerge,
	patternScope,
	// How long each seat's explosion takes to report. `null` = it never does — the symbol whose
	// state is bound to no art, or to a spine animation that is not in the skeleton.
	beatMs = BEAT_MS,
	// Seats (`"reel:row"`) the WIN-EXPLOSION POP already took off the board before this step began
	// (Invisible Symbols → "Winning symbols explode"). They sit on the survivor layer holding their
	// index, already UNDRAWN (`removed`) but in the ORDINARY `static` state — the board-wide removal
	// filters `base` by what THIS step popped, so a seat marked `clearReel` would be swept by a step
	// that never named it. The layer ADOPTS the reels' own cells, so both come along for free;
	// the claims at the end of part 6 pin that.
	preExploded = [],
}) => {
	const clock = createClock();
	const pops = [];
	// When each seat stopped being DRAWN — the cell's `removed` going true, which in the game is the
	// moment `ReelSymbol.svelte` stops drawing it. Recorded through a setter rather than read at the
	// end, because the whole question is WHEN it happens relative to the seat's own pop.
	const vanished = [];
	// One symbol object per seat, keyed the way the board keys them: `base[reel][row]`.
	const base = Array.from({ length: REELS }, (_reelUnused, reel) =>
		Array.from({ length: ROWS }, (_rowUnused, row) => {
			const gone = preExploded.includes(`${reel}:${row}`);
			let removed = gone;
			return {
				symbolState: 'static',
				rawSymbol: { name: 'H1' },
				get removed() {
					return removed;
				},
				set removed(next) {
					removed = next;
					if (next) vanished.push({ reel, row, at: clock.at() });
				},
			};
		}),
	);
	const stateTumble = { base, adding: [] };
	// Every explosion → intro transition the step schedules, with the virtual time it would MOUNT at.
	const bridges = [];
	const TRANSITION_DELAY_MS = 40;
	const env = {
		stateTumble,
		stateGameDerived: {
			// The transition is emerge-only, so both answers are needed: OFF is the ordering fixture's
			// default, ON exercises the bridge that has to cover each seat's own pop.
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
		// The real one mounts `layer.delayMs` after the seat's own pop. `poppedAt` is recorded beside
		// the mount because the whole assertion is about the OFFSET between the two: the bridge exists
		// to cover a pop, so it has to stay a fixed distance from the pop it covers, whatever wave the
		// pattern put that seat in.
		//
		// It still ADDS a fourth argument if the handler passes one, and that is the point rather than
		// leftover generosity. The regression this part exists to catch lived at the CALL SITE — the
		// handler handed `scheduleTransition` a per-seat catch-up that pulled every bridge onto the
		// last wave. A stub that ignored extra arguments would go on passing through exactly that
		// change; modelling the real arithmetic means the checks below fail the moment a bridge is
		// offset from its own pop again.
		scheduleTransition: (layer, _position, _symbol, extraDelayMs = 0) =>
			bridges.push({
				poppedAt: clock.at(),
				mountsAt: clock.at() + (layer.delayMs ?? 0) + extraDelayMs,
			}),
		// The beat: a symbol reports `oncomplete` BEAT_MS after its state is set, which is what an
		// authored explosion animation does.
		//
		// It fires the callback the caller ARMED rather than resolving behind its back, because the
		// caller does its own bookkeeping in there — `awaitExplosion` marks the symbol undrawn on
		// report — and a stub that just resolved would leave that rule untested. Arming is an
		// ASSIGNMENT (`symbol.oncomplete = …`), so it hands the callback straight back; the guard turns
		// a rewrite that stops doing so into a loud failure rather than a silently skipped check.
		//
		// The CAP is raced here exactly as `awaitSymbolBeat` races it, and that is not decoration.
		// The report and the cap are two different outcomes with two different consequences, so a stub
		// where the report always wins cannot tell a correct implementation from one that marks the
		// symbol after the `await` — which would take the cap path too, and cut a long pop off at 650 ms.
		// `beatMs: null` is the symbol that can NEVER report (no art, a spine animation missing from
		// the skeleton); a `beatMs` above the cap is the pop that is simply longer than the guard.
		awaitBeat: (arm) => {
			const started = clock.at();
			pops.push({ cue: 'pop', at: started });
			return new Promise((resolve) => {
				const report = arm(resolve);
				if (typeof report !== 'function') {
					throw new Error('awaitExplosion no longer arms by assignment — this stub cannot report');
				}
				if (beatMs !== null) clock.wait(beatMs).then(() => report());
				clock.wait(TRANSIT_BEAT_CAP_MS).then(() => resolve());
			});
		},
	};
	env.awaitExplosion = buildAwaitExplosion(env.awaitBeat);
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
		vanished,
		// The pop timeline, in the order the seats actually popped.
		popped: pops.filter((p) => p.cue === 'pop').map((p) => p.at),
		stepCueAt: pops.find((p) => p.cue === 'step')?.at,
		exploded: base.flatMap((reel, r) =>
			reel.flatMap((symbol, row) => (symbol.symbolState === 'clearReel' ? [`${r}:${row}`] : [])),
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
	// A bridge covers a POP, so it rides the pop it covers: `delayMs` after THAT seat's own wave,
	// never after the board's last one. This regressed once — the bridges were pulled onto the last
	// wave so they would all land on the board-wide intro together, and a wave-0 seat's cover then
	// arrived a whole spread after the symbol it was covering had finished popping.
	const seats = fullBoard();
	const run = await runExplode({ seats, pattern: 'columnsLeft', stepMs: 80, emerge: true });
	check('one bridge per exploding seat', run.bridges.length, 15);
	check(
		'...each one a fixed authored delay after its OWN pop, whatever wave it is in',
		[...new Set(run.bridges.map((b) => b.mountsAt - b.poppedAt))],
		[40],
	);
	// The bridges therefore SPREAD with the pattern rather than bunching. Stated as the mount times
	// themselves, because "the offset is constant" would still hold if every seat popped together.
	check(
		'...so the bridges sweep across the board with the waves',
		[...new Set(run.bridges.map((b) => b.mountsAt))].sort((a, b) => a - b),
		[40, 120, 200, 280, 360],
	);
	// PARITY: with no pattern every seat pops in the same frame, so the whole seam is byte-identical
	// to before patterns existed.
	const flat = await runExplode({ seats, emerge: true });
	check(
		'un-patterned — every seat pops together, so every bridge mounts together',
		[...new Set(flat.bridges.map((b) => b.mountsAt))],
		[40],
	);
	check(
		'...and the same authored offset holds there too',
		[...new Set(flat.bridges.map((b) => b.mountsAt - b.poppedAt))],
		[40],
	);
}

console.log('--- 5. a seat stops being drawn when its OWN explosion ends ---');

{
	// The board is not REMOVED until the whole step settles, and a pattern makes that a long wait: a
	// wave-0 seat finishes its pop and then sits through every later wave. Left on screen it kept
	// animating — and a cell's `loop` is absent by default, absent meaning loop, so it re-played its
	// explosion two or three times over while the columns to its right were still going.
	// 500 ms, which is the gap the owner had authored when they reported this: a step LONGER than the
	// animation is the shape that shows the fault, because it is what leaves a finished seat with
	// time to fill. An 80 ms sweep hides it — the whole spread is shorter than one beat, so nothing
	// has finished yet when the last column pops.
	const seats = fullBoard();
	const run = await runExplode({ seats, pattern: 'columnsLeft', stepMs: 500 });
	check('every exploding seat stops being drawn', run.vanished.length, 15);
	check(
		'...one beat after its OWN pop, never after the board is done with the step',
		[...new Set(run.vanished.map((v) => v.at))].sort((a, b) => a - b),
		[500, 1000, 1500, 2000, 2500],
	);
	// The point of the whole thing: the left of the board is already gone while the right is still
	// popping. Stated against the LAST POP rather than against `settledAt`, because that is the claim
	// — the board comes apart in waves — and it cannot be satisfied by everything vanishing early.
	const lastPop = Math.max(...run.popped);
	check(
		'...so the first column is gone before the last column has even popped',
		run.vanished.filter((v) => v.reel === 0).every((v) => v.at < lastPop),
		true,
	);
	check(
		'...and the step still ends a full beat after the last wave',
		run.settledAt,
		2000 + BEAT_MS,
	);

	// PARITY: with no pattern every seat pops together and vanishes together, in the same frame the
	// step settles — which is the frame `tumbleBoardRemoveExploded` would have taken them in anyway.
	// So an un-patterned board looks exactly as it did before this rule existed.
	const flat = await runExplode({ seats });
	check(
		'un-patterned — every seat vanishes in one frame',
		[...new Set(flat.vanished.map((v) => v.at))],
		[BEAT_MS],
	);
	check('...which is the frame the step itself settles on', flat.settledAt, BEAT_MS);

	// THE CAP PATH — and the whole reason the flag is set inside the armed callback rather than after
	// the `await`. `awaitSymbolBeat` races the report against TRANSIT_BEAT_CAP_MS, so settling after
	// the await would fire on the CAP as well, and the cap is a runaway guard rather than a pace.
	//
	// A pop LONGER than the guard therefore has to play out in full and vanish on its own last frame,
	// not be cut off at the cap. The armed callback survives losing the race and fires late, which is
	// exactly what makes that work.
	const long = await runExplode({ seats, beatMs: TRANSIT_BEAT_CAP_MS + 250 });
	check(
		'a pop longer than the beat cap still vanishes on its OWN last frame, not at the cap',
		[...new Set(long.vanished.map((v) => v.at))],
		[TRANSIT_BEAT_CAP_MS + 250],
	);
	check('...even though the step itself gave up at the cap', long.settledAt, TRANSIT_BEAT_CAP_MS);

	// And the other end of that race: a symbol that can NEVER report has no finished animation to act
	// on, so it is left alone and the board-wide removal takes it, exactly as before this existed.
	const silent = await runExplode({ seats, beatMs: null });
	check('a symbol that never reports is never marked spent', silent.vanished.length, 0);
	check('...and the step still ends on the cap', silent.settledAt, TRANSIT_BEAT_CAP_MS);

	// THE LAST LINK, asserted against the MARKUP because nothing here renders Svelte. Everything above
	// proves the flag is set at the right moment; only the cell component turns that into a symbol
	// the player stops seeing, and a flag nothing reads is worth exactly nothing. Deleting the gate
	// leaves all of the checks above green, which is precisely why this one is here.
	//
	// ONE cell component draws the board now, whether the reels or a cascade step are driving it
	// (docs/design/board-cell-continuity.md) — so this is the same gate the win-explosion pop uses,
	// which is what makes the two pops one picture rather than two flags that happen to agree.
	const cellMarkup = read('apps/lines/src/components/ReelSymbol.svelte');
	check(
		'the renderer gates the cell on the flag — a spent symbol is not drawn',
		/\{#if\s+!covered\s*&&\s*!removed\s*\}\s*<SymbolWrap/.test(cellMarkup),
		true,
	);

	// A seat swept off the board before its wave never pops, so it must never be marked spent either.
	const swept = await runExplode({ seats, pattern: 'columnsLeft', stepMs: 500, sweepAfter: 200 });
	check(
		'a seat swept before its wave never popped, so it never vanishes',
		swept.vanished.length,
		swept.popped.length,
	);
	check('...and that is fewer than the whole board', swept.vanished.length < 15, true);
}

console.log('--- 6. a seat the win already blew up is not blown up again ---');

{
	// THE CONTRACT IS ADOPTION, so it is read off the shipped initialiser rather than trusted: the
	// survivor layer takes the REELS' OWN CELLS where they sit, which is what carries both halves of
	// a popped seat across untouched. Undrawn (`removed`) is what stops the symbol coming back on
	// screen; ORDINARY (`static`, not `clearReel`) is what stops a step that never named the seat
	// from sweeping it out of `base`. Neither is re-derived, so neither can be re-derived wrongly —
	// which is exactly how the old clone got it wrong until it was taught to read `boardRemoved()`.
	const tumbleBoard = read('apps/lines/src/components/TumbleBoard.svelte');
	const adoption = tumbleBoard.slice(
		tumbleBoard.indexOf('const initTumbleBoardBaseReel'),
		tumbleBoard.indexOf('const initTumbleBoardBase ='),
	);
	check(
		'the survivor layer adopts the board’s own cells',
		adoption.includes('reelState.symbols') && adoption.includes('attachCascadeSeat('),
		true,
	);
	check(
		'...and rewrites neither the removal flag nor the state on the way in',
		!adoption.includes('removed') && !adoption.includes('symbolState'),
		true,
	);
}

{
	// "Explode and be gone" (Invisible Symbols → "Winning symbols explode"): a round's winning cells
	// are off the board before the next step ever runs. A CASCADE cannot filter them out at the
	// source — its exploding set is the BOOK's, and the book still names the cells that paid — so the
	// step itself has to recognise a seat that is already gone.
	//
	// It draws nothing, which is the whole hazard: no cell, no `oncomplete`, so a step that popped it
	// anyway would wait out the beat cap for an animation nobody can see — on a cascade, once per
	// chain step.
	const seats = fullBoard();
	const gone = ['1:1', '2:1', '3:1'];
	const run = await runExplode({ seats, preExploded: gone });
	check('the step pops every seat but the ones already gone', run.popped.length, 15 - gone.length);
	check('...and none of them is marked spent a second time', run.vanished.length, 15 - gone.length);
	check(
		'...while the step MARKS them, so its own board-wide removal takes them with the rest',
		run.exploded.length,
		15,
	);
	// The COST is the point: a step that awaited the gone seats would end on the runaway guard
	// instead of on the animation every other seat is actually playing.
	check('...and the step still ends one ordinary beat later', run.settledAt, BEAT_MS);
	check('...not on the runaway cap', run.settledAt < TRANSIT_BEAT_CAP_MS, true);
	// PARITY: nothing gone ⇒ the same run pops all fifteen, exactly as part 2 asserts.
	const untouched = await runExplode({ seats });
	check('nothing gone ⇒ every seat still pops', untouched.popped.length, 15);
}

{
	// A STEP OWNS ONLY WHAT IT NAMES, and this is the claim a cascade's correctness rests on.
	//
	// `tumbleBoardRemoveExploded` filters `base` by `symbolState === 'clearReel'`, and a cascade's
	// `adding` layer is sized to `bookEvent.explodingSymbols`. So if a seat the ROUND popped were
	// swept by a step that never named it, the combined column would come up SHORT: it is broadcast
	// as `boardSettle` and written to the reels, `combineTumbleReel`'s "baseReel[0] is the top pad"
	// assumption starts pointing at a real symbol, and every later step of the chain addresses the
	// wrong rows. Nothing about that is visible until the next win frame is drawn over a symbol that
	// never paid.
	//
	// So: one seat the pop emptied, and a step whose set is the row BELOW it — the book's own cells.
	const named = fullBoard().filter((seat) => seat.row === 2);
	const run = await runExplode({ seats: named, preExploded: ['0:0'] });
	check('the step marks exactly the seats it named', run.exploded.join(','), '0:2,1:2,2:2,3:2,4:2');
	check('...and the seat the ROUND emptied is NOT among them', run.exploded.includes('0:0'), false);
	check('...so the board-wide removal cannot take it', run.exploded.length, named.length);
	check('...and the step is still one ordinary beat', run.settledAt, BEAT_MS);
	// It is still invisible — that half of the contract has not moved.
	check('...while it stays undrawn throughout', run.vanished.length, named.length);
}

console.log('');
console.log(failures ? `FAILED — ${failures} of ${checks} checks` : `PASSED — ${checks} checks`);
// `exitCode`, not `process.exit()`: an abrupt exit races Node's own type-stripper teardown on
// Windows and aborts with a libuv assertion AFTER the report has printed, which reads as a failure.
process.exitCode = failures ? 1 : 0;
