import type { ModePolicy } from './modeStack';

/**
 * Which book events move the mode stack (`docs/design/hold-and-win.md` §4.5).
 *
 * `modeEnter { mode, cause?, meters?, policy?, payload? }` / `modeExit { mode, total? }` are the generic pair.
 * The feature events that already exist are ALIASES of them, so a Book-of game's free spins become
 * the `freeSpins` mode without its book, its facade or its flow changing:
 *
 * | event               | is                       |
 * |---------------------|--------------------------|
 * | `freeSpinTrigger`   | `modeEnter freeSpins`    |
 * | `freeSpinEnd`       | `modeExit freeSpins`     |
 *
 * (A free-spin event that names a `mode` enters or exits THAT mode instead — a reels mode of the
 * project's own, such as free spins imported from another project, played with the free-spin
 * presentation on its own game type. As `holdAndWinTrigger`'s `mode` already does.)
 * | `holdAndWinTrigger` | `modeEnter holdAndWin`   |
 * | `holdAndWinEnd`     | `modeExit holdAndWin`    |
 *
 * An enter applies BEFORE its event is presented (the event belongs to the mode it opens), an exit
 * AFTER (the event is the mode's last beat). `legacyGameType` marks the free-spin aliases, whose
 * handlers and flow actions (`setFreeGameType`, `enterFreeSpinOutro`) already write
 * `stateGame.gameType` at a moment of their own choosing; the mode layer leaves that write to them,
 * so a free-spin round sets the game type exactly when it always did.
 */
export type ModeOp =
	| {
			op: 'enter';
			id: string;
			policy: ModePolicy;
			cause?: string;
			payload: Record<string, unknown>;
			legacyGameType: boolean;
	  }
	| { op: 'exit'; id: string; total?: number; legacyGameType: boolean };

type LooseEvent = { type: string } & Record<string, unknown>;

const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const finite = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const policyOf = (v: unknown): ModePolicy => (v === 'queue' ? 'queue' : 'nest');

/** Every field of the event except its envelope — what a mode entry carries as its payload. */
const payloadOf = (event: LooseEvent, drop: readonly string[]): Record<string, unknown> => {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(event)) {
		if (key === 'type' || key === 'index' || drop.includes(key)) continue;
		out[key] = value;
	}
	return out;
};

/**
 * The payload a mode entry keeps: the event's nested `payload` (the `modeEnter` shape, which
 * `holdAndWinTrigger` shares — `engine-game` `holdAndWin.ts`), else every field but the envelope.
 */
const modePayloadOf = (event: LooseEvent): Record<string, unknown> => {
	const nested = event.payload;
	if (typeof nested !== 'object' || nested === null || Array.isArray(nested))
		return payloadOf(event, ['mode', 'cause', 'policy']);
	// A top-level `meters` (the full pots that started it) joins the payload it would otherwise skip.
	return Array.isArray(event.meters)
		? { ...(nested as Record<string, unknown>), meters: event.meters }
		: (nested as Record<string, unknown>);
};

/**
 * The full pots that started a mode (`cause: 'meter'`), from its entry's payload — where every entry
 * event carries them (`holdAndWinTrigger.payload.meters`, `freeSpinTrigger.meters`,
 * `modeEnter.meters`). `[]` for a mode no pot started.
 */
export const modeEntryMeters = (entry: { payload: Record<string, unknown> }): string[] => {
	const meters = entry.payload.meters;
	return Array.isArray(meters) ? meters.filter((id): id is string => typeof id === 'string') : [];
};

/** The book-event types that can move the stack — the snapshot keeps these for a resume. */
export const MODE_EVENT_TYPES = [
	'modeEnter',
	'modeExit',
	'freeSpinTrigger',
	'freeSpinEnd',
	'holdAndWinTrigger',
	'holdAndWinEnd',
] as const;

/** The mode op a book event performs, or `undefined` for an event that does not move the stack. */
export function modeOpOf(bookEvent: { type: string }): ModeOp | undefined {
	const event = bookEvent as LooseEvent;
	switch (event.type) {
		case 'modeEnter': {
			const id = text(event.mode);
			if (!id) return undefined;
			return {
				op: 'enter',
				id,
				policy: policyOf(event.policy),
				cause: text(event.cause),
				payload: modePayloadOf(event),
				legacyGameType: false,
			};
		}
		case 'modeExit': {
			const id = text(event.mode);
			return id ? { op: 'exit', id, total: finite(event.total), legacyGameType: false } : undefined;
		}
		case 'freeSpinTrigger':
			return {
				op: 'enter',
				id: text(event.mode) ?? 'freeSpins',
				policy: 'nest',
				cause: text(event.cause),
				payload: payloadOf(event, ['cause', 'mode']),
				legacyGameType: true,
			};
		case 'freeSpinEnd':
			return {
				op: 'exit',
				id: text(event.mode) ?? 'freeSpins',
				total: finite(event.amount),
				legacyGameType: true,
			};
		case 'holdAndWinTrigger':
			return {
				op: 'enter',
				id: text(event.mode) ?? 'holdAndWin',
				policy: policyOf(event.policy),
				cause: text(event.cause),
				payload: modePayloadOf(event),
				legacyGameType: false,
			};
		case 'holdAndWinEnd':
			return {
				op: 'exit',
				id: text(event.mode) ?? 'holdAndWin',
				total: finite(event.total),
				legacyGameType: false,
			};
		default:
			return undefined;
	}
}

/** The game type the base game runs on — what a mode the Game Config does not declare falls back to. */
export const BASE_GAME_TYPE = 'basegame';

/**
 * The game type a mode puts on screen: its declared one (`declared(modeId)`, from the Game Config's
 * mode registry), else the BASE game type. A mode id is not a game type — falling back to it left
 * every game-type-keyed screen with no match while an undeclared (queued) mode was on top. An
 * undeclared mode is warned about once, by id, so the missing declaration is visible.
 */
export function createModeGameTypeResolver(
	declared: (modeId: string) => string | undefined,
	warn: (message: string) => void,
): (modeId: string) => string {
	const warned = new Set<string>();
	return (modeId) => {
		const gameType = declared(modeId);
		if (gameType !== undefined) return gameType;
		if (!warned.has(modeId)) {
			warned.add(modeId);
			warn(
				`[modes] mode "${modeId}" is not declared in the Game Config — it plays on the base game type`,
			);
		}
		return BASE_GAME_TYPE;
	};
}
