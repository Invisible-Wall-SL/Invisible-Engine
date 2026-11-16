import {
	AbortMultipartUploadCommand,
	CompleteMultipartUploadCommand,
	CreateMultipartUploadCommand,
	DeleteObjectCommand,
	HeadObjectCommand,
	ListMultipartUploadsCommand,
	ListObjectsV2Command,
	S3Client,
	UploadPartCommand,
} from '@aws-sdk/client-s3';
import type { VolumeObject } from '$lib/volumeModels';
import { ENV } from './env';

/**
 * THE seam between the model manager and wherever the weights physically live. Everything above
 * it (listing, references, deletes, transfers) speaks only this interface, so moving the weights
 * to another backend — e.g. a RunPod Global Volume, which has no S3 API and is reachable only
 * through a pod — is a second implementation of `VolumeStore`, not a rewrite.
 */
export interface VolumeStore {
	/** One line for the page: what is being read, and how. */
	readonly label: string;
	/** The env vars this backend still needs; empty = ready. */
	missing(): string[];
	list(prefix: string): Promise<VolumeObject[]>;
	head(key: string): Promise<{ size: number } | null>;
	remove(key: string): Promise<void>;
	createUpload(key: string): Promise<VolumeUpload>;
	/** Uploads begun and never completed or aborted — their parts occupy (and bill) space. */
	pendingUploads(
		prefix: string,
	): Promise<{ key: string; uploadId: string; started: string | null }[]>;
	abortUpload(key: string, uploadId: string): Promise<void>;
}

export interface VolumeUpload {
	readonly uploadId: string;
	putPart(partNumber: number, body: Uint8Array): Promise<void>;
	complete(): Promise<void>;
	abort(): Promise<void>;
}

/**
 * RunPod's docs: ListObjects on a large volume can fail with "The same next token was received
 * twice" while RunPod computes ETags for files that were not written through S3 — "wait, then
 * retry". A page is retried with a growing pause rather than failing the whole listing.
 */
const LIST_PAGE_ATTEMPTS = 6;
const LIST_RETRY_BASE_MS = 2_000;

class RunpodS3Volume implements VolumeStore {
	private client: S3Client | null = null;

	get label(): string {
		return `Network Volume ${ENV.RUNPOD_VOLUME_ID} (${ENV.RUNPOD_VOLUME_DATA_CENTER}) — RunPod S3 API`;
	}

	missing(): string[] {
		const out: string[] = [];
		if (!ENV.RUNPOD_S3_ACCESS_KEY_ID) out.push('RUNPOD_S3_ACCESS_KEY_ID');
		if (!ENV.RUNPOD_S3_SECRET_ACCESS_KEY) out.push('RUNPOD_S3_SECRET_ACCESS_KEY');
		return out;
	}

	private s3(): S3Client {
		if (!this.client) {
			const dc = ENV.RUNPOD_VOLUME_DATA_CENTER;
			this.client = new S3Client({
				region: dc,
				endpoint: `https://s3api-${dc.toLowerCase()}.runpod.io`,
				forcePathStyle: true,
				credentials: {
					accessKeyId: ENV.RUNPOD_S3_ACCESS_KEY_ID,
					secretAccessKey: ENV.RUNPOD_S3_SECRET_ACCESS_KEY,
				},
				// CompleteMultipartUpload on a 10 GB+ file can take many minutes on RunPod (their
				// docs recommend a 2 h read timeout); a short default would abort a finished upload.
				requestHandler: { requestTimeout: 2 * 60 * 60 * 1000, connectionTimeout: 15_000 },
				maxAttempts: 3,
			});
			// The SDK addresses a bucket-level call (ListObjectsV2, ListMultipartUploads) as `/<bucket>/`;
			// RunPod reads that trailing slash as an empty object key and answers 400 "Invalid object
			// path" — only `/<bucket>` (what the AWS CLI sends) lists.
			const bucketPath = `/${this.bucket}/`;
			this.client.middlewareStack.add(
				(next) => (args) => {
					const request = args.request as { path?: string };
					if (request.path === bucketPath) request.path = bucketPath.slice(0, -1);
					return next(args);
				},
				{ step: 'build', name: 'runpodBucketPath', priority: 'low' },
			);
		}
		return this.client;
	}

	private get bucket(): string {
		return ENV.RUNPOD_VOLUME_ID;
	}

	async list(prefix: string): Promise<VolumeObject[]> {
		const out: VolumeObject[] = [];
		let token: string | undefined;
		do {
			const page = await this.listPage(prefix, token);
			for (const o of page.Contents ?? []) {
				if (!o.Key) continue;
				out.push({
					key: o.Key,
					size: Number(o.Size ?? 0),
					modified: o.LastModified ? o.LastModified.toISOString() : null,
				});
			}
			token = page.IsTruncated ? page.NextContinuationToken : undefined;
		} while (token);
		return out;
	}

	private async listPage(prefix: string, token: string | undefined) {
		let lastError: unknown;
		for (let attempt = 0; attempt < LIST_PAGE_ATTEMPTS; attempt++) {
			try {
				return await this.s3().send(
					new ListObjectsV2Command({
						Bucket: this.bucket,
						Prefix: prefix,
						ContinuationToken: token,
						MaxKeys: 1000,
					}),
				);
			} catch (e) {
				lastError = e;
				await new Promise((r) => setTimeout(r, LIST_RETRY_BASE_MS * (attempt + 1)));
			}
		}
		throw lastError;
	}

	async head(key: string): Promise<{ size: number } | null> {
		try {
			const res = await this.s3().send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
			return { size: Number(res.ContentLength ?? 0) };
		} catch (e) {
			const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
			if (status === 404) return null;
			throw e;
		}
	}

	async remove(key: string): Promise<void> {
		await this.s3().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
	}

	async createUpload(key: string): Promise<VolumeUpload> {
		const s3 = this.s3();
		const bucket = this.bucket;
		const created = await s3.send(
			new CreateMultipartUploadCommand({
				Bucket: bucket,
				Key: key,
				ContentType: 'application/octet-stream',
			}),
		);
		const uploadId = created.UploadId;
		if (!uploadId) throw new Error('The volume did not return an upload id.');
		const parts: { PartNumber: number; ETag: string }[] = [];
		return {
			uploadId,
			async putPart(partNumber, body) {
				const res = await s3.send(
					new UploadPartCommand({
						Bucket: bucket,
						Key: key,
						UploadId: uploadId,
						PartNumber: partNumber,
						Body: body,
						ContentLength: body.byteLength,
					}),
				);
				parts.push({ PartNumber: partNumber, ETag: res.ETag ?? '' });
			},
			async complete() {
				await s3.send(
					new CompleteMultipartUploadCommand({
						Bucket: bucket,
						Key: key,
						UploadId: uploadId,
						MultipartUpload: { Parts: [...parts].sort((a, b) => a.PartNumber - b.PartNumber) },
					}),
				);
			},
			async abort() {
				await s3.send(
					new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
				);
			},
		};
	}

	async pendingUploads(prefix: string) {
		const res = await this.s3().send(
			new ListMultipartUploadsCommand({ Bucket: this.bucket, Prefix: prefix }),
		);
		return (res.Uploads ?? [])
			.filter((u) => u.Key && u.UploadId)
			.map((u) => ({
				key: u.Key as string,
				uploadId: u.UploadId as string,
				started: u.Initiated ? u.Initiated.toISOString() : null,
			}));
	}

	async abortUpload(key: string, uploadId: string): Promise<void> {
		await this.s3().send(
			new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
		);
	}
}

let store: VolumeStore | null = null;

export function volumeStore(): VolumeStore {
	store ??= new RunpodS3Volume();
	return store;
}
