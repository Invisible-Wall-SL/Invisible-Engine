/**
 * One visit of a symbol state, holding its beat for the state's Element FX (Invisible Symbols State
 * Machine → a state's Element FX): the beat (`oncomplete`) is reported once the state's art has
 * completed AND its `enter` effects that end have played out.
 *
 * Without it a Land that shakes was never seen: the reel board moves a symbol back to `static` the
 * moment its land art completes, and a still picture completes on its first frame, so the shake was
 * ended as it started. The same cut a melt on `explosion` and a glow on `win`, whose beats the board
 * awaits. Every beat that waits on `oncomplete` keeps its own cap, so an effect can hold one no
 * longer than art could.
 *
 * A state with no art of its OWN (`ownArt` false: it borrows another state's, or has none) may never
 * report — the borrowed picture is already on screen, so nothing re-mounts to say it is done — and
 * its effects alone pace the beat. An art completion while the effects play is held and reported
 * once they end; after that, completions pass straight through, as they do for a state with no
 * effects to wait for.
 */
export interface StateFxGate {
	/** The state's art reported completion. */
	art(): void;
	/** The state's ending `enter` effects have played out. */
	fx(): void;
}

export function stateFxGate(waitsForFx: boolean, ownArt: boolean, report: () => void): StateFxGate {
	let artDone = waitsForFx && !ownArt;
	let fxDone = !waitsForFx;
	return {
		art() {
			artDone = true;
			if (fxDone) report();
		},
		fx() {
			if (fxDone) return;
			fxDone = true;
			if (artDone) report();
		},
	};
}
