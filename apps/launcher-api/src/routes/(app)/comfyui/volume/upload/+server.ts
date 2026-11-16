import { json } from '@sveltejs/kit';
import { requireComfyAdmin } from '$lib/server/comfyAdmin';
import {
	abortMultipartUpload,
	completeMultipartUpload,
	createMultipartUpload,
	headObject,
	presignUploadPart,
} from '$lib/server/r2';
import { VolumeActionError, startTransfer, transferRunning } from '$lib/server/volumeModels';
import { volumeStore } from '$lib/server/volumeStore';
import { mirrorKey, uploadTargetError, volumeKey } from '$lib/volumeModels';
import type { RequestHandler } from './$types';

/**
 * A model from the admin's computer. RunPod's volume S3 API signs no URLs, so the browser cannot
 * write to the volume directly; it uploads into the R2 mirror instead (`comfyui-models/…`, part
 * by part on presigned URLs — never through the launcher's body cap), and `complete` then starts
 * the server-side R2 → volume copy, which also writes the manifest entry. Steps:
 * `start` → `urls` (repeat) → `complete`, or `abort`.
 */
const PART_URL_TTL_SECONDS = 6 * 60 * 60;
const MIN_PART_BYTES = 64 * 1024 * 1024;
const MAX_PARTS = 9_000;
const MAX_URLS_PER_CALL = 50;

function partSizeFor(size: number): number {
	return Math.max(MIN_PART_BYTES, Math.ceil(size / MAX_PARTS));
}

export const POST: RequestHandler = async ({ locals, request }) => {
	await requireComfyAdmin(locals);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const str = (k: string) => (typeof body?.[k] === 'string' ? (body[k] as string).trim() : '');
	const folder = str('folder');
	const path = str('path');
	const bad = uploadTargetError(folder, path);
	if (bad) return json({ error: bad }, { status: 400 });
	const key = mirrorKey({ folder, path });
	const uploadId = str('uploadId');

	try {
		switch (body?.action) {
			case 'start': {
				const size = Number(body?.size);
				if (!Number.isFinite(size) || size <= 0) {
					return json({ error: 'The file is empty.' }, { status: 400 });
				}
				if (await headObject(key)) {
					return json(
						{ error: `${key} is already in the R2 mirror — use Copy to volume.` },
						{ status: 409 },
					);
				}
				if (await volumeStore().head(volumeKey(folder, path))) {
					return json({ error: 'That file is already on the volume.' }, { status: 409 });
				}
				const id = await createMultipartUpload(key, 'application/octet-stream');
				const partSize = partSizeFor(size);
				return json({ key, uploadId: id, partSize, parts: Math.ceil(size / partSize) });
			}
			case 'urls': {
				const from = Math.max(1, Math.floor(Number(body?.from) || 1));
				const count = Math.min(MAX_URLS_PER_CALL, Math.max(1, Math.floor(Number(body?.count))));
				const urls = await Promise.all(
					Array.from({ length: count }, (_, i) =>
						presignUploadPart(key, uploadId, from + i, PART_URL_TTL_SECONDS),
					),
				);
				return json({ from, urls });
			}
			case 'complete': {
				// Refuse before completing: a completed object whose copy cannot start is a
				// multi-GB file in R2 that nothing indexes.
				if (transferRunning()) {
					return json(
						{ error: 'A transfer is running — finish this upload when it is done.' },
						{ status: 409 },
					);
				}
				await completeMultipartUpload(key, uploadId);
				const job = await startTransfer(
					{ source: key, folder, path, mirror: true },
					locals.user?.email ?? 'admin',
				);
				return json({ job });
			}
			case 'abort': {
				await abortMultipartUpload(key, uploadId);
				return json({ ok: true });
			}
			default:
				return json({ error: 'Unknown upload step.' }, { status: 400 });
		}
	} catch (e) {
		if (e instanceof VolumeActionError) return json({ error: e.message }, { status: e.status });
		console.error(`[volume-models] upload ${String(body?.action)} failed for ${key}:`, e);
		return json({ error: 'The upload step failed — see the launcher log.' }, { status: 502 });
	}
};
