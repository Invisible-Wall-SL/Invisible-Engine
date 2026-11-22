import { error, json } from '@sveltejs/kit';
import { jsonObjectOrNull } from '$lib/server/http';
import {
	ConflictError,
	getObjectBytes,
	getObjectTextWithEtag,
	putObjectBytes,
	putObjectText,
} from '$lib/server/r2';
import {
	JOB_ID,
	applyCutEdits,
	checkedLabels,
	jobRoot,
	labelCounts,
	rawLabels,
	type StoredCut,
} from '$lib/server/rigFromFrame';
import { rigTemplateForNewRig } from '$lib/server/rigTemplateStore';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

const MAX_LABELS_BYTES = 4_000_000;

/**
 * Keep the author's touch-ups to a cut (frame to rig F1, the prop editor and per-part frames):
 * the brushed or lassoed label map (a patch moved to another part or prop), the props — each
 * one's ✓ / ✗, whether it rides, swings or comes off and the bone it hangs from, props added and
 * removed (`names`: the cut's parts, then its props) — and, per part, the kept cut of another frame
 * it is taken from (`sources`). Body `{ job, etag, labels?, names?, props?, sources? }`: `labels` a
 * PNG data URL whose red channel is each pixel's index in the names, `etag` the `cut.json` the page
 * read — a cut re-run or saved elsewhere since is a 409. Nothing is cut again. A prop left ✗ keeps
 * its pixels and is drawn as part of its host. Gated by `rigger`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});
	const body = await jsonObjectOrNull(request);
	if (!body) throw error(400, 'bad body');
	const job = typeof body.job === 'string' && JOB_ID.test(body.job) ? body.job : '';
	if (!job) throw error(400, 'Bad job id.');
	const root = jobRoot(clientKey, projectKey, job);
	const read = await getObjectTextWithEtag(`${root}/cut.json`);
	if (!read) throw error(404, 'That cut is gone.');
	if (typeof body.etag !== 'string' || body.etag !== read.etag)
		return json(
			{ error: 'The cut changed since it was opened (re-cut or saved elsewhere).' },
			{ status: 409 },
		);
	const cut = JSON.parse(read.text) as StoredCut;
	const template = await rigTemplateForNewRig(cut.template);
	if (!template) throw error(404, `The cut's template "${cut.template}" is gone.`);
	const applied = applyCutEdits(cut, body, template, typeof body.labels === 'string');
	if (!applied.ok) throw error(applied.status, applied.message);
	const next = applied.value.cut;
	for (const other of applied.value.jobs) {
		const theirs = await getObjectTextWithEtag(`${jobRoot(clientKey, projectKey, other)}/cut.json`);
		const them = theirs ? (JSON.parse(theirs.text) as StoredCut) : null;
		const part = Object.entries(next.sources ?? {}).find(([, j]) => j === other)?.[0] ?? '';
		if (!them || them.template !== cut.template || !them.names.includes(part))
			throw error(400, `The cut ${part} is taken from is gone, or has no ${part}.`);
		if (cut.clip && them.clip && them.clip.id !== cut.clip.id)
			throw error(400, 'A part is taken from a frame of the same clip.');
	}

	if (typeof body.labels === 'string') {
		const m = /^data:image\/png;base64,(.+)$/.exec(body.labels);
		if (!m) throw error(400, 'The label map is not a PNG.');
		const png = Buffer.from(m[1], 'base64');
		if (png.length > MAX_LABELS_BYTES) throw error(413, 'The label map is too large.');
		const before = await getObjectBytes(`${root}/labels.png`);
		if (!before) throw error(404, 'That cut has no label map.');
		const checked = await checkedLabels(png, before.body, next.names.length);
		if (!checked.ok) throw error(checked.status, checked.message);
		// Each part's and prop's size as the map now draws it.
		const counts = labelCounts((await rawLabels(checked.value)).data, next.names.length);
		for (const p of [...next.parts, ...next.props]) p.px = counts[next.names.indexOf(p.name)];
		try {
			await putObjectBytes(`${root}/labels.png`, checked.value, 'image/png', {
				ifMatch: before.etag ?? '',
			});
		} catch (e) {
			if (e instanceof ConflictError)
				return json({ error: 'The cut was re-run while saving.' }, { status: 409 });
			throw e;
		}
	}
	next.edited = new Date().toISOString();
	try {
		const etag = await putObjectText(
			`${root}/cut.json`,
			JSON.stringify(next, null, 1),
			'application/json',
			{
				ifMatch: read.etag ?? '',
			},
		);
		return json({
			ok: true,
			etag,
			names: next.names,
			parts: next.parts,
			props: next.props,
			sources: next.sources ?? {},
		});
	} catch (e) {
		if (e instanceof ConflictError)
			return json(
				{ error: 'The cut changed while saving (re-cut or saved elsewhere).' },
				{ status: 409 },
			);
		throw e;
	}
};
