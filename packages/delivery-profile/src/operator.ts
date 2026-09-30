/**
 * What the OPERATOR declared about this launch, typed — every `GameSettings.config` field the
 * engine honours beyond the bet ladder and the four jurisdiction flags the RGS facade maps itself.
 *
 * The rule the whole model follows (owner decision, 2026-09-30): any game may be published under
 * ANY jurisdiction, so the game holds no per-market logic. A behaviour is on only because the
 * operator's page says so; a field that is absent, or present with a value we cannot read, yields
 * the NEUTRAL default — the behaviour off, the surface not shown — and never a guess about a market.
 * {@link NEUTRAL_OPERATOR_SETTINGS} is that default, and reading no page at all returns it.
 *
 * Pure and dependency-free, so a fixture drives it with a literal config: `operator.fixture.ts`.
 * The field-by-field contract is the host-settings table in `docs/reference/play4fun-protocol.md`.
 */

import { readHostGameSettings } from './host.ts';

export interface OperatorSettings {
	/** Lowest total BASE stake the ladder may offer, in credits (`betOptions[0] × M`). */
	minNormalBet: number | null;
	/** Highest total BASE stake the ladder may offer, in credits. */
	maxNormalBet: number | null;
	/** Show the bet range (lowest – highest stake) on the info page. */
	showBetRanges: boolean;
	/** Money per credit (`0.01` ⇒ 1 credit = 1 cent). Null ⇒ the protocol's 0.01. */
	denom: number | null;
	/** Show what one credit is worth on the info page. */
	showCreditValue: boolean;

	/** Autoplay forbidden — the partner client's own name for `allowAutoplay: false`. */
	autoplayDisabled: boolean;
	/** The round counts the autoplay menu offers; `Infinity` is "until stopped" (`-1` on the wire). */
	autoplaySpins: number[] | null;
	/** Loss-limit options, as multiples of the total stake; `Infinity` is "no limit". */
	lossLimits: number[] | null;
	/** Single-win-limit options, as multiples of the total stake; `Infinity` is "no limit". */
	singleWinLimits: number[] | null;
	/** No spin may show its result sooner than this many ms after it started. 0 ⇒ no minimum. */
	minSpinDuration: number;
	/** Ask the player to confirm before every paid round starts. */
	confirmGameRoundStart: boolean;

	/** Show the BUY-feature modes' RTP on the info page. */
	showBuyBonusPayback: boolean;
	/** Show the ante ("high chance") modes' RTP on the info page. */
	showHighChancePayback: boolean;

	/** The currency glyph to print instead of the one the currency code implies. */
	currencySymbol: string | null;
	/** A numeral-style money pattern — `{0}` places the symbol, `#,#` groups, `.00` fixes decimals. */
	currencyFormat: string | null;
	/** The UI language, as the operator spells it (`en`, `pt_BR`, `es-ES`). */
	locale: string | null;

	/** Where the HOME button goes — the lobby. Null ⇒ no home button. */
	home: string | null;
	/** Show the wall clock. `showTime` (the partner client's `isShowTime`) says the same. */
	clock: boolean;
	/** Show how long this session has been playing. */
	elapsedTime: boolean;
	/** Where round history lives. Null ⇒ no history button. */
	externalHistoryUrl: string | null;
}

export const NEUTRAL_OPERATOR_SETTINGS: OperatorSettings = Object.freeze({
	minNormalBet: null,
	maxNormalBet: null,
	showBetRanges: false,
	denom: null,
	showCreditValue: false,
	autoplayDisabled: false,
	autoplaySpins: null,
	lossLimits: null,
	singleWinLimits: null,
	minSpinDuration: 0,
	confirmGameRoundStart: false,
	showBuyBonusPayback: false,
	showHighChancePayback: false,
	currencySymbol: null,
	currencyFormat: null,
	locale: null,
	home: null,
	clock: false,
	elapsedTime: false,
	externalHistoryUrl: null,
});

const positive = (value: unknown): number | null =>
	typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

/** A minimum above a minute is a units mistake, not a pacing rule, and would park every spin. */
const MAX_MIN_SPIN_DURATION_MS = 60_000;

/** A menu longer than this is not a ladder anyone reads, and each rung is a tile on screen. */
const MAX_LADDER_LENGTH = 24;

/** The protocol's credit value when the operator declares no `denom`: 1 credit = 1 cent. */
export const DEFAULT_DENOM = 0.01;

/**
 * A `denom` the engine can price with: a whole number of millionths, at least one — the engine's
 * amounts are millionths, so anything finer would round every conversion (1e-7 to zero, 1.5e-6 by a
 * third). Anything else is no declaration, and money stays on {@link DEFAULT_DENOM}.
 */
export const validDenom = (value: unknown): number | null => {
	const denom = positive(value);
	if (denom === null) return null;
	const millionths = denom * 1_000_000;
	return Math.round(millionths) >= 1 && Math.abs(millionths - Math.round(millionths)) < 1e-6
		? denom
		: null;
};

/** True only when the operator STATED true. Anything else — absent, `"true"`, `1` — is silence. */
const stated = (value: unknown): boolean => value === true;

/**
 * An option ladder. `-1` is the partner's "unlimited" (their `autoplaySpins` ends in it), read as
 * `Infinity`. One unreadable entry refuses the whole list rather than offering part of what the
 * operator meant; duplicates collapse and the list is sorted, so the menu reads in order.
 */
const ladder = (value: unknown, { integers }: { integers: boolean }): number[] | null => {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LADDER_LENGTH) return null;
	const out = new Set<number>();
	for (const entry of value) {
		if (entry === -1) {
			out.add(Infinity);
			continue;
		}
		const n = positive(entry);
		if (n === null || (integers && !Number.isInteger(n))) return null;
		out.add(n);
	}
	return [...out].sort((a, b) => a - b);
};

const text = (value: unknown, max: number): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed && trimmed.length <= max ? trimmed : null;
};

/**
 * A link the game may send the player to: `http(s)` or a same-origin path. Everything else is
 * refused — a `javascript:` home button on an operator's page is an injection, whoever typed it.
 */
export const safeLink = (value: unknown): string | null => {
	const raw = text(value, 2048);
	if (!raw) return null;
	// eslint-disable-next-line no-control-regex
	if (/[\s\\]|[\u0000-\u001f\u007f]/.test(raw)) return null;
	if (raw.startsWith('/')) return raw.startsWith('//') ? null : raw;
	try {
		const url = new URL(raw);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
	} catch {
		return null;
	}
};

const localeTag = (value: unknown): string | null => {
	const raw = text(value, 35);
	return raw && /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/.test(raw) ? raw : null;
};

/** A money pattern must at least say where the digits go — `{0}` is the symbol, not a digit. */
const moneyPattern = (value: unknown): string | null => {
	const raw = text(value, 40);
	return raw && /[#0]/.test(raw.replaceAll('{0}', '')) ? raw : null;
};

/** Read one operator config. Absent or unreadable fields fall to {@link NEUTRAL_OPERATOR_SETTINGS}. */
export const readOperatorSettings = (
	config: Record<string, unknown> | null | undefined,
): OperatorSettings => {
	if (!config) return { ...NEUTRAL_OPERATOR_SETTINGS };
	const minSpin = positive(config.minSpinDuration);
	return {
		minNormalBet: positive(config.minNormalBet),
		maxNormalBet: positive(config.maxNormalBet),
		showBetRanges: stated(config.showBetRanges),
		denom: validDenom(config.denom),
		showCreditValue: stated(config.showCreditValue),
		autoplayDisabled: stated(config.autoplayDisabled),
		autoplaySpins: ladder(config.autoplaySpins, { integers: true }),
		lossLimits: ladder(config.lossLimits, { integers: false }),
		singleWinLimits: ladder(config.singleWinLimits, { integers: false }),
		minSpinDuration: minSpin === null ? 0 : Math.min(minSpin, MAX_MIN_SPIN_DURATION_MS),
		confirmGameRoundStart: stated(config.confirmGameRoundStart),
		showBuyBonusPayback: stated(config.showBuyBonusPayback),
		showHighChancePayback: stated(config.showHighChancePayback),
		currencySymbol: text(config.currencySymbol, 8),
		currencyFormat: moneyPattern(config.currencyFormat),
		locale: localeTag(config.locale),
		home: safeLink(config.home),
		clock: stated(config.clock) || stated(config.showTime),
		elapsedTime: stated(config.elapsedTime),
		externalHistoryUrl: safeLink(config.externalHistoryUrl),
	};
};

/** The operator settings of THIS page — neutral wherever no embed page declared any. */
export const readPageOperatorSettings = (): OperatorSettings =>
	readOperatorSettings(readHostGameSettings()?.config);
