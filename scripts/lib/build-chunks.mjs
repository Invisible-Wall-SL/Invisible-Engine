// What a visit to a built game downloads: the `index.html` shell and the files it loads eagerly (the
// bundle, its CSS, and their static imports), plus — for an online game — its family's online
// chunk, as opposed to the lazy chunks only some boots reach (the error-reporting SDK with a DSN,
// Pixi's canvas fallback).
//
// Read off the build, not off a browser, so `check-family-runtime.mjs --measure` stays a pure build
// check; `check-runtime-shell.mjs` boots the same builds and fails when Chromium loaded anything at
// boot that `firstVisit()` does not count (other than the SDK, which only a build with a DSN that
// may report fetches).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const STATIC_IMPORT =
	/(?:\bimport|\bexport)\s*(?:[\w$*{}\s,]+?\s*from\s*)?["'](\.{1,2}\/[^"']+)["']/g;
const SHELL_LOAD =
	/(?:import\(\s*["']|<link[^>]+href=["'])\.\/(_app\/immutable\/[^"']+\.(?:js|css))["']/g;

const gz = (buffer) => gzipSync(buffer, { level: 6 }).length;

/** Every file under `_app/immutable/` (JS and CSS), with its size and its static imports. */
export function chunkGraph(buildDir) {
	const root = join(buildDir, '_app/immutable');
	const files = new Map();
	if (!existsSync(root)) return files;
	for (const entry of readdirSync(root, { recursive: true }).map(String)) {
		const rel = entry.split(sep).join('/');
		if (!/\.(js|css)$/.test(rel) || !statSync(join(root, entry)).isFile()) continue;
		const body = readFileSync(join(root, entry));
		const code = rel.endsWith('.js') ? body.toString('utf8') : '';
		files.set(rel, {
			gz: gz(body),
			code,
			static: [...code.matchAll(STATIC_IMPORT)].map((m) =>
				posix.normalize(posix.join(posix.dirname(rel), m[1])),
			),
		});
	}
	return files;
}

/**
 * The shell, what a first visit downloads (`eager`: what the shell loads and their static imports)
 * and what it does not (`lazy`), each a list of paths under `_app/immutable/`, with gzip -6 sizes
 * of each file as it is served. `online`: the lazy chunks holding any of `onlineMarkers` (a family's
 * online code, which every boot of an ONLINE game of that family imports) and their static imports;
 * `gz.onlineVisit` is a first visit to such a game.
 */
export function firstVisit(buildDir, { onlineMarkers = [] } = {}) {
	const shellBody = readFileSync(join(buildDir, 'index.html'));
	const files = chunkGraph(buildDir);
	const closure = (roots, into, skip = new Set()) => {
		const stack = [...roots];
		while (stack.length) {
			const rel = stack.pop();
			if (into.has(rel) || skip.has(rel) || !files.has(rel)) continue;
			into.add(rel);
			stack.push(...files.get(rel).static);
		}
		return into;
	};
	const roots = [...shellBody.toString('utf8').matchAll(SHELL_LOAD)].map((m) =>
		m[1].slice('_app/immutable/'.length),
	);
	const eager = closure(roots, new Set());
	const onlineRoots = [...files.keys()].filter(
		(f) => !eager.has(f) && onlineMarkers.some((m) => files.get(f).code.includes(m)),
	);
	const online = closure(onlineRoots, new Set(), eager);
	const lazy = [...files.keys()].filter((f) => !eager.has(f));
	const sum = (list) => [...list].reduce((total, f) => total + files.get(f).gz, 0);
	const shell = gz(shellBody);
	const firstVisitGz = shell + sum(eager);
	return {
		eager: [...eager],
		online: [...online],
		lazy,
		gz: {
			shell,
			eager: sum(eager),
			online: sum(online),
			lazy: sum(lazy),
			firstVisit: firstVisitGz,
			onlineVisit: firstVisitGz + sum(online),
		},
	};
}

/** Every JS file of a build — the shell, every chunk, eager or lazy — for a content check. */
export function allCode(buildDir) {
	const shell = readFileSync(join(buildDir, 'index.html'), 'utf8');
	return [shell, ...[...chunkGraph(buildDir).values()].map((f) => f.code)].join('\n');
}
