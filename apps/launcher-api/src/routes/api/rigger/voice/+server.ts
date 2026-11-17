import { error, json } from '@sveltejs/kit';
import { jsonObjectOrNull } from '$lib/server/http';
import {
	MAX_VOICE_BYTES,
	getVoice,
	listVoices,
	mintVoiceFile,
	presignVoiceUpload,
} from '$lib/server/riggerVoice';
import { soundContentType } from '$lib/server/soundFiles';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

const PUT_TTL_SECONDS = 600;

const rigger = {
	tool: 'rigger',
	forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
} as const;

/**
 * The project's lip-sync voice lines (rig templates T4). GET → `{ voices: [{ file, size,
 * modified }] }`; GET `?file=` → that line's audio, to play beside the animation. Gated by `rigger`.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, rigger);
	const file = url.searchParams.get('file');
	if (!file) return json({ voices: await listVoices(clientKey, projectKey) });
	const body = await getVoice(clientKey, projectKey, file);
	if (!body) throw error(404, 'not found');
	return new Response(body.slice().buffer, {
		headers: {
			'content-type': soundContentType(file),
			'content-disposition': 'inline',
			'cache-control': 'private, max-age=3600',
		},
	});
};

/**
 * Mint the URL that uploads one voice line. Body `{ name, bytes }` → `{ file, url, contentType }`;
 * the browser PUTs the bytes straight to R2 with exactly that content type.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, rigger);
	const body = await jsonObjectOrNull(request);
	if (!body) throw error(400, 'bad body');
	const name = typeof body.name === 'string' ? body.name : '';
	const bytes = typeof body.bytes === 'number' && Number.isFinite(body.bytes) ? body.bytes : -1;
	if (bytes <= 0) throw error(400, 'That file is empty.');
	if (bytes > MAX_VOICE_BYTES)
		throw error(413, `That file is larger than ${Math.round(MAX_VOICE_BYTES / 1024 / 1024)} MB.`);
	const file = mintVoiceFile(name);
	if (!file) throw error(415, `Unsupported audio format: ${name}`);
	let url: string;
	try {
		url = await presignVoiceUpload(clientKey, projectKey, file, PUT_TTL_SECONDS);
	} catch {
		throw error(502, 'Failed to prepare the upload.');
	}
	return json({ file, url, contentType: soundContentType(file) });
};
