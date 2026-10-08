import type { SceneSetOptions } from 'engine-layout';
import {
	bonusCapabilityInputs,
	bonusSplitOf,
	flowAddOnsOf,
	primaryRespinMode,
	resolveExpandingSymbol,
	resolveMeters,
	type GameConfigDoc,
} from 'game-config';

/** What a project's Game Config adds to its kind (docs/design/pots-overlay.md §4, bonus-games.md
 *  §2.4): a declared respin mode (`holdAndWin`), the pots overlay's block, and the Book-of expanding
 *  special (docs/design/book-feature.md §3.3) — the `KindCapabilityConfig` flags the kind-gated
 *  editor surfaces read. All `false` without a config, which `kindCapabilities` answers exactly as
 *  it does with no config at all. */
export type ProjectAddOns = { holdAndWin: boolean; potsOverlay: boolean; expandingSymbol: boolean };

type AddOnDoc =
	| Pick<
			GameConfigDoc,
			| 'holdAndWin'
			| 'potsOverlay'
			| 'coinOverlay'
			| 'modes'
			| 'freeSpins'
			| 'symbols'
			| 'paddingReels'
	  >
	| null
	| undefined;

/** A declared respin mode, as the Scene Editor and Invisible Symbols show it. */
export type RespinModeInfo = {
	id: string;
	/** The name the tools show: the mode's label, else its id. */
	label: string;
	/** Its board grows to this many rows (its rules' `expansion`). */
	maxRows?: number;
	/** Its rules' jackpot tiers, in order. */
	jackpotTiers: string[];
};

/**
 * Every respin mode with rules the project declares (design bonus-games.md §2.1), read through the
 * split form so a legacy doc lists the mode its block implies. A rule-less respin mode is inert
 * (a warning until `/config` can author it), so no tool shows it. The primary respin mode (the one the legacy
 * `holdAndWin` key mirrors) comes first, then the rest in declaration order.
 */
export function respinModesOf(doc: AddOnDoc): RespinModeInfo[] {
	if (!doc) return [];
	const modes = (bonusSplitOf(doc).modes ?? []).filter(
		(mode) => mode.board === 'respinBoard' && mode.holdAndWin,
	);
	const primary = primaryRespinMode(modes);
	const ordered = primary ? [primary, ...modes.filter((mode) => mode !== primary)] : modes;
	return ordered.map((mode) => {
		const maxRows = mode.holdAndWin?.expansion?.maxRows;
		return {
			id: mode.id,
			label: mode.label ?? mode.id,
			...(maxRows ? { maxRows } : {}),
			jackpotTiers: (mode.holdAndWin?.jackpots ?? []).map((jackpot) => jackpot.name),
		};
	});
}

/**
 * The project's add-ons, plus the pot ids its pots screen shows: every resolved meter, the Hold
 * and Win block's first. Both add-ons come from the split form (game-config's
 * `bonusCapabilityInputs`): the respin feature when a declared respin mode has rules, the pots
 * overlay when the coin overlay drops tokens. Coin roles follow the respin feature alone
 * (`kindCapabilities().coinSymbols`), so a pots-only host's valueless tokens add none. The meters
 * are read through `flowAddOnsOf`, the one reader Invisible Flow composes from too. `potIds` is
 * null when no config resolves, so the scene set keeps its built-in pots.
 */
export function projectAddOns(doc: AddOnDoc): {
	addOns: ProjectAddOns;
	potIds: string[] | null;
} {
	const { meters } = flowAddOnsOf(doc);
	const bonus = doc ? bonusCapabilityInputs(doc) : undefined;
	const holdAndWin = bonus?.respinMode ?? false;
	const potsOverlay = bonus?.potsOverlay ?? false;
	const expandingSymbol = resolveExpandingSymbol(doc ?? undefined) !== undefined;
	return { addOns: { holdAndWin, potsOverlay, expandingSymbol }, potIds: doc ? meters : null };
}

/** The tallest board any respin mode grows to — the rows the base reel grid reserves. */
export function respinMaxRows(modes: readonly RespinModeInfo[]): number | undefined {
	const rows = Math.max(0, ...modes.map((mode) => mode.maxRows ?? 0));
	return rows || undefined;
}

/**
 * The scene-set options a project's layout is seeded from. A Hold and Win kind's own block is its
 * base game, so only an overlay names its pots there; every other kind gets the add-on screens
 * whenever its config carries either. `maxRows` is the tallest respin board, and `respinModes`
 * names every respin mode with its own `maxRows`, so each gets its own screens. Without an add-on
 * the result is what the scaffold has always passed (`maxRows` alone, read by the Hold and Win kind
 * only), so its layout is unchanged.
 */
export function sceneSetOptionsFor(gameType: string, doc: AddOnDoc): SceneSetOptions {
	const { addOns, potIds } = projectAddOns(doc);
	const modes = respinModesOf(doc);
	const maxRows = respinMaxRows(modes);
	const addOn =
		gameType === 'holdAndWin' ? addOns.potsOverlay : addOns.holdAndWin || addOns.potsOverlay;
	return {
		...(maxRows ? { maxRows } : {}),
		...(modes.length
			? {
					respinModes: modes.map(({ id, label, maxRows }) => ({
						id,
						label,
						...(maxRows ? { maxRows } : {}),
					})),
				}
			: {}),
		...(addOn
			? {
					holdAndWin: addOns.holdAndWin,
					potsOverlay: addOns.potsOverlay,
					...(potIds ? { potIds } : {}),
				}
			: {}),
	};
}

/** Each pots overlay token → the pots it fills. Tokens are never on a strip, so the in-play set
 *  misses them and a tool lists them from here. Empty without the block. */
export function overlayTokenPots(doc: AddOnDoc): Record<string, string[]> {
	const tokens: Record<string, string[]> = {};
	for (const meter of doc ? resolveMeters(doc) : []) {
		if (meter.source === 'overlay') (tokens[meter.symbol] ??= []).push(meter.id);
	}
	return tokens;
}
