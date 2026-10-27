/**
 * What the Timeline's cue inspector lists by NAME in `/editor` (its `host.cueNames`): the sounds a
 * `sfx:` / `music:` cue can play and the signals a `signal:` / `event:` cue can fire. Pure, so the
 * panel stays a thin host; the server half (`$lib/server/cueLists.ts`) reads the project's sound
 * library and flow once per page load.
 *
 * A list only OFFERS names: a cue naming anything else still saves and plays as before, and the
 * inspector flags it rather than refusing it (the sound may be one only the game has).
 */
import type { TimelineCueSignal, TimelineCueSound } from './timeline';

/** The page data the editor hands its timeline panels. */
export interface CueLists {
	/** Music-bed names, the project's first (`soundOptionsFor`). */
	music: string[];
	/** One-shot names, the project's first. */
	sfx: string[];
	/** Which of the above are the project's own uploads. */
	project: string[];
	/** The uploads ▶ can play: name → stored file and authored level and loop. Empty when the user
	 *  cannot reach Invisible Sound's file route, which the audition streams from. */
	auditions: Record<string, { file: string; volume?: number; loop?: boolean }>;
	/** The author-named cues the project's flow fires (`fireCue` refs outside the engine's list). */
	flowCues: string[];
}

/** One sound kind's names for the picker: uploads marked, the ones ▶ can play flagged. */
export function timelineSoundNames(
	lists: CueLists | undefined,
	kind: 'sfx' | 'music',
): TimelineCueSound[] {
	if (!lists) return [];
	const own = new Set(lists.project);
	return lists[kind].map((name) => ({
		name,
		project: own.has(name),
		playable: Object.hasOwn(lists.auditions, name),
	}));
}

/** The signal-kind cues a timeline can fire, grouped for the picker. */
export function timelineSignalNames(input: {
	lists: CueLists | undefined;
	/** A component's signals (`componentTimelineSignals`); `enter` is the instance appearing, not a
	 *  signal a cue raises, so it is left out. */
	componentSignals?: string[];
	/** A component's declared events, raised by an `event:<id>` cue. */
	events?: string[];
	/** The _On cue_ Element FX a component's own nodes carry (`elementFxCueSuggestions`). A screen
	 *  passes these through `cueSuggestions` instead, which the inspector merges in. */
	elementFx?: { cue: string; label: string }[];
}): TimelineCueSignal[] {
	const out: TimelineCueSignal[] = [];
	for (const name of input.componentSignals ?? []) {
		if (name !== 'enter') out.push({ cue: `signal:${name}`, group: 'Component signals' });
	}
	for (const id of input.events ?? []) {
		out.push({ cue: `event:${id}`, label: 'raises the event', group: 'Events' });
	}
	for (const x of input.elementFx ?? []) {
		out.push({ cue: x.cue, label: x.label, group: 'Element FX (On cue)' });
	}
	for (const name of input.lists?.flowCues ?? []) {
		out.push({ cue: `signal:${name}`, label: 'a cue the flow fires', group: 'Flow cues' });
	}
	return out;
}
