/**
 * The BOOT SPLASH contract — the two pre-canvas splash screens a game shows before
 * PixiJS, the asset load, or the runtime bundle exist.
 *
 * Two tiers, deliberately mirroring the spine storage roots they read from
 * (`resolveBundlePrefix` already falls back project → shared, so one code path
 * serves both):
 *
 *  - `engine` — the ENGINE mark (this replaced the old vendor `stake-engine-loader.gif`).
 *    GLOBAL: one bundle for every game, held in `_shared/spines/<bundle>` and named
 *    by the admin-only `app_settings` key. A client cannot change it.
 *  - `game` — the GAME's own mark (this replaced the "Add Your Loader" placeholder).
 *    PER-PROJECT: `<client>/<project>/spines/<bundle>`, named by `GameSettings.bootLoader`
 *    and authored in the Scene Editor's Game Settings panel.
 *
 * WHY a `deploy/_boot/` mirror instead of the runtime bundle: the splash paints at
 * frame 0, long before `/api/editor/runtime` resolves, so it cannot be told where its
 * own art lives. The exporter therefore mirrors both bundles to FIXED paths under
 * `deploy/_boot/` and writes {@link BOOT_SPLASH_INDEX_FILE} beside them. A published
 * game's `assetBase` defaults to the relative `assets/`, so the splash resolves all of
 * it same-origin with no token and no bundle fetch. Nothing here blocks boot: a missing
 * or slow index just leaves the solid background up.
 *
 * See `docs/design/live-assets.md` and `apps/launcher-api/src/lib/server/bootSplashExport.ts`.
 */

/** Subtree under `deploy/` holding both mirrored splash bundles. */
export const BOOT_SPLASH_SUBTREE = '_boot';

/** Folder stem under {@link BOOT_SPLASH_SUBTREE} for each tier. Fixed, not authored —
 * the splash hard-codes these paths because it has no index to look them up in yet. */
export const BOOT_SPLASH_STEMS = { engine: 'engine', game: 'game' } as const;

export type BootSplashTier = keyof typeof BOOT_SPLASH_STEMS;

/** The index the splash fetches first, relative to `assets/`. */
export const BOOT_SPLASH_INDEX_FILE = `${BOOT_SPLASH_SUBTREE}/boot.json`;

/**
 * Fallback background for a tier whose ref sets no `background`. Painted IMMEDIATELY —
 * before the spine loads — so boot shows brand colour rather than a white flash. The
 * engine default is the Invisible Wall ink; the game default is black (what
 * `LoaderExample` used), so an unconfigured project looks exactly as it does today.
 */
export const BOOT_SPLASH_DEFAULT_BACKGROUND: Record<BootSplashTier, string> = {
	engine: '#0b0f14',
	game: '#000000',
};

/**
 * Author-set SIZE multiplier applied on top of the automatic fit (see `LoaderSpine`). `1` is the
 * fit itself — the mark scaled to sit inside a conservative safe box — so this is "a bit bigger /
 * a bit smaller than that", not an absolute size. Kept relative rather than absolute so one value
 * holds across every screen the game runs on.
 *
 * Clamped: below the floor the mark is invisible and reads as a broken splash, and far above the
 * ceiling it is cropped by the viewport with no way to tell from the control that that happened.
 * Values above 1 CAN exceed the safe box — that is the author's call, which is the point of the
 * knob, but it is why the ceiling is not larger.
 */
export const BOOT_SPLASH_DEFAULT_SIZE = 1;
export const BOOT_SPLASH_MIN_SIZE = 0.1;
export const BOOT_SPLASH_MAX_SIZE = 3;

/** Coerce an author-set size into the clamped range, or `undefined` when unset/unusable
 * (⇒ {@link BOOT_SPLASH_DEFAULT_SIZE}). */
export function normalizeBootSplashSize(input: unknown): number | undefined {
	const n = typeof input === 'number' ? input : Number(input);
	if (!Number.isFinite(n) || n <= 0) return undefined;
	return Math.min(Math.max(n, BOOT_SPLASH_MIN_SIZE), BOOT_SPLASH_MAX_SIZE);
}

/**
 * How long a tier's splash stays up once its spine is ready, in ms. Matches the
 * 2000ms `FINISH_ONCE_TIMEOUT` the gif loaders used, so the boot rhythm is unchanged.
 */
export const BOOT_SPLASH_HOLD_MS = 2000;

/**
 * What an author PICKS for one tier: a spine bundle name (NOT a full R2 key — the
 * exporter resolves it against the tier's root) plus the animation to play.
 *
 * `animation` is optional but strongly recommended: a spine left on its setup pose with
 * no animation renders EMPTY, which reads as a broken splash rather than an unset one
 * (the same trap the Borut loader logo hit — see `project_generic_loading_screen`). When
 * absent the splash falls back to the skeleton's first animation rather than showing
 * nothing.
 */
export interface BootSplashRef {
	bundle: string;
	animation?: string;
	/** CSS colour painted behind the spine, and during the load before it appears. */
	background?: string;
	/** Multiplier on the automatic fit — see {@link BOOT_SPLASH_DEFAULT_SIZE}. Absent ⇒ `1`. */
	size?: number;
}

/** One tier as the EXPORTER wrote it — paths relative to `deploy/` (= `assets/`). */
export interface BootSplashEntry {
	atlas: string;
	skeleton: string;
	/** Spine PARSER load scale (skeleton units). Distinct from `size`, which is a display
	 * multiplier applied after the fit — the fit normalizes parser scale away, so a size knob
	 * could not be expressed through this one. */
	scale: number;
	animation?: string;
	background: string;
	/** Author's size multiplier on the fit. Absent ⇒ {@link BOOT_SPLASH_DEFAULT_SIZE}. */
	size?: number;
}

/** `deploy/_boot/boot.json`. A tier is absent when unconfigured or unresolvable. */
export interface BootSplashIndex {
	engine?: BootSplashEntry;
	game?: BootSplashEntry;
}

/** Bundle names are R2 path segments; keep this in step with `assertBundle` in the
 * launcher's `projectPaths.ts` (nested folders allowed, no parent escapes). */
const BUNDLE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}(\/[A-Za-z0-9][A-Za-z0-9_-]{0,63})*$/;

/**
 * Coerce stored/posted input into a {@link BootSplashRef}, or `undefined` when it can't
 * name a bundle. Returning `undefined` — never a blank ref — is what lets "unset" mean
 * *skip this tier* rather than *export an empty splash*, mirroring
 * `normalizeGameConfigDoc`'s no-doc contract.
 */
export function normalizeBootSplashRef(input: unknown): BootSplashRef | undefined {
	if (!input || typeof input !== 'object') return undefined;
	const raw = input as Record<string, unknown>;
	const bundle = typeof raw.bundle === 'string' ? raw.bundle.trim() : '';
	if (!bundle || !BUNDLE_RE.test(bundle)) return undefined;
	const animation = typeof raw.animation === 'string' ? raw.animation.trim() : '';
	const background = typeof raw.background === 'string' ? raw.background.trim() : '';
	const size = normalizeBootSplashSize(raw.size);
	return {
		bundle,
		...(animation ? { animation } : {}),
		...(background ? { background } : {}),
		// Omit the default so an untouched ref stays byte-identical to one saved before the knob
		// existed — "unset" and "set to 1" must not be two different stored shapes.
		...(size !== undefined && size !== BOOT_SPLASH_DEFAULT_SIZE ? { size } : {}),
	};
}
