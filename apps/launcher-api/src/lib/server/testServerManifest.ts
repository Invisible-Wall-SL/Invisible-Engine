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
import type { FreeSpinsAward, HoldAndWinMockInputs, PotsOverlayMockInputs } from 'game-config';

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
 * Epoch-ms the engine a runtime SERVES was built — the `builtAt` of the release its pointer
 * (`test_server/_runtime/<id>/current.json`) names. The build time, not the time the pointer moved:
 * a rollback puts an OLDER engine live, which must not flag every game as behind it. Before the first
 * versioned release there is no pointer, and the `last-modified` of the flat
 * `_runtime/<id>/index.html` stands in. Returns `null` when neither is
 * present (nothing to compare against).
 *
 * This is the ENGINE-version signal the Game Maker compares against a game's last
 * publish (`updatedAt`, below) to flag a game whose RUNNING engine is behind the
 * current one — so an author republishes (which re-hydrates the test server) instead
 * of chasing a "my change isn't showing" ghost.
 */
export async function runtimeBundleReleasedAt(runtimeId: string): Promise<number | null> {
	const pointer = await runtimePointer(runtimeId);
	const builtAt = pointer ? Date.parse(pointer.builtAt) : NaN;
	if (Number.isFinite(builtAt)) return builtAt;
	const head = await headObject(`test_server/_runtime/${runtimeId}/index.html`);
	return head && head.lastModified > 0 ? head.lastModified : null;
}

/**
 * The pointer that picks which immutable release (`test_server/_runtime/<id>@<version>/`) every
 * unpinned game on a runtime serves. Written by `scripts/publish-runtime-bundle.mjs` and
 * `scripts/runtime-pointer.mjs` (layout: `scripts/lib/runtime-releases.mjs`); read by the test server.
 */
export interface RuntimePointer {
	runtimeId: string;
	version: string;
	commit: string;
	shortCommit: string;
	builtAt: string;
	marker: string;
	promotedAt: string;
	via: 'release' | 'rollback' | 'promote';
	previous: string | null;
}

export async function runtimePointer(runtimeId: string): Promise<RuntimePointer | null> {
	const raw = await getObjectText(`test_server/_runtime/${runtimeId}/current.json`);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as RuntimePointer;
	} catch {
		return null;
	}
}

/**
 * The advisory release stamp `publish-runtime-bundle.mjs` writes next to a runtime's pointer
 * (`test_server/_runtime/<id>/release.json`). It records which engine commit the LIVE shared
 * bundle was built from + when, and whether a release is currently building — the bundle-vs-source
 * axis (distinct from the per-game `engineStale` axis, which compares a game's publish time to the
 * bundle's). `status: 'building'` is written up-front, then overwritten with `'released'` when the
 * pointer moves (a release, a rollback or a promote). A release that fails after the `building`
 * stamp puts the live release's stamp back and adds `lastFailure`; `'failed'` is written only when
 * there is no live release to put back. Older bundles predate the stamp, so callers fall back to
 * `runtimeBundleReleasedAt`.
 */
export interface RuntimeRelease {
	runtimeId: string;
	commit: string;
	shortCommit: string;
	builtAt: string;
	status: 'released' | 'building' | 'failed';
	/** The immutable release the pointer names (absent on a pre-pointer stamp). */
	version?: string;
	promotedAt?: string;
	via?: RuntimePointer['via'];
	/** `stage`: the failed run never moved the pointer ('before-promote'), or moved it and the
	 *  served check then failed ('unverified' — that commit IS in R2 as the live release). */
	lastFailure?: {
		commit: string;
		shortCommit: string;
		at: string;
		runUrl: string | null;
		stage?: 'before-promote' | 'unverified';
	};
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
	/** The live release came from a rollback/promote rather than a normal release. */
	via?: RuntimePointer['via'];
	/** A release attempted AFTER the live one failed (its gates, build, upload or served check). */
	lastFailure?: RuntimeRelease['lastFailure'];
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
				...(release.via && release.via !== 'release' ? { via: release.via } : {}),
				...(release.lastFailure ? { lastFailure: release.lastFailure } : {}),
			};
		}
		// 'failed' with nothing to put back (no pointer yet): the mtime fallback below still proves
		// SOMETHING is deployed, and the failure rides along.
		if (release.status === 'failed') {
			const releasedAt = await runtimeBundleReleasedAt(runtimeId);
			if (releasedAt) {
				return {
					status: 'deployed',
					builtAt: new Date(releasedAt).toISOString(),
					...(release.lastFailure ? { lastFailure: release.lastFailure } : {}),
				};
			}
		}
	}

	// No usable stamp — an older bundle. The bundle's own mtime still proves it's deployed.
	const releasedAt = await runtimeBundleReleasedAt(runtimeId);
	if (releasedAt) return { status: 'deployed', builtAt: new Date(releasedAt).toISOString() };

	// The bundle-vs-source "release pending" axis (C2) lives in `engineSource.ts#enginePending` and
	// is merged in by the `(app)` layout load — kept OUT of here so this helper stays R2-only.
	return { status: 'unknown' };
}

/**
 * The mock RGS protocols the test server implements — the VALUE, with the type derived from it, so
 * a runtime validator and the type can never disagree. (A hand-copied allowlist behind the union
 * would: there is no `svelte-check` here and a type error still builds green, so a missing member
 * ships silently — see `apps/launcher-api/CLAUDE.md` §Validate.) Its own list lives in
 * `services/test-server/server.mjs`: a name this side accepts but that side doesn't leaves the game
 * with no mock to talk to.
 */
export const MOCK_PROTOCOLS = ['lines', 'ways', 'cluster', 'scatter', 'holdAndWin'] as const;

export type MockProtocol = (typeof MOCK_PROTOCOLS)[number];

export function isMockProtocol(value: unknown): value is MockProtocol {
	return typeof value === 'string' && (MOCK_PROTOCOLS as readonly string[]).includes(value);
}

/**
 * The ONE shared prebuilt runtime bundle every online game is served from
 * (`test_server/_runtime/lines/`). The id is historical: it means "the shared engine runtime", NOT
 * "the lines game" — the bundle is built from `apps/lines`, which carries the whole engine, and a
 * published game behaves as ways/cluster/scatter because its CONFIG says so. See `runtimeFor` in
 * `publishGame.ts` for why there is deliberately only one.
 */
export const SHARED_RUNTIME_ID = 'lines';

export interface TestServerGameEntry {
	protocol: MockProtocol;
	name: string;
	/** Shared prebuilt-bundle id under `test_server/_runtime/<runtime>/` (Game Maker). */
	runtime?: string;
	/**
	 * PIN this game to one immutable runtime release (`test_server/_runtime/<runtime>@<version>/`)
	 * instead of the release the runtime's pointer names — a canary takes a release before everyone
	 * else. Written only by `scripts/runtime-pointer.mjs pin` (the "Runtime rollback" workflow);
	 * {@link upsertTestServerGame} carries it across a republish so a canary stays one.
	 */
	runtimeVersion?: string;
	/** ISO timestamp — passed IN by the caller (no `Date.now()` here). */
	updatedAt: string;
	/**
	 * The launcher PROJECT this game's math comes from — the `project=` the test server asks
	 * `/api/game-config/mock` for.
	 *
	 * It exists because the game key is NOT the project key in general, only in the online Game
	 * Maker (which publishes under `key = projectKey`, below). A desktop-launcher title names its
	 * own key, so `waysofwavesbuild` is project `test6` — and the test server, asking for a project
	 * called `waysofwavesbuild`, got a 401 and silently fell back to its shared default board. Absent
	 * ⇒ the test server falls back to the game key, which is the old behaviour and correct wherever
	 * the two names agree.
	 */
	projectKey?: string;
	/**
	 * Launcher origin + this project's public read token — together, the pointer that lets the test
	 * server re-read the project's LIVE math contract (`GET <docBase>/api/game-config/mock?project=
	 * <projectKey>&k=<readToken>`) instead of trusting the `grid`/`cascade` snapshot below.
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
	/** The OPERATOR settings the Invisible Test Server plays for this game — injected into its page as
	 *  `window.params.GameSettings.config`, exactly as a partner's embed page would, so each host
	 *  setting can be tried without the partner. Set by hand on the manifest; no publish writes it and
	 *  a republish keeps it. Field contract: `docs/reference/play4fun-protocol.md` § Host settings. */
	hostSettings?: Record<string, unknown>;
	/** `true` on a DESKTOP build (its own bundle, no `runtime`) built on an engine that prices a
	 *  bet-option table: the test server then deals its grid's `betModes` table as it does for a
	 *  runtime game (`sellableGrid`). Stamped by `/api/launcher/register-game` on every desktop
	 *  publish — the desktop launcher builds on the current engine — and by
	 *  `publish-game-bundle.mjs --table-capable`. Absent ⇒ an older build: it keeps the line-config
	 *  game it was built against. The Book-of migration refuses a project with an unstamped build
	 *  (`docs/design/book-feature.md` §6 step 5). */
	tableCapable?: true;
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
		 *  is by COUNT, which a run-length table cannot express. See `projectSymbolPaytable`.
		 *  A `book` game's grid carries ONLY this and `potsOverlay` beyond the required shape, this in
		 *  the book vocabulary (`PIC1`…`PIC4`, `ACE`…`TEN`); the book mock owns its board and ignores
		 *  the rest. */
		symbolPaytable?: Record<string, Record<string, number>>;
		/** The authored scatter pays, count → × total stake (lines-family mock only). */
		scatterPaytable?: Record<string, number>;
		/** `true` when the project declares a multiplier symbol IN PLAY (`special_properties`
		 *  contains `multiplier`, and it appears on a strip). A cascading scatter game then lands
		 *  multiplier cells during a tumble and collects them into a board multiplier. Absent ⇒ the
		 *  mock deals none, so a project with no multiplier art never has blank cells dealt at it. */
		multiplier?: boolean;
		/** The project's authored bet modes, BASE FIRST, present only when it authors something beyond
		 *  the base bet (an ante or a buy). The lines mock then declares a `betOptions` table from them
		 *  — option i costs `units × cost_i / cost_0`, `units` being the line count (1 for a model with
		 *  no lines) — and prices `bet [x, M]` by it, the way the partner's own table games do. Absent ⇒
		 *  a line-config game (`[lines, betPerLine]`, no table), exactly as before. Not sent for `book`,
		 *  whose mock owns its table. See `projectBetModes`. */
		betModes?: { mode: string; cost: number; kind: 'base' | 'ante' | 'buy' }[];
		/** `false` when the project turned free spins OFF in `/config` (lines-family and book mocks):
		 *  the mock never enters the feature, and refuses a bought option, while scatters still land
		 *  and pay (the book mock's pay nothing). Absent ⇒ free spins on, exactly as before. See
		 *  `projectFreeSpins` / `projectBookFreeSpins`. */
		freeSpins?: false;
		/** The free-spins TRIGGER when it departs from 3+ SCAT (lines-family mock only): a SERVER symbol
		 *  name and the fewest of it, anywhere on the board, that award (and retrigger) the feature.
		 *  Absent ⇒ 3+ SCAT, exactly as before. The book mock always counts `SCAT` (its book) and
		 *  reads only the count. See `projectFreeSpins` / `projectBookFreeSpins`. */
		freeSpinsTrigger?: { symbol: string; count: number };
		/** The free-spins AWARDS when they depart from the mock's defaults — 10 on entering, +5 on a
		 *  retrigger (+10 on the book mock), never random: both tables resolved (rows sorted by count;
		 *  a row awards for its count and up, to the next row) and the random switch. Absent ⇒ the
		 *  defaults, exactly as before. See `projectFreeSpins` / `projectBookFreeSpins`. */
		freeSpinsAwards?: {
			awards: FreeSpinsAward[];
			retrigger: FreeSpinsAward[];
			random: boolean;
		};
		/** The Book-of expanding special (lines mock, a `lines` win model only): every symbol it may be
		 *  drawn as when free spins start, in SERVER names, with its draw weight and the fewest reels
		 *  it must cover to expand and pay. Absent ⇒ no special. See `projectExpandingSymbol`. */
		expandingSymbol?: { candidates: { symbol: string; weight: number; minReels: number }[] };
		/** `true` when the in-play scatter is also wild (a Book-of book): the lines mock substitutes
		 *  `SCAT` on lines and declares it in `wildSymbols`. Absent ⇒ the scatter is only a scatter. */
		scatterWild?: true;
		/** A `holdAndWin` game's block, line symbols and symbol roles/pays in the project's OWN names
		 *  (`holdAndWinMockInputs`), which the Hold and Win mock deals from. Present only for that
		 *  protocol; such a grid carries none of the lines-mock fields above but the board, lines and
		 *  `betModes`. */
		holdAndWin?: HoldAndWinMockInputs;
		/** The project's pots overlay (`potsOverlayMockInputs`), which the book or lines mock deals token
		 *  drops and pot bonuses from beside its own rounds. Present only when the config has the block. */
		potsOverlay?: PotsOverlayMockInputs;
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
		// A pin is set by the release tooling, not by the publisher — a republish must not drop it. It
		// names a release OF one runtime, so it only survives a republish onto that same runtime.
		const prior = manifest.games[key];
		const pinned =
			prior?.runtimeVersion && !('runtimeVersion' in entry) && prior.runtime === entry.runtime
				? { ...entry, runtimeVersion: prior.runtimeVersion }
				: entry;
		// Operator settings are a TEST declaration made on the manifest, not by any publish, so a
		// republish keeps them too.
		manifest.games[key] =
			prior?.hostSettings && !('hostSettings' in entry)
				? { ...pinned, hostSettings: prior.hostSettings }
				: pinned;
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

/** What {@link pinTestServerGameToProject} did — `pinned` is the only one that changed anything. */
export type PinOutcome = 'pinned' | 'already-pinned' | 'no-entry';

/**
 * Stamp the PROJECT POINTER (`projectKey` + `docBase` + `readToken`) onto an EXISTING game entry,
 * leaving every other field — and every other game — exactly as it found them.
 *
 * This is the repair half of the pin, and it exists because the producer that needs it most is not
 * ours. The desktop launcher's `publish_game()` (`Invisible_Launcher.py`, a separate app) writes
 * this manifest itself with `{protocol, name, updatedAt}` and no pointer, so every desktop-published
 * game deals the test server's shared default board instead of its own Game Config — and, because
 * that write REPLACES the entry, it also wipes a pointer some earlier publish had set. Re-stamping
 * from `/api/launcher/register-game` (which that same launcher calls moments later, and which
 * already requires the project) makes the repair IDEMPOTENT: whatever the manifest write dropped,
 * the registration puts back, with no change to the Python side at all.
 *
 * PATCH, NEVER CREATE. A missing entry means no bundle was uploaded under this key, and inventing
 * one would register a game the test server would then try to serve zero files for. `no-entry` is
 * reported to the caller instead — it is a real signal (the registration and the upload disagree
 * about the key), not a condition to paper over.
 *
 * `already-pinned` is not an optimisation, it is what keeps this cheap enough to run on EVERY
 * publish: the caller only pokes `/refresh` when something actually changed, so the common
 * re-registration costs one GET and nothing else.
 *
 * Not a new exposure: `readToken` already travels in this manifest (see the field's own doc) and
 * appears verbatim in the public game URL the launcher builds.
 */
export async function pinTestServerGameToProject(
	key: string,
	pin: { projectKey: string; docBase: string; readToken: string; tableCapable?: true },
): Promise<PinOutcome> {
	return patchTestServerGame<'already-pinned', 'pinned'>(
		key,
		(entry) => {
			if (
				entry.projectKey === pin.projectKey &&
				entry.docBase === pin.docBase &&
				entry.readToken === pin.readToken &&
				(entry.tableCapable === true) === (pin.tableCapable === true)
			) {
				return 'already-pinned';
			}
			// Spread FIRST so the pin wins, and so `grid`/`cascade`/`runtime`/`updatedAt` — none of
			// which this endpoint knows anything about — survive untouched. The table-capable stamp
			// follows the pin both ways: a registration that does not claim it removes it.
			const { tableCapable: _stamp, ...rest } = entry;
			return {
				...rest,
				projectKey: pin.projectKey,
				docBase: pin.docBase,
				readToken: pin.readToken,
				...(pin.tableCapable ? { tableCapable: true } : {}),
			};
		},
		'pinned',
	);
}

/**
 * The engine a desktop build must be rebuilt on before it is stamped table-capable: book-feature
 * Phase 3 (#1120), the first engine that both prices a server's bet-option table and bridges the
 * lines mock's expanding symbol. A build from before it is sold a table it cannot price, so its buy
 * fails. Shown beside the `/admin` stamp control.
 */
export const TABLE_CAPABLE_ENGINE = {
	commit: 'f0cba612',
	pr: '#1120',
	date: '2026-10-08',
} as const;

/** A manifest entry served from its OWN bundle (no shared `runtime`) — a desktop build. */
export type OwnBundleGame = {
	key: string;
	name: string;
	protocol: string;
	projectKey: string | null;
	/** The entry's `updatedAt` — what the stamp control sends back as its compare-and-swap token. */
	updatedAt: string;
	tableCapable: boolean;
};

/** Every own-bundle entry in the manifest, by key. Reads only. */
export async function listOwnBundleGames(): Promise<OwnBundleGame[]> {
	const { games } = await loadTestServerManifest();
	return Object.entries(games)
		.filter(([, entry]) => !entry.runtime)
		.map(([key, entry]) => ({
			key,
			name: entry.name,
			protocol: entry.protocol,
			projectKey: entry.projectKey ?? null,
			updatedAt: entry.updatedAt ?? '',
			tableCapable: entry.tableCapable === true,
		}))
		.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * What {@link setTestServerGameTableCapable} did. `stamped` / `cleared` wrote; `unchanged` found it
 * already so; `runtime` refused a shared-runtime entry (it is sold its table anyway); `changed`
 * refused because the entry was republished since the caller read it.
 */
export type TableCapableOutcome =
	'stamped' | 'cleared' | 'unchanged' | 'no-entry' | 'runtime' | 'changed';

/**
 * Set or clear the `tableCapable` stamp on ONE own-bundle entry, leaving every other field and game
 * as found — the `/admin` control, so the owner needs no `--table-capable` script run. Admin-only at
 * its caller.
 *
 * TWO compare-and-swaps. The manifest write is under its ETag and retried on a lost race (the pin's
 * {@link patchTestServerGame}), so a concurrent publish of another game is never dropped. And the
 * ENTRY must still be the one the admin looked at: `seenUpdatedAt` is its `updatedAt` as listed, and
 * any publish of this key rewrites it, so a build republished since (which may be an older bundle,
 * and which cleared the stamp) is `changed`, never stamped blind. Never creates an entry.
 */
export async function setTestServerGameTableCapable(
	key: string,
	stamp: { tableCapable: boolean; seenUpdatedAt: string },
): Promise<TableCapableOutcome> {
	return patchTestServerGame<'runtime' | 'changed' | 'unchanged', 'stamped' | 'cleared'>(
		key,
		(entry) => {
			if (entry.runtime) return 'runtime';
			if ((entry.updatedAt ?? '') !== stamp.seenUpdatedAt) return 'changed';
			if ((entry.tableCapable === true) === stamp.tableCapable) return 'unchanged';
			const { tableCapable: _stamp, ...rest } = entry;
			return stamp.tableCapable ? { ...rest, tableCapable: true } : rest;
		},
		stamp.tableCapable ? 'stamped' : 'cleared',
	);
}

/**
 * Read-modify-write ONE existing entry under the manifest's ETag, retried on a lost CAS. `patch` sees
 * the entry as re-read on every attempt and returns the entry to write, or an outcome to stop at
 * without writing; `written` is the outcome of a write that landed. PATCH, NEVER CREATE: a missing
 * entry is `no-entry`.
 */
async function patchTestServerGame<Stop extends string, Written extends string>(
	key: string,
	patch: (entry: TestServerGameEntry) => TestServerGameEntry | Stop,
	written: Written,
): Promise<Stop | Written | 'no-entry'> {
	for (let attempt = 1; ; attempt++) {
		const current = await getObjectTextWithEtag(TEST_SERVER_MANIFEST_KEY);
		const manifest = parseManifest(current?.text);
		// `Object.hasOwn`, not a truthiness test on the lookup. `manifest.games` is a plain object
		// straight out of `JSON.parse`, so it inherits `Object.prototype` — and `constructor` passes
		// `isValidGameKey` (lowercase letters, no separators). A bare `games['constructor']` returns
		// the `Object` function, which is TRUTHY, so the never-create guard would wave it through and
		// this would write a `constructor` entry carrying a project read token into the manifest.
		// The test server already reads its own registry through an `own()` helper for exactly this
		// reason; the writer has to match.
		const entry = Object.hasOwn(manifest.games, key) ? manifest.games[key] : undefined;
		if (!entry) return 'no-entry';
		const next = patch(entry);
		if (typeof next === 'string') return next;
		manifest.games[key] = next;
		try {
			await putObjectText(
				TEST_SERVER_MANIFEST_KEY,
				JSON.stringify(manifest, null, 2),
				'application/json; charset=utf-8',
				precondition(current ? (current.etag ?? undefined) : null),
			);
			return written;
		} catch (err) {
			if (err instanceof ConflictError && attempt < MANIFEST_MAX_ATTEMPTS) continue;
			throw err;
		}
	}
}
