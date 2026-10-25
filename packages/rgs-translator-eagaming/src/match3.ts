/**
 * The match-3 wire (`docs/reference/match3-wire.md`) → the engine's book events.
 *
 * ⚠️ OURS, not the partner's: no provider has shown us a match-3 round, so `move`, `match3Board`,
 * `match3Move`, `match3End` and `config.match3` are what our mock speaks. When a real provider
 * delivers its format, this file is rewritten; nothing above the facade may depend on the wire.
 *
 * Pure functions: the facade supplies how a cell becomes a symbol (the active mapping — identity for
 * a match-3 server) and how cents become book units (against the round's base stake).
 */

import { MATCH3_WIRE } from './gameMappings';
import type {
	Match3BoardContext,
	Match3BootConfig,
	Match3EndContext,
	Match3MoveContext,
	Match3WireCell,
	Play4FunBookEvent,
} from './types';

/** A board cell as the engine wants it (`toRawSymbol` in the facade). */
export type Match3RawSymbol = { name: string } & Record<string, unknown>;

export interface Match3Translate {
	symbol: (cell: string) => Match3RawSymbol;
	/** Cents → book units (fixed-point multiples of the round's base stake). */
	amount: (cents: number) => number;
	/** Rows the engine pads ABOVE the visible grid — a cascade's exploding cells are padded rows. */
	paddingRows: number;
	/** The server's shortest matching run (boot `config.match3.minRun`), which the mirror plays by. */
	minRun: number;
}

/**
 * Not a wire event: the one board a resumed round is handed (`condenseMatch3Replay`) — the last
 * board, its moves left and the running win.
 */
export const MATCH3_RESUME = '_match3Resume';

type Match3ResumeContext = { board: string[][]; movesLeft: number; roundWin: number };

/** The boot `config.match3` block, when it is on the wire this client reads; else null. */
export const readMatch3Config = (cfg: Record<string, unknown>): Match3BootConfig | null => {
	const block = cfg.match3 as Partial<Match3BootConfig> | undefined;
	if (!block || typeof block !== 'object' || block.wire !== MATCH3_WIRE) return null;
	return {
		wire: MATCH3_WIRE,
		minRun: typeof block.minRun === 'number' ? block.minRun : 3,
		moves: typeof block.moves === 'number' ? block.moves : 0,
	};
};

const isBoard = (value: unknown): value is string[][] =>
	Array.isArray(value) && value.every((reel) => Array.isArray(reel));

const cell = (c: Match3WireCell | undefined) => ({ reel: c?.reel ?? 0, row: c?.row ?? 0 });

const boardOf = (board: string[][], t: Match3Translate) =>
	board.map((reel) => reel.map((name) => t.symbol(name)));

const boardInit = (board: string[][], movesLeft: number, t: Match3Translate) => ({
	type: 'boardInit',
	board: boardOf(board, t),
	movesLeft,
	minRun: t.minRun,
});

/**
 * One match-3 wire event → the engine's book events (without `index`, which the facade numbers), or
 * null for an event that is not match-3's.
 *
 *   match3Board → boardInit
 *   match3Move  → swap, [tumbleBoard, updateTumbleWin] per step, movesLeft
 *   match3End   → match3RoundEnd
 */
export const translateMatch3Event = (
	name: string,
	context: unknown,
	t: Match3Translate,
): Record<string, unknown>[] | null => {
	switch (name) {
		case 'match3Board': {
			const ctx = (context ?? {}) as Partial<Match3BoardContext>;
			return [boardInit(isBoard(ctx.board) ? ctx.board : [], ctx.movesLeft ?? 0, t)];
		}
		case 'match3Move': {
			const ctx = (context ?? {}) as Partial<Match3MoveContext>;
			const out: Record<string, unknown>[] = [
				{ type: 'swap', from: cell(ctx.from), to: cell(ctx.to), accepted: ctx.accepted === true },
			];
			for (const step of ctx.steps ?? []) {
				out.push({
					type: 'tumbleBoard',
					explodingSymbols: (step.exploding ?? []).map((p) => ({
						reel: p.reel,
						row: p.row + t.paddingRows,
					})),
					newSymbols: (step.newSymbols ?? []).map((reel) => reel.map((name) => t.symbol(name))),
				});
				out.push({ type: 'updateTumbleWin', amount: t.amount(step.roundWin ?? 0) });
			}
			out.push({
				type: 'movesLeft',
				count: ctx.movesLeft ?? 0,
				board: boardOf(isBoard(ctx.board) ? ctx.board : [], t),
			});
			return out;
		}
		case 'match3End': {
			const ctx = (context ?? {}) as Partial<Match3EndContext>;
			return [
				{ type: 'match3RoundEnd', totalWin: t.amount(ctx.totalWin ?? 0), reason: ctx.reason },
			];
		}
		case MATCH3_RESUME: {
			const ctx = context as Match3ResumeContext;
			const out: Record<string, unknown>[] = [boardInit(ctx.board, ctx.movesLeft, t)];
			if (ctx.roundWin > 0) out.push({ type: 'updateTumbleWin', amount: t.amount(ctx.roundWin) });
			return out;
		}
		default:
			return null;
	}
};

/**
 * A replayed match-3 round condensed to what a resume presents: its `bet` (the stake every amount is
 * read against), ONE board — the last one (the last `match3Move`'s, else the `match3Board`), its moves
 * left and the running win — and, only when the round had already ended, its `match3End` and
 * `gameEnd`. Null when the replay dealt no board.
 */
export const condenseMatch3Replay = (events: Play4FunBookEvent[]): Play4FunBookEvent[] | null => {
	let board: string[][] | undefined;
	let movesLeft = 0;
	let roundWin = 0;
	for (const e of events) {
		if (e.event === 'match3Board') {
			const ctx = (e.context ?? {}) as Partial<Match3BoardContext>;
			if (isBoard(ctx.board)) board = ctx.board;
			movesLeft = ctx.movesLeft ?? movesLeft;
		} else if (e.event === 'match3Move') {
			const ctx = (e.context ?? {}) as Partial<Match3MoveContext>;
			if (isBoard(ctx.board)) board = ctx.board;
			movesLeft = ctx.movesLeft ?? movesLeft;
			roundWin = ctx.roundWin ?? roundWin;
		}
	}
	if (!board) return null;
	const bet = events.find((e) => e.event === 'bet');
	const end = events.find((e) => e.event === 'match3End');
	const gameEnd = end ? [...events].reverse().find((e) => e.event === 'gameEnd') : undefined;
	const resume = {
		event: MATCH3_RESUME,
		context: { board, movesLeft, roundWin } satisfies Match3ResumeContext,
	};
	return [...(bet ? [bet] : []), resume, ...(end ? [end] : []), ...(gameEnd ? [gameEnd] : [])];
};
