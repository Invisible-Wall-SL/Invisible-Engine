import {
	normalizeFlipbookClip,
	normalizeFlipbookDoc,
	type FlipbookClip,
	type FlipbookDoc,
} from 'engine-flipbook';
import { CLIP_DOC_SUFFIX, clipDocKey, clipsPrefix, r2Slug } from './projectPaths';
import {
	canonicalizeAtlasRef,
	isBareManifestBasename,
	manifestBasenameMap,
} from './manifestBasename';
import {
	deleteObject,
	getObjectText,
	getObjectTextWithEtag,
	listObjects,
	precondition,
	putObjectText,
} from './r2';

/**
 * R2 load/save for Invisible Flipbook clips (design doc `invisible-flipbook.md`), mirroring
 * `fxStorage.ts`: MULTI-DOC, one clip per `<client>/<project>/clips/<id>.clip.json`.
 *
 * Per-clip files rather than one project doc so each clip carries its own compare-and-swap
 * guard — two authors editing DIFFERENT clips must never collide (Phase 1 of
 * `docs/design/multi-user-concurrency.md`). `FlipbookDoc` is the ASSEMBLED collection the bake
 * emits and `registerFlipbooks` consumes; it is not the storage unit.
 *
 * There is no editor-only sidecar here (unlike FX's `.fx.meta.json`): a clip has no camera or
 * selection state worth persisting — the frame list IS the document.
 */

/** A lightweight row for the clip picker — no frame list. */
export interface FlipbookClipRow {
	id: string;
	name: string;
	/** Frame count, so the picker can show "12 frames" without loading every doc's array. */
	frames: number;
	/**
	 * The clip's PRIMARY sheet manifest key. Carried on the row because a consumer that binds a
	 * clip still has to record an `assetKey` — the Symbols State Machine's `symbolCellSchema`
	 * requires one on every cell kind, so a flipbook cell stores this.
	 */
	assetKey: string;
	/**
	 * First frame of the ordered run (a bare region name, or an `<assetKey>::<region>` scoped ref
	 * for a multi-sheet clip). Lets a picker show a STILL thumbnail without loading the whole doc.
	 */
	firstFrame: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** The `<id>` of `<id>.clip.json` extracted from a full R2 key, or '' if not one. */
function clipIdFromKey(key: string): string {
	const slash = key.lastIndexOf('/');
	const base = slash === -1 ? key : key.slice(slash + 1);
	if (!base.endsWith(CLIP_DOC_SUFFIX)) return '';
	return base.slice(0, -CLIP_DOC_SUFFIX.length);
}

/** List a project's clips (the `*.clip.json` files under `clips/`), sorted by label. */
export async function listClips(clientKey: string, projectKey: string): Promise<FlipbookClipRow[]> {
	const prefix = `${clipsPrefix(clientKey, projectKey)}/`;
	const listed = await listObjects(prefix, 1000);
	const rows: FlipbookClipRow[] = [];
	for (const key of listed.keys.filter((k) => k.endsWith(CLIP_DOC_SUFFIX))) {
		const id = clipIdFromKey(key);
		if (!id) continue;
		let name = id;
		let frames = 0;
		let assetKey = '';
		let firstFrame = '';
		const raw = await getObjectText(key);
		if (raw) {
			try {
				const parsed = JSON.parse(raw) as unknown;
				if (isObject(parsed)) {
					if (typeof parsed.name === 'string' && parsed.name) name = parsed.name;
					if (typeof parsed.assetKey === 'string') assetKey = parsed.assetKey;
					if (Array.isArray(parsed.frames)) {
						frames = parsed.frames.length;
						const first = parsed.frames[0];
						if (typeof first === 'string') firstFrame = first;
					}
				}
			} catch {
				// keep the id as the label — a corrupt doc still lists so it can be opened + fixed
			}
		}
		rows.push({ id, name, frames, assetKey, firstFrame });
	}
	rows.sort((a, b) => a.name.localeCompare(b.name));
	return rows;
}

/**
 * Load one clip. A missing or unusable doc returns `clip: null` (NOT an empty clip): unlike an
 * effect, a clip with no `assetKey` cannot be meaningfully authored from nothing, so the page
 * shows "not found" rather than silently presenting a blank doc under a real id.
 *
 * `etag` is the ETag of the stored doc for the save's compare-and-swap. `null` means the clip
 * does not exist yet (a create), which the save asserts with `ifNoneMatch`.
 */
export async function loadClip(
	clientKey: string,
	projectKey: string,
	id: string,
): Promise<{ clip: FlipbookClip | null; etag: string | null }> {
	const obj = await getObjectTextWithEtag(clipDocKey(clientKey, projectKey, id));
	if (!obj) return { clip: null, etag: null };
	let clip: FlipbookClip | null = null;
	try {
		clip = normalizeFlipbookClip(JSON.parse(obj.text)) ?? null;
	} catch {
		clip = null;
	}
	return { clip, etag: obj.etag ?? null };
}

/**
 * Persist one clip to `<id>.clip.json`. `normalizeFlipbookClip` is the gatekeeper — editor-only
 * state can never reach R2, and an unusable clip is rejected loudly rather than written.
 *
 * `baseEtag: null` asserts the clip does not exist yet, which stops the CREATE clobber: a new
 * clip's id is slugged from its NAME, so without the guard "Save" on a clip sharing a
 * colleague's name would silently replace theirs (the exact bug `saveEffect` documents).
 */
export async function saveClip(
	clientKey: string,
	projectKey: string,
	rawClip: unknown,
	baseEtag?: string | null,
): Promise<{ id: string; clip: FlipbookClip; etag: string | null }> {
	const requestedId = isObject(rawClip) && typeof rawClip.id === 'string' ? rawClip.id : 'clip';
	const id = r2Slug(requestedId);
	const clip = normalizeFlipbookClip({ ...(isObject(rawClip) ? rawClip : {}), id });
	if (!clip) {
		// Only reachable when the clip has no usable assetKey — id is forced above.
		throw new Error('A clip needs a source sheet (assetKey) before it can be saved.');
	}
	const etag = await putObjectText(
		clipDocKey(clientKey, projectKey, id),
		JSON.stringify(clip, null, 2),
		'application/json',
		precondition(baseEtag),
	);
	return { id, clip, etag };
}

/** Delete one clip. Deleting a missing object is a no-op on R2, so this is idempotent. */
export async function deleteClip(
	clientKey: string,
	projectKey: string,
	rawId: string,
): Promise<{ id: string }> {
	const id = r2Slug(rawId);
	await deleteObject(clipDocKey(clientKey, projectKey, id));
	return { id };
}

/** Rewrite a clip's `assetKey` and any scoped frame prefixes from a bare manifest basename to the
 *  full R2 key. Bare (unscoped) frames are left alone — they scope against `assetKey` at resolve
 *  time, so repairing `assetKey` restores their scope too. */
function canonicalizeClipAtlasKeys(clip: FlipbookClip, byBasename: Map<string, string>): FlipbookClip {
	const assetKey = canonicalizeAtlasRef(clip.assetKey, byBasename);
	const frames = clip.frames.map((frame) => {
		const i = frame.indexOf('::');
		if (i <= 0) return frame; // bare frame — scoped by `assetKey`, not a per-frame atlas ref
		const prefix = frame.slice(0, i);
		const full = canonicalizeAtlasRef(prefix, byBasename);
		return full === prefix ? frame : `${full}::${frame.slice(i + 2)}`;
	});
	return { ...clip, assetKey, frames };
}

/** True when any clip carries a bare-basename atlas ref that needs repairing — gates the R2
 *  manifest listing so a correctly-authored project pays nothing. */
function anyBareManifestRef(clips: FlipbookClip[]): boolean {
	return clips.some(
		(c) =>
			isBareManifestBasename(c.assetKey) ||
			c.frames.some((f) => {
				const i = f.indexOf('::');
				return i > 0 && isBareManifestBasename(f.slice(0, i));
			}),
	);
}

/**
 * Assemble every clip in the project into one `FlipbookDoc` — what the bake embeds and
 * `registerFlipbooks` consumes at boot. Runs the collection normalizer so duplicate ids
 * collapse (last wins) exactly as the runtime registry would resolve them.
 *
 * Bare-basename atlas refs are repaired to full manifest keys (see `isBareManifestBasename`) so
 * the runtime's atlas-scoped frame lookup engages — without this two single-page clips reusing a
 * frame name on distinct sheets collide in the flat texture cache. Both ship-path readers
 * (`exportClips` and the editor-art clip walk) go through here, so the editor-art export then
 * ships each repaired sheet SCOPED under the same full key the runtime looks up.
 */
export async function loadFlipbookDoc(clientKey: string, projectKey: string): Promise<FlipbookDoc> {
	const prefix = `${clipsPrefix(clientKey, projectKey)}/`;
	const listed = await listObjects(prefix, 1000);
	const clips: unknown[] = [];
	for (const key of listed.keys.filter((k) => k.endsWith(CLIP_DOC_SUFFIX))) {
		const raw = await getObjectText(key);
		if (!raw) continue;
		try {
			clips.push(JSON.parse(raw));
		} catch {
			// A corrupt clip is skipped, not fatal — the bake's dangling-frame guard is the
			// ship-time gate, and one bad file must not block every other clip from shipping.
		}
	}
	const doc = normalizeFlipbookDoc({ clips });
	if (!anyBareManifestRef(doc.clips)) return doc;
	const byBasename = await manifestBasenameMap(clientKey, projectKey);
	if (byBasename.size === 0) return doc;
	return { ...doc, clips: doc.clips.map((c) => canonicalizeClipAtlasKeys(c, byBasename)) };
}
