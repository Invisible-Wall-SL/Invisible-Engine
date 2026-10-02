/**
 * The POTS OVERLAY presets (`docs/design/pots-overlay.md` §3.1). Unlike a Hold and Win preset — a
 * whole config a new project starts from — an overlay preset is an ADD-ON: its parts are merged
 * into a project that already has its own game, and nothing the project has is replaced.
 *
 * The drop chances and weights are PLACEHOLDERS for the mock to generate from, as in every preset.
 */

import type { HoldAndWin } from './holdAndWin';
import { HOLD_AND_WIN_PRESETS, type HoldAndWinPresetId } from './holdAndWinPresets';
import { symbolsInPlayFromStrips } from './inPlay';
import { HOLD_AND_WIN_MODE, gameModeById, gameTypeForMode } from './modes';
import type { OverlayPot, PotsOverlay } from './potsOverlay';
import type { GameConfigSymbol, PaddingReels } from './types';

export const POTS_OVERLAY_PRESET_IDS = ['threePots', 'potsToFreeSpins'] as const;

export type PotsOverlayPresetId = (typeof POTS_OVERLAY_PRESET_IDS)[number];

export const POTS_OVERLAY_PRESET_LABELS: Record<PotsOverlayPresetId, string> = {
	threePots: '3 Pots (each pot a Hold and Win with its special)',
	potsToFreeSpins: 'Pots to free spins',
};

/** What a preset adds to a doc. Each part is merged in — never a whole-doc reset. */
export type PotsOverlayPreset = {
	potsOverlay: PotsOverlay;
	/** Each token's dictionary entry: pays nothing, tagged `meterSpecial`, never put on a strip. */
	tokens: Record<string, GameConfigSymbol>;
	/** The Hold and Win preset whose feature a pot or a value coin starts, inserted through
	 *  {@link holdAndWinBonus}. Absent ⇒ nothing routes to Hold and Win. */
	holdAndWin?: HoldAndWinPresetId;
};

/** What a Hold and Win bonus adds to an overlay host. */
export type HoldAndWinBonus = {
	holdAndWin: HoldAndWin;
	/** The symbols its respin board deals, with their Hold and Win roles. */
	symbols: Record<string, GameConfigSymbol>;
	/** Its respin board's strips, under the Hold and Win mode's game type. */
	paddingReels: PaddingReels;
};

/**
 * A Hold and Win preset as an overlay host's BONUS: its block without the base-board-only options an
 * overlay host refuses (pattern, lucky spin, random metre, buy, instant collect), plus the symbols and
 * strips its respin board deals.
 *
 * Its symbol-filled meters go too, and `meterSpecial` with them: the overlay's pots replace them, and
 * a pot reusing a meter's id would name two pots.
 */
export function holdAndWinBonus(id: HoldAndWinPresetId): HoldAndWinBonus {
	const preset = HOLD_AND_WIN_PRESETS[id];
	if (!preset.holdAndWin) throw new Error(`Hold and Win preset "${id}" has no holdAndWin block.`);
	const { meters: _meters, ...source } = preset.holdAndWin;
	const { trigger, specials } = source;
	const block: HoldAndWin = {
		...source,
		trigger: trigger.count ? { count: trigger.count } : {},
		specials: {
			...specials,
			...(specials.collector && {
				collector: { ...specials.collector, instantCollectInBaseGame: false },
			}),
			...(specials.multiplier && {
				multiplier: { ...specials.multiplier, instantCollectInBaseGame: false },
			}),
		},
	};
	const gameType = gameTypeForMode(
		gameModeById({ holdAndWin: block }, HOLD_AND_WIN_MODE) ?? { id: HOLD_AND_WIN_MODE },
	);
	const strips = preset.paddingReels[gameType] ?? [];
	const symbols: Record<string, GameConfigSymbol> = {};
	for (const name of symbolsInPlayFromStrips({ [gameType]: strips })) {
		const entry = preset.symbols[name] ?? {};
		const roles = (entry.special_properties ?? []).filter((r) => r !== 'meterSpecial');
		const { special_properties: _roles, ...pays } = entry;
		symbols[name] = roles.length ? { ...pays, special_properties: roles } : pays;
	}
	return structuredClone({ holdAndWin: block, symbols, paddingReels: { [gameType]: strips } });
}

const tokenSymbol = (): GameConfigSymbol => ({ special_properties: ['meterSpecial'] });

const tokenFor = (pot: string): string => `POT_${pot.toUpperCase()}`;

// ─── 3 Pots ───────────────────────────────────────────────────────────────────────────────────

/** The 3 Pots of Egypt pots as overlays: the Hold and Win preset's meters, filled by tokens. */
const POTS_BLOCK = HOLD_AND_WIN_PRESETS.pots.holdAndWin;

const THREE_POTS_POTS: OverlayPot[] = (POTS_BLOCK?.meters ?? []).map((m) => ({
	id: m.id,
	token: tokenFor(m.id),
	maxLevel: m.maxLevel,
	sizeStages: [...m.sizeStages],
	bonus: { mode: HOLD_AND_WIN_MODE, activates: m.activates },
}));

const THREE_POTS: PotsOverlayPreset = {
	potsOverlay: {
		pots: THREE_POTS_POTS,
		drops: {
			chance: 0.15,
			// As many as the coin trigger counts, so a spin can drop enough value coins to start it.
			maxPerSpin: POTS_BLOCK?.trigger.count?.min ?? 1,
			table: [...THREE_POTS_POTS.map((p) => ({ pot: p.id, weight: 2 })), { coin: true, weight: 3 }],
		},
	},
	tokens: Object.fromEntries(THREE_POTS_POTS.map((p) => [p.token, tokenSymbol()])),
	holdAndWin: 'pots',
};

// ─── Pots to free spins ───────────────────────────────────────────────────────────────────────

const POTS_TO_FREE_SPINS: PotsOverlayPreset = {
	potsOverlay: {
		pots: [
			{
				id: 'gold',
				token: tokenFor('gold'),
				maxLevel: 12,
				sizeStages: [5, 9],
				bonus: { mode: 'freeSpins', spins: 10 },
			},
		],
		drops: { chance: 0.15, maxPerSpin: 2, table: [{ pot: 'gold', weight: 1 }] },
	},
	tokens: { [tokenFor('gold')]: tokenSymbol() },
};

export const POTS_OVERLAY_PRESETS: Record<PotsOverlayPresetId, PotsOverlayPreset> = {
	threePots: THREE_POTS,
	potsToFreeSpins: POTS_TO_FREE_SPINS,
};
