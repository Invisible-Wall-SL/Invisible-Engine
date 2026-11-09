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
