/**
 * The derived-TIER cache (asset review #4): every tier the export derives is kept, finished, under
 * `models/<id>/derived/<key>/` — its GLB, its textures and `tier.json` (ETags, sizes, the index
 * fields, a content hash) — keyed by everything that decides its bytes. An export whose tiers all
 * hit never downloads the master, never parses it and never encodes: it claims a deploy file whose
 * ETag already matches, or copies it R2-side (no bytes through the launcher). A cold derive runs on
 * the worker thread (`modelDeriveRunner.ts`).
 *
 * Writes are unconditional: a key names its content, so two exports writing one key write the same
 * bytes, and `tier.json` goes last, so a record implies its files were written. A file that has since
 * gone missing makes `placeDerivedTier` answer false and the caller derives again.
 */
import { createHash } from 'node:crypto';
import type { ModelLodGenerate, ModelTierId, ModelTierProfile } from 'constants-shared/modelTiers';
import type { ModelExportLod } from 'constants-shared/models';
import type { DeployMirror } from './deployMirror';
import { KTX2_ENCODER_REVISION } from './ktx2Dimensions';
import { deriveCodeFingerprint } from './modelDeriveRunner';
import { MODEL_OPTIMIZER_REVISION, type DerivedModelTier } from './modelOptimize';
import { SUB } from './projectPaths';
import { getObjectText, headObject, putObjectBytes, putObjectText } from './r2';

/** Bumped when `tier.json`'s shape changes. */
const DERIVED_TIER_REVISION = 1;

export interface DerivedTierRecord {
	glbEtag: string;
	glbBytes: number;
	textures: { uri: string; etag: string; bytes: number }[];
	lods: ModelExportLod[];
	maps: DerivedModelTier['maps'];
	vramBytes: number;
	/** Equal across tiers ⇔ the tier's GLB and textures equal `full`'s once its `@<tier>` names are
	 *  read as `full`'s (the "no copy identical to full" rule). */
	contentHash: string;
	/** The master's clips and sockets, kept with `full` so a warm export never reads the master. */
	facts?: { clips: string[]; sockets: string[] };
}

/**
 * What decides a tier's bytes: the master, its own profile, `full`'s profile (`modelMapSize` sizes
 * every tier from `full`'s caps), the LOD settings, the code revisions and the built derive code
 * itself (`deriveCodeFingerprint`). Only those: a change to one tier's profile re-derives that tier
 * alone.
 */
export function derivedTierKey(input: {
	sourceSha256: string;
	tier: ModelTierId;
	profile: Readonly<Record<ModelTierId, ModelTierProfile>>;
	lodGenerate: ModelLodGenerate;
}): string {
	return createHash('sha256')
		.update(
			JSON.stringify({
				r: DERIVED_TIER_REVISION,
				o: MODEL_OPTIMIZER_REVISION,
				k: KTX2_ENCODER_REVISION,
				code: deriveCodeFingerprint(),
				src: input.sourceSha256,
				tier: input.tier,
				own: input.profile[input.tier],
				full: input.profile.full,
				lod: input.lodGenerate,
			}),
		)
		.digest('hex')
		.slice(0, 32);
}

const dir = (c: string, p: string, id: string, key: string) =>
	`${SUB.models(c, p)}/${id}/derived/${key}/`;
const textureFile = (uri: string) => uri.slice(uri.lastIndexOf('/') + 1);
const unquote = (etag: string | null | undefined) => (etag ?? '').replaceAll('"', '');

/** The tier's content hash: its GLB and textures with `@<tier>` names read as `full`'s. */
export function tierContentHash(tier: ModelTierId, d: DerivedModelTier): string {
	const unsuffix = (s: string) => (tier === 'full' ? s : s.replaceAll(`@${tier}.`, '.'));
	const view = new DataView(d.glb.buffer, d.glb.byteOffset, d.glb.byteLength);
	const jsonLen = view.getUint32(12, true);
	const json = new TextDecoder().decode(d.glb.subarray(20, 20 + jsonLen)).trimEnd();
	const h = createHash('sha256')
		.update(unsuffix(json))
		.update(d.glb.subarray(20 + jsonLen));
	for (const t of [...d.textures].sort((a, b) => unsuffix(a.uri).localeCompare(unsuffix(b.uri))))
		h.update(unsuffix(t.uri)).update(t.bytes);
	return h.digest('hex');
}

export async function loadDerivedTier(
	c: string,
	p: string,
	id: string,
	key: string,
): Promise<DerivedTierRecord | null> {
	const text = await getObjectText(`${dir(c, p, id, key)}tier.json`);
	if (!text) return null;
	try {
		return JSON.parse(text) as DerivedTierRecord;
	} catch {
		return null;
	}
}

export async function storeDerivedTier(
	c: string,
	p: string,
	id: string,
	key: string,
	tier: ModelTierId,
	d: DerivedModelTier,
	facts?: DerivedTierRecord['facts'],
): Promise<DerivedTierRecord> {
	const base = dir(c, p, id, key);
	const glbEtag = unquote(await putObjectBytes(`${base}model.glb`, d.glb, 'model/gltf-binary'));
	const textures = [];
	for (const t of d.textures) {
		const etag = unquote(
			await putObjectBytes(`${base}${textureFile(t.uri)}`, t.bytes, contentTypeOf(t.uri)),
		);
		textures.push({ uri: t.uri, etag, bytes: t.bytes.byteLength });
	}
	const record: DerivedTierRecord = {
		glbEtag,
		glbBytes: d.glb.byteLength,
		textures,
		lods: d.lods,
		maps: d.maps,
		vramBytes: d.vramBytes,
		contentHash: tierContentHash(tier, d),
		...(facts ? { facts } : {}),
	};
	await putObjectText(`${base}tier.json`, JSON.stringify(record), 'application/json');
	return record;
}

const contentTypeOf = (file: string) =>
	file.endsWith('.glb') ? 'model/gltf-binary' : file.endsWith('.png') ? 'image/png' : 'image/ktx2';

/** Put one file in place: kept when the deploy key already holds these bytes, else copied R2-side. */
async function place(
	mirror: DeployMirror,
	src: string,
	dest: string,
	etag: string,
): Promise<boolean> {
	if (mirror.written.has(dest)) return true;
	const head = await headObject(dest);
	if (head && unquote(head.etag) === etag) {
		mirror.claim([dest]);
		return true;
	}
	// Pinned to the record's ETag: two writers of one key can leave the record and its file from
	// different encodes; such a copy fails, and the caller derives the tier again.
	return mirror.copy(src, dest, contentTypeOf(dest), `"${etag}"`);
}

/** Ship a cached tier as `<prefix><glbFile>` + its textures; false when a cached file is gone. */
export async function placeDerivedTier(
	mirror: DeployMirror,
	prefix: string,
	glbFile: string,
	c: string,
	p: string,
	id: string,
	key: string,
	record: DerivedTierRecord,
): Promise<boolean> {
	const base = dir(c, p, id, key);
	if (!(await place(mirror, `${base}model.glb`, `${prefix}${glbFile}`, record.glbEtag)))
		return false;
	for (const t of record.textures)
		if (!(await place(mirror, `${base}${textureFile(t.uri)}`, `${prefix}${t.uri}`, t.etag)))
			return false;
	return true;
}
