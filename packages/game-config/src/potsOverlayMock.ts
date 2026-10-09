/**
 * What the mock RGS deals a pots overlay from (`withPotsOverlay` in `scripts/mock-pots-overlay.mjs`),
 * beside the host kind's own mock. One derivation, read by the launcher's mock contract and by the
 * protocol gate, so the gate proves the rounds the test server actually deals.
 */

import { legacyPotsOverlay } from './bonusGames';
import { holdAndWinIsOverlayBonus } from './holdAndWin';
import { holdAndWinMockInputs, type HoldAndWinMockInputs } from './holdAndWinMock';
import { builtinGameModes, gameModeById, gameTypeForMode, type GameModeDecl } from './modes';
import { spinsGameView } from './spinsGame';
import { overlayDropModes, type OverlayDrops, type OverlayPot } from './potsOverlay';
import type { GameConfigDoc, WinModel } from './types';

export type PotsOverlayMockInputs = {
	pots: OverlayPot[];
	/** The drop rules, with the dropping modes resolved (the base game when unauthored). */
	drops: OverlayDrops & { modes: string[] };
	/** The Hold and Win feature a pot or the value coins start — present only when the project's
	 *  `holdAndWin` block is the overlay's BONUS, never when it is the base game. */
	holdAndWin?: HoldAndWinMockInputs;
	/**
	 * The REELS modes of the project's own a pot starts (an imported free spins, `./imports`), by
	 * mode id: the game type it plays on, the strips the mock deals its spins from and the line pays
	 * (`occurs → multiplier`) of the symbols on them that pay on a line. Absent when no pot routes to
	 * one, so every overlay before imports existed is dealt exactly as before. Names are the
	 * project's; the launcher's contract puts them in the server's vocabulary.
	 */
	modes?: Record<string, ReelsModeMockInput>;
};

/** What the mock deals a REELS mode of the project's own from. */
export type ReelsModeMockInput = {
	gameType: string;
	strips: string[][];
	paytable: Record<string, Record<string, number>>;
	/** A spins mode only (`./spinsGame`): the game its spins are dealt and paid on. */
	game?: {
		spins: number;
		winModel: WinModel;
		reels: number;
		rows: number[];
		paylines: number[][];
	};
};

/**
 * One reels mode's mock input — its strips, the line pays of the symbols on them (a spins mode's own
 * pays over the dictionary's), and a spins mode's game — or `undefined` when it has no strips to deal.
 */
export function reelsModeMockInput(
	doc: GameConfigDoc,
	mode: GameModeDecl,
): ReelsModeMockInput | undefined {
	const gameType = gameTypeForMode(mode);
	const strips = (doc.paddingReels[gameType] ?? []).map((strip) => strip.map((c) => c.name));
	if (!strips.length) return undefined;
	const view = mode.spins ? spinsGameView(doc, mode.spins) : undefined;
	const symbols = view?.symbols ?? doc.symbols;
	const paytable: Record<string, Record<string, number>> = {};
	for (const name of new Set(strips.flat())) {
		const symbol = symbols[name];
		const special = symbol?.special_properties ?? [];
		// A scatter's or wild's pay is not a line pay: the mock pays them its own way.
		if (!symbol?.paytable?.length || special.includes('scatter') || special.includes('wild')) {
			continue;
		}
		paytable[name] = Object.assign({}, ...symbol.paytable);
	}
	if (!view) return { gameType, strips, paytable };
	return {
		gameType,
		strips,
		paytable,
		game: {
			spins: view.spins,
			winModel: view.winModel,
			reels: view.numReels,
			rows: view.numRows,
			paylines: view.winModel.type === 'lines' ? Object.values(view.paylines) : [],
		},
	};
}

/** The mock's overlay inputs for a normalized doc, or `undefined` when it has no `potsOverlay`. */
export function potsOverlayMockInputs(doc: GameConfigDoc): PotsOverlayMockInputs | undefined {
	const overlay = legacyPotsOverlay(doc);
	if (!overlay) return undefined;
	const holdAndWin = holdAndWinIsOverlayBonus(doc) ? holdAndWinMockInputs(doc) : undefined;
	const builtin = new Set(builtinGameModes().map((m) => m.id));
	const modes: NonNullable<PotsOverlayMockInputs['modes']> = {};
	for (const pot of overlay.pots) {
		const mode = gameModeById(doc, pot.bonus.mode);
		if (!mode || builtin.has(mode.id) || mode.board !== 'reels') continue;
		const input = reelsModeMockInput(doc, mode);
		if (input) modes[mode.id] = input;
	}
	return {
		pots: overlay.pots,
		drops: { ...overlay.drops, modes: overlayDropModes(overlay.drops) },
		...(holdAndWin ? { holdAndWin } : {}),
		...(Object.keys(modes).length ? { modes } : {}),
	};
}
