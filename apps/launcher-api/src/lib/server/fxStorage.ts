import { normalizeEffectDoc, type EffectDoc } from 'engine-fx';
import { deleteDocWithBackup, putDocWithBackup, readBackup, type BackupMode } from './docBackups';
import { pruneEffectBakes } from './fxBake';
import {
	FX_DOC_SUFFIX,
	FX_META_SUFFIX,
	docBackupSavedAt,
	fxBackupsPrefix,
	fxBakePrefix,
	fxDocBackupTarget,
	fxDocKey,
	fxMetaKey,
	projectPrefix,
	r2Slug,
} from './projectPaths';
import {
	deleteObject,
	getObjectText,
	getObjectTextWithEtag,
	listAllObjects,
	listObjects,
	objectExists,
	putObjectText,
} from './r2';

/**
 * R2 load/save for Invisible FX effects (design doc `invisible-fx.md` §4 / §6 / §8),
 * mirroring `flowStorage.ts` but MULTI-DOC: a project holds many named effects, each at
 * `<client>/<project>/<id>.fx.json`, with an editor-only sidecar at
 * `<id>.fx.meta.json`.
 *
 * The split is the gatekeeper for §4's out-of-band discipline: `normalizeEffectDoc` runs
 * here so editor-only state can NEVER leak into the shipped EffectDoc — the canonical doc
 * and the sidecar are written as two SEPARATE R2 objects. The same `engine-fx` normalizer
 * runs in the headless harness (`tools/fx-spike`), so the save contract is verified offline.
 */

/** Editor-only sidecar shape: camera/pan-zoom + last-selected layer. NEVER in the EffectDoc. */
export interface FxMeta {
	/** Pan/zoom of the preview stage (free-form so the page owns the exact shape). */
	camera?: { x: number; y: number; scale: number };
	/** Last-selected layer key, so reopening restores the inspector focus. */
	selectedLayer?: string;
}

/** A lightweight row for the effect picker — id + name, no layers. */
export interface FxEffectRow {
	id: string;
	name: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Coerce an arbitrary value to a clean `FxMeta` (drops anything off-schema). */
export function normalizeFxMeta(raw: unknown): FxMeta {
	const meta: FxMeta = {};
	if (!isObject(raw)) return meta;
	if (isObject(raw.camera)) {
		const { x, y, scale } = raw.camera;
		if (typeof x === 'number' && typeof y === 'number' && typeof scale === 'number') {
			meta.camera = { x, y, scale };
		}
	}
	if (typeof raw.selectedLayer === 'string') meta.selectedLayer = raw.selectedLayer;
	return meta;
}

/** The file stem (`<id>` of `<id>.fx.json`) extracted from a full R2 key, or '' if not one. */
function effectIdFromKey(key: string): string {
	const slash = key.lastIndexOf('/');
	const base = slash === -1 ? key : key.slice(slash + 1);
	if (!base.endsWith(FX_DOC_SUFFIX)) return '';
	return base.slice(0, -FX_DOC_SUFFIX.length);
}

/**
 * List a project's effects (the `*.fx.json` files at the project root). The `*.fx.meta.json`
 * sidecars are excluded — only the canonical EffectDoc is openable. Each row carries the
 * doc's `name` (read from the small JSON) so the picker shows a human label.
 */
export async function listEffects(clientKey: string, projectKey: string): Promise<FxEffectRow[]> {
	const prefix = `${projectPrefix(clientKey, projectKey)}/`;
	const listed = await listObjects(prefix, 1000);
	const docKeys = listed.keys.filter(
		(k) => k.endsWith(FX_DOC_SUFFIX) && !k.endsWith(FX_META_SUFFIX),
	);
	const rows: FxEffectRow[] = [];
	for (const key of docKeys) {
		const id = effectIdFromKey(key);
		if (!id) continue;
		let name = id;
		const raw = await getObjectText(key);
		if (raw) {
			try {
				const parsed = JSON.parse(raw) as unknown;
				if (isObject(parsed) && typeof parsed.name === 'string' && parsed.name) name = parsed.name;
			} catch {
				// keep the id as the label
			}
		}
		rows.push({ id, name });
	}
	rows.sort((a, b) => a.name.localeCompare(b.name));
	return rows;
}

/**
 * Load one effect + its sidecar; a missing/invalid doc returns an empty effect under `id`.
 *
 * `docEtag` is the ETag of the AUTHORED doc, for the save's compare-and-swap. It comes
 * off the read, so `null` means the effect does not exist yet (a create) and is NOT
 * confused with a corrupt doc, which also normalizes to an empty effect but carries an
 * etag. The sidecar has no etag on purpose — see {@link saveEffect}.
 */
export async function loadEffect(
	clientKey: string,
	projectKey: string,
	id: string,
): Promise<{ doc: EffectDoc; meta: FxMeta; docEtag: string | null }> {
	const obj = await getObjectTextWithEtag(fxDocKey(clientKey, projectKey, id));
	let doc: EffectDoc;
	if (!obj) {
		doc = normalizeEffectDoc(undefined, id);
	} else {
		try {
			doc = normalizeEffectDoc(JSON.parse(obj.text), id);
		} catch {
			doc = normalizeEffectDoc(undefined, id);
		}
	}
	const docEtag = obj?.etag ?? null;
	return { doc, meta: await loadEffectMeta(clientKey, projectKey, id), docEtag };
}

/** One effect's editor-only sidecar; missing or unparseable reads as `{}`. */
async function loadEffectMeta(clientKey: string, projectKey: string, id: string): Promise<FxMeta> {
	const rawMeta = await getObjectText(fxMetaKey(clientKey, projectKey, id));
	if (!rawMeta) return {};
	try {
		return normalizeFxMeta(JSON.parse(rawMeta));
	} catch {
		return {};
	}
}

/**
 * Persist an effect: the canonicalized EffectDoc to `<id>.fx.json` and the editor-only
 * sidecar to `<id>.fx.meta.json` — as TWO separate objects (§4). `normalizeEffectDoc` is
 * the gatekeeper: it strips editor-only state from the doc before it ever reaches R2, so
 * the shipped artifact stays pure. Returns the normalized doc (the id is the slug used for
 * the keys, so the caller learns the canonical id) and the doc's new ETag.
 *
 * CONCURRENCY (Phase 1 of `docs/design/multi-user-concurrency.md`). Only the DOC is
 * guarded by `baseEtag`; the sidecar is written unconditionally, after. That asymmetry
 * is deliberate and supersedes this doc's earlier suggestion to fold `FxMeta` into the
 * doc so the pair could be atomic: the sidecar holds nothing but editor VIEW state
 * (camera pan/zoom, last-selected layer), so losing a race on it costs a scroll
 * position, not authored work — while folding editor state into the shipped artifact
 * would be a real architecture change to buy atomicity nobody needs. Two objects, one
 * guard, no lost work.
 *
 * `baseEtag: null` asserts the effect does not exist yet, which is what stops the
 * CREATE clobber: a new effect's id is slugged from its NAME, so without the guard
 * "Save" on an effect sharing a colleague's name silently replaced theirs.
 *
 * The doc it replaces is kept as a backup (`docBackups.ts`, `mode` as for every doc), so an
 * effect's History can bring it back; the sidecar is not, being view state.
 */
export async function saveEffect(
	clientKey: string,
	projectKey: string,
	rawDoc: unknown,
	rawMeta: unknown,
	baseEtag?: string | null,
	mode: BackupMode = 'auto',
): Promise<{ id: string; doc: EffectDoc; etag: string | null }> {
	const requestedId = isObject(rawDoc) && typeof rawDoc.id === 'string' ? rawDoc.id : 'effect';
	const id = r2Slug(requestedId);
	const doc = normalizeEffectDoc(rawDoc, id);
	// The slugged id is authoritative for the file stem AND the doc's own id, so a reopened
	// effect's id round-trips to the same keys.
	doc.id = id;
	// A bake lives in its own effect's folder, which Save and Delete prune. A copy saved under a new
	// id would otherwise point at the original's sheet, and lose it the next time the original saves
	// — so a bake that is not this effect's is dropped and the copy bakes on its own.
	const bakedAt = doc.bake?.result?.assetKey;
	if (doc.bake && bakedAt && !bakedAt.startsWith(fxBakePrefix(clientKey, projectKey, id))) {
		delete doc.bake.result;
	}
	const etag = await putDocWithBackup(
		fxDocBackupTarget(clientKey, projectKey, id),
		JSON.stringify(doc, null, 2),
		baseEtag,
		mode,
	);
	// Only reached when the doc write WON, so the sidecar can never describe an effect
	// this save didn't store.
	const meta = normalizeFxMeta(rawMeta);
	await putObjectText(
		fxMetaKey(clientKey, projectKey, id),
		JSON.stringify(meta, null, 2),
		'application/json',
	);
	await pruneEffectBakes(clientKey, projectKey, id, doc.bake?.result?.assetKey);
	return { id, doc, etag };
}

/**
 * Delete one effect: BOTH the canonical `<id>.fx.json` and its editor-only `<id>.fx.meta.json`
 * sidecar (the two objects `saveEffect` writes). The id is slugged with the SAME `r2Slug` the
 * save path uses, so the caller's id maps to the exact keys on disk. Deleting a missing object
 * is a no-op on R2, so this is idempotent (a double-delete never errors). The doc is copied into
 * its History first, so a delete is undoable by restoring under the same id.
 *
 * `baseEtag` is the doc version the author opened: when someone saved since, this throws
 * `ConflictError` and deletes nothing (`deleteDocWithBackup`). `undefined` deletes whatever is
 * stored now — the author's explicit "delete anyway".
 */
export async function deleteEffect(
	clientKey: string,
	projectKey: string,
	rawId: string,
	baseEtag?: string,
): Promise<{ id: string }> {
	const id = r2Slug(rawId);
	await deleteDocWithBackup(fxDocBackupTarget(clientKey, projectKey, id), baseEtag, deleteObject);
	await deleteObject(fxMetaKey(clientKey, projectKey, id));
	await pruneEffectBakes(clientKey, projectKey, id);
	return { id };
}

/** A deleted effect whose History outlived it — a row of the "Deleted effects" list. */
export interface DeletedEffectRow {
	id: string;
	/** The `name` of its newest backup (the version that was deleted), else the id. */
	name: string;
	/** When its newest backup was the live doc — the delete, which always takes one (ISO 8601). */
	deletedAt: string;
	/** How many versions its History holds. */
	versions: number;
}

/**
 * The project's deleted effects, newest-deleted first: every `fx-backups/<id>/` folder whose
 * `<id>.fx.json` no longer exists. A delete keeps that folder on purpose (bounded at 20 by
 * retention), so this is how a deleted effect stays reachable; restoring one is an ordinary
 * restore under `baseEtag: null`, which re-creates the doc. One listing of the backups prefix,
 * then one HEAD per folder — `objectExists` throws on anything but a 404, so a storage blip
 * fails the list rather than reporting a live effect as deleted.
 */
export async function listDeletedEffects(
	clientKey: string,
	projectKey: string,
): Promise<DeletedEffectRow[]> {
	const prefix = fxBackupsPrefix(clientKey, projectKey);
	const folders = new Map<string, { newest: string; savedAt: string; versions: number }>();
	for (const obj of await listAllObjects(prefix)) {
		const [id, file, ...deeper] = obj.key.slice(prefix.length).split('/');
		const backupId = file?.replace(/\.json$/, '') ?? '';
		const savedAt = docBackupSavedAt('fx', backupId);
		if (!id || deeper.length || !savedAt) continue;
		const seen = folders.get(id);
		if (!seen) folders.set(id, { newest: backupId, savedAt, versions: 1 });
		else {
			seen.versions++;
			// Ids lead with a fixed-width UTC stamp, so the greater id is the newer backup.
			if (backupId > seen.newest) Object.assign(seen, { newest: backupId, savedAt });
		}
	}
	const rows = await Promise.all(
		[...folders].map(async ([id, { newest, savedAt, versions }]) => {
			if (await objectExists(fxDocKey(clientKey, projectKey, id))) return null;
			const raw = await readBackup(fxDocBackupTarget(clientKey, projectKey, id), newest);
			let name = id;
			try {
				const parsed = JSON.parse(raw ?? 'null') as unknown;
				if (isObject(parsed) && typeof parsed.name === 'string' && parsed.name) name = parsed.name;
			} catch {
				// keep the id as the label
			}
			return { id, name, deletedAt: savedAt, versions };
		}),
	);
	return rows
		.filter((row): row is DeletedEffectRow => row !== null)
		.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.id.localeCompare(b.id));
}

/**
 * Restore a backed-up EffectDoc over effect `id` under the caller's precondition, always taking a
 * backup of what it replaces. The live sidecar is kept (a restore changes the effect, not the
 * author's view of it). A bake whose sheet has since been pruned — every save drops all but the
 * current bake — is dropped too, so the restored effect re-bakes rather than shipping a pointer to
 * a sheet that no longer exists.
 */
export async function restoreEffect(
	clientKey: string,
	projectKey: string,
	id: string,
	restored: Record<string, unknown>,
	baseEtag: string | null | undefined,
): Promise<{ id: string; doc: EffectDoc; etag: string | null }> {
	const doc = normalizeEffectDoc({ ...restored, id }, id);
	const bakedAt = doc.bake?.result?.assetKey;
	if (doc.bake && bakedAt && !(await objectExists(bakedAt))) delete doc.bake.result;
	const meta = await loadEffectMeta(clientKey, projectKey, id);
	return saveEffect(clientKey, projectKey, doc, meta, baseEtag, 'always');
}
