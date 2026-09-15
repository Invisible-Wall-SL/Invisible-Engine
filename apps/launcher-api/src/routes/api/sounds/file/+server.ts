import { error, json } from '@sveltejs/kit';
import { MAX_SOUND_BYTES } from 'engine-layout';
import { requireSoundAccess, resolveSoundScope } from '$lib/server/soundAccess';
import {
	getSoundFile,
	mintSoundId,
	parseRange,
	presignSoundUpload,
	soundContentType,
	soundExtension,
	soundFileName,
} from '$lib/server/soundFiles';
import type { RequestHandler } from './$types';

/**
 * The AUDIO FILES behind a project's sound library — mint the URL that uploads one, and stream one
 * back to audition.
 *
 * Same session + `sound` entitlement gate as `/api/sounds` (see `soundAccess.ts`).
 *
 * See `docs/design/invisible-sound.md`.
 */

/** How long the browser has to PUT the bytes. Long enough for a 25 MB track on a poor line. */
const PUT_TTL_SECONDS = 600;

/**
 * Mint the URL that uploads one audio file. Body: `{ name, bytes }` — the picked filename (its
 * extension chooses the format) and its size.
 *
 * Returns `{ id, file, url, contentType }`. The browser then PUTs the bytes STRAIGHT TO R2 with
 * that exact `contentType`, adds an entry naming that `file`, and saves it through
 * `PUT /api/sounds`, which is ETag-guarded.
 *
 * The bytes never come through here. A multipart POST did until this endpoint was rewritten, and it
 * could not carry a real sound: adapter-node truncates a request body at `BODY_SIZE_LIMIT`
 * (512 KB), so every upload over that died — reported as a 400 about multipart parsing, because the
 * truncation surfaced as `request.formData()` rejecting rather than as anything about size. See
 * `presignSoundUpload`.
 *
 * **This endpoint deliberately does not touch `sounds.json`**: an upload that also wrote the doc
 * would have to write it unconditionally, which is exactly how one author's library silently
 * replaces another's.
 *
 * The consequence is an ORPHAN WINDOW — bytes land, and if the doc save then loses a conflict (or
 * the author closes the tab) the file is in `sounds/files/` with nothing naming it. That is the
 * right trade: an orphan is invisible, cheap and listable, while the alternative loses work.
 *
 * `durationMs` is NOT measured here. Deriving it would mean decoding five container formats
 * server-side; the browser already decoded the file to show its waveform, and its answer is the one
 * that matters — it is the same decoder that will play the sound. The doc's normalize rejects a
 * non-positive duration, which is the guard that keeps a wrong one from becoming a silent sprite.
 */
export const POST: RequestHandler = async ({ request, url, locals }) => {
	await requireSoundAccess(locals);
	const { clientKey, projectKey } = await resolveSoundScope(url.searchParams.get('project'));

	let body: { name?: unknown; bytes?: unknown };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	const name = typeof body.name === 'string' ? body.name : '';
	if (!name) throw error(400, 'Expected a `name`.');

	// The SIZE is the one the caller declares — with the bytes going straight to R2 nothing here
	// ever weighs them. It stops an honest mistake (a 300 MB wav dropped in), not a liar, and a
	// liar here is a logged-in author entitled to the tool. The page checks the same number first,
	// so this is the floor rather than the message anyone normally reads.
	const bytes = typeof body.bytes === 'number' && Number.isFinite(body.bytes) ? body.bytes : -1;
	if (bytes <= 0) throw error(400, 'That file is empty.');
	if (bytes > MAX_SOUND_BYTES) {
		throw error(413, `That file is larger than ${Math.round(MAX_SOUND_BYTES / 1024 / 1024)} MB.`);
	}

	// The EXTENSION decides the format, not the browser's `File.type`, which is client-supplied and
	// varies by OS for the same file (`audio/mp3` vs `audio/mpeg` vs empty).
	const ext = soundExtension(name);
	if (!ext) throw error(415, `Unsupported audio format: ${name}`);

	const id = mintSoundId();
	const stored = soundFileName(id, ext);
	let uploadUrl: string;
	try {
		uploadUrl = await presignSoundUpload(clientKey, projectKey, stored, PUT_TTL_SECONDS);
	} catch {
		throw error(502, 'Failed to prepare the upload.');
	}

	return json({
		clientKey,
		projectKey,
		id,
		file: stored,
		url: uploadUrl,
		// Signed INTO the URL, so the browser must send exactly this back or R2 refuses the PUT.
		contentType: soundContentType(stored),
		originalName: name,
	});
};

/**
 * Stream one sound back for audition — `?file=<stored filename>`.
 *
 * `inline`, never `attachment` (the `/api/files/download` sibling forces a download; this one has to
 * play). Range requests are honoured because an `<audio>` element scrubbing a BGM track sends them,
 * and answering 200-with-everything makes it re-fetch the whole file on each seek.
 *
 * `no-store`: a project can replace a sound under a NEW filename, but an author auditioning during a
 * review must never hear a cached copy of something they just changed.
 */
export const GET: RequestHandler = async ({ url, request, locals }) => {
	await requireSoundAccess(locals);
	const { clientKey, projectKey } = await resolveSoundScope(url.searchParams.get('project'));

	const file = url.searchParams.get('file');
	if (!file) throw error(400, 'missing file');

	const obj = await getSoundFile(clientKey, projectKey, file);
	if (!obj) throw error(404, 'not found');

	const size = obj.body.byteLength;
	const headers: Record<string, string> = {
		'content-type': obj.contentType,
		'content-disposition': 'inline',
		'cache-control': 'no-store',
		'accept-ranges': 'bytes',
	};

	// `.slice()` rather than `.subarray()`, and the ArrayBuffer rather than the view: a `Uint8Array`
	// is not a `BodyInit` to TypeScript (its buffer is `ArrayBufferLike`, which may be shared), and
	// a copy whose buffer holds exactly these bytes is both assignable and unambiguous.
	const range = parseRange(request.headers.get('range'), size);
	if (range) {
		const slice = obj.body.slice(range.start, range.end + 1);
		return new Response(slice.buffer, {
			status: 206,
			headers: {
				...headers,
				'content-range': `bytes ${range.start}-${range.end}/${size}`,
				'content-length': String(slice.byteLength),
			},
		});
	}

	return new Response(obj.body.slice().buffer, {
		headers: { ...headers, 'content-length': String(size) },
	});
};
