import type { ModelTierId } from 'constants-shared/modelTiers';

/**
 * Lower-resolution copies of a game's art, written at publish beside the full-resolution pages
 * (`docs/design/arcade-4k-builds.md` Phase 3). A game authored for a 4K cabinet ships its art at
 * full size for the cabinet and a smaller copy for desktops and phones, which lays out identically
 * because each copy declares its scale as the texture's resolution.
 *
 * Opt-in per project (`LayoutDoc.resolutionTiers`): a game that does not ask writes nothing extra,
 * so its export, its bundle and its assemble time are exactly what they were.
 */
export const RESOLUTION_TIERS = { half: 0.5 } as const;

export type ResolutionTierId = keyof typeof RESOLUTION_TIERS;

/** What a stored `LayoutDoc.resolutionTiers` may hold: the 2D tiers, plus the 3D model tiers a 3D
 *  project publishes (`constants-shared` `modelTiers.ts`). A type only: a 2D reader still goes
 *  through {@link normalizeResolutionTiers}, which keeps the 2D ids alone. */
export type StoredResolutionTierId = ResolutionTierId | ModelTierId;

const isTierId = (value: unknown): value is ResolutionTierId =>
	typeof value === 'string' && Object.hasOwn(RESOLUTION_TIERS, value);

/** The doc's tiers, de-duplicated and in declaration order; `undefined` when it asks for none, so a
 *  doc that never set the field and one that cleared it store the same thing. An id this build does
 *  not know is dropped (a reader ignores what a newer build added). */
export function normalizeResolutionTiers(input: unknown): ResolutionTierId[] | undefined {
	if (!Array.isArray(input)) return undefined;
	const tiers = (Object.keys(RESOLUTION_TIERS) as ResolutionTierId[]).filter((id) =>
		input.some((value) => isTierId(value) && value === id),
	);
	return tiers.length > 0 ? tiers : undefined;
}
