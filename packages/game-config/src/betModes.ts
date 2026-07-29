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
