import {
	CopyObjectCommand,
	DeleteObjectCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ENV } from './env';

let client: S3Client | null = null;

function s3(): S3Client {
	if (!client) {
		client = new S3Client({
			region: 'auto',
			endpoint: ENV.R2_ENDPOINT,
			credentials: {
				accessKeyId: ENV.R2_ACCESS_KEY_ID,
				secretAccessKey: ENV.R2_SECRET_ACCESS_KEY,
			},
		});
	}
	return client;
}

export async function getObjectBytes(
	key: string,
): Promise<{ body: Uint8Array; contentType: string; etag: string | null } | null> {
	try {
		const res = await s3().send(new GetObjectCommand({ Bucket: ENV.R2_BUCKET, Key: key }));
		const body = await res.Body!.transformToByteArray();
		return {
			body,
			contentType: res.ContentType ?? 'application/octet-stream',
			etag: res.ETag ?? null,
		};
	} catch (e) {
		if (isNotFound(e)) return null;
		throw e;
	}
}

/**
 * Presigned GET URL for a single object, valid for `ttlSeconds`. Lets a desktop
 * client download large objects straight from R2 (no portal bandwidth). The URL
 * embeds a signature and must never be logged. Callers MUST validate the key
 * against an allowed prefix before presigning — this helper signs whatever it gets.
 */
export async function presignGet(key: string, ttlSeconds: number): Promise<string> {
	return getSignedUrl(s3(), new GetObjectCommand({ Bucket: ENV.R2_BUCKET, Key: key }), {
		expiresIn: ttlSeconds,
	});
}

/**
 * Presigned PUT URL for a single object, valid for `ttlSeconds`. Lets the browser
 * upload large objects straight to R2 (bypassing the launcher's tiny adapter-node
 * `BODY_SIZE_LIMIT`). The URL embeds a signature and must never be logged. Callers
 * MUST validate the key against an allowed prefix before presigning — this helper
 * signs whatever it gets. `contentType` is baked into the signature, so the browser
 * MUST send the SAME `Content-Type` header on its PUT or R2 rejects the request.
 */
export async function presignPut(
	key: string,
	contentType: string,
	ttlSeconds: number,
): Promise<string> {
	return getSignedUrl(
		s3(),
		new PutObjectCommand({ Bucket: ENV.R2_BUCKET, Key: key, ContentType: contentType }),
		{ expiresIn: ttlSeconds },
	);
}

/**
 * Presign a list of manifest entries, adding a short-lived `url` to each. The R2
 * object key is read from `entry[keyField]`; entries whose key is missing or does
 * not start with `${basePrefix}/` are DROPPED (never presigned), so a manifest can
 * only ever mint signed URLs for objects under its own prefix. Order is preserved.
 */
export async function presignManifestEntries<T extends Record<string, unknown>>(
	entries: T[],
	keyField: keyof T,
	basePrefix: string,
	ttlSeconds: number,
): Promise<(T & { url: string })[]> {
	const allowedPrefix = `${basePrefix}/`;
	const signed: (T & { url: string })[] = [];
	for (const entry of entries) {
		const key = entry[keyField];
		if (typeof key !== 'string' || !key.startsWith(allowedPrefix)) {
			continue;
		}
		const url = await presignGet(key, ttlSeconds);
		signed.push({ ...entry, url });
	}
	return signed;
}

export async function getObjectText(key: string): Promise<string | null> {
	const obj = await getObjectBytes(key);
	return obj ? new TextDecoder().decode(obj.body) : null;
}

/**
 * Read an object's text WITH its ETag — the read half of an optimistic-concurrency
 * (compare-and-swap) round trip. Returns null when the object is absent.
 *
 * `getObjectText` throws the ETag away even though `getObjectBytes` already carries
 * it, which is why every storage helper historically had nothing to compare against
 * on save. Prefer this one for any AUTHORED doc.
 *
 * A caller MUST distinguish this returning `null` (genuinely absent → create with
 * `ifNoneMatch: '*'`) from the text failing to parse (present but corrupt → overwrite
 * deliberately with `ifMatch: etag`). Collapsing the two — the shape every loader had
 * before Phase 1 — makes a corrupt doc permanently unsaveable, because the create
 * precondition can never succeed against an object that exists.
 */
export async function getObjectTextWithEtag(
	key: string,
): Promise<{ text: string; etag: string | null } | null> {
	const obj = await getObjectBytes(key);
	if (!obj) return null;
	return { text: new TextDecoder().decode(obj.body), etag: obj.etag };
}

/**
 * Precondition for a conditional write. Omit for an unconditional last-writer-wins
 * PUT — correct for re-derivable build output (bake/export/deploy), wrong for a doc
 * two people can edit.
 */
export interface PutPrecondition {
	/** Write only if the object's current ETag matches — the CAS update. */
	ifMatch?: string;
	/** Write only if the object does NOT exist. Pass `'*'`. Use for create. */
	ifNoneMatch?: string;
}

/**
 * Map a storage caller's base ETag to a write precondition — the one place the
 * convention is defined, so every tool spells CAS the same way:
 * - a string → `ifMatch`: the CAS update; fails if anyone saved since it was read.
 * - `null` → `ifNoneMatch: '*'`: "this doc does not exist yet"; fails if it now does.
 * - `undefined` → no precondition: an UNCONDITIONAL last-writer-wins write.
 *
 * `undefined` is for callers that legitimately own the whole object (scaffolding,
 * import, re-derived build output). It is never the way to silence a 409.
 */
export function precondition(baseEtag: string | null | undefined): PutPrecondition | undefined {
	if (baseEtag === undefined) return undefined;
	return baseEtag === null ? { ifNoneMatch: '*' } : { ifMatch: baseEtag };
}

/**
 * Thrown when a conditional write loses — the object changed (or appeared) since the
 * caller read it. Endpoints MUST translate this to a 409 via `json({ error })`, never
 * `error()`, which would surface as an opaque 502 and hide the cause
 * ([[gotcha_publish_502_flowv2_nodes_guard]]).
 */
export class ConflictError extends Error {
	constructor(readonly key: string) {
		super(`Conditional write failed for ${key}: it changed since it was read`);
		this.name = 'ConflictError';
	}
}

/** Returns the new ETag. Throws {@link ConflictError} when a precondition fails. */
export async function putObjectText(
	key: string,
	text: string,
	contentType = 'application/octet-stream',
	cond?: PutPrecondition,
): Promise<string | null> {
	return sendPut(key, text, contentType, cond);
}

/** Returns the new ETag. Throws {@link ConflictError} when a precondition fails. */
export async function putObjectBytes(
	key: string,
	body: Uint8Array,
	contentType = 'application/octet-stream',
	cond?: PutPrecondition,
): Promise<string | null> {
	return sendPut(key, body, contentType, cond);
}

async function sendPut(
	key: string,
	body: string | Uint8Array,
	contentType: string,
	cond?: PutPrecondition,
): Promise<string | null> {
	try {
		const res = await s3().send(
			new PutObjectCommand({
				Bucket: ENV.R2_BUCKET,
				Key: key,
				Body: body,
				ContentType: contentType,
				...(cond?.ifMatch ? { IfMatch: cond.ifMatch } : {}),
				...(cond?.ifNoneMatch ? { IfNoneMatch: cond.ifNoneMatch } : {}),
			}),
		);
		return res.ETag ?? null;
	} catch (e) {
		// Only a request that CARRIED a precondition can have failed one. Without this
		// guard an unconditional write that happened to get a 409/412 would surface as
		// "someone else saved this" on a doc nobody touched.
		if (cond && isPreconditionFailed(e)) throw new ConflictError(key);
		throw e;
	}
}

/**
 * A failed write precondition: R2 answers 412 `PreconditionFailed` for both a stale
 * `If-Match` and an `If-None-Match: *` against an object that now exists.
 *
 * 409 `ConditionalRequestConflict` is deliberately NOT treated as a lost CAS. The S3
 * contract defines it as two conditional writes racing — i.e. transient, retry — not
 * as "you lost to another author". Mapping it here would wedge the tab in a sticky
 * conflict state that only "reload" or "overwrite" can clear, pushing the author
 * toward a destructive button over a blip. It surfaces as an ordinary save error, and
 * the next autosave retries.
 */
function isPreconditionFailed(e: unknown): boolean {
	const meta = (e as { $metadata?: { httpStatusCode?: number }; name?: string }) ?? {};
	return meta.$metadata?.httpStatusCode === 412 || meta.name === 'PreconditionFailed';
}

/**
 * Read a client-supplied base ETag off a JSON body into the {@link precondition}
 * convention. `null` (JSON carries it natively) = "no doc existed when I loaded";
 * a string = CAS against it; anything else (an absent field — e.g. a tab still
 * running a pre-Phase-1 bundle) = `undefined`, an unguarded write.
 *
 * Failing OPEN here is deliberate but TEMPORARY: rejecting would strand the work in
 * an open tab across a deploy. See the dated decision in
 * `docs/design/multi-user-concurrency.md` Phase 1 — this must become required once no
 * pre-Phase-1 tabs remain, or it is a permanent hole through which any new tool
 * silently writes unguarded.
 */
export function jsonBaseEtag(v: unknown): string | null | undefined {
	if (v === null) return null;
	return typeof v === 'string' ? v : undefined;
}

/**
 * {@link jsonBaseEtag} for a FormData field. FormData has no null, so the EMPTY STRING
 * encodes "no doc existed" and an absent field means "not sent" — the two must stay
 * distinct, which is why absence alone cannot carry the create case.
 */
export function formBaseEtag(v: FormDataEntryValue | null): string | null | undefined {
	if (typeof v !== 'string') return undefined;
	return v === '' ? null : v;
}

export async function deleteObject(key: string): Promise<void> {
	await s3().send(new DeleteObjectCommand({ Bucket: ENV.R2_BUCKET, Key: key }));
}

/** Delete many keys in batches of ≤1000 (the S3/R2 per-request limit). No-op on empty. */
export async function deleteObjects(keys: string[]): Promise<void> {
	if (keys.length === 0) return;
	for (let i = 0; i < keys.length; i += 1000) {
		const batch = keys.slice(i, i + 1000);
		await s3().send(
			new DeleteObjectsCommand({
				Bucket: ENV.R2_BUCKET,
				Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
			}),
		);
	}
}

/**
 * Server-side copy of one object to another key (R2 has no native move). The bytes
 * are copied inside R2 — they NEVER stream through this process — so this is the
 * memory-flat way to duplicate an object verbatim (vs `getObjectBytes` →
 * `putObjectBytes`, which buffers the whole object in the Node heap and OOMs the
 * container when several large pages/bundles are copied back-to-back).
 *
 * Returns `false` (no-op) when the source is missing — mirroring `getObjectBytes`'s
 * null-on-404 — so a caller can skip a missing page/file without a separate HEAD.
 * Pass `contentType` to override the destination's `Content-Type` (forces a metadata
 * REPLACE) — e.g. shipping a Rigger `.irig` skeleton under a `.json` name; omit it to
 * preserve the source's metadata.
 */
export async function copyObject(
	srcKey: string,
	destKey: string,
	contentType?: string,
): Promise<boolean> {
	try {
		await s3().send(
			new CopyObjectCommand({
				Bucket: ENV.R2_BUCKET,
				CopySource: encodeURIComponent(`${ENV.R2_BUCKET}/${srcKey}`),
				Key: destKey,
				...(contentType ? { ContentType: contentType, MetadataDirective: 'REPLACE' } : {}),
			}),
		);
		return true;
	} catch (e) {
		if (isNotFound(e)) return false;
		throw e;
	}
}

export async function objectExists(key: string): Promise<boolean> {
	try {
		await s3().send(new HeadObjectCommand({ Bucket: ENV.R2_BUCKET, Key: key }));
		return true;
	} catch (e) {
		if (isNotFound(e)) return false;
		throw e;
	}
}

export interface ObjectHead {
	/** R2/S3 ETag — a content hash for a single-part upload (quoted). Null when absent. */
	etag: string | null;
	size: number;
	/** Epoch ms of `LastModified` (0 when absent). */
	lastModified: number;
}

/**
 * HEAD one object for its content fingerprint (ETag) + size + mtime WITHOUT
 * streaming its bytes — used to content-version a copied page for cache-busting
 * (see `assetVersion.ts`). Returns null when the object is missing (mirrors
 * `getObjectBytes`), so a caller can treat "no head" as "no source".
 */
export async function headObject(key: string): Promise<ObjectHead | null> {
	try {
		const res = await s3().send(new HeadObjectCommand({ Bucket: ENV.R2_BUCKET, Key: key }));
		return {
			etag: res.ETag ?? null,
			size: res.ContentLength ?? 0,
			lastModified: res.LastModified?.getTime() ?? 0,
		};
	} catch (e) {
		if (isNotFound(e)) return null;
		throw e;
	}
}

export interface ListResult {
	/** Object keys directly under the prefix (delimited listing excludes sub-prefixes). */
	keys: string[];
	/** Sub-prefixes (folder-like groupings) directly under the prefix, each with a trailing `/`. */
	prefixes: string[];
}

/**
 * List objects under a prefix using `/` as a delimiter (folder-like). Result is
 * truncated to a single page (`maxKeys`, default 1000) — callers cap as needed.
 */
export async function listObjects(prefix: string, maxKeys = 1000): Promise<ListResult> {
	const res = await s3().send(
		new ListObjectsV2Command({
			Bucket: ENV.R2_BUCKET,
			Prefix: prefix,
			Delimiter: '/',
			MaxKeys: maxKeys,
		}),
	);
	const keys = (res.Contents ?? [])
		.map((o) => o.Key)
		.filter((k): k is string => typeof k === 'string');
	const prefixes = (res.CommonPrefixes ?? [])
		.map((p) => p.Prefix)
		.filter((p): p is string => typeof p === 'string');
	return { keys, prefixes };
}

/**
 * NON-delimited recursive listing: every object key under `prefix`, paginating
 * through all `ContinuationToken` pages. Used for recursive folder delete/move.
 */
export async function listAllKeys(prefix: string): Promise<string[]> {
	const out: string[] = [];
	let token: string | undefined;
	do {
		const res = await s3().send(
			new ListObjectsV2Command({
				Bucket: ENV.R2_BUCKET,
				Prefix: prefix,
				ContinuationToken: token,
			}),
		);
		for (const o of res.Contents ?? []) {
			if (typeof o.Key === 'string') out.push(o.Key);
		}
		token = res.IsTruncated ? res.NextContinuationToken : undefined;
	} while (token);
	return out;
}

export interface ListedObject {
	key: string;
	size: number;
	/** Epoch ms of `LastModified` (0 when the listing omits it). */
	lastModified: number;
}

/**
 * NON-delimited recursive listing returning each object's key + byte size +
 * last-modified time, paginating through all pages. Like `listAllKeys` but
 * carries `Size`/`LastModified` so callers (e.g. the deploy listing, the
 * editor's deployed-page resolver) can report sizes and pick the newest object
 * without a HEAD per key.
 */
export async function listAllObjects(prefix: string): Promise<ListedObject[]> {
	const out: ListedObject[] = [];
	let token: string | undefined;
	do {
		const res = await s3().send(
			new ListObjectsV2Command({
				Bucket: ENV.R2_BUCKET,
				Prefix: prefix,
				ContinuationToken: token,
			}),
		);
		for (const o of res.Contents ?? []) {
			if (typeof o.Key === 'string') {
				out.push({ key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified?.getTime() ?? 0 });
			}
		}
		token = res.IsTruncated ? res.NextContinuationToken : undefined;
	} while (token);
	return out;
}

export interface FolderEntry {
	key: string;
	size: number;
	lastModified: string | null;
}

export interface FolderListing {
	files: FolderEntry[];
	folders: string[];
	nextToken?: string;
}

/**
 * Delimited (folder-like) listing for the FTP browser: direct files (with size
 * + lastModified) and sub-folder prefixes under `prefix`, one page at a time.
 */
export async function listFolder(prefix: string, token?: string): Promise<FolderListing> {
	const res = await s3().send(
		new ListObjectsV2Command({
			Bucket: ENV.R2_BUCKET,
			Prefix: prefix,
			Delimiter: '/',
			MaxKeys: 1000,
			ContinuationToken: token,
		}),
	);
	const files: FolderEntry[] = (res.Contents ?? [])
		.filter((o): o is typeof o & { Key: string } => typeof o.Key === 'string')
		// Drop the placeholder object for the folder itself (key === prefix).
		.filter((o) => o.Key !== prefix)
		.map((o) => ({
			key: o.Key,
			size: o.Size ?? 0,
			lastModified: o.LastModified ? o.LastModified.toISOString() : null,
		}));
	const folders = (res.CommonPrefixes ?? [])
		.map((p) => p.Prefix)
		.filter((p): p is string => typeof p === 'string');
	const nextToken = res.IsTruncated ? res.NextContinuationToken : undefined;
	return { files, folders, nextToken };
}

function isNotFound(e: unknown): boolean {
	const meta = (e as { $metadata?: { httpStatusCode?: number }; name?: string }) ?? {};
	return (
		meta.$metadata?.httpStatusCode === 404 || meta.name === 'NoSuchKey' || meta.name === 'NotFound'
	);
}
