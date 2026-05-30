import {
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
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
): Promise<{ body: Uint8Array; contentType: string } | null> {
	try {
		const res = await s3().send(new GetObjectCommand({ Bucket: ENV.R2_BUCKET, Key: key }));
		const body = await res.Body!.transformToByteArray();
		return { body, contentType: res.ContentType ?? 'application/octet-stream' };
	} catch (e) {
		if (isNotFound(e)) return null;
		throw e;
	}
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

function isNotFound(e: unknown): boolean {
	const meta = (e as { $metadata?: { httpStatusCode?: number }; name?: string }) ?? {};
	return (
		meta.$metadata?.httpStatusCode === 404 || meta.name === 'NoSuchKey' || meta.name === 'NotFound'
	);
}
