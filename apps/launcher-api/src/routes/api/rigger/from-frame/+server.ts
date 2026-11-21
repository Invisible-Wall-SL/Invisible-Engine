import { error, json } from '@sveltejs/kit';
import { ENV } from '$lib/server/env';
import { loadFlipbookDoc } from '$lib/server/flipbookStorage';
import { jsonObjectOrNull } from '$lib/server/http';
import { headObject } from '$lib/server/r2';
import {
	JOB_ID,
	cutTemplateSlots,
	jobRoot,
	newJobId,
	resolveClipFrame,
} from '$lib/server/rigFromFrame';
import { toolHandoff } from '$lib/server/toolLaunch';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * A cold service first fetches the models from R2 (~175 MB) and loads them (~10 s); a warm cut is
 * seconds, a re-cut of the same frame (a joint dragged) faster still.
 */
const TIMEOUT_MS = 240_000;
const MAX_TRACK_BYTES = 1_000_000;

/**
 * Cut a Flipbook frame into a rig template's parts and props (frame to rig F1,
 * docs/design/frame-to-rig.md §4.3). Body `{ clipId, frame, track, templateId, job? }`: the clip's
 * frame index, its 🎥 Motion track frame (with any joint the author dragged) and the template;
 * `job` re-cuts into an earlier cut's folder. atlas-tool runs SAM 2.1 and the props step and writes
 * `<project>/rig-from-frame/<job>/`; the answer is its `cut.json` plus the URLs the page draws.
 * Gated by `rigger`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const scope = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});
	const { clientKey, projectKey } = scope;
	const user = locals.user;
	if (!user) throw error(401, 'Not signed in.');
	const body = await jsonObjectOrNull(request);
	if (!body) throw error(400, 'bad body');
	const clipId = typeof body.clipId === 'string' ? body.clipId : '';
	const frame = typeof body.frame === 'number' ? body.frame : -1;
	const templateId = typeof body.templateId === 'string' ? body.templateId : '';
	const track = body.track;
	if (!track || typeof track !== 'object' || JSON.stringify(track).length > MAX_TRACK_BYTES)
		throw error(400, 'No joints were sent.');
	const job = typeof body.job === 'string' && JOB_ID.test(body.job) ? body.job : newJobId();

	const clip = (await loadFlipbookDoc(clientKey, projectKey)).clips.find((c) => c.id === clipId);
	if (!clip) throw error(404, 'That Flipbook clip is not in this project.');
	const where = await resolveClipFrame(clip, frame, scope);
	if (!where.ok) throw error(where.status, where.message);
	const template = await cutTemplateSlots(templateId);
	if (!template.ok) throw error(template.status, template.message);

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
		res = await fetch(`${base}/rig-from-frame`, {
			method: 'POST',
			headers: { ...headers, 'content-type': 'application/json' },
			body: JSON.stringify({ job, frame: where.value, track, template: template.value }),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch (e) {
		throw error(502, `Could not reach the cut service: ${(e as Error).message}`);
	}
	if (!res.ok) throw error(502, `The cut service answered ${res.status}.`);
	const out = (await res.json()) as { error?: string; root?: string } & Record<string, unknown>;
	if (out.error) throw error(422, out.error);
	const root = jobRoot(clientKey, projectKey, job);
	if (out.root !== root) throw error(502, 'The cut service wrote somewhere unexpected.');
	const head = await headObject(`${root}/cut.json`);
	const v = Date.now().toString(36);
	const url = (name: string) =>
		`/api/editor/asset?key=${encodeURIComponent(`${root}/${name}`)}&v=${v}`;
	return json({
		...out,
		clipId,
		frame,
		etag: head?.etag ?? null,
		urls: { frame: url('frame.png'), labels: url('labels.png'), overlay: url('overlay.png') },
	});
};
