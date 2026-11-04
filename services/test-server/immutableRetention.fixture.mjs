/**
 * The test server's caching contract for a shell + bundle game build, over the REAL server
 * (`TEST_SERVER_LOCAL`), offline, in a few seconds:
 *
 *   - `index.html` and `assets/…` are `no-store`; `_app/immutable/…` is `max-age=31536000, immutable`;
 *   - a page loaded just before a change still finds its chunks: the previous `_app/immutable/…`
 *     stays servable for ONE generation after a runtime pointer flip (`retiredImmutable`) and after a
 *     desktop game's republish (`retiredGameImmutable`), then 404s;
 *   - a bare `/<gameKey>` answers 301 to `/<gameKey>/` with its query (the shell's URLs are relative).
 *
 *     node services/test-server/immutableRetention.fixture.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('./server.mjs', import.meta.url));
const IMMUTABLE = 'public, max-age=31536000, immutable';

let failures = 0;
const check = (name, ok, detail = '') => {
	console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — ${detail}`}`);
	if (!ok) failures += 1;
};

/** A build: a shell naming its bundle (+ `marker`, to tell publishes apart) and its chunks. */
const writeBuild = (dir, { marker, chunks }) => {
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(join(dir, '_app/immutable/chunks'), { recursive: true });
	mkdirSync(join(dir, 'assets'), { recursive: true });
	writeFileSync(
		join(dir, 'index.html'),
		`<!doctype html><script>import("./_app/immutable/bundle.${marker}.js")</script><!-- ${marker} -->`,
	);
	writeFileSync(join(dir, `_app/immutable/bundle.${marker}.js`), `export const m = '${marker}';\n`);
	for (const chunk of chunks)
		writeFileSync(join(dir, '_app/immutable/chunks', chunk), `export const c = '${chunk}';\n`);
	writeFileSync(join(dir, 'assets/art.json'), '{}');
};

const work = mkdtempSync(join(tmpdir(), 'ie-test-server-retention-'));
const RUNTIME_GAME = 'rtgame';
const DESKTOP_GAME = 'dtgame';
mkdirSync(join(work, '_runtime/lines'), { recursive: true });
writeBuild(join(work, '_runtime/lines@a'), { marker: 'A', chunks: ['onlyA.js', 'both.js'] });
writeBuild(join(work, '_runtime/lines@b'), { marker: 'B', chunks: ['both.js'] });
writeBuild(join(work, '_runtime/lines@c'), { marker: 'C', chunks: ['both.js'] });
const point = (version) =>
	writeFileSync(join(work, '_runtime/lines/current.json'), JSON.stringify({ version }));
point('a');
writeBuild(join(work, DESKTOP_GAME), { marker: 'D1', chunks: ['first.js', 'kept.js'] });
writeFileSync(
	join(work, 'games.json'),
	JSON.stringify({
		games: {
			[RUNTIME_GAME]: { name: 'Runtime game', protocol: 'lines', runtime: 'lines' },
			[DESKTOP_GAME]: { name: 'Desktop game', protocol: 'lines' },
		},
	}),
);

const port = await new Promise((resolve) => {
	const probe = createServer().listen(0, '127.0.0.1', () => {
		const { port: free } = probe.address();
		probe.close(() => resolve(free));
	});
});
const env = Object.fromEntries(
	Object.entries(process.env).filter(([k]) => !k.startsWith('R2_') && k !== 'TEST_SERVER_SECRET'),
);
const server = spawn(process.execPath, [SERVER], {
	env: { ...env, PORT: String(port), TEST_SERVER_LOCAL: work },
	stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
const ORIGIN = `http://127.0.0.1:${port}`;
const get = (path) => fetch(`${ORIGIN}${path}`, { redirect: 'manual' }).catch(() => null);

/** Wait until `/<key>/` serves a shell carrying `marker` (a hydrate has landed). */
const serving = async (key, marker) => {
	for (let i = 0; i < 200; i++) {
		const res = await get(`/${key}/index.html?cb=${Date.now()}`);
		if (res?.ok && (await res.text()).includes(`<!-- ${marker} -->`)) return true;
		await new Promise((r) => setTimeout(r, 50));
	}
	return false;
};
const refresh = () => fetch(`${ORIGIN}/refresh`, { method: 'POST' });
const status = async (path) => (await get(path))?.status;

try {
	check(
		'the server boots and serves both games',
		(await serving(RUNTIME_GAME, 'A')) && (await serving(DESKTOP_GAME, 'D1')),
		log.slice(-600),
	);

	const shell = await get(`/${RUNTIME_GAME}/index.html`);
	const bundle = await get(`/${RUNTIME_GAME}/_app/immutable/bundle.A.js`);
	const asset = await get(`/${DESKTOP_GAME}/assets/art.json`);
	check('the shell is no-store', /no-store/.test(shell?.headers.get('cache-control') ?? ''));
	check('the bundle is immutable', bundle?.headers.get('cache-control') === IMMUTABLE);
	check('assets/ are no-store', /no-store/.test(asset?.headers.get('cache-control') ?? ''));

	const bare = await get(`/${RUNTIME_GAME}?runtime=1&sessionID=demo`);
	check(
		'a bare /<gameKey> answers 301 to /<gameKey>/, query kept',
		bare?.status === 301 &&
			bare.headers.get('location') === `/${RUNTIME_GAME}/?runtime=1&sessionID=demo`,
		`${bare?.status} ${bare?.headers.get('location')}`,
	);

	// Runtime: a → b keeps a's chunks; b → c drops them.
	point('b');
	await refresh();
	check('runtime: the pointer moves to b', await serving(RUNTIME_GAME, 'B'));
	const retired = await get(`/${RUNTIME_GAME}/_app/immutable/chunks/onlyA.js`);
	check(
		"runtime: a's chunk is still served, immutable",
		retired?.status === 200 && retired.headers.get('cache-control') === IMMUTABLE,
		`${retired?.status}`,
	);
	point('c');
	await refresh();
	check('runtime: the pointer moves to c', await serving(RUNTIME_GAME, 'C'));
	check(
		'runtime: …for one generation only',
		(await status(`/${RUNTIME_GAME}/_app/immutable/chunks/onlyA.js`)) === 404,
	);

	// Desktop: two republishes, each dropping a chunk.
	writeBuild(join(work, DESKTOP_GAME), { marker: 'D2', chunks: ['kept.js'] });
	await refresh();
	check('desktop: the first republish is live', await serving(DESKTOP_GAME, 'D2'));
	const kept = await get(`/${DESKTOP_GAME}/_app/immutable/chunks/first.js`);
	check(
		"desktop: the previous publish's chunk is still served, immutable",
		kept?.status === 200 && kept.headers.get('cache-control') === IMMUTABLE,
		`${kept?.status}`,
	);
	check(
		'desktop: so is its bundle',
		(await status(`/${DESKTOP_GAME}/_app/immutable/bundle.D1.js`)) === 200,
	);
	await refresh();
	await serving(DESKTOP_GAME, 'D2');
	check(
		'desktop: a refresh that changes nothing keeps it',
		(await status(`/${DESKTOP_GAME}/_app/immutable/chunks/first.js`)) === 200,
	);
	writeBuild(join(work, DESKTOP_GAME), { marker: 'D3', chunks: [] });
	await refresh();
	check('desktop: the second republish is live', await serving(DESKTOP_GAME, 'D3'));
	check(
		'desktop: the first publish is gone, the second retired',
		(await status(`/${DESKTOP_GAME}/_app/immutable/chunks/first.js`)) === 404 &&
			(await status(`/${DESKTOP_GAME}/_app/immutable/chunks/kept.js`)) === 200,
	);
} finally {
	server.kill();
	rmSync(work, { recursive: true, force: true });
}

if (failures) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\ntest-server immutable retention: all checks passed');
