// check:runtime-bytes — every released runtime is exactly the bytes its committed manifest records
// (`docs/design/3d-games.md`, `docs/design/3d/runtime-evaluation.md` §3.5).
//
//   pnpm check:runtime-bytes [--only <id,…>]
//       builds `apps/lines` once per runtime (`packages/constants-shared/runtimes.ts`) with the
//       release env and `IE_REPRODUCIBLE=1`, and compares each build with
//       `scripts/runtime-bytes/<id>.json`. Any file added, removed or changed fails, naming it and its
//       gzip delta.
//   pnpm check:runtime-bytes --out <dir>
//       also writes each build's manifest to <dir> (CI uploads them, so a PR that means to change a
//       runtime can take Linux's manifests rather than re-record on another OS).
//   pnpm check:runtime-bytes --update [--only <id,…>]
//       the same builds, re-recorded. A PR that MEANS to change a runtime (an ordinary engine change)
//       re-records, and the manifest diff is what review reads: which runtimes moved, and by how much.
//   node scripts/check-runtime-bytes.mjs --hash <buildDir>
//       one sha256 over EVERY file of a build (path + content, source maps excepted) — what the runtime
//       release records per release and compares to skip an unchanged one. Wider than a manifest on
//       purpose: a release uploads the whole build, art and audio included.
//
// A manifest is every file under `_app/immutable/` plus `index.html` → sha256 and gzip -6 size. Only a
// reproducible build can be compared: without `IE_REPRODUCIBLE=1` the build time, the commit and the
// lockfile hash are compiled in (`packages/config-vite/provenance.js`), so no two builds match. The
// build has no source maps (the release's carry per-chunk debug IDs), and its Sentry DSN is the probe
// stand-in, so the SDK chunk a released runtime carries is in the manifest too.
//
// Why strict: 3D ships as a fifth runtime, and the owner's constraint is that the four 2D runtimes stay
// the same bytes while it is built. A change on a path that cannot legitimately touch 2D bytes (the 3D
// package, the family seams, the build config, the lockfile) that fails here is a leak.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { PROBE_DSN } from './lib/game-build-variants.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_DIR = join(ROOT, 'scripts/runtime-bytes');
const BUILD = join(ROOT, 'apps/lines/build');

/** The release's build env (`.github/workflows/runtime-release.yml`), pinned. */
const BUILD_ENV = {
	PUBLIC_RGS_TRANSPORT: 'play4fun',
	PUBLIC_DELIVERY_PROFILES: '*',
	PUBLIC_SENTRY_DSN: PROBE_DSN,
	IE_REPRODUCIBLE: '1',
	NODE_OPTIONS: '--max-old-space-size=8192',
};

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function* walk(dir, rel = '') {
	for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
		const path = rel ? `${rel}/${entry.name}` : entry.name;
		if (entry.isDirectory()) yield* walk(dir, path);
		else if (entry.isFile()) yield path;
	}
}

/** `{ path: { sha256, gzip } }` for `index.html` and every file under `_app/immutable/`, sorted. */
export function manifestOf(buildDir) {
	const paths = ['index.html', ...[...walk(buildDir, '_app/immutable')].sort()];
	const files = {};
	let gzip = 0;
	for (const path of paths) {
		const body = readFileSync(join(buildDir, path));
		const size = gzipSync(body, { level: 6 }).length;
		files[path] = { sha256: sha256(body), gzip: size };
		gzip += size;
	}
	return { files, total: { files: paths.length, gzip } };
}

/** One sha256 naming every file of a build but its source maps, by path and content. */
export function buildHash(buildDir) {
	const hash = createHash('sha256');
	for (const path of [...walk(buildDir)].filter((p) => !p.endsWith('.map')).sort())
		hash.update(`${path}\0${sha256(readFileSync(join(buildDir, path)))}\n`);
	return hash.digest('hex');
}

/** A content-hashed name without its hash, so a changed chunk reads as one file that changed. */
const stem = (path) => path.replace(/\.[A-Za-z0-9_-]{8}(\.(?:js|css|wasm|json))$/, '$1');

/** What differs between a recorded manifest and a build's, one line each; empty when identical. */
export function diffManifests(recorded, built) {
	const lines = [];
	const was = recorded.files;
	const now = built.files;
	const gone = Object.keys(was).filter((p) => !(p in now));
	const added = Object.keys(now).filter((p) => !(p in was));
	const byStem = new Map(gone.map((p) => [stem(p), p]));
	for (const path of added) {
		const before = byStem.get(stem(path));
		if (before) {
			byStem.delete(stem(path));
			const delta = now[path].gzip - was[before].gzip;
			lines.push(`changed ${before} → ${path} (${delta >= 0 ? '+' : ''}${delta} B gzip)`);
		} else lines.push(`added   ${path} (${now[path].gzip} B gzip)`);
	}
	for (const path of byStem.values()) lines.push(`removed ${path} (${was[path].gzip} B gzip)`);
	for (const path of Object.keys(now))
		if (path in was && was[path].sha256 !== now[path].sha256) {
			const delta = now[path].gzip - was[path].gzip;
			lines.push(`changed ${path} (${delta >= 0 ? '+' : ''}${delta} B gzip)`);
		}
	return lines;
}

const pnpm = (args, env) => {
	const r = spawnSync('pnpm', args, {
		cwd: ROOT,
		env,
		stdio: ['ignore', 'inherit', 'inherit'],
		shell: process.platform === 'win32',
	});
	if (r.status !== 0) throw new Error(`pnpm ${args.join(' ')} failed (exit ${r.status})`);
};

/** The caller's env without anything that steers a game build, so only {@link BUILD_ENV} does. */
const cleanEnv = () =>
	Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PUBLIC_|IE_|VITE_)/.test(k)));

/** Build-time switches a runtime row carries besides its families (`view: '3d'` → `PUBLIC_IE_3D`). */
const rowEnv = (row) => ({
	PUBLIC_IE_FAMILIES: row.families,
	...('view' in row && row.view === '3d' ? { PUBLIC_IE_3D: '1' } : {}),
});

const manifestFile = (id) => join(MANIFEST_DIR, `${id}.json`);

async function main(argv) {
	const flag = (name) => {
		const i = argv.indexOf(name);
		return i === -1 ? undefined : argv[i + 1];
	};
	const hashDir = flag('--hash');
	if (hashDir) {
		console.log(buildHash(resolve(hashDir)));
		return;
	}
	const update = argv.includes('--update');
	const { RUNTIMES } = await import('../packages/constants-shared/runtimes.ts');
	const only = flag('--only')?.split(',');
	const unknown = only?.filter((id) => !RUNTIMES.some((r) => r.id === id)) ?? [];
	if (unknown.length) throw new Error(`not a runtime id: ${unknown.join(', ')}`);
	const rows = RUNTIMES.filter((r) => !only || only.includes(r.id));

	const out = flag('--out') ? resolve(flag('--out')) : update ? MANIFEST_DIR : undefined;
	const env = cleanEnv();
	const started = Date.now();
	pnpm(['--filter', 'lines^...', 'build'], env);
	const failures = [];
	for (const row of rows) {
		const t = Date.now();
		rmSync(BUILD, { recursive: true, force: true });
		pnpm(['--filter', 'lines', 'build'], { ...env, ...BUILD_ENV, ...rowEnv(row) });
		const built = { runtime: row.id, ...rowEnv(row), ...manifestOf(BUILD) };
		const secs = Math.round((Date.now() - t) / 1000);
		const sizes = `${built.total.files} files, ${built.total.gzip} B gzip (${secs}s)`;
		if (out) {
			mkdirSync(out, { recursive: true });
			writeFileSync(join(out, `${row.id}.json`), `${JSON.stringify(built, null, '\t')}\n`);
		}
		if (update) {
			console.log(`recorded ${row.id}: ${sizes}`);
			continue;
		}
		const file = manifestFile(row.id);
		if (!existsSync(file)) {
			failures.push(`${row.id}: no manifest at ${file} — record one with --update`);
			continue;
		}
		const lines = diffManifests(JSON.parse(readFileSync(file, 'utf8')), built);
		if (lines.length)
			failures.push(`${row.id} differs from its manifest:\n  ${lines.join('\n  ')}`);
		else console.log(`ok   ${row.id}: ${sizes}`);
	}
	console.log(`\n${rows.length} runtime build(s) in ${Math.round((Date.now() - started) / 1000)}s`);
	if (failures.length) {
		console.error(`\n${failures.join('\n\n')}`);
		console.error(
			'\ncheck:runtime-bytes: a runtime is not the bytes it was. If the change is meant to reach it, ' +
				're-record with `pnpm check:runtime-bytes --update` and commit the manifests; if not, it leaked.',
		);
		process.exit(1);
	}
	if (!update) console.log('runtime bytes ok');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	await main(process.argv.slice(2));
