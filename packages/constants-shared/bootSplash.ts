/**
 * The BOOT SPLASH contract — the two pre-canvas splash screens a game shows before
 * PixiJS, the asset load, or the runtime bundle exist.
 *
 * Two tiers, deliberately mirroring the spine storage roots they read from
 * (`resolveBundlePrefix` already falls back project → shared, so one code path
 * serves both):
 *
 *  - `engine` — the ENGINE mark (this replaced Stake's `stake-engine-loader.gif`).
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
}

/** One tier as the EXPORTER wrote it — paths relative to `deploy/` (= `assets/`). */
export interface BootSplashEntry {
	atlas: string;
	skeleton: string;
	scale: number;
	animation?: string;
	background: string;
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
	return {
		bundle,
		...(animation ? { animation } : {}),
		...(background ? { background } : {}),
	};
}
