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
 *  - `stuck-overlay` — a screen activated as a LAYER (an incoming non-`complete` edge, so it
 *    stacks OVER a persistent source) that has no outgoing `complete` edge to remove itself. In
 *    the pin-driven active-SET model a screen only leaves the active set by firing its own
 *    Complete pin, so such an overlay never unmounts — it stays stuck over the base. (The base
 *    game itself legitimately persists with no `complete` edge; the check targets only screens
 *    that were LAYERED on, never the initial/base screen.)
 *
 * The choreography check (the silent-literal-typo guard, §11.4):
 *  - `unresolved-accessor` — a `$context.`/`$engine.` accessor whose root/key isn't known
 *    (the chief new authoring-correctness risk: a typo falls through to a literal STRING
 *    and silently mis-resolves at runtime — this warning is the only guard against it).
 *    (Unregistered EFFECT names are warned inline in the inspector, not here.)
 *
 * These mirror the §7 fall-through model: a flagged graph still RUNS (un-authored or
 * unreachable screens just fall through to coded behaviour) — the warnings are an
 * authoring aid, not a runtime gate.
 */

import type { ChoreographyNode, FlowAccessor, FlowDoc, FlowGuard, FlowTransition } from './types';

/**
 * The active-SET semantics of a transition edge (the core authoring lever). A `complete`
 * edge is a HANDOFF: the source fired its own Complete pin, so it DEACTIVATES (hides) and
 * the target activates. A `value` edge is a BINDING: a reactive subscription override of a
 * display's engine feed (design doc §11) that moves NO active set — its own class so it never
 * mis-reads as an active-set edge. Every other trigger (`bookEvent` / `signal` / `condition`
 * / `action`) is a LAYER: the target activates ON TOP while the source PERSISTS underneath
 * (a celebration over a live board). The editor renders these classes distinctly so the author
 * sees which is which; the interpreter (`presentation.ts`) enforces the same split at runtime.
 */
export type EdgeSemantics = 'handoff' | 'layer' | 'value';

/** Classify an edge by its trigger — `complete` ⇒ handoff (source hides), `value` ⇒ binding
 *  (a subscription override, no active-set change), else ⇒ layer (source persists). The single
 *  source of truth the canvas + base-badge derivation share. */
export const edgeSemantics = (transition: FlowTransition): EdgeSemantics =>
	transition.trigger.kind === 'complete'
		? 'handoff'
		: transition.trigger.kind === 'value'
			? 'value'
			: 'layer';

/** True when a screen PERSISTS in the active set — it has no outgoing `complete` edge, so it
 *  never fires its own Complete pin and is never removed (the base game's defining property).
 *  A pure derivation over the transitions (no schema flag), shared by the "persistent (base)"
 *  node badge and any caller needing the base/overlay distinction. */
export const isPersistentScreen = (doc: FlowDoc, screenId: string): boolean =>
	!doc.transitions.some((t) => t.from === screenId && t.trigger.kind === 'complete');

/** The class of a validation issue — drives the icon/severity in the UI. */
export type FlowIssueKind =
	| 'no-initial'
	| 'multiple-initial'
	| 'unreachable'
	| 'dead-end'
	| 'orphaned-pins'
	| 'stuck-overlay'
	| 'unresolved-accessor'
	// A value binding edge (design doc §11) whose `producer` is not a registered engine feed, or
	// whose `sink` display no longer exists — warned, never silently dropped (§11.6). One kind
	// covers both value-edge breakages (the message distinguishes them).
	| 'unresolved-producer'
	// A `bookEvent` trigger edge (design doc §14 FS-2) whose event isn't in the game's book-event
	// vocabulary — the pin it references doesn't exist (a typo or an event removed from the union).
	// Warned, never silently dropped (mirrors the orphaned-pin discipline, §4).
	| 'unknown-book-event'
	// A `bookEvent` trigger edge with a BLANK event name — the `onConnect` fallback mints one when
	// an edge is dropped ON A NODE BODY instead of onto the target's `bookEvent:<event>` INPUT pin
	// (design doc §14 FS-2, the FS-6 foot-gun). Such an edge never matches at runtime (the machine
	// keys on `trigger.event === bookEvent.type`, so `''` matches nothing), so the target screen is
	// never activated by the book event — the silent guessing game this ERROR ends. `error` severity.
	| 'empty-book-event';

/** Issue severity. Most Phase-7 issues are WARNINGS (never block authoring, §7). `error` marks a
 *  break that WILL misbehave at runtime (a dead `bookEvent` edge that matches nothing) — still
 *  non-blocking (save is never gated, §7), but drawn stronger so the author cannot miss it. */
export type FlowIssueSeverity = 'warning' | 'error';

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

/** Optional vocabularies for the unresolved-accessor check. Svelte-free + passed in so
 *  `validateFlowDoc` stays headless-testable: the launcher hands its `ENGINE_PARAM_CATALOG`
 *  keys + the known `$context.*` roots; the spike hands fixtures. Both optional — absent ⇒
 *  that prefix's check is skipped (no false positives when a vocabulary isn't supplied). */
export interface FlowValidateOptions {
	/** The known `$engine.*` keys (from `ENGINE_PARAM_CATALOG`). Absent ⇒ skip the engine check. */
	engineKeys?: ReadonlySet<string> | string[];
	/** The known `$context.*` roots (today effectively just `bookEvents`). Absent ⇒ skip. */
	contextRoots?: ReadonlySet<string> | string[];
	/** The engine value-FEED keys a `value` edge's `producer` may name (from `ENGINE_PARAM_CATALOG`,
	 *  design doc §11). Absent ⇒ skip the unresolved-producer check (no false positives). */
	producerFeeds?: ReadonlySet<string> | string[];
	/** The live consumer value-pin keys `${instanceId}::${source}` a `value` edge's `sink` may target
	 *  (from `deriveScreenPins`, design doc §11). Absent ⇒ skip the orphaned-sink check. */
	valueSinkKeys?: ReadonlySet<string> | string[];
	/** The game's book-event vocabulary (`typesBookEvent.ts` union types, design doc §14 FS-2). A
	 *  `bookEvent` trigger edge whose `event` (with a non-empty name) isn't in this set references a
	 *  book-event pin that doesn't exist — warned, never dropped. Absent ⇒ skip the check (no false
	 *  positives when the caller can't supply the vocabulary — e.g. a typed-name-only setup). */
	bookEvents?: ReadonlySet<string> | string[];
}

const toSet = (v: ReadonlySet<string> | string[] | undefined): Set<string> | undefined =>
	v === undefined ? undefined : v instanceof Set ? new Set(v) : new Set(v as string[]);

/** Walk every accessor a choreography tree references, invoking `visit` per accessor. */
const walkChoreoAccessors = (
	node: ChoreographyNode,
	visit: (accessor: FlowAccessor) => void,
): void => {
	const guardAccessors = (guard: FlowGuard): void => {
		for (const p of guard.all) {
			visit(p.left);
			visit(p.right);
		}
	};
	switch (node.kind) {
		case 'sequence':
		case 'parallel':
			for (const child of node.children) walkChoreoAccessors(child, visit);
			return;
		case 'broadcast':
			if (node.payload) for (const a of Object.values(node.payload)) visit(a);
			return;
		case 'delay':
			return;
		case 'forEach':
			visit(node.list);
			walkChoreoAccessors(node.body, visit);
			return;
		case 'branch':
			guardAccessors(node.guard);
			walkChoreoAccessors(node.then, visit);
			if (node.otherwise) walkChoreoAccessors(node.otherwise, visit);
			return;
		case 'effect':
			if (node.payload) for (const a of Object.values(node.payload)) visit(a);
			return;
	}
};

/** All choreography roots a FlowDoc carries — screen enter/while/exit + per-event — paired
 *  with a human scope label (the screen id/phase or the event type) for issue messages. */
const choreoRoots = (
	doc: FlowDoc,
): { scope: string; screenId?: string; root: ChoreographyNode }[] => {
	const roots: { scope: string; screenId?: string; root: ChoreographyNode }[] = [];
	for (const screen of doc.screens) {
		const c = screen.choreography;
		if (!c) continue;
		const label = screen.label ?? screen.id;
		if (c.enter) roots.push({ scope: `${label} · enter`, screenId: screen.id, root: c.enter });
		if (c.while) roots.push({ scope: `${label} · while`, screenId: screen.id, root: c.while });
		if (c.exit) roots.push({ scope: `${label} · exit`, screenId: screen.id, root: c.exit });
	}
	for (const ev of doc.events ?? []) {
		roots.push({ scope: `event ${ev.event}`, root: ev.choreography });
	}
	return roots;
};

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
export const validateFlowDoc = (
	doc: FlowDoc,
	orphans: OrphanSummary = {},
	options: FlowValidateOptions = {},
): FlowIssue[] => {
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

	// --- Dead-ends superseded by the active-SET model -----------------------
	// The old `dead-end` warning flagged any screen with no outgoing transition. In the
	// active-SET model that is the DEFINING property of a PERSISTENT screen — the base game
	// and HUD are reached by a `complete` handoff and then intentionally stay in the active
	// set forever, so "no way out" is correct, not a mistake. Every no-outgoing screen is
	// persistent by `isPersistentScreen`, so the check flagged only intended bases (false
	// positives) and is removed. The genuinely-broken case — a LAYER overlay that can never
	// dismiss itself — is caught by `stuck-overlay` below. `FlowIssueKind` keeps `dead-end`
	// for any persisted issue payloads, but nothing produces it now.

	// --- Stuck overlays: a layered screen that can never remove itself -------
	// In the active-SET model a screen leaves the set only by firing its own Complete pin (an
	// outgoing `complete` edge). A screen ACTIVATED AS A LAYER — reached by a non-`complete`
	// incoming edge, so it stacks OVER a persistent source — with no outgoing `complete` edge
	// stays stuck over the base forever. The initial/base screen is exempt: it legitimately
	// persists (it is never layered on, and persisting IS its role).
	const layeredTargets = new Set(
		doc.transitions.filter((t) => t.trigger.kind !== 'complete').map((t) => t.to),
	);
	const completesItself = new Set(
		doc.transitions.filter((t) => t.trigger.kind === 'complete').map((t) => t.from),
	);
	for (const id of screenIds) {
		const isInitial = doc.screens.find((s) => s.id === id)?.initial ?? false;
		if (isInitial) continue;
		if (layeredTargets.has(id) && !completesItself.has(id)) {
			issues.push({
				kind: 'stuck-overlay',
				severity: 'warning',
				screenId: id,
				message: `"${labelOf(id)}" layers over a persistent screen but has no outgoing "on complete" transition — it would never remove itself (add a Complete edge back to dismiss the overlay).`,
			});
		}
	}

	// --- Value binding edges: unresolved producer / orphaned sink (design doc §11.6) --------
	// A `value` edge redirects a display's subscription. Warn (never drop, §11.6) when its
	// `producer` isn't a registered engine feed (a typo ⇒ the display subscribes to nothing =
	// empty readout) or its `sink` display no longer exists (the component was deleted). Each check
	// is skipped when its vocabulary isn't supplied (no false positives when the caller omits it).
	const producerFeeds = toSet(options.producerFeeds);
	const valueSinkKeys = toSet(options.valueSinkKeys);
	for (const t of doc.transitions) {
		if (t.trigger.kind !== 'value') continue;
		if (producerFeeds && !producerFeeds.has(t.trigger.producer)) {
			issues.push({
				kind: 'unresolved-producer',
				severity: 'warning',
				screenId: t.from,
				message: `A value binding names producer "${t.trigger.producer}", which is not a registered engine feed — the display would subscribe to nothing (check the spelling).`,
			});
		}
		if (valueSinkKeys) {
			const sinkKey = `${t.trigger.sink.instanceId}::${t.trigger.sink.source}`;
			if (!valueSinkKeys.has(sinkKey)) {
				issues.push({
					kind: 'unresolved-producer',
					severity: 'warning',
					screenId: t.to,
					message: `A value binding targets display "${t.trigger.sink.instanceId}" (${t.trigger.sink.source}), which no longer exists — the wire is orphaned (delete it or re-point it).`,
				});
			}
		}
	}

	// --- Book-event trigger edges: empty / unknown event (design doc §14 FS-2) -----------------
	// A `bookEvent` edge draws FROM a screen's `${screenId}::bookEvent:<event>` trigger pin. Two
	// breakages both leave a DEAD edge that matches nothing at runtime (the machine keys on
	// `trigger.event === bookEvent.type`, so neither `''` nor an unknown name ever fires), so the
	// target screen is never activated — the exact silent guessing game the FS-6 diagnosis hit:
	//   - EMPTY event ('') — the `onConnect` fallback mints this when an edge is dropped on a NODE
	//     BODY instead of onto the target's `bookEvent:<event>` INPUT pin. ERROR (it can never work).
	//   - UNKNOWN event — a name not in the game's book-event vocabulary (a typo, or an event removed
	//     from the union): the referenced pin doesn't exist. ERROR (same runtime dead-edge outcome).
	// Both name the offending edge (from → to) + the fix. `empty-book-event` needs no vocabulary (a
	// blank name is broken regardless), so it is checked unconditionally; the unknown-name check needs
	// the vocabulary (skipped when the caller can't supply it — no false positives, e.g. typed-name).
	const bookEvents = toSet(options.bookEvents);
	for (const t of doc.transitions) {
		if (t.trigger.kind !== 'bookEvent') continue;
		if (!t.trigger.event) {
			issues.push({
				kind: 'empty-book-event',
				severity: 'error',
				screenId: t.to,
				message: `Book-event transition "${labelOf(t.from)}" → "${labelOf(t.to)}" has no event name — it will never fire. Redraw it by dropping the wire onto the target screen's "bookEvent:<event>" input pin (e.g. bookEvent:freeSpinTrigger).`,
			});
			continue;
		}
		if (bookEvents && !bookEvents.has(t.trigger.event)) {
			issues.push({
				kind: 'unknown-book-event',
				severity: 'error',
				screenId: t.to,
				message: `Book-event transition "${labelOf(t.from)}" → "${labelOf(t.to)}" names event "${t.trigger.event}", which is not in the game's book-event vocabulary — the trigger pin doesn't exist, so it will never fire (check the spelling, or redraw onto the target's "bookEvent:<event>" pin).`,
			});
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

	// --- Choreography: unresolved accessors (the silent-literal-typo guard, §11.4) ---
	// A `$context.`/`$engine.` accessor whose root/key is unknown fell through to a literal
	// string at parse time and would silently mis-resolve at runtime — warn (never block,
	// §7). Each prefix's check is skipped when its vocabulary isn't supplied (no false
	// positives). Effect-name correctness is warned inline in the inspector, not here.
	const engineKeys = toSet(options.engineKeys);
	const contextRoots = toSet(options.contextRoots);
	if (engineKeys || contextRoots) {
		for (const { scope, screenId, root } of choreoRoots(doc)) {
			const reported = new Set<string>();
			walkChoreoAccessors(root, (accessor) => {
				if (accessor.kind === 'engine' && engineKeys && !engineKeys.has(accessor.key)) {
					const token = `$engine.${accessor.key}`;
					if (reported.has(token)) return;
					reported.add(token);
					issues.push({
						kind: 'unresolved-accessor',
						severity: 'warning',
						screenId,
						message: `${scope}: \`${token}\` is not a known engine value — check the spelling (it would mis-resolve to a literal at runtime).`,
					});
				} else if (accessor.kind === 'context' && contextRoots) {
					const rootKey = accessor.path.split('.')[0] ?? '';
					if (contextRoots.has(rootKey)) return;
					const token = `$context.${accessor.path}`;
					if (reported.has(token)) return;
					reported.add(token);
					issues.push({
						kind: 'unresolved-accessor',
						severity: 'warning',
						screenId,
						message: `${scope}: \`${token}\` is not a known context value — check the spelling (it would mis-resolve to a literal at runtime).`,
					});
				}
			});
		}
	}

	return issues;
};
