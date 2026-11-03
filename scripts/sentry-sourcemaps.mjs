// Upload the runtime bundle's source maps to Sentry — and make sure none of them ships.
//
//   node scripts/sentry-sourcemaps.mjs runtime apps/lines/build [--out <dir>] [--dry-run] [--strict]
//   node scripts/sentry-sourcemaps.mjs launcher apps/launcher-api/build [--dry-run]
//   node scripts/sentry-sourcemaps.mjs verify apps/lines/build
//
// `launcher` is the launcher's post-build step — see `launcher()` below. The rest is the runtime:
//
// `runtime` expects a build made with `IE_SOURCEMAPS=hidden` (packages/config-vite). It
//   1. pairs every shipped chunk under `_app/immutable/` with its map, by the debug ID the build
//      wrote into the chunk (`config-vite/debugIds.js`: a `_sentryDebugIds` snippet the SDK reads
//      to name the map for any frame, and a `//# debugId=` comment),
//   2. stages each chunk + its map OUTSIDE the build folder, the map stamped with the same debug ID,
//   3. deletes every `.map` from the build and fails unless `verify` then passes,
//   4. uploads the staged files with `sentry-cli`, for the release the SDK reports.
// Step 4 is skipped, with a notice, when SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT is unset,
// and a failed upload is a warning: reporting must never be the thing that holds an engine release.
// `--dry-run` runs step 4 against a local stand-in for Sentry's upload API and checks what arrived.
// A shipped chunk with no map, or a map whose chunk carries no debug ID, is reported as a
// `::warning::` (it would have unreadable frames); `--strict` (the fixtures) makes it fatal.
//
// `verify` is the gate: no `.map` file and no `sourceMappingURL` anywhere under the folder. The repo
// and every served bundle are public, so a map next to the bundle would publish the whole source.
//
// The game is an `index.html` shell that imports `_app/immutable/bundle.<hash>.js`, an ES module,
// and its lazy chunks (`config-svelte`, `config-vite/lazyChunks.js`), so every frame names a chunk
// file and its own map describes it as built. Until 2026-11 the bundle was INLINED into the page,
// which needed the map re-based onto `index.html` — and the inline strategy of the SvelteKit 2.70 the
// repo moved to on 2026-10-01 deletes the emitted bundle and its map, so from then on nothing was
// uploaded (`docs/knowledge/lessons/infra.md`).

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { DEBUG_ID_COMMENT } from '../packages/config-vite/debugIds.js';

/** Pinned: `pnpm dlx` fetches it only when there is something to upload. */
export const SENTRY_CLI = '@sentry/cli@3.8.0';

const MAP_REFERENCE = /[#@]\s*sourceMappingURL\s*=/;
const SCANNED = new Set(['.html', '.htm', '.js', '.mjs', '.cjs', '.css']);

const walk = (dir) =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) return walk(full);
		return entry.isFile() ? [full] : [];
	});

/** Every way a build folder could publish a map: a `.map` file, or a reference to one. */
export function sourceMapLeaks(buildDir) {
	const leaks = [];
	for (const file of walk(buildDir)) {
		const rel = relative(buildDir, file).split(sep).join('/');
		if (file.endsWith('.map')) leaks.push(`${rel} is a source map`);
		else if (
			SCANNED.has(extname(file).toLowerCase()) &&
			MAP_REFERENCE.test(readFileSync(file, 'utf8'))
		)
			leaks.push(`${rel} references a source map (sourceMappingURL)`);
	}
	return leaks;
}

/** The debug ID a chunk was built with (`config-vite/debugIds.js`), or null. */
export const debugIdOf = (code) => DEBUG_ID_COMMENT.exec(code)?.[1] ?? null;

/**
 * Steps 1–2: every chunk under `_app/immutable/` that has a map, staged under `outDir` at the same
 * relative path, with the map stamped with the chunk's debug ID. `problems` names each shipped
 * chunk that would have unreadable frames: one with no map, or one built without a debug ID.
 */
export function stageMaps(buildDir, outDir) {
	const immutable = join(buildDir, '_app', 'immutable');
	const chunks = [];
	const problems = [];
	for (const file of walk(immutable)) {
		if (extname(file) !== '.js') continue;
		const rel = relative(buildDir, file).split(sep).join('/');
		const code = readFileSync(file, 'utf8');
		const id = debugIdOf(code);
		let map;
		try {
			map = JSON.parse(readFileSync(`${file}.map`, 'utf8'));
		} catch {
			// No map: a build made without IE_SOURCEMAPS=hidden, a re-run after the strip, or a file
			// Vite copied rather than built (the KTX2 transcoder).
		}
		if (!map) {
			if (id) problems.push(`${rel} carries a debug ID but has no map`);
			continue;
		}
		if (!id) {
			problems.push(`${rel} has a map but no debug ID (built without config-vite's debugIds.js)`);
			continue;
		}
		const staged = join(outDir, rel);
		mkdirSync(dirname(staged), { recursive: true });
		writeFileSync(staged, `${code}//# sourceMappingURL=${basename(file)}.map\n`);
		writeFileSync(
			`${staged}.map`,
			JSON.stringify({
				...map,
				// Vite writes each source relative to the chunk's folder under
				// `.svelte-kit/output/client/`, which climbs to the repo root; without the climb Sentry
				// shows repo paths.
				sources: map.sources.map((s) => s.replace(/^(\.\.\/)+/, '')),
				debugId: id,
				debug_id: id,
			}),
		);
		chunks.push({ file: rel, debugId: id });
	}
	return { chunks, problems };
}

/**
 * Steps 1–3. Returns what to upload, or `null` (with the reason logged) when there is nothing. Only
 * step 3 can fail it (and, with `strict`, a chunk with unreadable frames, AFTER the strip): a map
 * that will not fit costs readable traces, a map left in the build would publish the source.
 */
export function prepareRuntime(buildDir, outDir, { strict = false } = {}) {
	const { chunks, problems } = stageMaps(buildDir, outDir);
	for (const problem of problems) console.log(`::warning::Source map not staged: ${problem}`);
	if (chunks.length)
		console.info(
			`Staged ${chunks.length} chunk map(s) for Sentry: ${chunks.map((c) => c.file).join(', ')}.`,
		);
	else console.warn('No chunk source map in the build — nothing to upload.');

	for (const file of walk(buildDir)) if (file.endsWith('.map')) rmSync(file);
	const leaks = sourceMapLeaks(buildDir);
	if (leaks.length) throw new Error(`source maps would ship:\n  ${leaks.join('\n  ')}`);
	if (strict && problems.length)
		throw new Error(`chunks without a usable map:\n  ${problems.join('\n  ')}`);
	return chunks.length ? { dir: outDir, chunks } : null;
}

/**
 * The release each SDK reports. The game: `__IE_BUILD__.sha` cut to 12 (apps/lines errorTracking.ts).
 * The launcher server: Railway's whole `RAILWAY_GIT_COMMIT_SHA`. Debug IDs resolve without it; it
 * files the upload under the release its events carry.
 */
const releaseFor = (mode) =>
	process.env.SENTRY_RELEASE ||
	(mode === 'launcher'
		? process.env.RAILWAY_GIT_COMMIT_SHA || ''
		: (process.env.PUBLIC_BUILD_SHA || process.env.GITHUB_SHA || '').slice(0, 12));

const run = (cmd, args, env) =>
	new Promise((done) => {
		const child = spawn(cmd, args, { env, stdio: 'inherit', shell: process.platform === 'win32' });
		child.on('close', (code) => done(code ?? 1));
		child.on('error', () => done(1));
	});

export const uploadArgs = ({ dir, org, project, release }) => [
	'dlx',
	SENTRY_CLI,
	'sourcemaps',
	'upload',
	'--org',
	org,
	'--project',
	project,
	...(release ? ['--release', release] : []),
	'--validate',
	dir,
];

const uploadConfigured = () =>
	!!(process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT);

// An unset Actions/Railway variable can arrive as '' — and sentry-cli reads an empty SENTRY_URL as a URL.
const cliEnv = () =>
	Object.fromEntries(
		Object.entries(process.env).filter(([k, v]) => !(k.startsWith('SENTRY_') && v === '')),
	);

/** The real upload. Never throws: a missing token is a notice, a failed upload a warning. */
async function upload(dir, release) {
	if (!uploadConfigured()) {
		console.info(
			'Source maps not uploaded: set SENTRY_AUTH_TOKEN (secret) and SENTRY_ORG / SENTRY_PROJECT ' +
				'to get readable stack traces. The maps were still stripped from the build.',
		);
		return;
	}
	const { SENTRY_ORG: org, SENTRY_PROJECT: project } = process.env;
	const code = await run('pnpm', uploadArgs({ dir, org, project, release }), cliEnv());
	if (code === 0) console.info(`Uploaded source maps for release ${release || '(none)'}.`);
	else
		console.log(
			`::warning::Sentry source-map upload failed (exit ${code}) — stack traces stay minified.`,
		);
}

// ── --dry-run: the real sentry-cli against a local stand-in for Sentry's upload API ─────────────

/** Read the files of a zip (the artifact bundle) — stored or deflated entries, nothing fancier. */
export function readZip(buffer) {
	const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	if (eocd < 0) throw new Error('not a zip');
	const count = buffer.readUInt16LE(eocd + 10);
	let at = buffer.readUInt32LE(eocd + 16);
	const files = {};
	for (let i = 0; i < count; i++) {
		const method = buffer.readUInt16LE(at + 10);
		const size = buffer.readUInt32LE(at + 20);
		const nameLength = buffer.readUInt16LE(at + 28);
		const skip = nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
		const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
		const local = buffer.readUInt32LE(at + 42);
		const data = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
		const raw = buffer.subarray(data, data + size);
		files[name] = method === 8 ? inflateRawSync(raw) : raw;
		at += 46 + skip;
	}
	return files;
}

/** Split a multipart body into its parts' raw bytes (chunk uploads are `file_gzip` parts). */
const multipartParts = (body, contentType) => {
	const boundary = Buffer.from(`--${/boundary=([^;]+)/.exec(contentType)?.[1]?.replace(/"/g, '')}`);
	const parts = [];
	let start = body.indexOf(boundary);
	while (start >= 0) {
		const next = body.indexOf(boundary, start + boundary.length);
		if (next < 0) break;
		const part = body.subarray(start + boundary.length + 2, next - 2);
		const split = part.indexOf('\r\n\r\n');
		if (split >= 0)
			parts.push({ head: part.subarray(0, split).toString(), data: part.subarray(split + 4) });
		start = next;
	}
	return parts;
};

/**
 * Just enough of Sentry's chunk-upload + artifact-bundle-assemble API for sentry-cli to finish an
 * upload, keeping what it sent. Anything else it asks for is recorded and answered with `{}`.
 */
export async function fakeSentry() {
	const chunks = new Map();
	const log = [];
	const assembled = [];
	const server = createServer((req, res) => {
		const body = [];
		req.on('data', (d) => body.push(d));
		req.on('end', () => {
			const raw = Buffer.concat(body);
			const url = new URL(req.url, 'http://x');
			log.push(`${req.method} ${url.pathname}`);
			const json = (value) => {
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(JSON.stringify(value));
			};
			const { port } = server.address();
			if (url.pathname.endsWith('/chunk-upload/') && req.method === 'GET') {
				return json({
					url: `http://127.0.0.1:${port}${url.pathname}`,
					chunkSize: 8 * 1024 * 1024,
					chunksPerRequest: 64,
					maxFileSize: 2 ** 31,
					maxRequestSize: 32 * 1024 * 1024,
					concurrency: 1,
					hashAlgorithm: 'sha1',
					compression: ['gzip'],
					accept: ['artifact_bundles', 'release_files', 'sources'],
				});
			}
			if (url.pathname.endsWith('/chunk-upload/') && req.method === 'POST') {
				for (const part of multipartParts(raw, req.headers['content-type'] ?? '')) {
					const data = /file_gzip/.test(part.head) ? gunzipSync(part.data) : part.data;
					chunks.set(createHash('sha1').update(data).digest('hex'), data);
				}
				return json({});
			}
			if (url.pathname.endsWith('/artifactbundle/assemble/')) {
				const request = JSON.parse(raw.toString() || '{}');
				const missing = (request.chunks ?? []).filter((c) => !chunks.has(c));
				if (!missing.length) assembled.push(request);
				return json({
					state: missing.length ? 'not_found' : 'created',
					missingChunks: missing,
					detail: null,
				});
			}
			return json({});
		});
	});
	await new Promise((done) => server.listen(0, '127.0.0.1', done));
	return {
		url: `http://127.0.0.1:${server.address().port}`,
		log,
		/** The last assembled bundle's files, re-joined from its chunks. */
		bundle() {
			const request = assembled.at(-1);
			if (!request) return null;
			const zip = Buffer.concat(request.chunks.map((c) => chunks.get(c)));
			return { request, files: readZip(zip) };
		},
		close: () => new Promise((done) => server.close(done)),
	};
}

/**
 * Upload to the stand-in and check what sentry-cli assembled: every map arrived with a debug ID and
 * with the code file that carries the same one, and (when given) every one of `debugIds` did.
 */
export async function dryRun(dir, release, debugIds = []) {
	const sentry = await fakeSentry();
	const args = uploadArgs({
		dir,
		org: 'dry-run',
		project: 'dry-run',
		release: release || 'dry-run',
	});
	console.info(`Dry run: pnpm ${args.join(' ')}  (SENTRY_URL=${sentry.url})`);
	const code = await run('pnpm', args, {
		...process.env,
		SENTRY_URL: sentry.url,
		SENTRY_AUTH_TOKEN: 'dry-run',
		SENTRY_ORG: 'dry-run',
		SENTRY_PROJECT: 'dry-run',
	});
	const bundle = sentry.bundle();
	await sentry.close();
	if (code !== 0 || !bundle) {
		throw new Error(
			`the dry-run upload did not complete (exit ${code}); requests: ${sentry.log.join(', ')}`,
		);
	}
	const manifest = JSON.parse(bundle.files['manifest.json'].toString());
	const entries = Object.values(manifest.files ?? {});
	const idOf = (f) => f.headers?.['debug-id'] ?? f.headers?.debug_id;
	const maps = entries.filter((f) => f.type === 'source_map');
	const codeIds = new Set(entries.filter((f) => f.type === 'minified_source').map(idOf));
	console.info(
		`Dry run: sentry-cli assembled a bundle for release '${bundle.request.version ?? '-'}' with ` +
			`${maps.length} map(s) and ${codeIds.size} code file(s)` +
			(entries.length <= 4 ? `: ${entries.map((f) => `${f.url} (${f.type})`).join(', ')}` : ''),
	);
	const orphans = maps.filter((f) => !idOf(f) || !codeIds.has(idOf(f)));
	if (!maps.length || orphans.length) {
		throw new Error(
			`maps without a matching debug ID: ${orphans.map((f) => f.url).join(', ') || '(no maps)'}`,
		);
	}
	const missing = debugIds.filter((id) => !maps.some((f) => idOf(f) === id));
	if (missing.length) throw new Error(`no map carries debug ID ${missing.join(', ')}`);
	console.info(
		`Dry run OK: ${maps.length} map(s) uploaded, each with its code file under one debug ID.`,
	);
	return { maps: maps.length, codeIds: [...codeIds] };
}

/**
 * The launcher (adapter-node): its client chunks are ordinary files a browser loads by URL, so this
 * is Sentry's standard flow — `sourcemaps inject` writes a debug ID into each chunk and its map,
 * then upload, then delete. The server's maps are deleted too; they are never served, but the
 * server's code is not minified and its frames read fine without them. Maps exist only in a build
 * made with SENTRY_AUTH_TOKEN set (apps/launcher-api/vite.config.js).
 *
 * Only `client/_app` is gated: `client/rig-viewer/vendor/invisible-rig.js` is our prebuilt rig
 * runtime, shipped unminified and without a map.
 */
async function launcher(buildDir, { dryRun: dry }) {
	const app = join(buildDir, 'client', '_app');
	const hasMaps = walk(app).some((f) => f.endsWith('.map'));
	try {
		if (!hasMaps) console.info('No client source maps in the build — nothing to upload.');
		else if (!dry && !uploadConfigured()) await upload(app, '');
		else {
			const injected = await run(
				'pnpm',
				['dlx', SENTRY_CLI, 'sourcemaps', 'inject', app],
				cliEnv(),
			);
			if (injected !== 0) {
				console.log(`::warning::sentry-cli inject failed (exit ${injected}) — maps not uploaded.`);
			} else if (dry) await dryRun(app, releaseFor('launcher'));
			else await upload(app, releaseFor('launcher'));
		}
	} finally {
		for (const file of walk(buildDir)) if (file.endsWith('.map')) rmSync(file);
	}
	return sourceMapLeaks(app);
}

async function main() {
	const [mode, dir, ...rest] = process.argv.slice(2);
	const flag = (name) => rest.includes(name);
	const option = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
	if (!dir || !['runtime', 'launcher', 'verify'].includes(mode)) {
		console.error(
			'Usage: node scripts/sentry-sourcemaps.mjs <runtime|launcher|verify> <buildDir> [--out <dir>] [--dry-run] [--strict]',
		);
		process.exit(2);
	}
	const buildDir = resolve(dir);
	const report = (leaks, where) => {
		for (const leak of leaks) console.error(`✗ ${leak}`);
		if (leaks.length) process.exit(1);
		console.info(`✓ no source map or sourceMappingURL under ${where}`);
	};
	if (mode === 'verify') return report(sourceMapLeaks(buildDir), dir);
	if (mode === 'launcher') {
		return report(
			await launcher(buildDir, { dryRun: flag('--dry-run') }),
			join(dir, 'client', '_app'),
		);
	}
	const outDir = option('--out') ?? mkdtempSync(join(tmpdir(), `ie-sentry-${basename(buildDir)}-`));
	const staged = prepareRuntime(buildDir, outDir, { strict: flag('--strict') });
	console.info(`✓ no source map or sourceMappingURL under ${dir}`);
	if (!staged) return;
	const ids = staged.chunks.map((c) => c.debugId);
	if (flag('--dry-run')) await dryRun(staged.dir, releaseFor('runtime'), ids);
	else await upload(staged.dir, releaseFor('runtime'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(`sentry-sourcemaps: ${error.message}`);
		process.exit(1);
	});
}
