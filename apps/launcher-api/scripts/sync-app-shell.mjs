// Overlay the engine's canonical game app-shell onto a standalone game repo's
// own `src/`, so a game can't silently ship a STALE app layer. A standalone game
// vendors the engine as a submodule but keeps its OWN copy of the app source
// (`components/*`, `game/*`, `editor-scenes.ts`, …), scaffolded once from the
// engine reference app `apps/lines/src` and then hand-maintained. Engine feature
// wiring that lives in APP source (e.g. the config-driven bet-menu, PR #147) does
// NOT ride along on a submodule/pin bump, so the game drifts behind and ships old
// FEATURES even with a current engine. This is the app-src twin of the build-time
// asset pull (pull-project-assets.mjs) and the launcher's engine-pin guard: wire
// it as a `prebuild` step so every build refreshes the shell from the vendored
// engine. See docs/design/live-assets.md and the app-src drift gotcha.
//
// PURE FILESYSTEM: reads the vendored engine on disk, no network, no token.
//
//   node <engine>/apps/launcher-api/scripts/sync-app-shell.mjs \
//     --engine-src engine/apps/lines/src --dest src [--dry-run]
//
// OVERLAY, not mirror: it copies engine files onto the game and leaves
// game-unique files (baked-editor-bundle.json, game assets) in place — it never
// deletes. GAME-OWNED files are never overwritten (the `keep` list below): these
// are the per-game authoring surfaces + game data. Everything else under the
// engine app-src is ENGINE-OWNED shell and is kept byte-current with the engine.
//
// Only files whose content ACTUALLY differs are rewritten — a compare that
// ignores CRLF-vs-LF, so a repo that merely uses different line endings is a
// no-op (that noise once made real drift look 10x bigger than it was).
//
// The keep-list is the ownership manifest. A game with extra game-owned files
// adds them via a JSON array at `<dest>/../app-shell.keep.json` (paths relative
// to the game src dir), which EXTENDS these defaults.

import { readdir, readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const getFlag = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(`--${name}`);

const scriptDir = dirname(fileURLToPath(import.meta.url));
// Default source = the engine reference app relative to THIS script
// (apps/launcher-api/scripts → apps/lines/src). When a game runs the vendored
// copy the same relative path resolves inside its `engine/` submodule.
const DEFAULT_ENGINE_SRC = resolve(scriptDir, '..', '..', 'lines', 'src');

// GAME-OWNED by ROLE (never overlay): per-game authoring surfaces + baked data.
// Confirmed against apps/lines vs a real game (Book of Borut Remake): these are
// the only files a game legitimately diverges on; all else is shared shell.
const DEFAULT_KEEP = [
	'game/config.ts', // the game's compiled math fallback (the baked bundle overrides it at runtime)
	'baked-editor-bundle.json', // the baked authoring doc = this game's DATA
	'stories', // scaffold storybook fixtures (dir)
	// NOTE: game/constants.ts is ENGINE-OWNED (overlaid), NOT kept. It holds shared engine
	// constants the shell imports (e.g. SYMBOL_DIM_TINT for the non-winning-symbol dim) plus a
	// DEFAULT SYMBOL_INFO_MAP; a game's real symbol art is authored in the Invisible Symbols tool
	// and travels via the baked symbols doc, not this file — so keeping a stale copy here just
	// starves the shell of new engine constants (it broke the non-winning-dim build once).
];

const engineSrc = resolve(getFlag('engine-src') ?? DEFAULT_ENGINE_SRC);
const destArg = getFlag('dest') ?? 'src';
const dest = isAbsolute(destArg) ? destArg : resolve(process.cwd(), destArg);
const dryRun = hasFlag('dry-run');

async function loadKeep() {
	const keep = new Set(DEFAULT_KEEP);
	// Optional per-game extension, sibling to the src dir.
	const extra = resolve(dest, '..', 'app-shell.keep.json');
	try {
		const raw = JSON.parse(await readFile(extra, 'utf8'));
		if (Array.isArray(raw)) for (const k of raw) if (typeof k === 'string') keep.add(k);
		console.info(`app-shell: +${Array.isArray(raw) ? raw.length : 0} keep entries from app-shell.keep.json`);
	} catch {
		/* none — defaults only */
	}
	return keep;
}

/** A relPath is kept (skipped) if it equals a keep entry or lives under a keep dir. */
function isKept(relPath, keep) {
	const p = relPath.split(sep).join('/');
	for (const k of keep) if (p === k || p.startsWith(k + '/')) return true;
	return false;
}

async function* walk(root) {
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const full = join(root, entry.name);
		if (entry.isDirectory()) yield* walk(full);
		else if (entry.isFile()) yield full;
	}
}

/** Content equal ignoring line-ending style (CRLF vs LF) and a trailing newline. */
function sameContent(a, b) {
	return a.replace(/\r\n/g, '\n').replace(/\n$/, '') === b.replace(/\r\n/g, '\n').replace(/\n$/, '');
}

async function main() {
	try {
		if (!(await stat(engineSrc)).isDirectory()) throw new Error('not a dir');
	} catch {
		console.error(`app-shell: engine source not found: ${engineSrc}\n` + '  Is the engine submodule initialised? (git submodule update --init)');
		process.exit(1);
	}

	const keep = await loadKeep();
	let written = 0;
	let skippedKept = 0;
	let unchanged = 0;
	const changed = [];

	for await (const file of walk(engineSrc)) {
		const rel = relative(engineSrc, file);
		if (isKept(rel, keep)) {
			skippedKept++;
			continue;
		}
		const target = join(dest, rel);
		const srcText = await readFile(file, 'utf8');
		let destText = null;
		try {
			destText = await readFile(target, 'utf8');
		} catch {
			/* new file */
		}
		if (destText !== null && sameContent(srcText, destText)) {
			unchanged++;
			continue;
		}
		changed.push((destText === null ? 'add   ' : 'update') + '  ' + rel.split(sep).join('/'));
		if (!dryRun) {
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, srcText);
		}
		written++;
	}

	const verb = dryRun ? 'would sync' : 'synced';
	console.info(`app-shell: ${verb} ${written} file(s) from ${relative(process.cwd(), engineSrc) || engineSrc}` + ` → ${relative(process.cwd(), dest) || dest}  (kept ${skippedKept} game-owned, ${unchanged} already current)`);
	for (const c of changed) console.info('  ' + c);
	if (dryRun && written > 0) console.info('app-shell: dry run — nothing written.');
}

main().catch((err) => {
	console.error('app-shell: ' + (err instanceof Error ? err.message : String(err)));
	process.exit(1);
});
