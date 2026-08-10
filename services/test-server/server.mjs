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
 * Games are PUBLISHED to R2 by apps/launcher-api/scripts/publish-game-bundle.mjs.
 *
 * Env:
 *   PORT=8080
 *   R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY   (read)
 *   TEST_SERVER_SECRET   (optional) — required as ?secret= on POST /refresh
 *   TEST_SERVER_LOCAL    (optional) — local dev: hydrate from this directory
 *                        instead of R2. Layout mirrors R2: <dir>/games.json +
 *                        <dir>/<gameKey>/index.html. No R2 creds needed.
 */

import { createServer } from 'node:http';
import { extname, join, relative, sep, dirname } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createMockRgs as createLinesMock } from '../../scripts/mock-rgs-server.mjs';
import { createMockRgs as createBookMock } from '../../scripts/mock-rgs-server-book.mjs';

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

/** gameKey -> { protocol, name, runtime } (runtime = shared bundle id, or null) */
let registry = {};
/** gameKey -> { '<relPath>': { body: Buffer, contentType: string } } (per-key bundles) */
let bundles = {};
/** runtimeId -> files map — ONE prebuilt generic engine bundle (test_server/_runtime/<id>/)
 *  shared by every Game-Maker game whose manifest entry sets `runtime: "<id>"`. The game
 *  boots that bundle with `?runtime=1&project=<key>&k=<readToken>` and fetches its layout +
 *  assets live from the launcher — so publishing a game is a manifest entry, not a build. */
let runtimeBundles = {};
/** gameKey -> mock instance ({ handle }) */
let mocks = {};
/** in-flight guard so overlapping POST /refresh calls coalesce into one hydrate */
let refreshing = false;

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
		const rows = Math.max(1, Math.round(Math.max(...(doc.numRows ?? [3]))));
		const paylines = Object.values(doc.paylines ?? {});
		if (!Number.isFinite(reels) || !paylines.length) return null;
		return { reels, rows, paylines };
	} catch {
		return null;
	}
})();

// `grid` is THIS project's own board (from its Game Config, carried in the manifest entry). When
// present it deals the project's real numReels/numRows/paylines so the mock matches the client that
// authored e.g. 5 rows; absent ⇒ the shared `linesGrid` default (apps/lines). Book keeps its shape.
const makeMock = (protocol, label, grid) =>
	protocol === 'book'
		? createBookMock({ label })
		: createLinesMock({ label, ...(grid ?? linesGrid ?? {}) });

/** Accept a manifest `grid` only when it is well-formed (reels + rows + numReels-wide paylines); any
 *  malformed entry ⇒ null ⇒ the mock keeps its shared default. Defensive: the manifest is external.
 *  A well-formed `wild` ({ paytable: occurs→multiplier }) is passed through so the mock deals + pays
 *  the project's in-play wild; a malformed wild is simply dropped (the grid still stands). */
const validGrid = (grid) => {
	if (!grid || typeof grid !== 'object') return null;
	const reels = Math.round(Number(grid.reels));
	const rows = Math.round(Number(grid.rows));
	const paylines = Array.isArray(grid.paylines) ? grid.paylines : [];
	const shaped =
		reels > 0 &&
		rows > 0 &&
		paylines.length > 0 &&
		paylines.every((line) => Array.isArray(line) && line.length === reels);
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
	return {
		reels,
		rows,
		paylines,
		...(wild ? { wild } : {}),
		...(stacked ? { stacked: true } : {}),
		...(symbols ? { symbols } : {}),
	};
};

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

/** Read manifest JSON + per-game files. Returns { games, readFiles(key) } where
 *  readFiles yields [relPath, { body, contentType }] for a game's bundle. */
async function loadSource() {
	if (LOCAL_DIR) {
		const manifest = JSON.parse(await readFile(join(LOCAL_DIR, 'games.json'), 'utf8'));
		return {
			games: manifest?.games ?? {},
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
		readFiles: async (key) => {
			const out = [];
			const prefix = `${BUNDLE_PREFIX}${key}/`;
			let token;
			do {
				const list = await client.send(
					new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
				);
				for (const obj of list.Contents ?? []) {
					if (obj.Key.endsWith('/')) continue;
					const rel = obj.Key.slice(prefix.length);
					const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: obj.Key }));
					out.push([
						rel,
						{ body: await streamToBuffer(got.Body), contentType: mimeFor(rel, got.ContentType) },
					]);
				}
				token = list.IsTruncated ? list.NextContinuationToken : undefined;
			} while (token);
			return out;
		},
	};
}

/** Load the manifest + every game's files (from R2 or LOCAL_DIR) into memory. */
async function hydrate() {
	let source;
	try {
		source = await loadSource();
	} catch (e) {
		console.warn(`[test-server] no manifest (${e.name ?? e.message}) — serving 0 games`);
		registry = {};
		bundles = {};
		runtimeBundles = {};
		mocks = {};
		return;
	}

	const nextRegistry = {};
	const nextBundles = {};
	const runtimeIds = new Set();
	for (const [key, meta] of Object.entries(source.games)) {
		const protocol = meta.protocol === 'book' ? 'book' : 'lines';
		const runtime = typeof meta.runtime === 'string' && meta.runtime ? meta.runtime : null;
		nextRegistry[key] = { protocol, name: meta.name ?? key, runtime, grid: validGrid(meta.grid) };
		if (runtime) {
			// Served from the shared runtime bundle (loaded once below) — no per-key files.
			runtimeIds.add(runtime);
			console.info(
				`[test-server] registered '${key}' (${protocol}) → runtime '_runtime/${runtime}'`,
			);
		} else {
			nextBundles[key] = Object.fromEntries(await source.readFiles(key));
			console.info(
				`[test-server] hydrated '${key}' (${protocol}) — ${Object.keys(nextBundles[key]).length} file(s)`,
			);
		}
	}

	// Load each referenced generic runtime bundle once (test_server/_runtime/<id>/).
	const nextRuntimeBundles = {};
	for (const id of runtimeIds) {
		nextRuntimeBundles[id] = Object.fromEntries(await source.readFiles(`_runtime/${id}`));
		const n = Object.keys(nextRuntimeBundles[id]).length;
		if (n === 0)
			console.warn(
				`[test-server] runtime '_runtime/${id}' has 0 files — games using it won't load until it's published`,
			);
		else console.info(`[test-server] hydrated runtime '_runtime/${id}' — ${n} file(s)`);
	}

	// swap in atomically; recreate mocks so balances reset on a refresh
	registry = nextRegistry;
	bundles = nextBundles;
	runtimeBundles = nextRuntimeBundles;
	mocks = Object.fromEntries(
		Object.entries(nextRegistry).map(([key, meta]) => [
			key,
			makeMock(meta.protocol, `mock:${key}`, meta.grid),
		]),
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
		return sendJson(res, 200, { ok: true, games: Object.keys(registry) });
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
		if (SECRET && url.searchParams.get('secret') !== SECRET) {
			return sendJson(res, 403, { error: 'forbidden' });
		}
		// Respond IMMEDIATELY and hydrate in the BACKGROUND. hydrate() pulls every game
		// bundle from R2 (several seconds); the Cloudflare/Railway edge drops a POST whose
		// response is that slow, so the desktop launcher saw the connection abort (HTTP 000)
		// and reported "will refresh on next deploy" — i.e. a publish never went live
		// without a manual Railway redeploy. An instant 202 keeps the edge happy; the
		// in-flight guard coalesces overlapping refreshes (a publish + its retry).
		if (refreshing) return sendJson(res, 202, { status: 'already-refreshing' });
		refreshing = true;
		hydrate()
			.then(() => console.info('[test-server] refreshed via POST /refresh'))
			.catch((e) => console.error('[test-server] refresh failed:', e))
			.finally(() => {
				refreshing = false;
			});
		return sendJson(res, 202, { status: 'refreshing' });
	}

	// mock RGS: /api/<gameKey>/...  → dispatch to that game's mock (matches by suffix)
	if (pathname.startsWith('/api/')) {
		const gameKey = pathname.split('/')[2];
		const mock = own(mocks, gameKey);
		if (!mock) return sendJson(res, 404, { error: `unknown game '${gameKey}'` });
		return mock.handle(req, res, url);
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
				? own(runtimeBundles, meta.runtime)
				: own(bundles, gameKey)
			: undefined;
		if (files) {
			const rel = segments.slice(1).join('/') || 'index.html';
			const file =
				own(files, rel) ?? (rel.endsWith('/') ? own(files, `${rel}index.html`) : undefined);
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
					'Content-Length': file.body.length,
					'Cache-Control': immutable
						? 'public, max-age=31536000, immutable'
						: 'no-store, must-revalidate',
				};
				if (req.method === 'HEAD') {
					res.writeHead(200, headers);
					return res.end();
				}
				res.writeHead(200, headers);
				return res.end(file.body);
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

hydrate()
	.catch((e) => console.error('[test-server] initial hydrate failed:', e))
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
