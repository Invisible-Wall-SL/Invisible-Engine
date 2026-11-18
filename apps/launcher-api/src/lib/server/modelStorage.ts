/**
 * The `models` asset class's SOURCE side (`docs/design/3d/assets-evaluation.md` §4, §5.3): one
 * master GLB per model plus its `model.json`, under `<client>/<project>/models/<id>/`.
 *
 * Upload is two steps, so the launcher's 512 KB body cap never sees the bytes and no presigned URL
 * names a live key:
 *   1. {@link presignModelUpload} mints a PUT to `models/<id>/uploads/<uuid>.glb`;
 *   2. {@link registerModelUpload} reads that staged GLB, validates it, writes it content-addressed
 *      (`source.<sha12>.glb`, create-only, so two uploads of different bytes never share a key), and
 *      commits it by a compare-and-swap on `model.json` against the ETag the author loaded. Only that
 *      CAS can lose a race; a loser leaves an unreferenced source file, never a model pointing at
 *      bytes it did not validate. The staged upload is deleted either way.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
	isModelClass,
	isUntieredModelClass,
	isModelTierId,
	MODEL_CLASS_DEFAULTS,
	MODEL_TIERED_MAPS,
	type ModelClass,
	type ModelLodGenerate,
	type ModelLodScreenSize,
	type ModelTextureEncoding,
	type ModelTierId,
	type ModelTierProfile,
} from 'constants-shared/modelTiers';
import { inspectModelMaster } from './modelOptimize';
import { modelDocKey, modelSourceKey, modelUploadKey, SUB } from './projectPaths';
import {
	ConflictError,
	deleteObject,
	getObjectBytes,
	getObjectTextWithEtag,
	headObject,
	listAllKeys,
	precondition,
	presignPut,
	putObjectBytes,
	putObjectText,
} from './r2';

/** A model id: lower snake case, as the Blender export names files (`sword`, `crate_small`). */
export const MODEL_ID = /^[a-z][a-z0-9_]{0,63}$/;
export const isModelId = (v: unknown): v is string => typeof v === 'string' && MODEL_ID.test(v);

/** A master upload's ceiling: a hero master with 4096² maps and every LOD is tens of MB. */
export const MAX_MODEL_BYTES = 256 * 1024 * 1024;
export const MODEL_CONTENT_TYPE = 'model/gltf-binary';

/** One tier's override: any part of the code default's profile. */
export interface ModelTierOverride {
	lods?: [number, number];
	maps?: Partial<Record<(typeof MODEL_TIERED_MAPS)[number], number | 'drop'>>;
	encoding?: Partial<Record<(typeof MODEL_TIERED_MAPS)[number], ModelTextureEncoding>>;
}

export interface ModelValidatorIssue {
	level: 'error' | 'warning';
	code: string;
	message: string;
}

export interface ModelDoc {
	class: ModelClass;
	/** The master GLB in use, a file name under `models/<id>/`. */
	source: { file: string; sha256: string; bytes: number };
	overrides?: Partial<Record<ModelTierId, ModelTierOverride>>;
	lodScreenSize?: ModelLodScreenSize;
	validator: { errors: number; warnings: number; issues: ModelValidatorIssue[] };
	updatedAt: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);
const ENCODINGS: readonly ModelTextureEncoding[] = ['uastc', 'etc1s', 'png'];

function normalizeOverride(raw: unknown): ModelTierOverride | undefined {
	if (!isObject(raw)) return undefined;
	const out: ModelTierOverride = {};
	if (
		Array.isArray(raw.lods) &&
		raw.lods.length === 2 &&
		raw.lods.every((n) => Number.isInteger(n) && n >= -1 && n <= 8)
	)
		out.lods = [raw.lods[0] as number, raw.lods[1] as number];
	if (isObject(raw.maps)) {
		const maps: ModelTierOverride['maps'] = {};
		for (const map of MODEL_TIERED_MAPS) {
			const v = raw.maps[map];
			if (v === 'drop' || (typeof v === 'number' && v >= 4 && Number.isInteger(Math.log2(v))))
				maps[map] = v;
		}
		if (Object.keys(maps).length) out.maps = maps;
	}
	if (isObject(raw.encoding)) {
		const enc: ModelTierOverride['encoding'] = {};
		for (const map of MODEL_TIERED_MAPS) {
			const v = raw.encoding[map];
			if (ENCODINGS.includes(v as ModelTextureEncoding)) enc[map] = v as ModelTextureEncoding;
		}
		if (Object.keys(enc).length) out.encoding = enc;
	}
	return Object.keys(out).length ? out : undefined;
}

function normalizeScreenSize(raw: unknown): ModelLodScreenSize | undefined {
	if (!isObject(raw) || !Array.isArray(raw.levels)) return undefined;
	const levels = raw.levels.filter((n): n is number => typeof n === 'number' && n >= 0 && n <= 4);
	const cull = typeof raw.cullBelow === 'number' && raw.cullBelow >= 0 ? raw.cullBelow : 0;
	if (!levels.length) return undefined;
	return {
		levels,
		...(typeof raw.ultra === 'number' && raw.ultra > 0 ? { ultra: raw.ultra } : {}),
		cullBelow: cull,
	};
}

/** A stored `model.json`, or null when it is not one (no class or no source). */
export function normalizeModelDoc(raw: unknown): ModelDoc | null {
	if (!isObject(raw) || !isModelClass(raw.class) || !isObject(raw.source)) return null;
	const { file, sha256, bytes } = raw.source;
	if (typeof file !== 'string' || !/^source\.[0-9a-f]{12}\.glb$/.test(file)) return null;
	const overrides: ModelDoc['overrides'] = {};
	if (isObject(raw.overrides))
		for (const [tier, value] of Object.entries(raw.overrides)) {
			const o = isModelTierId(tier) ? normalizeOverride(value) : undefined;
			if (o) overrides[tier as ModelTierId] = o;
		}
	const v = isObject(raw.validator) ? raw.validator : {};
	const issues = Array.isArray(v.issues)
		? v.issues.filter(
				(i): i is ModelValidatorIssue =>
					isObject(i) &&
					(i.level === 'error' || i.level === 'warning') &&
					typeof i.code === 'string',
			)
		: [];
	const screen = normalizeScreenSize(raw.lodScreenSize);
	return {
		class: raw.class,
		source: { file, sha256: typeof sha256 === 'string' ? sha256 : '', bytes: Number(bytes) || 0 },
		...(Object.keys(overrides).length ? { overrides } : {}),
		...(screen ? { lodScreenSize: screen } : {}),
		validator: {
			errors: issues.filter((i) => i.level === 'error').length,
			warnings: issues.filter((i) => i.level === 'warning').length,
			issues,
		},
		updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
	};
}

/**
 * One tier's profile: `model.json` overrides → Game Config `models.profiles[class][tier]` → code
 * default. `gameConfigModels` is the raw `models` block of the stored Game Config (read raw: the
 * `game-config` package ships in every 2D bundle and does not carry this block).
 */
export function resolveModelProfile(
	cls: ModelClass,
	doc: Pick<ModelDoc, 'overrides'> | null,
	gameConfigModels: unknown,
): Record<ModelTierId, ModelTierProfile> {
	const base = MODEL_CLASS_DEFAULTS[cls].tiers;
	const project =
		isObject(gameConfigModels) && isObject(gameConfigModels.profiles)
			? gameConfigModels.profiles[cls]
			: undefined;
	const merged = {} as Record<ModelTierId, ModelTierProfile>;
	for (const tier of Object.keys(base) as ModelTierId[]) {
		const layers = [
			isObject(project) ? normalizeOverride(project[tier]) : undefined,
			doc?.overrides?.[tier],
		];
		let p: ModelTierProfile = base[tier];
		for (const o of layers) {
			if (!o) continue;
			p = {
				...p,
				lods: o.lods ?? p.lods,
				maps: { ...p.maps, ...o.maps },
				encoding: { ...p.encoding, ...o.encoding },
			};
		}
		merged[tier] = p;
	}
	return merged;
}

/** `lodScreenSize`: `model.json` → Game Config `models.lodScreenSize[class]` → code default. */
export function resolveLodScreenSize(
	cls: ModelClass,
	doc: Pick<ModelDoc, 'lodScreenSize'> | null,
	gameConfigModels: unknown,
): ModelLodScreenSize {
	const project =
		isObject(gameConfigModels) && isObject(gameConfigModels.lodScreenSize)
			? normalizeScreenSize(gameConfigModels.lodScreenSize[cls])
			: undefined;
	return doc?.lodScreenSize ?? project ?? MODEL_CLASS_DEFAULTS[cls].lodScreenSize;
}

/** Every model id with a `model.json`. */
export async function listModelIds(clientKey: string, projectKey: string): Promise<string[]> {
	const prefix = `${SUB.models(clientKey, projectKey)}/`;
	const ids = new Set<string>();
	for (const key of await listAllKeys(prefix)) {
		const m = /^([^/]+)\/model\.json$/.exec(key.slice(prefix.length));
		if (m && isModelId(m[1])) ids.add(m[1]);
	}
	return [...ids].sort();
}

export async function loadModelDoc(
	clientKey: string,
	projectKey: string,
	id: string,
): Promise<{ doc: ModelDoc | null; etag: string | null } | null> {
	const got = await getObjectTextWithEtag(modelDocKey(clientKey, projectKey, id));
	if (!got) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(got.text);
	} catch {
		parsed = null;
	}
	return { doc: normalizeModelDoc(parsed), etag: got.etag };
}

/** The master bytes `doc` names, or null when the file is gone. */
export async function loadModelSource(
	clientKey: string,
	projectKey: string,
	id: string,
	doc: ModelDoc,
): Promise<Uint8Array | null> {
	const got = await getObjectBytes(modelSourceKey(clientKey, projectKey, id, doc.source.file));
	return got ? got.body : null;
}

/** Mint the URL the browser PUTs a master GLB to. */
export async function presignModelUpload(
	clientKey: string,
	projectKey: string,
	id: string,
	ttlSeconds: number,
): Promise<{ upload: string; url: string; contentType: string }> {
	const upload = randomUUID();
	const url = await presignPut(
		modelUploadKey(clientKey, projectKey, id, upload),
		MODEL_CONTENT_TYPE,
		ttlSeconds,
	);
	return { upload, url, contentType: MODEL_CONTENT_TYPE };
}

/** The validator's launcher half: the rules a GLB alone can answer (assets §5.3). */
export async function validateModelMaster(
	bytes: Uint8Array,
	cls: ModelClass,
): Promise<ModelValidatorIssue[]> {
	const issues: ModelValidatorIssue[] = [];
	let facts: Awaited<ReturnType<typeof inspectModelMaster>>;
	try {
		facts = await inspectModelMaster(bytes);
	} catch (e) {
		return [
			{
				level: 'error',
				code: 'GLB_UNREADABLE',
				message: `not a readable GLB: ${(e as Error).message}`,
			},
		];
	}
	if (isUntieredModelClass(cls)) {
		if (!facts.clips.length)
			issues.push({ level: 'error', code: 'NO_CLIPS', message: 'a clip library has no animation' });
		if (facts.levels.length || facts.textures.length)
			issues.push({
				level: 'warning',
				code: 'CLIP_LIBRARY_HAS_MESH',
				message:
					'a clip library ships its armature and clips only; its meshes and maps are dropped',
			});
		return issues;
	}
	const gen: ModelLodGenerate = MODEL_CLASS_DEFAULTS[cls].lodGenerate;
	if (!facts.levels.some((l) => l.level === 0))
		issues.push({ level: 'error', code: 'NO_LOD0', message: 'the master has no mesh (no LOD0)' });
	for (const l of facts.levels) {
		const budget = l.level < 0 ? gen.ultraTris : gen.tris[l.level];
		if (l.level < 0 && budget === undefined)
			issues.push({
				level: 'warning',
				code: 'LODU_UNUSED',
				message: `${l.base}_LODU: the ${cls} class has no ultra level, so it never ships`,
			});
		else if (budget !== undefined && l.tris > budget * 1.1)
			issues.push({
				level: 'warning',
				code: 'TRIS_OVER_BUDGET',
				message: `${l.base} LOD${l.level < 0 ? 'U' : l.level}: ${l.tris} tris, over the ${cls} budget of ${budget}`,
			});
	}
	for (const t of facts.textures) {
		const pow2 = (n: number) => n > 0 && Number.isInteger(Math.log2(n));
		if (!pow2(t.w) || !pow2(t.h))
			issues.push({
				level: 'error',
				code: 'TEXTURE_NOT_POW2',
				message: `${t.name} is ${t.w}×${t.h}: sizes must be powers of two`,
			});
		else if (Math.max(t.w, t.h) > MODEL_CLASS_DEFAULTS[cls].masterMaxTexture)
			issues.push({
				level: 'warning',
				code: 'TEXTURE_OVER_CLASS',
				message: `${t.name} is ${t.w}×${t.h}, above the ${cls} master's ${MODEL_CLASS_DEFAULTS[cls].masterMaxTexture}²`,
			});
	}
	return issues;
}

export type RegisterResult =
	| { ok: true; doc: ModelDoc; etag: string | null }
	| { ok: false; status: 404 | 409 | 422; error: string; issues?: ModelValidatorIssue[] };

/**
 * Validate the staged upload and commit it as the model's master. `baseEtag` is the `model.json`
 * ETag the author loaded (`null` = "this model does not exist yet"), per the `precondition`
 * convention; a lost race is a 409 and nothing the model points at changes.
 */
export async function registerModelUpload(
	clientKey: string,
	projectKey: string,
	id: string,
	upload: string,
	cls: ModelClass,
	baseEtag: string | null | undefined,
): Promise<RegisterResult> {
	const stagedKey = modelUploadKey(clientKey, projectKey, id, upload);
	try {
		// Weigh it BEFORE reading it: the presigned PUT signs only the content type, so the staged
		// object can be any size R2 accepts, and reading it whole would put it all on the heap.
		const head = await headObject(stagedKey);
		if (!head) return { ok: false, status: 404, error: 'The upload was not found (or expired).' };
		if (head.size > MAX_MODEL_BYTES)
			return { ok: false, status: 422, error: 'The model is larger than the upload limit.' };
		const staged = await getObjectBytes(stagedKey);
		if (!staged || staged.body.byteLength > MAX_MODEL_BYTES)
			return { ok: false, status: 404, error: 'The upload changed or expired; upload it again.' };
		const bytes = staged.body;
		const issues = await validateModelMaster(bytes, cls);
		if (issues.some((i) => i.level === 'error'))
			return { ok: false, status: 422, error: 'The model failed validation.', issues };

		const sha256 = createHash('sha256').update(bytes).digest('hex');
		const file = `source.${sha256.slice(0, 12)}.glb`;
		try {
			await putObjectBytes(
				modelSourceKey(clientKey, projectKey, id, file),
				bytes,
				MODEL_CONTENT_TYPE,
				{ ifNoneMatch: '*' },
			);
		} catch (e) {
			// Same name = same content (it is the hash): a re-upload of identical bytes.
			if (!(e instanceof ConflictError)) throw e;
		}
		const prior = await loadModelDoc(clientKey, projectKey, id);
		const doc: ModelDoc = {
			class: cls,
			source: { file, sha256, bytes: bytes.byteLength },
			...(prior?.doc?.overrides ? { overrides: prior.doc.overrides } : {}),
			...(prior?.doc?.lodScreenSize ? { lodScreenSize: prior.doc.lodScreenSize } : {}),
			validator: {
				errors: 0,
				warnings: issues.length,
				issues,
			},
			updatedAt: new Date().toISOString(),
		};
		try {
			const etag = await putObjectText(
				modelDocKey(clientKey, projectKey, id),
				JSON.stringify(doc, null, '\t'),
				'application/json',
				precondition(baseEtag),
			);
			return { ok: true, doc, etag };
		} catch (e) {
			if (e instanceof ConflictError)
				return {
					ok: false,
					status: 409,
					error: 'This model changed since you opened it. Reload it, then upload again.',
				};
			throw e;
		}
	} finally {
		await deleteObject(stagedKey).catch(() => undefined);
	}
}
