import type { EventData } from './data';

/** One firing of a keyed event. */
export class Event {
	intValue = 0;
	floatValue = 0;
	stringValue: string | null = null;
	volume = 0;
	balance = 0;

	constructor(
		public time: number,
		public data: EventData,
	) {
		if (!data) throw new Error('data cannot be null.');
	}
}
