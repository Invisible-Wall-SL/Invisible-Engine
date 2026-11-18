import {
	MODEL_FALLBACK_TIER,
	MODEL_SCENE_BUDGETS,
	MODEL_TIERS,
	isModelTierId,
	type ModelSceneBudget,
	type ModelTierId,
} from 'constants-shared/modelTiers';

/**
 * Which 3D tier a boot loads, and what the renderer may spend at it (`docs/design/3d/runtime-
 * evaluation.md` §5.1, §5.3). The asset tier is decided ONCE at boot (another tier is another
 * download); the caps start at the tier's column and only the dynamic-resolution controller (T3)
 * moves them later. Pure: the browser signals are read by `device.ts`, and Node pins every rule in
 * `scripts/check-engine-3d.mjs`.
 *
 * Precedence: the build's pin (`IE_ART_TIER`) beats `?tier=`, which beats the player's Graphics
 * setting, which beats auto. Auto never picks `full` or `ultra`: their first load is a packaged
 * size, so they are the player's choice or a build's pin.
 */

/** The Graphics setting a player keeps (`auto` = let the device decide). */
export type GraphicsSetting3d = 'auto' | 'low' | 'medium' | 'high' | 'ultra';

export const GRAPHICS_SETTING_TIER: Readonly<
	Record<Exclude<GraphicsSetting3d, 'auto'>, ModelTierId>
> = Object.freeze({ low: 'quarter', medium: 'half', high: 'full', ultra: 'ultra' });

/** What the browser says about the GPU, read once at boot (`device.ts` `readGpu3d`). */
export type Gpu3d = {
	/** WEBGL_compressed_texture_astc. */
	astc: boolean;
	/** EXT_texture_compression_bptc (BC7). */
	bc7: boolean;
	/** WEBGL_compressed_texture_s3tc (BC1–3). */
	s3tc: boolean;
	/** WEBGL_compressed_texture_etc (ETC2). */
	etc2: boolean;
	maxTextureSize: number;
	/** The unmasked renderer string, when the browser gives one. */
	renderer?: string;
};

export type TierInput3d = {
	/** The build's pin (`__IE_MODEL_TIER__`), `''` / absent when unpinned. */
	pin?: string | null;
	/** `?tier=`. Anything but a tier id is ignored. */
	forced?: string | null;
	/** The player's Graphics setting. */
	setting?: string | null;
	/** `pixi-svelte` `deviceClass()`. */
	deviceClass: 'phone' | 'desktop';
	gpu: Gpu3d;
	/** The tiers the served build has files for (`full` always). */
	published: readonly ModelTierId[];
};

export type TierWhy3d =
	| 'pin'
	| 'forced'
	| 'setting'
	| 'auto-phone'
	| 'auto-desktop'
	| 'auto-no-compressed-textures'
	| 'auto-small-gpu'
	| 'auto-software-renderer';

export type TierChoice3d = {
	tier: ModelTierId;
	why: TierWhy3d;
	/** The Graphics options this device may offer (`High` / `Ultra` are gated). */
	offered: GraphicsSetting3d[];
};

/** Renderer names that mean no GPU: a blocklist only, never an allowlist (§5.1 point 3). */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|microsoft basic render/i;

export const isSoftwareRenderer = (renderer: string | undefined): boolean =>
	!!renderer && SOFTWARE_RENDERER.test(renderer);

/** Any block-compressed format the KTX2 transcoder can target; without one Basis decodes to RGBA32. */
const hasCompressedTextures = (gpu: Gpu3d): boolean => gpu.astc || gpu.bc7 || gpu.s3tc || gpu.etc2;

/** The smallest texture limit a tier above `quarter` may run on. */
export const MIN_TEXTURE_SIZE_ABOVE_QUARTER = 2048;
/** The texture limit the `ultra` gate asks for. */
export const MIN_TEXTURE_SIZE_ULTRA = 8192;

const rank = (tier: ModelTierId) => MODEL_TIERS.indexOf(tier);

/** One step down in quality (`quarter` stays). */
const lower = (tier: ModelTierId): ModelTierId =>
	MODEL_TIERS[Math.min(rank(tier) + 1, MODEL_TIERS.length - 1)];

/**
 * The tier a player's choice or `?tier=` loads among the tiers the build has: the wanted tier, else
 * the nearest published tier ABOVE it in quality (they asked for at least that much). `full` is
 * always published.
 */
export function publishedAtOrAbove(
	wanted: ModelTierId,
	published: readonly ModelTierId[],
): ModelTierId {
	for (let i = rank(wanted); i >= 0; i--)
		if (published.includes(MODEL_TIERS[i])) return MODEL_TIERS[i];
	return MODEL_FALLBACK_TIER;
}

/** The tiers auto may load on the web: never `full` or `ultra` (§5.1 rule 1). */
const WEB_TIERS: readonly ModelTierId[] = ['half', 'quarter'];

/**
 * The tier auto loads among the tiers the build has: the wanted web tier, else the nearest other
 * web tier the build published (above first), and `full` only when the build has no web tier at
 * all. A missing `quarter` must not fall to the unsuffixed `full` files when `half` exists, nor a
 * missing `half` to `full` when `quarter` does (`docs/design/3d/runtime-evaluation.md` §5.1 ⚠).
 */
export function publishedForAuto(
	wanted: ModelTierId,
	published: readonly ModelTierId[],
): ModelTierId {
	const web = WEB_TIERS.filter((t) => published.includes(t));
	if (!web.length) return MODEL_FALLBACK_TIER;
	const above = web.filter((t) => rank(t) <= rank(wanted));
	return above.length ? above[above.length - 1] : web[0];
}

/**
 * The tiers a build has model files for, from the bundle's models index (`constants-shared`
 * `ModelExportIndex`, `RuntimeBundle.models`): `full` always, plus every tier any model has its own
 * copy of. A model leaves out a tier whose copy would equal `full` byte for byte, and the loader
 * reads `tiers[chosen] ?? tiers.full`, so a tier no model has is one this build cannot load more
 * cheaply than `full`. A build with no models (no index, or none in it) loads nothing a tier
 * changes, so every tier counts and only the caps differ.
 */
export function publishedTiersOf(index: unknown): ModelTierId[] {
	const models =
		index && typeof index === 'object' ? (index as { models?: unknown }).models : undefined;
	if (!Array.isArray(models) || models.length === 0) return [...MODEL_TIERS];
	const seen = new Set<ModelTierId>([MODEL_FALLBACK_TIER]);
	for (const model of models) {
		const tiers =
			model && typeof model === 'object' ? (model as { tiers?: unknown }).tiers : undefined;
		if (tiers && typeof tiers === 'object')
			for (const id of Object.keys(tiers)) if (isModelTierId(id)) seen.add(id);
	}
	return MODEL_TIERS.filter((id) => seen.has(id));
}

/** The `ultra` gate (§5.1 point 6), without the frame-time probe (T7): a desktop with BC7 or ASTC,
 *  ≥ 8192 textures and a hardware renderer. */
export const passesUltraGate = (input: Pick<TierInput3d, 'deviceClass' | 'gpu'>): boolean =>
	input.deviceClass === 'desktop' &&
	(input.gpu.bc7 || input.gpu.astc) &&
	input.gpu.maxTextureSize >= MIN_TEXTURE_SIZE_ULTRA &&
	!isSoftwareRenderer(input.gpu.renderer);

/** What auto picks, and why: the device class, then each check that only ever lowers it. */
export function autoTier3d(input: Pick<TierInput3d, 'deviceClass' | 'gpu'>): {
	tier: ModelTierId;
	why: TierWhy3d;
} {
	const { gpu } = input;
	if (isSoftwareRenderer(gpu.renderer)) return { tier: 'quarter', why: 'auto-software-renderer' };
	if (gpu.maxTextureSize < MIN_TEXTURE_SIZE_ABOVE_QUARTER)
		return { tier: 'quarter', why: 'auto-small-gpu' };
	const base: ModelTierId = input.deviceClass === 'phone' ? 'quarter' : 'half';
	if (!hasCompressedTextures(gpu)) return { tier: lower(base), why: 'auto-no-compressed-textures' };
	return { tier: base, why: input.deviceClass === 'phone' ? 'auto-phone' : 'auto-desktop' };
}

/** The Graphics options this device and build may offer. */
export function offeredSettings(
	input: Omit<TierInput3d, 'pin' | 'forced' | 'setting'>,
): GraphicsSetting3d[] {
	const out: GraphicsSetting3d[] = ['auto', 'low', 'medium'];
	if (input.deviceClass === 'desktop') out.push('high');
	if (input.published.includes('ultra') && passesUltraGate(input)) out.push('ultra');
	return out;
}

/** The tier this boot loads. */
export function chooseTier3d(input: TierInput3d): TierChoice3d {
	const offered = offeredSettings(input);
	const pin = input.pin?.trim();
	if (pin && isModelTierId(pin)) return { tier: pin, why: 'pin', offered: [] };
	if (isModelTierId(input.forced))
		return { tier: publishedAtOrAbove(input.forced, input.published), why: 'forced', offered };
	const setting = input.setting as GraphicsSetting3d | null | undefined;
	if (setting && setting !== 'auto' && offered.includes(setting))
		return {
			tier: publishedAtOrAbove(GRAPHICS_SETTING_TIER[setting], input.published),
			why: 'setting',
			offered,
		};
	const auto = autoTier3d(input);
	return { tier: publishedForAuto(auto.tier, input.published), why: auto.why, offered };
}

/** What the renderer may spend at a tier (§5.3). */
export type Caps3d = {
	/** The 3D canvas's pixel-ratio cap; `Infinity` = the device's own. */
	maxPixelRatio: number;
	/** MSAA on the 3D canvas (a context attribute: fixed at mount). */
	antialias: boolean;
	/** `map`: a shadow map of `shadowMapSize`²; `blob`: a decal under each body, no shadow map. */
	shadows: 'map' | 'blob';
	shadowMapSize: number;
	/** Who casts into the shadow map. */
	shadowCasters: 'heroes' | 'heroes-props' | 'all';
	/** Post-processing: a lazy chunk only these tiers load (T3/T7). */
	post: 'none' | 'outline-bloom-smaa' | 'full-plus-ao-dof';
	/** Multiplies every LOD screen-size threshold (T2). */
	lodBias: number;
	/** Share of the level drawn (fog / far plane). */
	drawDistance: number;
	anisotropy: number;
	budget: ModelSceneBudget;
};

export const CAPS_3D: Readonly<Record<ModelTierId, Readonly<Caps3d>>> = Object.freeze({
	ultra: {
		maxPixelRatio: Infinity,
		antialias: true,
		shadows: 'map',
		shadowMapSize: 4096,
		shadowCasters: 'all',
		post: 'full-plus-ao-dof',
		lodBias: 0.8,
		drawDistance: 1,
		anisotropy: 16,
		budget: MODEL_SCENE_BUDGETS.ultra,
	},
	full: {
		maxPixelRatio: Infinity,
		antialias: true,
		shadows: 'map',
		shadowMapSize: 2048,
		shadowCasters: 'heroes-props',
		post: 'outline-bloom-smaa',
		lodBias: 1,
		drawDistance: 1,
		anisotropy: 8,
		budget: MODEL_SCENE_BUDGETS.full,
	},
	half: {
		maxPixelRatio: 1.5,
		antialias: true,
		shadows: 'map',
		shadowMapSize: 1024,
		shadowCasters: 'heroes',
		post: 'none',
		lodBias: 1.25,
		drawDistance: 0.85,
		anisotropy: 4,
		budget: MODEL_SCENE_BUDGETS.half,
	},
	quarter: {
		maxPixelRatio: 1,
		antialias: false,
		shadows: 'blob',
		shadowMapSize: 0,
		shadowCasters: 'heroes',
		post: 'none',
		lodBias: 1.5,
		drawDistance: 0.7,
		anisotropy: 1,
		budget: MODEL_SCENE_BUDGETS.quarter,
	},
});
