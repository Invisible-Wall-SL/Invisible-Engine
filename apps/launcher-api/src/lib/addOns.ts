import type { SceneSetOptions } from 'engine-layout';
import { flowAddOnsOf, resolveMeters, type GameConfigDoc } from 'game-config';

/** The add-on blocks a project's Game Config carries (docs/design/pots-overlay.md §4) — the
 *  `KindCapabilityConfig` flags the kind-gated editor surfaces read. All `false` without a config,
 *  which `kindCapabilities` answers exactly as it does with no config at all. */
export type ProjectAddOns = { holdAndWin: boolean; potsOverlay: boolean };

type AddOnDoc = Pick<GameConfigDoc, 'holdAndWin' | 'potsOverlay'> | null | undefined;

/**
 * The project's add-ons, plus the pot ids its pots screen shows: every resolved meter, the Hold
 * and Win block's first. Read through game-config's `flowAddOnsOf`, the one reader Invisible Flow
 * composes from too. `potIds` is null when no config resolves, so the scene set keeps its built-in
 * pots.
 */
export function projectAddOns(doc: AddOnDoc): {
	addOns: ProjectAddOns;
	potIds: string[] | null;
} {
	const { holdAndWin, potsOverlay, meters } = flowAddOnsOf(doc);
	return { addOns: { holdAndWin, potsOverlay }, potIds: doc ? meters : null };
}

/**
 * The scene-set options a project's layout is seeded from. A Hold and Win kind's own block is its
 * base game, so only an overlay names its pots there; every other kind gets the add-on screens
 * whenever its config carries either block. Without an add-on the result is what the scaffold has
 * always passed (`maxRows` alone, read by the Hold and Win kind only), so its layout is unchanged.
 */
export function sceneSetOptionsFor(gameType: string, doc: AddOnDoc): SceneSetOptions {
	const { addOns, potIds } = projectAddOns(doc);
	const maxRows = doc?.holdAndWin?.expansion?.maxRows;
	const addOn =
		gameType === 'holdAndWin' ? addOns.potsOverlay : addOns.holdAndWin || addOns.potsOverlay;
	return {
		...(maxRows ? { maxRows } : {}),
		...(addOn ? { ...addOns, ...(potIds ? { potIds } : {}) } : {}),
	};
}

/** Each pots overlay token → the pots it fills. Tokens are never on a strip, so the in-play set
 *  misses them and a tool lists them from here. Empty without the block. */
export function overlayTokenPots(doc: AddOnDoc): Record<string, string[]> {
	const tokens: Record<string, string[]> = {};
	for (const meter of doc ? resolveMeters(doc) : []) {
		if (meter.source === 'overlay') (tokens[meter.symbol] ??= []).push(meter.id);
	}
	return tokens;
}
