/**
 * Invisible FX — Phase 1 save-split headless harness (design doc §4 / §6 / §8).
 *
 *   pnpm --filter fx-spike run save
 *
 * Proves, HEADLESSLY (no R2, no browser), the SAVE-SIDE contract the `/api/fx/save` endpoint
 * + `fxStorage.saveEffect` stand on — the EffectDoc↔sidecar split + the R2-key derivation —
 * the way the rigger-save logic is checked offline ([[feedback_validate_data_contracts_offline]]):
 *
 *  A. THE SPLIT — `normalizeEffectDoc` is the gatekeeper: editor-only state in the save
 *     payload (camera, last-selected layer, swatches) NEVER survives into the canonical
 *     EffectDoc; it can only live in the SEPARATE `.fx.meta.json` sidecar (§4). The two
 *     objects are derived independently from one request body.
 *
 *  B. KEY DERIVATION — the effect id slugs (the launcher's `r2Slug`) into a path-safe file
 *     stem, the doc + meta keys are siblings under `<client>/<project>/`, and an opened
 *     effect's id round-trips back to the SAME keys (stable `assetKey`/file-stem rule, §9).
 *
 * `r2Slug` + the meta normalizer + the key builders are REPLICATED here (byte-identical to
 * `projectPaths.ts` / `fxStorage.ts`) because those modules pull in `$lib` server deps (R2
 * client) that don't import in a Node harness — the launcher build is the type gate, this is
 * the logic gate. Any drift is caught by the assertions below mirroring the live shapes.
 */

import { normalizeEffectDoc, type EffectDoc } from 'engine-fx';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// --- replicas of the launcher's pure save logic (kept byte-identical) ---------

/** Byte-identical to `projectPaths.r2Slug`. */
function r2Slug(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '_')
			.slice(0, 60) || 'default'
	);
}
function projectPrefix(client: string, project: string): string {
	return `${r2Slug(client)}/${r2Slug(project)}`;
}
const FX_DOC_SUFFIX = '.fx.json';
const FX_META_SUFFIX = '.fx.meta.json';
function fxDocKey(client: string, project: string, id: string): string {
	return `${projectPrefix(client, project)}/${r2Slug(id)}${FX_DOC_SUFFIX}`;
}
function fxMetaKey(client: string, project: string, id: string): string {
	return `${projectPrefix(client, project)}/${r2Slug(id)}${FX_META_SUFFIX}`;
}

interface FxMeta {
	camera?: { x: number; y: number; scale: number };
	selectedLayer?: string;
}
const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
/** Byte-identical to `fxStorage.normalizeFxMeta`. */
function normalizeFxMeta(raw: unknown): FxMeta {
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

/** The file-stem extractor `fxStorage.listEffects` uses to enumerate openable effects. */
function effectIdFromKey(key: string): string {
	const slash = key.lastIndexOf('/');
	const base = slash === -1 ? key : key.slice(slash + 1);
	if (!base.endsWith(FX_DOC_SUFFIX)) return '';
	return base.slice(0, -FX_DOC_SUFFIX.length);
}

/** Mirror of `fxStorage.saveEffect`'s pure body (the I/O removed). */
function deriveSave(
	client: string,
	project: string,
	rawDoc: unknown,
	rawMeta: unknown,
): { docKey: string; metaKey: string; doc: EffectDoc; meta: FxMeta } {
	const requestedId = isObject(rawDoc) && typeof rawDoc.id === 'string' ? rawDoc.id : 'effect';
	const id = r2Slug(requestedId);
	const doc = normalizeEffectDoc(rawDoc, id);
	doc.id = id;
	const meta = normalizeFxMeta(rawMeta);
	return {
		docKey: fxDocKey(client, project, id),
		metaKey: fxMetaKey(client, project, id),
		doc,
		meta,
	};
}

// ===========================================================================
// A. THE SPLIT — editor-only state is partitioned to the sidecar, never the doc.
// ===========================================================================
console.log('fx save-split — EffectDoc↔sidecar partition');

// A save body the page would POST: a doc that ACCIDENTALLY carries editor-only fields, plus
// the real sidecar. The endpoint must keep them apart.
const requestBody = {
	doc: {
		version: 1,
		id: 'Coin Burst',
		name: 'Coin Burst',
		// editor-only junk that leaked onto the doc — MUST NOT reach R2's .fx.json:
		camera: { x: 40, y: -20, scale: 1.5 },
		selectedLayer: 'sparks',
		swatches: ['#fff', '#f80'],
		layers: [
			{
				key: 'sparks',
				config: {
					lifetime: { min: 0.5, max: 0.7 },
					frequency: 0.01,
					pos: { x: 0, y: 0 },
					behaviors: [],
				},
				art: { assetKey: 'fx_coins', frames: ['coin_0', 'coin_1'], animated: true },
				placement: { space: 'free' },
				particleKind: 'sprite',
			},
		],
	},
	meta: { camera: { x: 40, y: -20, scale: 1.5 }, selectedLayer: 'sparks' },
};

const { docKey, metaKey, doc, meta } = deriveSave(
	'Borut',
	'Book of Borut',
	requestBody.doc,
	requestBody.meta,
);

assert(!('camera' in doc), 'editor-only camera does NOT reach the EffectDoc');
assert(!('selectedLayer' in doc), 'editor-only selection does NOT reach the EffectDoc');
assert(!('swatches' in doc), 'editor-only swatches do NOT reach the EffectDoc');
assert(doc.layers.length === 1 && doc.layers[0].key === 'sparks', 'the real layer survives');
assert(
	eq(meta, { camera: { x: 40, y: -20, scale: 1.5 }, selectedLayer: 'sparks' }),
	'sidecar keeps camera + selection',
);
assert(docKey !== metaKey, 'doc + sidecar are TWO separate R2 objects');

console.log('fx save-split — sidecar normalizer drops off-schema keys');
const dirtyMeta = normalizeFxMeta({
	camera: { x: 1, y: 2, scale: 3 },
	selectedLayer: 'glow',
	rogue: true,
	nested: { junk: 1 },
});
assert(!('rogue' in dirtyMeta) && !('nested' in dirtyMeta), 'unknown sidecar fields dropped');
assert(
	eq(dirtyMeta, { camera: { x: 1, y: 2, scale: 3 }, selectedLayer: 'glow' }),
	'sidecar canonical',
);
assert(eq(normalizeFxMeta('garbage'), {}), 'non-object meta ⇒ empty sidecar');
assert(eq(normalizeFxMeta({ camera: { x: 1 } }), {}), 'partial camera dropped (needs x/y/scale)');

// ===========================================================================
// B. KEY DERIVATION — slug → path-safe stem; sibling keys; round-trip stability.
// ===========================================================================
console.log('fx save-split — R2 key derivation');

assert(
	docKey === 'borut/book_of_borut/coin_burst.fx.json',
	'doc key = <client>/<project>/<slug>.fx.json',
);
assert(
	metaKey === 'borut/book_of_borut/coin_burst.fx.meta.json',
	'meta key = sibling .fx.meta.json',
);
assert(doc.id === 'coin_burst', 'doc.id is the slugged id (file stem is authoritative)');

// Reopening: the slugged id round-trips to the SAME keys (no second-save drift, §9).
const reopened = deriveSave('Borut', 'Book of Borut', { ...doc }, {});
assert(reopened.docKey === docKey, 'reopened effect re-derives the SAME doc key');
assert(reopened.doc.id === doc.id, 'reopened effect id is stable under re-slug (idempotent)');

console.log('fx save-split — listEffects file-stem extraction');
assert(
	effectIdFromKey('borut/book_of_borut/coin_burst.fx.json') === 'coin_burst',
	'stem from a .fx.json key',
);
assert(
	effectIdFromKey('borut/book_of_borut/coin_burst.fx.meta.json') === '',
	'sidecar key is NOT an openable effect',
);
assert(
	effectIdFromKey('borut/book_of_borut/manifests/atlas.json') === '',
	'non-fx json is NOT an effect',
);

console.log('fx save-split — missing id falls back to `effect`');
const noId = deriveSave('c', 'p', { name: 'no id', layers: [] }, {});
assert(
	noId.doc.id === 'effect' && noId.docKey === 'c/p/effect.fx.json',
	'absent id ⇒ effect.fx.json',
);

console.log('');
if (failures > 0) {
	console.error(`FX SAVE-SPLIT: ${failures} failure(s)`);
	process.exit(1);
}
console.log('FX SAVE-SPLIT: PASSED');
