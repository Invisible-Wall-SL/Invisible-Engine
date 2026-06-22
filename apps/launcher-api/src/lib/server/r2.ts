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

export async function putObjectText(
	key: string,
	text: string,
	contentType = 'application/octet-stream',
): Promise<void> {
	await s3().send(
		new PutObjectCommand({
			Bucket: ENV.R2_BUCKET,
			Key: key,
			Body: text,
			ContentType: contentType,
		}),
	);
}

export async function putObjectBytes(
	key: string,
	body: Uint8Array,
	contentType = 'application/octet-stream',
): Promise<void> {
	await s3().send(
		new PutObjectCommand({
			Bucket: ENV.R2_BUCKET,
			Key: key,
			Body: body,
			ContentType: contentType,
		}),
	);
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
