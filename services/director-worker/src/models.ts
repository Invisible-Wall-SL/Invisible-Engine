/**
 * The models an agent definition may run on: `model.ts` has a request profile for exactly these,
 * and the worker refuses to boot with a definition naming any other — including one `pricing.json`
 * prices only for the refusal fallback. Plain data with no imports, so the launcher's Agents tab
 * (PLAN 5.4) applies the same list before a definition change is opened.
 */
export const RUNNABLE_MODELS = [
	'claude-opus-5-5',
	'claude-sonnet-5-5',
	'claude-haiku-4-5-20251001',
] as const;
export type RunnableModel = (typeof RUNNABLE_MODELS)[number];
