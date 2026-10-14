import type { LayoutDoc } from 'engine-layout';

/**
 * Who may flip an authored-overlay pilot switch (Rive plan Phase 8a): the Game Settings row is
 * enabled for holders of the component-publish capability, and the save enforces the same rule —
 * a save that changes `settings.authoredOverlays.transition` from a user without it is refused,
 * so the UI gate is not the only one. A save that leaves the switch as stored is anyone's.
 */
const transitionOn = (doc: Pick<LayoutDoc, 'settings'> | null | undefined): boolean =>
	doc?.settings?.authoredOverlays?.transition === true;

export function authoredOverlayChangeAllowed(args: {
	before: Pick<LayoutDoc, 'settings'> | null | undefined;
	after: Pick<LayoutDoc, 'settings'> | null | undefined;
	canPublish: boolean;
}): boolean {
	return args.canPublish || transitionOn(args.before) === transitionOn(args.after);
}
