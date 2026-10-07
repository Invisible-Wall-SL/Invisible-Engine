import { kindCapabilities } from 'engine-layout';
import {
	resolveCascade,
	resolveReelBehaviour,
	symbolHoldAndWinRoles,
	symbolsUsed,
	symbolUses,
} from 'game-config';
import { overlayTokenPots, projectAddOns } from '$lib/addOns';
import { bigTiersOf, type ResolvedGameConfig } from './gameConfigDefaults';
import { symbolGrid, type SymbolDefaults } from './symbolDefaults';

/**
 * Everything the Invisible Symbols page reads off the Game Config, from `resolveGameConfig`'s result:
 * the config Invisible Game Config opens with, the project's own or else its kind's template. One doc
 * feeds the rows and every gate, saved or not, so this page cannot list or light anything that page
 * does not show (`check:symbols-follow-config` runs it over every kind and setup).
 *
 * `defaults` give every cell its default binding: the project's own published `SYMBOL_INFO_MAP`, else
 * the committed set for its kind. Which ROWS show is the config's call, never theirs (`symbolGrid`).
 */
export function symbolsPageConfig(
	gameType: string,
	defaults: SymbolDefaults,
	config: ResolvedGameConfig,
) {
	const { doc } = config;
	const grid = symbolGrid(defaults, doc);
	const uses = doc ? symbolUses(doc) : {};
	const listed = new Set(grid.symbols);
	const { addOns, potIds } = projectAddOns(doc);
	// Each symbol's Hold and Win role(s) from the config's `special_properties` — chips on the grid's
	// row heads, so the author sees which row is the coin, the collector, the mystery. Only for a kind
	// with coin symbols; every other kind gets an empty map and renders as before.
	const holdAndWinRoles: Record<string, string[]> = {};
	if (doc && kindCapabilities(gameType, addOns).coinSymbols) {
		for (const [name, symbol] of Object.entries(doc.symbols)) {
			const roles = symbolHoldAndWinRoles(symbol);
			if (roles.length) holdAndWinRoles[name] = roles;
		}
	}
	const reel = resolveReelBehaviour(doc ?? undefined);
	return {
		defaults: grid.defaults,
		// The rows the grid lists, in order — see `symbolGrid`.
		symbols: grid.symbols,
		// The rows that are the pots overlay's coins (its tokens), in pot order — a group of their own
		// after the symbols, as `/config` gives them a section of their own.
		coins: doc ? symbolsUsed(doc).filter((name) => uses[name] === 'token' && listed.has(name)) : [],
		// Does this project tumble? Gates the `Clear reel` column, which only means anything to a
		// cascading game. Resolved (not the raw stored field) so the answer matches the one the game
		// itself acts on: absent ⇒ the win model's default, so a cluster/scatter project gets the
		// column without authoring anything and a lines project that switched the cascade ON in
		// /config gets it too.
		cascade: resolveCascade(doc ?? undefined),
		/**
		 * HOW this project's board arrives, resolved — the gate on the two columns that only mean
		 * something to a swapping board.
		 *
		 * `emerge` gates the `Intro` column: the state is only ever played by `swapStyle: 'emerge'`,
		 * and a column for an animation nothing fires is the exact failure this tool's gating exists
		 * to avoid.
		 *
		 * `clears` is the fix to a gap the clear step shipped with. `Clear reel` was gated on
		 * `cascade` alone, but a swap-in-place project with "Clear the board" ticked plays that very
		 * state on every round (`clearOutgoingSymbols`) — so a lines game authoring the sink half of
		 * an emerge was offered no column for it and had to reach the binding through `Explosion`'s
		 * inheritance without ever being told that is what it was doing.
		 */
		reelBehaviour: {
			emerge: reel.swapInPlace && reel.swapStyle === 'emerge',
			clears: reel.clearBoard,
		},
		holdAndWinRoles,
		// Each pots overlay token → the pots it fills: a chip on its row head. Empty without the block.
		tokenPots: overlayTokenPots(doc),
		// The add-on blocks the config carries — passed with the kind to `kindCapabilities`, so a
		// Hold and Win bonus or a pots overlay lights its own parts on any kind.
		addOns,
		// The Hold and Win jackpot tiers the Game Config declares — the rows of the coin label's
		// per-tier jackpot text. Empty ⇒ the page offers the four tiers the presets use.
		jackpotTiers: (doc?.holdAndWin?.jackpots ?? []).map((jackpot) => jackpot.name),
		// The config's BIG-win tiers drive the reel-anticipation panel: ONE FX column per big tier,
		// keyed by its alias — mirroring the tiers the game arms (`activeBigTiers`), so the panel
		// grows/shrinks with `/config` rather than a fixed big/mega/massive triple.
		bigTiers: bigTiersOf(doc),
		// Every meter the Game Config declares (`resolveMeters`: Hold and Win meters, then overlay
		// pots) — one `toMeter:<id>` row each in the Flights section, so a single pot can fly
		// differently from the rest.
		meterIds: potIds ?? [],
	};
}
