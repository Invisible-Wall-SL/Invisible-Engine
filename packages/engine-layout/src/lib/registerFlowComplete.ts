/**
 * Flow-advance registry — the runtime sink the engine's feed-triggered capabilities
 * (`completeOnLoaded`) call to advance the active Flow screen, WITHOUT engine-layout
 * importing the game's Flow holder (the `declare ≠ implement` split). It is the
 * non-visual sibling of `registerBoundComponents`'s `TapToContinue` mount: where a TAP
 * routes through the game-registered `TapToContinue.svelte` (which imports the holder
 * directly), a feed edge has no visual surface to mount, so the game instead registers
 * its holder's two flow APIs here once at boot and `<ComponentInstance>` calls them.
 *
 * Module-scoped (private to whichever bundled copy of this package the game pulls in —
 * pnpm gives each game its own copy, so no cross-game leakage) and Svelte-free, so this
 * module is re-exported from the bare `engine-layout` (type-only) entry. UNREGISTERED by
 * default ⇒ `completeActiveScreen`/`emitFlowSignal` are `undefined` ⇒ a `completeOnLoaded`
 * instance's loaded edge is a safe no-op (parity), exactly like the tap holder helpers
 * returning false when no interpreter is active.
 */

/** The game's Flow holder APIs the engine calls to advance the active screen on a feed edge. */
export interface FlowComplete {
	/** Run the active screen's exit + fire its `complete` pin (the holder's `completeActiveScreen`). */
	completeActiveScreen(): void;
	/** Emit a named Flow signal (the holder's `emitFlowSignal`). */
	emitSignal(signal: string): void;
}

let registered: FlowComplete | undefined;

export function registerFlowComplete(flow: FlowComplete): void {
	registered = flow;
}

export function getFlowComplete(): FlowComplete | undefined {
	return registered;
}

export function clearFlowComplete(): void {
	registered = undefined;
}
