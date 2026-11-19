/**
 * Quality tiers for 3D models (`docs/design/3d-games.md` §5, `docs/design/3d/assets-evaluation.md`
 * §5): one master upload, and every published tier derived from it at export — a window on the
 * master's LOD chain, a mip level of its textures, and a per-map keep/drop/encoding profile.
 *
 * THE 3D tier list. It is deliberately NOT engine-layout's `RESOLUTION_TIERS`: that object is
 * compiled into every 2D runtime and `chooseArtTier` picks among its ids without checking what a
 * project published, so a `quarter` there would make a 4K 2D game fall back to its full-size art.
 * Read by `engine-3d` (the tier chooser), `modelExport.ts` (the derive) and the pull (build-time).
 * No 2D runtime imports this file, so it costs their bundles nothing.
 *
 * Precedence for every value here: `model.json` overrides → the Game Config `models` block → these
 * code defaults. Import-free with only erasable syntax, so a plain `node` script can import it.
 */

/** Highest quality first. `full` is the unsuffixed file and the fallback for every missing copy. */
export const MODEL_TIERS = ['ultra', 'full', 'half', 'quarter'] as const;
export type ModelTierId = (typeof MODEL_TIERS)[number];

export const MODEL_FALLBACK_TIER = 'full' satisfies ModelTierId;

export const isModelTierId = (value: unknown): value is ModelTierId =>
	typeof value === 'string' && (MODEL_TIERS as readonly string[]).includes(value);

/** `models/sword.glb` → `models/sword@half.glb`; `full` keeps the name (the 2D `@<tier>` rule). */
export function modelTierFile(fullFile: string, tier: ModelTierId): string {
	if (tier === MODEL_FALLBACK_TIER) return fullFile;
	const slash = fullFile.lastIndexOf('/');
	const dot = fullFile.lastIndexOf('.');
	return dot > slash
		? `${fullFile.slice(0, dot)}@${tier}${fullFile.slice(dot)}`
		: `${fullFile}@${tier}`;
}

/**
 * The tiers a project publishes: `full` always, plus each model tier its `LayoutDoc.resolutionTiers`
 * names, in `MODEL_TIERS` order. Unknown ids are dropped (a reader ignores what a newer build added).
 */
export function publishedModelTiers(resolutionTiers: unknown): ModelTierId[] {
	const asked = Array.isArray(resolutionTiers) ? resolutionTiers : [];
	return MODEL_TIERS.filter((id) => id === MODEL_FALLBACK_TIER || asked.includes(id));
}

/**
 * `anim` is a CLIP LIBRARY (`anim/<skeleton>/<set>.glb`: an armature and its `<set>.<clip>`
 * animations, no mesh, no texture): untiered, only `full` is written, and the derive only
 * resamples and compresses it. `viewmodel` is a first-person viewmodel (`CH_<hero>_vm`, the arms
 * drawn at the camera): a hero's budget and maps, but ONE level on every tier, since it is never
 * anywhere but at the eye.
 */
export const MODEL_CLASSES = ['hero', 'weapon', 'prop', 'tile', 'fx', 'anim', 'viewmodel'] as const;
export type ModelClass = (typeof MODEL_CLASSES)[number];

/** Classes that ship one copy for every tier (no LOD, no texture to derive). */
export const isUntieredModelClass = (cls: ModelClass): boolean => cls === 'anim';

export const isModelClass = (value: unknown): value is ModelClass =>
	typeof value === 'string' && (MODEL_CLASSES as readonly string[]).includes(value);

/**
 * A master LOD level: `0…3` are the `_LOD<n>` meshes, `MODEL_LOD_ULTRA` the optional authored
 * `_LODU` top level (ultra only; simplifying cannot add detail, so it is never generated).
 */
export type ModelLodLevel = number;
export const MODEL_LOD_ULTRA = -1;

/** The texture maps a model's material may carry. `ramp` is the toon ramp / palette. */
export const MODEL_MAPS = ['baseColor', 'normal', 'orm', 'emissive', 'ramp'] as const;
export type ModelMap = (typeof MODEL_MAPS)[number];
/** The maps a tier resizes and re-encodes; the ramp ships unchanged at every tier. */
export type ModelTieredMap = Exclude<ModelMap, 'ramp'>;
export const MODEL_TIERED_MAPS = [
	'baseColor',
	'normal',
	'orm',
	'emissive',
] as const satisfies readonly ModelTieredMap[];

/**
 * `uastc` → BC7/ASTC on the GPU (high quality, larger), `etc1s` → smallest download, `png` →
 * lossless, never block-compressed (the ramp always; a pixel-exact decal on `full` by override).
 */
export type ModelTextureEncoding = 'uastc' | 'etc1s' | 'png';

/** Colour space a map is encoded in: base colour, emissive and the ramp are sRGB; data maps linear. */
export const MODEL_MAP_COLOR_SPACE = {
	baseColor: 'srgb',
	normal: 'linear',
	orm: 'linear',
	emissive: 'srgb',
	ramp: 'srgb',
} as const satisfies Record<ModelMap, 'srgb' | 'linear'>;

/** The toon ramp / palette: lossless PNG, no mipmaps, nearest filtering, every tier unchanged
 *  (block compression smears its hard steps). */
export const MODEL_RAMP_RULE = { encoding: 'png', mipmaps: false, filter: 'nearest' } as const;

/**
 * One tier of one class. `lods` is the inclusive window `[from, to]` of master levels shipped
 * (`from` = `MODEL_LOD_ULTRA` means "the `_LODU` when the master has one, else LOD0"). `maps` caps
 * each map's size in pixels, or drops it. Every tier texture carries mipmaps except the ramp.
 */
export interface ModelTierProfile {
	lods: readonly [ModelLodLevel, ModelLodLevel];
	maps: Readonly<Record<ModelTieredMap, number | 'drop'>>;
	encoding: Readonly<Record<ModelTieredMap, ModelTextureEncoding>>;
	/** Multiply the ORM map's AO into base colour when the ORM map is dropped (`quarter`). */
	bakeAoIntoBaseColor?: boolean;
}

/** How missing master levels are generated at export (meshoptimizer `simplify`, assets §5.4). */
export interface ModelLodGenerate {
	/** Target triangle count per master level `0…n`; LOD0 is the class budget. */
	tris: readonly number[];
	/** The `_LODU` ceiling (authored only), or absent when the class has no ultra level. */
	ultraTris?: number;
	/** meshoptimizer's relative error bound for `simplify`. */
	targetError: number;
	/** Keep open borders fixed so neighbouring tiles stay watertight. */
	lockBorder: boolean;
	/** Use `simplifySloppy` for the last level when `simplify` cannot reach its target. */
	sloppyLastLevel: boolean;
}

/**
 * LOD switching by screen size: the projected bounding-sphere height ÷ viewport height, with ~10 %
 * hysteresis, per MASTER level (a tier that drops the top levels shows its first level at every
 * larger size). `levels[i]` is the smallest screen size at which LOD i is drawn; below the last
 * entry the last level keeps drawing down to `cullBelow`, and below that the model is hidden.
 * `ultra` is the smallest size for the `_LODU` level (ultra tier only).
 */
export interface ModelLodScreenSize {
	levels: readonly number[];
	ultra?: number;
	cullBelow: number;
}

export interface ModelClassDefaults {
	/** Largest master map side the validator accepts for this class (power of two). */
	masterMaxTexture: number;
	lodGenerate: ModelLodGenerate;
	lodScreenSize: ModelLodScreenSize;
	tiers: Readonly<Record<ModelTierId, ModelTierProfile>>;
}

const UASTC_FULL = {
	baseColor: 'uastc',
	normal: 'uastc',
	orm: 'uastc',
	emissive: 'uastc',
} as const;
const ETC1S_WEB = { baseColor: 'etc1s', normal: 'uastc', orm: 'etc1s', emissive: 'etc1s' } as const;

/** The per-map caps of assets §5.2 (written for a 4096² hero master; a smaller master is clamped). */
const TEXTURE_TIERS = {
	ultra: {
		maps: { baseColor: 4096, normal: 4096, orm: 4096, emissive: 2048 },
		encoding: UASTC_FULL,
	},
	full: {
		maps: { baseColor: 2048, normal: 2048, orm: 2048, emissive: 1024 },
		encoding: UASTC_FULL,
	},
	half: {
		maps: { baseColor: 1024, normal: 1024, orm: 1024, emissive: 512 },
		encoding: ETC1S_WEB,
	},
	quarter: {
		maps: { baseColor: 512, normal: 'drop', orm: 'drop', emissive: 256 },
		encoding: ETC1S_WEB,
		bakeAoIntoBaseColor: true,
	},
} as const satisfies Record<ModelTierId, Omit<ModelTierProfile, 'lods'>>;

const withLods = (
	lods: Record<ModelTierId, readonly [ModelLodLevel, ModelLodLevel]>,
): Record<ModelTierId, ModelTierProfile> => ({
	ultra: { ...TEXTURE_TIERS.ultra, lods: lods.ultra },
	full: { ...TEXTURE_TIERS.full, lods: lods.full },
	half: { ...TEXTURE_TIERS.half, lods: lods.half },
	quarter: { ...TEXTURE_TIERS.quarter, lods: lods.quarter },
});

/** Code defaults per class: assets §1 "Budgets" and §5.2 "Geometry" / "Textures". The screen
 *  sizes past the hero's are proposals to tune in the Model Viewer. */
export const MODEL_CLASS_DEFAULTS = {
	hero: {
		masterMaxTexture: 4096,
		lodGenerate: {
			tris: [20_000, 10_000, 5_000, 2_500],
			ultraTris: 60_000,
			targetError: 0.01,
			lockBorder: false,
			sloppyLastLevel: false,
		},
		lodScreenSize: { levels: [0.25, 0.1, 0.04, 0.015], ultra: 0.5, cullBelow: 0.005 },
		tiers: withLods({ ultra: [MODEL_LOD_ULTRA, 2], full: [0, 2], half: [1, 3], quarter: [2, 3] }),
	},
	weapon: {
		masterMaxTexture: 1024,
		lodGenerate: {
			tris: [3_000, 1_500, 500],
			targetError: 0.02,
			lockBorder: false,
			sloppyLastLevel: false,
		},
		lodScreenSize: { levels: [0.08, 0.03, 0.01], cullBelow: 0.003 },
		tiers: withLods({ ultra: [0, 1], full: [0, 1], half: [1, 2], quarter: [2, 2] }),
	},
	prop: {
		masterMaxTexture: 2048,
		lodGenerate: {
			tris: [6_000, 3_000, 1_000, 300],
			ultraTris: 15_000,
			targetError: 0.02,
			lockBorder: false,
			sloppyLastLevel: true,
		},
		lodScreenSize: { levels: [0.2, 0.08, 0.03, 0.01], ultra: 0.45, cullBelow: 0.004 },
		tiers: withLods({ ultra: [MODEL_LOD_ULTRA, 2], full: [0, 2], half: [1, 3], quarter: [2, 3] }),
	},
	tile: {
		masterMaxTexture: 1024,
		lodGenerate: {
			tris: [2_000, 500],
			targetError: 0.01,
			lockBorder: true,
			sloppyLastLevel: false,
		},
		lodScreenSize: { levels: [0.05, 0.01], cullBelow: 0.002 },
		tiers: withLods({ ultra: [0, 1], full: [0, 1], half: [0, 1], quarter: [1, 1] }),
	},
	fx: {
		masterMaxTexture: 512,
		lodGenerate: { tris: [500], targetError: 0.02, lockBorder: false, sloppyLastLevel: false },
		lodScreenSize: { levels: [0], cullBelow: 0.002 },
		tiers: withLods({ ultra: [0, 0], full: [0, 0], half: [0, 0], quarter: [0, 0] }),
	},
	viewmodel: {
		masterMaxTexture: 4096,
		lodGenerate: { tris: [20_000], targetError: 0.01, lockBorder: false, sloppyLastLevel: false },
		lodScreenSize: { levels: [0], cullBelow: 0 },
		tiers: withLods({ ultra: [0, 0], full: [0, 0], half: [0, 0], quarter: [0, 0] }),
	},
	anim: {
		masterMaxTexture: 0,
		lodGenerate: { tris: [], targetError: 0, lockBorder: false, sloppyLastLevel: false },
		lodScreenSize: { levels: [], cullBelow: 0 },
		tiers: withLods({ ultra: [0, 0], full: [0, 0], half: [0, 0], quarter: [0, 0] }),
	},
} as const satisfies Record<ModelClass, ModelClassDefaults>;

/**
 * A map's side at a tier: `full` is the master clamped to full's cap; `half` and `quarter` are
 * full ÷ 2 and ÷ 4 (clamped to their caps); `ultra` is the master itself, clamped to ultra's cap.
 * So a 2048² prop master gives `ultra` = `full`, and no `@ultra` copy is written. `null` = dropped.
 */
export function modelMapSize(
	masterSide: number,
	tier: ModelTierId,
	map: ModelTieredMap,
	tiers: Readonly<Record<ModelTierId, ModelTierProfile>>,
): number | null {
	const cap = tiers[tier].maps[map];
	if (cap === 'drop') return null;
	const fullCap = tiers.full.maps[map];
	const full = fullCap === 'drop' ? masterSide : Math.min(masterSide, fullCap);
	const wanted = tier === 'ultra' ? masterSide : full * MODEL_TIER_TEXTURE_SCALE[tier];
	return Math.max(1, Math.min(cap, wanted));
}

/** Texture scale relative to `full` (`ultra` takes the master's own size instead). */
export const MODEL_TIER_TEXTURE_SCALE = {
	ultra: 1,
	full: 1,
	half: 0.5,
	quarter: 0.25,
} as const satisfies Record<ModelTierId, number>;

/** Scene budgets per tier (assets §5.2): what a whole scene on screen may cost. */
export interface ModelSceneBudget {
	tris: number;
	drawCalls: number;
	gpuTextureBytes: number;
	/** First-load 3D payload on the web, or the packaged total for a desktop build. */
	payloadBytes: number;
	packaged: boolean;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const MODEL_SCENE_BUDGETS = {
	ultra: {
		tris: 3_000_000,
		drawCalls: 500,
		gpuTextureBytes: 3 * GB,
		payloadBytes: 1536 * MB,
		packaged: true,
	},
	full: {
		tris: 1_000_000,
		drawCalls: 300,
		gpuTextureBytes: 1 * GB,
		payloadBytes: 500 * MB,
		packaged: true,
	},
	half: {
		tris: 300_000,
		drawCalls: 150,
		gpuTextureBytes: 256 * MB,
		payloadBytes: 40 * MB,
		packaged: false,
	},
	quarter: {
		tris: 150_000,
		drawCalls: 80,
		gpuTextureBytes: 64 * MB,
		payloadBytes: 15 * MB,
		packaged: false,
	},
} as const satisfies Record<ModelTierId, ModelSceneBudget>;
