import { error, json } from '@sveltejs/kit';
import {
	budgetRefusal,
	isBudgetKey,
	type BudgetKey,
	type BudgetThresholds,
} from '$lib/profilerBudgets';
import { jsonBody, requireTool } from '$lib/server/http';
import { resetBudget, setBudget, type BudgetExpected } from '$lib/server/profiler/budgets';
import { PROFILER_TOOL } from '$lib/server/profiler/origin';
import { requireProjectScope } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

const line = (v: unknown): number | null => {
	if (v === null || v === undefined || v === '') return null;
	if (typeof v !== 'number') throw error(400, 'A threshold must be a number or null.');
	return v;
};

/**
 * Set or reset one budget line of a project (every role may — owner decision 2026-11-16):
 * `{ project, deviceClass, metric, phase, warn, fail, expected }` sets the override;
 * `{ …, reset: true, expected }` drops it, so the studio default applies again. `expected` is the
 * override's `rev` as the page last read it, or null for the studio default. A save made against
 * a line someone else has changed since answers 409 with `{ current }` — the line as it now is —
 * and changes nothing.
 */
export const PUT: RequestHandler = async ({ request, locals }) => {
	const user = await requireTool(locals, PROFILER_TOOL, 'Invisible Profiler');
	const body = await jsonBody(request);
	const key = { deviceClass: body.deviceClass, metric: body.metric, phase: body.phase ?? '' };
	if (!isBudgetKey(key)) throw error(400, 'No such budget line.');
	const budgetKey: BudgetKey = key;
	const expected = body.expected;
	if (expected !== null && !(typeof expected === 'number' && Number.isInteger(expected))) {
		throw error(400, 'Expected "expected": the line\'s rev, or null for the studio default.');
	}
	const { projectKey } = await requireProjectScope(
		user,
		typeof body.project === 'string' ? body.project : null,
	);
	let result;
	if (body.reset === true) {
		result = await resetBudget(projectKey, budgetKey, expected as BudgetExpected);
	} else {
		const t: BudgetThresholds = { warn: line(body.warn), fail: line(body.fail) };
		const refusal = budgetRefusal(budgetKey.metric, t);
		if (refusal) throw error(400, refusal);
		result = await setBudget(projectKey, budgetKey, t, expected as BudgetExpected, user.id);
	}
	if (!result.ok) {
		return json(
			{
				message: 'Someone else changed this budget line first — it now shows their value.',
				current: result.current,
			},
			{ status: 409 },
		);
	}
	return json({ override: result.override });
};
