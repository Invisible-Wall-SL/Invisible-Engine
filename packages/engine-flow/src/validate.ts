/**
 * FlowDoc validation (design doc §4/§6, Phase 7 authoring UX). A PURE pass over the
 * macro graph — it surfaces authoring problems as WARNINGS (never blocks authoring,
 * never mutates), so the editor can list + focus each issue and mark the offending node.
 *
 * It is Svelte-free + dependency-free (reads only the FlowDoc + a pre-derived orphan
 * map), so the SAME pass runs headlessly (the flow-spike) and in the launcher loader.
 * Pin-orphan detection itself lives in `pins.ts` (`deriveScreenPins` flags `orphaned`);
 * this module RECEIVES the per-screen orphan summary and folds it into the same issue
 * stream as the graph-structure checks, so the UI has one list to render.
 *
 * The graph checks (design doc §9 row 7):
 *  - `unreachable` — a screen with no path from the `initial` screen via transitions.
 *  - `dead-end`    — a non-terminal screen with no OUTGOING transition (nowhere to go).
 *  - `no-initial`  — zero screens flagged `initial` (the flow has no entry).
 *  - `multiple-initial` — more than one `initial` screen (ambiguous entry).
 *  - `orphaned-pins` — a screen has pins whose backing component was deleted (§4).
 *
 * These mirror the §7 fall-through model: a flagged graph still RUNS (un-authored or
 * unreachable screens just fall through to coded behaviour) — the warnings are an
 * authoring aid, not a runtime gate.
 */

import type { FlowDoc } from './types';

/** The class of a validation issue — drives the icon/severity in the UI. */
export type FlowIssueKind =
	| 'no-initial'
	| 'multiple-initial'
	| 'unreachable'
	| 'dead-end'
	| 'orphaned-pins';

/** Issue severity. All Phase-7 issues are warnings (never block authoring, §7). */
export type FlowIssueSeverity = 'warning';

/** A single validation issue. `screenId` is set for node-scoped issues (clickable to
 *  focus the node); graph-scoped issues (`no-initial`) carry none. */
export interface FlowIssue {
	kind: FlowIssueKind;
	severity: FlowIssueSeverity;
	/** The offending screen (absent for graph-wide issues like `no-initial`). */
	screenId?: string;
	/** A human-readable message for the validation panel. */
	message: string;
	/** For `orphaned-pins`: how many pins on the screen are orphaned. */
	count?: number;
}

/** Per-screen orphan summary the caller derives (from `deriveScreenPins`). Keyed by
 *  screen id ⇒ the number of orphaned pins on that screen (0 / absent ⇒ none). */
export type OrphanSummary = Record<string, number>;

/** Compute the set of screen ids REACHABLE from the initial screen via transitions
 *  (forward edges only — a transition `from → to` makes `to` reachable). */
const reachableFrom = (doc: FlowDoc, initialId: string): Set<string> => {
	const adjacency = new Map<string, string[]>();
	for (const t of doc.transitions) {
		const list = adjacency.get(t.from);
		if (list) list.push(t.to);
		else adjacency.set(t.from, [t.to]);
	}
	const seen = new Set<string>();
	const stack = [initialId];
	while (stack.length > 0) {
		const id = stack.pop() as string;
		if (seen.has(id)) continue;
		seen.add(id);
		for (const next of adjacency.get(id) ?? []) {
			if (!seen.has(next)) stack.push(next);
		}
	}
	return seen;
};

/**
 * Validate a FlowDoc's macro graph. `orphans` is the per-screen orphaned-pin count the
 * caller already derived (the editor has it; absent ⇒ no orphan checks). Returns a flat,
 * stable-ordered issue list (graph-wide issues first, then per-screen in `screens[]` order).
 */
export const validateFlowDoc = (doc: FlowDoc, orphans: OrphanSummary = {}): FlowIssue[] => {
	const issues: FlowIssue[] = [];

	const screenIds = doc.screens.map((s) => s.id);
	const labelOf = (id: string): string => {
		const screen = doc.screens.find((s) => s.id === id);
		return screen?.label ?? id;
	};

	// --- Graph-wide: initial screen presence ---------------------------------
	const initialScreens = doc.screens.filter((s) => s.initial);
	if (doc.screens.length > 0 && initialScreens.length === 0) {
		issues.push({
			kind: 'no-initial',
			severity: 'warning',
			message: 'No initial screen — the flow has no entry node. Mark one screen as Initial.',
		});
	} else if (initialScreens.length > 1) {
		issues.push({
			kind: 'multiple-initial',
			severity: 'warning',
			message: `${initialScreens.length} screens are marked Initial — exactly one should be the entry.`,
			screenId: initialScreens[1].id,
		});
	}

	// --- Reachability: every screen should be reachable from the initial -----
	const initial = initialScreens[0];
	if (initial) {
		const reachable = reachableFrom(doc, initial.id);
		for (const id of screenIds) {
			if (!reachable.has(id)) {
				issues.push({
					kind: 'unreachable',
					severity: 'warning',
					screenId: id,
					message: `"${labelOf(id)}" is unreachable — no transition path from the initial screen "${labelOf(initial.id)}".`,
				});
			}
		}
	}

	// --- Dead-ends: a screen with no outgoing transition --------------------
	// A dead-end is a screen the flow can land on but never leave via the graph. The
	// initial screen alone is allowed to have no outgoing edge ONLY if it is the sole
	// screen (a single-screen flow is terminal-by-design, e.g. apps/lines' basegame).
	const hasOutgoing = new Set(doc.transitions.map((t) => t.from));
	const singleScreenFlow = doc.screens.length <= 1;
	if (!singleScreenFlow) {
		for (const id of screenIds) {
			if (!hasOutgoing.has(id)) {
				issues.push({
					kind: 'dead-end',
					severity: 'warning',
					screenId: id,
					message: `"${labelOf(id)}" is a dead-end — no outgoing transition leaves it.`,
				});
			}
		}
	}

	// --- Orphaned pins (folded in from the caller's pin derivation, §4) ------
	for (const id of screenIds) {
		const count = orphans[id] ?? 0;
		if (count > 0) {
			issues.push({
				kind: 'orphaned-pins',
				severity: 'warning',
				screenId: id,
				count,
				message: `"${labelOf(id)}" has ${count} orphaned pin${count === 1 ? '' : 's'} — the backing component was deleted.`,
			});
		}
	}

	return issues;
};
