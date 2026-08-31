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
 *
 * CONCURRENCY (Phase 0 of `docs/design/multi-user-concurrency.md`): this manifest is
 * a single GLOBAL key that two users publishing DIFFERENT games on DIFFERENT projects
 * both read-modify-write, so an unguarded PUT silently dropped the loser's entry — a
 * race a project lease can never catch. Unlike the rigger index (moved to Postgres),
 * this stays an R2 blob on purpose: a SEPARATE service (`services/test-server`) reads
 * it directly from R2, and the standalone `scripts/publish-game-bundle.mjs` (no DB
 * access) writes the SAME shape — moving it to a table would break both. Instead the
 * write is guarded with `If-Match` (the etag from the read) and RETRIED on a lost CAS,
 * so a concurrent merge re-reads the winner's entry before writing its own. The
 * standalone script mirrors the same conditional-retry loop.
 */
import {
	ConflictError,
	getObjectText,
	getObjectTextWithEtag,
	headObject,
	precondition,
	putObjectText,
} from './r2';

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

export type MockProtocol = 'lines' | 'book' | 'ways' | 'cluster' | 'scatter';

export interface TestServerGameEntry {
	protocol: MockProtocol;
	name: string;
	/** Shared prebuilt-bundle id under `test_server/_runtime/<runtime>/` (Game Maker). */
	runtime?: string;
	/** ISO timestamp — passed IN by the caller (no `Date.now()` here). */
	updatedAt: string;
	/**
	 * Launcher origin + this project's public read token — together, the pointer that lets the test
	 * server re-read the project's LIVE math contract (`GET <docBase>/api/game-config/mock?project=
	 * <key>&k=<readToken>`) instead of trusting the `grid`/`cascade` snapshot below.
	 *
	 * That is the whole point of them: `/config` is fetched live by the CLIENT (its `numReels`/
	 * `numRows` resize the board on the next reload) while the mock used to deal whatever the last
	 * publish froze — so editing the grid and not republishing left the client drawing 8×4 against a
	 * server still dealing 5×3. The snapshot stays as the fallback for an entry published before this
	 * existed, or a launcher that can't be reached.
	 *
	 * Not a new exposure: both values appear verbatim in the public game URL this same publish writes.
	 */
	docBase?: string;
	readToken?: string;
	/** Does this game CASCADE (tumble)? Present only when the project's Game Config DEPARTS from what
	 *  its win model already implies — `cluster`/`scatter` tumble by default, `lines`/`ways` do not —
	 *  so an unauthored game leaves the test server's protocol default (and its `CASCADE_GAMES`
	 *  override) in charge. Synced on publish from `resolveCascade`. */
	cascade?: boolean;
	/** The project's OWN board grid (from its Game Config), so the mock RGS deals THIS project's
	 *  `numReels`/`numRows`/`paylines` instead of the shared `apps/lines` default — otherwise a project
	 *  that authored e.g. 5 rows mismatches the client (rolls with 5, settles to fewer). Absent ⇒ the
	 *  test server falls back to its shared default grid. Synced on publish. `paylines` are row-index
	 *  arrays, one per reel (`Object.values(config.paylines)`).
	 *
	 *  `wild` is present only when a wild symbol is IN PLAY (on the strips) with a paytable: the mock
	 *  then deals + pays `WILD` (occurs→multiplier), which the lines facade maps to the game symbol
	 *  `W`. Absent ⇒ the mock deals no wild.
	 *
	 *  `stacked` is `true` only when the project has the stacked-picture mode ON (its symbols doc's
	 *  `stackedPictures.enabled` with ≥1 authored symbol): the mock then deals contiguous tall-symbol
	 *  runs — including guaranteed top/bottom EDGE cutoffs — so the reel mode has data to render. Absent
	 *  ⇒ the mock deals its normal weighted board.
	 *
	 *  `symbols` is the project's IN-PLAY line-symbol pool in the mock's SERVER vocabulary (`PIC*`, plus
	 *  `SCAT` when the scatter is in play) — gated on `symbolsInPlay` and translated from client names at
	 *  publish. The mock draws its board ONLY from this pool, so a symbol the user marks UNUSED in
	 *  `/config` never lands against our own mock. Absent ⇒ the mock deals its full default pool. */
	grid?: {
		reels: number;
		/** The BOUNDING BOX height — the tallest column. Unchanged meaning for a rectangular board. */
		rows: number;
		/** Visible rows per COLUMN, present only when the project authored a STEPPED grid (its
		 *  `numRows` are not all equal). The mock deals each column to its own height, so the board it
		 *  scores is the board the client draws. Absent ⇒ every column is `rows` deep, exactly as
		 *  before this existed. */
		rowsPerReel?: number[];
		/** Empty for a model with no lines (`cluster`) — the mock then pays by its own evaluator. */
		paylines: number[][];
		wild?: { paytable: Record<string, number> };
		stacked?: boolean;
		symbols?: string[];
		/** Smallest connected group that pays, from the project's `winModel` (`cluster` only). */
		minCluster?: number;
		/** Whether corner-touching cells join a cluster, from the project's `winModel` (`cluster` only). */
		adjacency?: 'orthogonal' | 'diagonal';
		/** Smallest count-anywhere that pays, from the project's `winModel` (`scatter` only). */
		minCount?: number;
		/** The project's own paytable in SERVER symbols, for EVERY win model — so the mock prices what
		 *  `/config` authored rather than its captured Hot Fruits values, and so the symbols only the
		 *  extended mapping reaches (`PIC8`/`PIC9`/`PIC10`) have a price row at all. A symbol absent
		 *  here falls back to the mock's own table. Scatter additionally needs it because its pricing
		 *  is by COUNT, which a run-length table cannot express. See `projectSymbolPaytable`. */
		symbolPaytable?: Record<string, Record<string, number>>;
		/** `true` when the project declares a multiplier symbol IN PLAY (`special_properties`
		 *  contains `multiplier`, and it appears on a strip). A cascading scatter game then lands
		 *  multiplier cells during a tumble and collects them into a board multiplier. Absent ⇒ the
		 *  mock deals none, so a project with no multiplier art never has blank cells dealt at it. */
		multiplier?: boolean;
	};
}

export interface TestServerManifest {
	games: Record<string, TestServerGameEntry>;
}

/** Parse the manifest text into the canonical shape (empty on absent / malformed). */
function parseManifest(raw: string | null | undefined): TestServerManifest {
	if (!raw) return { games: {} };
	try {
		const parsed = JSON.parse(raw) as Partial<TestServerManifest>;
		return { games: parsed.games ?? {} };
	} catch {
		return { games: {} };
	}
}

/** Read the manifest (or an empty one when absent / malformed). */
export async function loadTestServerManifest(): Promise<TestServerManifest> {
	return parseManifest(await getObjectText(TEST_SERVER_MANIFEST_KEY));
}

/** Bounded CAS retries when two publishers merge the same manifest at once. */
const MANIFEST_MAX_ATTEMPTS = 6;

/**
 * Merge ONE game entry into the manifest (read-modify-write) and persist it,
 * preserving every other game. Returns the written manifest.
 *
 * Guarded with `If-Match` and retried on a lost CAS so two users publishing different
 * games at once can't drop each other's entry (see the file header). A present-but-
 * corrupt manifest is overwritten deliberately (`ifMatch` on its etag), not left
 * unsaveable behind an `ifNoneMatch` create precondition.
 */
export async function upsertTestServerGame(
	key: string,
	entry: TestServerGameEntry,
): Promise<TestServerManifest> {
	for (let attempt = 1; ; attempt++) {
		const current = await getObjectTextWithEtag(TEST_SERVER_MANIFEST_KEY);
		const manifest = parseManifest(current?.text);
		manifest.games[key] = entry;
		try {
			await putObjectText(
				TEST_SERVER_MANIFEST_KEY,
				JSON.stringify(manifest, null, 2),
				'application/json; charset=utf-8',
				// present ⇒ ifMatch etag (CAS / deliberate corrupt-overwrite); absent ⇒ ifNoneMatch '*'.
				precondition(current ? (current.etag ?? undefined) : null),
			);
			return manifest;
		} catch (err) {
			if (err instanceof ConflictError && attempt < MANIFEST_MAX_ATTEMPTS) continue;
			throw err;
		}
	}
}
