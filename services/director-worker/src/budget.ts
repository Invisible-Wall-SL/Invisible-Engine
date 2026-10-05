import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { DirectorPricing } from 'director-costs';

/**
 * The budget cap (ADR-0006): before every model call and every GPU submit, a run whose spend plus
 * the projected cost of that next step reaches its cap pauses instead. Pure, so the projection is
 * fixture-tested.
 *
 * The projection errs high, because pausing one call early costs the owner a click and passing the
 * cap costs money: every input token is priced uncached (about 4 characters a token over the whole
 * request), and the output is the largest this agent has produced in the run so far, or
 * `DEFAULT_OUTPUT_TOKENS` before its first call.
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

/** Whether a step costing `projectedUsd` must not run. A run with no cap is never stopped. */
export const overCap = (spentUsd: number, projectedUsd: number, capUsd: number | null): boolean =>
	capUsd !== null && spentUsd + projectedUsd >= capUsd;
