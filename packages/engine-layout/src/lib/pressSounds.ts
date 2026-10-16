/**
 * PRESS SOUNDS (Rive plan Phase 8d): the one road a button press's feedback sound leaves the game.
 * The game's press bodies broadcast it through {@link handOffPressSound} first; an authored button
 * (`ComponentDef.buttonStates`) runs its press inside {@link claimPressSound}, so the sound the body
 * names reaches the button's own state machine instead — at the same point of the body, before the
 * press acts. Nothing claims ⇒ every body broadcasts exactly as before (parity).
 */

type PressSoundHandler = (sound: string) => boolean;

const claims: PressSoundHandler[] = [];

/** Run `press` with its press sound handed to `onSound` (which returns false to decline it). */
export function claimPressSound(onSound: PressSoundHandler, press: () => void): void {
	claims.push(onSound);
	try {
		press();
	} finally {
		claims.pop();
	}
}

/** True when a claimed press took `sound`; false ⇒ the caller broadcasts it itself. */
export function handOffPressSound(sound: string): boolean {
	const claim = claims.at(-1);
	return claim ? claim(sound) : false;
}
