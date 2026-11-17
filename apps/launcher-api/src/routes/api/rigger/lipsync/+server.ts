import { error, json } from '@sveltejs/kit';
import { decodeToMonoWav } from '$lib/server/audioTranscode';
import { ENV } from '$lib/server/env';
import { jsonObjectOrNull } from '$lib/server/http';
import { getVoice } from '$lib/server/riggerVoice';
import { toolHandoff } from '$lib/server/toolLaunch';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/** Rhubarb runs at about real time on one CPU; a 60 s line plus a cold start fits. */
const TIMEOUT_MS = 170_000;
const RECOGNIZERS = ['pocketSphinx', 'phonetic'];

/**
 * Lip-sync a voice line (rig templates T4, docs/design/rig-templates.md §5.2). Body `{ file,
 * dialog?, recognizer? }` names a line uploaded through `/api/rigger/voice`; the launcher decodes
 * it to a mono WAV and atlas-tool runs Rhubarb Lip Sync on it. Answers `{ duration, cues: [{
 * start, end, value }] }`, `value` being Rhubarb's shape letter — the page maps letters to the
 * template's mouth images and keys them, so nothing here knows the template. Gated by `rigger`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});
	const user = locals.user;
	if (!user) throw error(401, 'Not signed in.');
	const body = await jsonObjectOrNull(request);
	if (!body) throw error(400, 'bad body');
	const file = typeof body.file === 'string' ? body.file : '';
	const dialog = typeof body.dialog === 'string' ? body.dialog.slice(0, 4000) : '';
	const recognizer = typeof body.recognizer === 'string' ? body.recognizer : 'pocketSphinx';
	if (!RECOGNIZERS.includes(recognizer)) throw error(400, 'Unknown recognizer.');

	const audio = await getVoice(clientKey, projectKey, file);
	if (!audio) throw error(404, 'That voice line is not in this project.');
	const wav = await decodeToMonoWav(audio, file.slice(file.lastIndexOf('.') + 1));
	if (!wav) throw error(422, 'That audio file could not be read.');

	const base = ENV.ATLAS_TOOL_URL.replace(/\/$/, '');
	if (!base) throw error(503, 'The Atlas Maker service is not configured (ATLAS_TOOL_URL).');
	const { headers } = await toolHandoff({
		tool: 'atlas',
		user,
		clientKey,
		projectKey,
		via: 'header',
		withPublish: false,
	});
	let res: Response;
	try {
		res = await fetch(`${base}/lipsync`, {
			method: 'POST',
			headers: { ...headers, 'content-type': 'application/json' },
			body: JSON.stringify({ wav_b64: wav.toString('base64'), dialog, recognizer }),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch (e) {
		throw error(502, `Could not reach the lip-sync service: ${(e as Error).message}`);
	}
	if (!res.ok) throw error(502, `The lip-sync service answered ${res.status}.`);
	const out = (await res.json()) as {
		error?: string;
		duration?: number;
		cues?: { start: number; end: number; value: string }[];
	};
	if (out.error) throw error(422, out.error);
	return json({ duration: out.duration ?? 0, cues: out.cues ?? [] });
};
