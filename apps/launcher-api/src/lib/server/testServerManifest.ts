/**
 * Shared read-modify-write of the Invisible Test Server's game manifest
 * (`test_server/games.json`) in R2. Both the server-side Publish action
 * (`publishGame.ts`) and the standalone `scripts/publish-game-bundle.mjs` use the
 * SAME canonical shape + merge logic so the two never diverge:
 *
 *   { "games": { "<key>": { "protocol": "lines"|"book", "name": str,
 *                           "runtime"?: str, "updatedAt": iso } } }
 *
 * The optional `runtime` field tells the test server to serve the shared prebuilt
 * bundle at `test_server/_runtime/<runtime>/` instead of per-key files; the mock
 * RGS is still selected per-key by `protocol`. The merge is non-destructive: it
 * preserves every OTHER game's entry (a clobbering write once dropped games).
 */
import { getObjectText, headObject, putObjectText } from './r2';

export const TEST_SERVER_MANIFEST_KEY = 'test_server/games.json';

/**
 * Epoch-ms when a generic runtime bundle was last published to R2 — read from the
 * `last-modified` of `test_server/_runtime/<id>/index.html`, which a Runtime release
 * (`publish-runtime-bundle.mjs`) re-uploads every time the engine ships. Returns
 * `null` when the bundle isn't present (nothing to compare against).
 *
 * This is the ENGINE-version signal the Game Maker compares against a game's last
 * publish (`updatedAt`, below) to flag a game whose RUNNING engine is behind the
 * current one — so an author republishes (which re-hydrates the test server) instead
 * of chasing a "my change isn't showing" ghost. It reuses an existing R2 signal on
 * purpose: no new stamp file, and it updates automatically on every runtime release.
 */
export async function runtimeBundleReleasedAt(runtimeId: string): Promise<number | null> {
	const head = await headObject(`test_server/_runtime/${runtimeId}/index.html`);
	return head && head.lastModified > 0 ? head.lastModified : null;
}

/**
 * The advisory release stamp `publish-runtime-bundle.mjs` writes next to a runtime bundle
 * (`test_server/_runtime/<id>/release.json`). It records which engine commit the LIVE shared
 * bundle was built from + when, and whether a release is currently building — the bundle-vs-source
 * axis (distinct from the per-game `engineStale` axis, which compares a game's publish time to the
 * bundle's). `status: 'building'` is written up-front, then overwritten with `'released'` after the
 * upload lands. Older bundles predate the stamp, so callers fall back to `runtimeBundleReleasedAt`.
 */
export interface RuntimeRelease {
	runtimeId: string;
	commit: string;
	shortCommit: string;
	builtAt: string;
	status: 'released' | 'building';
}

/** Read + parse `release.json` for a runtime. Returns null when absent or unparseable. */
export async function runtimeRelease(runtimeId: string): Promise<RuntimeRelease | null> {
	const raw = await getObjectText(`test_server/_runtime/${runtimeId}/release.json`);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as RuntimeRelease;
	} catch {
		return null;
	}
}

/** Time-boxed window for a `building` stamp to still count as an active release (ms). */
const BUILDING_STALE_MS = 30 * 60 * 1000;

export interface EngineDeployStatus {
	status: 'building' | 'deployed' | 'unknown';
	commit?: string;
	shortCommit?: string;
	builtAt?: string;
	/**
	 * C2 (bundle-vs-source): set by the `(app)` layout load from `engineSource.ts#enginePending`
	 * when a read token is configured. `pending === true` ⇒ engine `main` has un-released ENGINE
	 * changes ahead of the deployed bundle; `false` ⇒ a compare ran and it's up to date; `undefined`
	 * ⇒ no compare ran (feature off / degraded) — the UI must treat that as "don't imply anything".
	 */
	pending?: boolean;
	aheadBy?: number;
	mainCommit?: string;
}

/**
 * Derive the launcher's engine-deploy indicator for a runtime from its release stamp, with a
 * graceful fallback for bundles published before stamping existed:
 * - `building` stamp within the last 30 min → 'building' (a release is in flight). An OLDER
 *   `building` stamp is treated as stale/unknown: a crashed/superseded release could otherwise
 *   wedge the pill on "building" forever (per the concurrency note — releases don't cancel-in-progress).
 * - `released` stamp → 'deployed' with its commit + builtAt.
 * - no stamp but the bundle exists (`runtimeBundleReleasedAt`) → 'deployed', builtAt from the mtime.
 * - otherwise → 'unknown'.
 */
export async function engineDeployStatus(runtimeId: string): Promise<EngineDeployStatus> {
	const release = await runtimeRelease(runtimeId);
	if (release) {
		if (release.status === 'building') {
			const startedAt = Date.parse(release.builtAt);
			const fresh = Number.isFinite(startedAt) && Date.now() - startedAt < BUILDING_STALE_MS;
			if (fresh) {
				return {
					status: 'building',
					commit: release.commit,
					shortCommit: release.shortCommit,
					builtAt: release.builtAt,
				};
			}
			// A stale 'building' stamp: fall through to the mtime fallback below.
		} else if (release.status === 'released') {
			return {
				status: 'deployed',
				commit: release.commit,
				shortCommit: release.shortCommit,
				builtAt: release.builtAt,
			};
		}
	}

	// No usable stamp — an older bundle. The bundle's own mtime still proves it's deployed.
	const releasedAt = await runtimeBundleReleasedAt(runtimeId);
	if (releasedAt) return { status: 'deployed', builtAt: new Date(releasedAt).toISOString() };

	// The bundle-vs-source "release pending" axis (C2) lives in `engineSource.ts#enginePending` and
	// is merged in by the `(app)` layout load — kept OUT of here so this helper stays R2-only.
	return { status: 'unknown' };
}

export type MockProtocol = 'lines' | 'book';

export interface TestServerGameEntry {
	protocol: MockProtocol;
	name: string;
	/** Shared prebuilt-bundle id under `test_server/_runtime/<runtime>/` (Game Maker). */
	runtime?: string;
	/** ISO timestamp — passed IN by the caller (no `Date.now()` here). */
	updatedAt: string;
}

export interface TestServerManifest {
	games: Record<string, TestServerGameEntry>;
}

/** Read the manifest (or an empty one when absent / malformed). */
export async function loadTestServerManifest(): Promise<TestServerManifest> {
	const raw = await getObjectText(TEST_SERVER_MANIFEST_KEY);
	if (!raw) return { games: {} };
	try {
		const parsed = JSON.parse(raw) as Partial<TestServerManifest>;
		return { games: parsed.games ?? {} };
	} catch {
		return { games: {} };
	}
}

/**
 * Merge ONE game entry into the manifest (read-modify-write) and persist it,
 * preserving every other game. Returns the written manifest.
 */
export async function upsertTestServerGame(
	key: string,
	entry: TestServerGameEntry,
): Promise<TestServerManifest> {
	const manifest = await loadTestServerManifest();
	manifest.games[key] = entry;
	await putObjectText(
		TEST_SERVER_MANIFEST_KEY,
		JSON.stringify(manifest, null, 2),
		'application/json; charset=utf-8',
	);
	return manifest;
}
