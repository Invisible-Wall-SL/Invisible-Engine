import type { Launcher } from './launcher.ts';

/**
 * The adapter gate as the worker's own code calls it (ADR-0002), over the same `Launcher` the turn
 * loop uses: one op by `<tool>.<op>`, the run and the agent declared by the worker (never by model
 * output), and a non-2xx answer raised as an error that carries the gate's `{ error, message }`.
 *
 * A write names an `opId` (`<runId>:<step>:<seq>`); replaying one returns the stored result, and
 * reusing one with a different input is a 409 the gate refuses, so a retry of the same step keeps
 * its opId and a new attempt takes a new one.
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

export function adapterClient(
	launcher: Launcher,
	run: { runId: string; agent: string },
	signal: AbortSignal = new AbortController().signal,
): AdapterClient {
	return {
		async call<T>(tool: string, op: string, input: unknown, opts?: { opId?: string }) {
			const res = await launcher.call(
				`${tool}.${op}`,
				{
					runId: run.runId,
					agent: run.agent,
					...(opts?.opId ? { opId: opts.opId } : {}),
					input,
				},
				signal,
			);
			if (res.status < 200 || res.status >= 300) {
				const b = (res.body ?? {}) as { error?: unknown; message?: unknown };
				throw new AdapterCallError(
					tool,
					op,
					res.status,
					typeof b.error === 'string' ? b.error : 'http_error',
					typeof b.message === 'string' ? b.message : `The adapter answered ${res.status}.`,
					res.body,
				);
			}
			return res.body as T;
		},
	};
}
