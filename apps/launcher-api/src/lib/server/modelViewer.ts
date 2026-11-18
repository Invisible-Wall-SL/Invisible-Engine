/**
 * The Invisible Model Viewer's server side (`/models`, `docs/design/3d-games.md` §6 Phase 4): what a
 * model is shown against, saving its `model.json` settings, and the Viewer's own derive.
 *
 * Everything here reads through the export's own functions (`modelExport.ts` `exportInputs`,
 * `modelStorage.ts` `resolveModelProfile`, `modelOptimize.ts` `deriveModelTier`), so the tiers the
 * Viewer shows are the tiers a publish would write.
 *
 * Writes:
 *  - `model.json` only by compare-and-swap on the ETag the author loaded ({@link saveModelSettings};
 *    the master upload is `modelStorage.ts` `registerModelUpload`, the same rule).
 *  - `models/<id>/derived/` by {@link deriveModelForViewer}: every tier of ONE model, whether or not
 *    the game reaches it or publishes that tier, so an artist sees a model before it is placed. It
 *    is a cache of that derive and nothing a game ships: last writer wins and each derive replaces
 *    the whole folder. Derives of one model run one at a time and at most
 *    {@link MAX_CONCURRENT_DERIVES} run at once, in THIS process: a second launcher instance would
 *    not be held back, and its `commit()` could delete files the other derive just wrote.
 */
import { createHash } from 'node:crypto';
import {
	MODEL_CLASSES,
	MODEL_CLASS_DEFAULTS,
	MODEL_FALLBACK_TIER,
	MODEL_TIERS,
	modelTierFile,
	type ModelClass,
	type ModelTierId,
} from 'constants-shared/modelTiers';
import type { ModelExportTier } from 'constants-shared/models';
import type { ModelMasterFacts } from '$lib/models/modelFacts';
import type { InheritedModelSettings } from '$lib/models/modelProfile';
import { createKeyedMutex, createLimiter } from './concurrency';
import { DeployMirror } from './deployMirror';
import { KTX2_ENCODER_REVISION } from './ktx2Dimensions';
import { exportInputs, r2TextureCache, tierEntry, writeTier } from './modelExport';
import {
	deriveModelTier,
	MODEL_OPTIMIZER_REVISION,
	modelLimitIssues,
	tierCopyEqualsFull,
} from './modelOptimize';
import {
	listModelIds,
	loadModelDoc,
	loadModelSource,
	normalizeModelDoc,
	resolveLodScreenSize,
	resolveModelProfile,
	validateModelMaster,
	type ModelDoc,
	type ModelValidatorIssue,
} from './modelStorage';
import { modelDerivedPrefix, modelDocKey } from './projectPaths';
import { ConflictError, deleteObject, getObjectText, putObjectText } from './r2';

const isObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);

/** What every model of a project is shown against. */
export interface ModelProjectContext {
	/** `full` and each tier the layout's `resolutionTiers` names: what a publish writes. */
	publishedTiers: ModelTierId[];
	/** The model ids the layout or the Game Config names: only these ship. */
	reached: string[];
	/** Per class, the Game Config `models` block over the code defaults. */
	inherited: Record<ModelClass, InheritedModelSettings>;
	/** The Game Config has an `arcade.world3d` block: the game draws a 3D world. */
	world3d: boolean;
}

export async function loadModelProjectContext(
	clientKey: string,
	projectKey: string,
): Promise<ModelProjectContext> {
	const { reached, tiers, models, config } = await exportInputs(clientKey, projectKey);
	const inherited = {} as Record<ModelClass, InheritedModelSettings>;
	for (const cls of MODEL_CLASSES)
		inherited[cls] = {
			tiers: resolveModelProfile(cls, null, models),
			lodScreenSize: resolveLodScreenSize(cls, null, models),
		};
	const arcade = isObject(config) ? config.arcade : undefined;
	return {
		publishedTiers: tiers,
		reached: [...reached].sort(),
		inherited,
		world3d: isObject(arcade) && arcade.world3d !== undefined,
	};
}

export interface ModelListEntry {
	id: string;
	/** `null` when its `model.json` is unreadable. */
	doc: ModelDoc | null;
	etag: string | null;
}

/** Every model of the project with its `model.json` and the ETag a write must match. */
export async function listModels(clientKey: string, projectKey: string): Promise<ModelListEntry[]> {
	const ids = await listModelIds(clientKey, projectKey);
	return Promise.all(
		ids.map(async (id) => {
			const loaded = await loadModelDoc(clientKey, projectKey, id);
			return { id, doc: loaded?.doc ?? null, etag: loaded?.etag ?? null };
		}),
	);
}

/** One Viewer derive of one model: `models/<id>/derived/index.json`. */
export interface ModelDerivedIndex {
	/** {@link deriveInputsOf} of what it was derived from; another value means it is out of date. */
	inputs: string;
	derivedAt: string;
	/** The master it was derived from (`model.json` `source.file`). */
	source: string;
	/** Every tier with its own files, `glb` relative to the derived folder. */
	tiers: Partial<Record<ModelTierId, ModelExportTier>> & { full: ModelExportTier };
	/** Tiers whose derive equals `full` byte for byte: no copy is written, the game loads `full`. */
	sameAsFull: ModelTierId[];
}

/** A key of everything that decides a model's derived bytes. */
export function deriveInputsOf(doc: ModelDoc, configModels: unknown): string {
	return createHash('sha256')
		.update(
			JSON.stringify({
				optimizer: MODEL_OPTIMIZER_REVISION,
				encoder: KTX2_ENCODER_REVISION,
				source: doc.source.sha256,
				class: doc.class,
				profile: resolveModelProfile(doc.class, doc, configModels),
				lodGenerate: MODEL_CLASS_DEFAULTS[doc.class].lodGenerate,
			}),
		)
		.digest('hex')
		.slice(0, 24);
}

function parseDerivedIndex(text: string | null): ModelDerivedIndex | null {
	if (!text) return null;
	try {
		const raw: unknown = JSON.parse(text);
		if (!isObject(raw) || typeof raw.inputs !== 'string' || !isObject(raw.tiers)) return null;
		if (!isObject(raw.tiers.full)) return null;
		return raw as unknown as ModelDerivedIndex;
	} catch {
		return null;
	}
}

export interface ModelDetail {
	id: string;
	/** `null` when its `model.json` is unreadable. */
	doc: ModelDoc | null;
	etag: string | null;
	/** The Viewer's last derive, or `null` when the model was never derived. */
	derived: ModelDerivedIndex | null;
	/** What a derive of the stored model would be keyed by: equal to `derived.inputs` when the
	 *  derive is current. */
	deriveInputs: string | null;
}

/** One model as the Viewer opens it, or `null` when there is no such model. */
export async function loadModelDetail(
	clientKey: string,
	projectKey: string,
	id: string,
): Promise<ModelDetail | null> {
	const [loaded, indexText, inputs] = await Promise.all([
		loadModelDoc(clientKey, projectKey, id),
		getObjectText(`${modelDerivedPrefix(clientKey, projectKey, id)}index.json`),
		exportInputs(clientKey, projectKey),
	]);
	if (!loaded) return null;
	let doc = loaded.doc;
	if (doc && !doc.facts) {
		// A model registered before facts were kept: read them off its master for this answer.
		const master = await loadModelSource(clientKey, projectKey, id, doc);
		const seen: { facts?: ModelMasterFacts } = {};
		if (master) await validateModelMaster(master, doc.class, seen);
		if (seen.facts) doc = { ...doc, facts: seen.facts };
	}
	return {
		id,
		doc,
		etag: loaded.etag,
		derived: parseDerivedIndex(indexText),
		deriveInputs: doc ? deriveInputsOf(doc, inputs.models) : null,
	};
}

export interface ModelSettingsInput {
	class: ModelClass;
	/** Per-tier overrides as the page holds them; read by `normalizeModelDoc`. */
	overrides: unknown;
	lodScreenSize: unknown;
}

export type SaveSettingsResult =
	| { ok: true; doc: ModelDoc; etag: string | null; deriveInputs: string }
	| { ok: false; status: 404 | 409 | 422; error: string; issues?: ModelValidatorIssue[] };

const CHANGED = 'This model changed since you opened it. Reload it to see the newer version.';

/**
 * Save a model's class, tier overrides and LOD screen sizes. `baseEtag` is the `model.json` ETag
 * the author loaded: the write is refused (409) unless the stored doc is still that one, so the
 * settings always land on the master, facts and report the author was looking at. A new class is
 * checked against the master before it is stored.
 */
export async function saveModelSettings(
	clientKey: string,
	projectKey: string,
	id: string,
	input: ModelSettingsInput,
	baseEtag: string,
): Promise<SaveSettingsResult> {
	const loaded = await loadModelDoc(clientKey, projectKey, id);
	if (!loaded) return { ok: false, status: 404, error: 'This model was not found.' };
	if (loaded.etag !== baseEtag) return { ok: false, status: 409, error: CHANGED };
	const stored = loaded.doc;
	if (!stored)
		return {
			ok: false,
			status: 422,
			error: 'This model.json is unreadable. Upload the master again to rebuild it.',
		};

	let { validator, facts } = stored;
	if (input.class !== stored.class) {
		const master = await loadModelSource(clientKey, projectKey, id, stored);
		if (!master)
			return {
				ok: false,
				status: 404,
				error: `The master ${stored.source.file} is missing. Upload it again.`,
			};
		const seen: { facts?: ModelMasterFacts } = {};
		const issues = await validateModelMaster(master, input.class, seen);
		if (issues.some((i) => i.level === 'error'))
			return {
				ok: false,
				status: 422,
				error: `This master is not a valid ${input.class}.`,
				issues,
			};
		validator = { errors: 0, warnings: issues.length, issues };
		facts = seen.facts ?? facts;
	}
	const next = normalizeModelDoc({
		...stored,
		class: input.class,
		overrides: input.overrides,
		lodScreenSize: input.lodScreenSize,
		validator,
		facts,
		updatedAt: new Date().toISOString(),
	});
	if (!next) return { ok: false, status: 422, error: 'Those settings are not a model.json.' };
	// Read before the write: a failure after it would answer 500 for a save that landed, and the
	// author's retry would then lose to their own write.
	const { models } = await exportInputs(clientKey, projectKey);
	try {
		const etag = await putObjectText(
			modelDocKey(clientKey, projectKey, id),
			JSON.stringify(next, null, '\t'),
			'application/json',
			{ ifMatch: baseEtag },
		);
		return { ok: true, doc: next, etag, deriveInputs: deriveInputsOf(next, models) };
	} catch (e) {
		if (e instanceof ConflictError) return { ok: false, status: 409, error: CHANGED };
		throw e;
	}
}

export type DeriveResult =
	| {
			ok: true;
			derived: ModelDerivedIndex;
			deriveInputs: string;
			/** The `model.json` ETag the derive read: the page shows it as current only for that one. */
			docEtag: string | null;
	  }
	| { ok: false; status: 404 | 422; error: string };

/**
 * Cap on derives running at once across every project. Each holds a master (up to 256 MB) in
 * memory and encodes its maps, and the launcher has run out of memory mid-bake before
 * (`runtimeBundleCache.ts`).
 */
const MAX_CONCURRENT_DERIVES = 2;

const deriveSlot = createLimiter(MAX_CONCURRENT_DERIVES);
/** One derive of a model at a time: a second one waits, then derives what is stored then. */
const modelDeriveLock = createKeyedMutex();

async function deriveNow(clientKey: string, projectKey: string, id: string): Promise<DeriveResult> {
	const loaded = await loadModelDoc(clientKey, projectKey, id);
	const doc = loaded?.doc;
	if (!doc) return { ok: false, status: 404, error: 'This model was not found.' };
	const master = await loadModelSource(clientKey, projectKey, id, doc);
	if (!master)
		return {
			ok: false,
			status: 404,
			error: `The master ${doc.source.file} is missing. Upload it again.`,
		};
	const limits = modelLimitIssues(master);
	if (limits.length)
		return {
			ok: false,
			status: 422,
			error: `The master is over the model limits: ${limits.join('; ')}.`,
		};

	const { models: configModels } = await exportInputs(clientKey, projectKey);
	const profile = resolveModelProfile(doc.class, doc, configModels);
	const lodGenerate = MODEL_CLASS_DEFAULTS[doc.class].lodGenerate;
	const cache = r2TextureCache(clientKey, projectKey);
	const prefix = modelDerivedPrefix(clientKey, projectKey, id);
	const mirror = new DeployMirror(prefix);
	const fullFile = `${id}.glb`;
	const sameAsFull: ModelTierId[] = [];
	let tiers: ModelDerivedIndex['tiers'];
	// The index goes first: a derive that fails part-way must read as "not derived", never as the
	// last derive's numbers over files this one has already replaced.
	await deleteObject(`${prefix}index.json`);
	try {
		const full = await deriveModelTier(master, {
			tier: MODEL_FALLBACK_TIER,
			profile,
			lodGenerate,
			cache,
		});
		await writeTier(mirror, prefix, fullFile, full);
		tiers = { full: tierEntry(fullFile, full) };
		for (const tier of MODEL_TIERS) {
			if (tier === MODEL_FALLBACK_TIER) continue;
			const derived = await deriveModelTier(master, { tier, profile, lodGenerate, cache });
			if (tierCopyEqualsFull(tier, derived, full)) {
				sameAsFull.push(tier);
				continue;
			}
			const file = modelTierFile(fullFile, tier);
			await writeTier(mirror, prefix, file, derived);
			tiers[tier] = tierEntry(file, derived);
		}
	} catch (e) {
		return { ok: false, status: 422, error: `The derive failed: ${(e as Error).message}` };
	}
	const inputs = deriveInputsOf(doc, configModels);
	const index: ModelDerivedIndex = {
		inputs,
		derivedAt: new Date().toISOString(),
		source: doc.source.file,
		tiers,
		sameAsFull,
	};
	await mirror.put(`${prefix}index.json`, JSON.stringify(index, null, '\t'));
	await mirror.commit();
	return { ok: true, derived: index, deriveInputs: inputs, docEtag: loaded?.etag ?? null };
}

/**
 * Derive every tier of one model from its stored master and settings into `models/<id>/derived/`,
 * and answer with the index. Textures come from (and warm) the export's own cache, so a publish
 * after it re-encodes nothing these tiers share.
 */
export function deriveModelForViewer(
	clientKey: string,
	projectKey: string,
	id: string,
): Promise<DeriveResult> {
	// The model's lock before the slot, so a model queued behind itself never holds a slot idle.
	return modelDeriveLock(`${clientKey}/${projectKey}/${id}`, () =>
		deriveSlot(() => deriveNow(clientKey, projectKey, id)),
	);
}
