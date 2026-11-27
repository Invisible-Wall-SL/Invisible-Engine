import { error, json } from '@sveltejs/kit';
import type { RowType } from '$lib/profilerManageTypes';
import { jsonBody, requireTool } from '$lib/server/http';
import {
	countArchivable,
	deleteRows,
	MANAGE_IDS_MAX,
	setArchived,
	type Target,
} from '$lib/server/profiler/manage';
import { PROFILER_TOOL } from '$lib/server/profiler/origin';
import { requireProjectScope } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

const ACTIONS = ['archive', 'unarchive', 'delete', 'count'] as const;

function targetOf(body: Record<string, unknown>, type: RowType): Target {
	const target: Target = {};
	if (body.ids !== undefined) {
		if (
			!Array.isArray(body.ids) ||
			!body.ids.length ||
			body.ids.length > MANAGE_IDS_MAX ||
			!body.ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 64)
		) {
			throw error(400, `"ids" must be 1 to ${MANAGE_IDS_MAX} row ids.`);
		}
		target.ids = [...new Set(body.ids as string[])];
	}
	if (body.before !== undefined) {
		// An ISO date or time only: `new Date('12')` would read as a day in 2001.
		const iso =
			typeof body.before === 'string' &&
			/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/.test(body.before);
		const before = iso ? new Date(body.before as string) : null;
		if (!before || Number.isNaN(before.getTime())) {
			throw error(400, '"before" must be a date, like 2026-11-27.');
		}
		target.before = before;
	}
	if (body.perfBefore !== undefined) {
		if (
			type !== 'reading' ||
			typeof body.perfBefore !== 'number' ||
			!Number.isInteger(body.perfBefore) ||
			body.perfBefore < 1
		) {
			throw error(400, '"perfBefore" is a probe version, for readings only.');
		}
		target.perfBefore = body.perfBefore;
	}
	if (!target.ids && !target.before && target.perfBefore === undefined) {
		throw error(400, 'Name the rows: "ids", "before" or "perfBefore".');
	}
	return target;
}

/**
 * Archive, unarchive or delete readings or build records of a project — for whoever may open a
 * capture for it (the tool and the project: the same gate as `/api/profiler/sessions`):
 * `{ project, type: 'reading' | 'build', action, ids | before | perfBefore }`.
 *
 * - `archive` / `unarchive`: `ids`, or (archive) every live row older than `before` (a date) or, for
 *   readings, taken by a probe older than `perfBefore`. `{ done: [ids] }`.
 * - `count`: how many rows an archive of that target would take, for its confirm line.
 * - `delete`: `ids` only — the purge's own path (`profiler/manage.ts`). `{ done, refused: [{ id,
 *   reason }] }`: a row an open bug cites or a kept one is refused, with why.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireTool(locals, PROFILER_TOOL, 'Invisible Profiler');
	const body = await jsonBody(request);
	const { projectKey } = await requireProjectScope(
		user,
		typeof body.project === 'string' ? body.project : null,
	);
	const type = body.type === 'reading' || body.type === 'build' ? body.type : null;
	if (!type) throw error(400, '"type" is "reading" or "build".');
	const action = ACTIONS.find((a) => a === body.action);
	if (!action) throw error(400, `"action" is one of ${ACTIONS.join(', ')}.`);
	const target = targetOf(body, type);
	if (action === 'delete') {
		if (!target.ids || target.before || target.perfBefore !== undefined) {
			throw error(400, 'Delete names its rows by "ids" only.');
		}
		return json(await deleteRows(type, projectKey, target.ids));
	}
	if (action === 'count') {
		return json({ count: await countArchivable(type, projectKey, target) });
	}
	if (action === 'unarchive' && !target.ids) throw error(400, 'Unarchive names its rows by "ids".');
	return json({ done: await setArchived(type, projectKey, target, action === 'archive') });
};
