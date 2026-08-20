/**
 * Mirror the two BOOT SPLASH spine bundles into the project's `deploy/_boot/` tree and
 * write the index the splash reads at frame 0.
 *
 * This is deliberately the SMALLEST possible exporter: it owns no copying logic of its
 * own, it just calls `exportSpineBundle` — the same helper `editorArtExport` and
 * `symbolExport` use — twice, at fixed stems. A boot logo is an ordinary spine bundle
 * that happens to be read early; giving it a private production path would be a second
 * way to ship a spine, and there is already exactly one.
 *
 * TWO THINGS THIS MUST NOT DO, both learned from the exporters next door:
 *
 *  1. **No `pageStore`.** `editorArtExport` dedups atlas pages into a sibling `_pages/`
 *     store and then PRUNES that store against its own written set. A boot page deduped
 *     in there would be deleted by the next art export. Per-bundle page copies (the
 *     `symbolExport` default) keep `_boot/` self-contained. It costs one duplicated
 *     texture; correctness is worth more than a boot logo's page.
 *  2. **Prune only `_boot/`.** Symmetrically, this must never touch `editor-art/` or
 *     `_pages/`.
 *
 * See `constants-shared/bootSplash` for the contract and why the mirror exists at all.
 */
import {
	BOOT_SPLASH_DEFAULT_BACKGROUND,
	BOOT_SPLASH_INDEX_FILE,
	BOOT_SPLASH_STEMS,
	BOOT_SPLASH_SUBTREE,
	type BootSplashEntry,
	type BootSplashIndex,
	type BootSplashRef,
	type BootSplashTier,
} from 'constants-shared/bootSplash';
import { resolveBootSplashRefs } from './bootSplash';
import { SUB, sharedSpinesPrefix } from './projectPaths';
import { deleteObjects, listAllKeys, putObjectText } from './r2';
import {
	exportSpineBundle,
	loadSharedSkeletonIndex,
	loadSkeletonIndex,
	type SkeletonIndexEntry,
} from './spine';

/**
 * Boot spines load at their AUTHORED size, not the editor's `EDITOR_SPINE_LOAD_SCALE`.
 * The splash fits the result to its own max width in CSS pixels, so a baked-in editor
 * scale would just be a constant this code has to divide back out.
 */
const BOOT_SPINE_SCALE = 1;

/** Export one tier, or `undefined` when it is unconfigured / unresolvable. */
async function exportTier(
	tier: BootSplashTier,
	ref: BootSplashRef | undefined,
	opts: {
		clientKey: string;
		projectKey: string;
		deployPrefix: string;
		skeletonIndex: SkeletonIndexEntry[];
	},
): Promise<{ entry: BootSplashEntry; written: string[] } | undefined> {
	if (!ref) return undefined;

	// The tier decides which ROOT the bundle name resolves against — that split is the
	// whole difference between "the engine's mark" and "this game's mark".
	const shared = tier === 'engine';
	const assetKey = shared
		? `${sharedSpinesPrefix(ref.bundle)}/`
		: `${SUB.spines(opts.clientKey, opts.projectKey)}/${ref.bundle}/`;

	const exported = await exportSpineBundle({
		clientKey: opts.clientKey,
		projectKey: opts.projectKey,
		assetKey,
		deployPrefix: opts.deployPrefix,
		subtree: BOOT_SPLASH_SUBTREE,
		stem: BOOT_SPLASH_STEMS[tier],
		skeletonIndex: opts.skeletonIndex,
		scale: BOOT_SPINE_SCALE,
		forceShared: shared,
	});
	if (!exported) {
		// A named-but-missing bundle is the interesting failure (renamed folder, wrong
		// tier, never uploaded), so say so — but do NOT throw: a broken splash must never
		// be able to block a publish or a game boot.
		console.warn(
			`[bootSplash] ${tier} mark '${ref.bundle}' did not resolve under ` +
				`${shared ? '_shared/spines/' : SUB.spines(opts.clientKey, opts.projectKey)} — ` +
				'shipping without it.',
		);
		return undefined;
	}

	return {
		entry: {
			atlas: exported.entry.atlas,
			skeleton: exported.entry.skeleton,
			scale: exported.entry.scale,
			...(ref.animation ? { animation: ref.animation } : {}),
			...(ref.size !== undefined ? { size: ref.size } : {}),
			background: ref.background ?? BOOT_SPLASH_DEFAULT_BACKGROUND[tier],
		},
		written: exported.written,
	};
}

/**
 * Refresh `deploy/_boot/` for one project and return the index that was written.
 *
 * Always writes `boot.json`, even when BOTH tiers are unset: the splash treats a 404 and
 * an empty index identically, but an empty index that overwrites a stale one is how a
 * REMOVED logo actually disappears from a published game.
 */
export async function exportBootSplashes(
	clientKey: string,
	projectKey: string,
): Promise<BootSplashIndex> {
	const deployPrefix = `${SUB.deploy(clientKey, projectKey)}/`;
	const bootPrefix = `${deployPrefix}${BOOT_SPLASH_SUBTREE}/`;

	const refs = await resolveBootSplashRefs(clientKey, projectKey);

	// Skeleton indexes. `loadSkeletonIndex` reads the SHARED index only when the project has
	// none of its own, which is too weak for both tiers here:
	//   - the ENGINE tier must read the shared index outright (its bundle is shared by
	//     definition, and the project usually does have an index that omits it);
	//   - the GAME tier resolves project-then-shared for the FILES (`resolveBundlePrefix`), so
	//     its index lookup has to span both or a project pointed at a shared bundle would fail
	//     to find an entry and silently ship no splash.
	// Concatenating project-first keeps the project's entry winning a name collision, matching
	// how the file resolution breaks the same tie.
	const needIndex = !!refs.engine || !!refs.game;
	const [projectIndex, sharedIndex] = await Promise.all([
		refs.game ? loadSkeletonIndex(clientKey, projectKey) : Promise.resolve([]),
		needIndex ? loadSharedSkeletonIndex() : Promise.resolve([]),
	]);

	const [engine, game] = await Promise.all([
		exportTier('engine', refs.engine, {
			clientKey,
			projectKey,
			deployPrefix,
			skeletonIndex: sharedIndex,
		}),
		exportTier('game', refs.game, {
			clientKey,
			projectKey,
			deployPrefix,
			skeletonIndex: [...projectIndex, ...sharedIndex],
		}),
	]);

	const index: BootSplashIndex = {
		...(engine ? { engine: engine.entry } : {}),
		...(game ? { game: game.entry } : {}),
	};

	const indexKey = `${deployPrefix}${BOOT_SPLASH_INDEX_FILE}`;
	await putObjectText(indexKey, JSON.stringify(index, null, '\t'), 'application/json');

	// Prune `_boot/` leftovers — a re-pointed or cleared tier must not leave its old art
	// behind. Scoped to this subtree; the neighbouring exporters own theirs.
	const written = new Set([indexKey, ...(engine?.written ?? []), ...(game?.written ?? [])]);
	const stale = (await listAllKeys(bootPrefix)).filter((k) => !written.has(k));
	await deleteObjects(stale);

	return index;
}
