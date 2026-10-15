import type { LayoutDoc } from 'engine-layout';

/**
 * Who may flip an authored-overlay pilot switch (Rive plan Phase 8a / 8b): the Game Settings rows
 * are enabled for holders of the component-publish capability, and the save enforces the same
 * rule — a save that changes `settings.authoredOverlays.transition`, `.win` or `.freeSpins` (8c)
 * from a user without it is refused, so the UI gate is not the only one. A save that leaves every
 * switch as stored is anyone's.
 */
type Settings = Pick<LayoutDoc, 'settings'> | null | undefined;

const AUTHORED_OVERLAY_ROWS = ['transition', 'win', 'freeSpins'] as const;

const overlayOn = (doc: Settings, row: (typeof AUTHORED_OVERLAY_ROWS)[number]): boolean =>
	doc?.settings?.authoredOverlays?.[row] === true;

/** Whether `after` flips any pilot switch `before` has (an absent doc has every switch off). */
export const authoredOverlayFlipped = (before: Settings, after: Settings): boolean =>
	AUTHORED_OVERLAY_ROWS.some((row) => overlayOn(before, row) !== overlayOn(after, row));

/**
 * The Win pilot is locked OFF until its parity follow-up (held / turbo / escalation hand-off /
 * slam-small / the CI workflow) merges: no save, a publisher's included, may switch it ON. Switching
 * it off stays allowed. The follow-up deletes this and the Game Settings row's lock together.
 */
export const AUTHORED_WIN_LOCKED = true;

/** Whether `after` switches the Win pilot on where `before` had it off. */
export const winSwitchedOn = (before: Settings, after: Settings): boolean =>
	!overlayOn(before, 'win') && overlayOn(after, 'win');

/** Whether a submitted doc has the Win pilot on — the one case a publisher's save reads the store. */
export const submitsWinOn = (after: Settings): boolean =>
	AUTHORED_WIN_LOCKED && overlayOn(after, 'win');

/**
 * The free-spin pilot (Rive plan Phase 8c) is locked OFF until the owner pilots it: no save, a
 * publisher's included, may switch it ON; switching it off stays allowed. Lifted together with the
 * Game Settings row's lock.
 */
export const AUTHORED_FREE_SPINS_LOCKED = true;

/** Whether `after` switches the free-spin pilot on where `before` had it off. */
export const freeSpinsSwitchedOn = (before: Settings, after: Settings): boolean =>
	!overlayOn(before, 'freeSpins') && overlayOn(after, 'freeSpins');

/** Whether a submitted doc has the free-spin pilot on — a publisher's save then reads the store. */
export const submitsFreeSpinsOn = (after: Settings): boolean =>
	AUTHORED_FREE_SPINS_LOCKED && overlayOn(after, 'freeSpins');

/** A pilot locked OFF: no write may switch it on. */
export type LockedOverlay = 'win' | 'freeSpins';

/** The locked pilot `after` switches on where `before` had it off, if any (an absent doc: all off). */
export function lockedOverlaySwitchedOn(
	before: Settings,
	after: Settings,
): LockedOverlay | undefined {
	if (AUTHORED_WIN_LOCKED && winSwitchedOn(before, after)) return 'win';
	if (AUTHORED_FREE_SPINS_LOCKED && freeSpinsSwitchedOn(before, after)) return 'freeSpins';
	return undefined;
}

/** Whether a write has any locked pilot on — the only case a writer must read the stored doc. */
export const submitsLockedOverlayOn = (after: Settings): boolean =>
	submitsWinOn(after) || submitsFreeSpinsOn(after);

/**
 * Thrown by every layout-doc write (`editorStorage.saveDoc`, the scaffold, the file browser) that
 * would switch a locked pilot on: the editor save, a backup restore, Director, an import, a
 * migration or a raw upload all meet the same lock, not just the Game Settings row.
 */
export class AuthoredOverlayLockedError extends Error {
	constructor(readonly overlay: LockedOverlay) {
		super(
			overlay === 'win'
				? 'The authored Win pilot is locked off until its parity follow-up merges — it cannot be switched on yet.'
				: 'The authored free-spin intro / outro pilot is locked off until the owner pilots it — it cannot be switched on yet.',
		);
		this.name = 'AuthoredOverlayLockedError';
	}
}

/** Throw {@link AuthoredOverlayLockedError} when `after` switches a locked pilot on over `before`. */
export function assertNoLockedOverlaySwitchOn(before: Settings, after: Settings): void {
	const locked = lockedOverlaySwitchedOn(before, after);
	if (locked) throw new AuthoredOverlayLockedError(locked);
}

export function authoredOverlayChangeAllowed(args: {
	before: Settings;
	after: Settings;
	canPublish: boolean;
}): boolean {
	return args.canPublish || !authoredOverlayFlipped(args.before, args.after);
}

/**
 * Whether a conditional write would lose its CAS: the tab's `baseEtag` precondition
 * (`writeGuard.ts`: a string = "I loaded this version", `null` = "I believe there is no doc yet",
 * `undefined` = `force`, an unconditional overwrite) against the ETag stored right now (`null` =
 * no object). A `force` write is never stale.
 */
export const writeIsStale = (
	baseEtag: string | null | undefined,
	storedEtag: string | null,
): boolean => baseEtag !== undefined && baseEtag !== storedEtag;

export type AuthoredOverlaySaveDecision =
	'write' | 'conflict' | 'forbidden' | 'locked' | 'locked-free-spins';

/**
 * The editor save action's decision for a doc that may flip a pilot switch, in the order the
 * owner set: the ETag check FIRST — a stale tab gets the ordinary 409 conflict path whoever it is
 * and whatever it flips — and only a write that would NOT conflict (`force`, or the submitted base
 * ETag equals the stored one) can be refused for the flip (403, a non-publisher) — or, while
 * {@link AUTHORED_WIN_LOCKED}, for switching the Win pilot on (`locked`, anyone). Pure, so the gate
 * drives (stale, flip) × (publisher, non-publisher).
 */
export function authoredOverlaySaveDecision(args: {
	before: Settings;
	after: Settings;
	canPublish: boolean;
	baseEtag: string | null | undefined;
	storedEtag: string | null;
}): AuthoredOverlaySaveDecision {
	if (writeIsStale(args.baseEtag, args.storedEtag)) return 'conflict';
	const locked = lockedOverlaySwitchedOn(args.before, args.after);
	if (locked) return locked === 'win' ? 'locked' : 'locked-free-spins';
	return authoredOverlayChangeAllowed(args) ? 'write' : 'forbidden';
}
