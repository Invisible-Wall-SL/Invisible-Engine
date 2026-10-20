import type { KeyState, KeyedChannel, StageTransformDelta } from '$lib/timeline/screenTimeline';

/**
 * ANIMATE KEYING (Rive plan Phase 9b): what the active Timeline panel offers to key on the node the
 * canvas has selected, published for Properties (its key buttons) and the canvas (stage-drag
 * keying). The panel owns the timeline, so it owns every write: Properties and the canvas only call
 * back into it. Null outside Animate, or while no panel is active ⇒ Properties shows the Design
 * pose only, and the canvas stays select-only.
 */

/** One keyable field: a node channel, or a placed effect's `fx:<id>` parameter. */
export interface KeyField {
	channel: string;
	label: string;
	/** `node`: a {@link KeyedChannel}, shown composited on the Design pose. `fx`: the value itself. */
	kind: 'node' | 'fx';
	/** The raw channel value at the playhead (relative for a node channel). */
	value: number;
	state: KeyState;
	/** An `fx:` on/off parameter: a checkbox keyed 0 / 1 on hold keys. */
	bool?: boolean;
	min?: number;
	max?: number;
	note?: string;
}

export interface KeyingPanel {
	/** The node the fields are for. */
	nodeId: string;
	/** Why it cannot be keyed (no open timeline, an unnamed or shared name); `fields` is then empty. */
	message?: string;
	/** The node's actor target (its name). */
	target?: string;
	/** Playhead seconds, for the buttons' titles. */
	time: number;
	/** A timeline is open, so a stage drag can key (whatever the selected node's own message). */
	timelineOpen: boolean;
	fields: KeyField[];
	/** Key `channel` at the playhead to `value` (raw), or its current value. */
	key(channel: string, value?: number): void;
	/** Key what a stage drag changed, on each node it moved. Returns how many nodes got keys. */
	keyStage(deltas: StageTransformDelta[]): number;
}

const state = $state<{ panel: KeyingPanel | null; owner: symbol | null; dragging: boolean }>({
	panel: null,
	owner: null,
	dragging: false,
});

/**
 * An Animate stage drag is moving the real node's Design pose (it is put back on release). The
 * page holds its autosave and its undo baseline while this is true, so neither can capture the
 * mid-drag pose.
 */
export function setAnimateDragging(on: boolean): void {
	state.dragging = on;
}
export function animateDragging(): boolean {
	return state.dragging;
}

/** Publish (or with `null`, withdraw) `owner`'s keying. One panel withdrawing never clears another's. */
export function setKeyingPanel(panel: KeyingPanel | null, owner: symbol): void {
	if (!panel && state.owner !== owner) return;
	state.panel = panel;
	state.owner = panel ? owner : null;
}

/** The keying for `nodeId`, when the active panel offers one. */
export function keyingFor(nodeId: string | null | undefined): KeyingPanel | null {
	const panel = state.panel;
	return panel && nodeId && panel.nodeId === nodeId ? panel : null;
}

/** Whether a panel can key a stage drag (the canvas lets an Animate drag through only then). */
export function keyingActive(): boolean {
	return !!state.panel?.timelineOpen;
}

/** Key a stage drag through the active panel. */
export function keyStageTransform(deltas: StageTransformDelta[]): number {
	return state.panel ? state.panel.keyStage(deltas) : 0;
}

export type { KeyedChannel };
