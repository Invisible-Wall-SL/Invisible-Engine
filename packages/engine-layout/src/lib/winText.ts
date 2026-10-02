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
	/** Hold and Win: the jackpot tiers' captions and the jackpot banners. */
	jackpots?: WinTextJackpots;
	/** Hold and Win: the respin counter and its moments. */
	respins?: WinTextRespins;
	/** Hold and Win: the feature's own lines (total, intro/outro, instant collect, Lucky Spin, pots). */
	feature?: WinTextFeature;
	/** Hold and Win: the pre-feature wheel's segment labels and prize banners. */
	wheel?: WinTextWheel;
	/** The operator's platform jackpot — any game kind. */
	platformJackpot?: WinTextPlatformJackpot;
	updatedAt?: string;
};

/**
 * The OPERATOR PLATFORM JACKPOT's copy — any game kind can carry one (design `hold-and-win.md` §7
 * 11c). Its tiers are the PLATFORM's (`Mini`, `Grand`, … as the server names them), not the game's,
 * so `captions` is keyed by that name and an unset tier speaks it in capitals
 * ({@link platformJackpotCaption}).
 */
export type WinTextPlatformJackpot = {
	/** Tier name (as the server names it) → the word the player sees. */
	captions?: Record<string, string>;
	/** The celebration banner's title — "{jackpot} JACKPOT". */
	award?: string;
	/** Under it, what the platform paid — "{amount}". */
	awardDetail?: string;
};

/**
 * Hold and Win jackpot copy. The TIERS are not a list this contract owns: they are the project's
 * Game Config `holdAndWin.jackpots[].name` (MINI, MINOR, … or whatever the author named them), so
 * `captions` is keyed by tier name and an unset tier speaks its own name ({@link jackpotCaption}).
 * `{jackpot}` in the banner templates is that caption, localized at its source like `{symbolName}`.
 */
export type WinTextJackpots = {
	/** Tier name → the word the player sees for it, e.g. `"GRAND"` → `"GRAND"`. */
	captions?: Record<string, string>;
	/** A banked jackpot's banner title — "{jackpot} JACKPOT". */
	award?: string;
	/** Under it, the amount — "{amount}". */
	awardDetail?: string;
	/** Under it when a FULL BOARD paid the jackpot — "FULL BOARD  {amount}". */
	fullBoardDetail?: string;
	/** The small banner over a jackpot COIN in the tally — "{jackpot}" (its amount sits under it). */
	coin?: string;
	/** An upgrade stepped a jackpot coin up a tier — "{jackpot} UPGRADE" (`{jackpot}` = the new
	 *  tier's caption). */
	upgrade?: string;
};

/** Hold and Win respin copy. `{count}` is a number of respins. */
export type WinTextRespins = {
	/** The counter over the respin board — "RESPINS {count}" (`{count}` = respins left). */
	counter?: string;
	/** The award when the feature starts — "{count} RESPINS". */
	award?: string;
	/** A new coin put the counter back to its start — "RESPINS RESET". */
	reset?: string;
	/** One respin left — "LAST RESPIN". */
	last?: string;
	/** An add-respins special added to the counter — "+{count} RESPINS" (`{count}` = respins
	 *  added). */
	added?: string;
};

/**
 * Hold and Win feature copy. `{modifiers}` is the special names ({@link WinTextFeature.specialNames})
 * joined with ", "; `{meter}` is the name of the special a full pot activates; `{pot}` is a pot's
 * name ({@link potCaption}); `{level}` is a collector level's name ({@link collectorLevelCaption}) or,
 * on a pot, its fill level.
 */
export type WinTextFeature = {
	/** The feature's total as it ends — "BONUS WIN {amount}". */
	total?: string;
	/** A line as the feature opens. Empty by default: nothing is drawn until it is authored. */
	intro?: string;
	/** A line as the feature closes. Empty by default, like `intro`. */
	outro?: string;
	/** The base game's instant collect banner — "INSTANT WIN". */
	instantCollect?: string;
	/** The guaranteed-trigger spin's banner — "LUCKY SPIN". */
	luckySpin?: string;
	/** A pot filled — "{meter} ACTIVATED". */
	meterFull?: string;
	/** The modifiers a feature enters with (bought by full pots) — "{modifiers} ACTIVE". */
	modifiersActive?: string;
	/** A mystery unlocked modifiers mid-feature — "UNLOCKED: {modifiers}". */
	modifiersUnlocked?: string;
	/** A collector the wheel raised, on the counter's modifier line — "{level} COLLECTOR". */
	collectorLevel?: string;
	/** A pot's label — "{pot} {level}/{max}". */
	potLabel?: string;
	/** An upgrade special raising coins — "UPGRADE". */
	upgrade?: string;
	/** An expanding board opened a row — "ROW UNLOCKED". */
	rowUnlocked?: string;
	/** Under it, the rows now open — "{rows} ROWS". */
	rows?: string;
	/** Special kind (`collector`, `multiplier`, `payer`, `mystery`, `addRespins`, `upgrade`) → its
	 *  name in these lines. */
	specialNames?: Record<string, string>;
	/** Collector level (`"2"`) → its name (`"DOUBLE"`). An unnamed level reads `×n`. */
	collectorLevelNames?: Record<string, string>;
	/** Pot (Game Config meter id) → its name. An unnamed pot reads its id in capitals. */
	potNames?: Record<string, string>;
};

/**
 * Hold and Win wheel copy (the pre-feature wheel, Hotfire). A jackpot segment reads its tier's
 * caption ({@link jackpotCaption}); `{count}` is a boost multiplier or a number of extra collects. A
 * jackpot prize has no banner of its own (the `jackpotWin` after it is the celebration).
 */
export type WinTextWheel = {
	/** A coin-boost segment — "COIN BOOST ×{count}". */
	coinBoost?: string;
	/** An extra-collect segment — "+{count} COLLECT". */
	extraCollect?: string;
	/** Under a coin-boost prize's banner — "EVERY COIN ×{count}". */
	coinBoostDetail?: string;
	/** Under an extra-collect prize's banner — "{level} COLLECT" (the collector's new level). */
	extraCollectDetail?: string;
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
	 * An EXPANDED win — the Book-of special symbol filled whole reels before paying, so `{count}` is
	 * the number of REELS it covers, NOT the number of icons the player can see. `full` is then a
	 * sentence they can disprove by counting: the expansion painted twelve boots and the bar said
	 * "4 Boots". A separate branch rather than a per-symbol override of `full`, because the SAME
	 * symbol pays both ways inside one round (an ordinary line win before it expands, an expanded one
	 * after) — the distinction is the SPIN, not the symbol. Cleared ⇒ falls back to `full`.
	 */
	expanded?: string;
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
	jackpots: Required<WinTextJackpots>;
	respins: Required<WinTextRespins>;
	feature: Required<WinTextFeature>;
	wheel: Required<WinTextWheel>;
	platformJackpot: Required<WinTextPlatformJackpot>;
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
 * - `jackpots` / `respins` / `feature` / `wheel` (Hold and Win) ⇒ where the respin presentation
 *   already draws a line (the counter and its modifier line, the jackpot / instant / wheel banners,
 *   Lucky Spin, the modifier toasts, the pots, the special and collector-level names),
 *   exactly that literal, so an unauthored Hold and Win game reads the same once it reads these.
 *   `respins.award`/`reset`/`last`, `feature.total`/`meterFull` are NEW copy with
 *   no draw site yet: adopting one adds a line to the screen. `respins.added`, `feature.upgrade`
 *   and `jackpots.upgrade` (Phase 11a) belong to specials no existing game configures, so they draw
 *   only in a game that adds one; so do `feature.rowUnlocked` / `feature.rows` (11b), which only an
 *   expanding board draws.
 *   `jackpots.captions` is empty because an unset tier speaks its own config name. `feature.intro`
 *   and `feature.outro` are empty (no prior line, so nothing is drawn until authored).
 */
export const WIN_TEXT_DEFAULTS: ResolvedWinText = {
	lineMessage: { default: '', byCount: {}, bySymbol: {}, byCell: {} },
	amountFormat: '{amount}',
	winLevels: {},
	toast: {
		full: 'You win {amount} with {count} {symbolName}',
		// The one default that deliberately does NOT reproduce the pre-tool literal, and only on
		// expanded wins — where that literal was wrong (see `WinTextToast.expanded`). Reel-framed,
		// which is what expanding-symbol slots conventionally say: the count then matches the columns
		// the player sees lit rather than the icons filling them.
		expanded: 'You win {amount} with {symbolName} on {count} reels',
		amountOnly: 'You win {amount}',
		countOnly: '{count} {symbolName}',
		symbolAsImage: false,
	},
	freeSpins: {
		retrigger: 'You won +{count} Extra Free Spins',
	},
	jackpots: {
		captions: {},
		award: '{jackpot} JACKPOT',
		awardDetail: '{amount}',
		fullBoardDetail: 'FULL BOARD  {amount}',
		coin: '{jackpot}',
		upgrade: '{jackpot} UPGRADE',
	},
	respins: {
		counter: 'RESPINS {count}',
		award: '{count} RESPINS',
		reset: 'RESPINS RESET',
		last: 'LAST RESPIN',
		added: '+{count} RESPINS',
	},
	feature: {
		total: 'BONUS WIN {amount}',
		intro: '',
		outro: '',
		instantCollect: 'INSTANT WIN',
		luckySpin: 'LUCKY SPIN',
		meterFull: '{meter} ACTIVATED',
		modifiersActive: '{modifiers} ACTIVE',
		modifiersUnlocked: 'UNLOCKED: {modifiers}',
		collectorLevel: '{level} COLLECTOR',
		potLabel: '{pot} {level}/{max}',
		upgrade: 'UPGRADE',
		rowUnlocked: 'ROW UNLOCKED',
		rows: '{rows} ROWS',
		specialNames: {
			collector: 'COLLECTOR',
			multiplier: 'MULTIPLIER',
			payer: 'PAYER',
			mystery: 'MYSTERY',
			addRespins: 'ADD RESPINS',
			upgrade: 'UPGRADE',
		},
		collectorLevelNames: { '2': 'DOUBLE', '3': 'TRIPLE' },
		potNames: {},
	},
	wheel: {
		coinBoost: 'COIN BOOST ×{count}',
		extraCollect: '+{count} COLLECT',
		coinBoostDetail: 'EVERY COIN ×{count}',
		extraCollectDetail: '{level} COLLECT',
	},
	platformJackpot: {
		captions: {},
		award: '{jackpot} JACKPOT',
		awardDetail: '{amount}',
	},
};

/** The Hold and Win template fields that are plain strings — what the tool lists, the storage
 *  prunes and the harvest walks, in display order. One list, so a new field cannot reach one of
 *  them and miss another. */
export const WIN_TEXT_JACKPOT_FIELDS = [
	'award',
	'awardDetail',
	'fullBoardDetail',
	'coin',
	'upgrade',
] as const;
export const WIN_TEXT_RESPIN_FIELDS = ['counter', 'award', 'reset', 'last', 'added'] as const;
export const WIN_TEXT_FEATURE_FIELDS = [
	'total',
	'intro',
	'outro',
	'instantCollect',
	'luckySpin',
	'meterFull',
	'modifiersActive',
	'modifiersUnlocked',
	'collectorLevel',
	'potLabel',
	'upgrade',
	'rowUnlocked',
	'rows',
] as const;
/** The feature family's name maps — resolved, pruned and harvested alike. */
export const WIN_TEXT_FEATURE_MAPS = ['specialNames', 'collectorLevelNames', 'potNames'] as const;
export const WIN_TEXT_WHEEL_FIELDS = [
	'coinBoost',
	'extraCollect',
	'coinBoostDetail',
	'extraCollectDetail',
] as const;
export const WIN_TEXT_PLATFORM_JACKPOT_FIELDS = ['award', 'awardDetail'] as const;

export type WinTextJackpotField = (typeof WIN_TEXT_JACKPOT_FIELDS)[number];
export type WinTextRespinField = (typeof WIN_TEXT_RESPIN_FIELDS)[number];
export type WinTextFeatureField = (typeof WIN_TEXT_FEATURE_FIELDS)[number];
export type WinTextFeatureMap = (typeof WIN_TEXT_FEATURE_MAPS)[number];
export type WinTextWheelField = (typeof WIN_TEXT_WHEEL_FIELDS)[number];
export type WinTextPlatformJackpotField = (typeof WIN_TEXT_PLATFORM_JACKPOT_FIELDS)[number];

/** Each field's label — the tool's row and the Localization hint say the same thing. */
export const WIN_TEXT_JACKPOT_LABELS: Record<WinTextJackpotField, string> = {
	award: 'Jackpot banner',
	awardDetail: 'Jackpot banner — amount',
	fullBoardDetail: 'Jackpot banner — full board',
	coin: 'Jackpot coin',
	upgrade: 'Jackpot upgraded',
};
export const WIN_TEXT_RESPIN_LABELS: Record<WinTextRespinField, string> = {
	counter: 'Respin counter',
	award: 'Respins awarded',
	reset: 'Respins reset',
	last: 'Last respin',
	added: 'Respins added',
};
export const WIN_TEXT_FEATURE_LABELS: Record<WinTextFeatureField, string> = {
	total: 'Feature total',
	intro: 'Feature intro',
	outro: 'Feature outro',
	instantCollect: 'Instant collect',
	luckySpin: 'Lucky Spin',
	meterFull: 'Pot full',
	modifiersActive: 'Modifiers active',
	modifiersUnlocked: 'Modifiers unlocked',
	collectorLevel: 'Raised collector',
	potLabel: 'Pot label',
	upgrade: 'Upgrade',
	rowUnlocked: 'Row unlocked',
	rows: 'Rows open',
};
export const WIN_TEXT_FEATURE_MAP_LABELS: Record<WinTextFeatureMap, string> = {
	specialNames: 'Special',
	collectorLevelNames: 'Collector level',
	potNames: 'Pot',
};
export const WIN_TEXT_WHEEL_LABELS: Record<WinTextWheelField, string> = {
	coinBoost: 'Wheel — coin boost',
	extraCollect: 'Wheel — extra collect',
	coinBoostDetail: 'Wheel prize — coin boost',
	extraCollectDetail: 'Wheel prize — extra collect',
};
export const WIN_TEXT_PLATFORM_JACKPOT_LABELS: Record<WinTextPlatformJackpotField, string> = {
	award: 'Platform jackpot banner',
	awardDetail: 'Platform jackpot banner — amount',
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
			expanded: doc?.toast?.expanded ?? WIN_TEXT_DEFAULTS.toast.expanded,
			amountOnly: doc?.toast?.amountOnly ?? WIN_TEXT_DEFAULTS.toast.amountOnly,
			countOnly: doc?.toast?.countOnly ?? WIN_TEXT_DEFAULTS.toast.countOnly,
			symbolAsImage: doc?.toast?.symbolAsImage ?? WIN_TEXT_DEFAULTS.toast.symbolAsImage,
		},
		freeSpins: {
			retrigger: doc?.freeSpins?.retrigger ?? WIN_TEXT_DEFAULTS.freeSpins.retrigger,
		},
		jackpots: {
			captions: { ...WIN_TEXT_DEFAULTS.jackpots.captions, ...(doc?.jackpots?.captions ?? {}) },
			...pick(WIN_TEXT_JACKPOT_FIELDS, WIN_TEXT_DEFAULTS.jackpots, doc?.jackpots),
		},
		respins: pick(WIN_TEXT_RESPIN_FIELDS, WIN_TEXT_DEFAULTS.respins, doc?.respins),
		feature: {
			...pick(WIN_TEXT_FEATURE_FIELDS, WIN_TEXT_DEFAULTS.feature, doc?.feature),
			...pickMaps(WIN_TEXT_FEATURE_MAPS, WIN_TEXT_DEFAULTS.feature, doc?.feature),
		},
		wheel: pick(WIN_TEXT_WHEEL_FIELDS, WIN_TEXT_DEFAULTS.wheel, doc?.wheel),
		platformJackpot: {
			captions: {
				...WIN_TEXT_DEFAULTS.platformJackpot.captions,
				...(doc?.platformJackpot?.captions ?? {}),
			},
			...pick(
				WIN_TEXT_PLATFORM_JACKPOT_FIELDS,
				WIN_TEXT_DEFAULTS.platformJackpot,
				doc?.platformJackpot,
			),
		},
	};
}

/** Each of `maps`: the default entries with the authored ones over them. */
function pickMaps<M extends string>(
	maps: readonly M[],
	defaults: Record<M, Record<string, string>>,
	authored: Partial<Record<M, Record<string, string>>> | undefined,
): Record<M, Record<string, string>> {
	const out = {} as Record<M, Record<string, string>>;
	for (const map of maps) out[map] = { ...defaults[map], ...(authored?.[map] ?? {}) };
	return out;
}

/** Each of `fields` from the sparse `authored` family, else its default. */
function pick<F extends string>(
	fields: readonly F[],
	defaults: Record<F, string>,
	authored: Partial<Record<F, string>> | undefined,
): Record<F, string> {
	const out = {} as Record<F, string>;
	for (const field of fields) out[field] = authored?.[field] ?? defaults[field];
	return out;
}

/**
 * What the player reads for a jackpot tier: the authored caption, else the tier's own config name.
 * Localized here, at its source (the `resolveSymbolName` rule), because it is interpolated as
 * `{jackpot}` AFTER the banner template is localized and would otherwise never translate.
 */
export function jackpotCaption(resolved: ResolvedWinText, tier: string): string {
	return resolveLocalizedText(own(resolved.jackpots.captions, tier) || tier);
}

/**
 * What the player reads for a PLATFORM jackpot tier: the authored caption, else the server's tier
 * name in capitals. Localized at its source, like {@link jackpotCaption}.
 */
export function platformJackpotCaption(resolved: ResolvedWinText, tier: string): string {
	return resolveLocalizedText(own(resolved.platformJackpot.captions, tier) || tier.toUpperCase());
}

/** A special kind's name in the Hold and Win lines (localized at its source, like a caption); an
 *  unknown kind speaks its id in capitals. */
export function specialDisplayName(resolved: ResolvedWinText, kind: string): string {
	return resolveLocalizedText(own(resolved.feature.specialNames, kind) || kind.toUpperCase());
}

/** A collector level's name ("DOUBLE"), localized at its source; an unnamed level reads `×n`. */
export function collectorLevelCaption(resolved: ResolvedWinText, level: number): string {
	const name = own(resolved.feature.collectorLevelNames, String(level));
	return name ? resolveLocalizedText(name) : `×${level}`;
}

/** A pot's name, localized at its source; an unnamed pot reads its meter id in capitals. */
export function potCaption(resolved: ResolvedWinText, meterId: string): string {
	return resolveLocalizedText(own(resolved.feature.potNames, meterId) || meterId.toUpperCase());
}

/** A name map's own entry — an id like `constructor` must not read an inherited property. */
const own = (map: Record<string, string>, key: string): string | undefined =>
	Object.hasOwn(map, key) ? map[key] : undefined;

/**
 * Pick the toast template for the vars actually supplied.
 *
 * The count-bearing branches (`full`, `countOnly`) now also require a SYMBOL, because a count on
 * its own can only be spoken as "N of a kind" — the jargon this contract exists to remove. So a
 * call that knows the amount but not which symbol paid (the generic `showMessage` any FlowDoc can
 * fire) falls to `amountOnly` rather than rendering "You win $4.00 with 4 {symbolName}". Nothing
 * at all ⇒ `undefined`, and the caller shows no toast.
 *
 * `expanded` splits the named branch in two. It is not another SHAPE of payload but a fact about
 * the WIN: the Book-of special filled whole reels, so `count` means reels and the `full` sentence
 * miscounts what is on screen (see {@link WinTextToast.expanded}). An author who clears that
 * template falls back to `full` rather than to silence — a blank branch would drop the message.
 */
export function resolveToastTemplate(
	resolved: ResolvedWinText,
	vars: { amount?: string; count?: number; symbolName?: string; expanded?: boolean },
): string | undefined {
	const hasAmount = vars.amount !== undefined;
	const named = vars.count !== undefined && vars.symbolName !== undefined;
	if (hasAmount && named) {
		return vars.expanded ? resolved.toast.expanded || resolved.toast.full : resolved.toast.full;
	}
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
	/** A jackpot tier's caption ({@link jackpotCaption}), already localized. */
	jackpot?: string;
	/** The special a full pot activates, already localized ({@link specialDisplayName}). */
	meter?: string;
	/** Special names joined with ", ", each already localized. */
	modifiers?: string;
	/** A collector level's name ({@link collectorLevelCaption}) or a pot's fill level. */
	level?: string | number;
	/** A pot's maximum level. */
	max?: number;
	/** A pot's name ({@link potCaption}), already localized. */
	pot?: string;
	/** The rows an expanding respin board has open. */
	rows?: number;
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
 * The Hold and Win families (`jackpots`/`respins`/`feature`/`wheel`) follow the toasts' rule — their
 * defaults are player-facing — but only for a project whose kind has the feature
 * (`options.holdAndWin`, from `kindCapabilities`), so every other project's harvest stays exactly
 * what it was. What an author DID write in them is harvested regardless. `options.jackpots` is the
 * config's tier names: each tier's caption (authored, else the name itself) is a string the player
 * reads, so it is listed per tier; `options.meters` (the config's meter ids) does the same for pots.
 *
 * `label` is the human hint shown in the tool's Win-text section.
 */
export function collectWinTextTemplates(
	doc: WinTextDoc | undefined,
	options: { holdAndWin?: boolean; jackpots?: readonly string[]; meters?: readonly string[] } = {},
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
	add(resolved.toast.expanded, 'Info-bar message — expanded symbol win');
	add(resolved.toast.amountOnly, 'Info-bar message — amount only');
	add(resolved.toast.countOnly, 'Info-bar message — symbol only');
	// The retrigger sentence has a real coded default (a player-facing sentence), so — like the
	// toasts — it is harvested from the RESOLVED doc so it can be translated even if never retyped.
	add(resolved.freeSpins.retrigger, 'Free spins — retrigger (+N extra)');
	const holdAndWin = options.holdAndWin === true;
	const source = holdAndWin ? resolved : doc;
	// A template that is only tokens ("{amount}", "{jackpot}") has nothing to translate.
	const addWords = (template: string | undefined, label: string) => {
		if (template?.replace(TOKEN, '').trim()) add(template, label);
	};
	for (const tier of options.jackpots ?? []) {
		add(doc?.jackpots?.captions?.[tier] || (holdAndWin ? tier : undefined), `Jackpot — ${tier}`);
	}
	for (const [tier, caption] of Object.entries(doc?.jackpots?.captions ?? {})) {
		add(caption, `Jackpot — ${tier}`);
	}
	for (const field of WIN_TEXT_JACKPOT_FIELDS) {
		addWords(source?.jackpots?.[field], WIN_TEXT_JACKPOT_LABELS[field]);
	}
	for (const field of WIN_TEXT_RESPIN_FIELDS) {
		addWords(source?.respins?.[field], WIN_TEXT_RESPIN_LABELS[field]);
	}
	for (const field of WIN_TEXT_FEATURE_FIELDS) {
		addWords(source?.feature?.[field], WIN_TEXT_FEATURE_LABELS[field]);
	}
	for (const map of WIN_TEXT_FEATURE_MAPS) {
		for (const [key, name] of Object.entries(source?.feature?.[map] ?? {})) {
			add(name, `${WIN_TEXT_FEATURE_MAP_LABELS[map]} — ${key}`);
		}
	}
	for (const meter of options.meters ?? []) {
		add(
			doc?.feature?.potNames?.[meter] || (holdAndWin ? meter.toUpperCase() : undefined),
			`Pot — ${meter}`,
		);
	}
	for (const field of WIN_TEXT_WHEEL_FIELDS) {
		addWords(source?.wheel?.[field], WIN_TEXT_WHEEL_LABELS[field]);
	}
	// The platform jackpot belongs to no kind and no project knows whether its operator runs one, so
	// only what an author wrote is harvested — every project's list stays what it was until then.
	for (const field of WIN_TEXT_PLATFORM_JACKPOT_FIELDS) {
		addWords(doc?.platformJackpot?.[field], WIN_TEXT_PLATFORM_JACKPOT_LABELS[field]);
	}
	for (const [tier, caption] of Object.entries(doc?.platformJackpot?.captions ?? {})) {
		add(caption, `Platform jackpot — ${tier}`);
	}
	return out;
}
