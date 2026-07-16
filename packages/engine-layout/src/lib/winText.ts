/**
 * Invisible Win Text — the shared contract for every string the game says about a win.
 *
 * Lives here, on the bare (Svelte-free) `engine-layout` entry, because BOTH sides import it:
 * the game resolves + renders these templates, and the launcher's `/win-text` tool authors
 * them and shows their effective values. One home for the defaults and the resolution order,
 * so the tool can never disagree with what the game will draw.
 *
 * ## The order that makes this localizable: template, THEN interpolate
 *
 * Invisible Localization keys every translation by its SOURCE TEXT, and the engine resolver
 * ({@link resolveLocalizedText}) looks a string up by that exact literal. The code this
 * replaces composed `"Win $1.00 — 2 of a kind"` *after* formatting — a string unique per
 * amount, so it could never be harvested as a key nor match a catalog entry. Localization was
 * structurally out of reach.
 *
 * A TEMPLATE (`"{count} OF A KIND"`) is stable, finite and harvestable, so it can be the key.
 * {@link formatWinText} therefore localizes the template FIRST and interpolates AFTER. The
 * interpolated values need no translation: `{amount}` arrives already currency+locale
 * formatted (`bookEventAmountToCurrencyString` → `Intl` with the URL's currency), `{count}`
 * is a numeral. Never interpolate, then localize.
 *
 * See `docs/design/invisible-win-text.md`.
 */

import { resolveLocalizedText } from './registerTextResolver';

/**
 * The authored doc (`<client>/<project>/win-text/win-text.json`). SPARSE — every field is
 * optional and anything unset falls through to {@link WIN_TEXT_DEFAULTS}, which reproduce the
 * literals the engine hardcoded before this tool existed. So an un-baked or unauthored project
 * renders byte-identically (the `bakedWinLineConfig()` parity contract, applied to text).
 *
 * The Zod validator for this shape lives launcher-side (`lib/server/winTextStorage.ts`) — this
 * package stays dependency-free.
 */
export type WinTextDoc = {
	version?: 1;
	lineMessage?: {
		default?: string;
		/** Match count → template, e.g. `"2"` → `"PAIR!"`. */
		byCount?: Record<string, string>;
		/** Symbol id → template, e.g. `"S"` → `"SCATTER"`. */
		bySymbol?: Record<string, string>;
		/** `"<symbol>:<count>"` → template, e.g. `"H1:5"` → `"JACKPOT LINE!"`. */
		byCell?: Record<string, string>;
	};
	amountFormat?: string;
	/** `winLevelMap` alias (`big`, `mega`, …) → template. */
	winLevels?: Record<string, string>;
	toast?: WinTextToast;
	updatedAt?: string;
};

/**
 * The info-bar toast, as THREE templates rather than one.
 *
 * `showMessage` is deliberately generic ("any FlowDoc can invoke it; it is NOT winInfo-specific")
 * and assembles its text from whichever of `amount`/`kind` it was handed — so a call with only an
 * amount says "Win $1.00", not "Win $1.00 — {count} of a kind". A single template can't express
 * that without conditional syntax, and one field per branch is both simpler and honest: each is a
 * separate, independently translatable string. The branches map 1:1 onto the legacy `parts` logic.
 */
export type WinTextToast = {
	/** Both an amount and a count. */
	full?: string;
	/** An amount, no count. */
	amountOnly?: string;
	/** A count, no amount. */
	countOnly?: string;
};

/** Fully-resolved win text — every field present, defaults applied. */
export type ResolvedWinText = {
	lineMessage: NonNullable<Required<WinTextDoc['lineMessage']>>;
	amountFormat: string;
	winLevels: Record<string, string>;
	toast: Required<WinTextToast>;
};

/**
 * The coded defaults — chosen so an unauthored project is byte-identical to the engine before
 * this tool existed:
 * - `toast` ⇒ the three `flowEffects.showMessage` branches, verbatim.
 * - `amountFormat` ⇒ `'{amount}'`, the bare currency string `WinLine.svelte` stamped.
 * - `lineMessage.default` ⇒ EMPTY. The win line had no message layer at all, so there is no
 *   prior literal to reproduce; an empty template renders nothing. Author it to turn it on.
 * - `winLevels` ⇒ EMPTY, and deliberately so. `winLevelMap`'s `text` field (`'BIG WIN'`, …) is
 *   DEAD DATA — nothing reads it; the tier words players see are painted into the spine art
 *   (`big_win_intro` …), and `Win.svelte` draws only the count-up amount. Seeding these with
 *   the coded literals would make every existing game suddenly draw a tier caption OVER art
 *   that already says it. Empty ⇒ nothing drawn ⇒ parity; authoring one opts that game in.
 */
export const WIN_TEXT_DEFAULTS: ResolvedWinText = {
	lineMessage: { default: '', byCount: {}, bySymbol: {}, byCell: {} },
	amountFormat: '{amount}',
	winLevels: {},
	toast: {
		full: 'Win {amount} — {count} of a kind',
		amountOnly: 'Win {amount}',
		countOnly: '{count} of a kind',
	},
};

/** The key a `byCell` override is stored under. */
export const winTextCellKey = (symbol: string, count: number): string => `${symbol}:${count}`;

/**
 * Symbols that never draw a win line, so a win-line message authored for them could never
 * render. Scatter pays "anywhere" rather than along a payline — there is no line to trace and no
 * end to stamp text against — so the engine skips the whole overlay for it.
 *
 * Lives here because BOTH sides need the same answer: the engine gates the overlay on it
 * (`winLineEnabledForWin`), and the `/win-text` grid must not offer a cell that can't do
 * anything. It was hardcoded in the engine gate alone, so the tool had no way to know and
 * happily rendered a dead row.
 */
export const WIN_LINE_EXCLUDED_SYMBOLS: readonly string[] = ['S'];

/** Whether a win on `symbol` draws a win line at all — see {@link WIN_LINE_EXCLUDED_SYMBOLS}. */
export const symbolDrawsWinLine = (symbol: string): boolean =>
	!WIN_LINE_EXCLUDED_SYMBOLS.includes(symbol);

/** Apply the coded defaults over a sparse doc. Runtime → baked → undefined all funnel here. */
export function resolveWinText(doc: WinTextDoc | undefined): ResolvedWinText {
	return {
		lineMessage: {
			default: doc?.lineMessage?.default ?? WIN_TEXT_DEFAULTS.lineMessage.default,
			byCount: doc?.lineMessage?.byCount ?? {},
			bySymbol: doc?.lineMessage?.bySymbol ?? {},
			byCell: doc?.lineMessage?.byCell ?? {},
		},
		amountFormat: doc?.amountFormat ?? WIN_TEXT_DEFAULTS.amountFormat,
		winLevels: { ...WIN_TEXT_DEFAULTS.winLevels, ...(doc?.winLevels ?? {}) },
		toast: {
			full: doc?.toast?.full ?? WIN_TEXT_DEFAULTS.toast.full,
			amountOnly: doc?.toast?.amountOnly ?? WIN_TEXT_DEFAULTS.toast.amountOnly,
			countOnly: doc?.toast?.countOnly ?? WIN_TEXT_DEFAULTS.toast.countOnly,
		},
	};
}

/**
 * Pick the toast template for the vars actually supplied, mirroring the legacy `showMessage`
 * branches exactly: both ⇒ `full`, amount only ⇒ `amountOnly`, count only ⇒ `countOnly`,
 * neither ⇒ `undefined` (the caller shows nothing, as the legacy empty-`parts` guard did).
 */
export function resolveToastTemplate(
	resolved: ResolvedWinText,
	vars: { amount?: string; count?: number },
): string | undefined {
	const hasAmount = vars.amount !== undefined;
	const hasCount = vars.count !== undefined;
	if (hasAmount && hasCount) return resolved.toast.full;
	if (hasAmount) return resolved.toast.amountOnly;
	if (hasCount) return resolved.toast.countOnly;
	return undefined;
}

/** Which level of the fallback chain produced a resolved message — drives the tool's
 *  "effective value" badge, so an author can see whether a cell is its own override or
 *  inherited. */
export type WinTextSource = 'cell' | 'symbol' | 'count' | 'default';

/**
 * The win-line message template for a `(symbol, count)` win, resolved MOST-SPECIFIC FIRST:
 *
 * ```
 * byCell["H1:5"] → bySymbol["H1"] → byCount["5"] → default
 * ```
 *
 * Symbol deliberately beats count: `S → "SCATTER"` must win over `2 → "PAIR!"`, because a
 * scatter pays "anywhere" and is not a count-shaped statement. Returns the template (still
 * un-localized, still holding `{tokens}`) plus which level produced it.
 */
export function resolveWinLineMessage(
	resolved: ResolvedWinText,
	symbol: string,
	count: number,
): { template: string; source: WinTextSource } {
	const cell = resolved.lineMessage.byCell[winTextCellKey(symbol, count)];
	if (cell !== undefined) return { template: cell, source: 'cell' };
	const bySymbol = resolved.lineMessage.bySymbol[symbol];
	if (bySymbol !== undefined) return { template: bySymbol, source: 'symbol' };
	const byCount = resolved.lineMessage.byCount[String(count)];
	if (byCount !== undefined) return { template: byCount, source: 'count' };
	return { template: resolved.lineMessage.default, source: 'default' };
}

/** The values a win-text template can interpolate. A token with no value here renders
 *  verbatim (see {@link formatWinText}). */
export type WinTextVars = {
	/** The win's `kind` — the N of "N of a kind". */
	count?: number;
	/** Already currency+locale formatted (`bookEventAmountToCurrencyString`). */
	amount?: string;
	/** The paying symbol id, e.g. `H1`. */
	symbol?: string;
	/** The payline index (`meta.lineIndex`). */
	line?: number;
	/** The resolved win-line message — toast template only. */
	message?: string;
};

const TOKEN = /\{(\w+)\}/g;

/**
 * Localize `template`, then interpolate `{tokens}` from `vars` — in that order (see the module
 * header; the reverse cannot be localized).
 *
 * An UNKNOWN token — or one whose value is absent — renders verbatim rather than throwing or
 * emitting `undefined`. A typo in an authored template must degrade to visible text, never
 * black-screen a live game (cf. the missing-glyph black-screen class of bug).
 *
 * An empty template short-circuits to `''`, so an unauthored message renders nothing.
 */
export function formatWinText(template: string, vars: WinTextVars = {}): string {
	if (!template) return '';
	return resolveLocalizedText(template).replace(TOKEN, (match, token: string) => {
		const value = (vars as Record<string, unknown>)[token];
		return value === undefined || value === null ? match : String(value);
	});
}

/**
 * Every authored template in a doc, flattened for Invisible Localization's harvest. Emits the
 * EXACT untrimmed string as both key and source (matching `harvestSceneText`'s contract — the
 * resolver looks up by the raw literal, so a trimmed key would never match). Blank templates
 * and defaults are skipped: only what the author actually wrote is translatable.
 *
 * `label` is the human hint shown in the tool's Win-text section.
 */
export function collectWinTextTemplates(
	doc: WinTextDoc | undefined,
): { key: string; source: string; label: string }[] {
	const out: { key: string; source: string; label: string }[] = [];
	const seen = new Set<string>();
	const add = (source: string | undefined, label: string) => {
		if (!source || !source.trim() || seen.has(source)) return;
		seen.add(source);
		out.push({ key: source, source, label });
	};
	add(doc?.lineMessage?.default, 'Win line — default');
	for (const [count, tpl] of Object.entries(doc?.lineMessage?.byCount ?? {})) {
		add(tpl, `Win line — ${count} of a kind`);
	}
	for (const [symbol, tpl] of Object.entries(doc?.lineMessage?.bySymbol ?? {})) {
		add(tpl, `Win line — ${symbol}`);
	}
	for (const [cell, tpl] of Object.entries(doc?.lineMessage?.byCell ?? {})) {
		add(tpl, `Win line — ${cell}`);
	}
	add(doc?.amountFormat, 'Win amount format');
	for (const [alias, tpl] of Object.entries(doc?.winLevels ?? {})) {
		add(tpl, `Win level — ${alias}`);
	}
	add(doc?.toast?.full, 'Info-bar message — amount + count');
	add(doc?.toast?.amountOnly, 'Info-bar message — amount only');
	add(doc?.toast?.countOnly, 'Info-bar message — count only');
	return out;
}
