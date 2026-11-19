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
 *  - `models/<id>/viewer-tiers.json` by {@link deriveModelForViewer}: what every tier of ONE model
 *    comes to (levels, triangles, bytes, GPU memory, maps), whether or not the game reaches it or
 *    publishes that tier, so an artist sees a model before it is placed. Only the numbers: the
 *    tier files themselves are a publish's to write, and `models/<id>/derived/` is the export's
 *    derived-tier cache, never touched here. One small JSON, last writer wins. Derives of one
 *    model run one at a time, in THIS process.
 *
 * Whatever reads a master into memory takes one of {@link MAX_MASTERS_IN_MEMORY} slots: a derive,
 * the check of a master against a new class, and the facts of a model stored before facts were kept.
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
import { KTX2_ENCODER_REVISION } from './ktx2Dimensions';
import { exportInputs, r2TextureCache } from './modelExport';
import {
	deriveModelTier,
	MODEL_OPTIMIZER_REVISION,
	modelLimitIssues,
	tierCopyEqualsFull,
	type DerivedModelTier,
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
import { modelDocKey, modelViewerTiersKey } from './projectPaths';
import { ConflictError, getObjectText, putObjectText } from './r2';

const isObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Cap on masters held in memory at once, across every project and in THIS process. Each is up to
 * 256 MB and is parsed whole, and the launcher has run out of memory mid-bake before
 * (`runtimeBundleCache.ts`).
 */
const MAX_MASTERS_IN_MEMORY = 2;
const masterSlot = createLimiter(MAX_MASTERS_IN_MEMORY);

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

/** One Viewer derive of one model: `models/<id>/viewer-tiers.json`. */
export interface ModelDerivedIndex {
	/** {@link deriveInputsOf} of what it was derived from; another value means it is out of date. */
	inputs: string;
	derivedAt: string;
	/** The master it was derived from (`model.json` `source.file`). */
	source: string;
	/** Every tier with files of its own, `glb` as a publish names it (`<id>[@<tier>].glb`). */
	tiers: Partial<Record<ModelTierId, ModelExportTier>> & { full: ModelExportTier };
	/** Tiers whose derive equals `full` byte for byte: a publish writes no copy, the game loads `full`. */
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
		getObjectText(modelViewerTiersKey(clientKey, projectKey, id)),
		exportInputs(clientKey, projectKey),
	]);
	if (!loaded) return null;
	let doc = loaded.doc;
	if (doc && !doc.facts) {
		// A model registered before facts were kept: read them off its master for this answer.
		const stored = doc;
		const facts = await masterSlot(async () => {
			const master = await loadModelSource(clientKey, projectKey, id, stored);
			const seen: { facts?: ModelMasterFacts } = {};
			if (master) await validateModelMaster(master, stored.class, seen);
			return seen.facts;
		});
		if (facts) doc = { ...doc, facts };
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
		const checked = await masterSlot(async () => {
			const master = await loadModelSource(clientKey, projectKey, id, stored);
			if (!master) return null;
			const seen: { facts?: ModelMasterFacts } = {};
			return { issues: await validateModelMaster(master, input.class, seen), facts: seen.facts };
		});
		if (!checked)
			return {
				ok: false,
				status: 404,
				error: `The master ${stored.source.file} is missing. Upload it again.`,
			};
		const { issues } = checked;
		if (issues.some((i) => i.level === 'error'))
			return {
				ok: false,
				status: 422,
				error: `This master is not a valid ${input.class}.`,
				issues,
			};
		validator = { errors: 0, warnings: issues.length, issues };
		facts = checked.facts ?? facts;
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

/** One derive of a model at a time: a second one waits, then derives what is stored then. */
const modelDeriveLock = createKeyedMutex();

/** What a derived tier comes to, as the export's index records it: its GLB with its textures. */
const tierNumbers = (glb: string, d: DerivedModelTier): ModelExportTier => ({
	glb,
	bytes: d.glb.byteLength + d.textures.reduce((n, t) => n + t.bytes.byteLength, 0),
	vramBytes: d.vramBytes,
	lods: d.lods,
	maps: d.maps,
});

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
	const fullFile = `${id}.glb`;
	const sameAsFull: ModelTierId[] = [];
	let tiers: ModelDerivedIndex['tiers'];
	try {
		const full = await deriveModelTier(master, {
			tier: MODEL_FALLBACK_TIER,
			profile,
			lodGenerate,
			cache,
		});
		tiers = { full: tierNumbers(fullFile, full) };
		for (const tier of MODEL_TIERS) {
			if (tier === MODEL_FALLBACK_TIER) continue;
			const derived = await deriveModelTier(master, { tier, profile, lodGenerate, cache });
			if (tierCopyEqualsFull(tier, derived, full)) sameAsFull.push(tier);
			else tiers[tier] = tierNumbers(modelTierFile(fullFile, tier), derived);
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
	// After every tier derived: a derive that fails leaves the last one's numbers, which still name
	// the inputs they are for.
	await putObjectText(
		modelViewerTiersKey(clientKey, projectKey, id),
		JSON.stringify(index, null, '\t'),
		'application/json',
	);
	return { ok: true, derived: index, deriveInputs: inputs, docEtag: loaded?.etag ?? null };
}

/**
 * Derive every tier of one model from its stored master and settings, keep what each comes to
 * (`models/<id>/viewer-tiers.json`) and answer with it. The tier files are not kept. Textures come
 * from (and warm) the export's own cache, so a publish after it re-encodes nothing these tiers
 * share.
 */
export function deriveModelForViewer(
	clientKey: string,
	projectKey: string,
	id: string,
): Promise<DeriveResult> {
	// The model's lock before the slot, so a model queued behind itself never holds a slot idle.
	return modelDeriveLock(`${clientKey}/${projectKey}/${id}`, () =>
		masterSlot(() => deriveNow(clientKey, projectKey, id)),
	);
}
