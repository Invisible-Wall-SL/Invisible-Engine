// What a published game boots, served locally:
//   - a SNAPSHOT server standing in for the launcher: `GET /api/editor/runtime` answers the frozen
//     `runtime.json` exactly as `snapshotResponse` does (`{ assetBase, name, ...bundle, published }`),
//     and `/f/<rel>` serves the frozen `deploy/` files `assetBase` points at;
//   - the real Invisible Test Server (`services/test-server/server.mjs`) in local mode, serving the
//     runtime under test at `/<gameKey>/` and the game's mock RGS at `/api/<gameKey>/…`, dealt from
//     the game's manifest entry (the contract frozen at its publish). The launcher pointer
//     (`docBase` / `readToken`) is dropped, so the mock never follows live data mid-run.
// A fresh test server per render: the seeded deal starts over, and the scenario's forcing env
// (`SEED`, `FORCE_TRIGGER`, `WIN_X`, `FORCE`…) is that process's alone.

import { spawn } from 'node:child_process';
import {
	createReadStream,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');

const TYPES = {
	'.json': 'application/json',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.jpg': 'image/jpeg',
	'.svg': 'image/svg+xml',
	'.atlas': 'text/plain',
	'.ktx2': 'application/octet-stream',
	'.mp3': 'audio/mpeg',
	'.ogg': 'audio/ogg',
	'.webm': 'video/webm',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
	'.fnt': 'text/plain',
};

const listen = (server) =>
	new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server.address().port)));

/**
 * Serve one snapshot folder (`runtime.json` + `deploy/`). `assetBase(origin)` overrides where the
 * game fetches its files — a fixture whose assets ship inside the runtime build points it there.
 * `bundleFile` serves another `runtime.json` over the same `deploy/` files: the "as republished"
 * variant of the snapshot (`builtins.mjs`).
 */
export async function serveSnapshot({ dir, name, snapshotId, assetBase, bundleFile }) {
	const bundle = JSON.parse(readFileSync(bundleFile ?? join(dir, 'runtime.json'), 'utf8'));
	const deploy = resolve(dir, 'deploy');
	const cors = { 'Access-Control-Allow-Origin': '*' };
	const server = createServer((req, res) => {
		const url = new URL(req.url, 'http://x');
		if (url.pathname === '/api/editor/runtime') {
			const body = JSON.stringify({
				assetBase: assetBase ?? `${origin}/f/`,
				name,
				...bundle,
				published: { id: snapshotId, createdAt: null },
			});
			res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
			return res.end(body);
		}
		if (url.pathname.startsWith('/f/')) {
			let rel;
			try {
				rel = decodeURIComponent(url.pathname.slice(3));
			} catch {
				res.writeHead(400, cors);
				return res.end();
			}
			const file = resolve(deploy, rel);
			if (file.startsWith(deploy + sep) && existsSync(file) && statSync(file).isFile()) {
				res.writeHead(200, {
					...cors,
					'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
				});
				return createReadStream(file).pipe(res);
			}
		}
		res.writeHead(404, cors);
		res.end();
	});
	const port = await listen(server);
	const origin = `http://127.0.0.1:${port}`;
	return { origin, close: () => new Promise((ok) => server.close(ok)) };
}

/**
 * A local test-server tree for one game on one runtime: `games.json` with the game's entry (served
 * from the shared runtime, launcher pointer dropped) and `_runtime/lines` → the runtime build.
 */
export function testServerTree(work, runtimeDir, gameKey, entry) {
	mkdirSync(join(work, '_runtime'), { recursive: true });
	const link = join(work, '_runtime', 'lines');
	// Re-pointed every time: a tree reused for another runtime must never keep the old one.
	rmSync(link, { force: true, recursive: false });
	symlinkSync(resolve(runtimeDir), link, 'junction');
	const game = { ...entry, runtime: 'lines' };
	for (const key of ['docBase', 'readToken', 'runtimeVersion']) delete game[key];
	writeFileSync(
		join(work, 'games.json'),
		JSON.stringify({ games: { [gameKey]: game } }, null, '\t'),
	);
	return work;
}

const freePort = async () => {
	const server = createServer();
	const port = await listen(server);
	await new Promise((ok) => server.close(ok));
	return port;
};

/** Start the test server on `tree` with `env`; resolves once `/healthz` answers. */
export async function startTestServer(tree, env) {
	const port = await freePort();
	const child = spawn(process.execPath, ['services/test-server/server.mjs'], {
		cwd: ROOT,
		env: {
			PATH: process.env.PATH,
			HOME: process.env.HOME,
			PORT: String(port),
			TEST_SERVER_LOCAL: tree,
			...env,
		},
		stdio: ['ignore', 'ignore', 'pipe'],
	});
	let stderr = '';
	child.stderr.on('data', (c) => (stderr = (stderr + c).slice(-4000)));
	const origin = `http://127.0.0.1:${port}`;
	for (let i = 0; i < 300; i++) {
		const up = await fetch(`${origin}/healthz`).then(
			(r) => r.ok,
			() => false,
		);
		if (up) return { origin, port, log: () => stderr, stop: () => child.kill() };
		if (child.exitCode !== null) break;
		await new Promise((r) => setTimeout(r, 100));
	}
	child.kill();
	throw new Error(`test server did not start: ${stderr.slice(-800)}`);
}
