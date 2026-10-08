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
import { joinHoldAndWin } from './holdAndWinGame';
import { symbolsInPlay, symbolsInPlayForGameType } from './inPlay';
import { triggerHalfFor } from './coinOverlay';
import { bonusSplitOf, legacyHoldAndWin, primaryRespinMode, respinModeBlank } from './bonusGames';
import { gameTypeForMode, HOLD_AND_WIN_MODE } from './modes';
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
	/**
	 * One entry per respin mode, the primary (the one `block` is) first — absent while the project's
	 * only respin mode is the default `holdAndWin` on the `respin` strip, so every such game's inputs,
	 * and what the mock answers it, are what they were (design `bonus-games.md` §2.2).
	 */
	modes?: HoldAndWinModeInputs[];
};

/** One respin mode as the mock deals it: its own rules joined with the routes that start it. */
export type HoldAndWinModeInputs = {
	mode: string;
	/** Its strip key, which is also the bonus key its feature is played under on the wire. */
	gameType: string;
	block: HoldAndWin;
	/** The symbol an empty cell of its board draws (`respinModeBlank`). */
	blank: string;
	/** The line symbols and the role symbols it deals: those on its own strip (the primary's also
	 *  on the base game's), so two modes' coins never mix; all of them when its strip has none. */
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
	const symbolsWhere = (roleSymbol: (name: string) => boolean) => {
		const symbols: Record<string, HoldAndWinMockSymbol> = {};
		for (const name of dictionary) {
			const symbol = doc.symbols[name];
			const roles = symbolHoldAndWinRoles(symbol);
			if (roles.length ? !kept(name, roles) || !roleSymbol(name) : !lineSymbols.includes(name))
				continue;
			const paytable = roles.length ? undefined : occursMap(symbol.paytable);
			symbols[name] = {
				roles,
				...(symbol.special_properties?.includes('wild') ? { wild: true as const } : {}),
				...(paytable ? { paytable } : {}),
			};
		}
		return symbols;
	};
	const symbols = symbolsWhere(() => true);
	const modes = respinModeInputs(doc, block, (dealtBy) => {
		const own = symbolsWhere((name) => dealtBy.has(name));
		return Object.keys(own).length > lineSymbols.length ? own : symbols;
	});
	return { block, lineSymbols, symbols, ...(modes ? { modes } : {}) };
}

/** {@link HoldAndWinMockInputs.modes}, or undefined for the lone default mode. */
function respinModeInputs(
	doc: GameConfigDoc,
	primaryBlock: HoldAndWin,
	symbolsFor: (dealtBy: Set<string>) => Record<string, HoldAndWinMockSymbol>,
): HoldAndWinModeInputs[] | undefined {
	const split = bonusSplitOf(doc);
	const primary = primaryRespinMode(split.modes);
	if (!primary) return undefined;
	const games = [
		primary,
		...(split.modes ?? []).filter(
			(m) => m !== primary && m.board === 'respinBoard' && m.holdAndWin,
		),
	];
	if (
		games.length === 1 &&
		primary.id === HOLD_AND_WIN_MODE &&
		gameTypeForMode(primary) === 'respin'
	) {
		return undefined;
	}
	return games.map((mode) => {
		const gameType = gameTypeForMode(mode);
		const strips = [gameType, ...(mode === primary ? ['basegame'] : [])];
		return {
			mode: mode.id,
			gameType,
			block:
				mode === primary
					? primaryBlock
					: joinHoldAndWin(mode.holdAndWin!, triggerHalfFor(split.coinOverlay, mode.id)),
			blank: respinModeBlank(doc, mode),
			symbols: symbolsFor(new Set(strips.flatMap((t) => symbolsInPlayForGameType(doc, t)))),
		};
	});
}
