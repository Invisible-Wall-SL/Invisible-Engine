/**
 * What the mock RGS deals a Hold and Win game from (`scripts/mock-rgs-server-holdandwin.mjs`), in
 * the config's OWN symbol names — the Hold and Win wire speaks them
 * (`docs/reference/hold-and-win-wire.md`). One derivation, read by the launcher's mock contract and
 * by the protocol gate, so the gate proves the rounds the test server actually deals.
 */

import {
	isHoldAndWinSymbol,
	symbolHoldAndWinRoles,
	symbolsWithRole,
	type HoldAndWin,
} from './holdAndWin';
import { symbolsInPlay, symbolsInPlayForGameType } from './inPlay';
import { legacyHoldAndWin } from './bonusGames';
import type { GameConfigDoc } from './types';

export type HoldAndWinMockSymbol = {
	/** The symbol's Hold and Win roles; empty for a line symbol. */
	roles: string[];
	wild?: true;
	/** Line pays, occurs → multiplier of the bet per line. */
	paytable?: Record<string, number>;
};

export type HoldAndWinMockInputs = {
	block: HoldAndWin;
	/** The base game's line symbols (wild included): in play on the `basegame` strips and carrying
	 *  no Hold and Win role. */
	lineSymbols: string[];
	/** Every line symbol and every symbol with a Hold and Win role that a strip deals — one on no
	 *  strip is unused (`symbolUses`), so the mock never deals it. The one exception is a config the
	 *  validator now refuses: with no coin symbol on a strip, its coin and jackpot symbols are kept,
	 *  so a game saved before that rule deals its coins as it did rather than worth nothing. */
	symbols: Record<string, HoldAndWinMockSymbol>;
};

const occursMap = (rows: Array<Record<string, number>> | undefined) => {
	const out: Record<string, number> = {};
	for (const row of rows ?? []) {
		for (const [occurs, mult] of Object.entries(row)) {
			if (typeof mult === 'number' && Number.isFinite(mult) && mult > 0) out[occurs] = mult;
		}
	}
	return Object.keys(out).length ? out : undefined;
};

/** The mock's inputs for a doc, or `undefined` when it has no Hold and Win (`legacyHoldAndWin`). */
export function holdAndWinMockInputs(doc: GameConfigDoc): HoldAndWinMockInputs | undefined {
	const block = legacyHoldAndWin(doc);
	if (!block) return undefined;
	const inBase = new Set(symbolsInPlayForGameType(doc, 'basegame'));
	const inPlay = new Set(symbolsInPlay(doc));
	const coinDealt = symbolsWithRole(doc, 'coin').some((name) => inPlay.has(name));
	const kept = (name: string, roles: string[]) =>
		inPlay.has(name) || (!coinDealt && roles.some((role) => role === 'coin' || role === 'jackpot'));
	const dictionary = Object.keys(doc.symbols);
	const plain = dictionary.filter((name) => !isHoldAndWinSymbol(doc.symbols[name]));
	const dealt = plain.filter((name) => inBase.has(name));
	const lineSymbols = dealt.length ? dealt : plain;
	const symbols: Record<string, HoldAndWinMockSymbol> = {};
	for (const name of dictionary) {
		const symbol = doc.symbols[name];
		const roles = symbolHoldAndWinRoles(symbol);
		if (roles.length ? !kept(name, roles) : !lineSymbols.includes(name)) continue;
		const paytable = roles.length ? undefined : occursMap(symbol.paytable);
		symbols[name] = {
			roles,
			...(symbol.special_properties?.includes('wild') ? { wild: true as const } : {}),
			...(paytable ? { paytable } : {}),
		};
	}
	return { block, lineSymbols, symbols };
}
