/**
 * The pots-overlay half of the facade: OUR wire (`docs/reference/hold-and-win-wire.md` "Pots
 * overlay") → the engine's overlay events (design §3.2 of `docs/design/pots-overlay.md`, typed in
 * `engine-game`'s `potsOverlay.ts`). The pots reuse the Hold and Win meter events; this adds the
 * dropped tokens and the per-bonus routing a host with two bonuses needs.
 *
 * ⚠️ A SWAP SEAM, like `holdAndWin.ts`: every input shape is ours, rewritten when the partner deals
 * overlays (Phase 8). Output shapes are restated structurally (the no-engine-deps rule).
 *
 * Everything here is gated on a captured `config.potsOverlay`. Without one the facade never calls
 * it, so every game without the block translates exactly as before.
 */

import { POTS_OVERLAY_WIRE } from './gameMappings';
import type { HoldAndWinMeterLevel } from './holdAndWin';

/** The engine mode a Hold and Win bonus is — `game-config`'s `HOLD_AND_WIN_MODE`, restated because
 *  this package takes no engine dependency. */
export const HOLD_AND_WIN_MODE = 'holdAndWin';

/** The `potsOverlay` block of the boot `config` — the fields the translation reads. */
export type PotsOverlayWireConfig = {
	wire: number;
	pots: { id: string; token: string; level: number; max: number; bonus?: string }[];
	/** `spinTrigger.bonus` key → the engine mode it enters (`respin` → `holdAndWin`, …). */
	bonuses: Record<string, string>;
};

const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The captured block, or null: no block, or a wire this client was not written for (said once,
 *  loudly — the game then plays as a host without pots rather than mis-reading them). A pot missing
 *  its id, level or max is dropped, as a boot meter is. */
export const readPotsOverlayConfig = (cfg: unknown): PotsOverlayWireConfig | null => {
	const block = (cfg as { potsOverlay?: Record<string, unknown> } | null)?.potsOverlay;
	if (!block || typeof block !== 'object') return null;
	if (block.wire !== POTS_OVERLAY_WIRE) {
		console.error(
			`[engine-facade] pots overlay wire ${String(block.wire)} — this client reads wire ${POTS_OVERLAY_WIRE}; its pots will not be shown`,
		);
		return null;
	}
	const pots = (Array.isArray(block.pots) ? block.pots : []).flatMap((pot: unknown) => {
		const { id, token, level, max, bonus } = (pot ?? {}) as Record<string, unknown>;
		return isText(id) && isFiniteNumber(level) && isFiniteNumber(max)
			? [
					{
						id,
						token: isText(token) ? token : '',
						level,
						max,
						...(isText(bonus) ? { bonus } : {}),
					},
				]
			: [];
	});
	const bonuses: Record<string, string> = {};
	const raw = block.bonuses;
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
		for (const [key, mode] of Object.entries(raw)) if (isText(mode)) bonuses[key] = mode;
	}
	return { wire: POTS_OVERLAY_WIRE, pots, bonuses };
};

/** The pots' levels at boot, in the meter shape the game seeds its pots from. */
export const overlayBootLevels = (overlay: PotsOverlayWireConfig): HoldAndWinMeterLevel[] =>
	overlay.pots.map(({ id, level, max }) => ({ id, level, max }));

/** Where a bonus plays: the respin board, or the host's own reels (its free spins). */
export type BonusRoute = 'respins' | 'reels';

/**
 * Each event's bonus route, by its index: the route of the bonus the latest `spinTrigger` named
 * (`spinTrigger.bonus` → `overlay.bonuses` → a mode), or undefined before any. A bonus key the
 * block does not list falls back to the Hold and Win block's own key (`config.holdAndWin.bonus`,
 * `respin` by default), so a Hold and Win game that adds an overlay still enters its respins. Any
 * mode other than Hold and Win plays on the reels: the host's free spins, or (Phase 7) a mode the
 * server also announces with `modeEnter`.
 */
export const bonusRoutes = (
	overlay: PotsOverlayWireConfig,
	holdAndWinBonusKey: string | null,
	events: readonly { event: string; context?: unknown }[],
): (BonusRoute | undefined)[] => {
	let route: BonusRoute | undefined;
	return events.map((e) => {
		if (e.event === 'spinTrigger') {
			const key = (e.context as { bonus?: unknown } | undefined)?.bonus;
			const mode = isText(key) ? overlay.bonuses[key] : undefined;
			const respins =
				mode !== undefined
					? mode === HOLD_AND_WIN_MODE
					: holdAndWinBonusKey !== null && key === holdAndWinBonusKey;
			route = respins ? 'respins' : 'reels';
		}
		return route;
	});
};

type WireDropCell = {
	reel?: unknown;
	row?: unknown;
	symbol?: unknown;
	pot?: unknown;
	value?: unknown;
	jackpot?: unknown;
};

/**
 * `overlayDrop {cells: [{reel, row, symbol, pot?, value?, jackpot?}]}` → the engine's
 * `overlayDrop {cells: [{reel, row, token, pot?, value?, jackpot?}]}`. Positions stay VISIBLE
 * 0-based, as every Hold and Win position does. The token name goes through the host's symbol
 * mapping (`mapName`), which passes an overlay's own names through. A cell missing its position or
 * symbol is dropped.
 */
export const overlayDropEvent = (ctx: unknown, mapName: (name: string) => string) => ({
	type: 'overlayDrop',
	cells:
		((ctx as { cells?: unknown } | null)?.cells as WireDropCell[] | undefined)?.flatMap((c) =>
			c && isFiniteNumber(c.reel) && isFiniteNumber(c.row) && isText(c.symbol)
				? [
						{
							reel: c.reel,
							row: c.row,
							token: mapName(c.symbol),
							...(isText(c.pot) ? { pot: c.pot } : {}),
							...(isText(c.jackpot)
								? { jackpot: c.jackpot }
								: isFiniteNumber(c.value)
									? { value: c.value }
									: {}),
						},
					]
				: [],
		) ?? [],
});

/** The trigger fields a pot adds to a mode entry: `{cause, meters}` from a `spinTrigger`, or
 *  nothing when it names no cause. */
export const entryCause = (ctx: unknown): { cause?: string; meters?: string[] } => {
	const { cause, meters } = (ctx ?? {}) as { cause?: unknown; meters?: unknown };
	if (!isText(cause)) return {};
	return {
		cause,
		...(Array.isArray(meters) ? { meters: meters.filter((id): id is string => isText(id)) } : {}),
	};
};
