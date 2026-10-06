// The Typekit mirror: what the harness's browser needs from Adobe, served from R2 instead.
//
// The runtime loads its web fonts from Adobe twice over — the app template's kit stylesheet
// (`apps/lines/src/app.html`: `use.typekit.net/<kit>.css`) and WebFontLoader's typekit module
// (`pixi-svelte`'s `preloadFont`: `use.typekit.net/<kit>.js`) — and each render then fetches the
// kit's faces from `use.typekit.net/af/…` and pings `p.typekit.net`. Players keep doing exactly
// that; this file changes nothing they load. In CI an Adobe outage stalls every frame (determinism
// mode waits for stylesheets, scripts and `FontFace.load()`), so the harness answers those two
// hosts itself: `use.typekit.net` from a mirror of the kit (R2, `_ci/typekit-mirror/`), and the
// `p.typekit.net` beacons locally, with empty bodies — nothing waits on them and nothing reaches
// Adobe. A URL the mirror lacks fails the render, naming it: the fix is a refresh, never a quiet
// fallback to the network. The one loud fallback: no mirror in R2 at all (before its first upload)
// renders from Adobe as players do and says so in a warning, so the harness works before the
// mirror exists and the dependency is visible in every report until it does.
//
// Layout in R2 (and in a local mirror dir): `current.json` (the manifest: kits, every URL with its
// sha256, content type and size, and a `hash` over the lot) and `blobs/<sha256>` (immutable by
// name). The plan pins the manifest hash the way it pins a game's snapshot: a refresh mid-run
// fails the units it would have changed, never hands two renders two fonts. The refresh is
// `scripts/current-games/typekit-mirror.mjs` (the "Typekit mirror" workflow). Everything here that
// touches R2 reads, with the harness's read-only key.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { download, getText } from './games.mjs';

export const KIT_HOST = 'use.typekit.net';
export const BEACON_HOST = 'p.typekit.net';
export const TYPEKIT_HOSTS = [KIT_HOST, BEACON_HOST];
export const MIRROR_PREFIX = '_ci/typekit-mirror/';
export const MANIFEST_KEY = `${MIRROR_PREFIX}current.json`;
export const blobKey = (sha256) => `${MIRROR_PREFIX}blobs/${sha256}`;
export const MANIFEST_FILE = 'current.json';

/** Where the runtime names its kit: the app template's stylesheet and pixi-svelte's loader. */
export const KIT_SOURCES = [
	'apps/lines/src/app.html',
	'packages/pixi-svelte/src/lib/utils.svelte.ts',
];
const KIT_IN_URL = /use\.typekit\.net\/([a-z0-9]+)\.(?:css|js)/g;
const KIT_IN_LOADER = /typekit:\s*\{\s*id:\s*['"]([a-z0-9]+)['"]/g;

/** The kit ids the runtime at `root` loads, harvested from its sources, sorted. */
export function kitIds(root) {
	const ids = new Set();
	for (const rel of KIT_SOURCES) {
		const text = readFileSync(join(root, rel), 'utf8');
		for (const m of text.matchAll(KIT_IN_URL)) ids.add(m[1]);
		for (const m of text.matchAll(KIT_IN_LOADER)) ids.add(m[1]);
	}
	return [...ids].sort();
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// The kit stylesheet names each face's files as `url("https://use.typekit.net/af/…")`; the kit
// script is mirrored whole and not parsed (minified, it spells URLs in pieces): on every live
// render it loaded exactly the stylesheet's faces, and a render it asks for anything else fails
// naming the URL. The beacon host is not crawled: it is answered locally.
const URL_IN_CSS = /url\(\s*(['"]?)(https?:\/\/use\.typekit\.net\/[^'")\s]+)\1\s*\)/g;
// What the harness's browser is: Adobe serves the same kit to every modern browser, and the mirror
// records what a Chrome asked for.
const USER_AGENT =
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** Fetch `kitId`'s stylesheet, its script and every file the stylesheet names: `[{ url, contentType, body }]`. */
export async function crawlKit(kitId, fetchImpl = fetch) {
	const get = async (url) => {
		const res = await fetchImpl(url, {
			headers: { 'user-agent': USER_AGENT },
			signal: AbortSignal.timeout(60_000),
		});
		if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
		return {
			url,
			contentType: (res.headers.get('content-type') ?? 'application/octet-stream')
				.split(';')[0]
				.trim(),
			body: Buffer.from(await res.arrayBuffer()),
		};
	};
	const css = await get(`https://${KIT_HOST}/${kitId}.css`);
	const js = await get(`https://${KIT_HOST}/${kitId}.js`);
	const urls = new Set();
	for (const m of css.body.toString('utf8').matchAll(URL_IN_CSS)) urls.add(m[2]);
	urls.delete(css.url);
	urls.delete(js.url);
	const files = [css, js];
	for (const url of urls) files.push(await get(url));
	return files;
}

/** The identity of a mirror: every URL with its bytes' hash, in URL order. */
export const manifestHash = (entries) =>
	sha256(
		[...entries]
			.sort((a, b) => a.url.localeCompare(b.url))
			.map((e) => `${e.url} ${e.sha256}`)
			.join('\n'),
	).slice(0, 16);

/** The manifest for `files` (from `crawlKit`) of `kits`. */
export function manifestFor(kits, files, fetchedAt = new Date().toISOString()) {
	// A URL two kits share (a face in both) is one entry.
	const byUrl = new Map(files.map((f) => [f.url, f]));
	const entries = [...byUrl.values()]
		.map((f) => ({
			url: f.url,
			sha256: sha256(f.body),
			contentType: f.contentType,
			size: f.body.length,
		}))
		.sort((a, b) => a.url.localeCompare(b.url));
	return {
		version: 1,
		kits: [...kits].sort(),
		fetchedAt,
		hash: manifestHash(entries),
		files: entries,
	};
}

/** Write `manifest` + `files` as a mirror dir (`current.json` + `blobs/<sha256>`). */
export function writeMirrorDir(dir, manifest, files) {
	mkdirSync(join(dir, 'blobs'), { recursive: true });
	for (const f of files) writeFileSync(join(dir, 'blobs', sha256(f.body)), f.body);
	writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, '\t'));
	return dir;
}

export const readMirrorDir = (dir) => JSON.parse(readFileSync(join(dir, MANIFEST_FILE), 'utf8'));

/** The mirror's manifest in R2, or `null` when none was ever uploaded. */
export async function readMirrorManifest() {
	const text = await getText(MANIFEST_KEY);
	return text === null ? null : JSON.parse(text);
}

/** A manifest with `pin.hash`, or why it is not the one the plan pinned. */
function checkPinned(manifest, pin, where) {
	if (!manifest) throw new Error(`the Typekit mirror is gone from ${where} (${MANIFEST_KEY})`);
	if (manifest.hash !== pin.hash)
		throw new Error(
			`the Typekit mirror changed during the run (${where}: ${manifest.hash}, planned ${pin.hash}) — it was refreshed`,
		);
	return manifest;
}

/**
 * Download the pinned mirror from R2 into `<cache>/typekit/<hash>/` (blobs are immutable by name:
 * a complete one is never fetched twice) and return the dir.
 */
export async function fetchMirror(pin, cache) {
	const manifest = checkPinned(await readMirrorManifest(), pin, 'R2');
	const dir = join(cache, 'typekit', manifest.hash);
	mkdirSync(join(dir, 'blobs'), { recursive: true });
	for (const f of manifest.files) {
		const file = join(dir, 'blobs', f.sha256);
		if (existsSync(file) && sha256(readFileSync(file)) === f.sha256) continue;
		await download(blobKey(f.sha256), file);
		if (sha256(readFileSync(file)) !== f.sha256)
			throw new Error(`Typekit mirror blob ${f.sha256} does not match its name`);
	}
	writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, '\t'));
	return dir;
}

const GIF_1X1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const EMPTY = Buffer.alloc(0);

/** The local answer for a `p.typekit.net` beacon: an empty stylesheet, a 1×1 gif, or nothing. */
export function beacon(url) {
	const path = new URL(url).pathname;
	if (path.endsWith('.css')) return { contentType: 'text/css', body: EMPTY };
	if (path.endsWith('.gif')) return { contentType: 'image/gif', body: GIF_1X1 };
	return { contentType: 'text/plain', body: EMPTY };
}

/**
 * The browser's answer for one URL (`openPage({ intercept })`): `{ contentType, body }` to serve,
 * `null` for a kit URL the mirror lacks (the request fails and the render names it), `undefined`
 * for a host that is not Typekit's (the request goes out as usual).
 */
export function interceptorFor(manifest, dir) {
	const files = new Map(
		manifest.files.map((f) => [
			f.url,
			{ contentType: f.contentType, body: readFileSync(join(dir, 'blobs', f.sha256)) },
		]),
	);
	return (url) => {
		const host = new URL(url).hostname;
		if (host === BEACON_HOST) return beacon(url);
		if (host !== KIT_HOST) return undefined;
		return files.get(url) ?? null;
	};
}

/** A GitHub annotation on a runner, a plain line elsewhere. */
const warn = (message) =>
	console.log(`${process.env.GITHUB_ACTIONS ? '::warning::' : 'warning: '}${message}`);

const pinOf = (manifest, source) => ({
	mode: 'mirror',
	source,
	hash: manifest.hash,
	kits: manifest.kits,
	fetchedAt: manifest.fetchedAt,
	files: manifest.files.length,
});

/**
 * The plan's Typekit decision. `mode`: `network` (Adobe, as players: a local run with no R2),
 * `mirror` (R2, pinned by hash: the live games), or a local mirror dir. No mirror in R2 yet means
 * `network` with a warning and the reason on record; a mirror that lacks a kit the runtime at
 * `root` names fails the plan, naming the refresh.
 */
export async function planTypekit(mode, root, { read = readMirrorManifest } = {}) {
	if (mode === 'network') return { mode: 'network' };
	if (mode !== 'mirror') {
		if (!existsSync(join(mode, MANIFEST_FILE)))
			throw new Error(
				`--typekit must be auto, mirror, network or a mirror dir holding ${MANIFEST_FILE}; got ${JSON.stringify(mode)}`,
			);
		return pinOf(readMirrorDir(mode), mode);
	}
	const manifest = await read();
	// Also a commit-status description, which GitHub cuts at 140 characters: the fix must fit.
	const refresh = 'run the "Typekit mirror" workflow';
	if (!manifest) {
		const reason = `the Typekit mirror is missing from R2 (${MANIFEST_KEY}): fonts come from Adobe until it is uploaded (${refresh})`;
		warn(reason);
		return { mode: 'network', reason };
	}
	const missing = kitIds(root).filter((id) => !manifest.kits.includes(id));
	if (missing.length)
		throw new Error(
			`the Typekit mirror (kits ${manifest.kits.join(', ')}) lacks kit(s) the runtime loads (${missing.join(', ')}): ${refresh}, then re-run`,
		);
	return pinOf(manifest, 'r2');
}

/** The interceptor a render uses for the plan's decision, or `undefined` for `network`. */
export async function mirrorInterceptor(typekit, cache) {
	if (!typekit || typekit.mode === 'network') return undefined;
	let dir = typekit.source;
	if (dir === 'r2') dir = await fetchMirror(typekit, cache);
	else checkPinned(readMirrorDir(dir), typekit, dir);
	return interceptorFor(readMirrorDir(dir), dir);
}

/** One line for the digest and the report. */
export const describeTypekit = (typekit) =>
	!typekit || typekit.mode === 'network'
		? `typekit: network — fonts came from use.typekit.net (${typekit?.reason ?? 'no mirror'})`
		: `typekit: mirror ${typekit.hash} (${typekit.files} files, kits ${typekit.kits.join(', ')}, fetched ${typekit.fetchedAt}, from ${typekit.source})`;
