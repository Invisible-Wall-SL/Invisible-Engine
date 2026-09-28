import type { BetType } from 'rgs-requests';
import type { BaseBookEvent } from 'utils-book';

/**
 * THE BOOK-EVENT CONTRACT — the second half of Phase B in `docs/design/game-type-templates.md`: the
 * book events the SHARED engine reads itself, and exactly which fields it reads off each. Everything
 * else a game's RGS sends is the mechanic's business, handled by the game's own handler map.
 *
 * The round seam reads these whichever dispatch path presents the event. Resuming a bet mid-bonus
 * additionally keeps `updateGlobalMult` / `freeSpinTrigger` / `updateFreeSpin` / `setTotalWin` by
 * NAME alone — a game naming them differently loses them from the snapshot rather than failing here.
 */
export type EngineBookEventFields = {
	winInfo: { totalWin: number };
	setWin: { amount: number; winLevel: number };
	freeSpinRetrigger: { extraFs: number };
	freeSpinTrigger: { totalFs: number };
};

/**
 * The one arm the engine BUILDS rather than reads (the resume snapshot), so it is checked the other
 * way round: the game's arm must ACCEPT exactly what the engine constructs.
 */
type BonusSnapshot<T> = { index: number; type: 'createBonusSnapshot'; bookEvents: T[] };

/** The contract as a union — what `GameBookEvent` is when no game has registered its own. */
export type EngineBookEvent =
	| {
			[K in keyof EngineBookEventFields]: { index: number; type: K } & EngineBookEventFields[K];
	  }[keyof EngineBookEventFields]
	| { index: number; type: 'createBonusSnapshot'; bookEvents: EngineBookEvent[] };

/** The contract arms `T` lacks or declares incompatibly. `never` ⇒ it conforms. */
export type MissingEngineBookEvents<T extends BaseBookEvent> =
	| {
			[K in keyof EngineBookEventFields]: [Extract<T, { type: K }>] extends [never]
				? K
				: Extract<T, { type: K }> extends EngineBookEventFields[K]
					? never
					: K;
	  }[keyof EngineBookEventFields]
	| ([BonusSnapshot<T>] extends [Extract<T, { type: 'createBonusSnapshot' }>]
			? never
			: 'createBonusSnapshot');

/**
 * A game's book-event union, admitted only if it implements the contract. A union that does not
 * becomes an object NAMING the missing arms, so every engine read fails with that name in the error
 * rather than somewhere deep in the round seam.
 */
export type ImplementsEngineBookEvents<T extends BaseBookEvent> = [
	MissingEngineBookEvents<T>,
] extends [never]
	? T
	: { missingEngineBookEvents: MissingEngineBookEvents<T> };

/**
 * Where a game hands the engine its book-event union — the same declaration-merging seam as
 * `GameContext`, and for the same reason: a package cannot import from an app.
 *
 * ```ts
 * declare module 'engine-game' {
 *   interface BookEventRegistry {
 *     bookEvent: ImplementsEngineBookEvents<BookEvent>;
 *   }
 * }
 * ```
 *
 * It is what lets the engine read book-event ARMS with the game's own precision. A factory GENERIC
 * over the game's union cannot: TypeScript does not narrow a type parameter by `bookEvent.type`, so
 * `winInfo.totalWin` would have to be read through a cast. Registered, `GameBookEvent` is a concrete
 * union inside the package and narrows exactly as it does in the app.
 */
// Empty ON PURPOSE — a declaration-merging seam (see `GameContext`), not a type that forgot its members.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface BookEventRegistry {}

/** The running game's book-event union, or the bare contract when no game has registered one. */
export type GameBookEvent = BookEventRegistry extends { bookEvent: infer T } ? T : EngineBookEvent;

export type GameBookEventOfType<T> = Extract<GameBookEvent, { type: T }>;
export type GameBookEventContext = { bookEvents: GameBookEvent[] };
export type GameBet = BetType<GameBookEvent>;
