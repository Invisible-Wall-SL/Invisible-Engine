import { isHttpError } from '@sveltejs/kit';
import { bugPath, bugRef } from '$lib/bugReports';
import { createDirectorBug } from '../../bugReports';
import { requireProjectScope } from '../../toolScope';
import { AdapterError, defineOp } from '../adapter';

/**
 * Invisible Pipeline Bug Reports adapter (ADR-0009 §2). The coordinator's
 * `run.request_pipeline_change` is a worker tool; the worker files its pipeline bug through this
 * op, as the coordinator, before it writes the activity line that names the bug. The bug is Open
 * and not sent: a triager decides whether it goes to Pipeline Changes. Bug Reports' own create
 * path writes it (`createDirectorBug`), so nothing else touches the bug tables.
 */

const MAX_TEXT = 2000;

export interface FiledBug {
	number: number;
	ref: string;
	path: string;
}

const filePipelineBug = defineOp<{ what: string; reason: string }, FiledBug>({
	tool: 'bugs',
	name: 'file_pipeline_bug',
	description:
		'File the pipeline bug a run asks for: Open, not sent to Pipeline Changes, reported by the run.',
	inputSchema: {
		type: 'object',
		properties: {
			what: { type: 'string', description: 'What is missing.', minLength: 1, maxLength: MAX_TEXT },
			reason: {
				type: 'string',
				description: 'Why the run needs it.',
				minLength: 1,
				maxLength: MAX_TEXT,
			},
		},
		required: ['what', 'reason'],
		additionalProperties: false,
	},
	agents: ['coordinator'],
	// The run's project may not exist yet (a request in the breakdown step): the bug names it only
	// when the owner can open it.
	scope: 'owner',
	write: true,
	recordsOnly: true,
	handler: async ({ run, owner }, input) => {
		if (!input.what.trim() || !input.reason.trim()) {
			throw new AdapterError(400, 'invalid_input', 'Say what is missing and why the run needs it.');
		}
		let projectKey: string | null = null;
		try {
			projectKey = (await requireProjectScope(owner, run.projectKey)).projectKey;
		} catch (e) {
			if (!isHttpError(e)) throw e;
		}
		const bug = await createDirectorBug({
			runId: run.id,
			ownerId: owner.id,
			projectKey,
			runProjectKey: run.projectKey,
			templateProjectKey: run.templateProjectKey,
			what: input.what,
			reason: input.reason,
		});
		return { number: bug.number, ref: bugRef(bug.number), path: bugPath(bug) };
	},
});

export const BUGS_OPS = [filePipelineBug];
