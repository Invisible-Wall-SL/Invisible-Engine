import { error, json } from '@sveltejs/kit';
import { ENV } from '$lib/server/env';
import { loadFlipbookDoc } from '$lib/server/flipbookStorage';
import { jsonObjectOrNull } from '$lib/server/http';
import { getObjectTextWithEtag, headObject, listAllObjects } from '$lib/server/r2';
import {
	JOB_ID,
	clipFrameKeys,
	cutFrameOf,
	cutTemplateSlots,
	jobRoot,
	newJobId,
	resolveClipFrame,
	type StoredCut,
} from '$lib/server/rigFromFrame';
import { toolHandoff } from '$lib/server/toolLaunch';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * A fresh container first fetches the models from R2 (~175 MB) and loads them (~2.5 s); a cut is
 * ~5–8 s on one or two CPU threads, a re-cut of the same frame (a joint dragged) ~2–3 s.
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
			body: JSON.stringify({
				job,
				frame: where.value,
				track,
				template: template.value,
				clip: { id: clipId, frame },
			}),
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
	return json({ ...out, clipId, frame, etag: head?.etag ?? null, urls: cutUrls(root) });
};

/** The URLs the page draws a cut from, cache-busted. */
function cutUrls(root: string): Record<'frame' | 'labels' | 'overlay' | 'track', string> {
	const v = Date.now().toString(36);
	const url = (name: string) =>
		`/api/editor/asset?key=${encodeURIComponent(`${root}/${name}`)}&v=${v}`;
	return {
		frame: url('frame.png'),
		labels: url('labels.png'),
		overlay: url('overlay.png'),
		track: url('track.json'),
	};
}

/** The newest cuts read when a clip is opened: older ones are not offered again. */
const SAVED_CUTS_READ = 40;

/**
 * The cuts kept for a clip (frame to rig F2b): `?clipId=`. Each the newest cut of its frame, newest
 * first, as `cut.json` stores it with its ETag (the touch-ups' and Create rig's precondition) and
 * the URLs the page draws it from, so reopening the dialog on the clip shows the cut again and goes
 * straight to Create rig. A cut from before cuts named their clip is matched by the frame's pixels.
 * `&job=` answers that one cut as `{ cut }` (null when it is gone or another clip's): the cut a rig
 * was made from, which ✂ Edit cut opens (§12 F2j). Gated by `rigger`.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});
	const clipId = url.searchParams.get('clipId') ?? '';
	const clip = (await loadFlipbookDoc(clientKey, projectKey)).clips.find((c) => c.id === clipId);
	if (!clip) throw error(404, 'That Flipbook clip is not in this project.');
	// ✂ Edit cut (§12 F2j): the one cut a rig was made from, whichever is its frame's newest.
	const one = url.searchParams.get('job');
	if (one !== null) {
		if (!JOB_ID.test(one)) throw error(400, 'Bad job id.');
		const root = jobRoot(clientKey, projectKey, one);
		const got = await getObjectTextWithEtag(`${root}/cut.json`);
		if (!got) return json({ cut: null });
		const cut = JSON.parse(got.text) as StoredCut;
		const frame = cutFrameOf(cut, clipId, await clipFrameKeys(clip));
		const head = await headObject(`${root}/cut.json`);
		return json({
			cut:
				frame === null
					? null
					: {
							...cut,
							root,
							clipId,
							frame,
							etag: got.etag,
							saved: head?.lastModified ?? Date.now(),
							urls: cutUrls(root),
						},
		});
	}
	const prefix = `${jobRoot(clientKey, projectKey, '')}`;
	const listed = (await listAllObjects(prefix))
		.filter((o) => /^[^/]+\/cut\.json$/.test(o.key.slice(prefix.length)))
		.sort((a, b) => b.lastModified - a.lastModified)
		.slice(0, SAVED_CUTS_READ);
	const keys = await clipFrameKeys(clip);
	const read = await Promise.all(
		listed.map(async (o) => {
			const got = await getObjectTextWithEtag(o.key);
			if (!got) return null;
			let cut: StoredCut;
			try {
				cut = JSON.parse(got.text) as StoredCut;
			} catch {
				return null;
			}
			const frame = JOB_ID.test(cut.job ?? '') ? cutFrameOf(cut, clipId, keys) : null;
			return frame === null ? null : { cut, frame, etag: got.etag, at: o.lastModified };
		}),
	);
	const seen = new Set<number>();
	const cuts = [];
	for (const r of read) {
		if (!r || seen.has(r.frame)) continue;
		seen.add(r.frame);
		const root = jobRoot(clientKey, projectKey, r.cut.job);
		cuts.push({
			...r.cut,
			root,
			clipId,
			frame: r.frame,
			etag: r.etag,
			saved: r.at,
			urls: cutUrls(root),
		});
	}
	return json({ cuts });
};
