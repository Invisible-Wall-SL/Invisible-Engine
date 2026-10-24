// Which files under a game's `static/assets/` the game can actually load — so a build ships those
// and nothing else. Used by pull-project-assets.mjs; Node builtins only (it runs inside a game
// repo, where the engine submodule's node_modules is never installed).
//
// TWO KINDS OF FOLDER. The export-generated subtrees (`editor-art/`, `_pages/`, …) are written by
// the launcher's exports, which already ship only what the game's scenes, flow and symbols reach
// (clipReachability.ts and friends), so everything in them is wanted. Every OTHER folder —
// `sprites/`, `spines/`, `fonts/`, `audio/` — is reached only by a path the game's code names:
// `new URL('../../assets/sprites/reelsFrame/reels_frame.json', import.meta.url)`. The Atlas Maker's
// Deploy button can write any folder there, and before this a build shipped all of them, loaded or
// not (a 34 MB `sprites/S_Background/` no code names stopped a publish at the portal's file limit).
//
// UNCERTAINTY NEVER PRUNES. A path built at runtime (`assets/sprites/${name}`) keeps the whole
// folder it starts in, and a scan that finds no game code keeps everything. A bare `assets/` base
// (the boot splash's `assetBase`) joins rels that come from the baked editor bundle — a data file
// under the app source, scanned like the code — so the rels are caught there. An unused folder
// costs bytes; a dropped one costs art the player should see.

import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

export const GENERATED_SUBTREES = [
	'editor-art',
	'editor-fonts',
	'editor-symbols',
	'editor-shaders',
	'effects',
	'clips',
	'sounds',
	'_pages',
	'_boot',
];

export const isGenerated = (rel) => GENERATED_SUBTREES.includes(rel.split('/')[0]);

const SOURCE_EXTS = new Set(['.ts', '.mts', '.js', '.mjs', '.svelte', '.css', '.html', '.json']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.svelte-kit', 'build', '.turbo']);

/**
 * Drop `//` and `/* *\/` comments, leaving string and template contents alone. A comment naming
 * `static/assets/sprites/` would otherwise read as "the whole folder is reachable" and keep every
 * sheet in it. A quote inside a regex literal can flip which text reads as a string; `'` and `"`
 * strings cannot span lines, so that state resets at each newline and a misread costs one line.
 */
export function stripComments(src) {
	let out = '';
	let quote = '';
	for (let i = 0; i < src.length; i++) {
		const c = src[i];
		if (quote) {
			out += c;
			if (c === '\\') out += src[++i] ?? '';
			else if (c === quote || (c === '\n' && quote !== '`')) quote = '';
			continue;
		}
		if (c === '"' || c === "'" || c === '`') {
			quote = c;
			out += c;
		} else if (c === '/' && src[i + 1] === '/') {
			while (i < src.length && src[i] !== '\n') i++;
			out += '\n';
		} else if (c === '/' && src[i + 1] === '*') {
			const end = src.indexOf('*/', i + 2);
			i = end === -1 ? src.length : end + 1;
		} else out += c;
	}
	return out;
}

const PATH_CHARS = '[A-Za-z0-9_.\\-]';
const SEGMENTED = `(?:${PATH_CHARS}+/)*${PATH_CHARS}*`;

/** An empty reference set: nothing outside the generated subtrees is reachable yet. */
export const emptyRefs = () => ({ files: new Set(), dirs: new Set() });

function addRef(refs, raw, next) {
	const dynamic = raw === '' || raw.endsWith('/') || next === '$' || next === '{';
	const path = raw.replace(/\/+$/, '');
	if (path === '') return;
	if (dynamic) {
		refs.dirs.add(path);
		return;
	}
	if (/\.[A-Za-z0-9]+$/.test(path)) {
		refs.files.add(path);
		// Its siblings ride along: an atlas's page, an audiosprite's other formats.
		const slash = path.lastIndexOf('/');
		if (slash > 0) refs.dirs.add(path.slice(0, slash));
	} else refs.dirs.add(path);
}

/**
 * Collect every asset reference in one source file into `refs`.
 *
 * `assets/<path>` anywhere in code is how the game names its own art. A data file (the baked
 * editor bundle) names rels WITHOUT the prefix, so for `.json` a string or path segment starting
 * with one of the `tops` (the non-generated folders actually present) counts too. `markup` (a
 * `.svelte` file) is scanned with its comments: an apostrophe in plain text is not a quote.
 */
export function collectRefs(refs, text, { json = false, markup = false, tops = [] } = {}) {
	const code = json || markup ? text : stripComments(text);
	for (const m of code.matchAll(new RegExp(`assets/(${SEGMENTED})`, 'g'))) {
		addRef(refs, m[1], code[m.index + m[0].length]);
	}
	if (json && tops.length) {
		const names = tops.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
		const re = new RegExp(`(?:^|["/])((?:${names})/${SEGMENTED})`, 'g');
		for (const m of code.matchAll(re)) addRef(refs, m[1], code[m.index + m[0].length]);
	}
	return refs;
}

export const isReachable = (rel, refs) => {
	if (isGenerated(rel) || refs.files.has(rel)) return true;
	for (const d of refs.dirs) if (rel === d || rel.startsWith(`${d}/`)) return true;
	return false;
};

/**
 * What the pull does with a file already under the local assets tree:
 *   - a generated-subtree file converges on the deploy listing (`listed`), committed or not;
 *   - a file the game can load stays;
 *   - an unloaded file is deleted — in a standalone GAME repo even when committed, because there
 *     `static/assets/` is only ever a mirror of `deploy/` (Test6 committed a 377 MB snapshot of
 *     one, with a 77 MB `sprites/S_Background` page nothing loads, and every publish shipped it).
 *     The launcher hard-resets a synced checkout before each build, so nothing is lost.
 *   - in the engine's own apps a committed file is the reference game's art: it is reported
 *     ('report'), never deleted. So is any file when git cannot say whether it is committed.
 * `refs === null` (no game code found) keeps everything outside the generated subtrees.
 */
export function pruneDecision(rel, { listed, refs, tracked, standalone }) {
	if (isGenerated(rel)) return listed.has(rel) ? 'keep' : 'delete';
	if (refs === null || isReachable(rel, refs)) return 'keep';
	if (standalone) return 'delete';
	return tracked === null || tracked.has(rel) ? 'report' : 'delete';
}

/** True when `refs` names at least one non-generated asset — i.e. the scan found the game. */
export const foundGameRefs = (refs) => [...refs.files, ...refs.dirs].some((p) => !isGenerated(p));

/** Files inside the assets tree that can name another asset (an atlas page, a font's sheet). */
export const DESCRIPTOR_EXTS = new Set(['.json', '.atlas', '.xml', '.fnt', '.css', '.plist']);

/**
 * Scan every source file under `roots` (missing roots are skipped) into a fresh reference set.
 * `skip` holds absolute directories to leave out — the assets tree itself, which is followed
 * separately, from what is reachable, by `followDescriptors`.
 */
export async function scanSources(roots, tops, { skip = [] } = {}) {
	const refs = emptyRefs();
	let scanned = 0;
	const walk = async (dir) => {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const abs = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name) && !skip.includes(abs)) await walk(abs);
				continue;
			}
			const ext = extname(entry.name).toLowerCase();
			if (!SOURCE_EXTS.has(ext)) continue;
			collectRefs(refs, await readFile(abs, 'utf8'), {
				json: ext === '.json',
				markup: ext === '.svelte' || ext === '.html',
				tops,
			});
			scanned++;
		}
	};
	for (const root of roots) await walk(root);
	return { refs, scanned };
}

/**
 * Read the reachable descriptor files among `rels` (relative to `dir`) and add what they name.
 * Returns true when that grew `refs`, so a caller can mirror the newly reachable files and run it
 * again until nothing changes. Each file is read once across calls (`seen`).
 */
export async function followDescriptors(dir, rels, refs, tops, seen) {
	const before = refs.files.size + refs.dirs.size;
	for (const rel of rels) {
		if (seen.has(rel) || !isReachable(rel, refs)) continue;
		if (!DESCRIPTOR_EXTS.has(extname(rel).toLowerCase())) continue;
		seen.add(rel);
		let text;
		try {
			text = await readFile(join(dir, ...rel.split('/')), 'utf8');
		} catch {
			continue;
		}
		collectRefs(refs, text, { json: true, tops });
	}
	return refs.files.size + refs.dirs.size > before;
}
