/**
 * What is actually IN a build, and which of it this game authored.
 *
 *     node engine/scripts/audit-build.mjs [delivery|build] [--json report.json] [--full]
 *
 * WHY THIS EXISTS. A delivery goes to someone else's CDN under their brand, so "what is in it"
 * stops being a curiosity and becomes a question we have to be able to answer. Two things make it
 * impossible to answer by looking:
 *
 *   1. `static/` is copied into the build VERBATIM. A file nothing references still ships — that is
 *      how 1.24 MB of a previous vendor's loader gif reached a partner build, dead since the engine
 *      replaced it.
 *   2. A game repo's `static/` STARTS as a copy of the engine's seed (`new-game.mjs` SEED_DIRS), and
 *      `pull:assets` mirrors the project's own assets over the top. Whatever the project never
 *      replaced is still the seed's — sample content wearing the game's folder structure.
 *
 * So the test is not the filename, which lies (`symbols.atlas` looks like yours), but the BYTES: a
 * file whose hash matches one in the engine seed was not authored for this game. That is robust
 * against renaming and needs no denylist to maintain.
 *
 * It reports rather than deletes. Some seed files are load-bearing — the engine's own game layer
 * (`apps/lines/src/game/assets.ts`) declares them and preloads them for EVERY game — so removing
 * one is an engine decision, not a per-build cleanup. Deciding that is the point of having the list.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve, sep } from 'node:path';

const arg = (flag, fallback) => {
	const i = process.argv.indexOf(flag);
	return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(name);

const ENGINE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SEED_DIR = resolve(ENGINE_ROOT, 'apps/lines/static');

/** Vendor markers worth NAMING in a report that a partner may indirectly see the results of. A
 *  name match is a hint, never the verdict — the hash comparison below is the verdict. */
const VENDOR_PATTERNS = [/stake/i];

const target = resolve(process.cwd(), process.argv[2] ?? 'delivery');
const jsonOut = arg('--json', '');
const full = flag('--full');

if (!existsSync(target)) {
	throw new Error(
		`No such folder: ${target}\nPass the build to audit, e.g. 'delivery' or 'build'.`,
	);
}
if (!existsSync(SEED_DIR)) {
	throw new Error(
		`Cannot find the engine seed at ${SEED_DIR} — is this the engine's own scripts/?`,
	);
}

const walk = (root, base = root) =>
	readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const abs = join(root, entry.name);
		return entry.isDirectory()
			? walk(abs, base)
			: [{ rel: relative(base, abs).split(sep).join('/'), abs, size: statSync(abs).size }];
	});

const hash = (abs) => createHash('sha256').update(readFileSync(abs)).digest('hex');

const seed = new Map();
for (const f of walk(SEED_DIR)) if (!seed.has(hash(f.abs))) seed.set(hash(f.abs), f.rel);

const files = walk(target).filter((f) => f.rel !== 'EMBED.md');
const authored = [];
const fromSeed = [];
for (const f of files) {
	const seedRel = seed.get(hash(f.abs));
	(seedRel ? fromSeed : authored).push(seedRel ? { ...f, seedRel } : f);
}
const vendor = files.filter((f) => VENDOR_PATTERNS.some((p) => p.test(f.rel)));

const bytes = (list) => list.reduce((n, f) => n + f.size, 0);
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

const byDir = (list) => {
	const out = new Map();
	for (const f of list) {
		const d = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '(root)';
		const cur = out.get(d) ?? { files: 0, size: 0 };
		out.set(d, { files: cur.files + 1, size: cur.size + f.size });
	}
	return [...out].sort((a, b) => b[1].size - a[1].size);
};

console.log(`\n  ${target}\n`);
console.log(
	`  ${String(files.length).padStart(5)} files   ${mb(bytes(files)).padStart(9)}   total`,
);
console.log(
	`  ${String(authored.length).padStart(5)} files   ${mb(bytes(authored)).padStart(9)}   authored for this game`,
);
console.log(
	`  ${String(fromSeed.length).padStart(5)} files   ${mb(bytes(fromSeed)).padStart(9)}   BYTE-IDENTICAL to the engine seed\n`,
);

if (fromSeed.length) {
	console.log('  Not authored for this game — the engine seed, unreplaced:\n');
	for (const [dir, s] of byDir(fromSeed)) {
		console.log(
			`    ${dir.padEnd(42)} ${String(s.files).padStart(3)} files  ${mb(s.size).padStart(9)}`,
		);
	}
	const biggest = [...fromSeed]
		.sort((a, b) => b.size - a.size)
		.slice(0, full ? fromSeed.length : 12);
	console.log('\n  Largest:\n');
	for (const f of biggest) console.log(`    ${mb(f.size).padStart(9)}  ${f.rel}`);
	if (!full && fromSeed.length > 12) console.log(`    … ${fromSeed.length - 12} more (--full)`);
}

if (vendor.length) {
	console.log('\n  Names carrying a vendor marker:\n');
	for (const f of vendor) console.log(`    ${mb(f.size).padStart(9)}  ${f.rel}`);
}

console.log(
	`\n  A seed file is not automatically dead weight: the shared game layer\n` +
		`  (apps/lines/src/game/assets.ts) declares many of them and preloads them for every\n` +
		`  game. Check this list against what the game actually fetches before removing any.\n`,
);

if (jsonOut) {
	const path = resolve(process.cwd(), jsonOut);
	writeFileSync(
		path,
		`${JSON.stringify(
			{
				target,
				seedDir: SEED_DIR,
				totals: {
					files: files.length,
					bytes: bytes(files),
					authoredFiles: authored.length,
					authoredBytes: bytes(authored),
					seedFiles: fromSeed.length,
					seedBytes: bytes(fromSeed),
				},
				fromSeed: fromSeed.map((f) => ({ path: f.rel, bytes: f.size, seedPath: f.seedRel })),
				vendorNamed: vendor.map((f) => ({ path: f.rel, bytes: f.size })),
			},
			null,
			2,
		)}\n`,
		'utf8',
	);
	console.log(`  report: ${path}\n`);
}
