/**
 * The worker's client for the launcher's adapter gate (ADR-0002):
 *
 *   POST {launcherUrl}/api/director/adapter/<tool>/<op>
 *     Authorization: Bearer <DIRECTOR_SERVICE_TOKEN>
 *     { runId, agent, opId?, input }
 *
 * `agent` is set by the worker from the definition it runs (or `worker` for its own code), never
 * from model output — the gate's allow-lists rely on that. A write names an `opId`
 * (`<runId>:<step>:<seq>`); replaying one returns the stored result, and reusing one with a
 * different input is a 409 the gate refuses, so a retry of the same step keeps its opId and a new
 * attempt takes a new one.
 */

export interface AdapterClient {
	call<T>(tool: string, op: string, input: unknown, opts?: { opId?: string }): Promise<T>;
}

/** A non-2xx answer from the gate, with its `{ error, message }` body. */
export class AdapterCallError extends Error {
	readonly tool: string;
	readonly op: string;
	readonly status: number;
	readonly code: string;
	readonly body: unknown;
	constructor(
		tool: string,
		op: string,
		status: number,
		code: string,
		message: string,
		body: unknown,
	) {
		super(`${tool}.${op}: ${status} ${code}: ${message}`);
		this.name = 'AdapterCallError';
		this.tool = tool;
		this.op = op;
		this.status = status;
		this.code = code;
		this.body = body;
	}
}

export const opIdFor = (runId: string, step: string, seq: number) => `${runId}:${step}:${seq}`;

export function createAdapterClient(opts: {
	launcherUrl: string;
	token: string;
	runId: string;
	agent: string;
	fetchImpl?: typeof fetch;
}): AdapterClient {
	const doFetch = opts.fetchImpl ?? fetch;
	return {
		async call<T>(tool: string, op: string, input: unknown, callOpts?: { opId?: string }) {
			const res = await doFetch(`${opts.launcherUrl}/api/director/adapter/${tool}/${op}`, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${opts.token}`,
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					runId: opts.runId,
					agent: opts.agent,
					...(callOpts?.opId ? { opId: callOpts.opId } : {}),
					input,
				}),
			});
			let body: unknown = null;
			try {
				body = await res.json();
			} catch {
				body = null;
			}
			if (!res.ok) {
				const b = (body ?? {}) as { error?: unknown; message?: unknown };
				throw new AdapterCallError(
					tool,
					op,
					res.status,
					typeof b.error === 'string' ? b.error : 'http_error',
					typeof b.message === 'string' ? b.message : res.statusText,
					body,
				);
			}
			return body as T;
		},
	};
}
