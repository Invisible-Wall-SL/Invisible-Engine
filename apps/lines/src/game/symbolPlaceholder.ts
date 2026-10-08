import {
	OVERLAY_POT_IDS,
	resolveMeters,
	respinModeBlocks,
	symbolHoldAndWinRoles,
	type GameConfigDoc,
	type HoldAndWinSymbolRole,
} from 'game-config';

/**
 * WHAT AN ADD-ON SYMBOL DRAWS BEFORE IT HAS ART. Adding the pots overlay or a Hold and Win bonus in
 * `/config` puts new symbols in the dictionary (each pot's token, the respin board's coins and
 * specials) and none of them has art bound in `/symbols` yet. A symbol with no art draws nothing
 * (`symbolInfo.ts`), so the overlay played invisibly: tokens landed and flew as empty cells and the
 * respin board showed bare value labels. These pieces get a coded disc instead until art is bound.
 * Every other symbol with no art still draws nothing.
 */

export type SymbolPlaceholder = { fill: number; text: string };

/** One colour per {@link OVERLAY_POT_IDS} id, in its order. */
const OVERLAY_POT_COLOURS = [0xe0452f, 0x2f7be0, 0x3fbf5a, 0xe0b030, 0x9a4fe0];
const POT_PALETTE = [0xe0b030, 0x30b0e0, 0xb060e0, 0x60c070];

/**
 * A pot's colour, shared by the coded pot and its token: its id's own (a clash-renamed `red_2` is
 * still red), else by its position.
 */
export const potColour = (id: string, index: number): number => {
	const named = OVERLAY_POT_IDS.findIndex((potId) => potId === id.replace(/_\d+$/, ''));
	return named === -1 ? POT_PALETTE[index % POT_PALETTE.length] : OVERLAY_POT_COLOURS[named];
};

/** A coin's or a jackpot's value is its label (`CoinLabel`), drawn over the disc, so no text. */
const ROLE_LOOKS: Partial<Record<HoldAndWinSymbolRole, SymbolPlaceholder>> = {
	coin: { fill: 0xe0b030, text: '' },
	jackpot: { fill: 0xd0702a, text: '' },
	collector: { fill: 0x2fa8a0, text: 'COLLECT' },
	payer: { fill: 0xc04a8a, text: 'PAY' },
	coinMultiplier: { fill: 0x7a5ad0, text: 'MULTI' },
	mystery: { fill: 0x5a5a72, text: '?' },
	addRespins: { fill: 0x3f9f5a, text: '+1' },
	upgrade: { fill: 0xd04040, text: 'UP' },
	unlock: { fill: 0x8a8a96, text: 'UNLOCK' },
};

const resolved = new WeakMap<GameConfigDoc, Map<string, SymbolPlaceholder | null>>();

function resolvePlaceholder(config: GameConfigDoc, name: string): SymbolPlaceholder | null {
	const meters = resolveMeters(config);
	const pot = meters.findIndex((meter) => meter.source === 'overlay' && meter.symbol === name);
	if (pot !== -1) {
		const { id, label } = meters[pot];
		return { fill: potColour(id, pot), text: (label ?? id).toUpperCase() };
	}
	if (respinModeBlocks(config).length === 0) return null;
	const roles = symbolHoldAndWinRoles(config.symbols[name]);
	if (roles.includes('blank')) return null;
	for (const role of roles) {
		const look = ROLE_LOOKS[role];
		if (look) return look;
	}
	return null;
}

/**
 * The disc `name` draws while it has no art, or `undefined` for a symbol that is not a pot token or
 * a Hold and Win coin or special of a config with a Hold and Win block (and for a `blank`, which
 * draws nothing by design). Resolved once per config and symbol, since every cell asks on every
 * state change.
 */
export function symbolPlaceholder(
	config: GameConfigDoc,
	name: string,
): SymbolPlaceholder | undefined {
	let byName = resolved.get(config);
	if (!byName) {
		byName = new Map();
		resolved.set(config, byName);
	}
	if (!byName.has(name)) byName.set(name, resolvePlaceholder(config, name));
	return byName.get(name) ?? undefined;
}
