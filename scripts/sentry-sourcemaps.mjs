// Upload the runtime bundle's source maps to Sentry — and make sure none of them ships.
//
//   node scripts/sentry-sourcemaps.mjs runtime apps/lines/build [--out <dir>] [--dry-run]
//   node scripts/sentry-sourcemaps.mjs launcher apps/launcher-api/build [--dry-run]
//   node scripts/sentry-sourcemaps.mjs verify apps/lines/build
//
// `launcher` is the launcher's post-build step — see `launcher()` below. The rest is the runtime:
//
// `runtime` expects a build made with `IE_SOURCEMAPS=hidden` (packages/config-vite). It
//   1. re-bases the bundle's map into `index.html` coordinates (below),
//   2. adds a debug-ID snippet to `index.html`, so the SDK can name the map for any frame,
//   3. stages the map (+ the page it describes) OUTSIDE the build folder,
//   4. deletes every `.map` from the build and fails unless `verify` then passes,
//   5. uploads the staged files with `sentry-cli`, for the release the SDK reports.
// Step 5 is skipped, with a notice, when SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT is unset,
// and a failed upload is a warning: reporting must never be the thing that holds an engine release.
// `--dry-run` runs step 5 against a local stand-in for Sentry's upload API and checks what arrived.
//
// `verify` is the gate: no `.map` file and no `sourceMappingURL` anywhere under the folder. The repo
// and every served bundle are public, so a map next to the bundle would publish the whole source.
//
// WHY THE MAP HAS TO BE RE-BASED: the game is ONE inlined file. SvelteKit's `bundleStrategy:
// 'inline'` copies `_app/immutable/bundle.<hash>.js` byte for byte into a `<script>` in `index.html`,
// and that copy is the one that runs — the file itself is only a base URL for `import.meta.url`. A
// browser numbers an inline script's frames by DOCUMENT line and column, so every frame is ~126
// lines (and, on the bundle's first line, a few columns) below where the bundle's own map expects
// it. The staged map therefore describes `index.html`: the same mappings, shifted by the bundle's
// offset in the page. Frames are tied to it by debug ID, not by URL, because the page's URL is a
// different game key on every online game and the operator's own page in a delivery.

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, inflateRawSync } from 'node:zlib';

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

// ── Base64 VLQ, the source-map `mappings` encoding ──────────────────────────────────────────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = Object.fromEntries([...B64].map((c, i) => [c, i]));

const decodeSegment = (text) => {
	const out = [];
	let value = 0;
	let shift = 0;
	for (const char of text) {
		const digit = B64_INDEX[char];
		if (digit === undefined) throw new Error(`bad VLQ character '${char}'`);
		value += (digit & 31) << shift;
		if (digit & 32) {
			shift += 5;
			continue;
		}
		out.push(value & 1 ? -(value >>> 1) : value >>> 1);
		value = 0;
		shift = 0;
	}
	return out;
};

const encodeSegment = (fields) =>
	fields
		.map((field) => {
			let value = field < 0 ? (-field << 1) | 1 : field << 1;
			let text = '';
			do {
				let digit = value & 31;
				value >>>= 5;
				if (value) digit |= 32;
				text += B64[digit];
			} while (value);
			return text;
		})
		.join('');

/** `mappings` → per generated line, absolute `[column, source, line, column]` segments. */
export function decodeMappings(mappings) {
	const state = [0, 0, 0, 0];
	return mappings.split(';').map((line) => {
		state[0] = 0;
		if (!line) return [];
		return line.split(',').map((segment) => {
			const fields = decodeSegment(segment);
			const abs = [];
			for (let i = 0; i < 4 && i < fields.length; i++) abs.push((state[i] += fields[i]));
			return abs;
		});
	});
}

/**
 * The same map, for the same code placed `line` lines and (on its first line only) `column` columns
 * further into a larger document. Only the first segment of a line holds an absolute column, and
 * source/original positions are relative across lines, so nothing past that one segment changes.
 */
export function rebaseMappings(mappings, line, column) {
	const lines = mappings.split(';');
	if (column && lines[0]) {
		const segments = lines[0].split(',');
		const first = decodeSegment(segments[0]);
		first[0] += column;
		segments[0] = encodeSegment(first);
		lines[0] = segments.join(',');
	}
	return ';'.repeat(line) + lines.join(';');
}

/** Line/column of a string index, counting line terminators the way an HTML parser does. */
const positionOf = (text, index) => {
	const before = text.slice(0, index);
	const lines = before.split(/\r\n|\r|\n/);
	return { line: lines.length - 1, column: lines.at(-1).length };
};

/** A UUID named by the bundle's content, so a re-run of the same build gets the same debug ID. */
export const debugIdFor = (content) => {
	const hex = createHash('sha256').update(content).digest('hex');
	const variant = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/**
 * What the Sentry SDK reads to name a map for a frame: `_sentryDebugIds[stack] = id`, where the
 * stack's file is the page itself — the file every frame of the inlined bundle names.
 */
const snippetFor = (id) =>
	`<script>!function(){try{var e=window,n=new e.Error().stack;n&&((e._sentryDebugIds=e._sentryDebugIds||{})[n]="${id}")}catch(e){}}();</script>`;

/** Sample mapped positions and check the page holds the same code where the re-based map says. */
function checkRebase({ bundle, html, map, rebased, line, column }) {
	const bundleLines = bundle.split('\n');
	const htmlLines = html.split(/\r\n|\r|\n/);
	const original = decodeMappings(map.mappings);
	const shifted = decodeMappings(rebased);
	const samples = [];
	const every = Math.max(1, Math.floor(original.flat().length / 400));
	let n = 0;
	original.forEach((segments, genLine) => {
		for (const segment of segments)
			if (segment.length >= 4 && n++ % every === 0) samples.push([genLine, segment]);
	});
	const problems = [];
	for (const [genLine, [genCol, ...origin]] of samples) {
		const htmlLine = genLine + line;
		const htmlCol = genLine === 0 ? genCol + column : genCol;
		const code = bundleLines[genLine].slice(genCol, genCol + 24);
		if (htmlLines[htmlLine]?.slice(htmlCol, htmlCol + 24) !== code) {
			problems.push(
				`page ${htmlLine + 1}:${htmlCol} does not hold the code at bundle ${genLine + 1}:${genCol}`,
			);
		}
		const hit = shifted[htmlLine]?.find((s) => s[0] === htmlCol);
		if (!hit || hit.slice(1).join() !== origin.join()) {
			problems.push(
				`page ${htmlLine + 1}:${htmlCol} does not resolve to the bundle map's original`,
			);
		}
		if (problems.length > 5) break;
	}
	if (!samples.length) problems.push('the bundle map has no mapped positions');
	return { samples: samples.length, problems };
}

/** Steps 1–3 for a build that has the bundle's map. Throws when the map cannot be made to fit. */
function stageMap(buildDir, outDir, bundleName, map) {
	const bundle = readFileSync(join(buildDir, '_app', 'immutable', bundleName), 'utf8');
	const htmlPath = join(buildDir, 'index.html');
	let html = readFileSync(htmlPath, 'utf8');
	const id = debugIdFor(bundle);
	// Not a test for `_sentryDebugIds` alone: the SDK inside the bundle names it too.
	if (!html.includes(snippetFor(id))) {
		const head = html.indexOf('</head>');
		if (head < 0) throw new Error('index.html has no </head> to hold the debug-ID snippet');
		html = `${html.slice(0, head)}${snippetFor(id)}\n\t${html.slice(head)}`;
	}
	const at = html.indexOf(bundle);
	if (at < 0) {
		console.warn(
			'The bundle is not inlined in index.html (an embed build?) — its map would not line up.',
		);
		return null;
	}
	if (html.indexOf(bundle, at + 1) >= 0) {
		throw new Error('the bundle is inlined twice in index.html — which copy runs is ambiguous');
	}
	const { line, column } = positionOf(html, at);
	const rebased = rebaseMappings(map.mappings, line, column);
	const check = checkRebase({ bundle, html, map, rebased, line, column });
	if (check.problems.length) {
		throw new Error(
			`the re-based map does not line up with index.html:\n  ${check.problems.join('\n  ')}`,
		);
	}
	writeFileSync(htmlPath, html);
	mkdirSync(outDir, { recursive: true });
	const source = join(outDir, 'index.html.js');
	writeFileSync(source, `${html}\n//# debugId=${id}\n//# sourceMappingURL=index.html.js.map\n`);
	writeFileSync(
		`${source}.map`,
		JSON.stringify({
			...map,
			// Vite writes each source relative to `.svelte-kit/output/client/_app/immutable/`, which
			// climbs to the repo root; without the climb Sentry shows repo paths.
			sources: map.sources.map((s) => s.replace(/^(\.\.\/)+/, '')),
			file: 'index.html.js',
			mappings: rebased,
			debugId: id,
			debug_id: id,
		}),
	);
	console.info(
		`Staged the ${bundleName} map for index.html (bundle at line ${line + 1}, column ${column}; ` +
			`${check.samples} sampled positions line up), debug ID ${id}.`,
	);
	return { dir: outDir, debugId: id };
}

/**
 * Steps 1–4. Returns what to upload, or `null` (with the reason logged) when there is nothing. Only
 * step 4 can fail it: a map that will not fit costs readable traces, a map left in the build would
 * publish the source.
 */
export function prepareRuntime(buildDir, outDir) {
	const immutable = join(buildDir, '_app', 'immutable');
	const bundleName = readdirSync(immutable).find((f) => /^bundle\.[\w-]+\.js$/.test(f));

	let staged = null;
	let map;
	try {
		if (bundleName) map = JSON.parse(readFileSync(join(immutable, `${bundleName}.map`), 'utf8'));
	} catch {
		// No map: a build made without IE_SOURCEMAPS=hidden, or a re-run after the strip.
	}
	if (!map) console.warn('No bundle source map in the build — nothing to upload.');
	else {
		try {
			staged = stageMap(buildDir, outDir, bundleName, map);
		} catch (error) {
			console.log(`::warning::Source map not staged for Sentry: ${error.message}`);
		}
	}

	for (const file of walk(buildDir)) if (file.endsWith('.map')) rmSync(file);
	const leaks = sourceMapLeaks(buildDir);
	if (leaks.length) throw new Error(`source maps would ship:\n  ${leaks.join('\n  ')}`);
	return staged;
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
 * with the code file that carries the same one (and, when given, that it is `debugId`).
 */
async function dryRun(dir, release, debugId) {
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
	if (debugId && !maps.some((f) => idOf(f) === debugId)) {
		throw new Error(`no map carries debug ID ${debugId}`);
	}
	console.info(
		`Dry run OK: every map uploaded with its code file under one debug ID${debugId ? ` (${debugId})` : ''}.`,
	);
}

/**
 * The launcher (adapter-node): its client chunks are ordinary files a browser loads by URL, so this
 * is Sentry's standard flow — `sourcemaps inject` writes a debug ID into each chunk and its map,
 * then upload, then delete. The server's maps are deleted too; they are never served, but the
 * server's code is not minified and its frames read fine without them. Maps exist only in a build
 * made with SENTRY_AUTH_TOKEN set (apps/launcher-api/vite.config.js).
 *
 * Only `client/_app` is gated: `client/spine/vendor/*.js` are vendored third-party files that
 * reference an upstream map they never shipped.
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
			'Usage: node scripts/sentry-sourcemaps.mjs <runtime|launcher|verify> <buildDir> [--out <dir>] [--dry-run]',
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
	const staged = prepareRuntime(buildDir, outDir);
	console.info(`✓ no source map or sourceMappingURL under ${dir}`);
	if (!staged) return;
	if (flag('--dry-run')) await dryRun(staged.dir, releaseFor('runtime'), staged.debugId);
	else await upload(staged.dir, releaseFor('runtime'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(`sentry-sourcemaps: ${error.message}`);
		process.exit(1);
	});
}
