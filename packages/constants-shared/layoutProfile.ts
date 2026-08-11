/**
 * Authorable layout profiles — the single source of truth for the game's set of
 * "layout buckets" (formerly the hardcoded four: desktop / tablet / landscape /
 * portrait) and the rules that sort a live window into one of them.
 *
 * A profile is authored in TWO places and layered at read time (project override →
 * admin global default → {@link DEFAULT_LAYOUT_PROFILE}). This module is the
 * lowest-level shared contract — pure TS, no Svelte — so the runtime
 * (`utils-layout/createLayout`) and the editor/launcher read ONE definition without
 * a dependency cycle. See `docs/design/layout-profiles.md`.
 *
 * `DEFAULT_LAYOUT_PROFILE` reproduces the historic hardcoded behaviour: its bucket
 * `id`s are exactly `desktop`/`tablet`/`landscape`/`portrait`, so every existing
 * `mainSizesMap` and `node.overrides` key still resolves with ZERO migration. A
 * bucket's `id` is its stable key; `label` is the display name, so "renaming" a
 * bucket is a relabel that never churns a key.
 */

export interface LayoutBucketBox {
	width: number;
	height: number;
}

/**
 * When does a live window fall into this bucket? All PROVIDED bounds must hold; an
 * omitted bound is unbounded. `ratio` = window.width / window.height; `side` =
 * min(width, height) in CSS px (the axis that separates a phone from a monitor at
 * the same aspect). Semantics are half-open on ratio (`[minRatio, maxRatio)`) and
 * closed on side (`[minSide, maxSide]`) — chosen so the DEFAULT profile reproduces
 * the legacy classifier everywhere except the measure-zero point ratio === 0.8
 * (legacy called that `portrait`; here it's `tablet`). Buckets are evaluated in
 * order and the FIRST match wins, so overlapping bounds resolve by position.
 */
export interface LayoutBucketRule {
	minRatio?: number;
	maxRatio?: number;
	minSide?: number;
	maxSide?: number;
}

export interface LayoutBucket {
	/** Stable key — indexes `mainSizesMap` and `node.overrides`. Immutable once created. */
	id: string;
	/** Display name shown in the editor device bar. Free to rename without key churn. */
	label: string;
	/** The design/frame box → the bucket's resolution and (derived) aspect ratio. */
	box: LayoutBucketBox;
	/** The window-selection rule. Omit (empty) to make this bucket the catch-all. */
	rule: LayoutBucketRule;
	/**
	 * Stacked = portrait-style vertical layout (the HUD/components stack rather than
	 * flank the board). Legacy: only `portrait` was stacked. Optional; default false.
	 */
	stacked?: boolean;
}

export interface LayoutProfile {
	/** Ordered; first matching rule wins. */
	buckets: LayoutBucket[];
	/** Bucket `id` used when no rule matches (should reference a real bucket). */
	fallbackBucketId: string;
}

/**
 * The historic hardcoded behaviour, expressed as data. Boxes come from the former
 * `STANDARD_MAIN_SIZES_MAP`; rules reproduce the former `layoutType()` decision tree
 * (ratio break points 0.8 / 1.3; the 480px mobile side cutoff). Order matters:
 * portrait (tall) → tablet (square-ish) → landscape (wide + small) → desktop (wide).
 */
export const DEFAULT_LAYOUT_PROFILE: LayoutProfile = {
	buckets: [
		{
			id: 'portrait',
			label: 'Portrait',
			box: { width: 1080, height: 1920 },
			rule: { maxRatio: 0.8 },
			stacked: true,
		},
		{
			id: 'tablet',
			label: 'Tablet',
			box: { width: 1920, height: 1920 },
			rule: { maxRatio: 1.3 },
		},
		{
			id: 'landscape',
			label: 'Landscape',
			box: { width: 1920, height: 1080 },
			rule: { maxSide: 480 },
		},
		{
			id: 'desktop',
			label: 'Desktop',
			box: { width: 1920, height: 1080 },
			rule: {},
		},
	],
	fallbackBucketId: 'desktop',
};

const getRatio = (size: LayoutBucketBox) => size.width / (size.height || 1);

const ruleMatches = (rule: LayoutBucketRule, ratio: number, side: number): boolean => {
	if (rule.minRatio !== undefined && ratio < rule.minRatio) return false;
	if (rule.maxRatio !== undefined && ratio >= rule.maxRatio) return false; // half-open upper
	if (rule.minSide !== undefined && side < rule.minSide) return false;
	if (rule.maxSide !== undefined && side > rule.maxSide) return false; // closed upper
	return true;
};

/**
 * Sort a live window into a bucket: the FIRST bucket whose rule matches, else the
 * `fallbackBucketId` bucket, else the last bucket. Never returns undefined for a
 * non-empty profile. Pure — safe to import in a Node fixture or the runtime.
 */
export const selectBucket = (profile: LayoutProfile, size: LayoutBucketBox): LayoutBucket => {
	const ratio = getRatio(size);
	const side = Math.min(size.width, size.height);
	for (const bucket of profile.buckets) {
		if (ruleMatches(bucket.rule, ratio, side)) return bucket;
	}
	return (
		profile.buckets.find((b) => b.id === profile.fallbackBucketId) ??
		profile.buckets[profile.buckets.length - 1]
	);
};

/** Find a bucket by id (undefined if absent). */
export const findBucket = (profile: LayoutProfile, id: string): LayoutBucket | undefined =>
	profile.buckets.find((b) => b.id === id);

/**
 * The design box for a bucket id, with a safe fallback: unknown ids (e.g. a project
 * profile adds `cinema` but a CODED game only ships boxes for the legacy four) fall
 * back to the `fallbackBucketId` box rather than crashing on `undefined`.
 */
export const resolveBucketBox = (profile: LayoutProfile, id: string): LayoutBucketBox => {
	const bucket = findBucket(profile, id) ?? findBucket(profile, profile.fallbackBucketId);
	return bucket?.box ?? profile.buckets[0]?.box ?? { width: 1920, height: 1080 };
};

/** The bucket boxes as a plain `{ [id]: {width,height} }` map (legacy shape). */
export const bucketBoxMap = (profile: LayoutProfile): Record<string, LayoutBucketBox> =>
	Object.fromEntries(profile.buckets.map((b) => [b.id, b.box]));

const isFinitePositive = (v: unknown): v is number =>
	typeof v === 'number' && Number.isFinite(v) && v > 0;
const optNumber = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * Coerce untrusted input (a DB row, an editor doc field, a runtime hand-off) into a
 * valid {@link LayoutProfile}, or `null` if it has no usable bucket. Shared so every
 * boundary validates the same way. Drops malformed buckets; de-dupes ids (first wins);
 * fills a missing `label` from the id; repairs `fallbackBucketId` to a real bucket.
 */
export const normalizeLayoutProfile = (input: unknown): LayoutProfile | null => {
	if (!input || typeof input !== 'object') return null;
	const src = input as { buckets?: unknown; fallbackBucketId?: unknown };
	if (!Array.isArray(src.buckets)) return null;
	const seen = new Set<string>();
	const buckets: LayoutBucket[] = [];
	for (const raw of src.buckets) {
		if (!raw || typeof raw !== 'object') continue;
		const b = raw as Record<string, unknown>;
		const id = typeof b.id === 'string' ? b.id.trim() : '';
		if (!id || seen.has(id)) continue;
		const box = b.box as { width?: unknown; height?: unknown } | undefined;
		if (!box || !isFinitePositive(box.width) || !isFinitePositive(box.height)) continue;
		const ruleIn = (b.rule ?? {}) as Record<string, unknown>;
		const rule: LayoutBucketRule = {};
		if (optNumber(ruleIn.minRatio) !== undefined) rule.minRatio = optNumber(ruleIn.minRatio);
		if (optNumber(ruleIn.maxRatio) !== undefined) rule.maxRatio = optNumber(ruleIn.maxRatio);
		if (optNumber(ruleIn.minSide) !== undefined) rule.minSide = optNumber(ruleIn.minSide);
		if (optNumber(ruleIn.maxSide) !== undefined) rule.maxSide = optNumber(ruleIn.maxSide);
		seen.add(id);
		buckets.push({
			id,
			label: typeof b.label === 'string' && b.label.trim() ? b.label : id,
			box: { width: box.width, height: box.height },
			rule,
			...(b.stacked === true ? { stacked: true } : {}),
		});
	}
	if (!buckets.length) return null;
	const fallback =
		typeof src.fallbackBucketId === 'string' && buckets.some((b) => b.id === src.fallbackBucketId)
			? src.fallbackBucketId
			: buckets[buckets.length - 1].id;
	return { buckets, fallbackBucketId: fallback };
};
