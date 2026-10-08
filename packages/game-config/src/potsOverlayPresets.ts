/**
 * The POTS OVERLAY presets (`docs/design/pots-overlay.md` §3.1). Unlike a Hold and Win preset — a
 * whole config a new project starts from — an overlay preset is an ADD-ON: its parts are merged
 * into a project that already has its own game, and nothing the project has is replaced.
 *
 * Built on call, never at module load: a preset reads the Hold and Win presets, and a game that
 * imports `game-config` must not carry them in its bundle.
 *
 * The drop chances and weights are PLACEHOLDERS for the mock to generate from, as in every preset.
 */

import type { HoldAndWin, HoldAndWinSpecial } from './holdAndWin';
import {
	joinHoldAndWin,
	splitHoldAndWin,
	type BaseGameSpecialFlags,
	type BaseGameSpecials,
} from './holdAndWinGame';
import { HOLD_AND_WIN_PRESETS, type HoldAndWinPresetId } from './holdAndWinPresets';
import { symbolsInPlayFromStrips } from './inPlay';
import { legacyHoldAndWin } from './bonusGames';
import { HOLD_AND_WIN_MODE, gameModeById, gameTypeForMode } from './modes';
import type { OverlayPot, PotsOverlay } from './potsOverlay';
import type { GameConfigDoc, GameConfigSymbol, PaddingReels } from './types';

export const POTS_OVERLAY_PRESET_IDS = ['threePots', 'potsToFreeSpins', 'coinsOnly'] as const;

export type PotsOverlayPresetId = (typeof POTS_OVERLAY_PRESET_IDS)[number];

export const POTS_OVERLAY_PRESET_LABELS: Record<PotsOverlayPresetId, string> = {
	threePots: '3 Pots (each pot a Hold and Win with its special)',
	potsToFreeSpins: 'Pots to free spins',
	coinsOnly: 'Coins only (6+ value coins start a classic Hold and Win)',
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
	/** Its respin board's strips, one per host reel, under the Hold and Win mode's game type. */
	paddingReels: PaddingReels;
};

/**
 * A Hold and Win preset as an overlay host's BONUS: its block without the base-board-only options an
 * overlay host refuses (pattern, lucky spin, random metre, buy, instant collect, symbol-filled
 * meters), plus the symbols and strips its respin board deals. The preset's per-reel strips are
 * cycled or cut to the host's reel count, because the respin board is the host's grid.
 *
 * `meterSpecial` goes with the meters: the overlay's pots replace them, and a pot reusing a meter's
 * id would name two pots.
 */
export function holdAndWinBonus(
	id: HoldAndWinPresetId,
	host: Pick<GameConfigDoc, 'numReels'>,
): HoldAndWinBonus {
	const preset = HOLD_AND_WIN_PRESETS[id];
	if (!preset.holdAndWin) throw new Error(`Hold and Win preset "${id}" has no holdAndWin block.`);
	const { leftOut: _leftOut, ...bonus } = holdAndWinBonusFrom(preset, host);
	return bonus;
}

/** A Hold and Win block's source: a preset, or another project's config (a bonus import) — legacy,
 *  normalized or split form. */
export type HoldAndWinBonusSource = Pick<
	GameConfigDoc,
	'holdAndWin' | 'potsOverlay' | 'coinOverlay' | 'modes' | 'paddingReels' | 'symbols'
>;

/**
 * {@link holdAndWinBonus} from any config carrying a `holdAndWin` block — a preset, or the project a
 * bonus is imported from (`./imports`). The source's respin strips are read under ITS Hold and Win
 * game type (its mode override included) and returned under the default one, which is the game
 * type the host's Hold and Win mode pads from. `leftOut` names each base-board-only option the
 * source had and the bonus drops.
 */
export function holdAndWinBonusFrom(
	source: HoldAndWinBonusSource,
	host: Pick<GameConfigDoc, 'numReels'>,
): HoldAndWinBonus & { leftOut: string[] } {
	const sourceBlock = legacyHoldAndWin(source);
	if (!sourceBlock) throw new Error('The source has no holdAndWin block.');
	const { game, half } = splitHoldAndWin(sourceBlock);
	const { trigger, meters, baseGame } = half;
	const leftOut = [
		...(trigger.pattern ? ['the pattern trigger'] : []),
		...(trigger.luckySpin ? ['the lucky spin'] : []),
		...(trigger.randomMetre ? ['the random metre'] : []),
		...(trigger.buy?.length ? ['buying the feature'] : []),
		...(baseGame?.collector?.instantCollectInBaseGame ? ["the collector's instant collect"] : []),
		...(baseGame?.multiplier?.instantCollectInBaseGame ? ["the multiplier's instant collect"] : []),
		...(meters?.length ? ['the symbol-filled meters'] : []),
	];
	// The respin game whole; of its trigger half, the coin count and what lands in the base game.
	const lands: BaseGameSpecials = {};
	for (const [kind, flags] of Object.entries(baseGame ?? {}) as [
		HoldAndWinSpecial,
		BaseGameSpecialFlags,
	][]) {
		if (flags.landsInBaseGame) lands[kind] = { landsInBaseGame: true };
	}
	const block = joinHoldAndWin(game, {
		trigger: trigger.count ? { count: trigger.count } : {},
		baseGame: lands,
	});
	const from = gameTypeForMode(gameModeById(source, HOLD_AND_WIN_MODE)!);
	const gameType = gameTypeForMode(gameModeById({ holdAndWin: block }, HOLD_AND_WIN_MODE)!);
	const own = source.paddingReels[from] ?? [];
	const strips = own.length
		? Array.from({ length: host.numReels }, (_unused, reel) => own[reel % own.length])
		: [];
	const symbols: Record<string, GameConfigSymbol> = {};
	for (const name of symbolsInPlayFromStrips({ [gameType]: strips })) {
		const entry = source.symbols[name] ?? {};
		const roles = (entry.special_properties ?? []).filter((r) => r !== 'meterSpecial');
		const { special_properties: _roles, ...pays } = entry;
		symbols[name] = roles.length ? { ...pays, special_properties: roles } : pays;
	}
	return structuredClone({
		holdAndWin: block,
		symbols,
		paddingReels: { [gameType]: strips },
		leftOut,
	});
}

const tokenSymbol = (): GameConfigSymbol => ({ special_properties: ['meterSpecial'] });

const tokenFor = (pot: string): string => `POT_${pot.toUpperCase()}`;

/** The 3 Pots of Egypt pots as overlays: the Hold and Win preset's meters, filled by tokens. */
function threePots(): PotsOverlayPreset {
	const block = HOLD_AND_WIN_PRESETS.pots.holdAndWin;
	const pots: OverlayPot[] = (block?.meters ?? []).map((m) => ({
		id: m.id,
		token: tokenFor(m.id),
		maxLevel: m.maxLevel,
		sizeStages: [...m.sizeStages],
		bonus: { mode: HOLD_AND_WIN_MODE, activates: m.activates },
	}));
	return {
		potsOverlay: {
			pots,
			drops: {
				chance: 0.15,
				// As many as the coin trigger counts, so a spin can drop enough value coins to start it.
				maxPerSpin: block?.trigger.count?.min ?? 1,
				table: [...pots.map((p) => ({ pot: p.id, weight: 2 })), { coin: true, weight: 3 }],
			},
		},
		tokens: Object.fromEntries(pots.map((p) => [p.token, tokenSymbol()])),
		holdAndWin: 'pots',
	};
}

function potsToFreeSpins(): PotsOverlayPreset {
	return {
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
}

/**
 * No pots: value coins drop over the host's symbols, and as many as the Classic trigger counts on one
 * spin start its Hold and Win with those coins held; fewer are shown and gone. A dropping spin drops
 * 1 to 8 coins evenly, so with a 0.1 chance a spin starts the feature about once in 27.
 */
function coinsOnly(): PotsOverlayPreset {
	const preset: HoldAndWinPresetId = 'classic';
	const trigger = HOLD_AND_WIN_PRESETS[preset].holdAndWin?.trigger.count?.min ?? 1;
	return {
		potsOverlay: {
			pots: [],
			drops: { chance: 0.1, maxPerSpin: trigger + 2, table: [{ coin: true, weight: 1 }] },
		},
		tokens: {},
		holdAndWin: preset,
	};
}

const BUILD: Record<PotsOverlayPresetId, () => PotsOverlayPreset> = {
	threePots,
	potsToFreeSpins,
	coinsOnly,
};

/** A fresh copy of the preset `id`, safe to merge into a doc and edit. */
export const potsOverlayPreset = (id: PotsOverlayPresetId): PotsOverlayPreset => BUILD[id]();
