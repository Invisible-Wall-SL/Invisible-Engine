import {
	DEFAULT_LAYOUT_PROFILE,
	resolveBucketBox,
	selectBucket,
	type LayoutBucketBox,
	type LayoutProfile,
} from 'constants-shared/layoutProfile';
import { RESOLUTION_TIERS, type ResolutionTierId } from 'engine-layout';
import { canvasResolution } from 'pixi-svelte/deviceClass';

/**
 * Which copy of the art this device loads (`docs/design/arcade-4k-builds.md` Phase 4): the full
 * pages, or a lower-resolution tier a project published beside them (`LayoutDoc.resolutionTiers`).
 *
 * The rule is how many screen pixels one canvas pixel gets. The window fits the canvas box at
 * `min(window / box)`, the renderer draws that at the screen's pixel ratio capped by the render
 * tier (`pixi-svelte` `canvasResolution`), and the product is the art's on-screen scale. Art shown
 * at half its size or less looks the same from a half-size page, so the smallest tier still
 * covering that scale is chosen: a 4K game on a 4K cabinet gets `full`, the same game on a 1080p
 * desktop or a phone gets `half`. A game that published no tiers has nothing to choose between, so
 * every lookup falls back to `full`.
 *
 * Decided once at boot, before any art is registered; a window resized later keeps its choice.
 * `?tier=full` / `?tier=half` forces one, and a build pinned to one tier (`IE_ART_TIER`) always
 * loads that one.
 */
export type ArtTier = 'full' | ResolutionTierId;

export interface ArtTierInput {
	/** The build's pin (`IE_ART_TIER`, compiled in as `__IE_ART_TIER__`). It wins over `forced`: a
	 *  pinned build ships only that tier's files, so any other would load nothing. */
	pinned?: string | null;
	/** `?tier=` — anything other than a known tier is ignored. */
	forced?: string | null;
	/** The window in CSS px, and its screen pixels per CSS pixel (`pixi-svelte` `screenPixelRatio`):
	 *  a phone showing a zoomed-out desktop site counts its real pixels, not its DPR. */
	window: { width: number; height: number; pixelRatio: number };
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
	return fit * canvasResolution(input.window.pixelRatio, input.maxResolution);
}

const knownTier = (id: string | null | undefined): ArtTier | null =>
	id === 'full'
		? 'full'
		: id && Object.hasOwn(RESOLUTION_TIERS, id)
			? (id as ResolutionTierId)
			: null;

/** How far over a tier's scale a screen may be and still count as covered: the scale multiplies
 *  browser floats (the page zoom is single precision), so a screen showing the art at exactly half
 *  (a 1080 px wide phone, a 2160 px wide box) must not land a hair above it. */
const COVER_SLACK = 1e-6;

export function chooseArtTier(input: ArtTierInput): ArtTier {
	const chosen = knownTier(input.pinned) ?? knownTier(input.forced);
	if (chosen) return chosen;
	const scale = artScreenScale(input);
	const covering = (Object.entries(RESOLUTION_TIERS) as [ResolutionTierId, number][])
		.filter(([, tierScale]) => tierScale + COVER_SLACK >= scale)
		.sort(([, a], [, b]) => a - b);
	return covering[0]?.[0] ?? 'full';
}
