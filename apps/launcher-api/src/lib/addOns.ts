import { resolveMeters, type GameConfigDoc } from 'game-config';

/** The add-on blocks a project's Game Config carries (docs/design/pots-overlay.md §4) — the
 *  `KindCapabilityConfig` flags the kind-gated editor surfaces read. All `false` without a config,
 *  which `kindCapabilities` answers exactly as it does with no config at all. */
export type ProjectAddOns = { holdAndWin: boolean; potsOverlay: boolean };

/**
 * The project's add-ons, plus the pot ids its pots screen shows: every resolved meter, the Hold
 * and Win block's first. `potIds` is null when no config resolves, so the scene set keeps its
 * built-in pots.
 */
export function projectAddOns(doc: GameConfigDoc | null | undefined): {
	addOns: ProjectAddOns;
	potIds: string[] | null;
} {
	return {
		addOns: { holdAndWin: !!doc?.holdAndWin, potsOverlay: !!doc?.potsOverlay },
		potIds: doc ? resolveMeters(doc).map((meter) => meter.id) : null,
	};
}
