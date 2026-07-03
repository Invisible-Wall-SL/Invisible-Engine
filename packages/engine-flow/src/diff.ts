/**
 * Flow-diff vs the coded default (design doc §7, Phase 7 authoring UX). A PURE summary of
 * what the FlowDoc OVERRIDES (interpreter-driven) vs what it INHERITS (falls through to the
 * coded `Game.svelte` mounting + `bookEventHandlerMap`). This is the §7 fall-through model
 * made legible: the author sees exactly which screens/events the doc takes over and which
 * still run their coded path, so a partially-migrated game is readable at a glance.
 *
 * "Authored" mirrors what the RUNTIME actually does, on two axes:
 *   - a SCREEN is interpreter-MOUNTED when the FlowDoc lists it AND its backing LayoutDoc scene
 *     resolves — the `mounter.ts` boundary (`resolve` returns `authored` for a listed screen with
 *     a scene, NO `choreography` required). So a placed screen that mounts its authored scene reads
 *     as authored EVEN WITHOUT an enter/while/exit choreography (the FS-6 fix: the free-spin intro
 *     was mislabelled "coded" purely because it had no choreography, while the runtime mounts it).
 *     The `phases` flags still report WHICH choreography phases exist (an extra, not the gate).
 *   - an EVENT is authored when the FlowDoc has an `events[]` choreography for it (`dispatch.ts`
 *     runs it; else the coded handler runs). Unchanged — events have no "mount" axis.
 * The caller supplies `mountedScreenIds` (the ids whose backing scene resolves — the editor derives
 * this from its placed-screen model, which already drops screens with no scene). Absent ⇒ the diff
 * falls back to the choreography-only notion (headless callers with no scene resolver). The diff
 * does NOT decide behaviour — it only REPORTS the boundary the runtime already enforces.
 *
 * Svelte-free + dependency-free, so the same summary runs headlessly and in the launcher.
 */

import type { FlowDoc } from './types';

/** One screen's authored-vs-coded status. */
export interface ScreenDiff {
	screenId: string;
	label: string;
	/** True when the runtime drives this screen via the interpreter — it is interpreter-MOUNTED
	 *  (listed + backing scene resolves, the `mounter.ts` boundary) OR carries a choreography.
	 *  False ⇒ it falls through to coded mounting. This is the display gate; `phases` is an extra. */
	authored: boolean;
	/** True when the runtime interpreter MOUNTS this screen's scene (listed + backing scene
	 *  resolves) — independent of whether it also has a choreography. Drives the "mounted" hint. */
	mounted: boolean;
	/** Which of the three CHOREOGRAPHY phases are authored (for a compact per-phase indicator). A
	 *  screen can be `authored` (mounted) with no phase authored — it mounts its scene statically. */
	phases: { enter: boolean; while: boolean; exit: boolean };
	/** True for the initial (entry) screen. */
	initial: boolean;
}

/** One book-event's authored-vs-coded status. */
export interface EventDiff {
	event: string;
	/** True when the FlowDoc has an `events[]` choreography for this event — the
	 *  interpreter runs it; false ⇒ the coded `bookEventHandlerMap` handler runs (§7). */
	authored: boolean;
}

/** The full diff summary the editor renders (a compact count line + per-item indicators). */
export interface FlowDiff {
	screens: ScreenDiff[];
	events: EventDiff[];
	/** How many screens are authored (interpreter-driven). */
	authoredScreenCount: number;
	/** How many screens fall through to coded mounting. */
	codedScreenCount: number;
	/** How many events are authored. */
	authoredEventCount: number;
	/** Coded book-events NOT authored by the FlowDoc — they run their coded handler.
	 *  Derived from a passed-in coded-event list (the game's `bookEventHandlerMap` keys). */
	codedEventCount: number;
	/** A compact one-line summary, e.g. "3 of 4 screens authored · 5 of 11 events authored". */
	summary: string;
}

const hasNode = (node: unknown): boolean => node !== undefined && node !== null;

/** Optional inputs beyond the coded-event list. `mountedScreenIds` is the set of screen ids the
 *  runtime interpreter would MOUNT (listed in the doc AND their backing scene resolves — the
 *  `mounter.ts` boundary). The editor supplies it from its placed-screen model (which already drops
 *  screens with no backing scene), so the diff matches what the runtime does. Absent ⇒ the diff
 *  falls back to the choreography-only "authored" notion (headless callers with no scene resolver). */
export interface FlowDiffOptions {
	mountedScreenIds?: ReadonlySet<string> | string[];
}

/**
 * Diff a FlowDoc against the coded default. `codedEvents` is the full list of book events
 * the game's coded `bookEventHandlerMap` handles (so the diff can show which coded events
 * remain un-authored / inherited); when omitted, the event diff lists only the FlowDoc's
 * authored events. `options.mountedScreenIds` lets the diff read a listed-with-a-scene screen as
 * authored (mounted) even without a choreography, matching the runtime mounter. The diff is the §7
 * boundary as data, not a behaviour change.
 */
export const diffFlowDoc = (
	doc: FlowDoc,
	codedEvents: string[] = [],
	options: FlowDiffOptions = {},
): FlowDiff => {
	const mounted = options.mountedScreenIds
		? options.mountedScreenIds instanceof Set
			? new Set(options.mountedScreenIds)
			: new Set(options.mountedScreenIds as string[])
		: undefined;
	const screens: ScreenDiff[] = doc.screens.map((s) => {
		const choreo = s.choreography;
		const phases = {
			enter: hasNode(choreo?.enter),
			while: hasNode(choreo?.while),
			exit: hasNode(choreo?.exit),
		};
		const hasChoreo = phases.enter || phases.while || phases.exit;
		// Interpreter-mounted when the caller says its scene resolves; absent set ⇒ fall back to the
		// choreography-only notion (no scene resolver available). Either mounting OR a choreography
		// means the runtime drives it (not coded). This is the FS-6 fix: a placed intro with a real
		// scene but no authored choreography now reads AUTHORED, matching what the runtime mounts.
		const isMounted = mounted ? mounted.has(s.id) : hasChoreo;
		const authored = isMounted || hasChoreo;
		return {
			screenId: s.id,
			label: s.label ?? s.id,
			authored,
			mounted: isMounted,
			phases,
			initial: s.initial ?? false,
		};
	});

	const authoredEventNames = new Set((doc.events ?? []).map((e) => e.event));
	// Union the coded event list with any authored events not in it (an event the FlowDoc
	// authors that isn't in the supplied coded list still shows as authored).
	const eventNames = Array.from(new Set([...codedEvents, ...authoredEventNames])).sort();
	const events: EventDiff[] = eventNames.map((event) => ({
		event,
		authored: authoredEventNames.has(event),
	}));

	const authoredScreenCount = screens.filter((s) => s.authored).length;
	const codedScreenCount = screens.length - authoredScreenCount;
	const authoredEventCount = events.filter((e) => e.authored).length;
	const codedEventCount = events.length - authoredEventCount;

	const summary =
		`${authoredScreenCount} of ${screens.length} screen${screens.length === 1 ? '' : 's'} authored · ` +
		`${authoredEventCount} of ${events.length} event${events.length === 1 ? '' : 's'} authored`;

	return {
		screens,
		events,
		authoredScreenCount,
		codedScreenCount,
		authoredEventCount,
		codedEventCount,
		summary,
	};
};

/**
 * The default coded book-event vocabulary for the diff (the `apps/lines` /
 * Book-of `bookEventHandlerMap` keys, design doc §5/§7). Mirrors the events
 * `LINES_FLOW_DOC` migrates plus the deliberately-coded ones (`finalWin`), so the diff
 * shows the full coded surface a project can override. A later phase can export each
 * game's real handler-map keys as data (like the emitter vocabulary) and pass them in.
 */
export const DEFAULT_CODED_EVENTS: string[] = [
	'reveal',
	'winInfo',
	'setWin',
	'setTotalWin',
	'finalWin',
	'setExpandingSymbol',
	'expandBookColumns',
	'freeSpinTrigger',
	'updateFreeSpin',
	'freeSpinEnd',
];
