import { error, json } from '@sveltejs/kit';
import { ENV } from '$lib/server/env';
import { jsonObjectOrNull } from '$lib/server/http';
import { SUB } from '$lib/server/projectPaths';
import { getObjectBytes, getObjectText, getObjectTextWithEtag } from '$lib/server/r2';
import {
	framePartsRequest,
	propPivots,
	type PartSource,
	type TrackFrame,
} from '$lib/server/rigFrameFit';
import {
	JOB_ID,
	jobRoot,
	partsSheetName,
	rawLabels,
	type StoredCut,
} from '$lib/server/rigFromFrame';
import { rigBundleNameTaken } from '$lib/server/rigIndex';
import { rigTemplateForNewRig } from '$lib/server/rigTemplateStore';
import { toolHandoff } from '$lib/server/toolLaunch';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/** The parts of a 720² frame take ~2 s on one CPU thread; a cold container reads the cut first. */
const TIMEOUT_MS = 120_000;

/**
 * Frame to rig's step after the cut (docs/design/frame-to-rig.md §4.4–§4.6, F2b): the cut made into
 * a sheet the rig is created from. Body `{ job, etag, name }`: `etag` is the `cut.json` the page
 * shows (a cut re-run or touched up elsewhere since is a 409), `name` the rig's. The template is
 * fitted to the cut's joints (`rigFrameFit.ts`) and atlas-tool makes each part whole, fills what it
 * hides on the CPU, turns it to its bone's rest and packs the sheet `<name>_parts` into this
 * project. The answer is what ＋ New rig takes (`manifestKey`, `templateId`, `fit`) with the parts'
 * report (and the frame each part taken from another frame came from: `frames`); the page then
 * creates the rig through `/api/rigger/new`. Gated by `rigger`.
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
	const job = typeof body.job === 'string' && JOB_ID.test(body.job) ? body.job : '';
	if (!job) throw error(400, 'Bad job id.');
	const name = (typeof body.name === 'string' ? body.name : '')
		.trim()
		.replace(/[^A-Za-z0-9_-]/g, '_');
	if (!name) throw error(400, 'missing rig name');
	if (name.length > 64) throw error(400, 'A rig name is at most 64 characters.');
	if (await rigBundleNameTaken(SUB.spines(clientKey, projectKey), name))
		throw error(409, `a rig named "${name}" already exists (names are case-insensitive)`);

	const root = jobRoot(clientKey, projectKey, job);
	const read = await getObjectTextWithEtag(`${root}/cut.json`);
	if (!read) throw error(404, 'That cut is gone: cut the frame again.');
	if (typeof body.etag !== 'string' || body.etag !== read.etag)
		throw error(409, 'The cut changed since it was opened (re-cut or saved elsewhere).');
	const cut = JSON.parse(read.text) as StoredCut;
	const trackText = await getObjectText(`${root}/track.json`);
	if (!trackText) throw error(404, "That cut's joints are gone: cut the frame again.");
	const template = await rigTemplateForNewRig(cut.template);
	if (!template) throw error(404, `The cut's template "${cut.template}" is gone.`);
	// Each taken prop hangs from a bone of its own at its pivot, read off the label map.
	const labelsPng = await getObjectBytes(`${root}/labels.png`);
	if (!labelsPng) throw error(404, "That cut's label map is gone: cut the frame again.");
	const labels = await rawLabels(labelsPng.body);
	// Per-part frames: each part the author took from another frame, from that frame's kept cut.
	const sources: Record<string, PartSource> = {};
	const frames: Record<string, number | null> = {};
	for (const [part, other] of Object.entries(cut.sources ?? {})) {
		const at = jobRoot(clientKey, projectKey, other);
		const [theirCut, theirTrack] = await Promise.all([
			getObjectText(`${at}/cut.json`),
			getObjectText(`${at}/track.json`),
		]);
		if (!theirCut || !theirTrack)
			throw error(404, `The frame ${part} is taken from has no kept cut any more: pick it again.`);
		const them = JSON.parse(theirCut) as StoredCut;
		if (them.template !== cut.template)
			throw error(422, `The frame ${part} is taken from was cut for another template.`);
		sources[part] = { job: other, cut: them, track: JSON.parse(theirTrack) as TrackFrame };
		frames[part] = them.clip?.frame ?? null;
	}
	const planned = framePartsRequest(
		template,
		cut,
		JSON.parse(trackText) as TrackFrame,
		propPivots(labels.data, labels.width, cut),
		sources,
	);
	if (!planned.ok) throw error(422, `The rig cannot be fitted to this cut: ${planned.problem}.`);

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
	const { fit, scale, origin, parts, order, foreshortened, face } = planned.value;
	let res: Response;
	try {
		res = await fetch(`${base}/rig-from-frame/parts`, {
			method: 'POST',
			headers: { ...headers, 'content-type': 'application/json' },
			body: JSON.stringify({
				job,
				sheet: partsSheetName(name),
				scale,
				origin,
				parts,
				order,
				fill: 'cpu',
			}),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch (e) {
		throw error(502, `Could not reach the Atlas Maker service: ${(e as Error).message}`);
	}
	if (!res.ok) throw error(502, `The Atlas Maker service answered ${res.status}.`);
	const out = (await res.json()) as {
		error?: string;
		manifestKey?: string;
		parts?: Record<string, unknown>;
		fill?: string;
	};
	if (out.error) throw error(422, out.error);
	if (
		out.manifestKey !==
		`${SUB.manifests(clientKey, projectKey)}/atlas_manifest_${partsSheetName(name)}.json`
	)
		throw error(502, 'The Atlas Maker service wrote the sheet somewhere unexpected.');
	return json({
		manifestKey: out.manifestKey,
		templateId: template.id,
		fit,
		fill: out.fill,
		parts: out.parts,
		foreshortened,
		face,
		frames,
	});
};
