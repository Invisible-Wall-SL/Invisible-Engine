import { resolveMeters, type GameConfigDoc } from 'game-config';

/** The add-on blocks a project's Game Config carries (docs/design/pots-overlay.md §4) — the
 *  `KindCapabilityConfig` flags the kind-gated editor surfaces read. All `false` without a config,
 *  which `kindCapabilities` answers exactly as it does with no config at all. */
export type ProjectAddOns = { holdAndWin: boolean; potsOverlay: boolean };

type AddOnDoc = Pick<GameConfigDoc, 'holdAndWin' | 'potsOverlay'> | null | undefined;

/**
 * The project's add-ons, plus the pot ids its pots screen shows: every resolved meter, the Hold
 * and Win block's first. `potIds` is null when no config resolves, so the scene set keeps its
 * built-in pots.
 */
export function projectAddOns(doc: AddOnDoc): {
	addOns: ProjectAddOns;
	potIds: string[] | null;
} {
	return {
		addOns: { holdAndWin: !!doc?.holdAndWin, potsOverlay: !!doc?.potsOverlay },
		potIds: doc ? resolveMeters(doc).map((meter) => meter.id) : null,
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
