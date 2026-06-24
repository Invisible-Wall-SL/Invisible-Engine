/**
 * Shared accessor text parser/printer (design doc §11.4 bounded accessors).
 *
 * The `/flow` inspectors author bounded {@link FlowAccessor}s as short prefixed strings
 * (`$trigger.x` / `$item.x` / `$context.x` / `$engine.x` / a bare literal). This logic was
 * DUPLICATED in `ChoreoNodeInspector.svelte` + `EdgeInspector.svelte`, so a new accessor
 * kind (`$context`) could land in one and not the other. Extracted here as PURE helpers
 * (Svelte-free, dependency-free) so BOTH inspectors — and any future one — stay in
 * lock-step on the recognised prefixes.
 *
 * Bounded by design: only the whitelisted prefixes resolve to a path/key accessor; ANY
 * other input is a literal (a number when numeric, else the raw string). This is NOT an
 * expression language (§11.4). Note the parse is fall-through-to-literal — a typo like
 * `$contxt.x` becomes a LITERAL STRING, not an error; `validateFlowDoc`'s
 * `unresolved-accessor` warning is the guard against that silent mis-resolution.
 */

import type { FlowAccessor } from './types';

/** The recognised accessor prefixes, advertised in inspector input placeholders. */
export const FLOW_ACCESSOR_HINT = '$trigger.x / $context.x / $engine.x / $item.x / literal';

/**
 * Parse an author string into a bounded {@link FlowAccessor}. The whitelisted prefixes
 * resolve to a path/key accessor; anything else is a literal (number when numeric, else
 * string). Fall-through-to-literal by design (§11.4) — guarded by validation, not an error.
 */
export const parseFlowAccessor = (text: string): FlowAccessor => {
	const t = text.trim();
	if (t.startsWith('$engine.')) return { kind: 'engine', key: t.slice('$engine.'.length) };
	if (t.startsWith('$trigger.')) return { kind: 'trigger', path: t.slice('$trigger.'.length) };
	if (t.startsWith('$context.')) return { kind: 'context', path: t.slice('$context.'.length) };
	if (t.startsWith('$item.')) return { kind: 'item', path: t.slice('$item.'.length) };
	const num = Number(t);
	return { kind: 'literal', value: t !== '' && !Number.isNaN(num) ? num : t };
};

/** Render a bounded {@link FlowAccessor} back to its author string (the inverse of parse). */
export const flowAccessorText = (a: FlowAccessor | undefined): string => {
	if (!a) return '';
	switch (a.kind) {
		case 'engine':
			return `$engine.${a.key}`;
		case 'trigger':
			return `$trigger.${a.path}`;
		case 'context':
			return `$context.${a.path}`;
		case 'item':
			return `$item.${a.path}`;
		case 'literal':
			return String(a.value);
	}
};
