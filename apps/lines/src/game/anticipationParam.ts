export type AnticipationConfidence = 'possible' | 'guaranteed';

/**
 * The `?anticipation=possible|guaranteed` test param, which arms the reel anticipation at boot as
 * the flow's `enableAnticipationMode` does; any other value arms nothing.
 */
export function anticipationParam(search: string): AnticipationConfidence | null {
	const value = new URLSearchParams(search).get('anticipation');
	return value === 'possible' || value === 'guaranteed' ? value : null;
}
