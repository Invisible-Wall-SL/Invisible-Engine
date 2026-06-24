/**
 * Flow-diff vs the coded default (design doc §7, Phase 7 authoring UX). A PURE summary of
 * what the FlowDoc OVERRIDES (interpreter-driven) vs what it INHERITS (falls through to the
 * coded `Game.svelte` mounting + `bookEventHandlerMap`). This is the §7 fall-through model
 * made legible: the author sees exactly which screens/events the doc takes over and which
 * still run their coded path, so a partially-migrated game is readable at a glance.
 *
 * "Authored" is the SAME predicate the interpreter's dispatch uses (`dispatch.ts` /
 * `interpreter.ts`): a screen is authored when the FlowDoc carries a `choreography` for it
 * (else its mount/enter/exit falls through), and an event is authored when the FlowDoc has
 * an `events[]` entry for it (else the coded handler runs). The diff does NOT decide
 * behaviour — it only REPORTS the boundary the runtime already enforces.
 *
 * Svelte-free + dependency-free, so the same summary runs headlessly and in the launcher.
 */

import type { FlowDoc } from './types';

/** One screen's authored-vs-coded status. */
export interface ScreenDiff {
	screenId: string;
	label: string;
	/** True when the screen carries an authored choreography (enter/while/exit) — the
	 *  interpreter drives its presentation; false ⇒ it falls through to coded mounting. */
	authored: boolean;
	/** Which of the three phases are authored (for a compact per-phase indicator). */
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

/**
 * Diff a FlowDoc against the coded default. `codedEvents` is the full list of book events
 * the game's coded `bookEventHandlerMap` handles (so the diff can show which coded events
 * remain un-authored / inherited); when omitted, the event diff lists only the FlowDoc's
 * authored events. The diff is the §7 boundary as data, not a behaviour change.
 */
export const diffFlowDoc = (doc: FlowDoc, codedEvents: string[] = []): FlowDiff => {
	const screens: ScreenDiff[] = doc.screens.map((s) => {
		const choreo = s.choreography;
		const phases = {
			enter: hasNode(choreo?.enter),
			while: hasNode(choreo?.while),
			exit: hasNode(choreo?.exit),
		};
		const authored = phases.enter || phases.while || phases.exit;
		return {
			screenId: s.id,
			label: s.label ?? s.id,
			authored,
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
