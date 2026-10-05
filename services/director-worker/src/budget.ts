import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { DirectorPricing } from 'director-costs';

/**
 * The budget cap (ADR-0006): before every model call and every GPU submit, a run whose spend plus
 * the projected cost of that next step reaches its cap pauses instead. Pure, so the projection is
 * fixture-tested.
 *
 * The input side errs high: every token is priced uncached, at about 4 characters a token over the
 * whole request. The output side is the largest reply this agent has produced in the run so far,
 * or `DEFAULT_OUTPUT_TOKENS` before its first call — a typical turn, not the worst case. So one
 * reply longer than any before it can carry the run past its cap by the difference, at most
 * `max_tokens` minus that figure (about $1 on Opus). Projecting every call at `max_tokens` would
 * stop a small-cap run before its first call.
 */

export const DEFAULT_OUTPUT_TOKENS = 8_000;
const CHARS_PER_TOKEN = 4;

/** Projected USD of sending `request`, given the most output this agent has produced so far. */
export function projectCall(
	request: BetaMessageStreamParams,
	pricing: DirectorPricing,
	maxOutputSoFar: number | undefined,
): number {
	const rate = Object.hasOwn(pricing.perMTok, request.model)
		? pricing.perMTok[request.model]
		: undefined;
	if (!rate) throw new Error(`pricing: no price for model "${request.model}"`);
	const inputTokens = Math.ceil(JSON.stringify(request).length / CHARS_PER_TOKEN);
	const outputTokens = Math.min(request.max_tokens, maxOutputSoFar || DEFAULT_OUTPUT_TOKENS);
	return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

/**
 * Projected USD of `renders` GPU renders whose cost has not landed — the ones queued and not yet
 * billed, plus any about to be submitted — each at the run's mean billed render so far. A render
 * is billed only at its `job_done`, so without this a run at its cap could keep calling the model,
 * and submitting, while its renders' cost was still to come. Before the first billed render there
 * is no figure to project from, so it projects nothing (measured profiles come with the pilot).
 */
export const projectQueuedGpu = (renders: number, meanRunpodJobUsd: number | null): number =>
	Math.max(0, renders) * (meanRunpodJobUsd ?? 0);

/** Whether a step costing `projectedUsd` must not run. */
export const overCap = (spentUsd: number, projectedUsd: number, capUsd: number): boolean =>
	spentUsd + projectedUsd >= capUsd;
