/**
 * The Timeline's cue, text and visibility rows in `/editor` (Rive plan Phase 9d,
 * `docs/design/rive-reference.md` §3.5): pure edits on a timeline doc, so a fixture can pin them.
 * The rows draw in the shared Timeline module (`timeline.js`, `textRows`); the panel keys them
 * through these helpers and the module's own `keyVisibility` / `addCue`.
 *
 * Nothing here adds to the format: `cue`, `visibility` and `text` tracks already exist
 * (`engine-cinematic` `CinematicTrack`), and the game already plays them on node actors.
 */
import { textNodeStrings, type CinematicDoc, type LayoutNode } from 'engine-layout';

type Track = Record<string, unknown> & { id: string };
type TextKey = { time: number; value?: number; key?: string };

/** Rive's *Report Event*: a `signal:` cue, which a component's instance hears and Flow reacts to. */
export const REPORT_EVENT_PREFIX = 'signal:';

export type TextMode = 'countUp' | 'switchKey';

/** An actor's text track (the last, as the player reads it), or null. */
export function textTrackOf(doc: CinematicDoc, actorId: string): Track | null {
	const tracks = doc.tracks.filter((t) => t.actorId === actorId && t.kind === 'text') as Track[];
	return tracks.pop() ?? null;
}

/** The text track's mode; a node with none counts up by default. */
export function textModeOf(doc: CinematicDoc, actorId: string): TextMode {
	return textTrackOf(doc, actorId)?.mode === 'switchKey' ? 'switchKey' : 'countUp';
}

/**
 * Key the actor's text at `time`: a number for a count-up, one of the node's own strings for a
 * switch. The track is created on first use in `mode`; keying the other mode switches the track
 * (its keys are of the other kind, so they are dropped). A key already at `time` is replaced.
 */
export function keyText(
	doc: CinematicDoc,
	actorId: string,
	time: number,
	mode: TextMode,
	payload: number | string,
	newId: () => string,
): void {
	let track = textTrackOf(doc, actorId);
	if (!track) {
		track = { id: newId(), actorId, kind: 'text', mode, keys: [] };
		doc.tracks.push(track);
	} else setTextMode(doc, actorId, mode);
	const keys = track.keys as TextKey[];
	const at = Math.max(0, time);
	const next: TextKey =
		mode === 'switchKey'
			? { time: at, key: String(payload) }
			: { time: at, value: Number.isFinite(Number(payload)) ? Number(payload) : 0 };
	const i = keys.findIndex((k) => Math.abs(k.time - at) < 1e-6);
	if (i >= 0) keys[i] = next;
	else keys.push(next);
	keys.sort((a, b) => a.time - b.time);
}

/** Switch the actor's text track between count-up and switch (its keys go with the old mode). */
export function setTextMode(doc: CinematicDoc, actorId: string, mode: TextMode): boolean {
	const track = textTrackOf(doc, actorId);
	if (!track || track.mode === mode) return false;
	// A track with no mode plays nothing (`sampleText`): name it, keeping its keys when they are
	// already of that kind.
	const switching = textModeOf(doc, actorId) !== mode;
	track.mode = mode;
	if (switching) track.keys = [];
	return true;
}

/** The text key at `time` (within half a frame), for the panel's field. */
export function textKeyAt(
	doc: CinematicDoc,
	actorId: string,
	time: number,
	halfFrame: number,
): TextKey | null {
	const keys = (textTrackOf(doc, actorId)?.keys ?? []) as TextKey[];
	return keys.find((k) => Math.abs(k.time - time) <= halfFrame) ?? null;
}

/** Every cue on the timeline, in time order — the row the Report Event button adds to. */
export function cueKeys(doc: CinematicDoc): { time: number; cue: string }[] {
	const track = doc.tracks.find((t) => t.kind === 'cue') as Track | undefined;
	const keys = (track?.keys ?? []) as { time: number; cue?: string }[];
	return keys.map((k) => ({ time: k.time, cue: k.cue ?? '' })).sort((a, b) => a.time - b.time);
}

const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * What a text node shows in the editor at a sampled `text` value: the switched-to string when the
 * node declares it, or the count-up number grouped. A count-up of a value source's SHARE (`to`)
 * shows the share as a percentage of that source, since the editor has no live value. Undefined ⇒
 * the node's own text.
 */
export function previewTextShown(
	node: LayoutNode,
	text: { mode: 'countUp'; value: number } | { mode: 'switchKey'; key: string } | undefined,
	to?: string,
): string | undefined {
	if (node.kind !== 'text' || !text) return undefined;
	if (text.mode === 'switchKey')
		return textNodeStrings(node).includes(text.key) ? text.key : undefined;
	return to ? `${Math.round(text.value * 100)}% of ${to}` : grouped.format(text.value);
}
