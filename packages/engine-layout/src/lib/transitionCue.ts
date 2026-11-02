import { isCustomElementFxKind, type CustomElementFxKind } from 'constants-shared/elementFx';
import { readScreenTransition, type ScreenTransitionSpec } from 'constants-shared/screenTransition';
import type { LayoutDoc } from './types';

/** The `transition` cue's screen transition (Invisible Shader Graph 8e), or `undefined` when the
 *  row is unset or names no transition kind. */
export const readTransitionCue = (
	doc: Pick<LayoutDoc, 'settings'>,
): ScreenTransitionSpec | undefined => readScreenTransition(doc.settings?.transitionCue);

/**
 * What the `transition` cue plays (Invisible Shader Graph 8e, `docs/design/shader-graph-screens.md`
 * §8), the ONE rule the game and the launcher's publish chip share:
 * - `off` — no row: the coded wipe.
 * - `screen` — the row's screen transition: the coded Transition is retired for the boot, so
 *   nothing else holds the cue.
 * - `unplayable` — the row names a custom kind that is not `registered` (its graph deleted, or one
 *   that does not compile): the wipe plays, as with no row; the chip warns.
 */
export type TransitionCueStatus = 'off' | 'screen' | 'unplayable';

export function transitionCueStatus(
	doc: Pick<LayoutDoc, 'settings'>,
	registered: (kind: CustomElementFxKind) => boolean,
): TransitionCueStatus {
	const cue = readTransitionCue(doc);
	if (!cue) return 'off';
	return isCustomElementFxKind(cue.kind) && !registered(cue.kind) ? 'unplayable' : 'screen';
}
