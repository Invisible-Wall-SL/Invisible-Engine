/**
 * Invisible Flow — the typed editable model + undo/redo command stack (Phase 1).
 *
 * The model is a {@link FlowDoc} (from `engine-flow`) PLUS the live, derived view the
 * canvas renders: each screen's pins, projected from the project's LayoutDoc via
 * `deriveScreenPins` (the four-registry projection, design doc §3/§4). Phase 1 is
 * read-only, so the model is built once from the loaded doc; the command stack is stood
 * up now (per design doc §12) even though edit commands land in Phase 2.
 */

import {
	deriveScreenPins,
	type ComponentDefResolver,
	type FlowDoc,
	type FlowPin,
	type FlowScreen,
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

export interface FlowModel {
	doc: FlowDoc;
	screens: FlowScreenView[];
}

/** Build a {@link ComponentDefResolver} from the project's loaded component defs. */
export const componentResolverFrom = (components: ComponentDef[]): ComponentDefResolver => {
	const byId = new Map(components.map((c) => [c.id, c]));
	return (id) => byId.get(id);
};

/**
 * Build the read-only model for a project: one FlowScreen per LayoutDoc scene (laid out
 * left-to-right by default), each with its derived pins. When a FlowDoc already exists it
 * is honoured (screen positions/labels/choreography + transitions); otherwise an implicit
 * flow is synthesised from the LayoutDoc's screens with no transitions — the read-only
 * "here is your game's flow" view. The synthesised doc is sparse (design doc §7): an empty
 * FlowDoc means pure fall-through at runtime, so deriving one for display is parity-safe.
 */
export const buildFlowModel = (
	layout: LayoutDoc,
	components: ComponentDef[],
	existing?: FlowDoc,
): FlowModel => {
	const resolve = componentResolverFrom(components);
	const byScreenId = new Map((existing?.screens ?? []).map((s) => [s.id, s]));

	const screens: FlowScreenView[] = layout.scenes.map((scene, index): FlowScreenView => {
		const authored = byScreenId.get(scene.id);
		const screen: FlowScreen = authored ?? {
			id: scene.id,
			label: scene.name,
			position: { x: index * 320, y: 0 },
		};
		const pins = deriveScreenPins(scene, resolve);
		return {
			screen,
			scene,
			pins,
			orphanedPins: pins.filter((p) => p.orphaned),
		};
	});

	const doc: FlowDoc = existing ?? {
		version: 1,
		projectKey: layout.projectKey,
		screens: screens.map((s) => s.screen),
		transitions: [],
	};

	return { doc, screens };
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

const clone = <T>(value: T): T => structuredClone(value);

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
