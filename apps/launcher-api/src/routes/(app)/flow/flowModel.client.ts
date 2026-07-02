/**
 * Invisible Flow — the typed editable model + undo/redo command stack (Phase 2).
 *
 * The model is a {@link FlowDoc} (from `engine-flow`) PLUS the live, derived view the
 * canvas renders: each PLACED screen's pins, projected from the project's LayoutDoc via
 * `deriveScreenPins` (the four-registry projection, design doc §3/§4). Phase 2 turns the
 * canvas into an authoring surface: the FlowDoc's `screens[]` is the authoritative set of
 * placed nodes (the palette offers LayoutDoc scenes NOT yet placed), and every mutation
 * goes through a pure command helper so it round-trips cleanly through the command stack.
 */

import {
	deriveScreenPins,
	type ComponentDefResolver,
	type FlowDoc,
	type FlowGuard,
	type FlowPin,
	type FlowScreen,
	type FlowTransition,
	type FlowTransitionEffect,
	type FlowTrigger,
} from 'engine-flow';
import type { ComponentDef, LayoutDoc, Scene } from 'engine-layout';

/** A screen node with its derived pins + the backing LayoutDoc scene — the canvas's view. */
export interface FlowScreenView {
	screen: FlowScreen;
	scene: Scene;
	pins: FlowPin[];
	/** Pins whose backing component was deleted (validation warnings, design doc §4). */
	orphanedPins: FlowPin[];
}

/** A LayoutDoc scene available to place but not yet on the canvas (the palette items). */
export interface AvailableScene {
	id: string;
	name: string;
}

export interface FlowModel {
	doc: FlowDoc;
	/** The placed screens (FlowDoc `screens[]`) resolved against the LayoutDoc + pins. */
	screens: FlowScreenView[];
	/** LayoutDoc scenes not yet placed on the canvas — the palette/picker. */
	available: AvailableScene[];
}

/** Build a {@link ComponentDefResolver} from the project's loaded component defs. */
export const componentResolverFrom = (components: ComponentDef[]): ComponentDefResolver => {
	const byId = new Map(components.map((c) => [c.id, c]));
	return (id) => byId.get(id);
};

/**
 * Build the editable model for a project from its FlowDoc + LayoutDoc. The FlowDoc's
 * `screens[]` are the placed nodes (each resolved against its LayoutDoc scene for pins +
 * orphan warnings); LayoutDoc scenes not in the FlowDoc become palette items. A screen
 * referencing a scene the LayoutDoc no longer has is dropped from the view (its scene is
 * gone) but kept in the doc until the author removes it — surfaced as an orphan node.
 */
export const buildFlowModel = (
	doc: FlowDoc,
	layout: LayoutDoc,
	components: ComponentDef[],
): FlowModel => {
	const resolve = componentResolverFrom(components);
	const sceneById = new Map(layout.scenes.map((s) => [s.id, s]));
	const placedIds = new Set(doc.screens.map((s) => s.id));

	const screens: FlowScreenView[] = [];
	for (const screen of doc.screens) {
		const scene = sceneById.get(screen.id);
		if (!scene) continue; // backing scene gone — kept in doc, not drawn (author removes it)
		const pins = deriveScreenPins(scene, resolve);
		screens.push({ screen, scene, pins, orphanedPins: pins.filter((p) => p.orphaned) });
	}

	const available: AvailableScene[] = layout.scenes
		.filter((s) => !placedIds.has(s.id))
		.map((s) => ({ id: s.id, name: s.name }));

	return { doc, screens, available };
};

// ---------------------------------------------------------------------------
// Pure FlowDoc command helpers — each returns a NEW FlowDoc (never mutates), so the
// command stack snapshots a clean before/after. The component-instance id discipline
// (no recycling, design doc §12) means a screen/edge id is stable, so these address by id.
// ---------------------------------------------------------------------------

// A FlowDoc is pure JSON, so a JSON round-trip is a correct deep clone — and unlike
// `structuredClone` it reads cleanly through a Svelte 5 `$state` proxy (cloning a proxy
// throws DataCloneError). Used wherever a committed doc / proxy must be snapshotted.
const cloneDoc = (doc: FlowDoc): FlowDoc => JSON.parse(JSON.stringify(doc)) as FlowDoc;

/** Place a LayoutDoc scene as a screen node at `position` (no-op if already placed). */
export const addScreen = (
	doc: FlowDoc,
	scene: AvailableScene,
	position: { x: number; y: number },
): FlowDoc => {
	if (doc.screens.some((s) => s.id === scene.id)) return doc;
	const next = cloneDoc(doc);
	const screen: FlowScreen = { id: scene.id, label: scene.name, position };
	// First-placed screen becomes the initial node by default (the flow's entry).
	if (next.screens.length === 0) screen.initial = true;
	next.screens.push(screen);
	return next;
};

/** Remove a screen node AND every transition touching it (no dangling edges). */
export const removeScreen = (doc: FlowDoc, screenId: string): FlowDoc => {
	const next = cloneDoc(doc);
	next.screens = next.screens.filter((s) => s.id !== screenId);
	next.transitions = next.transitions.filter((t) => t.from !== screenId && t.to !== screenId);
	// If we removed the initial screen, promote the first remaining one.
	if (!next.screens.some((s) => s.initial) && next.screens.length > 0) {
		next.screens[0].initial = true;
	}
	return next;
};

/** Move a screen node to a new canvas position. */
export const moveScreen = (
	doc: FlowDoc,
	screenId: string,
	position: { x: number; y: number },
): FlowDoc => {
	const next = cloneDoc(doc);
	const screen = next.screens.find((s) => s.id === screenId);
	if (!screen) return doc;
	screen.position = position;
	return next;
};

/** Mark exactly one screen as the initial active node (clears the flag elsewhere). */
export const setInitialScreen = (doc: FlowDoc, screenId: string): FlowDoc => {
	const next = cloneDoc(doc);
	for (const screen of next.screens) screen.initial = screen.id === screenId;
	return next;
};

let edgeSeq = 0;
/** Mint a fresh, collision-resistant transition id (client-only authoring id). */
export const freshTransitionId = (): string =>
	`t_${Date.now().toString(36)}_${(edgeSeq++).toString(36)}`;

/**
 * Add a transition `from → to`. The `trigger` defaults to `complete` (a HANDOFF: the source
 * hides, the target activates) — the natural act of wiring one screen's Complete pin to the
 * next — but the caller passes a different trigger (e.g. `bookEvent`) when the author drew
 * from a NON-complete source pin, so the edge LAYERS the target over the persistent source.
 * The author refines it in the edge inspector afterward either way.
 */
export const addTransition = (
	doc: FlowDoc,
	from: string,
	to: string,
	trigger: FlowTrigger = { kind: 'complete' },
): FlowDoc => {
	const next = cloneDoc(doc);
	const order = next.transitions.filter((t) => t.from === from).length;
	next.transitions.push({ id: freshTransitionId(), from, to, trigger, order });
	return next;
};

/** Remove a transition by id. */
export const removeTransition = (doc: FlowDoc, transitionId: string): FlowDoc => {
	const next = cloneDoc(doc);
	next.transitions = next.transitions.filter((t) => t.id !== transitionId);
	return next;
};

/** The author-editable fields of a transition (trigger / guard / delay / order / entrance
 *  transition). `transition: null` REMOVES the entrance transition (back to a hard cut). */
export interface TransitionEdit {
	trigger?: FlowTrigger;
	guard?: FlowGuard | null;
	delayMs?: number | null;
	order?: number;
	transition?: FlowTransitionEffect | null;
}

/** Edit a transition's trigger/guard/delay/order/entrance-transition. `null` clears the field. */
export const editTransition = (
	doc: FlowDoc,
	transitionId: string,
	edit: TransitionEdit,
): FlowDoc => {
	const next = cloneDoc(doc);
	const t = next.transitions.find((x) => x.id === transitionId);
	if (!t) return doc;
	if (edit.trigger) t.trigger = edit.trigger;
	if (edit.guard === null) delete t.guard;
	else if (edit.guard) t.guard = edit.guard;
	if (edit.delayMs === null) delete t.delayMs;
	else if (typeof edit.delayMs === 'number') t.delayMs = edit.delayMs;
	if (typeof edit.order === 'number') t.order = edit.order;
	if (edit.transition === null) delete t.transition;
	else if (edit.transition) t.transition = edit.transition;
	return next;
};

/** The default entrance transition seeded when the author drops the "Transition (fade)" palette
 *  item onto an edge — a gentle 300ms ease-out fade-in, which they refine in the inspector. */
export const DEFAULT_FADE_TRANSITION: FlowTransitionEffect = {
	kind: 'fade',
	ms: 300,
	easing: 'easeOut',
};

export const findTransition = (doc: FlowDoc, id: string): FlowTransition | undefined =>
	doc.transitions.find((t) => t.id === id);

// ---------------------------------------------------------------------------
// Copy / paste subgraphs (design doc §12 id discipline, Phase 7 authoring UX).
//
// A clipboard payload is the selected screens (each WITH its authored choreography) plus
// the transitions WHOLLY INTERNAL to the selection (edges to/from screens outside the
// selection are dropped — a paste is a self-contained subgraph). Paste re-creates each
// screen onto a backing LayoutDoc scene and MINTS FRESH transition ids, remapping
// from/to onto the pasted screens — never recycling an id (§12: a copy is a new node).
//
// A screen node's id IS its backing LayoutDoc `Scene.id` (the runtime mounter resolves
// the scene by `screen.id`), and a scene can be placed at most once. So a paste maps each
// copied screen onto a TARGET scene id chosen by the caller: re-pasting the SAME scene
// when it is no longer placed (e.g. after a cut), or onto an UNPLACED scene otherwise.
// This keeps node + transition ids fresh without changing the runtime scene-id contract.
// ---------------------------------------------------------------------------

/** A copied subgraph — screens (with choreography) + internal transitions. */
export interface FlowClipboard {
	screens: FlowScreen[];
	transitions: FlowTransition[];
}

/** Build a clipboard from the selected screen ids: their `FlowScreen` records (deep-cloned,
 *  carrying `choreography`) + the transitions whose BOTH endpoints are in the selection. */
export const copyScreens = (doc: FlowDoc, screenIds: string[]): FlowClipboard => {
	const selected = new Set(screenIds);
	const screens = doc.screens
		.filter((s) => selected.has(s.id))
		.map((s) => JSON.parse(JSON.stringify(s)) as FlowScreen);
	const transitions = doc.transitions
		.filter((t) => selected.has(t.from) && selected.has(t.to))
		.map((t) => JSON.parse(JSON.stringify(t)) as FlowTransition);
	return { screens, transitions };
};

/**
 * Paste a clipboard into the doc, mapping each copied screen's original id onto a fresh
 * TARGET scene id via `targetSceneFor` (the caller picks an unplaced scene, or the same
 * scene id when re-pasting after a cut). A screen whose target is already placed, or for
 * which `targetSceneFor` returns undefined, is skipped (no duplicate placement). Each
 * pasted screen loses `initial` (a paste is never the entry) and is offset on the canvas;
 * internal transitions are re-created with FRESH ids remapped onto the pasted screens.
 */
export const pasteScreens = (
	doc: FlowDoc,
	clip: FlowClipboard,
	targetSceneFor: (originalId: string) => string | undefined,
	offset: { x: number; y: number } = { x: 40, y: 40 },
): { doc: FlowDoc; pastedIds: string[] } => {
	const next = cloneDoc(doc);
	const placed = new Set(next.screens.map((s) => s.id));
	const idMap = new Map<string, string>(); // original screen id → pasted (target) scene id
	const pastedIds: string[] = [];

	for (const screen of clip.screens) {
		const targetId = targetSceneFor(screen.id);
		if (!targetId || placed.has(targetId) || idMap.has(screen.id)) continue;
		const pasted: FlowScreen = JSON.parse(JSON.stringify(screen));
		pasted.id = targetId;
		delete pasted.initial;
		pasted.position = {
			x: (screen.position?.x ?? 0) + offset.x,
			y: (screen.position?.y ?? 0) + offset.y,
		};
		next.screens.push(pasted);
		placed.add(targetId);
		idMap.set(screen.id, targetId);
		pastedIds.push(targetId);
	}

	for (const t of clip.transitions) {
		const from = idMap.get(t.from);
		const to = idMap.get(t.to);
		if (!from || !to) continue; // an endpoint wasn't pasted — drop the edge
		next.transitions.push({
			...(JSON.parse(JSON.stringify(t)) as FlowTransition),
			id: freshTransitionId(),
			from,
			to,
		});
	}

	// If the paste emptied the initial flag (e.g. into an empty doc), promote one.
	if (!next.screens.some((s) => s.initial) && next.screens.length > 0) {
		next.screens[0].initial = true;
	}
	return { doc: next, pastedIds };
};

// ---------------------------------------------------------------------------
// Undo/redo command stack — generic, snapshot-based with burst coalescing.
// Mirrors the Scene Editor's history pattern (design doc §12: reuse it if it
// generalizes). Extracted generic here so the same shape serves the FlowDoc; the
// Scene Editor's inline copy can later collapse onto this when authoring lands.
// ---------------------------------------------------------------------------

export interface FlowHistory<T> {
	/** Record a NEW committed state. Rapid records within `coalesceMs` collapse to one step. */
	record(next: T): void;
	undo(): T | undefined;
	redo(): T | undefined;
	canUndo(): boolean;
	canRedo(): boolean;
	/** Reset the stacks to a clean baseline (after a wholesale load). */
	reset(baseline: T): void;
}

// JSON round-trip, not `structuredClone`: the history records `$state` proxies (the live
// `doc`), and `structuredClone` throws DataCloneError on a Svelte 5 proxy. FlowDoc state is
// pure JSON, so this is a faithful deep clone.
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * A snapshot-based command stack. `baseline` is the initial committed state. Each
 * `record(next)` opens (or extends) a coalescing burst: the FIRST record of a burst
 * pushes the pre-burst baseline onto the undo stack and clears redo; the burst settles
 * after `coalesceMs` of quiet, making the latest state the new baseline. Identical to the
 * Scene Editor's behaviour so a drag / typing burst is one undo step.
 */
export const createFlowHistory = <T>(baseline: T, coalesceMs = 350, max = 80): FlowHistory<T> => {
	let undoStack: T[] = [];
	let redoStack: T[] = [];
	let current = clone(baseline);
	let burstActive = false;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const settle = (): void => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		burstActive = false;
	};

	return {
		record(next: T): void {
			if (!burstActive) {
				undoStack = [...undoStack, clone(current)].slice(-max);
				redoStack = [];
				burstActive = true;
			}
			current = clone(next);
			if (timer) clearTimeout(timer);
			timer = setTimeout(settle, coalesceMs);
		},
		undo(): T | undefined {
			settle();
			const prev = undoStack.pop();
			if (prev === undefined) return undefined;
			redoStack.push(clone(current));
			current = clone(prev);
			return clone(current);
		},
		redo(): T | undefined {
			settle();
			const next = redoStack.pop();
			if (next === undefined) return undefined;
			undoStack = [...undoStack, clone(current)].slice(-max);
			current = clone(next);
			return clone(current);
		},
		canUndo: () => undoStack.length > 0,
		canRedo: () => redoStack.length > 0,
		reset(next: T): void {
			settle();
			undoStack = [];
			redoStack = [];
			current = clone(next);
		},
	};
};
