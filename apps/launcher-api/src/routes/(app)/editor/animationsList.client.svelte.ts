/**
 * THE ANIMATIONS LIST (Rive plan Phase 9c): what the shown Timeline panel lists — its host's
 * timelines, the open one — published for the left column's Animations list. The panel owns the
 * timelines (their store, the open doc, unsaved edits), so every action calls back into it. Null
 * while no panel is shown (Design mode, or the other side of the editor).
 */

export interface AnimationRow {
	id: string;
	name: string;
	duration: number;
}

export interface AnimationsPanel {
	/** `screen` or `component`: the host the timelines animate, for the list's wording. */
	where: 'screen' | 'component';
	hostLabel: string;
	rows: AnimationRow[];
	openId: string | null;
	/** The open timeline has unsaved edits. */
	dirty: boolean;
	/** The list can create (a host is set). */
	canCreate: boolean;
	open(id: string): Promise<void>;
	create(): Promise<void>;
	duplicate(id: string): Promise<void>;
	rename(id: string): Promise<void>;
	remove(id: string): Promise<void>;
}

const state = $state<{ panel: AnimationsPanel | null; owner: symbol | null }>({
	panel: null,
	owner: null,
});

/** Publish (or with `null`, withdraw) `owner`'s list. One panel withdrawing never clears another's. */
export function setAnimationsPanel(panel: AnimationsPanel | null, owner: symbol): void {
	if (!panel && state.owner !== owner) return;
	state.panel = panel;
	state.owner = panel ? owner : null;
}

/** The shown panel's list, if any. */
export function animationsPanel(): AnimationsPanel | null {
	return state.panel;
}

/** The drag type a timeline row carries onto the state machine graph (its id). */
export const TIMELINE_DRAG_TYPE = 'application/x-iw-timeline';
