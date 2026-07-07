/**
 * Invisible Flow v2 — the strict type checker (schema §1, §9.1). A data edge is legal
 * only if the source type is `assignable` to the target type. "Assignable" here means
 * STRUCTURAL EQUALITY of the two `TypeRef`s, with exactly ONE sanctioned implicit
 * widening: `ms` ↔ `int` (`ms` IS an int; §9.1). Everything else is exact — widening a
 * `int`→`float` (or any struct/enum/list mismatch) requires an explicit `compute` node,
 * to honor "strict, report errors".
 */

import type { TypeRef } from './types';

/** True iff `a` and `b` are the same scalar family after collapsing `ms` into `int`
 *  (the §9.1 widening: `ms` is an int, so they are interchangeable). */
const sameScalar = (a: TypeRef['t'], b: TypeRef['t']): boolean => {
	const collapse = (t: TypeRef['t']): TypeRef['t'] => (t === 'ms' ? 'int' : t);
	return collapse(a) === collapse(b);
};

/**
 * Is a value of type `from` assignable to a pin of type `to`?
 *
 * Structural equality with the single `ms`↔`int` widening. Recurses into `list.of`;
 * matches `enum`/`struct` by declared name.
 */
export const assignable = (from: TypeRef, to: TypeRef): boolean => {
	// Lists: element types must themselves be assignable (invariant, structural).
	if (from.t === 'list' && to.t === 'list') return assignable(from.of, to.of);
	if (from.t === 'list' || to.t === 'list') return false;

	// Named nominal types: same kind AND same declared name.
	if (from.t === 'enum' && to.t === 'enum') return from.name === to.name;
	if (from.t === 'struct' && to.t === 'struct') return from.name === to.name;
	if (from.t === 'enum' || to.t === 'enum' || from.t === 'struct' || to.t === 'struct') {
		return false;
	}

	// Scalars: exact, except the sanctioned `ms`↔`int` widening.
	return sameScalar(from.t, to.t);
};
