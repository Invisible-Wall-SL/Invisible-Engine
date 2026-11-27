import { error, json } from '@sveltejs/kit';
import { ENV } from '$lib/server/env';
import { jsonObjectOrNull } from '$lib/server/http';
import { refuseOnThrow } from '$lib/server/refuseOnThrow';
import { SUB } from '$lib/server/projectPaths';
import { getObjectBytes, getObjectText, getObjectTextWithEtag, headObject } from '$lib/server/r2';
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
import {
	bundlePrefixOf,
	liveArtKey,
	rigsDrawnFrom,
	sheetManifestKey,
	updateSheet,
} from '$lib/server/rigFrameSourceStore';
import { irigTarget } from '$lib/server/riggerIrigWrite';
import { rigBundleNameTaken } from '$lib/server/rigIndex';
import { requestModules } from '$lib/server/riggerNewRig';
import {
	drawnInto,
	moduleChoiceProblem,
	offDefault,
	templateWithModules,
} from '$lib/server/rigTemplateModules';
import { bundleModules, rigTemplateForNewRig } from '$lib/server/rigTemplateStore';
import { toolHandoff } from '$lib/server/toolLaunch';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** The parts of a 720² frame take ~2 s on one CPU thread; a cold container reads the cut first. */
const TIMEOUT_MS = 120_000;

/**
 * Frame to rig's step after the cut (docs/design/frame-to-rig.md §4.4–§4.6, F2b): the cut made into
 * a sheet the rig is created from. Body `{ job, etag, name }`: `etag` is the `cut.json` the page
 * shows (a cut re-run or touched up elsewhere since is a 409), `name` the rig's. The template is
 * fitted to the cut's joints (`rigFrameFit.ts`) and atlas-tool makes each part whole, fills what it
 * hides on the CPU, turns it to its bone's rest and packs the sheet `<name>_parts` into this
 * project. `modules` is the rig's module set (docs/design/rig-modules.md §5): a part it leaves out is
 * drawn into the part above it (a hand into its forearm). The answer is what ＋ New rig takes (`manifestKey`, `templateId`, `fit`) with the parts'
 * report (and the frame each part taken from another frame came from: `frames`); the page then
 * creates the rig through `/api/rigger/new`. Gated by `rigger`.
 *
 * With `rig: { dir, stem }` instead of a name (🔄 Update rig, §12 F2j) the rig exists, and the sheet
 * is its one its bundle is NOT drawn from (`<rig>_parts` and `<rig>_parts_b` take turns), written
 * over whichever cut last made it while it is still the version read here (`replace_etag`), and
 * refused while another rig draws from it: the bundle re-syncs from its own sheet on every read, so the rig
 * games ship changes only when the updated rig is saved.
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
	// 🔄 Update rig (`rig`): the rig exists, and its parts go to its sheet its bundle is not drawn from.
	const rig = isRecord(body.rig)
		? irigTarget(clientKey, projectKey, body.rig.dir, body.rig.stem)
		: null;
	let sheet: string;
	// The idle sheet as the launcher sees it: atlas-tool writes over it only while it still is, so an
	// update saved meanwhile in another tab (which may have moved the bundle onto it) is never written.
	let replaceEtag: string | null = null;
	if (rig) {
		if (!(await headObject(rig.key))) throw error(404, `There is no rig "${rig.stem}" to update.`);
		sheet = updateSheet(clientKey, projectKey, rig.stem, await liveArtKey(bundlePrefixOf(rig)));
		const key = sheetManifestKey(clientKey, projectKey, sheet);
		const others = await rigsDrawnFrom(clientKey, projectKey, key, bundlePrefixOf(rig));
		if (others.length)
			return json(
				{
					ok: false,
					error: 'conflict',
					message: `The sheet ${sheet} is also the art of ${others.map((o) => `"${o}"`).join(', ')} (picked with ⟳ source…), so an update would change it there too: point that rig at another sheet first.`,
				},
				{ status: 409 },
			);
		replaceEtag = (await headObject(key))?.etag ?? null;
	} else {
		const name = (typeof body.name === 'string' ? body.name : '')
			.trim()
			.replace(/[^A-Za-z0-9_-]/g, '_');
		if (!name) throw error(400, 'missing rig name');
		if (name.length > 64) throw error(400, 'A rig name is at most 64 characters.');
		if (await rigBundleNameTaken(SUB.spines(clientKey, projectKey), name))
			throw error(409, `a rig named "${name}" already exists (names are case-insensitive)`);
		sheet = partsSheetName(name);
	}

	const root = jobRoot(clientKey, projectKey, job);
	const read = await getObjectTextWithEtag(`${root}/cut.json`);
	if (!read) throw error(404, 'That cut is gone: cut the frame again.');
	if (typeof body.etag !== 'string' || body.etag !== read.etag)
		throw error(409, 'The cut changed since it was opened (re-cut or saved elsewhere).');
	const cut = JSON.parse(read.text) as StoredCut;
	const trackText = await getObjectText(`${root}/track.json`);
	if (!trackText) throw error(404, "That cut's joints are gone: cut the frame again.");
	const whole = await rigTemplateForNewRig(cut.template);
	if (!whole) throw error(404, `The cut's template "${cut.template}" is gone.`);
	// The module set (docs/design/rig-modules.md §5): the page's (＋ New rig's, or ✂ Edit cut's for an
	// update), else an updated rig's own. A part it leaves out is drawn into another (a hand: its forearm).
	const modules =
		requestModules(body.modules) ?? (rig ? await bundleModules(bundlePrefixOf(rig)) : {});
	const unchosen = moduleChoiceProblem(whole, modules);
	if (unchosen) throw error(400, unchosen);
	const template = templateWithModules(whole, modules);
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
	const planned = refuseOnThrow('The rig cannot be fitted to this cut', () =>
		framePartsRequest(
			template,
			cut,
			JSON.parse(trackText) as TrackFrame,
			propPivots(labels.data, labels.width, cut),
			sources,
			drawnInto(whole, template),
		),
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
	const { fit, scale, origin, parts, order, foreshortened, face, merge } = planned.value;
	let res: Response;
	try {
		res = await fetch(`${base}/rig-from-frame/parts`, {
			method: 'POST',
			headers: { ...headers, 'content-type': 'application/json' },
			body: JSON.stringify({
				job,
				sheet,
				scale,
				origin,
				parts,
				order,
				...(merge ? { merge } : {}),
				fill: 'cpu',
				...(rig ? { replace: true, replace_etag: replaceEtag } : {}),
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
	if (out.manifestKey !== sheetManifestKey(clientKey, projectKey, sheet))
		throw error(502, 'The Atlas Maker service wrote the sheet somewhere unexpected.');
	return json({
		manifestKey: out.manifestKey,
		templateId: template.id,
		modules: offDefault(whole, modules),
		fit,
		fill: out.fill,
		parts: out.parts,
		foreshortened,
		face,
		frames,
	});
};
