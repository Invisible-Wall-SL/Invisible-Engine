import { BUTTON_STATE_IMAGE_PARAMS } from './buttonStateImage';
import {
	kindCapabilities,
	type KindCapabilities,
	type KindCapabilityConfig,
} from './kindCapabilities';
import type { ComponentParam } from './types';

/**
 * Curated, code-owned catalog the editor's variable picker reads. It lists the
 * engine-provided values an author can bind a component {@link ComponentParam}
 * to, and the core signals the engine fires. This is the `declare` side of the
 * `declare ≠ implement` bridge (see `docs/design/invisible-editor.md` §8.5): the
 * editor offers these names; the game owns the runtime wiring. Pure data — no
 * runtime logic.
 */

/** An engine-provided value an author can bind a component param to. */
export interface EngineParamEntry {
	key: string;
	/** Constrained to a {@link ComponentParam} kind so a binding is type-checkable. */
	kind: ComponentParam['kind'];
	label: string;
	note?: string;
}

/** The kinds of part a scoped engine signal can name (`ComponentDef.signalScopeKind`). */
export const SIGNAL_SCOPE_KINDS = ['meter', 'tier', 'reel'] as const;
export type SignalScopeKind = (typeof SIGNAL_SCOPE_KINDS)[number];

/** A core signal name the engine fires at a component. */
export interface EngineSignalEntry {
	key: string;
	label: string;
	note?: string;
	/** The family the editor's picker files it under ("Pots", "Jackpots"). Absent ⇒ the core set. */
	group?: string;
	/**
	 * What its fires are SCOPED by (Phase 12a). A component instance scoped to a part of this kind
	 * (`ComponentDef.signalScope` + `signalScopeKind`) hears only its own part's. Absent ⇒ unscoped:
	 * every listener hears every fire.
	 */
	scope?: SignalScopeKind;
	/** The {@link KindCapabilities} flag a project must have for the editor to offer it — the pot
	 *  family is `'pots'`, the other Hold and Win families `'holdAndWin'`. Absent ⇒ offered to every
	 *  kind. */
	capability?: keyof KindCapabilities;
}

/** Engine-provided values an author can bind a component param to. */
export const ENGINE_PARAM_CATALOG: EngineParamEntry[] = [
	{ key: 'bet', kind: 'number', label: 'Bet', note: 'Current total stake.' },
	{ key: 'win', kind: 'number', label: 'Win', note: 'Win of the current round/spin.' },
	{ key: 'balance', kind: 'number', label: 'Balance', note: 'Player wallet balance.' },
	{ key: 'totalWin', kind: 'number', label: 'Total Win', note: 'Accumulated win for the round.' },
	{ key: 'playerName', kind: 'string', label: 'Player Name' },
	{ key: 'projectName', kind: 'string', label: 'Project Name' },
	{
		key: 'freeSpins',
		kind: 'string',
		label: 'Free Spins',
		note: 'Composed "current OF total" free-spin counter string.',
	},
	{
		key: 'freeSpinsWon',
		kind: 'number',
		label: 'Free Spins Won',
		note: 'Total free spins awarded — the intro headline count (available during the intro).',
	},
	{
		key: 'freeSpinsAdded',
		kind: 'number',
		label: 'Extra Free Spins',
		note: 'Extra free spins won on a mid-feature RETRIGGER — the bare count (e.g. 10; add your own "+" in a label). For the full localized "You won +10 Extra Free Spins" sentence bind `freeSpinsAddedText`.',
	},
	{
		key: 'freeSpinsAddedText',
		kind: 'string',
		label: 'Extra Free Spins (sentence)',
		note: 'The localized retrigger sentence (win-text `freeSpins.retrigger`, default "You won +{count} Extra Free Spins"), extra count interpolated. Author the copy in /win-text, translate in /localization.',
	},
	{
		key: 'freeSpinOutroTotalWin',
		kind: 'number',
		label: 'Free-spin Outro Total',
		note: 'The LIVE counting-up free-spin total the outro shows (the count-up tween value, not the static final total). Bind an outro count text to this.',
	},
	{
		key: 'winCountUpAmount',
		kind: 'number',
		label: 'Win Count-up',
		note: 'The LIVE counting-up win total the win overlay shows (the count-up tween value, not the static final amount). Bind your win container’s Text Box to this.',
	},
	{
		key: 'freeSpinsRemaining',
		kind: 'number',
		label: 'Free Spins Remaining',
		note: 'Free spins still to play — counts DOWN to 0. Bind this for a descending counter (the `freeSpins` string always ascends).',
	},
	{
		key: 'freeSpinsCurrent',
		kind: 'number',
		label: 'Free Spins Current',
		note: 'The free spin being played — counts UP from 1. The ascending half of `freeSpins`, on its own.',
	},
	{
		key: 'message',
		kind: 'string',
		label: 'Message',
		note: 'Transient win/info-bar text — the `showMessage` toast feed (e.g. "You win $1.00 with 2 Bananas").',
	},
	{
		key: 'loadingProgress',
		kind: 'number',
		label: 'Loading Progress',
		note: 'Asset-load progress 0–100 (the loading/intro splash). The source formatter renders it "73%".',
	},
	{
		key: 'specialSymbol',
		kind: 'string',
		label: 'Book Symbol',
		note: 'Name of the chosen book expanding symbol (empty until one is revealed).',
	},
	{
		key: 'autoSpins',
		kind: 'string',
		label: 'Auto Spins (picked)',
		note: 'The autoplay count currently picked — "10" … "1000", "∞". Bind a readout on an authored auto-spin screen to show the standing choice.',
	},
	{
		key: 'autoSpinsLossLimit',
		kind: 'string',
		label: 'Auto Spins Loss Limit',
		note: 'The picked loss limit as a bet multiplier — "5×" … "100×", "∞".',
	},
	{
		key: 'autoSpinsWinLimit',
		kind: 'string',
		label: 'Auto Spins Single-win Limit',
		note: 'The picked single-win limit as a bet multiplier — "5×" … "100×", "∞".',
	},
	{
		key: 'autoSpinsRemaining',
		kind: 'number',
		label: 'Auto Spins Remaining',
		note: 'Autoplay rounds still to play — 0 when autoplay is not running (`∞` reads as Infinity).',
	},
	{
		key: 'clock',
		kind: 'string',
		label: 'Clock (operator)',
		note: 'Wall-clock time, "HH:MM" in the player\'s locale (12h/24h as it writes it). Empty unless the operator\'s page turns the clock on (`clock`/`showTime`) — gate the box with `clockShow`. Binding it hides the built-in clock in the operator strip.',
	},
	{
		key: 'sessionTime',
		kind: 'string',
		label: 'Session Time (operator)',
		note: 'Time played since the game opened, "H:MM:SS" (digits only — label it yourself). Empty unless the operator\'s page declares `elapsedTime` — gate the box with `sessionTimeShow`. Binding it hides the built-in timer in the operator strip.',
	},
];

/**
 * The numeric engine value feeds a readout's `source` param can bind to — the
 * keys a game registers via `registerComponentValues` (balance/win/bet/totalWin).
 * Derived from {@link ENGINE_PARAM_CATALOG} (its number-kind entries) so the
 * editor's Source dropdown and the engine feed share ONE list. A game registers
 * the subset it supports; a source with no registered store simply feeds nothing
 * (the readout shows an empty/zero value), same as an unbound param.
 */
export const VALUE_SOURCE_CATALOG: EngineParamEntry[] = ENGINE_PARAM_CATALOG.filter(
	(p) => p.kind === 'number',
);

/**
 * The keys a `source` param dropdown offers — the numeric feeds
 * ({@link VALUE_SOURCE_CATALOG}) PLUS the composed-string feeds (e.g. `freeSpins`,
 * the "X OF Y" free-spin counter string). String sources render verbatim through
 * the text path (the `freeSpinCounter` def's `value` param is `kind:'string'`), so
 * they're kept OUT of the numeric-only {@link VALUE_SOURCE_CATALOG} but still listed
 * here so the editor's Source dropdown lists them.
 */
const COMPOSED_STRING_SOURCE_KEYS = [
	'freeSpins',
	'freeSpinsAddedText',
	'message',
	'specialSymbol',
	'autoSpins',
	'autoSpinsLossLimit',
	'autoSpinsWinLimit',
	'clock',
	'sessionTime',
];
export const VALUE_SOURCE_KEYS: string[] = [
	...VALUE_SOURCE_CATALOG.map((p) => p.key),
	...COMPOSED_STRING_SOURCE_KEYS,
];

/**
 * Every engine value feed a TEXT field can bind to — numbers (formatted, count-up
 * capable) AND strings (rendered verbatim). The `textBox` def's `source` options;
 * a game registers the subset it supports via `registerComponentValues`.
 */
export const TEXT_SOURCE_KEYS: string[] = ENGINE_PARAM_CATALOG.map((p) => p.key);

/**
 * The Hold and Win feeds (design `docs/design/hold-and-win.md` §5): what the kind-gated respin
 * counter, jackpot bar, total win bar and celebration screens bind. Kept OUT of
 * {@link ENGINE_PARAM_CATALOG} so the source dropdowns of every existing component stay exactly as
 * they were for every other kind; a Text Box keeps one of these as its value all the same (a custom
 * source is preserved as an option). A pot reads `meter.<id>.level` / `meter.<id>.max` itself, from
 * its `meter` param, because the ids are the project's own.
 */
export const HOLD_AND_WIN_PARAM_CATALOG: EngineParamEntry[] = [
	{
		key: 'respinsLeft',
		kind: 'number',
		label: 'Respins Left',
		note: 'Respins left on the counter — resets to the start count when a coin lands.',
	},
	{
		key: 'activeModifiers',
		kind: 'string',
		label: 'Active Modifiers',
		note: 'The specials active in this feature, "PAYER · MULTIPLIER" (entry + mystery unlocks).',
	},
	{
		key: 'featureTotal',
		kind: 'number',
		label: 'Feature Total',
		note: 'What the Total Win bar reads — counts up coin by coin as the feature ends.',
	},
	...['mini', 'minor', 'major', 'grand'].map((tier): EngineParamEntry => ({
		key: `jackpot.${tier}`,
		kind: 'number',
		label: `Jackpot ${tier.toUpperCase()}`,
		note: `The ${tier.toUpperCase()} jackpot's value at the current bet (multiplier × total bet).`,
	})),
	{
		key: 'holdAndWinBanner',
		kind: 'string',
		label: 'Feature Banner',
		note: 'The headline of the beat on screen — "LUCKY SPIN", "GRAND JACKPOT".',
	},
	{
		key: 'holdAndWinBannerDetail',
		kind: 'string',
		label: 'Feature Banner Detail',
		note: 'The line under it — the jackpot amount.',
	},
];

export const HOLD_AND_WIN_VALUE_SOURCE_KEYS: string[] = HOLD_AND_WIN_PARAM_CATALOG.map(
	(p) => p.key,
);

/**
 * The OPERATOR PLATFORM JACKPOT feeds — any kind (design `hold-and-win.md` §7 11c): each standard
 * tier's value in money, as the operator's platform reports it on every answer. Kept out of
 * {@link ENGINE_PARAM_CATALOG} like the Hold and Win feeds, so no existing dropdown changes; the
 * jackpot tiles and the Platform Jackpot Bar offer them.
 */
export const PLATFORM_JACKPOT_PARAM_CATALOG: EngineParamEntry[] = [
	'mini',
	'minor',
	'major',
	'grand',
].map((tier): EngineParamEntry => ({
	key: `platformJackpot.${tier}`,
	kind: 'number',
	label: `Platform Jackpot ${tier.toUpperCase()}`,
	note: `The operator platform jackpot's ${tier.toUpperCase()} value (money, refreshed by the server; 0 when it runs none).`,
}));

export const PLATFORM_JACKPOT_VALUE_SOURCE_KEYS: string[] = PLATFORM_JACKPOT_PARAM_CATALOG.map(
	(p) => p.key,
);

/**
 * A number a VALUE BINDING (Phase 12b, `ValueBinding.source`) can read — what the editor's "Bind to
 * value" source picker offers. A `{key}` placeholder reads the owning instance's param, so the pot
 * entries resolve per placed pot (`meter.{meter}.level` → `meter.red.level`); `needsParam` names it,
 * and the editor offers the entry only inside a component that has that param. `of` is the divisor
 * that makes the source 0..1 — what the editor's "normalise" tick fills in.
 */
export interface ValueBindingSourceEntry {
	key: string;
	label: string;
	group: string;
	note?: string;
	of?: string;
	needsParam?: string;
}

/**
 * The binding sources beyond the plain readout feeds ({@link VALUE_SOURCE_CATALOG}, which the editor
 * also offers): every per-pot number, and the Hold and Win counts a bar or a character can follow.
 * The game registers each with `registerComponentValues`; one it does not register leaves its
 * binding without a value, so the node keeps its authored look.
 */
export const VALUE_BINDING_SOURCE_CATALOG: ValueBindingSourceEntry[] = [
	{
		key: 'meter.{meter}.level',
		label: 'Pot level',
		group: 'Pot (this instance’s meter)',
		note: 'The level this pot shows — ticks up as a special lands.',
		of: 'meter.{meter}.max',
		needsParam: 'meter',
	},
	{
		key: 'meter.{meter}.max',
		label: 'Pot maximum',
		group: 'Pot (this instance’s meter)',
		needsParam: 'meter',
	},
	{
		key: 'meter.{meter}.stage',
		label: 'Pot size stage',
		group: 'Pot (this instance’s meter)',
		note: 'How many of the meter’s size stages the level has reached (0, 1, 2…) — gate art with "show when ≥ n".',
		needsParam: 'meter',
	},
	{
		key: 'meter.{meter}.full',
		label: 'Pot full',
		group: 'Pot (this instance’s meter)',
		note: '1 while the pot shows full, else 0.',
		needsParam: 'meter',
	},
	{
		key: 'letter.{reel}.lit',
		label: 'Letter lit',
		group: 'Letter (this tile’s column)',
		note: '1 while this column’s letter is lit, else 0.',
		needsParam: 'reel',
	},
	{
		key: 'respinsLeft',
		label: 'Respins left',
		group: 'Hold and Win',
		of: 'respinsStart',
	},
	{
		key: 'respinsStart',
		label: 'Respins cap',
		group: 'Hold and Win',
		note: 'What the counter resets to (an add-respins special can raise it).',
	},
	{
		key: 'cellsHeld',
		label: 'Cells held',
		group: 'Hold and Win',
		note: 'Coins and specials held on the respin board.',
		of: 'cellsTotal',
	},
	{ key: 'cellsTotal', label: 'Cells open', group: 'Hold and Win' },
	{
		key: 'rowsOpen',
		label: 'Rows open',
		group: 'Hold and Win',
		note: 'An expanding board only.',
		of: 'rowsMax',
	},
	{
		key: 'rowsMax',
		label: 'Rows at most',
		group: 'Hold and Win',
		note: 'An expanding board only.',
	},
	{ key: 'collectorLevel', label: 'Collector level', group: 'Hold and Win' },
	{ key: 'lettersLit', label: 'Letters lit', group: 'Hold and Win' },
	{ key: 'featureTotal', label: 'Feature total', group: 'Hold and Win' },
];

/** `platformJackpotShow` — true once the operator's platform reports a jackpot. */
export const PLATFORM_JACKPOT_VISIBILITY_SOURCE_KEYS: string[] = ['platformJackpotShow'];

/** The Hold and Win visibility feeds: `respinCounterShow` is true for the whole feature; the other two
 *  while the Lucky Spin intro / a banked jackpot's celebration is up. */
export const HOLD_AND_WIN_VISIBILITY_SOURCE_KEYS: string[] = [
	'respinCounterShow',
	'luckySpinShow',
	'jackpotWinShow',
];

/**
 * The boolean show/hide feeds a `visibleSource` param can bind to — the keys a game
 * registers via `registerComponentVisibility`. The editor renders the `visibleSource`
 * param as a dropdown of these (instead of a free-text box, where the exact source
 * name is undiscoverable and a typo silently leaves the instance ungated → always
 * visible). `freeSpinCounterShow` is true only during free spins (the free-spin
 * counter's natural gate); `messageShow` is true while a transient `showMessage`
 * toast is active (the info bar's natural gate, so the bar shows only when there's a
 * message); `assetsLoading` is true only while the boot asset-load is in flight (the
 * loading/intro splash's natural gate — progress content hides the moment loading
 * completes); `assetsLoaded` is its inverse, true the moment loading finishes (the
 * gate for splash content that should appear AFTER load — e.g. a logo that pops in
 * once the loading bar fills, before press-to-continue). A feed with no registered
 * store leaves the instance ungated, same as an unbound param. A custom key is
 * preserved as an option.
 */
export const VISIBILITY_SOURCE_KEYS: string[] = [
	'freeSpinCounterShow',
	'messageShow',
	'assetsLoading',
	'assetsLoaded',
	// Round-lifecycle gates — drive a whole SCREEN ({@link Scene.visibleSource}) or a
	// single component so authored overlay content follows the round flow (free-spin
	// intro/outro presentation, the free-game session, win/big-win celebration, the
	// resting base game). A game registers the subset it drives; unregistered = ungated.
	'freeSpinIntroShow',
	'freeSpinOutroShow',
	'freeGameShow',
	'winShow',
	'bigWinShow',
	'baseGameShow',
	// True while a book expanding symbol is chosen (the reveal is live) — the natural gate for
	// the `expandingSymbol` component so the landed art shows only during the book reveal.
	'specialBookShow',
	// Config-feature gates — mirror the coded `UIDefault` `{#if config.features.*}` wraps so a
	// parametric turbo / auto-spin button hides when the game config disables that feature
	// (e.g. a compliance profile). The auto-spin button binds `autoplayFeature`, turbo binds
	// `turboFeature`; a game registers them from `stateUi.config.features.autoplay/.turbo`.
	'turboFeature',
	'autoplayFeature',
	// True while the bet menu offers a buy or an ante — false once a jurisdiction that forbids
	// buying a feature has stripped them all. The buy-bonus button binds it.
	'buyFeature',
	// True when NO full-screen tap-to-continue overlay is up (`stateUi.continuePressCount === 0`).
	// Bind an authored ambient/background node (e.g. drifting smoke) to this so it hides while any
	// tap-to-continue celebration (free-spin intro/outro gate, retrigger) is on screen — otherwise
	// the drifting atmosphere reads as murk through the overlay's dim. The coded `Background` dust
	// fades on the same signal.
	'tapOverlayIdle',
	// Operator chrome — true only when the operator's embed page declared the surface (a clock, a
	// session timer, a lobby link, a history link). Gate an authored clock / timer / HOME / HISTORY
	// with these so it exists only where the operator asked for it; a bound one also hides the
	// matching item in the built-in operator strip.
	'clockShow',
	'sessionTimeShow',
	'homeShow',
	'historyShow',
];

/**
 * Human labels for {@link VISIBILITY_SOURCE_KEYS} — the editor's "Shows during"
 * dropdown (the screen lifecycle gate + the per-component `visibleSource` param)
 * renders these instead of the raw key. A key without an entry falls back to itself.
 */
export const VISIBILITY_SOURCE_LABELS: Record<string, string> = {
	freeSpinCounterShow: 'Free spins (counter active)',
	messageShow: 'A message/toast is showing',
	assetsLoading: 'Loading (boot)',
	assetsLoaded: 'Loaded (after boot)',
	freeSpinIntroShow: 'Free-spin intro',
	freeSpinOutroShow: 'Free-spin outro',
	freeGameShow: 'Free game (during free spins)',
	winShow: 'Win',
	bigWinShow: 'Big win',
	baseGameShow: 'Base game / idle',
	specialBookShow: 'Book reveal (symbol chosen)',
	turboFeature: 'Turbo feature enabled',
	autoplayFeature: 'Autoplay feature enabled',
	buyFeature: 'Buy feature available',
	tapOverlayIdle: 'No tap overlay — hidden while a tap-to-continue celebration is on screen',
	clockShow: 'Operator shows a clock',
	sessionTimeShow: 'Operator shows session time',
	homeShow: 'Operator has a HOME (lobby) link',
	historyShow: 'Operator has a HISTORY link',
};

/**
 * Canonical HUD button action keys the parametric Button's `action` param selects
 * from — the editor renders the `action` param as a dropdown of these instead of a
 * free-text box (no more silent typos). The GAME must register a matching handler
 * via `registerComponentActions` (declare ≠ implement); an action with no registered
 * handler simply does nothing, same as an unbound param. A custom action key typed
 * elsewhere is preserved (the editor keeps an out-of-catalog value as an option).
 */
export const ENGINE_ACTION_CATALOG: string[] = [
	'spin',
	'decrease',
	'increase',
	'autoSpin',
	'autoSpinStart',
	'betMenu',
	'close',
	'turbo',
	'menu',
	'menuClose',
	'payTable',
	'gameRules',
	'settings',
	'soundToggle',
	'buyBonus',
	'fullscreen',
	'home',
	'history',
];

/**
 * Friendly DISPLAY labels for the action keys — the editor's `action` dropdown
 * renders `ENGINE_ACTION_LABELS[key] ?? key`, so the STORED value stays the stable
 * catalog key (no data-contract break) while the UI reads clearly. Notably `menu`
 * shows as "submenu (popup)" because that action opens the settings/paytable popup,
 * NOT a top-level menu — the four buttons inside that popup (`payTable`/`gameRules`/
 * `settings`/`soundToggle`) are now first-class actions too, so an author can place
 * them directly instead of going through the popup. Keys without an entry fall back
 * to the raw key.
 */
export const ENGINE_ACTION_LABELS: Record<string, string> = {
	menu: 'submenu (popup)',
	menuClose: 'submenu close',
	payTable: 'paytable',
	gameRules: 'game rules',
	settings: 'settings',
	soundToggle: 'sound on/off',
	buyBonus: 'buy bonus',
	autoSpin: 'auto spin (open/stop)',
	autoSpinStart: 'auto spin — start',
	betMenu: 'bet menu (open)',
	close: 'close (dismiss screen)',
	fullscreen: 'fullscreen on/off',
	home: 'home (operator lobby)',
	history: 'history (operator page, new tab)',
};

/**
 * The live LISTS a `repeater` node's `source` param can bind to — the list sibling of
 * {@link ENGINE_ACTION_CATALOG}. The editor renders `source` as a dropdown of these instead of a
 * free-text box, where the exact source name is undiscoverable and a typo silently leaves the
 * repeater empty. Same declare-≠-implement discipline as the action catalog: the GAME registers the
 * matching arrays via `registerRepeaterSources`, and a source with nothing registered renders no
 * items. A custom key already stored in a doc is preserved as an option.
 */
export const REPEATER_SOURCE_CATALOG: string[] = [
	'featureCards',
	'betOptions',
	'autoSpinOptions',
	'autoSpinLossLimitOptions',
	'autoSpinWinLimitOptions',
];

/** Friendly DISPLAY labels for {@link REPEATER_SOURCE_CATALOG} — the stored value stays the stable
 *  source key. Keys without an entry fall back to the raw key. */
export const REPEATER_SOURCE_LABELS: Record<string, string> = {
	featureCards: 'buy-feature cards (one per bet mode)',
	betOptions: 'bet amounts (the bet menu ladder)',
	autoSpinOptions: 'auto spin counts (10 … ∞)',
	autoSpinLossLimitOptions: 'auto spin loss limits (5× … ∞)',
	autoSpinWinLimitOptions: 'auto spin single-win limits (5× … ∞)',
};

/**
 * The button STATE-IMAGE params an author exposes on a from-scratch button via the
 * Component Editor's "Show button params" picker. DERIVED from the shared
 * {@link import('./buttonStateImage').BUTTON_STATE_IMAGE_PARAMS} (same keys/labels/
 * group as the built-in `BUTTON_DEF`) so a hand-built button offers — and drives —
 * the SAME {@link import('./buttonStateImage').resolveButtonStateImage} cascade, and
 * a new state can't reach the def/cascade without also reaching this picker. `author: true`
 * → each shows in the Defaults panel (with a region picker) and per-instance; tick
 * only the states you need — the cascade falls back for the absent ones (a missing
 * `imagePressed` → `imageHover` → resting `image`). The author binds their bg sprite's
 * `region` → `image`, and the engine swaps it per interaction state. See
 * `docs/design/invisible-editor.md` §8.5.
 */
export const BUTTON_STATE_PARAMS: ComponentParam[] = BUTTON_STATE_IMAGE_PARAMS.map(
	(p): ComponentParam => ({
		key: p.key,
		kind: 'image',
		group: 'State images',
		label: p.label,
		author: true,
	}),
);

/**
 * The Hold and Win feature's signals (`docs/design/hold-and-win.md` §8, Phase 12a) — the engine's own
 * beats, reaching component cues and gates with no Flow wiring. Offered to a project with the
 * feature; the pot family to one with pots too, which the pots overlay add-on brings to any kind
 * (`docs/design/pots-overlay.md` §4). The pot signals are scoped by meter, the jackpot win by tier
 * and the lit letter by reel, so a celebration authored once inside the Pot component plays on the
 * pot it sits on.
 */
const featureFamily = (
	capability: keyof KindCapabilities,
	group: string,
	entries: { key: string; label: string; note: string; scope?: SignalScopeKind }[],
): EngineSignalEntry[] => entries.map((entry) => ({ ...entry, group, capability }));

const HOLD_AND_WIN_SIGNALS: EngineSignalEntry[] = [
	...featureFamily('pots', 'Pots', [
		{
			key: 'potFill',
			label: 'Pot — specials take off',
			note: 'Specials take off for a pot (its level is about to rise).',
			scope: 'meter',
		},
		{
			key: 'potLand',
			label: 'Pot — special lands',
			note: 'A special flying into a pot arrives.',
			scope: 'meter',
		},
		{
			key: 'potLevelUp',
			label: 'Pot — level up',
			note: "A pot's level rose by one (one per landing special).",
			scope: 'meter',
		},
		{
			key: 'potStageUp',
			label: 'Pot — size stage up',
			note: "A pot's level reached one of its meter's size stages.",
			scope: 'meter',
		},
		{ key: 'potFull', label: 'Pot — full', note: 'A pot filled.', scope: 'meter' },
		{
			key: 'potActivate',
			label: 'Pot — activate',
			note: 'A full pot is consumed by the feature trigger and its modifier activates.',
			scope: 'meter',
		},
	]),
	...featureFamily('holdAndWin', 'Respins', [
		{
			key: 'respinReset',
			label: 'Respin counter — reset',
			note: 'A coin landed and the counter went back to its start.',
		},
		{
			key: 'respinLast',
			label: 'Respin counter — last respin',
			note: 'The counter reached its last respin.',
		},
	]),
	...featureFamily('holdAndWin', 'Coins', [
		{ key: 'coinLand', label: 'Coins land', note: 'Coins land and stick on the respin board.' },
		{ key: 'coinCollect', label: 'Coins collected', note: 'A collector gathers coins.' },
		{ key: 'coinBoost', label: 'Coins boosted', note: 'Coin values are multiplied.' },
		{ key: 'coinUpgrade', label: 'Coins upgraded', note: 'An upgrade raises coin values.' },
	]),
	...featureFamily('holdAndWin', 'Jackpots', [
		{
			key: 'jackpotWin',
			label: 'Jackpot won',
			note: 'A feature jackpot was won. Scoped by tier: a jackpot tile hears its own tier.',
			scope: 'tier',
		},
	]),
	...featureFamily('holdAndWin', 'Letters', [
		{
			key: 'letterLit',
			label: 'Letter lit',
			note: 'A full column lights its letter. Scoped by reel (0 = the first column).',
			scope: 'reel',
		},
	]),
	...featureFamily('holdAndWin', 'Wheel', [
		{ key: 'wheelSpin', label: 'Wheel — spin', note: 'The wheel starts turning.' },
		{ key: 'wheelLand', label: 'Wheel — land', note: "The wheel stops on the server's prize." },
	]),
	...featureFamily('holdAndWin', 'Feature', [
		{ key: 'featureEnter', label: 'Feature — enter', note: 'The respin board appears.' },
		{ key: 'featureExit', label: 'Feature — exit', note: 'The respin board leaves.' },
	]),
];

/**
 * Signals a component's rig can play a cue on. Tick one here, then on a rig node add
 * a "Plays on signal" cue (signal → animation). `enter` is fired by the component itself
 * when it becomes visible (mount, or a `visibleSource` gate opening) — the intro-on-appear
 * hook. `win`/`bigWin` are fired by the game's win presentation. `freeSpinStart`/
 * `freeSpinEnd` are fired by the free-spin lifecycle (intro presents / outro presents), so a
 * rig cue on an authored intro/counter/outro screen plays with the mode. (Former
 * `exit`/`idle` placeholders were removed — nothing fired them: an instant-hide gate cuts an
 * exit animation and idle had no trigger.)
 *
 * FS-4 (landed): the `freeSpinRetrigger` event + step now exist, so a retrigger screen is
 * authorable (LAYER edge + `extraFs` readout + tap-to-continue). A dedicated `freeSpinRetrigger`
 * RIG-CUE signal is still a future additive step here (an entry + a `registerComponentSignals`
 * wire + a runtime broadcast) — not needed for the screen itself, only for a rig burst on it.
 */
export const ENGINE_SIGNAL_CATALOG: EngineSignalEntry[] = [
	{ key: 'enter', label: 'Enter', note: 'Played when the component appears (mount / gate opens).' },
	{ key: 'win', label: 'Win', note: 'A winning result resolved.' },
	{ key: 'bigWin', label: 'Big Win', note: 'A big-win threshold was crossed.' },
	{
		key: 'winCountUpComplete',
		label: 'Win — count-up complete',
		note: 'The win overlay count-up has finished. Arm a "tap to continue" with "arm after signal", or reveal a continue prompt with "hidden until signal", so the tap appears only after the count.',
	},
	{
		key: 'freeSpinStart',
		label: 'Free-spin start',
		note: 'The free-spin intro presents (free spins awarded).',
	},
	{
		key: 'freeSpinEnd',
		label: 'Free-spin end',
		note: 'The free-spin outro presents (free spins finished).',
	},
	{
		key: 'freeSpinOutroBigWin',
		label: 'Free-spin outro — big win',
		note: 'The free-spin outro count-up begins on a BIG win tier. Gate big-win art with "hidden until signal", or play a big-win rig cue.',
	},
	{
		key: 'freeSpinOutroSmallWin',
		label: 'Free-spin outro — small win',
		note: 'The free-spin outro count-up begins on a non-big (small) win tier. Gate small-win art with "hidden until signal", or play a small-win rig cue.',
	},
	{
		key: 'freeSpinOutroCountUpComplete',
		label: 'Free-spin outro — count-up complete',
		note: 'The free-spin outro count-up has finished. Arm a "tap to continue" with "arm after signal", or reveal a continue prompt with "hidden until signal", so the tap appears only after the count.',
	},
	{
		key: 'specialBookReveal',
		label: 'Book reveal',
		note: 'The book expanding-symbol reveal presents (a symbol was chosen).',
	},
	{
		key: 'specialBookHide',
		label: 'Book hide',
		note: 'The book expanding-symbol reveal dismisses.',
	},
	{
		key: 'boardGlowShow',
		label: 'Board glow show',
		note: 'The free-spin board glow lights up (free spins begin).',
	},
	{
		key: 'boardGlowHide',
		label: 'Board glow hide',
		note: 'The free-spin board glow fades out (free spins finish).',
	},
	{
		key: 'platformJackpotWin',
		label: 'Platform jackpot won',
		group: 'Jackpots',
		scope: 'tier',
		note: "The operator platform's jackpot was won, any kind. Scoped by tier: a jackpot tile hears its own tier's win.",
	},
	...HOLD_AND_WIN_SIGNALS,
];

/** The signals the editor offers a project of `gameType` (with the add-ons its `config` carries):
 *  every catalog entry it can fire. */
export function engineSignalsForKind(
	gameType: string | undefined,
	config?: KindCapabilityConfig,
): EngineSignalEntry[] {
	const capabilities = kindCapabilities(gameType, config);
	return ENGINE_SIGNAL_CATALOG.filter(
		(entry) => entry.capability === undefined || capabilities[entry.capability],
	);
}
