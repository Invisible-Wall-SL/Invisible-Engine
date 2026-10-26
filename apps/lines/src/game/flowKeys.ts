import type { FlowDoc } from 'engine-flow-v2';

/**
 * How a pressed key reaches a flow's key map (`FlowDoc.inputs`): shared by the Flow's `onInput`
 * listener (`flowV2Runtime.svelte.ts`) and the arcade characters' held actions (`arcade.ts`), so a
 * key steers a character exactly when it fires the same action in Flow.
 */

/** A letter matches either case, so Shift or Caps Lock (on the press or before the release) does
 *  not lose it; every other key name matches exactly. */
const sameKey = (mapped: string, key: string): boolean =>
	mapped.length === 1 ? mapped.toLowerCase() === key.toLowerCase() : mapped === key;

/** The actions key `key` (a `KeyboardEvent.key`) is mapped to. */
export const flowKeyActions = (inputs: FlowDoc['inputs'], key: string): string[] =>
	(inputs ?? []).filter((b) => b.keys.some((k) => sameKey(k, key))).map((b) => b.action);

/** A key typed into a text field is the field's, not the game's. */
export const typingInto = (target: EventTarget | null): boolean =>
	target instanceof HTMLElement &&
	(target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
