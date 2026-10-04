import { createHash, randomBytes } from 'node:crypto';
import { isHttpError } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { bearerToken } from '$lib/launcherGates';
import { getRoleOverrides } from '../roleToolAccess';
import { allowedPrefixes, isKeyAllowed, requireProjectScope } from '../toolScope';
import { tokensMatch } from '../tokensMatch';
import { getToolOverrides } from '../userToolAccess';
import { UNASSIGNED_CLIENT, projectPrefix, r2Slug } from '../projectPaths';
import { projectKeyTaken } from '../projects';
import { ConflictError, listObjects } from '../r2';
import {
	AdapterError,
	isDirectorAgent,
	schemaErrors,
	type AdapterContext,
	type AdapterOp,
} from './adapter';
import { refusedOp, refusedWriteTarget } from './refusals';
import { claimOp, completeOp, getRun, getRunOwner, releaseOp } from './store';

/**
 * The Invisible Director adapter gate (ADR-0002), behind `POST /api/director/adapter/<tool>/<op>`.
 * The worker calls it with `DIRECTOR_SERVICE_TOKEN`; no session is ever read. Every call, in order:
 *
 *  1. the service token (503 when unset, 401 when wrong);
 *  2. the hard refusals, matched on the op NAME before the registry is consulted (403 `refused`);
 *  3. the op exists (404), the body names a `runId` and an `agent`, and the agent is on the op's
 *     allow-list (403). The token holder declares the agent, so this holds only while the worker
 *     sets `agent` itself from the definition it runs, never from model output;
 *  4. the run exists and its owner is still an active account holding Invisible Director: the
 *     owner is who every call acts as (Q5);
 *  5. the input matches the op's schema (400);
 *  6. the op's project scope, checked against the OWNER's grants (403);
 *  7. for a write: an `opId` (`<runId>:<step>:<seq>`) claimed in `director_ops` — a replay returns
 *     the stored result without running again — then the write-target guard;
 *  8. the handler. A storage conflict comes back as 409 `{ error: 'conflict' }`.
 */

export interface AdapterCall {
	tool: string;
	op: string;
	authorization: string | null;
	body: unknown;
}

export interface AdapterAnswer {
	status: number;
	body: unknown;
	/** True when a write's stored result was returned instead of running it again. */
	replayed?: true;
}

const fail = (status: number, error: string, message: string, extra: object = {}) => ({
	status,
	body: { error, message, ...extra },
});

const OP_ID_TAIL = /^[a-z0-9_-]{1,64}:\d{1,9}$/;

interface CallBody {
	runId: string;
	agent: string;
	opId?: string;
	input: unknown;
}

function parseBody(body: unknown): CallBody | null {
	if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
	const b = body as Record<string, unknown>;
	if (typeof b.runId !== 'string' || !b.runId || typeof b.agent !== 'string') return null;
	if (b.opId !== undefined && typeof b.opId !== 'string') return null;
	return { runId: b.runId, agent: b.agent, opId: b.opId, input: b.input ?? {} };
}

/** The owner's access-checked scope for `project`, or `null` when they may not reach it. */
async function scopeFor(owner: AdapterContext['owner'], project: string) {
	try {
		return await requireProjectScope(owner, project);
	} catch (e) {
		if (isHttpError(e) && e.status === 403) return null;
		throw e;
	}
}

export async function runAdapterCall(
	call: AdapterCall,
	registry: ReadonlyMap<string, AdapterOp>,
	configuredToken: string,
): Promise<AdapterAnswer> {
	if (!configuredToken) {
		return fail(503, 'disabled', 'DIRECTOR_SERVICE_TOKEN is not set on the launcher.');
	}
	const presented = bearerToken(call.authorization);
	if (presented === undefined || !tokensMatch(presented, configuredToken)) {
		return fail(401, 'unauthorized', 'Unauthorized');
	}

	const refused = refusedOp(call.tool, call.op);
	if (refused) return fail(403, 'refused', refused.message, { refusal: refused.id });
	const op = registry.get(`${call.tool}.${call.op}`);
	if (!op) return fail(404, 'unknown_op', `No adapter ${call.tool}.${call.op}.`);

	const body = parseBody(call.body);
	if (!body) return fail(400, 'bad_request', 'The body needs a runId and an agent.');
	if (!isDirectorAgent(body.agent) || !op.agents.includes(body.agent)) {
		return fail(403, 'agent_not_allowed', `${body.agent} may not call ${call.tool}.${call.op}.`);
	}
	const agent = body.agent;

	const run = await getRun(body.runId);
	if (!run) return fail(404, 'unknown_run', `No Director run ${body.runId}.`);
	const owner = await getRunOwner(run.ownerUserId);
	const ownerHasDirector =
		owner !== null &&
		roleHasTool(
			owner.role,
			'director',
			await getRoleOverrides(owner.role),
			await getToolOverrides(owner.id),
		);
	if (!owner || !ownerHasDirector) {
		return fail(403, 'owner_not_allowed', "The run's owner can no longer use Invisible Director.");
	}

	const invalid = schemaErrors(op.inputSchema, body.input);
	if (invalid.length) return fail(400, 'invalid_input', invalid.join('; '), { details: invalid });
	const input = body.input as Record<string, unknown>;

	let scope: AdapterContext['scope'] = null;
	if (op.scope !== 'owner') {
		const project =
			op.scope === 'project'
				? run.projectKey
				: op.scope === 'template'
					? run.templateProjectKey
					: String(input.key);
		scope = await scopeFor(owner, project);
		if (!scope) {
			return fail(403, 'out_of_scope', `The run's owner cannot access the project "${project}".`);
		}
	}

	const ctx: AdapterContext = {
		run,
		owner,
		agent,
		scope,
		savedBy: {
			uid: owner.id,
			name: owner.name ?? owner.email,
			tool: 'director',
			agent,
			runId: run.id,
			at: new Date().toISOString(),
			rev: randomBytes(6).toString('hex'),
		},
	};
	if (!op.write) return execute(op, ctx, input);

	const tail = body.opId?.startsWith(`${run.id}:`) ? body.opId.slice(run.id.length + 1) : '';
	if (!OP_ID_TAIL.test(tail)) {
		return fail(400, 'bad_op_id', 'A write needs an opId of the form <runId>:<step>:<seq>.');
	}
	const opId = body.opId!;
	const opName = `${op.tool}.${op.name}`;
	const inputHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
	const claim = await claimOp({ opId, runId: run.id, agent, op: opName, inputHash });
	if (!claim.claimed) {
		const { existing } = claim;
		const same =
			existing.op === opName &&
			existing.agent === agent &&
			existing.runId === run.id &&
			existing.inputHash === inputHash;
		if (!same) {
			return fail(409, 'op_id_reused', `${opId} was already used for another call.`);
		}
		if (existing.status !== 'done') return fail(409, 'in_progress', `${opId} is still running.`);
		return { status: 200, body: existing.result, replayed: true };
	}

	let answer: AdapterAnswer;
	try {
		answer = (await refusedWrite(op, scope, run, input)) ?? (await execute(op, ctx, input));
	} catch (e) {
		await releaseOp(opId);
		throw e;
	}
	if (answer.status === 200) await completeOp(opId, answer.body);
	else await releaseOp(opId);
	return answer;
}

/** The write-target guard: why this write may not run, or `null` when it may. */
async function refusedWrite(
	op: AdapterOp,
	scope: AdapterContext['scope'],
	run: AdapterContext['run'],
	input: Record<string, unknown>,
): Promise<AdapterAnswer | null> {
	if (!op.write) return null;
	if ('createsProject' in op) {
		// A run that already started creating its project resumes it (the op handles that).
		if (run.projectCreateStartedAt) return null;
		// "Nothing to overwrite" must hold in R2 too: keys are slugged (`a-b` and `a_b` share a tree),
		// so a free DB key is not enough.
		const roots = [
			`${projectPrefix(run.clientKey ?? UNASSIGNED_CLIENT, run.projectKey)}/`,
			`editor/${r2Slug(run.projectKey)}/`,
		];
		const occupied = await Promise.all(
			roots.map(async (p) => (await listObjects(p, 1)).keys.length),
		);
		if (!(await projectKeyTaken(run.projectKey)) && occupied.every((n) => n === 0)) return null;
		return fail(409, 'project_exists', `The project "${run.projectKey}" already exists.`);
	}
	const prefixes = allowedPrefixes(scope!.clientKey, scope!.projectKey);
	for (const key of op.writes(input, scope!)) {
		const refused = refusedWriteTarget(key);
		if (refused) return fail(403, 'refused', refused.message, { refusal: refused.id, key });
		if (!isKeyAllowed(key, prefixes)) {
			return fail(403, 'out_of_scope', `${key} is outside the run's project.`, { key });
		}
	}
	return null;
}

async function execute(
	op: AdapterOp,
	ctx: AdapterContext,
	input: Record<string, unknown>,
): Promise<AdapterAnswer> {
	try {
		return { status: 200, body: await op.handler(ctx, input) };
	} catch (e) {
		if (e instanceof ConflictError) {
			return fail(409, 'conflict', 'Someone saved this since it was read. Re-read and retry.', {
				key: e.key,
			});
		}
		if (e instanceof AdapterError) return fail(e.status, e.code, e.message);
		throw e;
	}
}
