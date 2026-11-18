/**
 * Export a project's 3D models into `deploy/models/` (CLAUDE.md rule 8; `docs/design/3d/assets-
 * evaluation.md` §4, §5.3): the model analogue of `fontExport.ts`.
 *
 *   <client>/<project>/deploy/models/<id>.glb              ← the full tier (the fallback)
 *   <client>/<project>/deploy/models/<id>@<tier>.glb       ← each other published tier that differs
 *   <client>/<project>/deploy/models/_tex/<hash>[@<tier>].<ktx2|png>  ← content-addressed, shared
 *   <client>/<project>/deploy/models/index.json            ← the ModelExportIndex
 *
 * Only models the game REACHES ship: a model is reached when an authored doc names it in a `modelId`
 * (or `modelIds`) field — the layout's scenes, or the Game Config (characters, the 3D settings).
 * Both are walked RAW, so a field their normalizers do not know yet still counts.
 *
 * Tiers: `full` always, plus each tier the layout's `resolutionTiers` names (read raw, so the 3D ids
 * `ultra` and `quarter` count). A tier whose derive equals `full`'s byte for byte is not written and
 * is absent from the index; the runtime falls back to `full`. Encoded textures are cached in
 * `models/_cache/` by everything that decides their bytes, so a re-export re-encodes only what a
 * changed master or profile touches. A 2D project has no `models/`: it lists one empty prefix,
 * writes nothing and returns the empty index, so its bundle is byte-identical.
 */
import { createHash } from 'node:crypto';
import {
	MODEL_FALLBACK_TIER,
	MODEL_TIERS,
	modelTierFile,
	publishedModelTiers,
	MODEL_CLASS_DEFAULTS,
	type ModelTierId,
} from 'constants-shared/modelTiers';
import type { ModelExportEntry, ModelExportIndex, ModelExportTier } from 'constants-shared/models';
import { DeployMirror } from './deployMirror';
import {
	loadModelDoc,
	loadModelSource,
	listModelIds,
	resolveLodScreenSize,
	resolveModelProfile,
} from './modelStorage';
import {
	deriveModelTier,
	inspectModelMaster,
	modelLimitIssues,
	NOT_A_GLB,
	textureSideIssues,
	tierCopyEqualsFull,
	type DerivedModelTier,
	type ModelTextureCache,
} from './modelOptimize';
import { editorDocKey, gameConfigDocKey, modelTextureCacheKey, SUB } from './projectPaths';
import { getObjectBytes, getObjectText, headObject, putObjectBytes } from './r2';

export const MODELS_SUBTREE = 'models';

export const EMPTY_MODEL_INDEX: ModelExportIndex = { prefix: 'models', models: [] };

const readJson = async (key: string): Promise<unknown> => {
	const text = await getObjectText(key);
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
};

/** Every `modelId` / `modelIds` value anywhere in `value`. */
export function collectModelIds(value: unknown, out = new Set<string>()): Set<string> {
	if (Array.isArray(value)) {
		for (const v of value) collectModelIds(v, out);
		return out;
	}
	if (!value || typeof value !== 'object') return out;
	for (const [k, v] of Object.entries(value)) {
		if (k === 'modelId' && typeof v === 'string') {
			out.add(v);
		} else if (k === 'modelIds' && Array.isArray(v)) {
			for (const id of v) if (typeof id === 'string') out.add(id);
		} else {
			collectModelIds(v, out);
		}
	}
	return out;
}

/** The models a game reaches, its published tiers, and the Game Config's `models` block. */
async function exportInputs(clientKey: string, projectKey: string) {
	const [layout, config] = await Promise.all([
		readJson(editorDocKey(clientKey, projectKey)),
		readJson(gameConfigDocKey(clientKey, projectKey)),
	]);
	const reached = collectModelIds(config, collectModelIds(layout));
	const tiers = publishedModelTiers(
		layout && typeof layout === 'object'
			? (layout as { resolutionTiers?: unknown }).resolutionTiers
			: [],
	);
	const models =
		config && typeof config === 'object' ? (config as { models?: unknown }).models : undefined;
	return { reached, tiers, models };
}

/** The R2-backed texture cache (`models/_cache/<key>`). */
function r2TextureCache(clientKey: string, projectKey: string): ModelTextureCache {
	return {
		get: async (key) =>
			(await getObjectBytes(modelTextureCacheKey(clientKey, projectKey, key)))?.body ?? null,
		put: async (key, bytes) => {
			await putObjectBytes(modelTextureCacheKey(clientKey, projectKey, key), bytes);
		},
	};
}

const contentType = (file: string) =>
	file.endsWith('.glb') ? 'model/gltf-binary' : file.endsWith('.png') ? 'image/png' : 'image/ktx2';

/** Write one derived tier: its GLB and the textures it names (a texture already there is kept). */
async function writeTier(
	mirror: DeployMirror,
	prefix: string,
	glbFile: string,
	derived: DerivedModelTier,
): Promise<void> {
	await mirror.putBytes(`${prefix}${glbFile}`, derived.glb, contentType(glbFile));
	for (const tex of derived.textures) {
		const key = `${prefix}${tex.uri}`;
		if (mirror.written.has(key)) continue;
		// A name hashes what decides its bytes, but a key from an older export may hold other bytes,
		// so compare the CONTENT: R2's ETag of a single-part PUT is the MD5 of its bytes.
		const head = await headObject(key);
		const md5 = createHash('md5').update(tex.bytes).digest('hex');
		if (head?.etag?.replaceAll('"', '') === md5) mirror.claim([key]);
		else await mirror.putBytes(key, tex.bytes, contentType(tex.uri));
	}
}

const tierEntry = (glb: string, d: DerivedModelTier): ModelExportTier => ({
	glb,
	bytes: d.glb.byteLength + d.textures.reduce((n, t) => n + t.bytes.byteLength, 0),
	vramBytes: d.vramBytes,
	lods: d.lods,
	maps: d.maps,
});

export interface ModelExportOptions {
	/** Per-model warnings (a reached id with no model, a master that will not read or is over the
	 *  model limits — such a model is skipped). */
	warn?: (message: string) => void;
}

export async function exportModels(
	clientKey: string,
	projectKey: string,
	opts: ModelExportOptions = {},
): Promise<ModelExportIndex> {
	const prefix = `${SUB.deploy(clientKey, projectKey)}/${MODELS_SUBTREE}/`;
	const mirror = new DeployMirror(prefix);
	const ids = await listModelIds(clientKey, projectKey);
	if (ids.length === 0) {
		await mirror.commit();
		return EMPTY_MODEL_INDEX;
	}
	const warn = opts.warn ?? ((m: string) => console.warn(`[models] ${projectKey}: ${m}`));
	const { reached, tiers, models: configModels } = await exportInputs(clientKey, projectKey);
	const cache = r2TextureCache(clientKey, projectKey);
	const entries: ModelExportEntry[] = [];

	for (const id of [...reached].sort()) {
		if (!ids.includes(id)) {
			warn(`"${id}" is named by the game but has no model; it renders nothing.`);
			continue;
		}
		const loaded = await loadModelDoc(clientKey, projectKey, id);
		const doc = loaded?.doc;
		if (!doc) {
			warn(`"${id}": model.json is missing or unreadable.`);
			continue;
		}
		const master = await loadModelSource(clientKey, projectKey, id, doc);
		if (!master) {
			warn(`"${id}": its master ${doc.source.file} is missing.`);
			continue;
		}
		const limits = modelLimitIssues(master);
		const facts = limits.length ? null : await inspectModelMaster(master);
		const over = facts ? textureSideIssues(facts.textures) : limits;
		if (!facts || over.length) {
			const why = over.some((m) => m.startsWith(NOT_A_GLB))
				? 'its master is not a readable GLB'
				: 'its master is over the model limits';
			warn(`"${id}": skipped, ${why}: ${over.join('; ')}.`);
			continue;
		}
		const profile = resolveModelProfile(doc.class, doc, configModels);
		const lodGenerate = MODEL_CLASS_DEFAULTS[doc.class].lodGenerate;
		const derive = (tier: ModelTierId) =>
			deriveModelTier(master, { tier, profile, lodGenerate, cache });

		const full = await derive(MODEL_FALLBACK_TIER);
		const fullFile = `${id}.glb`;
		await writeTier(mirror, prefix, fullFile, full);
		const tierEntries: ModelExportEntry['tiers'] = { full: tierEntry(fullFile, full) };
		for (const tier of MODEL_TIERS) {
			if (tier === MODEL_FALLBACK_TIER || !tiers.includes(tier)) continue;
			const derived = await derive(tier);
			if (tierCopyEqualsFull(tier, derived, full)) continue;
			const file = modelTierFile(fullFile, tier);
			await writeTier(mirror, prefix, file, derived);
			tierEntries[tier] = tierEntry(file, derived);
		}
		entries.push({
			id,
			class: doc.class,
			clips: facts.clips,
			sockets: facts.sockets,
			lodScreenSize: resolveLodScreenSize(doc.class, doc, configModels),
			tiers: tierEntries,
		});
	}

	const index: ModelExportIndex = { prefix: 'models', models: entries };
	await mirror.put(`${prefix}index.json`, JSON.stringify(index, null, '\t'));
	await mirror.commit();
	return entries.length ? index : EMPTY_MODEL_INDEX;
}
