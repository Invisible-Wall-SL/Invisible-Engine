import {
	DEFAULT_LAYOUT_PROFILE,
	resolveBucketBox,
	selectBucket,
	type LayoutBucketBox,
	type LayoutProfile,
} from 'constants-shared/layoutProfile';
import { RESOLUTION_TIERS, type ResolutionTierId } from 'engine-layout';

/**
 * Which copy of the art this device loads (`docs/design/arcade-4k-builds.md` Phase 4): the full
 * pages, or a lower-resolution tier a project published beside them (`LayoutDoc.resolutionTiers`).
 *
 * The rule is how many screen pixels one canvas pixel gets. The window fits the canvas box at
 * `min(window / box)`, the renderer draws that at the device pixel ratio (capped by the render
 * tier), and the product is the art's on-screen scale. Art shown at half its size or less looks the
 * same from a half-size page, so the smallest tier still covering that scale is chosen: a 4K game
 * on a 4K cabinet gets `full`, the same game on a 1080p desktop or a phone gets `half`. A game that
 * published no tiers has nothing to choose between, so every lookup falls back to `full`.
 *
 * Decided once at boot, before any art is registered; a window resized later keeps its choice.
 * `?tier=full` / `?tier=half` forces one.
 */
export type ArtTier = 'full' | ResolutionTierId;

export interface ArtTierInput {
	/** `?tier=` — anything other than a known tier is ignored. */
	forced?: string | null;
	window: { width: number; height: number; devicePixelRatio: number };
	/** The renderer's resolution cap (`pixi-svelte` `renderSettings().maxResolution`). */
	maxResolution: number;
	/** The doc's canvas boxes and layout profile, which together say which box this window fits. */
	doc?: {
		mainSizesMap?: Record<string, LayoutBucketBox | undefined>;
		layoutProfile?: LayoutProfile;
	} | null;
}

/** The canvas box the window fits, the way `createLayout` picks it: the doc's box for the window's
 *  bucket, else that bucket's profile box. */
export function canvasBoxFor(input: Pick<ArtTierInput, 'window' | 'doc'>): LayoutBucketBox {
	const profile = input.doc?.layoutProfile ?? DEFAULT_LAYOUT_PROFILE;
	const bucket = selectBucket(profile, input.window);
	return input.doc?.mainSizesMap?.[bucket.id] ?? resolveBucketBox(profile, bucket.id);
}

/** Screen pixels per canvas pixel: the art's on-screen scale. */
export function artScreenScale(
	input: Pick<ArtTierInput, 'window' | 'doc' | 'maxResolution'>,
): number {
	const box = canvasBoxFor(input);
	const fit = Math.min(input.window.width / box.width, input.window.height / box.height);
	const resolution = Math.min(Math.max(input.window.devicePixelRatio || 1, 1), input.maxResolution);
	return fit * resolution;
}

export function chooseArtTier(input: ArtTierInput): ArtTier {
	if (input.forced === 'full') return 'full';
	if (input.forced && Object.hasOwn(RESOLUTION_TIERS, input.forced))
		return input.forced as ResolutionTierId;
	const scale = artScreenScale(input);
	const covering = (Object.entries(RESOLUTION_TIERS) as [ResolutionTierId, number][])
		.filter(([, tierScale]) => tierScale >= scale)
		.sort(([, a], [, b]) => a - b);
	return covering[0]?.[0] ?? 'full';
}
