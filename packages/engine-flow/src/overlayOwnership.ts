/**
 * Invisible Flow — GENERIC per-step overlay OWNERSHIP (design doc §14, §7; the game-agnostic
 * core of FS-6). A pure, framework-free decision layer shared by the game runtime AND the `/flow`
 * editor: for each authored OVERLAY STEP it reports, INDEPENDENTLY, the three conditions that make
 * the step flow-owned, and their conjunction.
 *
 * NO game literals. `engine-flow` knows nothing of "free spins" — a game (or the editor, from a
 * per-gameType table) supplies its OWN step table (`OverlayStep[]`) naming each step's screen id +
 * bookEvent type + an optional content rule. `apps/lines`' free-spin steps are one such table; a
 * future flow-first game supplies a different one. This mirrors `mounter.ts`'s structural-typing
 * discipline: it declares its own minimal node/scene shapes so it needn't import the full
 * `engine-layout` `Scene`/`LayoutNode` at this boundary (the game passes its real objects through).
 *
 * A step is flow-owned iff ALL THREE of ITS conditions hold — so ownership never flips on wiring
 * alone or a stray node alone, per step:
 *   (i)   `screenPlaced` — its overlay SCREEN is placed in the active FlowDoc;
 *   (ii)  `edgeWired`    — a `bookEvent` LAYER edge for its `event` is wired in the active FlowDoc;
 *   (iii) `sceneAuthored`— its backing SCENE resolves to REAL AUTHORED CONTENT (its content rule
 *          finds ≥1 author-placed node that is NOT coded scaffolding).
 * MIXED states are valid (an owned step runs its authored event + overlay; an un-owned step falls
 * through to its coded handler + scene). Absent doc ⇒ every step OFF (coded, byte-parity §7).
 */

import type { FlowDoc } from './types';

/** A minimal structural node — enough for a content rule to inspect it, mirroring `mounter.ts`'s
 *  `MountableScene` discipline (no `engine-layout` dependency). The game's real `LayoutNode` is
 *  structurally compatible and passes through unchanged. */
export interface OverlayNode {
	kind?: string;
	componentId?: string;
	bind?: { component?: string };
	children?: OverlayNode[];
	[key: string]: unknown;
}

/** A minimal structural scene — id + its author-placed nodes. The game's real `Scene` passes
 *  through unchanged (structurally compatible). */
export interface OverlayScene {
	id: string;
	nodes: readonly OverlayNode[];
	[key: string]: unknown;
}

/** Decides whether a scene node is AUTHORED CONTENT (true) or coded scaffolding to IGNORE (false).
 *  Pure; the game supplies its own (or builds one via {@link excludeCodedComponents}). */
export type OverlayContentRule = (node: OverlayNode) => boolean;

/** One overlay step whose ownership is decided independently. `key` is the game's own step name
 *  (opaque to engine-flow — the union type parameter carries it back literal-typed). `screen` is
 *  the LayoutDoc scene id; `event` the bookEvent type whose LAYER edge wires it. `contentRule`
 *  decides whether the backing scene carries real authored content vs coded scaffolding (§iii);
 *  absent ⇒ any non-empty scene counts as content. */
export interface OverlayStep<K extends string = string> {
	key: K;
	screen: string;
	event: string;
	contentRule?: OverlayContentRule;
}

/** The three independent conditions of a step, reported individually so the editor can show
 *  EXACTLY which one fails (the diagnostic goal). `owned` is their conjunction. */
export interface OverlayStepStatus<K extends string = string> {
	key: K;
	screen: string;
	event: string;
	/** (i) the step's screen is placed in the doc. */
	screenPlaced: boolean;
	/** (ii) a `bookEvent` LAYER edge for `event` is wired in the doc. */
	edgeWired: boolean;
	/** (iii) the backing scene passes the content rule (real authored content). */
	sceneAuthored: boolean;
	/** (i) && (ii) && (iii). */
	owned: boolean;
}

/** The per-step ownership result — a status per step + ergonomic accessors. Generic over the
 *  step-key union so a caller gets literal-typed keys. */
export interface OverlayOwnership<K extends string = string> {
	/** True iff `key` is flow-owned (all three conditions hold). */
	owns: (key: K) => boolean;
	/** The full per-step status (the three conditions) — for the editor diagnostic. */
	status: (key: K) => OverlayStepStatus<K> | undefined;
	/** Every step's status, in table order. */
	statuses: readonly OverlayStepStatus<K>[];
	/** The set of owned step keys (for iteration / diagnostics). */
	ownedKeys: ReadonlySet<K>;
	/** True iff NO step is flow-owned (the whole overlay lifecycle is coded — byte-parity). */
	none: boolean;
}

/**
 * Build a content rule that EXCLUDES coded scaffolding by matching component names/ids — the
 * data-driven form of a game's hand-written anchor check. A node is NOT content (returns false)
 * when its `bind.component` is in `excludeBindComponents`, OR when it is a `componentInstance`
 * whose `componentId` is in `excludeComponentIds`. Every other node IS content. This reproduces
 * the exact shape of `apps/lines`' former `isCodedFsAnchor` — the recursion into `children` is
 * owned by {@link sceneHasContent}, so a container that only WRAPS coded anchors is not itself
 * content (the caller recurses through the rule).
 */
export const excludeCodedComponents = (opts: {
	excludeBindComponents?: readonly string[];
	excludeComponentIds?: readonly string[];
}): OverlayContentRule => {
	const bindSet = new Set(opts.excludeBindComponents ?? []);
	const idSet = new Set(opts.excludeComponentIds ?? []);
	return (node: OverlayNode): boolean => {
		if (node.bind && node.bind.component && bindSet.has(node.bind.component)) return false;
		if (node.kind === 'componentInstance' && node.componentId && idSet.has(node.componentId)) {
			return false;
		}
		return true;
	};
};

/** True when a node tree carries ≥1 author-placed node the content rule accepts (recursing into
 *  `children` — a container that only WRAPS excluded scaffolding is not itself content). With no
 *  rule, ANY node counts (a non-empty scene is content). Mirrors the former `hasAuthoredContent`. */
const nodesHaveContent = (
	nodes: readonly OverlayNode[],
	rule: OverlayContentRule | undefined,
): boolean =>
	nodes.some((node) => {
		if (!rule || rule(node)) return true;
		const children = node.children;
		return Array.isArray(children) && nodesHaveContent(children, rule);
	});

/** Whether the step's backing scene resolves to real authored content (§iii). Absent scene ⇒ false. */
const sceneAuthoredFor = <K extends string>(
	step: OverlayStep<K>,
	sceneById: ReadonlyMap<string, OverlayScene>,
): boolean => {
	const scene = sceneById.get(step.screen);
	return scene !== undefined && nodesHaveContent(scene.nodes, step.contentRule);
};

/**
 * Resolve per-step overlay ownership PURELY over the resolved FlowDoc + live scenes + the step
 * table. Every step defaults OFF; it flips ON only when all three of ITS conditions hold, so the
 * coded path stays authoritative per step until the owner has placed the screen, wired the edge,
 * AND authored the scene. Absent doc ⇒ every step OFF (parity §7). Reports each condition
 * independently (the editor diagnostic — which of screen/edge/scene fails).
 */
export const resolveOverlayOwnership = <K extends string>(
	flowDoc: FlowDoc | undefined,
	scenes: readonly OverlayScene[],
	steps: readonly OverlayStep<K>[],
): OverlayOwnership<K> => {
	const placedScreens = new Set((flowDoc?.screens ?? []).map((s) => s.id));
	const wiredEvents = new Set(
		(flowDoc?.transitions ?? [])
			.filter((t) => t.trigger.kind === 'bookEvent')
			.map((t) => (t.trigger.kind === 'bookEvent' ? t.trigger.event : '')),
	);
	const sceneById = new Map(scenes.map((s) => [s.id, s]));

	const statuses: OverlayStepStatus<K>[] = steps.map((step) => {
		// Absent doc ⇒ nothing is placed/wired ⇒ every condition false ⇒ un-owned (parity).
		const screenPlaced = flowDoc !== undefined && placedScreens.has(step.screen);
		const edgeWired = flowDoc !== undefined && wiredEvents.has(step.event);
		const sceneAuthored = sceneAuthoredFor(step, sceneById);
		return {
			key: step.key,
			screen: step.screen,
			event: step.event,
			screenPlaced,
			edgeWired,
			sceneAuthored,
			owned: screenPlaced && edgeWired && sceneAuthored,
		};
	});

	const statusByKey = new Map(statuses.map((s) => [s.key, s]));
	const ownedKeys = new Set(statuses.filter((s) => s.owned).map((s) => s.key));

	return {
		owns: (key) => ownedKeys.has(key),
		status: (key) => statusByKey.get(key),
		statuses,
		ownedKeys,
		none: ownedKeys.size === 0,
	};
};

/**
 * Strip every UN-owned step's overlay screen + its bookEvent event + its transitions from the doc
 * (each independently), PLUS any always-stripped `seamScreens` (e.g. a not-yet-live seam overlay).
 * An OWNED step keeps its screen + event + transitions. Non-step content (base, win, reveal, …) is
 * untouched: a transition is dropped iff EITHER endpoint is a stripped overlay screen; an event is
 * dropped iff it is an un-owned step's own `event`. The GENERIC form of a game's per-step gate —
 * BUILT here for equivalence testing + future runtime adoption; a game may keep its own proven gate.
 */
export const gateOverlayOwnership = <K extends string>(
	doc: FlowDoc,
	ownership: OverlayOwnership<K>,
	steps: readonly OverlayStep<K>[],
	seamScreens: readonly string[] = [],
): FlowDoc => {
	const strippedScreens = new Set<string>(seamScreens);
	const strippedEvents = new Set<string>();
	for (const step of steps) {
		if (!ownership.owns(step.key)) {
			strippedScreens.add(step.screen);
			strippedEvents.add(step.event);
		}
	}
	return {
		...doc,
		screens: doc.screens.filter((s) => !strippedScreens.has(s.id)),
		transitions: doc.transitions.filter(
			(t) => !strippedScreens.has(t.from) && !strippedScreens.has(t.to),
		),
		events: (doc.events ?? []).filter((e) => !strippedEvents.has(e.event)),
	};
};
