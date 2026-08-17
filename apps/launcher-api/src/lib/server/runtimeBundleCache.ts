/**
 * Single-flight + short-TTL cache in front of {@link buildRuntimeBundle} — the read path
 * every published game boots through (`GET /api/editor/runtime`).
 *
 * WHY THIS EXISTS. `buildRuntimeBundle` re-runs the WHOLE export pipeline on every call
 * (`ensureDeployExports` + `exportEffects` + `exportRigFx` — seven exporters that list,
 * re-serialize and WRITE back to R2). A single assemble measured **17-19s** in production
 * for `bookofborutremake`. That is at the edge of the gateway's patience, so the endpoint
 * intermittently 502s — and the game's `prepareRuntimeBundle` treats ANY failure as
 * "fall back to the stale baked doc", silently. Net effect: an author saves an edit, the
 * game boots, the fetch loses the race, and the game renders a PRE-EDIT snapshot while
 * looking perfectly healthy. That cost a full debugging session (a duplicated FX node that
 * "never published" — it had published fine; the game was never reading the live doc).
 *
 * WHAT THIS FIXES. Two failure modes, both caused by the cost being paid per-request:
 *
 *  1. **Boot storms.** N concurrent boots (a reload, a second tab, a retry) each started
 *     their OWN 17s export run, N× the memory and N× the R2 writes — the likeliest trigger
 *     of the launcher's known OOM. Now they join ONE in-flight assemble.
 *  2. **Retries were useless.** A retry after a 502 used to start yet another cold 17s run
 *     and lose the same race. Now it joins the in-flight assemble and returns as soon as the
 *     ORIGINAL run lands. This is what makes the game-side retry actually work.
 *
 * SINGLE-FLIGHT IS THE PRIMARY MECHANISM; the TTL is a minor extra. Freshness is measured
 * from when the assemble READ its data, not from when it finished (see {@link CacheEntry}),
 * so a 17-19s assemble is already older than {@link TTL_MS} the moment it lands and is
 * served to its own awaiters and then never again. That is intended: for a slow project
 * every fresh boot re-assembles, and what stops the pile-up is the single-flight join, not
 * the cache. Only genuinely fast projects ever see a cache HIT.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not fingerprint the sources to cache longer.
 * The bundle's inputs live in three unrelated R2 trees — `<client>/<project>/` (art, fonts,
 * symbols, effects), `editor/<projectKey>/components/`, and `_shared/editor-components/`
 * (see `projectPaths.ts`) — and a fingerprint that misses any one of them yields a false
 * cache HIT: the editor saves, the game serves an old bundle. That is the SAME
 * stale-data-that-looks-fine bug this module exists to kill, only harder to see.
 *
 * SCOPE: per-process. If the launcher ever runs more than one replica, a publish only
 * invalidates the instance that served it; the others self-correct within {@link TTL_MS}.
 *
 * THE REAL FIX is to stop exporting on the read path entirely (exports belong on save /
 * publish — `publishGame.ts` already calls `ensureDeployExports`). That needs every
 * authoring tool to reliably export on save, which needs auditing first. The per-step
 * timings `buildRuntimeBundle` now logs are the data for that work.
 */
import { buildRuntimeBundle, type RuntimeBundle } from './runtimeBundle';

/**
 * How long a bundle may be served, measured from when its data was READ.
 *
 * Must stay well UNDER a human edit→reload cycle: an author who saves in the editor and
 * flips to the game tab takes seconds, and must never be served a pre-edit bundle. Do NOT
 * raise this without a real source fingerprint — see the module comment.
 */
const TTL_MS = 10_000;

/**
 * Cap on retained projects. The bundle is small (~85KB for `bookofborutremake`), but the
 * launcher is memory-tight (it already OOMs mid-bake), so this stays bounded rather than
 * growing one entry per project ever booted.
 */
const MAX_ENTRIES = 8;

interface CacheEntry {
	bundle: RuntimeBundle;
	/**
	 * When the assemble STARTED — i.e. how old the DATA is, not when the work finished.
	 *
	 * This distinction is the whole point. Stamping completion time would let a 19s assemble
	 * serve data read 19s ago for a further {@link TTL_MS}, i.e. ~29s stale — so an author
	 * who saved 5s into that assemble would keep getting their pre-edit bundle long after
	 * "reload and it'll be fresh" should have been true. Freshness is a property of the READ.
	 */
	readAt: number;
}

const cache = new Map<string, CacheEntry>();
/** In-flight assembles, keyed by project — the single-flight join point. */
const inflight = new Map<string, Promise<RuntimeBundle>>();
/**
 * Per-project invalidation counter. An assemble captures this when it starts and only
 * populates the cache if it still matches on completion — so an assemble that was already
 * reading pre-publish data when Publish landed cannot repopulate the cache with it. Without
 * this, `invalidateRuntimeBundle` is defeated by the exact race it exists to prevent:
 * `publishGame` runs seconds of exports immediately before invalidating, which is precisely
 * the window in which a boot starts the assemble that would clobber it.
 */
const epochs = new Map<string, number>();

const epochOf = (projectKey: string): number => epochs.get(projectKey) ?? 0;

/** Evict the least-recently-stored entries once over budget. */
function trim(): void {
	while (cache.size > MAX_ENTRIES) {
		const oldest = cache.keys().next();
		if (oldest.done) break;
		cache.delete(oldest.value);
	}
}

/**
 * Assemble a project's runtime bundle, collapsing concurrent callers onto one run and
 * reusing a result while its data is younger than {@link TTL_MS}.
 *
 * The assemble is owned by this module, not by the request that triggered it: a client that
 * has already given up (or been 502'd by the gateway) leaves the run going, so its retry
 * JOINS that same run rather than starting another cold one. That join — not the cache — is
 * what makes the game-side retry cheap, since a slow project's result is already older than
 * the TTL by the time it lands.
 */
export async function getRuntimeBundle(
	projectKey: string,
	includeUnreviewed = false,
): Promise<RuntimeBundle> {
	// Authoring boots see unreviewed translations, players do not — so the two variants
	// must never share a cache entry, or whichever assembled first leaks into the other.
	const cacheKey = includeUnreviewed ? `${projectKey}::authoring` : projectKey;
	const hit = cache.get(cacheKey);
	if (hit && Date.now() - hit.readAt < TTL_MS) {
		console.info(
			`[runtime] bundle cache HIT for "${projectKey}" (data ${Date.now() - hit.readAt}ms old)`,
		);
		return hit.bundle;
	}

	const pending = inflight.get(cacheKey);
	if (pending) {
		console.info(`[runtime] joining in-flight bundle assemble for "${projectKey}"`);
		return pending;
	}

	const readAt = Date.now();
	const epoch = epochOf(projectKey);
	const run = (async () => {
		try {
			const bundle = await buildRuntimeBundle(projectKey, includeUnreviewed);
			// A publish that landed mid-assemble bumped the epoch: this bundle was read BEFORE it,
			// so serve it to the callers already waiting but never cache it for anyone else.
			if (epochOf(projectKey) === epoch) {
				cache.set(cacheKey, { bundle, readAt });
				trim();
			} else {
				console.info(`[runtime] discarding pre-invalidation assemble for "${projectKey}"`);
			}
			return bundle;
		} finally {
			// `buildRuntimeBundle` is async, so the IIFE always suspends at the `await` above and
			// this runs after `inflight.set` below — a rejected assemble can never wedge the map.
			inflight.delete(cacheKey);
			console.info(`[runtime] bundle assemble for "${projectKey}" took ${Date.now() - readAt}ms`);
		}
	})();
	inflight.set(cacheKey, run);
	return run;
}

/**
 * Drop a project's cached bundle. Called by Publish so the next boot re-assembles instead of
 * serving data read before the publish landed.
 *
 * An assemble already in flight is deliberately left to finish and serve the callers waiting
 * on it (they asked before the publish); the epoch bump just stops its result being cached.
 */
export function invalidateRuntimeBundle(projectKey: string): void {
	epochs.set(projectKey, epochOf(projectKey) + 1);
	cache.delete(projectKey);
	// The authoring variant is a SEPARATE entry (unreviewed translations included);
	// dropping only the player one would leave authors staring at pre-save strings.
	cache.delete(`${projectKey}::authoring`);
}
