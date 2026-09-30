import {
	NEUTRAL_OPERATOR_SETTINGS,
	readPageOperatorSettings,
	type OperatorSettings,
} from 'delivery-profile';

/**
 * What the operator's embed page declared about this launch (`GameSettings.config`), typed.
 *
 * Neutral until {@link adoptOperatorSettings} runs, and neutral after it on every launch with no
 * embed page — which is every game we run ourselves. Each consumer reads its one field and does
 * nothing when that field is at its neutral value, so a launch that declares nothing behaves exactly
 * as it did before any of this existed. The contract per field: `docs/reference/play4fun-protocol.md`.
 */
export const stateOperator = $state<OperatorSettings>({ ...NEUTRAL_OPERATOR_SETTINGS });

/**
 * Adopt the page's declaration. Called once at boot, before the RGS answers, because the page is
 * there before the game is — and every field replaced, so a second call restates rather than merges.
 */
export const adoptOperatorSettings = (
	settings: OperatorSettings = readPageOperatorSettings(),
): void => {
	Object.assign(stateOperator, settings);
};
