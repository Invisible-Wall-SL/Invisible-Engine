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
	putKey(keys: unknown[], time: number, value: number, ease?: string): void;
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
	/** `ease`: a NEW key's outgoing interpolation (an existing key keeps its own). Default linear. */
	keyProperty(
		actorId: string,
		channel: string,
		value: number | null,
		ease?: 'linear' | 'ease' | 'hold',
	): void;
	keyVisibility(actorId: string, visible: boolean): void;
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
