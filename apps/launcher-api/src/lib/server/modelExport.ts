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
import {
	MODEL_FALLBACK_TIER,
	MODEL_TIERS,
	modelTierFile,
	publishedModelTiers,
	MODEL_CLASS_DEFAULTS,
	type ModelTierId,
} from 'constants-shared/modelTiers';
import type { ModelExportEntry, ModelExportIndex, ModelExportSkip } from 'constants-shared/models';
import { DeployMirror } from './deployMirror';
import {
	derivedTierKey,
	loadDerivedTier,
	placeDerivedTier,
	storeDerivedTier,
	type DerivedTierRecord,
} from './modelDerivedCache';
import { deriveModelTierOffThread } from './modelDeriveRunner';
import {
	loadModelDoc,
	loadModelSource,
	listModelIds,
	resolveLodScreenSize,
	resolveModelProfile,
} from './modelStorage';
import {
	inspectModelMaster,
	modelLimitIssues,
	NOT_A_GLB,
	textureSideIssues,
	type ModelTextureCache,
} from './modelOptimize';
import { editorDocKey, gameConfigDocKey, modelTextureCacheKey, SUB } from './projectPaths';
import { getObjectBytes, getObjectText, putObjectBytes } from './r2';

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

/**
 * The models a game reaches, its published tiers, the Game Config's `models` block and that config
 * as stored. Also what the Invisible Model Viewer shows a model against, so the two cannot disagree.
 */
export async function exportInputs(clientKey: string, projectKey: string) {
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
	return { reached, tiers, models, config };
}

/** The R2-backed texture cache (`models/_cache/<key>`). */
export function r2TextureCache(clientKey: string, projectKey: string): ModelTextureCache {
	return {
		get: async (key) =>
			(await getObjectBytes(modelTextureCacheKey(clientKey, projectKey, key)))?.body ?? null,
		put: async (key, bytes) => {
			await putObjectBytes(modelTextureCacheKey(clientKey, projectKey, key), bytes);
		},
	};
}

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

	const exportOneModel = async (id: string): Promise<ModelExportEntry | string> => {
		const loaded = await loadModelDoc(clientKey, projectKey, id);
		const doc = loaded?.doc;
		if (!doc) return 'model.json is missing or unreadable.';
		const profile = resolveModelProfile(doc.class, doc, configModels);
		const lodGenerate = MODEL_CLASS_DEFAULTS[doc.class].lodGenerate;
		const wanted = MODEL_TIERS.filter((t) => t === MODEL_FALLBACK_TIER || tiers.includes(t));
		const keyOf = (tier: ModelTierId) =>
			derivedTierKey({ sourceSha256: doc.source.sha256, tier, profile, lodGenerate });

		// Warm: every tier already derived for this master and profile — no master download, no parse.
		const records = new Map<ModelTierId, DerivedTierRecord>();
		for (const tier of wanted) {
			const record = await loadDerivedTier(clientKey, projectKey, id, keyOf(tier));
			if (record && (tier !== MODEL_FALLBACK_TIER || record.facts)) records.set(tier, record);
		}
		let facts = records.get(MODEL_FALLBACK_TIER)?.facts ?? null;

		// Cold: the master, its checks, and a derive per missing tier, on the worker thread.
		let master: Uint8Array | null = null;
		const masterOrReason = async (): Promise<Uint8Array | string> => {
			if (master) return master;
			const bytes = await loadModelSource(clientKey, projectKey, id, doc);
			if (!bytes) return `its master ${doc.source.file} is missing.`;
			const limits = modelLimitIssues(bytes);
			const inspected = limits.length ? null : await inspectModelMaster(bytes);
			const over = inspected ? textureSideIssues(inspected.textures) : limits;
			if (!inspected || over.length) {
				const why = over.some((m) => m.startsWith(NOT_A_GLB))
					? 'its master is not a readable GLB'
					: 'its master is over the model limits';
				return `skipped, ${why}: ${over.join('; ')}.`;
			}
			facts = { clips: inspected.clips, sockets: inspected.sockets };
			master = bytes;
			return bytes;
		};
		const derive = async (tier: ModelTierId): Promise<DerivedTierRecord | string> => {
			const bytes = await masterOrReason();
			if (typeof bytes === 'string') return bytes;
			const derived = await deriveModelTierOffThread(bytes, { tier, profile, lodGenerate, cache });
			const record = await storeDerivedTier(
				clientKey,
				projectKey,
				id,
				keyOf(tier),
				tier,
				derived,
				tier === MODEL_FALLBACK_TIER && facts ? facts : undefined,
			);
			records.set(tier, record);
			return record;
		};
		// Every tier is in hand before any is placed, so a derive that fails leaves no file behind.
		for (const tier of wanted) {
			if (records.has(tier)) continue;
			const got = await derive(tier);
			if (typeof got === 'string') return got;
		}
		const full = records.get(MODEL_FALLBACK_TIER);
		if (!full || !facts) return 'skipped: its full tier could not be derived.';

		const fullFile = `${id}.glb`;
		const ship: [ModelTierId, string][] = [[MODEL_FALLBACK_TIER, fullFile]];
		for (const tier of wanted) {
			const record = records.get(tier);
			if (tier === MODEL_FALLBACK_TIER || !record || record.contentHash === full.contentHash)
				continue;
			ship.push([tier, modelTierFile(fullFile, tier)]);
		}
		const tierEntries = {} as ModelExportEntry['tiers'];
		for (const [tier, file] of ship) {
			const place = (record: DerivedTierRecord) =>
				placeDerivedTier(mirror, prefix, file, clientKey, projectKey, id, keyOf(tier), record);
			let record = records.get(tier);
			if (!record) continue;
			// A cached file gone missing (a sweep, a hand delete): derive that tier again.
			if (!(await place(record))) {
				const again = await derive(tier);
				if (typeof again === 'string') return again;
				record = again;
				if (!(await place(record))) throw new Error(`the ${tier} tier could not be placed`);
			}
			tierEntries[tier] = {
				glb: file,
				bytes: record.glbBytes + record.textures.reduce((n, t) => n + t.bytes, 0),
				vramBytes: record.vramBytes,
				lods: record.lods,
				maps: record.maps,
			};
		}
		return {
			id,
			class: doc.class,
			clips: facts.clips,
			sockets: facts.sockets,
			lodScreenSize: resolveLodScreenSize(doc.class, doc, configModels),
			tiers: tierEntries,
		};
	};

	const skipped: ModelExportSkip[] = [];
	const skip = (id: string, reason: string) => {
		skipped.push({ id, reason });
		warn(`"${id}": ${reason}`);
	};
	for (const id of [...reached].sort()) {
		if (!ids.includes(id)) {
			// Ids are exact: say so when the game's spelling differs from a model's only in case.
			const near = ids.find((m) => m.toLowerCase() === id.toLowerCase());
			skip(
				id,
				'the game names it but there is no such model; it renders nothing.' +
					(near ? ` Model ids are case-sensitive: did you mean "${near}"?` : ''),
			);
			continue;
		}
		// One model's failure is that model's alone: the rest of the project still exports.
		try {
			const entry = await exportOneModel(id);
			if (typeof entry === 'string') skip(id, entry);
			else entries.push(entry);
		} catch (e) {
			skip(id, `skipped, its derive failed: ${(e as Error).message}`);
		}
	}

	const index: ModelExportIndex = { prefix: 'models', models: entries };
	await mirror.put(`${prefix}index.json`, JSON.stringify(index, null, '\t'));
	await mirror.commit();
	const result = entries.length ? index : EMPTY_MODEL_INDEX;
	return skipped.length ? { ...result, skipped } : result;
}
