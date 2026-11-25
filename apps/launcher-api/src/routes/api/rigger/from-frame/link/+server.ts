import { error, json } from '@sveltejs/kit';
import { loadRegionSet } from '$lib/server/editorRegions';
import { jsonObjectOrNull } from '$lib/server/http';
import { refuseOnThrow } from '$lib/server/refuseOnThrow';
import {
	ConflictError,
	getObjectText,
	getObjectTextWithEtag,
	precondition,
	putObjectText,
} from '$lib/server/r2';
import { JOB_ID } from '$lib/server/rigCutEdits';
import type { StoredCut } from '$lib/server/rigFromFrame';
import { frameSourceOf, madeAttachments, madeParts } from '$lib/server/rigFrameUpdate';
import {
	artRevision,
	bundlePrefixOf,
	cutFrames,
	liveArtKey,
	readCut,
	storedFrameSource,
} from '$lib/server/rigFrameSourceStore';
import { irigTarget, pairMark, scopeMismatch, type IrigTarget } from '$lib/server/riggerIrigWrite';
import { parseRigFit, type RigFit } from '$lib/server/rigTemplateFit';
import { SHEET_SIDECAR } from '$lib/rigSheetMap';
import { RIG_TEMPLATE_SIDECAR, templateRig, type RigTemplate } from '$lib/server/rigTemplates';
import { rigTemplateForNewRig } from '$lib/server/rigTemplateStore';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

const GATE = {
	tool: 'rigger',
	forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
} as const;

type Found =
	| {
			ok: true;
			template: RigTemplate;
			fit: RigFit;
			art: string;
			cut: StoredCut;
			etag: string | null;
	  }
	| { ok: false; why: string; frameMade: boolean };

/**
 * The cut a rig made by 🦴 Create rig before rigs remembered it was cut from: its `template.json`
 * says it is a fitted template, its sheet's manifest names the cut that made it (`rig_from_frame`),
 * and that cut is still kept.
 */
async function findCut(clientKey: string, projectKey: string, target: IrigTarget): Promise<Found> {
	const bundle = bundlePrefixOf(target);
	let sidecar: { id?: unknown; fit?: unknown };
	try {
		sidecar = JSON.parse((await getObjectText(`${bundle}/${RIG_TEMPLATE_SIDECAR}`)) ?? '{}');
	} catch {
		return { ok: false, why: 'its template.json does not read', frameMade: false };
	}
	const parsed = sidecar.fit === undefined ? null : parseRigFit(sidecar.fit);
	// A rig mapped from an artist's sheet (🗺 From my sheet) is a fitted template too, made from no cut.
	const fromSheet = (await getObjectText(`${bundle}/${SHEET_SIDECAR}`)) !== null;
	if (!parsed || 'problem' in parsed || !parsed.fit.frame || fromSheet)
		return { ok: false, why: 'it was not made from a frame', frameMade: false };
	const template = typeof sidecar.id === 'string' ? await rigTemplateForNewRig(sidecar.id) : null;
	if (!template)
		return { ok: false, why: 'the template it was made from is gone', frameMade: true };
	const art = await liveArtKey(bundle);
	let job: unknown;
	try {
		job = art
			? (JSON.parse((await getObjectText(art)) ?? '{}') as { rig_from_frame?: { job?: unknown } })
					.rig_from_frame?.job
			: undefined;
	} catch {
		job = undefined;
	}
	if (typeof job !== 'string' || !JOB_ID.test(job))
		return {
			ok: false,
			why: 'its sheet names no cut (it was made again, or by hand)',
			frameMade: true,
		};
	const read = await readCut(clientKey, projectKey, job);
	if (!read)
		return { ok: false, why: 'the cut it was made from is no longer kept', frameMade: true };
	if (read.cut.template !== template.id)
		return {
			ok: false,
			why: 'the cut its sheet names was made for another template',
			frameMade: true,
		};
	return { ok: true, template, fit: parsed.fit, art, cut: read.cut, etag: read.etag };
}

/**
 * ✂ Edit cut on a rig made before rigs remembered their cut (frame-to-rig §12 F2j): GET
 * `?dir=&stem=` → `{ found: { job, clip, frame } }` when its cut can be found, else
 * `{ found: null, why, frameMade }` (false for a rig not made from a frame); `linked: true` when the rig already remembers its cut. Gated by `rigger`.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);
	const target = irigTarget(
		clientKey,
		projectKey,
		url.searchParams.get('dir') ?? '',
		url.searchParams.get('stem') ?? '',
	);
	if ((await storedFrameSource(target)).read) return json({ linked: true, found: null });
	const found = await findCut(clientKey, projectKey, target);
	return json(
		found.ok
			? {
					found: {
						job: found.cut.job,
						clip: found.cut.clip?.id ?? null,
						frame: found.cut.clip?.frame ?? null,
					},
				}
			: { found: null, why: found.why, frameMade: found.frameMade },
	);
};

/**
 * 🔗 Find the cut: link the rig to the cut found above, writing its `frame-source.json` (only if it
 * has none, marked with the stored `.irig`). Each part's hash is today's build of it from its
 * `template.json` fit and its sheet, so a mesh the author edited since reads as edited (and every
 * mesh does, for a rig made by an older build). Body `{ dir, stem, projectKey }` → `{ ok, doc, etag }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, GATE);
	const body = await jsonObjectOrNull(request);
	if (!body) throw error(400, 'bad body');
	if (typeof body.projectKey === 'string' && body.projectKey !== projectKey)
		return scopeMismatch(body.projectKey, projectKey);
	const target = irigTarget(clientKey, projectKey, body.dir, body.stem);
	const found = await findCut(clientKey, projectKey, target);
	if (!found.ok) throw error(404, `Its cut cannot be found: ${found.why}.`);
	const irig = await getObjectTextWithEtag(target.key);
	if (!irig) throw error(404, `There is no rig "${target.stem}".`);
	const regions = (await loadRegionSet(found.art)).regions;
	const built = refuseOnThrow(
		'The rig cannot be built again from its cut',
		() => templateRig(found.template, regions, found.fit).skeleton,
	);
	const doc = {
		...frameSourceOf({
			rig: target.stem,
			template: { id: found.template.id, version: found.template.version },
			cut: found.cut,
			cutEtag: found.etag,
			frames: await cutFrames(clientKey, projectKey, found.cut),
			parts: madeParts(
				built,
				madeAttachments(built).map((a) => a.name),
			),
			art: found.art,
			artRevision: await artRevision(found.art),
			linked: true,
		}),
		irig: pairMark(irig.text),
	};
	try {
		const etag = await putObjectText(
			target.sidecarKeys.frame,
			JSON.stringify(doc),
			'application/json',
			precondition(null),
		);
		return json({ ok: true, doc, etag });
	} catch (e) {
		if (e instanceof ConflictError)
			return json(
				{
					ok: false,
					error: 'conflict',
					message: 'The rig was linked to its cut meanwhile: reload it.',
				},
				{ status: 409 },
			);
		throw e;
	}
};
