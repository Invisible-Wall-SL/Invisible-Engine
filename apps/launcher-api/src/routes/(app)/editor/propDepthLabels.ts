import type { PropDepth } from 'engine-layout';

/** What each prop band is called in the editor (the Depth select, the Outline's band chip). */
export const PROP_DEPTH_LABELS: Record<PropDepth, string> = {
	water: 'On the water',
	behind: 'Behind characters',
	sorted: 'Sorted with characters',
	over: 'Over characters',
};

/** The Outline's short chip per band. */
export const PROP_DEPTH_CHIPS: Record<PropDepth, string> = {
	water: 'water',
	behind: 'behind',
	sorted: 'sorted',
	over: 'over',
};
