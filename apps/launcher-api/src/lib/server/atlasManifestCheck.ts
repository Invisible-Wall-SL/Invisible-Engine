/**
 * Validate an Atlas Maker per-project atlas manifest against the AUTHORITATIVE
 * game config (the committed TexturePacker sheet). The manifest is hand-authored
 * and only HAPPENS to match a game; a reskin can drift it (a missing key, a wrong
 * rotation) and the game then renders a hole where the symbol should be. This
 * check derives the truth from the game's own sheet and reports the drift.
 *
 * Convention:
 *   - the manifest carries SNAKE_CASE regions in two buckets, `regions`
 *     (rotated=false) and `rotated_regions` (rotated=true), with optional
 *     `off_x/off_y/orig_w/orig_h` (camelCase `offX/...` tolerated as a fallback).
 *   - the game frames are TexturePacker frames keyed `h1.png` etc. — the same
 *     shape `tpFrameToRegion` (scripts/lib/tpRegions.mjs) consumes.
 *
 * `missing` = the game needs a frame the manifest lacks → BLANK SYMBOL in-game
 * (the failure this whole feature exists to catch). `extra` = the manifest has a
 * region the game's sheet no longer references (dead weight, not fatal).
 */

export interface ManifestRegion {
	name: string;
	x: number;
	y: number;
	w: number;
	h: number;
	rotated?: boolean;
	off_x?: number;
	off_y?: number;
	orig_w?: number;
	orig_h?: number;
}

export interface AtlasManifestShape {
	regions?: ManifestRegion[];
	rotated_regions?: ManifestRegion[];
}

/** A TexturePacker frame as it appears in the game's committed sheet. */
export interface GameFrame {
	frame?: { x?: number; y?: number; w?: number; h?: number };
	rotated?: boolean;
	spriteSourceSize?: { x?: number; y?: number; w?: number; h?: number };
	sourceSize?: { w?: number; h?: number };
}

export type GameFrames = Record<string, GameFrame>;

export interface GeometryMismatch {
	name: string;
	field: 'x' | 'y' | 'w' | 'h' | 'off_x' | 'off_y' | 'orig_w' | 'orig_h';
	manifest: number;
	game: number;
}

export interface ManifestCheckReport {
	/** Frames the game needs that the manifest lacks → blank symbol in-game. */
	missing: string[];
	/** Manifest regions the game's sheet no longer references (dead weight). */
	extra: string[];
	/** Rect/trim/orig geometry that differs between manifest and game. */
	geometryMismatch: GeometryMismatch[];
	/** Frames whose `rotated` flag disagrees between manifest and game. */
	rotationMismatch: string[];
	/** True when nothing is missing and no geometry/rotation differs. */
	ok: boolean;
}

function num(v: unknown, fallback = 0): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Read an optional region field that may be snake_case or camelCase. */
function pick(r: ManifestRegion, ...keys: string[]): number | undefined {
	const rec = r as Record<string, unknown>;
	for (const k of keys) {
		if (typeof rec[k] === 'number' && Number.isFinite(rec[k] as number)) {
			return rec[k] as number;
		}
	}
	return undefined;
}

/** Collapse a manifest's two region buckets into one keyed map. */
function manifestRegionMap(manifest: AtlasManifestShape): Map<string, ManifestRegion> {
	const map = new Map<string, ManifestRegion>();
	for (const bucket of [manifest.regions, manifest.rotated_regions]) {
		for (const r of bucket ?? []) {
			if (r && typeof r.name === 'string' && r.name.length > 0) map.set(r.name, r);
		}
	}
	return map;
}

/** The authoritative geometry a game frame implies (matches tpFrameToRegion). */
function gameGeometry(f: GameFrame): {
	x: number;
	y: number;
	w: number;
	h: number;
	rotated: boolean;
	off_x: number;
	off_y: number;
	orig_w: number;
	orig_h: number;
} {
	const fr = f.frame ?? {};
	const sss = f.spriteSourceSize ?? {};
	const src = f.sourceSize ?? {};
	const w = num(fr.w);
	const h = num(fr.h);
	return {
		x: num(fr.x),
		y: num(fr.y),
		w,
		h,
		rotated: Boolean(f.rotated),
		off_x: num(sss.x),
		off_y: num(sss.y),
		orig_w: num(src.w, w),
		orig_h: num(src.h, h),
	};
}

/**
 * Compare a manifest against the game's TexturePacker frames. The game frames are
 * the source of truth; `ok` is false if anything is missing or any geometry /
 * rotation differs (extras alone do NOT fail — they're dead weight, not holes).
 */
export function validateManifestAgainstGame(
	manifest: AtlasManifestShape,
	gameFrames: GameFrames,
): ManifestCheckReport {
	const manRegions = manifestRegionMap(manifest);
	const gameNames = new Set(Object.keys(gameFrames));

	const missing: string[] = [];
	const extra: string[] = [];
	const geometryMismatch: GeometryMismatch[] = [];
	const rotationMismatch: string[] = [];

	for (const [name, frame] of Object.entries(gameFrames)) {
		const region = manRegions.get(name);
		if (!region) {
			missing.push(name);
			continue;
		}
		const g = gameGeometry(frame);

		if (Boolean(region.rotated) !== g.rotated) rotationMismatch.push(name);

		const compare: { field: GeometryMismatch['field']; manifest: number; game: number }[] = [
			{ field: 'x', manifest: num(region.x), game: g.x },
			{ field: 'y', manifest: num(region.y), game: g.y },
			{ field: 'w', manifest: num(region.w), game: g.w },
			{ field: 'h', manifest: num(region.h), game: g.h },
			{ field: 'off_x', manifest: pick(region, 'off_x', 'offX') ?? 0, game: g.off_x },
			{ field: 'off_y', manifest: pick(region, 'off_y', 'offY') ?? 0, game: g.off_y },
			{ field: 'orig_w', manifest: pick(region, 'orig_w', 'origW') ?? g.w, game: g.orig_w },
			{ field: 'orig_h', manifest: pick(region, 'orig_h', 'origH') ?? g.h, game: g.orig_h },
		];
		for (const c of compare) {
			if (c.manifest !== c.game) {
				geometryMismatch.push({ name, field: c.field, manifest: c.manifest, game: c.game });
			}
		}
	}

	for (const name of manRegions.keys()) {
		if (!gameNames.has(name)) extra.push(name);
	}

	missing.sort();
	extra.sort();
	rotationMismatch.sort();
	geometryMismatch.sort((a, b) => a.name.localeCompare(b.name) || a.field.localeCompare(b.field));

	const ok =
		missing.length === 0 && geometryMismatch.length === 0 && rotationMismatch.length === 0;

	return { missing, extra, geometryMismatch, rotationMismatch, ok };
}
