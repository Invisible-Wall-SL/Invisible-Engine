import { isHttpError } from '@sveltejs/kit';
import { bugPath, bugRef } from '$lib/bugReports';
import { MAX_DIRECTOR_BUGS, createDirectorBug } from '../../bugReports';
import { requireProjectScope } from '../../toolScope';
import { AdapterError, defineOp, type AdapterContext } from '../adapter';

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

/** `project` when the owner can open it, else null; any other failure is not a refusal. */
async function openable(owner: AdapterContext['owner'], project: string): Promise<string | null> {
	try {
		return (await requireProjectScope(owner, project)).projectKey;
	} catch (e) {
		if (isHttpError(e) && (e.status === 403 || e.status === 404)) return null;
		throw e;
	}
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
	// The run's project may not exist yet (a request in the breakdown step), so the op is not
	// scoped to it: the bug names the run's project, else its template, only when the owner can open
	// it, and otherwise names no project at all.
	scope: 'owner',
	write: true,
	recordsOnly: true,
	handler: async ({ run, owner, opId }, input) => {
		if (!input.what.trim() || !input.reason.trim()) {
			throw new AdapterError(400, 'invalid_input', 'Say what is missing and why the run needs it.');
		}
		const projectKey =
			(await openable(owner, run.projectKey)) ?? (await openable(owner, run.templateProjectKey));
		const answer = await createDirectorBug({
			runId: run.id,
			opId: opId!,
			ownerId: owner.id,
			projectKey,
			runProjectKey: run.projectKey,
			templateProjectKey: run.templateProjectKey,
			what: input.what,
			reason: input.reason,
		});
		if ('refused' in answer) {
			throw answer.refused === 'cap'
				? new AdapterError(
						409,
						'too_many_bugs',
						`This run has filed ${MAX_DIRECTOR_BUGS} pipeline bugs, the most one run may. Ask the owner instead.`,
					)
				: new AdapterError(
						409,
						'duplicate',
						`${bugRef(answer.number)} already asks for this and is still open. Do not file it again.`,
					);
		}
		const bug = answer.filed;
		return { number: bug.number, ref: bugRef(bug.number), path: bugPath(bug) };
	},
});

export const BUGS_OPS = [filePipelineBug];
