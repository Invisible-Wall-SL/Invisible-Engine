/**
 * `startup-tap-surface` — a screen a driven flow mounts at START-UP and never takes down, whose scene
 * carries a tap-to-continue surface ARMED ON MOUNT.
 *
 * Two authoring models meet here (see `hideContainerIds`): the old "mount once, toggle by cue" seed
 * showed `freeSpinIntro` / `freeSpinOutro` at start-up and let their bound components draw nothing
 * until a cue fired. The newer self-sufficient scenes (`engine-layout` `freeSpinScenes.ts`) hold the
 * round themselves: the intro's `fs-intro-tap` is armed on mount and carries the 0.5 dim. Put the two
 * together and, at idle, a full-screen dimmed tap surface covers the game, its `PressToContinue`
 * registers a continue press, and `hasContinuePress()` disables the Space spin hotkey — the game
 * cannot spin. Found live on `unassigned/cloud`. `drivenSeed.ts` states the rule: such a screen is
 * shown only around its moment (`withFreeSpinScreenHolds`), never at start.
 *
 * The scene half is projected in by the caller (`armedTaps`: ContainerId → the placed ids of its
 * scene's armed-on-mount tap instances), the same split as `containerTaps`. A container absent from
 * it is unknown or has no such tap, and is never flagged.
 *
 * LIMITS, all failing OPEN (no false refusal): a show or hide inside a shared FUNCTION body reached
 * from start-up is not followed for the show, but IS honoured for the hide (`functionHidesContainer`);
 * only the global graph's start-up chains are read — the lifecycle signals fire there.
 */

import { flattenGroups } from './collapse';
import { flowGraphs, hideContainerIds } from './runtime';
import type { FlowDoc, FunctionLibraryDoc, Graph, Node } from './types';
import { functionHidesContainer, type FlowIssue } from './validate';

/** The lifecycle signals that fire once, at boot. */
const STARTUP_SIGNALS: ReadonlySet<string> = new Set(['load', 'tapToStart']);

/** Nodes whose other exec-outs are LATER events (a container's buttons, an instance's events), not
 *  a continuation of the chain that reached them: only their `exec` out runs now. */
const continuesOnExecOnly = (node: Node | undefined): boolean =>
	node?.kind === 'showContainer' || node?.kind === 'componentInstance';

/**
 * ContainerId → the first `showContainer` node that mounts it on a start-up chain: off a
 * `gameSignals.load` / `tapToStart` pin or `event` node, or off `complete:<id>` for a container
 * those chains show (the splash's `complete:loading`), to a fixpoint. A graph flatten cannot read
 * (a malformed group) ⇒ an empty map: this is a check, not a reason to fail.
 */
export const startupShownContainers = (doc: FlowDoc): Map<string, string> => {
	let graph: Graph;
	try {
		graph = flattenGroups(doc.graph);
	} catch {
		return new Map();
	}
	const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
	const next = new Map<string, string[]>();
	for (const e of graph.exec) {
		if (continuesOnExecOnly(byId.get(e.from.node)) && e.from.pin !== 'exec') continue;
		if (byId.get(e.from.node)?.kind === 'gameSignals') continue;
		next.set(e.from.node, [...(next.get(e.from.node) ?? []), e.to.node]);
	}

	const shown = new Map<string, string>();
	const visited = new Set<string>();
	const walk = (start: string): void => {
		const queue = [start];
		while (queue.length) {
			const id = queue.shift()!;
			if (visited.has(id)) continue;
			visited.add(id);
			const node = byId.get(id);
			if (node?.kind === 'showContainer' && !shown.has(node.ref)) shown.set(node.ref, node.id);
			queue.push(...(next.get(id) ?? []));
		}
	};

	for (const e of graph.exec) {
		if (byId.get(e.from.node)?.kind === 'gameSignals' && STARTUP_SIGNALS.has(e.from.pin)) {
			walk(e.to.node);
		}
	}
	for (const n of graph.nodes) if (n.kind === 'event' && STARTUP_SIGNALS.has(n.ref)) walk(n.id);
	for (let grew = true; grew;) {
		grew = false;
		for (const n of graph.nodes) {
			if (n.kind !== 'event' || visited.has(n.id) || !n.ref.startsWith('complete:')) continue;
			if (!shown.has(n.ref.slice('complete:'.length))) continue;
			walk(n.id);
			grew = true;
		}
	}
	return shown;
};

/** Does anything in the doc — any section, or a function it calls — ever hide `ref`? */
const everHidden = (doc: FlowDoc, ref: string, library: FunctionLibraryDoc): boolean => {
	if (hideContainerIds(doc).has(ref)) return true;
	const calls = (graph: Graph): boolean =>
		graph.nodes.some(
			(n) =>
				(n.kind === 'functionCall' &&
					functionHidesContainer(n.ref, ref, library, new Set<string>())) ||
				(n.kind === 'group' && calls(n.body)),
		);
	return flowGraphs(doc).some(({ graph }) => calls(graph));
};

/**
 * The `startup-tap-surface` ERRORS: one per container shown at start-up, never hidden, whose scene
 * has a tap armed on mount (`armedTaps`). Anchored on the start-up show node, so the editor's
 * Validation panel jumps to the node to remove.
 */
export function startupTapIssues(
	doc: FlowDoc,
	library: FunctionLibraryDoc,
	armedTaps: Readonly<Record<string, readonly string[]>>,
): FlowIssue[] {
	const issues: FlowIssue[] = [];
	for (const [ref, showNode] of startupShownContainers(doc)) {
		const taps = armedTaps[ref];
		if (!taps?.length || everHidden(doc, ref, library)) continue;
		const tapList = taps.map((t) => `'${t}'`).join(', ');
		issues.push({
			code: 'startup-tap-surface',
			severity: 'error',
			message: `screen '${ref}' is shown at start-up (show container '${showNode}') and never hidden, but its tap-to-continue ${tapList} is armed on mount — at idle a full-screen tap surface covers the game and Space cannot spin. Show '${ref}' only around its moment (Show → Show with "Hold until this screen completes (tap)" → Hide, as the starter flow does) and remove it from the start-up show set, or set the tap's "Arm tap after signal" in the Scene Editor`,
			at: { on: 'node', node: showNode },
		});
	}
	return issues;
}
