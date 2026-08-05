/**
 * Invisible Game Config — folding a bet mode's MATH ({@link BetMode}) and its PRESENTATION
 * ({@link BetModePresentation}) into the one shape the menu needs ({@link ResolvedBetMode}).
 *
 * This is the single home for the two derivations the buy-bonus surface depends on, so neither the
 * runtime nor the `/config` tool re-invents them (the `COMPONENT_PARAM_KINDS` lesson: one answer,
 * imported, not copied):
 *  1. `kind` — `base` / `ante` / `buy`. Derived from `buyBonus` when unset; `ante` is explicit-only
 *     because the two math booleans cannot express a persistent-toggle mode (the base mode is itself
 *     `feature: true`).
 *  2. the default COPY — a mode with no authored title still shows something legible (its id, and a
 *     verb matched to its kind), so an un-authored config renders a working menu.
 *
 * Text fields stay SOURCE strings (base language): the runtime passes them through the i18n
 * resolver at render, so they localize like everything else. Dependency-free — game-config is a leaf
 * package, so it must not reach into state-shared; the runtime maps `ResolvedBetMode` into its own
 * `BetModeMeta`.
 */

import type {
	BetMode,
	BetModeKind,
	BetModePresentation,
	GameConfigDoc,
	ResolvedBetMode,
} from './types';

/** `buyBonus` ⇒ a purchase; otherwise the plain base stake. `ante` never derives — it is marked. */
const deriveKind = (mode: BetMode): BetModeKind => (mode.buyBonus ? 'buy' : 'base');

/** The default button verb per kind — overridden by an authored `text.button`. */
const defaultButton = (kind: BetModeKind): string => {
	if (kind === 'buy') return 'BUY';
	if (kind === 'ante') return 'ACTIVATE';
	return 'PLAY';
};

/**
 * Fold one mode. `order` resolves to the authored value, else the mode's index in `betModes` — so
 * an un-ordered config keeps the author's key order, and a single `order` override moves just that
 * one without renumbering the rest.
 */
const resolveOne = (
	mode: string,
	math: BetMode,
	presentation: BetModePresentation | undefined,
	index: number,
): ResolvedBetMode => {
	const kind = presentation?.kind ?? deriveKind(math);
	const text = presentation?.text ?? {};
	const art = presentation?.art ?? {};
	return {
		mode,
		kind,
		costMultiplier: math.cost,
		maxWin: math.max_win,
		rtp: math.rtp,
		order: presentation?.order ?? index,
		// A legible fallback so an un-authored mode never renders its raw lowercase key.
		title: text.title || mode.toUpperCase(),
		description: text.description ?? '',
		button: text.button || defaultButton(kind),
		dialog: text.dialog ?? '',
		betAmountLabel: text.betAmountLabel ?? '',
		// Art is an editor-art KEY, not a URL — resolved to a texture by the runtime. Empty when
		// unauthored so a consumer draws nothing rather than a broken texture.
		art: {
			icon: art.icon ?? '',
			dialogImage: art.dialogImage ?? '',
			volatility: art.volatility ?? '',
		},
		// The card is a ComponentDef id, not an asset key. Empty when unauthored so the runtime omits
		// the per-item `componentId` and the repeater falls back to its default `featureCard` (parity).
		card: presentation?.card ?? '',
		// Per-mode card param overrides — passed through so the buy-feature repeater merges them into
		// the item's values (any card param the mode overrides). `{}` when unauthored ⇒ no overrides ⇒
		// every param keeps the card's authored default (parity).
		cardParams: presentation?.cardParams ?? {},
	};
};

/**
 * The whole bet-mode menu, resolved and ORDERED. The runtime maps this into `BetModeMeta`; the tool
 * previews from it. Sorted by resolved `order` (stable on ties, falling back to `betModes` key
 * order), so the menu order is authorable without reordering the underlying object.
 */
export const resolveBetModes = (doc: GameConfigDoc): ResolvedBetMode[] => {
	const presentation = doc.betModePresentation ?? {};
	const resolved = Object.entries(doc.betModes).map(([mode, math], index) =>
		resolveOne(mode, math, presentation[mode], index),
	);
	// A stable sort by order: equal orders keep their original (key) sequence.
	return resolved
		.map((mode, index) => ({ mode, index }))
		.sort((a, b) => a.mode.order - b.mode.order || a.index - b.index)
		.map(({ mode }) => mode);
};

/**
 * The DISTINCT set of card ComponentDef ids a config assigns to its bet modes
 * ({@link BetModePresentation.card}). The bake collector uses this to fold each config-assigned card
 * def onto the export→bake→pull chain — those ids are chosen at RUNTIME, so `collectComponentIds`
 * (which walks the scene doc statically) can't see them. Empty for an un-authored / no-card config,
 * so a project without per-mode cards ships byte-identical to before (parity). Blank/whitespace
 * entries are dropped; a named-but-nonexistent id is left to the caller's `loadComponent` to skip.
 */
export const betModeCardIds = (doc: GameConfigDoc): string[] => {
	const ids = new Set<string>();
	for (const presentation of Object.values(doc.betModePresentation ?? {})) {
		const card = presentation.card?.trim();
		if (card) ids.add(card);
	}
	return [...ids];
};

/**
 * The per-mode {@link BetModePresentation.cardParams} overrides that carry ART — the bake collector's
 * hook for the same reason as {@link betModeCardIds}: a card param can name an editor-art frame or
 * spine bundle (a different panel/icon/spine per card), chosen at RUNTIME in the config, so the static
 * scene/def walk never sees it. Returns one entry per mode with a non-empty `cardParams`, carrying its
 * assigned `card` id (empty string ⇒ the default `featureCard`, resolved by the caller) and the raw
 * override map. The caller classifies each key by the card def's param KIND (image → atlas, spine →
 * bundle) — game-config is a leaf that can't resolve component defs. Empty for a config with no card
 * overrides, so a project without them ships byte-identical (parity).
 */
export const betModeCardParamRefs = (
	doc: GameConfigDoc,
): { card: string; cardParams: Record<string, string | number | boolean> }[] => {
	const refs: { card: string; cardParams: Record<string, string | number | boolean> }[] = [];
	for (const presentation of Object.values(doc.betModePresentation ?? {})) {
		const cardParams = presentation.cardParams;
		if (cardParams && Object.keys(cardParams).length) {
			refs.push({ card: presentation.card?.trim() ?? '', cardParams });
		}
	}
	return refs;
};
