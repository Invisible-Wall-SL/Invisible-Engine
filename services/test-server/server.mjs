/**
 * Invisible Test Server.
 *
 * One small Node service that lets the engine games be launched + played from
 * any machine (via the launcher portal's Games section). It does two jobs:
 *
 *   1. Serves each game's built bundle (a single self-contained index.html — the
 *      games build with adapter-static + inline asset strategy, so there are no
 *      runtime asset fetches) under  GET /<gameKey>/.
 *   2. Hosts a mock Play4Fun RGS per game under  /api/<gameKey>/rgs/engine, so
 *      the game has a backend to spin against (fake money, no real spend).
 *
 * Bundles live in R2 under  test_server/<gameKey>/...  and a small manifest
 * test_server/games.json maps each gameKey to its mock protocol + display name:
 *   { "games": { "hotfruits": { "protocol": "lines", "name": "Hot Fruits" }, … } }
 * The service hydrates everything from R2 on boot (and on POST /refresh).
 *
 * The MATH a mock deals (grid, paylines, symbol pool, cascade) is NOT owned by that
 * manifest: it belongs to the project's Invisible Game Config, which this server
 * re-reads live from the launcher and applies without a republish. The manifest's
 * copy is only the offline fallback. See "the LIVE math contract" below.
 *
 * Games are PUBLISHED to R2 by apps/launcher-api/scripts/publish-game-bundle.mjs.
 *
 * Env:
 *   PORT=8080
 *   R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY   (read)
 *   TEST_SERVER_SECRET   (optional) — required on POST /refresh, as the
 *                        `x-test-server-secret` header or `?secret=`
 *   TEST_SERVER_LOCAL    (optional) — local dev: hydrate from this directory
 *                        instead of R2. Layout mirrors R2: <dir>/games.json +
 *                        <dir>/<gameKey>/index.html. No R2 creds needed.
 */

import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { extname, join, relative, sep, dirname } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { carrySession, createMockRgs as createLinesMock } from '../../scripts/mock-rgs-server.mjs';
import { createMockRgs as createBookMock } from '../../scripts/mock-rgs-server-book.mjs';
import { createMockRgs as createHoldAndWinMock } from '../../scripts/mock-rgs-server-holdandwin.mjs';
import { createPlatformJackpot } from '../../scripts/mock-platform-jackpot.mjs';
import { withPotsOverlay } from '../../scripts/mock-pots-overlay.mjs';
import { holdOpenRounds, mockForSession } from './openRounds.mjs';
import { hostConfigFor, injectHostSettings, validHostSettings } from './hostSettings.mjs';

// Invisible Wall favicon — served for EVERY favicon request (the root page and every
// game), so all tabs are IW-branded (overriding the games' own bundled favicons).
const HERE = dirname(fileURLToPath(import.meta.url));
const FAVICONS = (() => {
	const load = (name, contentType) => {
		try {
			return { body: readFileSync(join(HERE, name)), contentType };
		} catch {
			return null;
		}
	};
	return {
		'favicon.ico': load('favicon.ico', 'image/x-icon'),
		'favicon.svg': load('favicon.svg', 'image/svg+xml'),
		'favicon.png': load('favicon-32.png', 'image/png'),
	};
})();
const FAVICON_DEFAULT =
	FAVICONS['favicon.svg'] ?? FAVICONS['favicon.png'] ?? FAVICONS['favicon.ico'];

const PORT = Number(process.env.PORT ?? 8080);
const MANIFEST_KEY = 'test_server/games.json';
const BUNDLE_PREFIX = 'test_server/';
const SECRET = process.env.TEST_SERVER_SECRET ?? '';
const LOCAL_DIR = process.env.TEST_SERVER_LOCAL ?? '';

const endpoint = process.env.R2_ENDPOINT;
const bucket = process.env.R2_BUCKET;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
if (!LOCAL_DIR && (!endpoint || !bucket || !accessKeyId || !secretAccessKey)) {
	console.error(
		'[test-server] missing R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY (or set TEST_SERVER_LOCAL for local dev)',
	);
	process.exit(1);
}

// S3 client is only created in R2 mode (import is lazy so local dev needs no deps).
let s3 = null;
async function r2() {
	if (!s3) {
		const { S3Client } = await import('@aws-sdk/client-s3');
		s3 = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } });
	}
	return s3;
}

// ---------- in-memory state (rebuilt on hydrate) ----------

/** gameKey -> { protocol, name, runtime, runtimeKey, runtimeVersion } (runtime = shared bundle id, or null) */
let registry = {};
/** gameKey -> { '<relPath>': { body: Buffer, contentType: string } } (per-key bundles) */
let bundles = {};
/** runtimeKey -> files map — a prebuilt generic engine bundle shared by every Game-Maker game
 *  whose manifest entry sets `runtime: "<id>"`. The game boots it with
 *  `?runtime=1&project=<key>&k=<readToken>` and fetches its layout + assets live from the
 *  launcher — so publishing a game is a manifest entry, not a build.
 *
 *  A runtimeKey is `<id>@<version>`: an IMMUTABLE release at `test_server/_runtime/<id>@<version>/`,
 *  chosen by the pointer `_runtime/<id>/current.json` or, for a pinned (canary) game, by its own
 *  `runtimeVersion`. A plain `<id>` is the pre-pointer flat `_runtime/<id>/` layout, used only while
 *  no pointer exists. See "Runtime releases" in docs/design/games-deploy.md. */
let runtimeBundles = {};
/** runtimeId -> the version the pointer named at the last successful read. A pointer read that
 *  fails transiently keeps this instead of silently dropping to the stale flat layout. */
let runtimePointers = {};
/** runtimeId -> `_app/immutable/*` files of the release that was live BEFORE the last flip. A player
 *  who loaded the old index.html may still fetch its content-hashed chunks; they must not 404 the
 *  moment the pointer moves. Kept for one generation. */
let retiredImmutable = {};
/** gameKey -> mock instance ({ handle }) */
let mocks = {};
/** gameKey -> the AUTHORING twin of a runtime game's mock (see `AUTHORING`). Created on the first
 *  authoring request, so a game nobody authors never pays for one. */
let authoringMocks = {};
/** gameKey -> { checkedAt: epochMs, inFlight: Promise|null } — the live-contract poll (see
 *  `refreshContract`). Rebuilt on hydrate so a refresh re-checks every game immediately. */
let contracts = {};
/** in-flight guard so overlapping POST /refresh calls coalesce into one hydrate */
let refreshing = false;
/** A refresh asked for WHILE one was in flight. It cannot be answered by the running pass — that
 *  pass already read the manifest — so one more is queued behind it. See the `/refresh` handler. */
let refreshPending = false;
/** The last hydrate's outcome, for `/healthz`. `succeeded: false` ⇒ it threw, so the registry is
 *  whatever the previous good pass built — nothing at all after a failed boot. `at` = epoch ms. */
let lastHydrate = { succeeded: false, at: 0, error: 'not hydrated yet' };

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.wasm': 'application/wasm',
	'.mp3': 'audio/mpeg',
	'.ogg': 'audio/ogg',
	'.wav': 'audio/wav',
	'.atlas': 'text/plain; charset=utf-8',
};
const mimeFor = (relPath, fallback) =>
	MIME[extname(relPath).toLowerCase()] ?? fallback ?? 'application/octet-stream';

/**
 * The lines game's authored grid, from the committed Game Config template default
 * (`gameConfig/lines.json`, generated from `apps/lines`' `config.ts` and drift-gated to match it).
 * The lines mock deals THIS grid so a spin shows the board the game draws (Invisible Game Config's
 * numReels/numRows/paylines) — the mock/game agree on dimensions AND paylines instead of the mock's
 * old fixed 5×3 + 5-line subset. Unreadable/odd JSON ⇒ null ⇒ the mock keeps its faithful defaults.
 *
 * Paylines come from the config as `{ id: rows[] }`; the mock wants `rows[][]`. They MUST be
 * numReels-wide — the config validator guarantees that, and passing them together with the reel
 * count keeps the two in lock-step.
 */
const linesGrid = (() => {
	try {
		const path = join(HERE, '../../apps/launcher-api/src/lib/data/gameConfig/lines.json');
		const doc = JSON.parse(readFileSync(path, 'utf8'));
		const reels = Math.max(1, Math.round(Number(doc.numReels)));
		const declared = doc.numRows ?? [3];
		const rows = Math.max(1, Math.round(Math.max(...declared)));
		const perReel = Array.from({ length: reels }, (_unused, i) =>
			Math.max(1, Math.round(Number(declared[i] ?? declared[declared.length - 1]))),
		);
		const paylines = Object.values(doc.paylines ?? {});
		if (!Number.isFinite(reels) || !paylines.length) return null;
		// `rowsPerReel` only when the columns differ — a rectangular board passes the exact object it
		// passed before stepped grids existed.
		const stepped = perReel.some((r) => r !== perReel[0]);
		return stepped ? { reels, rows, rowsPerReel: perReel, paylines } : { reels, rows, paylines };
	} catch {
		return null;
	}
})();

// `grid` is THIS project's own board, from its Game Config — read LIVE by `refreshContract` below,
// with the manifest entry's copy as the fallback. When present it deals the project's real
// numReels/numRows/paylines so the mock matches the client that authored e.g. 5 rows; absent ⇒ the
// shared `linesGrid` default (apps/lines). Book keeps its own shape and takes only the paytable.
/**
 * Protocols that cascade BY DEFAULT. A `cluster` / `scatter` game IS a tumble game — the cells that
 * paid leave the board and the survivors fall into the gap — so for those the cascade is the
 * MECHANIC, not a test fixture, and a game of that type that never tumbles is simply broken. Adding
 * a future tumble type here is the whole change needed on this side.
 *
 * Keying it off the protocol keeps every bit of safety the allowlist below was built for: a
 * `lines` or `book` game still cannot cascade by accident, so the shipped Book of Borut is
 * untouched with no env set at all.
 */
const CASCADE_PROTOCOLS = new Set(['cluster', 'scatter']);

/**
 * OVERRIDE for the protocols that do not cascade on their own, as a comma-separated list of game
 * keys (`CASCADE_GAMES=test1`), or `*` for all. This is how a `lines` game is made to exercise the
 * tumble overlay; for `cluster`/`scatter` it is redundant.
 *
 * Per-GAME rather than a bare on/off, because this one process serves every game: a global flag
 * would make the shipped Book of Borut cascade on every spin.
 */
const CASCADE_GAMES = new Set(
	(process.env.CASCADE_GAMES ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean),
);
/**
 * Does this game tumble, and WHY? The project's OWN authored answer wins (`cascade` in its manifest
 * entry, synced from its Game Config at publish), then the protocol default, then the env override.
 * A project can therefore turn the cascade off on a cluster game, or on for a lines game, which an
 * env-only gate could never express per project.
 *
 * The WHY matters as much as the answer, and used to be thrown away here. Only the env override is a
 * DEMO — a tumble bolted onto a game that does not have one, so a dead spin still tumbles and the
 * overlay is visible. A cascade the project declared (or the protocol implies) is the game's
 * MECHANIC, and a mechanic must not fire on a spin that paid nothing. Passing only the boolean left
 * the mock to guess from the win model, so an authored `ways` cascade was treated as a demo and blew
 * non-paying symbols off the board on every losing spin. Returns `{ on, demo }`.
 */
const cascadeEnabledFor = (gameKey, protocol, authored) => {
	if (typeof authored === 'boolean') return { on: authored, demo: false };
	if (CASCADE_PROTOCOLS.has(protocol)) return { on: true, demo: false };
	const forced = CASCADE_GAMES.has('*') || CASCADE_GAMES.has(gameKey);
	return { on: forced, demo: forced };
};

/**
 * The grid a lines-family mock is built from, less its bet TABLE unless the game is served from the
 * shared runtime.
 *
 * The runtime has read `betOptions` since 2026-09-16, so it prices a table correctly. A desktop build
 * ships its own bundle, and one built before then sends `[5, betPerLine]` whatever the table says, so
 * every spin would be `invalid bet option 5` until it is rebuilt (`test1build`, `hotfruits`). Such a
 * game keeps the line-config game it was built against.
 */
const sellableGrid = (grid, runtime) => {
	if (!grid?.betModes || runtime) return grid;
	const board = { ...grid };
	delete board.betModes;
	return board;
};

/** Games already told their Hold and Win contract could not be dealt, so it is said once. */
const holdAndWinFallbackWarned = new Set();

/**
 * A Hold and Win game's mock, built from the `holdAndWin` inputs its contract carries (the project's
 * block, symbols and line pays — `holdAndWinMockInputs` in game-config). A contract without them (a
 * project with no `holdAndWin` block, or an entry published before Phase 3) is dealt as the lines
 * game its base game is, and says so once: a respin feature that never comes is otherwise
 * indistinguishable from a broken one.
 */
const makeHoldAndWinMock = (label, grid, gameKey, runtime, twin) => {
	try {
		if (grid?.holdAndWin) {
			// Forcing an outcome (a jackpot on demand) is an authoring tool: a runtime game's players
			// never get it, its authoring twin and a standalone build's one mock do.
			const allowForce = twin || !runtime;
			return createHoldAndWinMock({ label, allowForce, ...sellableGrid(grid, runtime) });
		}
		throw new Error('its contract carries no holdAndWin block');
	} catch (e) {
		if (!holdAndWinFallbackWarned.has(gameKey)) {
			holdAndWinFallbackWarned.add(gameKey);
			console.warn(
				`[test-server] '${gameKey}' is a Hold and Win game but ${e.message} — dealing its base ` +
					'game as lines, with no respin feature. Check its Game Config holdAndWin block.',
			);
		}
		return null;
	}
};

/**
 * The OPERATOR PLATFORM JACKPOT over a game's mock (`scripts/mock-platform-jackpot.mjs`), for a game
 * whose `hostSettings` carry our own test switch `mockPlatformJackpot: true` — never the operator's
 * `jackpot` field, which a copied set of real operator settings may hold. Kind-independent: it
 * wraps whichever mock deals the game. One per game and channel, outside the mock, so a contract
 * swap keeps its pools. Off (null) for every other game, which is
 * answered byte-identically. Forcing a hit follows the mocks' rule: a runtime game's players never
 * get it, its authoring twin and a standalone build do.
 */
const platformJackpots = new Map();
const platformJackpotFor = (gameKey, meta, channel) => {
	if (meta.hostSettings?.mockPlatformJackpot !== true) return null;
	const key = channel ? `${gameKey}/${channel}` : gameKey;
	if (!platformJackpots.has(key)) {
		platformJackpots.set(
			key,
			createPlatformJackpot({ allowForce: channel === AUTHORING || !meta.runtime }),
		);
	}
	return platformJackpots.get(key);
};

/** Games already told their pots overlay could not be dealt, so it is said once. */
const potsOverlayFallbackWarned = new Set();

/**
 * A book game's mock, with the POTS OVERLAY composed over it when its contract carries the project's
 * `potsOverlay` inputs (`potsOverlayMockInputs` in game-config; `scripts/mock-pots-overlay.mjs`).
 * Without them it is the book mock exactly. An overlay that cannot be built deals the plain book game
 * and says so once, for the reason `makeHoldAndWinMock` gives.
 */
const makeBookMock = (label, grid, gameKey, runtime, twin) => {
	const opts = { label, symbolPaytable: grid?.symbolPaytable };
	if (!grid?.potsOverlay) return createBookMock(opts);
	try {
		// Forcing a beat is an authoring tool, as on the Hold and Win mock.
		return withPotsOverlay(
			createBookMock,
			grid.potsOverlay,
		)({ ...opts, allowForce: twin || !runtime });
	} catch (e) {
		if (!potsOverlayFallbackWarned.has(gameKey)) {
			potsOverlayFallbackWarned.add(gameKey);
			console.warn(
				`[test-server] '${gameKey}' has a pots overlay but ${e.message} — dealing its book game ` +
					'with no pots. Check its Game Config potsOverlay block.',
			);
		}
		return createBookMock(opts);
	}
};

const makeMock = (protocol, label, grid, gameKey, cascade, runtime, twin = false) => {
	if (protocol === 'holdAndWin') {
		const mock = makeHoldAndWinMock(label, grid, gameKey, runtime, twin);
		if (mock) return mock;
	}
	// `book` owns its board and paylines; what it reads of the contract is the project's authored line
	// table, so it pays (and declares) what `/config` set rather than its captured one, and its pots
	// overlay.
	if (protocol === 'book') return makeBookMock(label, grid, gameKey, runtime, twin);
	// `holdAndWin` lands here only when its own mock could not be built (above).
	// `ways` reuses the lines mock entirely and only swaps how wins are DECIDED — the session, round
	// lifecycle, scatter pass and event vocabulary are identical between them, which is why this is
	// an option rather than a third forked mock. See docs/design/game-type-templates.md (Phase D).
	const winModel = ['ways', 'cluster', 'scatter'].includes(protocol) ? protocol : 'lines';
	const tumble = cascadeEnabledFor(gameKey, protocol, cascade);
	return createLinesMock({
		label,
		winModel,
		// Explicit boolean either way — an absent value would let the mock fall back to the
		// process-wide `CASCADE` env and cascade every game on this server.
		cascade: tumble.on,
		// …and whether it is the game's MECHANIC or the demo override, which only this side knows.
		cascadeDemo: tumble.demo,
		...(sellableGrid(grid, runtime) ?? linesGrid ?? {}),
	});
};

/** A runtime release version is an R2 path segment (`_runtime/<id>@<version>/`) read from external
 *  JSON, so only this shape is accepted — the same rule `scripts/lib/runtime-releases.mjs` writes. */
const validVersion = (v) =>
	typeof v === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(v) ? v : null;

const BET_MODE_KINDS = new Set(['base', 'ante', 'buy']);
/** Names the client's `betOptionIndexFor` reads as something else: the base option, or an unnamed
 *  option by position. An extra mode called either could never be bought. */
const RESERVED_BET_MODE = /^(base|default|option\d+)$/;

/**
 * A manifest's `betModes` (BASE FIRST, then each ante/buy the project authored), or null. Validated
 * WHOLE: a malformed entry drops the list rather than leaving a price table with a hole in it, and a
 * dropped list leaves the game a line-config game, which is what it was before this existed. Names
 * must stay distinct once normalised, because the client matches an option to its card by name.
 */
const validBetModes = (raw) => {
	if (!Array.isArray(raw) || raw.length < 2) return null;
	const seen = new Set();
	for (const [index, entry] of raw.entries()) {
		const key =
			typeof entry?.mode === 'string' ? entry.mode.replace(/[^a-z0-9]/gi, '').toLowerCase() : '';
		const isBase = index === 0;
		const ok =
			key &&
			!seen.has(key) &&
			(isBase || !RESERVED_BET_MODE.test(key)) &&
			typeof entry.cost === 'number' &&
			Number.isFinite(entry.cost) &&
			entry.cost > 0 &&
			BET_MODE_KINDS.has(entry.kind) &&
			isBase === (entry.kind === 'base');
		if (!ok) return null;
		seen.add(key);
	}
	return raw.map(({ mode, cost, kind }) => ({ mode, cost, kind }));
};

/** Lists already reported, so a contract re-read every few seconds says it once, not every time. */
const droppedBetModes = new Set();
/** A dropped list turns the game back into "the card shows a price, the base stake is charged" —
 *  the very bug the table exists to fix — so it is never dropped quietly. */
const warnDroppedBetModes = (raw) => {
	const text = JSON.stringify(raw);
	if (droppedBetModes.has(text)) return;
	droppedBetModes.add(text);
	console.warn(`[test-server] ignored a malformed betModes list, so no bet table: ${text}`);
};

/** Accept a manifest `grid` only when it is well-formed (reels + rows + numReels-wide paylines); any
 *  malformed entry ⇒ null ⇒ the mock keeps its shared default. Defensive: the manifest is external.
 *  A well-formed `wild` ({ paytable: occurs→multiplier }) is passed through so the mock deals + pays
 *  the project's in-play wild; a malformed wild is simply dropped (the grid still stands). */
const validGrid = (grid) => {
	if (!grid || typeof grid !== 'object') return null;
	const reels = Math.round(Number(grid.reels));
	const rows = Math.round(Number(grid.rows));
	const paylines = Array.isArray(grid.paylines) ? grid.paylines : [];
	// Per-column heights, defensively validated like everything else off the external manifest: it
	// must be a `reels`-long list of positive integers, or it is dropped and the board stays
	// rectangular. A malformed entry must not be able to deal a column of NaN cells.
	const rawPerReel = Array.isArray(grid.rowsPerReel) ? grid.rowsPerReel.map(Number) : null;
	const rowsPerReel =
		rawPerReel &&
		rawPerReel.length === reels &&
		rawPerReel.every((r) => Number.isFinite(r) && r > 0 && r <= rows)
			? rawPerReel.map((r) => Math.round(r))
			: null;
	// A `cluster` grid legitimately carries NO paylines (nothing pays along a line), so the payline
	// requirement holds only when there are paylines to check. An empty list is valid; a malformed
	// one is still rejected.
	const shaped =
		reels > 0 && rows > 0 && paylines.every((line) => Array.isArray(line) && line.length === reels);
	if (!shaped) return null;
	const wildPay = grid.wild && typeof grid.wild === 'object' ? grid.wild.paytable : null;
	const wild =
		wildPay && typeof wildPay === 'object' && Object.keys(wildPay).length
			? { paytable: wildPay }
			: null;
	// `stacked` (set at publish when the project turned stacked-pictures ON) makes the mock deal
	// contiguous tall-symbol runs — incl. guaranteed edge cutoffs — so the stacked-picture reel mode has
	// data to render. Absent/false ⇒ the normal weighted deal. See mock-rgs-server `spinReelsStacked`.
	const stacked = grid.stacked === true;
	// `symbols` (set at publish from the project's in-play Game Config) is the allowed line-symbol pool
	// in the mock's SERVER vocabulary (PIC*/SCAT). The mock draws its board ONLY from it, so a symbol the
	// user marked UNUSED never lands. Accepted only as a non-empty array of strings; absent/malformed ⇒
	// dropped ⇒ the mock keeps its full default pool. See mock-rgs-server `createMockRgs({ symbols })`.
	const symbols =
		Array.isArray(grid.symbols) &&
		grid.symbols.every((s) => typeof s === 'string') &&
		grid.symbols.length
			? grid.symbols
			: null;
	// Cluster geometry, forwarded verbatim so the mock pays the shape the project's win model
	// declares. Defensive like the rest: a malformed value is dropped and the mock's own defaults
	// (5 / orthogonal, matching `normalizeWinModel`) stand.
	const minCluster =
		Number.isFinite(Number(grid.minCluster)) && Number(grid.minCluster) >= 2
			? Math.round(Number(grid.minCluster))
			: null;
	const adjacency =
		grid.adjacency === 'diagonal' || grid.adjacency === 'orthogonal' ? grid.adjacency : null;
	const minCount =
		Number.isFinite(Number(grid.minCount)) && Number(grid.minCount) >= 2
			? Math.round(Number(grid.minCount))
			: null;
	// The project's count-keyed paytable, forwarded verbatim. Shape-checked rather than trusted: the
	// manifest is external, and a malformed table would leave every scatter win silently unpriced.
	const symbolPaytable =
		grid.symbolPaytable &&
		typeof grid.symbolPaytable === 'object' &&
		Object.keys(grid.symbolPaytable).length &&
		Object.values(grid.symbolPaytable).every(
			(row) =>
				row && typeof row === 'object' && Object.values(row).every((v) => typeof v === 'number'),
		)
			? grid.symbolPaytable
			: null;
	// The project's authored SCATTER pays (count → × total stake), same shape rule as the line table.
	const scatterPaytable =
		grid.scatterPaytable &&
		typeof grid.scatterPaytable === 'object' &&
		Object.keys(grid.scatterPaytable).length &&
		Object.values(grid.scatterPaytable).every((v) => typeof v === 'number')
			? grid.scatterPaytable
			: null;
	// `multiplier` (set at publish when the project declares a multiplier symbol IN PLAY) lets a
	// cascading scatter game land multiplier cells during a tumble and collect them afterwards.
	// Absent/false ⇒ the mock deals none, so a project with no multiplier art never gets blank
	// cells. See mock-rgs-server `collectFixture`.
	const multiplier = grid.multiplier === true;
	// The authored bet modes, when the project sells something beyond the base bet: the lines mock
	// declares a `betOptions` table from them and prices `bet [x, M]` by it. See `validBetModes`.
	const betModes = validBetModes(grid.betModes);
	if (grid.betModes !== undefined && !betModes) warnDroppedBetModes(grid.betModes);
	// A Hold and Win game's inputs: its block, line symbols and symbol roles/pays. Shape-checked only
	// as far as the mock needs to stand up; everything inside was normalized by the launcher.
	const holdAndWinShaped = (hw) =>
		Boolean(
			hw &&
			typeof hw === 'object' &&
			hw.block &&
			typeof hw.block === 'object' &&
			Array.isArray(hw.lineSymbols) &&
			hw.lineSymbols.every((s) => typeof s === 'string') &&
			hw.symbols &&
			typeof hw.symbols === 'object' &&
			Object.values(hw.symbols).every((sym) => sym && Array.isArray(sym.roles)),
		);
	const holdAndWin = holdAndWinShaped(grid.holdAndWin) ? grid.holdAndWin : null;
	// A pots overlay's inputs (a book game's add-on), shape-checked as far as the overlay needs to
	// stand up; its Hold and Win bonus, when it has one, like a Hold and Win game's. `pots: []` is a
	// coins-only overlay; one with neither pots nor coins is refused by the overlay itself, loudly.
	const po = grid.potsOverlay;
	const potsOverlay =
		po &&
		typeof po === 'object' &&
		Array.isArray(po.pots) &&
		po.pots.every(
			(p) =>
				p &&
				typeof p.id === 'string' &&
				typeof p.token === 'string' &&
				Number.isFinite(Number(p.maxLevel)) &&
				typeof p.bonus?.mode === 'string',
		) &&
		po.drops &&
		typeof po.drops === 'object' &&
		Array.isArray(po.drops.table) &&
		(po.holdAndWin === undefined || holdAndWinShaped(po.holdAndWin))
			? po
			: null;
	return {
		reels,
		rows,
		...(rowsPerReel ? { rowsPerReel } : {}),
		paylines,
		...(wild ? { wild } : {}),
		...(multiplier ? { multiplier: true } : {}),
		...(stacked ? { stacked: true } : {}),
		...(symbols ? { symbols } : {}),
		...(minCluster ? { minCluster } : {}),
		...(adjacency ? { adjacency } : {}),
		...(minCount ? { minCount } : {}),
		...(symbolPaytable ? { symbolPaytable } : {}),
		...(scatterPaytable ? { scatterPaytable } : {}),
		...(betModes ? { betModes } : {}),
		...(holdAndWin ? { holdAndWin } : {}),
		...(potsOverlay ? { potsOverlay } : {}),
	};
};

// ---------- the math contract (the config its CLIENT reads decides the game) ----------

/**
 * The mock's math — grid, paylines, symbol pool, protocol, cascade — belongs to the PROJECT's
 * Invisible Game Config, and it once travelled only at PUBLISH time, frozen into
 * `test_server/games.json`. The client read that config on its own schedule, so the two drifted the
 * moment an author resized the board without republishing: the client drew (say) 8×4 while this mock
 * kept dealing 5×3, every cell outside the server's board stayed empty, and wins were scored on a
 * board nobody was looking at. "Remember to republish" is not a contract — so the mock PULLS.
 *
 * `publishGame` stamps `projectKey` + `docBase` + `readToken` into the manifest entry; with them
 * this server re-reads `GET <docBase>/api/game-config/mock?project=<projectKey>&k=<token>&source=…`
 * (the SAME derivation the publish snapshot came from, so the two can never describe different
 * games) and rebuilds that game's mock the moment the answer changes.
 *
 * `source` is WHICH config: the one the mock's client reads. Since published runtime snapshots, a
 * runtime game's PLAYERS boot the config frozen at its last Publish and its AUTHORING boots
 * (`ie_authoring=1`) the live one, so the two need different boards and one mock cannot deal both.
 * A runtime game therefore has two: the player mock follows `published`, and an authoring TWIN
 * (reached as `/api/<key>/authoring/…` — the launcher's authoring links point `rgs_url` there, see
 * `asAuthoringLaunch`) follows `live`. A standalone build has no snapshot to read; its config was
 * baked from live data, so its one mock follows `live`, as it always has.
 *
 * THE PROJECT KEY IS NOT THE GAME KEY, and reading the config under the game key is how a whole
 * class of games silently dealt the wrong board. The online Game Maker happens to publish under
 * `key = projectKey`, so asking for `project=<key>` worked there and looked general. It is not: a
 * game published by `publish-game-bundle.mjs` (every desktop-launcher title) names its own key, so
 * `waysofwavesbuild` asked the launcher for a project called `waysofwavesbuild`, got a 401, and fell
 * all the way back to this mock's built-in 5×3 Hot Fruits default — while its client drew the
 * stepped 5×[3,4,4,4,4] `ways` board `test6` actually authored. Two symptoms nobody could trace
 * back here: an out-of-dictionary symbol (`PIC7`→`L5`) landing with placeholder art, and a bottom
 * row that never exploded, because the client's 4th visible row was the facade's own bottom PAD and
 * every "the last strip entry is off-screen buffer" guard in the engine correctly skipped it.
 *
 * Best-effort by construction: no pointer, an unreachable launcher or a malformed answer all leave
 * the current mock exactly as it is, so an entry published before this existed — and a launcher
 * outage — degrade to the old frozen-snapshot behaviour instead of breaking play. What is NOT
 * best-effort any more is the silence: a game with no pointer says so once, loudly, because
 * "the mock is quietly dealing a different game than the client draws" is not a state anyone can
 * debug from the outside.
 */
const CONTRACT_TTL_MS = Number(process.env.CONTRACT_TTL_MS ?? 10_000);
/** Hard cap on the launcher round-trip, so a hung launcher can't hang a spin. */
const CONTRACT_TIMEOUT_MS = Number(process.env.CONTRACT_TIMEOUT_MS ?? 4_000);

/** The path segment (and channel name) of a runtime game's authoring twin: `/api/<key>/authoring/…`.
 *  Every mock route matches by path SUFFIX, so the twin serves the same routes under it. */
const AUTHORING = 'authoring';

/** Which of the launcher's contracts a channel follows — see the block comment above. */
const contractSourceFor = (meta, channel) =>
	channel === AUTHORING || !meta.runtime ? 'live' : 'published';

const MOCK_PROTOCOLS = new Set(['lines', 'book', 'ways', 'cluster', 'scatter', 'holdAndWin']);

/** Normalize a contract from EITHER source (manifest snapshot or live endpoint) into what
 *  `makeMock` consumes. Both go through `validGrid`, so the live answer gets the same defensive
 *  shape-check the external manifest already got — one gate, no second answer. */
const normalizeContract = (raw, fallbackProtocol) => ({
	protocol: MOCK_PROTOCOLS.has(raw?.protocol) ? raw.protocol : fallbackProtocol,
	cascade: typeof raw?.cascade === 'boolean' ? raw.cascade : undefined,
	grid: validGrid(raw?.grid),
});

/** A contract's identity — what decides whether the mock has to be rebuilt. Key order is fixed by
 *  `normalizeContract`/`validGrid`, so equal contracts stringify identically. */
const fingerprintOf = (c) => JSON.stringify([c.protocol, c.cascade ?? null, c.grid ?? null]);

/**
 * Replace a game's mock with one built from `contract`, carrying player BALANCES across (the board
 * changed, the wallet did not). An open round stays with the instance that dealt it until it closes
 * (`holdOpenRounds`): a round dealt on the previous grid cannot be settled on the new one, and
 * dropping it strands the player inside the feature.
 *
 * A runtime game's sessions also keep the bet table they were told about, and whether their config
 * carried the pots overlay (`carrySession`): its client keeps the config it booted with, and a tab
 * open when the project gains or loses a buy would otherwise be priced by a table it never saw, and
 * one open when a book game gains the overlay dealt drops and pot bonuses it cannot draw. A reload
 * asks for `config` and gets the new one. A desktop build's sessions are re-sent the config on their
 * next heartbeat, as before.
 */
const swapMock = (key, contract, channel) => {
	const twin = channel === AUTHORING;
	const pool = twin ? authoringMocks : mocks;
	const previous = own(pool, key);
	const runtime = own(registry, key)?.runtime;
	const next = makeMock(
		contract.protocol,
		twin ? `mock:${key}/${AUTHORING}` : `mock:${key}`,
		contract.grid,
		key,
		contract.cascade,
		runtime,
		twin,
	);
	if (previous?.sessions && next.sessions) {
		for (const [sid, session] of previous.sessions) {
			next.sessions.set(sid, carrySession(session, { keepBetShape: Boolean(runtime) }));
		}
	}
	holdOpenRounds(previous, next, { keepBetShape: Boolean(runtime) });
	pool[key] = next;
	const fingerprint = fingerprintOf(contract);
	// The registry's protocol/grid/cascade describe the PLAYER mock (the index page, and the contract
	// a new twin starts from); a twin only records what it is built from.
	registry[key] = twin
		? { ...own(registry, key), authoringFingerprint: fingerprint }
		: { ...own(registry, key), ...contract, fingerprint };
};

/**
 * A refresh resets every wallet — that is its point — but a runtime game's open tabs keep the bet
 * table they booted with (`carrySession`). A refresh follows every publish of ANY game, and wiping
 * the sessions let a stale tab's next request be priced by a table it never saw: measured, a $1 base
 * spin on a ways game that had gained a buy was charged 10000 as the buy. A desktop build's sessions
 * are reset as before. A process restart still loses everything; a table game then refuses the stale
 * tab's bet rather than guess (see the mock's `bet`). A round still open — a free-spin feature
 * mid-way — is answered by the instance that dealt it until it closes, for every game (`holdOpenRounds`).
 */
const carryPins = (previous, next, runtime) => {
	if (runtime && previous?.sessions && next.sessions) {
		for (const [sid, session] of previous.sessions) {
			const fresh = { ...session, balance: next.startBalance };
			next.sessions.set(sid, carrySession(fresh, { keepBetShape: true }));
		}
	}
	holdOpenRounds(previous, next, { keepBetShape: Boolean(runtime) });
};

/** Games already told about below, so the warning is one line per game per process — not one per
 *  spin. */
const unpinnedWarned = new Set();

/**
 * Say ONCE that a game has no pointer back at its project's live Game Config, and therefore is not
 * dealing that project's board.
 *
 * This is the loudest thing this file does, and deliberately. A game in this state still plays —
 * it just plays a DIFFERENT game than the one its client draws: the mock deals its built-in 5×3
 * Hot Fruits default (7 line symbols + scatter, 5 paylines, lines scoring) while the client renders
 * whatever `/config` authored. Every downstream symptom is then a presentation bug that isn't one —
 * symbols with no art because they were never in the project's dictionary, rows that don't animate
 * because they're the facade's padding made visible by the row-count mismatch, `ways` wins scored
 * as paylines. None of those point back at the manifest, so nothing short of saying it here connects
 * the two.
 */
const warnUnpinned = (key, meta) => {
	if (!meta || unpinnedWarned.has(key)) return;
	unpinnedWarned.add(key);
	console.warn(
		`[test-server] '${key}' has no project pointer in test_server/games.json (docBase/readToken), ` +
			`so its mock CANNOT follow the project's Invisible Game Config — it is dealing ` +
			`${meta.grid ? 'the frozen snapshot published with it' : "this server's shared default board"}, ` +
			`which may not be the board the game draws. Re-publish it with ` +
			`\`publish-game-bundle.mjs <key> <dir> --project <projectKey> --launcher <origin> --read-token <token>\`.`,
	);
};

/**
 * Re-read one game's contract for `channel` (at most once per {@link CONTRACT_TTL_MS}) and rebuild
 * that channel's mock when it changed. Awaited on the RGS path so a publish or a config edit is
 * dealt on the very next spin rather than the one after it; failures are cached for the same TTL so
 * a down launcher is asked once per window, not once per request.
 */
async function refreshContract(key, channel) {
	const meta = own(registry, key);
	if (!meta?.docBase || !meta?.readToken) {
		warnUnpinned(key, meta);
		return;
	}
	const twin = channel === AUTHORING;
	const label = twin ? `'${key}' (${AUTHORING})` : `'${key}'`;
	const source = contractSourceFor(meta, channel);
	const state = (contracts[twin ? `${key}/${AUTHORING}` : key] ??= {
		checkedAt: 0,
		inFlight: null,
	});
	if (state.inFlight) return state.inFlight;
	if (Date.now() - state.checkedAt < CONTRACT_TTL_MS) return;

	state.inFlight = (async () => {
		try {
			// `projectKey`, NOT `key` — see the block comment above. `?? key` keeps every entry
			// published by the online Game Maker (which names its game after its project) working
			// unchanged, so this is additive for them and a fix only where the two names differ.
			const project = meta.projectKey ?? key;
			const url =
				`${meta.docBase}/api/game-config/mock?project=${encodeURIComponent(project)}` +
				`&k=${encodeURIComponent(meta.readToken)}&source=${source}`;
			const res = await fetch(url, { signal: AbortSignal.timeout(CONTRACT_TIMEOUT_MS) });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const answer = normalizeContract(await res.json(), meta.protocol);
			// Re-read the entry: a `/refresh` during the fetch rebuilt the mocks (a twin back onto the
			// manifest's board) or dropped the game, so the copy taken before the await describes
			// neither. Comparing against it skipped the swap and dealt one spin on the wrong board;
			// swapping for a game that is gone re-created a registry entry for it.
			const current = own(registry, key);
			if (!current || (twin && !current.runtime)) return;
			if (fingerprintOf(answer) === (twin ? current.authoringFingerprint : current.fingerprint))
				return;
			const board = answer.grid ? `${answer.grid.reels}×${answer.grid.rows}` : 'its default grid';
			console.info(
				`[test-server] ${label} ${source} config changed — now dealing ${board} (${answer.protocol})`,
			);
			swapMock(key, answer, channel);
		} catch (e) {
			console.warn(
				`[test-server] ${label} ${source} config unavailable (${e.message}) — keeping the one it has`,
			);
		} finally {
			state.checkedAt = Date.now();
			state.inFlight = null;
		}
	})();
	return state.inFlight;
}

const streamToBuffer = async (stream) => {
	const chunks = [];
	for await (const chunk of stream) chunks.push(chunk);
	return Buffer.concat(chunks);
};

async function* walkLocal(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) yield* walkLocal(full);
		else if (entry.isFile()) yield full;
	}
}

/** Read manifest JSON + per-game files. Returns { games, readJson(key), readFiles(key, previous) }
 *  where readFiles yields [relPath, { body, contentType, etag }] for a game's bundle. `previous` is
 *  the files map already in memory for that key: in R2 mode an object whose ETag is unchanged is
 *  reused instead of downloaded, so a refresh costs LIST calls plus whatever actually changed. */
async function loadSource() {
	if (LOCAL_DIR) {
		const manifest = JSON.parse(await readFile(join(LOCAL_DIR, 'games.json'), 'utf8'));
		return {
			games: manifest?.games ?? {},
			readJson: async (key) => {
				try {
					return JSON.parse(await readFile(join(LOCAL_DIR, key), 'utf8'));
				} catch (e) {
					if (e.code === 'ENOENT') return null;
					throw e;
				}
			},
			readFiles: async (key) => {
				const out = [];
				const base = join(LOCAL_DIR, key);
				try {
					for await (const file of walkLocal(base)) {
						const rel = relative(base, file).split(sep).join('/');
						out.push([rel, { body: await readFile(file), contentType: mimeFor(rel) }]);
					}
				} catch (e) {
					console.warn(
						`[test-server] no local files for '${key}' under ${base} (${e.code ?? e.message})`,
					);
				}
				return out;
			},
		};
	}

	const client = await r2();
	const { GetObjectCommand, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
	const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: MANIFEST_KEY }));
	const manifest = JSON.parse((await streamToBuffer(res.Body)).toString('utf8'));
	return {
		games: manifest?.games ?? {},
		readJson: async (key) => {
			try {
				const got = await client.send(
					new GetObjectCommand({ Bucket: bucket, Key: `${BUNDLE_PREFIX}${key}` }),
				);
				return JSON.parse((await streamToBuffer(got.Body)).toString('utf8'));
			} catch (e) {
				if (e.name === 'NoSuchKey') return null;
				throw e;
			}
		},
		readFiles: async (key, previous = {}) => {
			const listed = [];
			const prefix = `${BUNDLE_PREFIX}${key}/`;
			let token;
			do {
				const list = await client.send(
					new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
				);
				for (const obj of list.Contents ?? []) {
					if (!obj.Key.endsWith('/')) listed.push(obj);
				}
				token = list.IsTruncated ? list.NextContinuationToken : undefined;
			} while (token);
			// Every hydrate used to GET every object of every bundle one at a time (~1,900 objects,
			// ~750 MB across the desktop-built games, measured 2026-09-29) — the ~2.5 min that every
			// publish refresh and every runtime rollback waited on. Unchanged objects are reused;
			// the rest are fetched a few at a time.
			const out = new Array(listed.length);
			let next = 0;
			let fetched = 0;
			const worker = async () => {
				while (next < listed.length) {
					const i = next++;
					const obj = listed[i];
					const rel = obj.Key.slice(prefix.length);
					const kept = own(previous, rel);
					if (kept && obj.ETag && kept.etag === obj.ETag) {
						out[i] = [rel, kept];
						continue;
					}
					const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: obj.Key }));
					fetched++;
					out[i] = [
						rel,
						{
							body: await streamToBuffer(got.Body),
							contentType: mimeFor(rel, got.ContentType),
							etag: obj.ETag ?? null,
						},
					];
				}
			};
			await Promise.all(Array.from({ length: 12 }, worker));
			if (listed.length)
				console.info(`[test-server] '${key}': ${fetched} of ${listed.length} file(s) downloaded`);
			return out;
		},
	};
}

/** `hydrateOnce` with its outcome recorded for `/healthz`. Only the error NAME is kept: the message
 *  can carry bucket keys and `/healthz` is public; callers log the full error. */
async function hydrate() {
	try {
		await hydrateOnce();
		lastHydrate = { succeeded: true, at: Date.now() };
	} catch (e) {
		lastHydrate = { succeeded: false, at: Date.now(), error: e?.name ?? 'Error' };
		throw e;
	}
}

/** Load the manifest + every game's files (from R2 or LOCAL_DIR) into memory. */
async function hydrateOnce() {
	let source;
	try {
		source = await loadSource();
	} catch (e) {
		// Only a CONFIRMED-absent manifest means "no games". Any other failure (R2 unreachable, bad
		// credentials, an unparseable manifest) throws and keeps the registry the last good pass built:
		// emptying it here took every game offline for the length of an R2 blip, reported healthy
		// while doing so, and at boot skipped `retryBootHydrate` because nothing had thrown.
		if (e?.name !== 'NoSuchKey' && e?.code !== 'ENOENT') throw e;
		console.warn(`[test-server] no manifest (${e.name ?? e.message}) — serving 0 games`);
		registry = {};
		bundles = {};
		runtimeBundles = {};
		retiredImmutable = {};
		mocks = {};
		authoringMocks = {};
		contracts = {};
		return;
	}

	const nextRegistry = {};
	const nextBundles = {};
	const nextPointers = {};
	/** runtimeKey -> { id, version } for every release some game is served from */
	const runtimeRefs = new Map();
	/** The version `_runtime/<id>/current.json` names, read once per hydrate. null ⇒ CONFIRMED no
	 *  pointer (the flat pre-pointer layout). A read that keeps failing keeps the last good answer, and
	 *  with none (a boot) fails the hydrate rather than guess: guessing "flat" would serve the frozen
	 *  pre-pointer engine to every game. */
	const pointerFor = async (id) => {
		if (own(nextPointers, id) !== undefined) return nextPointers[id];
		let version = null;
		for (const wait of [0, 1_000, 3_000]) {
			await new Promise((r) => setTimeout(r, wait));
			try {
				const pointer = await source.readJson(`_runtime/${id}/current.json`);
				version = pointer && validVersion(pointer.version);
				if (pointer && !version)
					console.warn(
						`[test-server] _runtime/${id}/current.json names no valid version — ignored`,
					);
				nextPointers[id] = version;
				return version;
			} catch (e) {
				console.warn(
					`[test-server] reading _runtime/${id}/current.json failed (${e.name ?? e.message})`,
				);
			}
		}
		const lastGood = own(runtimePointers, id);
		if (lastGood === undefined)
			throw new Error(`_runtime/${id}/current.json unreadable and no last good pointer`);
		console.warn(`[test-server] keeping ${lastGood ? `'${id}@${lastGood}'` : 'the flat layout'}`);
		nextPointers[id] = lastGood;
		return lastGood;
	};
	for (const [key, meta] of Object.entries(source.games)) {
		const protocol = MOCK_PROTOCOLS.has(meta.protocol) ? meta.protocol : 'lines';
		const runtime = typeof meta.runtime === 'string' && meta.runtime ? meta.runtime : null;
		// A PINNED game (canary) names its own release; every other runtime game follows the pointer.
		const pinned =
			runtime && meta.runtimeVersion != null ? validVersion(meta.runtimeVersion) : null;
		if (runtime && meta.runtimeVersion != null && !pinned)
			console.warn(`[test-server] '${key}' has an invalid runtimeVersion — following the pointer`);
		const runtimeVersion = runtime ? (pinned ?? (await pointerFor(runtime))) : null;
		const runtimeKey = runtime ? (runtimeVersion ? `${runtime}@${runtimeVersion}` : runtime) : null;
		// `cascade` is the project's OWN authored answer, synced from its Game Config at publish.
		// Absent ⇒ undefined, and the protocol default decides. Only a real boolean overrides it.
		const cascade = typeof meta.cascade === 'boolean' ? meta.cascade : undefined;
		const contract = { protocol, cascade, grid: validGrid(meta.grid) };
		nextRegistry[key] = {
			...contract,
			name: meta.name ?? key,
			runtime,
			runtimeKey,
			runtimeVersion,
			pinned: Boolean(pinned),
			// The pointer back at the project's LIVE config (see `refreshContract`). Absent for a game
			// published before this shipped — such a game keeps dealing the snapshot below, and now
			// SAYS so once (`warnUnpinned`) instead of silently playing a different board.
			//
			// `projectKey` is the launcher project the config lives under, which is only incidentally
			// the game key: the online Game Maker publishes under `key = projectKey`, every
			// desktop-launcher title names its own key (`waysofwavesbuild` → project `test6`). Absent
			// ⇒ `refreshContract` falls back to `key`, which is exactly the old behaviour for the
			// entries where the two agree.
			projectKey: typeof meta.projectKey === 'string' && meta.projectKey ? meta.projectKey : null,
			docBase: typeof meta.docBase === 'string' ? meta.docBase.replace(/\/+$/, '') : null,
			readToken: typeof meta.readToken === 'string' ? meta.readToken : null,
			// What the mock is currently built from, so a live re-read can tell "unchanged" from "changed".
			fingerprint: fingerprintOf(contract),
			hostSettings: validHostSettings(meta.hostSettings, key),
		};
		if (runtime) {
			// Served from the shared runtime bundle (loaded once below) — no per-key files.
			runtimeRefs.set(runtimeKey, { id: runtime, version: runtimeVersion });
			console.info(
				`[test-server] registered '${key}' (${protocol}) → runtime '_runtime/${runtimeKey}'` +
					(pinned ? ' (pinned)' : ''),
			);
		} else {
			nextBundles[key] = Object.fromEntries(await source.readFiles(key, own(bundles, key)));
			console.info(
				`[test-server] hydrated '${key}' (${protocol}) — ${Object.keys(nextBundles[key]).length} file(s)`,
			);
		}
	}

	// Load each referenced runtime release once. A versioned release is immutable, so one already in
	// memory is reused as-is — a refresh costs a pointer read, not a re-download of the bundle. The
	// flat pre-pointer layout is mutable and is re-read every time.
	const nextRuntimeBundles = {};
	for (const [runtimeKey, { version }] of runtimeRefs) {
		const cached = version ? own(runtimeBundles, runtimeKey) : undefined;
		if (cached && Object.keys(cached).length > 0) {
			nextRuntimeBundles[runtimeKey] = cached;
			continue;
		}
		nextRuntimeBundles[runtimeKey] = Object.fromEntries(
			await source.readFiles(`_runtime/${runtimeKey}`, own(runtimeBundles, runtimeKey)),
		);
		const n = Object.keys(nextRuntimeBundles[runtimeKey]).length;
		if (n === 0)
			console.warn(
				`[test-server] runtime '_runtime/${runtimeKey}' has 0 files — games using it won't load until it's published`,
			);
		else console.info(`[test-server] hydrated runtime '_runtime/${runtimeKey}' — ${n} file(s)`);
	}

	// A pointer that names a release with no index.html (deleted, or never fully uploaded) must not
	// take every game down: the games that follow it stay on the release the pointer named before.
	const pointerKey = (id, version) => (version ? `${id}@${version}` : id);
	for (const [id, version] of Object.entries(nextPointers)) {
		const key = pointerKey(id, version);
		if (own(own(nextRuntimeBundles, key) ?? {}, 'index.html')) continue;
		const before = own(runtimePointers, id);
		const beforeKey = before === undefined ? null : pointerKey(id, before);
		const kept = beforeKey && own(runtimeBundles, beforeKey);
		if (!kept || !own(kept, 'index.html')) continue;
		console.warn(
			`[test-server] '_runtime/${key}' has no index.html — games stay on '_runtime/${beforeKey}'`,
		);
		nextPointers[id] = before;
		nextRuntimeBundles[beforeKey] = kept;
		if (!Object.values(nextRegistry).some((m) => m.pinned && m.runtimeKey === key))
			delete nextRuntimeBundles[key];
		for (const meta of Object.values(nextRegistry)) {
			if (meta.runtime === id && !meta.pinned) {
				meta.runtimeKey = beforeKey;
				meta.runtimeVersion = before;
			}
		}
	}

	// When the pointer moves, the chunks of the release it moved AWAY from stay servable until it
	// moves again, for players still on that release's index.html. Pinned (canary) releases and the
	// flat pre-pointer layout are not kept: the flat prefix holds every chunk ever uploaded.
	const nextRetired = {};
	for (const id of new Set([...Object.keys(nextPointers), ...Object.keys(retiredImmutable)])) {
		const before = own(runtimePointers, id);
		const moved = before !== undefined && before !== own(nextPointers, id);
		if (!moved) {
			if (own(retiredImmutable, id) && own(nextPointers, id) !== undefined)
				nextRetired[id] = retiredImmutable[id];
			continue;
		}
		const files = before ? own(runtimeBundles, pointerKey(id, before)) : undefined;
		if (!files) continue;
		nextRetired[id] = Object.fromEntries(
			Object.entries(files).filter(([rel]) => rel.startsWith('_app/immutable/')),
		);
	}

	// swap in atomically; recreate mocks so balances reset on a refresh
	registry = nextRegistry;
	bundles = nextBundles;
	runtimeBundles = nextRuntimeBundles;
	runtimePointers = nextPointers;
	retiredImmutable = nextRetired;
	// Drop the poll state with the mocks it described, so the first request after a refresh re-reads
	// every game's live contract instead of coasting on the previous window.
	contracts = {};
	mocks = Object.fromEntries(
		Object.entries(nextRegistry).map(([key, meta]) => {
			const next = makeMock(
				meta.protocol,
				`mock:${key}`,
				meta.grid,
				key,
				meta.cascade,
				meta.runtime,
			);
			carryPins(own(mocks, key), next, meta.runtime);
			return [key, next];
		}),
	);
	// A twin restarts on the manifest's contract, like its player mock, and re-reads its live one on
	// the next authoring request (the poll state was just dropped). Its open tabs keep their bet table
	// for the reason `carryPins` gives: a refresh follows every publish of ANY game.
	authoringMocks = Object.fromEntries(
		Object.entries(authoringMocks).flatMap(([key, previous]) => {
			const meta = own(nextRegistry, key);
			if (!meta?.runtime) return [];
			const next = makeMock(
				meta.protocol,
				`mock:${key}/${AUTHORING}`,
				meta.grid,
				key,
				meta.cascade,
				meta.runtime,
				true,
			);
			carryPins(previous, next, meta.runtime);
			meta.authoringFingerprint = meta.fingerprint;
			return [[key, next]];
		}),
	);
}

// ---------- HTTP plumbing ----------

const send = (res, status, contentType, body) => {
	res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) });
	res.end(body);
};
const sendJson = (res, status, obj) =>
	send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj));

const indexPage = () => {
	const rows = Object.entries(registry)
		.map(([key, m]) => `<li><a href="/${key}/">${m.name}</a> <small>(${m.protocol})</small></li>`)
		.join('\n');
	return `<!doctype html><meta charset="utf-8"><title>Invisible Test Server</title>
<link rel="icon" href="/favicon.svg">
<style>body{font:16px system-ui;background:#15121a;color:#eee;margin:40px}a{color:#7ee0c0}h1{font-weight:600}small{color:#888}</style>
<h1>Invisible Test Server</h1>
<p>Games hosted here (launch via the portal, or click below):</p>
<ul>${rows || '<li><em>No games published yet.</em></li>'}</ul>`;
};

/** Own-key lookup — never resolves inherited Object members (constructor,
 *  __proto__, toString…) so a crafted game key can't slip past a truthy check. */
const own = (obj, key) => (Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined);

/** Constant-time compare against `TEST_SERVER_SECRET`. */
const secretMatches = (given) => {
	const a = Buffer.from(String(given ?? ''));
	const b = Buffer.from(SECRET);
	return a.length === b.length && timingSafeEqual(a, b);
};

const handleRequest = async (req, res) => {
	let url;
	try {
		url = new URL(req.url, `http://${req.headers.host}`);
	} catch {
		return sendJson(res, 400, { error: 'bad url' });
	}
	const pathname = url.pathname;

	// health
	if (req.method === 'GET' && pathname === '/healthz') {
		// `runtimes` = the version each runtime's pointer named at the last hydrate (null ⇒ the flat
		// pre-pointer layout); `pinned` = games serving their own release instead (canaries).
		const pinned = Object.fromEntries(
			Object.entries(registry)
				.filter(([, m]) => m.pinned)
				.map(([key, m]) => [key, m.runtimeKey]),
		);
		// `ok` = this server is serving what R2 says: a failed boot hydrate leaves nothing to serve, so
		// it answers 503 and an uptime keyword check on `"ok":true` fires. A LATER failed refresh keeps
		// serving the previous registry — still ok, but `lastHydrate.succeeded: false` says publishes
		// are not landing.
		const ok = lastHydrate.succeeded || Object.keys(registry).length > 0;
		return sendJson(res, ok ? 200 : 503, {
			ok,
			games: Object.keys(registry),
			runtimes: runtimePointers,
			pinned,
			lastHydrate,
		});
	}

	// Invisible Wall favicon for ANY favicon request — the root page and every game
	// (e.g. /favicon.ico, /hotfruits/favicon.svg). Overrides games' bundled favicons
	// so every tab is IW-branded, and kills the stray /favicon.ico 404.
	if ((req.method === 'GET' || req.method === 'HEAD') && FAVICON_DEFAULT) {
		const baseName = (pathname.split('/').pop() || '').toLowerCase();
		if (/^(favicon\.(ico|svg|png)|apple-touch-icon[\w-]*\.png)$/.test(baseName)) {
			const fav =
				own(FAVICONS, baseName) ??
				(baseName.endsWith('.png') ? FAVICONS['favicon.png'] : FAVICON_DEFAULT) ??
				FAVICON_DEFAULT;
			res.writeHead(200, {
				'Content-Type': fav.contentType,
				'Content-Length': fav.body.length,
				'Cache-Control': 'public, max-age=86400',
			});
			return req.method === 'HEAD' ? res.end() : res.end(fav.body);
		}
	}

	// re-hydrate from R2 (secret-gated when TEST_SERVER_SECRET is set)
	if (req.method === 'POST' && pathname === '/refresh') {
		const given = req.headers['x-test-server-secret'] ?? url.searchParams.get('secret');
		if (SECRET && !secretMatches(given)) {
			return sendJson(res, 403, { error: 'forbidden' });
		}
		// Respond IMMEDIATELY and hydrate in the BACKGROUND. hydrate() pulls every game
		// bundle from R2 (several seconds); the Cloudflare/Railway edge drops a POST whose
		// response is that slow, so the desktop launcher saw the connection abort (HTTP 000)
		// and reported "will refresh on next deploy" — i.e. a publish never went live
		// without a manual Railway redeploy. An instant 202 keeps the edge happy; the
		// in-flight guard coalesces overlapping refreshes (a publish + its retry).
		//
		// COALESCING IS TRAILING-EDGE, NOT A DROP, and that distinction is load-bearing. A refresh
		// that arrives mid-hydrate is asking about a write made AFTER the in-flight pass started
		// reading, so answering it with that pass's result silently loses the write. One publish
		// does exactly this: the desktop launcher POSTs /refresh, and moments later
		// `/api/launcher/register-game` re-stamps the project pin and POSTs again — the second
		// request was dropped, so the pin sat in R2 unread while the running registry kept the
		// unpinned entry the first pass had loaded. Queueing ONE follow-up pass fixes the whole
		// class (a queue of depth 1 is enough: any number of requests during a hydrate are all
		// satisfied by a single re-read that starts after the last of them).
		if (refreshing) {
			refreshPending = true;
			return sendJson(res, 202, { status: 'already-refreshing', queued: true });
		}
		refreshing = true;
		const runHydrate = () =>
			hydrate()
				.then(() => console.info('[test-server] refreshed via POST /refresh'))
				.catch((e) => console.error('[test-server] refresh failed:', e))
				.finally(() => {
					if (!refreshPending) {
						refreshing = false;
						return;
					}
					// Someone wrote while we were reading — go round once more, still holding
					// `refreshing` so a third request coalesces into THIS follow-up rather than
					// starting a parallel hydrate.
					refreshPending = false;
					console.info('[test-server] a refresh arrived mid-hydrate — re-reading');
					void runHydrate();
				});
		void runHydrate();
		return sendJson(res, 202, { status: 'refreshing' });
	}

	// mock RGS: /api/<gameKey>/...  → dispatch to that game's mock (matches by suffix)
	if (pathname.startsWith('/api/')) {
		const [, , gameKey, channelSegment] = pathname.split('/');
		if (!own(mocks, gameKey)) return sendJson(res, 404, { error: `unknown game '${gameKey}'` });
		const meta = own(registry, gameKey);
		// Only a runtime game has a separate authoring contract; a standalone build's one mock already
		// follows live data, so its authoring links are simply served by it.
		const channel = channelSegment === AUTHORING && meta.runtime ? AUTHORING : undefined;
		if (channel && !own(authoringMocks, gameKey)) {
			swapMock(
				gameKey,
				{ protocol: meta.protocol, cascade: meta.cascade, grid: meta.grid },
				AUTHORING,
			);
		}
		// Re-read the contract this channel's client boots first (TTL-throttled, best-effort) so a
		// publish — or, for the twin, a board resized in `/config` — is dealt on THIS spin. May replace
		// the channel's mock.
		await refreshContract(gameKey, channel);
		const mock = own(channel ? authoringMocks : mocks, gameKey);
		const answering = mockForSession(
			mock,
			url.searchParams.get('sid'),
			url.searchParams.get('gid'),
		);
		const platform = platformJackpotFor(gameKey, meta, channel);
		return platform
			? platform.handle(req, res, url, answering.handle)
			: answering.handle(req, res, url);
	}

	// root index
	if (req.method === 'GET' && pathname === '/') {
		return send(res, 200, 'text/html; charset=utf-8', Buffer.from(indexPage()));
	}

	// game bundle: /<gameKey>/<relPath>  (relPath defaults to index.html)
	if (req.method === 'GET' || req.method === 'HEAD') {
		const segments = pathname.replace(/^\/+/, '').split('/');
		const gameKey = segments[0];
		// A game with a `runtime` is served from the shared generic bundle; otherwise
		// from its own per-key files. Resolving via the registry keeps an unknown key 404.
		const meta = own(registry, gameKey);
		const files = meta
			? meta.runtime
				? own(runtimeBundles, meta.runtimeKey)
				: own(bundles, gameKey)
			: undefined;
		if (files) {
			const rel = segments.slice(1).join('/') || 'index.html';
			const file =
				own(files, rel) ??
				(rel.endsWith('/') ? own(files, `${rel}index.html`) : undefined) ??
				(meta.runtime && rel.startsWith('_app/immutable/')
					? own(own(retiredImmutable, meta.runtime) ?? {}, rel)
					: undefined);
			const hostConfig = file && rel === 'index.html' ? hostConfigFor(meta, url) : null;
			const body = hostConfig
				? Buffer.from(injectHostSettings(file.body.toString('utf8'), hostConfig))
				: file?.body;
			if (file) {
				// Content-hashed bundle files (SvelteKit `_app/immutable/…`) get a new
				// URL on every build, so they're safe to cache forever. Everything else
				// — `index.html` AND the game's own `assets/…` (which keep STABLE
				// filenames across re-deploys, e.g. `assets/sprites/reelsFrame/
				// reels_frame.webp`) — must NOT be cached, or a re-publish serves stale
				// art until a hard refresh. `no-store` also stops the CDN/browser from
				// holding the old file (the bug where a redeployed atlas never showed).
				const immutable = rel.startsWith('_app/immutable/');
				const headers = {
					'Content-Type': file.contentType,
					'Content-Length': body.length,
					'Cache-Control': immutable
						? 'public, max-age=31536000, immutable'
						: 'no-store, must-revalidate',
					// Which runtime release answered — what the release/rollback checks compare.
					...(meta.runtime ? { 'X-Runtime-Release': meta.runtimeKey } : {}),
				};
				if (req.method === 'HEAD') {
					res.writeHead(200, headers);
					return res.end();
				}
				res.writeHead(200, headers);
				return res.end(body);
			}
			return send(res, 404, 'text/plain; charset=utf-8', Buffer.from(`not found: ${rel}`));
		}
	}

	return sendJson(res, 404, { error: 'not found' });
};

const server = createServer(async (req, res) => {
	try {
		await handleRequest(req, res);
	} catch (err) {
		console.error('[test-server] request error:', err);
		if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
		else res.end();
	}
});

/** A failed boot hydrate leaves 0 games; keep retrying in the background until one lands (a POST
 *  /refresh in between can land it sooner). */
function retryBootHydrate(attempt = 1) {
	setTimeout(
		() => {
			if (Object.keys(registry).length > 0) return;
			hydrate()
				.then(() => console.info(`[test-server] boot hydrate succeeded on retry ${attempt}`))
				.catch((e) => {
					console.error(`[test-server] boot hydrate retry ${attempt} failed:`, e.message);
					retryBootHydrate(attempt + 1);
				});
		},
		Math.min(60_000, 5_000 * attempt),
	);
}

hydrate()
	.catch((e) => {
		console.error('[test-server] initial hydrate failed:', e);
		retryBootHydrate();
	})
	.finally(() => {
		server.listen(PORT, () => {
			console.log(
				[
					'',
					'   ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
					'   ┃   I N V I S I B L E   W A L L   S L',
					'   ┃   ────────────────────────────────────────',
					'   ┃   INVISIBLE TEST SERVER',
					'   ┃',
					`        :${PORT}   ·   games: ${Object.keys(registry).join(', ') || '(none)'}`,
					'',
				].join('\n'),
			);
		});
	});
