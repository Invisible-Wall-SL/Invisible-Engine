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
 * A TEMPLATE (`"{count} {symbolName}"`) is stable, finite and harvestable, so it can be the key.
 * {@link formatWinText} therefore localizes the template FIRST and interpolates AFTER. The
 * interpolated values need no translation *here*: `{amount}` arrives already currency+locale
 * formatted (`bookEventAmountToCurrencyString` → `Intl` with the URL's currency), `{count}` is a
 * numeral, and `{symbolName}` was localized at its own source by `resolveSymbolName`. Never
 * interpolate, then localize.
 *
 * ## Symbols are NAMED, never counted-as-jargon
 *
 * The text says WHICH symbol paid ("4 Bananas"), not how many matched in the abstract ("4 of a
 * kind"). The name comes from the Invisible Symbols State Machine (`SymbolsDoc.names`, resolved by
 * `symbolNames.ts`) — so renaming `H1` to "Banana" in that tool changes every sentence the game
 * says about an `H1` win, with no template edit.
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
	/** Free-spin feature copy. Localize-then-interpolate, one coherent sentence per field. */
	freeSpins?: WinTextFreeSpins;
	updatedAt?: string;
};

/**
 * Free-spin feature templates. `retrigger` is the "+N extra free spins won mid-feature" celebration
 * sentence, interpolating `{count}` = the extra spins awarded (the `freeSpinRetrigger` book event's
 * `extraFs`). Authored as ONE sentence so it localizes correctly (localize the template, THEN drop
 * the number in — a per-value sentence can never be a translation key). Bound in a scene via the
 * `freeSpinsAddedText` composed-string source.
 */
export type WinTextFreeSpins = {
	/** "You won +{count} Extra Free Spins" — shown on the retrigger celebration screen. */
	retrigger?: string;
};

/**
 * The info-bar toast, as THREE templates rather than one.
 *
 * `showMessage` is deliberately generic ("any FlowDoc can invoke it; it is NOT winInfo-specific")
 * and assembles its text from whichever of `amount`/`kind`/`symbol` it was handed — so a call with
 * only an amount says "You win $1.00", not "You win $1.00 with {count} {symbolName}". A single
 * template can't express that without conditional syntax, and one field per branch is both simpler
 * and honest: each is a separate, independently translatable string.
 */
export type WinTextToast = {
	/** An amount, a count AND a named symbol — the full "you win X with N Y" sentence. */
	full?: string;
	/** An amount with no symbol to name. */
	amountOnly?: string;
	/** A count + symbol, no amount. */
	countOnly?: string;
	/**
	 * Render the paying symbol as its SPRITE instead of its written name — the `{symbolName}` token
	 * becomes an inline image of the symbol, sized to the text ("You win $4.00 with 4 [🐄]"). Off by
	 * default ⇒ the name is written as text (parity). Applies only to the info-bar toast; the game
	 * still keeps the NAME as the clean fallback (for any non-sprite renderer, and if the symbol has
	 * no sprite art). See `inlineImage.ts` + `InlineImageText.svelte`.
	 */
	symbolAsImage?: boolean;
};

/** Fully-resolved win text — every field present, defaults applied. */
export type ResolvedWinText = {
	lineMessage: NonNullable<Required<WinTextDoc['lineMessage']>>;
	amountFormat: string;
	winLevels: Record<string, string>;
	toast: Required<WinTextToast>;
	freeSpins: Required<WinTextFreeSpins>;
};

/**
 * The coded defaults:
 * - `toast` ⇒ the SYMBOL-NAMED sentence. These used to be the "N of a kind" literals the engine
 *   hardcoded, which is jargon a player shouldn't have to decode and — worse — the only thing the
 *   text could say, because a raw symbol id (`H1`) is unspeakable. With
 *   `resolveSymbolName` (symbolNames.ts) there is a real word for the symbol, so the default now names it:
 *   "You win $4.00 with 4 Bananas". A project that never names its symbols still reads sensibly —
 *   the name falls back to the id ("…with 4 H1"), which is a prompt to go name it, not a crash.
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
		full: 'You win {amount} with {count} {symbolName}',
		amountOnly: 'You win {amount}',
		countOnly: '{count} {symbolName}',
		symbolAsImage: false,
	},
	freeSpins: {
		retrigger: 'You won +{count} Extra Free Spins',
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
			symbolAsImage: doc?.toast?.symbolAsImage ?? WIN_TEXT_DEFAULTS.toast.symbolAsImage,
		},
		freeSpins: {
			retrigger: doc?.freeSpins?.retrigger ?? WIN_TEXT_DEFAULTS.freeSpins.retrigger,
		},
	};
}

/**
 * Pick the toast template for the vars actually supplied.
 *
 * The count-bearing branches (`full`, `countOnly`) now also require a SYMBOL, because a count on
 * its own can only be spoken as "N of a kind" — the jargon this contract exists to remove. So a
 * call that knows the amount but not which symbol paid (the generic `showMessage` any FlowDoc can
 * fire) falls to `amountOnly` rather than rendering "You win $4.00 with 4 {symbolName}". Nothing
 * at all ⇒ `undefined`, and the caller shows no toast.
 */
export function resolveToastTemplate(
	resolved: ResolvedWinText,
	vars: { amount?: string; count?: number; symbolName?: string },
): string | undefined {
	const hasAmount = vars.amount !== undefined;
	const named = vars.count !== undefined && vars.symbolName !== undefined;
	if (hasAmount && named) return resolved.toast.full;
	if (hasAmount) return resolved.toast.amountOnly;
	if (named) return resolved.toast.countOnly;
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
	/** How many symbols formed the paying combination. */
	count?: number;
	/** Already currency+locale formatted (`bookEventAmountToCurrencyString`). */
	amount?: string;
	/** The paying symbol id, e.g. `H1`. Raw — usually you want `{symbolName}`. */
	symbol?: string;
	/** The paying symbol's authored DISPLAY NAME, already inflected for `count` and localized
	 *  (`resolveSymbolName` (symbolNames.ts)). Falls back to the id for an unnamed symbol, so a template
	 *  using it never renders a bare token. */
	symbolName?: string;
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
 * resolver looks up by the raw literal, so a trimmed key would never match).
 *
 * The `lineMessage`/`amountFormat`/`winLevels` fields are read from the sparse doc: only what the
 * author actually wrote is harvested (their defaults are either empty or a bare `{amount}` token
 * that needs no translation). The three info-bar TOASTS are different — their coded defaults are
 * real, player-facing sentences ("You win {amount} with {count} {symbolName}"), so they resolve
 * through {@link resolveWinText} and are harvested even when the author never retyped them.
 * Otherwise the built-in win message could never be translated.
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
		add(tpl, `Win line — ${count} matching`);
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
	const resolved = resolveWinText(doc);
	add(resolved.toast.full, 'Info-bar message — amount + symbol');
	add(resolved.toast.amountOnly, 'Info-bar message — amount only');
	add(resolved.toast.countOnly, 'Info-bar message — symbol only');
	// The retrigger sentence has a real coded default (a player-facing sentence), so — like the
	// toasts — it is harvested from the RESOLVED doc so it can be translated even if never retyped.
	add(resolved.freeSpins.retrigger, 'Free spins — retrigger (+N extra)');
	return out;
}
