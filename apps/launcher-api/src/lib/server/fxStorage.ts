import { normalizeEffectDoc, type EffectDoc } from 'engine-fx';
import {
	FX_DOC_SUFFIX,
	FX_META_SUFFIX,
	fxDocKey,
	fxMetaKey,
	projectPrefix,
	r2Slug,
} from './projectPaths';
import { getObjectText, listObjects, putObjectText } from './r2';

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

/** Load one effect + its sidecar; a missing/invalid doc returns an empty effect under `id`. */
export async function loadEffect(
	clientKey: string,
	projectKey: string,
	id: string,
): Promise<{ doc: EffectDoc; meta: FxMeta }> {
	const rawDoc = await getObjectText(fxDocKey(clientKey, projectKey, id));
	let doc: EffectDoc;
	if (!rawDoc) {
		doc = normalizeEffectDoc(undefined, id);
	} else {
		try {
			doc = normalizeEffectDoc(JSON.parse(rawDoc), id);
		} catch {
			doc = normalizeEffectDoc(undefined, id);
		}
	}
	const rawMeta = await getObjectText(fxMetaKey(clientKey, projectKey, id));
	let meta: FxMeta = {};
	if (rawMeta) {
		try {
			meta = normalizeFxMeta(JSON.parse(rawMeta));
		} catch {
			meta = {};
		}
	}
	return { doc, meta };
}

/**
 * Persist an effect: the canonicalized EffectDoc to `<id>.fx.json` and the editor-only
 * sidecar to `<id>.fx.meta.json` — as TWO separate objects (§4). `normalizeEffectDoc` is
 * the gatekeeper: it strips editor-only state from the doc before it ever reaches R2, so
 * the shipped artifact stays pure. Returns the normalized doc (the id is the slug used for
 * the keys, so the caller learns the canonical id).
 */
export async function saveEffect(
	clientKey: string,
	projectKey: string,
	rawDoc: unknown,
	rawMeta: unknown,
): Promise<{ id: string; doc: EffectDoc }> {
	const requestedId = isObject(rawDoc) && typeof rawDoc.id === 'string' ? rawDoc.id : 'effect';
	const id = r2Slug(requestedId);
	const doc = normalizeEffectDoc(rawDoc, id);
	// The slugged id is authoritative for the file stem AND the doc's own id, so a reopened
	// effect's id round-trips to the same keys.
	doc.id = id;
	await putObjectText(
		fxDocKey(clientKey, projectKey, id),
		JSON.stringify(doc, null, 2),
		'application/json',
	);
	const meta = normalizeFxMeta(rawMeta);
	await putObjectText(
		fxMetaKey(clientKey, projectKey, id),
		JSON.stringify(meta, null, 2),
		'application/json',
	);
	return { id, doc };
}
