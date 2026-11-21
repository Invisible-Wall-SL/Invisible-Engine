import { error, json } from '@sveltejs/kit';
import { jsonObjectOrNull } from '$lib/server/http';
import {
	ConflictError,
	getObjectBytes,
	getObjectTextWithEtag,
	putObjectBytes,
	putObjectText,
} from '$lib/server/r2';
import { JOB_ID, checkedLabels, jobRoot } from '$lib/server/rigFromFrame';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

const MOTIONS = ['rides', 'swings', 'off'] as const;
const MAX_LABELS_BYTES = 4_000_000;

interface CutProp {
	name: string;
	take?: boolean;
	motion?: (typeof MOTIONS)[number];
}

/**
 * Keep the author's touch-ups to a cut (frame to rig F1): the brushed label map (a patch moved to
 * another part) and each prop's ✓ / ✗ and whether it rides, swings or comes off. Body `{ job,
 * etag, labels?, props? }`: `labels` a PNG data URL whose red channel is each pixel's part index,
 * `etag` the `cut.json` the page read — a cut re-run or saved elsewhere since is a 409. A prop
 * left ✗ keeps its pixels and is drawn as part of its host. Gated by `rigger`.
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
	const cut = JSON.parse(read.text) as { names: string[]; props: CutProp[]; edited?: string };

	if (typeof body.labels === 'string') {
		const m = /^data:image\/png;base64,(.+)$/.exec(body.labels);
		if (!m) throw error(400, 'The label map is not a PNG.');
		const png = Buffer.from(m[1], 'base64');
		if (png.length > MAX_LABELS_BYTES) throw error(413, 'The label map is too large.');
		const before = await getObjectBytes(`${root}/labels.png`);
		if (!before) throw error(404, 'That cut has no label map.');
		const checked = await checkedLabels(png, before.body, cut.names.length);
		if (!checked.ok) throw error(checked.status, checked.message);
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
	if (Array.isArray(body.props)) {
		for (const p of body.props as CutProp[]) {
			const mine = cut.props.find((x) => x.name === p?.name);
			if (!mine) throw error(400, `The cut has no prop ${String(p?.name)}.`);
			if (typeof p.take === 'boolean') mine.take = p.take;
			if (p.motion !== undefined) {
				if (!MOTIONS.includes(p.motion)) throw error(400, 'A prop rides, swings or comes off.');
				mine.motion = p.motion;
			}
		}
	}
	cut.edited = new Date().toISOString();
	try {
		const etag = await putObjectText(
			`${root}/cut.json`,
			JSON.stringify(cut, null, 1),
			'application/json',
			{
				ifMatch: read.etag ?? '',
			},
		);
		return json({ ok: true, etag, props: cut.props });
	} catch (e) {
		if (e instanceof ConflictError)
			return json(
				{ error: 'The cut changed while saving (re-cut or saved elsewhere).' },
				{ status: 409 },
			);
		throw e;
	}
};
