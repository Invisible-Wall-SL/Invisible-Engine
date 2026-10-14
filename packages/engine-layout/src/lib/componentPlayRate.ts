/**
 * COMPONENT PLAY RATE (Rive plan Phase 8b): a per-component multiplier on the speed every placed
 * instance's timelines advance at — the authored twin of the rig `timeScale` ramp the coded big-win
 * walk applied while the player held to speed up. The game's conductor sets it; each instance's
 * `ComponentTimelinePlayer` reads it on every tick. Svelte-free and Pixi-free. Nothing set ⇒ 1 for
 * every component (parity).
 */

const rates = new Map<string, number>();

/** Set the play rate of every instance of `componentId`; 1 (or a non-finite / non-positive value) clears it. */
export function setComponentPlayRate(componentId: string, rate: number): void {
	if (!(rate > 0) || rate === 1) rates.delete(componentId);
	else rates.set(componentId, rate);
}

/** The play rate instances of `componentId` advance at — 1 unless the game set one. */
export function componentPlayRate(componentId: string): number {
	return rates.get(componentId) ?? 1;
}

/** Forget every rate (the gates). */
export function clearComponentPlayRates(): void {
	rates.clear();
}
