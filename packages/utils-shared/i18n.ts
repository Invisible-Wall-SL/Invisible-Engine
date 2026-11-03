import type { Messages } from '@lingui/core';

import type { Language } from 'state-shared';

export type MessagesMap = Record<Language, Messages>;

type Mergeable = Record<string, unknown> | unknown[];

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
	if (typeof value !== 'object' || value === null) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === null || proto === Object.prototype;
};

/** Lodash `merge`'s rules for the JSON a messages map is: arrays and plain objects merge key by key
 * (into a fresh container unless the target already holds one), an `undefined` source never
 * replaces a value, anything else overwrites. */
const deepMerge = <T extends Mergeable>(target: T, source: Mergeable): T => {
	const into = target as Record<string, unknown>;
	for (const [key, value] of Object.entries(source)) {
		const current = into[key];
		if (Array.isArray(value)) {
			into[key] = deepMerge(Array.isArray(current) ? current : [], value);
		} else if (isPlainObject(value)) {
			const keep = typeof current === 'object' && current !== null;
			into[key] = deepMerge(keep ? (current as Mergeable) : {}, value);
		} else if (value !== undefined || !(key in into)) {
			into[key] = value;
		}
	}
	return target;
};

export const mergeMessagesMaps = (messagesMapList: MessagesMap[]) => {
	const merged = messagesMapList
		.filter(Boolean)
		.reduce((acc, current) => deepMerge(acc, current), {} as MessagesMap);

	return merged;
};
