/**
 * Relay a DESKTOP-BUILT game bundle into R2 through the portal instead of from the machine that
 * built it: the publisher sends each built file to `api/launcher/game-upload` and Railway writes
 * `test_server/<key>/<rel>`, prunes what the build no longer produces, and merges
 * `test_server/games.json`. Those are the same three steps `publish_game()` in
 * `Invisible_Launcher.py` performs itself with its own R2 credentials.
 *
 * WHY THIS EXISTS. Spanish ISPs null-route whole Cloudflare anycast ranges under the LaLiga
 * anti-piracy court orders, and `<account>.r2.cloudflarestorage.com` resolves INTO them
 * (172.64.66.1 / 172.64.190.1). On a blocked line DNS still answers but TCP 443 never connects, so
 * every desktop publish dies at its first R2 call with a bare `ConnectTimeoutError` — while the
 * portal, the test server and the rest of the zone stay reachable, because Railway is not behind
 * the block. The exe download has always worked this way round (`api/launcher/download` streams the
 * binary out of R2 server-side), so the bundle's bytes simply travel the same path upward.
 *
 * It relays the UPLOAD, not the build — the bundle is still built on the publisher's machine. A
 * server-side build farm was considered and deliberately deferred; see
 * `docs/design/invisible-game-maker.md` §"Considered and rejected: a cloud build farm".
 */
import { error } from '@sveltejs/kit';
import { assertSafeRel } from './deployServe';
import { isValidGameKey } from './games';
import { deleteObjects, listAllObjects, putObjectBytes } from './r2';
import {
	loadTestServerManifest,
	upsertTestServerGame,
	type MockProtocol,
	type TestServerGameEntry,
} from './testServerManifest';

/** Objects for one game live under this prefix — the manifest and the shared `_runtime/*` bundles
 *  sit OUTSIDE it, so nothing here can reach them. */
function bundlePrefix(key: string): string {
	return `test_server/${key}/`;
}

/**
 * A single relayed file, capped well under any sane `BODY_SIZE_LIMIT`. The adapter rejects an
 * oversized body before this module runs; this is the second wall, so a raised limit can't turn one
 * request into an unbounded Railway allocation.
 */
export const MAX_RELAY_FILE_BYTES = 64 * 1024 * 1024;

/**
 * Content types for the files a GAME BUNDLE is made of — `index.html`, the Vite chunks, the
 * stylesheet — which `deployContentType` deliberately doesn't cover: it types authoring ASSETS
 * (art, fonts, sounds) and has no `html`/`js`/`css`, and serving a bundle's JS as
 * `application/octet-stream` would stop the game booting. Mirrors `MIME` in
 * `scripts/publish-game-bundle.mjs` and `_GAME_MIME` in `Invisible_Launcher.py`; the three copies
 * exist because those two are a standalone script and another language.
 */
const BUNDLE_CONTENT_TYPES: Record<string, string> = {
	html: 'text/html; charset=utf-8',
	js: 'text/javascript; charset=utf-8',
	mjs: 'text/javascript; charset=utf-8',
	css: 'text/css; charset=utf-8',
	json: 'application/json; charset=utf-8',
	map: 'application/json; charset=utf-8',
	txt: 'text/plain; charset=utf-8',
	atlas: 'text/plain; charset=utf-8',
	xml: 'application/xml',
	fnt: 'application/xml',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif',
	svg: 'image/svg+xml',
	ico: 'image/x-icon',
	ktx2: 'image/ktx2',
	woff: 'font/woff',
	woff2: 'font/woff2',
	ttf: 'font/ttf',
	otf: 'font/otf',
	wasm: 'application/wasm',
	mp3: 'audio/mpeg',
	ogg: 'audio/ogg',
	wav: 'audio/wav',
	m4a: 'audio/mp4',
	webm: 'audio/webm',
};

export function bundleContentType(rel: string): string {
	const dot = rel.lastIndexOf('.');
	if (dot === -1) return 'application/octet-stream';
	return BUNDLE_CONTENT_TYPES[rel.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream';
}

/** 400 unless `key` is a game key this endpoint may write — the same shape `games.ts` and the
 *  launcher's own `publish_game()` enforce. */
export function assertPublishableKey(key: string): void {
	if (!isValidGameKey(key)) {
		throw error(400, `Invalid game key '${key}' — lowercase letters/digits/_/- only.`);
	}
}

/**
 * The R2 key one relayed file lands on. `assertSafeRel` rejects `..`, backslashes and absolute
 * refs; the rest keeps a relative path from resolving anywhere but inside this game's prefix.
 */
export function bundleObjectKey(key: string, rel: string): string {
	assertPublishableKey(key);
	if (!rel || rel.endsWith('/') || rel.startsWith('./') || /^[a-zA-Z]:/.test(rel)) {
		throw error(400, `Invalid bundle path '${rel}'.`);
	}
	assertSafeRel(rel);
	return `${bundlePrefix(key)}${rel}`;
}

/**
 * Refuse to let a desktop build take over a key the ONLINE Game Maker publishes — the mirror of
 * `publishGame.ts`'s `hasOwnBuiltBundle` guard, and a port of `_assert_not_online_runtime` in
 * `Invisible_Launcher.py`.
 *
 * An online game's entry carries a `runtime` field: it boots the shared prebuilt bundle against
 * live R2 authoring data and has NO per-key bundle, so a merge that replaced its entry would swap
 * the live online game for this compiled build.
 *
 * It FAILS CLOSED, deliberately. An absent or malformed manifest reads as empty (no entry, key
 * free), so anything that throws out of the read is a TRANSIENT failure — a blip, a throttled
 * credential, a 5xx — which leaves the guard unable to prove the key is free. Relaying anyway is
 * the one case this guard exists for. Called before EVERY file, not once per publish: an online
 * publish landing mid-upload then stops the rest of it.
 */
export async function assertNotOnlinePublished(key: string): Promise<void> {
	let entry: TestServerGameEntry | undefined;
	try {
		entry = (await loadTestServerManifest()).games[key];
	} catch (e) {
		throw error(
			503,
			`Could not read the games manifest, so this publish cannot check whether '${key}' is ` +
				`already published ONLINE by the Invisible Game Maker. Nothing was written. ` +
				`(${e instanceof Error ? e.message : String(e)})`,
		);
	}
	if (entry?.runtime) {
		throw error(
			409,
			`'${key}' is published ONLINE by the Invisible Game Maker (runtime '${entry.runtime}'), ` +
				`so a desktop build must not overwrite it — that would replace the live online game ` +
				`with this compiled build. Give this build its own cloud key (e.g. '${key}build').`,
		);
	}
}

/** Write one built file into this game's prefix. Guarded, prefix-scoped, size-capped. */
export async function relayBundleFile(
	key: string,
	rel: string,
	bytes: Uint8Array,
): Promise<{ key: string; path: string; bytes: number }> {
	const objectKey = bundleObjectKey(key, rel);
	if (bytes.byteLength > MAX_RELAY_FILE_BYTES) {
		throw error(413, `'${rel}' is ${bytes.byteLength} bytes — over the per-file relay cap.`);
	}
	await assertNotOnlinePublished(key);
	await putObjectBytes(objectKey, bytes, bundleContentType(rel));
	return { key, path: rel, bytes: bytes.byteLength };
}

export interface CommitBundleRequest {
	key: string;
	name: string;
	protocol: MockProtocol;
	/** EVERY relative path this build produced — the set the prune is taken against. */
	files: string[];
}

export interface CommitBundleResult {
	key: string;
	files: number;
	pruned: number;
	entry: TestServerGameEntry;
}

/**
 * Finish a relayed publish: verify the declared files really landed, prune what this build no
 * longer produces, then merge the game into the manifest.
 *
 * VERIFY BEFORE REGISTER, which the direct-to-R2 path does not do. A publish that uploads file by
 * file can be interrupted half way (a dropped line mid-matchday is exactly how we got here), and
 * registering then would hand the test server a game with missing chunks — a white screen whose
 * cause is invisible. Listing the prefix once answers both questions, so the check is free.
 *
 * PRUNE, because the upload is additive: without it a file removed or renamed between builds (a
 * deleted sprite, a re-hashed chunk) lingers in R2 and keeps being served, so a bundle can never
 * shrink and old art can resurface. Scoped strictly to this game's prefix.
 *
 * The pin (`projectKey`/`docBase`/`readToken`) and the math snapshot are CARRIED FORWARD from the
 * existing entry, because `upsertTestServerGame` replaces the entry wholesale. Dropping the pin is
 * what once left `waysofwavesbuild` (project `test6`) dealing the mock's default 5×3 lines board
 * against a stepped `ways` client. `register-game` re-stamps it moments later, but only if the
 * publisher gets that far — carrying it here means the entry is never briefly unpinned at all.
 */
export async function commitBundlePublish(req: CommitBundleRequest): Promise<CommitBundleResult> {
	const { key, name, protocol, files } = req;
	assertPublishableKey(key);
	if (!files.includes('index.html')) {
		throw error(400, 'The declared file list has no index.html — that is not a game bundle.');
	}
	const declared = new Set(files.map((rel) => bundleObjectKey(key, rel)));
	await assertNotOnlinePublished(key);

	const prefix = bundlePrefix(key);
	const present = new Set(
		(await listAllObjects(prefix)).filter((o) => !o.key.endsWith('/')).map((o) => o.key),
	);
	const missing = [...declared].filter((k) => !present.has(k));
	if (missing.length > 0) {
		throw error(
			409,
			`${missing.length} of ${declared.size} file(s) never arrived — not registering a ` +
				`half-published game. Re-run the publish (it resumes). Missing: ` +
				`${missing
					.slice(0, 5)
					.map((k) => k.slice(prefix.length))
					.join(', ')}${missing.length > 5 ? ', …' : ''}`,
		);
	}

	const stale = [...present].filter((k) => !declared.has(k));
	if (stale.length > 0) await deleteObjects(stale);

	const previous = (await loadTestServerManifest()).games[key];
	const entry: TestServerGameEntry = {
		...previous,
		protocol,
		name,
		updatedAt: new Date().toISOString(),
	};
	// A relayed desktop build is served from its OWN files, so it must never carry the online
	// runtime pointer — and `assertNotOnlinePublished` has already refused if one was there.
	delete entry.runtime;
	await upsertTestServerGame(key, entry);

	return { key, files: declared.size, pruned: stale.length, entry };
}
