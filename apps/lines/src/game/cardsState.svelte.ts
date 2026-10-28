import { initialCardDriverState } from 'engine-game';

/** What the card table draws from (`cards.ts`): the driver's state, plus the card being dragged or
 *  picked by a tap. */
export const stateCards = $state({
	...initialCardDriverState(),
	/** The card being dragged or picked by a tap, by uid; 0 for none. */
	picked: 0,
	seed: '',
});
