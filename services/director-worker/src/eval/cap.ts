import { costOfResponse, type DirectorPricing } from 'director-costs';
import { PartialResponse, type ModelTransport } from '../model.ts';
import { summarizeUsage, type Usage } from '../mockups/vision.ts';

/**
 * What every agent evaluation shares: the two sides, the money ledger, the errors that end a run
 * and the cap on a ModelTransport (the repair set's; the mockup set's own is `run.ts`'s
 * `capTransport`, over its vision transport, with the same rules).
 *
 * The cap is in code, from REAL usage (ADR-0007): every response the API returns is priced as it
 * arrives (`costOfResponse`, the spend ledger's arithmetic) and no call is made once the total
 * has reached the cap; the response that carries the total past it is the last, so the run
 * overshoots by at most one call.
 */

export type Side = 'before' | 'after';

export interface Ledger {
	calls: number;
	costUsd: number;
	usages: Usage[];
}

export const newLedgers = (): Record<Side, Ledger> => ({
	before: { calls: 0, costUsd: 0, usages: [] },
	after: { calls: 0, costUsd: 0, usages: [] },
});

/** The cap stopped the run: the message says where. */
export class EvalCapped extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'EvalCapped';
	}
}

/** The model could not be reached at all (no key, no client): no side made a call. */
export class ModelUnavailable extends Error {
	constructor(cause: unknown) {
		super(cause instanceof Error ? cause.message : String(cause));
		this.name = 'ModelUnavailable';
	}
}

/** An error's message as a report may carry it: one line, short, and nothing key-shaped. */
export function safeMessage(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error);
	return text
		.replace(/sk-ant-[\w-]+/g, '[redacted]')
		.replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 300);
}

/**
 * `model` behind the cap, one transport per side. The factory is called on the first call that
 * passes the cap, not before: a run the cap stops at once, or one that never calls, needs no key.
 * A call that fails after it began streaming is billed for what it produced (`PartialResponse`).
 */
export function capModel(
	model: () => ModelTransport,
	pricing: DirectorPricing,
	capUsd: number,
	ledgers: Record<Side, Ledger>,
): (side: Side) => ModelTransport {
	const spent = () => ledgers.before.costUsd + ledgers.after.costUsd;
	let inner: ModelTransport | null = null;
	return (side) => ({
		async send(request, signal) {
			const ledger = ledgers[side];
			if (spent() >= capUsd) {
				throw new EvalCapped(`stopped before call ${ledger.calls + 1} of side ${side}`);
			}
			if (!inner) {
				try {
					inner = model();
				} catch (error) {
					throw new ModelUnavailable(error);
				}
			}
			const bill = (response: Parameters<typeof costOfResponse>[0]) => {
				ledger.costUsd += costOfResponse(response, pricing).usd;
				ledger.calls++;
				ledger.usages.push(summarizeUsage(response.usage));
				if (spent() > capUsd) {
					throw new EvalCapped(`stopped after call ${ledger.calls} of side ${side}`);
				}
			};
			let answer;
			try {
				answer = await inner.send(request, signal);
			} catch (error) {
				if (error instanceof PartialResponse) bill(error.partial);
				throw error instanceof PartialResponse ? error.cause : error;
			}
			bill(answer);
			return answer;
		},
	});
}
