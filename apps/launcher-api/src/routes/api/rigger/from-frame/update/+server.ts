import { error, json } from '@sveltejs/kit';
import { frameSourceProblems, type FrameSourceDoc } from '$lib/rigFrameSource';
import { loadRegionSet } from '$lib/server/editorRegions';
import { jsonObjectOrNull } from '$lib/server/http';
import { refuseOnThrow } from '$lib/server/refuseOnThrow';
import { regionsToRigAtlas } from '$lib/server/rig';
import { JOB_ID } from '$lib/server/rigCutEdits';
import { frameSourceOf, updateFrameRig } from '$lib/server/rigFrameUpdate';
import {
	artRevision,
	cutFrames,
	readCut,
	regionAlphas,
	rigPartsSheets,
	sheetManifestKey,
} from '$lib/server/rigFrameSourceStore';
import { asIrigDocument, irigDocProblem } from '$lib/server/riggerIrig';
import { irigTarget, scopeMismatch } from '$lib/server/riggerIrigWrite';
import { requestFit } from '$lib/server/riggerNewRig';
import { templateFitProblem } from '$lib/server/rigTemplates';
import { rigTemplateForNewRig } from '$lib/server/rigTemplateStore';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 🔄 Update rig (docs/design/frame-to-rig.md §12 F2j): the parts of a re-edited cut, built as 🦴
 * Create rig builds them and merged into the rig the page has open (`updateFrameRig`). Writes
 * nothing: the page takes the answer as one undo step and saves it through `/api/rigger/save`,
 * whose `frameSource` points the bundle at the new sheet once the `.irig` is stored.
 *
 * Body `{ dir, stem, projectKey, job, manifestKey, templateId, fit, skeleton, source, keep? }`: the
 * sheet `/api/rigger/from-frame/sheet` just made for the rig (one of its two), the cut and fit it was
 * made from, the open rig and its `frame-source.json` as the page holds them (unsaved edits and all),
 * and the hand-edited parts whose mesh the author keeps. Answers the merged rig, its next
 * `frame-source.json`, the sheet as the page draws it (`atlas`) and what changed (`report`): parts
 * rebuilt, props added and removed (with what named them), hand-edited meshes (`canKeep` when the
 * part's drawing barely changed), deform keys dropped. Gated by `rigger`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});
	const body = await jsonObjectOrNull(request);
	if (!body) throw error(400, 'bad body');
	if (typeof body.projectKey === 'string' && body.projectKey !== projectKey)
		return scopeMismatch(body.projectKey, projectKey);
	const target = irigTarget(clientKey, projectKey, body.dir, body.stem);

	const manifestKey = typeof body.manifestKey === 'string' ? body.manifestKey : '';
	const own = rigPartsSheets(target.stem).map((s) => sheetManifestKey(clientKey, projectKey, s));
	if (!own.includes(manifestKey)) throw error(400, "That sheet is not one of this rig's.");
	const job = typeof body.job === 'string' && JOB_ID.test(body.job) ? body.job : '';
	if (!job) throw error(400, 'Bad job id.');

	const source = body.source;
	const problems = frameSourceProblems(source);
	if (problems.length) throw error(400, `The rig's frame source is unreadable: ${problems[0]}.`);
	const made = source as FrameSourceDoc;
	if (made.rig !== target.stem) throw error(400, "That frame source is another rig's.");

	const sent = body.skeleton;
	if (!isRecord(sent)) throw error(400, 'No rig was sent.');
	const current = asIrigDocument(sent) ?? sent;
	const unloadable = irigDocProblem(current);
	if (unloadable) throw error(422, `The open rig would not load: ${unloadable}.`);

	const templateId = typeof body.templateId === 'string' ? body.templateId : '';
	const template = await rigTemplateForNewRig(templateId);
	if (!template) throw error(404, `No rig template "${templateId}".`);
	const fit = requestFit(body.fit);
	if (!fit) throw error(400, 'No fit was sent.');
	const misfit = templateFitProblem(template, fit);
	if (misfit) throw error(400, `The fit does not fit the "${template.label}" template: ${misfit}.`);
	const read = await readCut(clientKey, projectKey, job);
	if (!read) throw error(404, 'That cut is gone: cut the frame again.');
	if (read.cut.template !== template.id) throw error(422, 'The cut was made for another template.');

	const keep = new Set(
		Array.isArray(body.keep) ? body.keep.filter((p): p is string => typeof p === 'string') : [],
	);
	const [after, before] = await Promise.all([loadRegionSet(manifestKey), loadRegionSet(made.art)]);
	if (!after.regions.length || !after.pageKey)
		throw error(404, 'The sheet the parts were made on is gone: run 🔄 Update rig again.');
	if (after.regions.some((r) => r.rotated))
		throw error(422, 'The sheet packs a part turned, which a frame-made rig never draws.');
	const edited = Object.keys(made.parts);
	const outlines = {
		before: await regionAlphas(before, edited),
		after: await regionAlphas(after, edited),
	};
	const result = refuseOnThrow('The rig cannot be updated from this cut', () =>
		updateFrameRig({
			template,
			regions: after.regions,
			fit,
			current,
			made,
			props: read.cut.props,
			keep,
			outlines,
		}),
	);
	const broken = irigDocProblem(result.doc);
	if (broken) throw error(500, `The updated rig would not load (${broken}); nothing was changed.`);
	const frames = await cutFrames(clientKey, projectKey, read.cut);
	const next = frameSourceOf({
		rig: target.stem,
		template: { id: template.id, version: template.version },
		cut: read.cut,
		cutEtag: read.etag,
		frames,
		parts: result.parts,
		art: manifestKey,
		artRevision: await artRevision(manifestKey),
	});
	const pageName = after.pageKey.slice(after.pageKey.lastIndexOf('/') + 1);
	return json({
		ok: true,
		skeleton: result.doc,
		source: next,
		report: result.report,
		frames,
		atlas: {
			text: regionsToRigAtlas(pageName, after.pageWidth, after.pageHeight, after.regions),
			page: `/api/editor/asset?key=${encodeURIComponent(after.pageKey)}&v=${encodeURIComponent(next.artRevision)}`,
		},
	});
};
