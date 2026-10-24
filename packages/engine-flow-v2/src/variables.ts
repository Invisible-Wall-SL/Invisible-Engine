/**
 * Invisible Flow v2 — the game-variable declarations (`docs/design/game-families.md` §3.1): where a
 * doc declares them, the pin type each reads as, the value a write may store, and the `var:<id>`
 * value-source name a component input binds to. A leaf: the deriver, the validator and the store
 * (`state.ts`) all read it.
 */

import type { FlowDoc, FlowVariable, TypeRef } from './types';

/** A declared variable, with the mode whose section declares it (absent ⇒ the doc's own). */
export interface FlowVariableDecl extends FlowVariable {
	mode?: string;
}

/** Every variable the doc declares: its own, then each mode's (tagged with that mode). */
export const docVariables = (doc: Pick<FlowDoc, 'variables' | 'modes'>): FlowVariableDecl[] => [
	...(doc.variables ?? []),
	...Object.entries(doc.modes ?? {}).flatMap(([mode, scope]) =>
		(scope?.variables ?? []).map((v) => ({ ...v, mode })),
	),
];

/** The pin type a variable reads and writes as. An `enum` variable is a string on the wire: its
 *  members are the doc's, not the template's, so there is no vocabulary enum to name. */
export const variableTypeRef = (variable: Pick<FlowVariable, 'type'>): TypeRef => {
	switch (variable.type) {
		case 'int':
			return { t: 'int' };
		case 'float':
			return { t: 'float' };
		case 'bool':
			return { t: 'bool' };
		case 'string':
		case 'enum':
			return { t: 'string' };
	}
};

/** `value` as a value of `variable`'s type, or `undefined` when it is not one. */
export const coerceVariableValue = (
	variable: Pick<FlowVariable, 'type' | 'values'>,
	value: unknown,
): number | boolean | string | undefined => {
	switch (variable.type) {
		case 'int':
			return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;
		case 'float':
			return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
		case 'bool':
			if (typeof value === 'boolean') return value;
			return value === 0 || value === 1 ? value === 1 : undefined;
		case 'string':
			return typeof value === 'string' ? value : undefined;
		case 'enum':
			return typeof value === 'string' && (variable.values ?? []).includes(value)
				? value
				: undefined;
	}
};

/** The value-source name a component input binds to read variable `id` (§3.1). */
export const VARIABLE_SOURCE_PREFIX = 'var:';
export const variableSourceName = (id: string): string => `${VARIABLE_SOURCE_PREFIX}${id}`;
/** The variable a `var:<id>` source name reads; `undefined` for any other name. */
export const variableOfSource = (source: string): string | undefined =>
	source.startsWith(VARIABLE_SOURCE_PREFIX) && source.length > VARIABLE_SOURCE_PREFIX.length
		? source.slice(VARIABLE_SOURCE_PREFIX.length)
		: undefined;
