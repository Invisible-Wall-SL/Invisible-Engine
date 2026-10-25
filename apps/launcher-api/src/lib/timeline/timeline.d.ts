/**
 * Types for the Timeline panel. The implementation is plain JS (`timeline.js`) because
 * `/rigger`'s static page loads a verbatim copy of the same file — see its header — so the contract
 * is declared here. Its behaviour is pinned by `tools/rigger-spike/cinematic-timeline.mjs`.
 */
import type { CinematicCast, CinematicDoc } from 'engine-layout';

/** The evaluator calls the Timeline makes (`engine-cinematic` / `/shared/cinematicEval.mjs`). */
export interface TimelineEvaluator {
	resolvePlace(
		place: Record<string, number | boolean>,
		propertyTracks: unknown[] | undefined,
		t: number,
	): Record<string, number | boolean>;
	resolveVisible(
		visible: boolean | undefined,
		visibilityTracks: unknown[] | undefined,
		t: number,
	): boolean;
	putKey(keys: unknown[], time: number, value: number, ease?: TimelineEase): void;
	/** The shape `u → eased u` of an `ease`: the Interpolation panel draws Elastic / Bounce with it. */
	easeShape(ease: unknown): (u: number) => number;
}

/** A key's outgoing interpolation: a named ease, or a cubic `[x1, y1, x2, y2]`. */
export type TimelineEase =
	'linear' | 'ease' | 'hold' | 'elastic' | 'bounce' | [number, number, number, number];

/** One selected key: its track, channel and time. */
export interface TimelineKeyRef {
	trackId: string;
	channel: string;
	time: number;
}

export interface TimelineClip {
	name: string;
	/** Seconds. */
	duration: number;
}

/** What the HOST supplies. Every hook is optional; an absent one is a no-op. */
export interface TimelineHost {
	/** Pose the stage at cinematic time `t`. Called on every seek and during drags. */
	evaluate?(t: number): void;
	/** The playhead moved (after `evaluate`) — sync the host's transport readouts. */
	seeked?(t: number): void;
	/** The document changed and is now an undo step (or an undo/redo landed) — save a draft. */
	changed?(): void;
	/** Re-render the host's panel, which places the Timeline's sections + inspector. Default:
	 *  re-render the inspector only. */
	render?(): void;
	/** Undo/redo replaced the document object — rebuild whatever the host derived from it. */
	docReplaced?(doc: CinematicDoc): void | Promise<void>;
	/** Animation tracks were added or removed. */
	tracksChanged?(): void;
	/** Ctrl+S. */
	save?(): void;
	/** Whether the set / `fx:` band draws in front of the whole cast, after each timeline render. */
	setDepth?(inFront: boolean): void;
	/** The row label for an actor. Default: the actor id. */
	actorLabel?(cast: CinematicCast): { text: string; title: string };
	/** Rows an actor has beyond the shared `channels` (the editor: a placed effect's `fx:<id>`
	 *  parameters). Default: none. */
	actorChannels?(cast: CinematicCast): TimelineChannel[];
	/** An actor's clips — the strip inspector's picker; the first is what ＋ strip adds. */
	clips?(actorId: string): TimelineClip[];
	/** A bound Scene's display name. */
	sceneName?(sceneId: string): string | null;
	/** The project's FX effects, for the cue picker. */
	effects?(): Array<{ id: string; name?: string }>;
	/** The stage camera right now — what ◆ camera keys. */
	cameraView?(): { x: number; y: number; zoom: number } | null;
	/** The actor the host has selected — *Show only selected* shows only its rows. */
	selectedActor?(): string | null;
	/** Space: play / pause. Absent ⇒ the Timeline leaves Space to the page. */
	togglePlay?(): void;
	/** Ctrl+V of property keys copied from `fromActorId`: the OTHER actor they should land on (the
	 *  node selected on the stage), the channels it can key, and `actor()` to make it an actor (called
	 *  only when something pastes). Null ⇒ onto the copied channels, as with no host. */
	pasteTarget?(fromActorId: string): { channels: string[]; actor(): string } | null;
	/** Cue names the cue inspector offers beside the FX effects (the editor: the screen's _On cue_
	 *  Element FX), each a complete cue string with what it reaches. Default: none. */
	cueSuggestions?(): Array<{ cue: string; label: string }>;
}

type Strip = Record<string, unknown> & { id: string };
type Track = Record<string, unknown> & { id: string; actorId?: string | null };

/**
 * Tool-specific authoring that plugs into the Timeline (in `/rigger`: Tweak Mode, inline posing,
 * bone masks). Markup hooks return HTML strings.
 */
export interface TimelineExtension {
	/** True while something else owns the timeline element (the Timeline will not redraw it). */
	timelineSuspended?(): boolean;
	/** Extra text after a strip's label. */
	stripBadge?(strip: Strip): string;
	/** A strip was double-clicked. */
	onStripActivate?(stripId: string): void;
	/** A section under the strip inspector's fields. */
	stripInspector?(strip: Strip, track: Track): string;
	/** Buttons ahead of Duplicate / Delete — one tab-indented, newline-terminated line each. */
	stripActions?(strip: Strip, track: Track): string;
	/** Wire what the hooks above rendered. */
	wireInspector?(root: HTMLElement): void;
	/** Claim a keydown before the Timeline's own keys; return true to stop them. */
	keydown?(e: KeyboardEvent): boolean;
}

export interface TimelineOptions {
	doc: CinematicDoc;
	ev: TimelineEvaluator;
	/** Where the selected strip / key / cue's inspector renders. */
	inspector?: HTMLElement | null;
	host?: TimelineHost;
	extensions?: TimelineExtension[];
	/** The property channels an actor's rows show, in order. Default: {@link PROP_CHANNELS}. */
	channels?: TimelineChannel[];
	/** The key inspector is the Interpolation panel (Linear / Cubic / Hold, the curve editor,
	 *  *Set as default*). Off ⇒ the ease `<select>` `/rigger` shows. */
	interpolation?: boolean;
	/** Every animated actor gets a collapsible summary row of its key times. */
	summaryRows?: boolean;
	/** A drag over an empty channel lane box-selects keys (a click there clears the selection). */
	boxSelect?: boolean;
	/** A node actor's `text` track draws as a row (drag to retime, double-click to delete). */
	textRows?: boolean;
	/** The screen ratio whose property keys the rows show and new keys go to (tracks carrying that
	 *  `layout`), read on every use. Absent, or returning undefined ⇒ the default keys. */
	propertyLayout?: () => string | undefined;
}

export interface Timeline {
	doc(): CinematicDoc;
	setDoc(doc: CinematicDoc): void;
	time(): number;
	/** Clamp, pose (`host.evaluate`) and report (`host.seeked`). */
	setTime(t: number): void;
	/** Move the playhead without posing — for a host that poses on its own clock. */
	setTimeQuiet(t: number): void;
	/** Keys are handled only while active. */
	setActive(on: boolean): void;
	destroy(): void;

	selectedStripId(): string | null;
	selectStrip(id: string | null): void;
	clearSelection(): void;
	/** Every selected property / camera key (Shift-click, a box drag, a summary key). */
	selectedKeys(): TimelineKeyRef[];
	/** Select these keys (the last is the one the inspector shows). */
	selectKeys(keys: TimelineKeyRef[]): void;
	/** Show only the rows of the host's {@link TimelineHost.selectedActor}. */
	setOnlySelected(on: boolean): void;
	onlySelected(): boolean;
	/** Ctrl+C / Ctrl+V / Delete on the selected keys. Each returns whether it did anything. */
	copyKeys(): boolean;
	pasteKeys(): boolean;
	deleteSelectedKeys(): void;
	/** Set every selected key's outgoing ease (`live`: mid-drag, no undo step). */
	setSelectedEase(ease: TimelineEase, live?: boolean): void;
	/** The ease a new key gets in this doc (`doc.defaultEase`); linear clears it. */
	setDefaultEase(ease: TimelineEase | undefined): void;

	commit(label: string, coalesceKey?: string): void;
	historyReset(): void;
	undo(): Promise<void>;
	redo(): Promise<void>;
	canUndo(): boolean;
	canRedo(): boolean;
	historyDepth(): { index: number; size: number; label: string };

	renderTimeline(): void;
	/** Returns whether anything is selected. */
	renderInspector(): boolean;
	positionPlayhead(): void;
	zoom(factor: number): void;
	historyMarkup(): string;
	cameraMarkup(): string;
	cueMarkup(): string;
	/** Wire `historyMarkup` / `cameraMarkup` / `cueMarkup` once placed under `root`. */
	wirePanel(root: HTMLElement): void;

	stripById(id: string): { strip: Strip; track: Track } | null;
	propertyTracksOf(actorId: string): Track[];
	visTracksOf(actorId: string): Track[];
	cameraTrack(): Track | null;
	cueTrack(): Track | null;
	effectiveVisible(actorId: string): boolean;
	effectivePlaceValue(actorId: string, channel: string): number;
	cameraLive(): boolean;

	deleteStrip(stripId: string): void;
	duplicateStrip(stripId: string): void;
	/** `ease`: a NEW key's outgoing interpolation (an existing key keeps its own). Default: the
	 *  doc's `defaultEase`, else linear. */
	keyProperty(actorId: string, channel: string, value: number | null, ease?: TimelineEase): void;
	keyVisibility(actorId: string, visible: boolean): void;
	/** A cue at the playhead, selected; `cue` seeds its name (default `fx:`). */
	addCue(cue?: string): void;
	deleteTextKey(trackId: string, time: number): void;
}

export interface TimelineChannel {
	key: string;
	label: string;
	color: string;
	/** `color`: the value is 0xRRGGBB — the key inspector edits it with a colour picker. */
	input?: 'color';
}

export const PROP_CHANNELS: TimelineChannel[];
export const CAM_CHANNELS: TimelineChannel[];
export const CUE_KINDS: Array<{ prefix: string; label: string; color: string; hint: string }>;
export function hasStrips(track: Track): boolean;
export function esc(s: unknown): string;
/** `el` may be null: the Timeline then runs headless (history, keys, time) and draws nothing. */
export function mount(el: HTMLElement | null, options: TimelineOptions): Timeline;
