/**
 * Types for the cinematic sequencer. The implementation is plain JS (`sequencer.js`) because
 * `/rigger`'s static page loads a verbatim copy of the same file — see its header — so the contract
 * is declared here. Its behaviour is pinned by `tools/rigger-spike/cinematic-sequencer.mjs`.
 */
import type { CinematicCast, CinematicDoc } from 'engine-layout';

/** The evaluator calls the sequencer makes (`engine-cinematic` / `/shared/cinematicEval.mjs`). */
export interface SequencerEvaluator {
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
	putKey(keys: unknown[], time: number, value: number): void;
}

export interface SequencerClip {
	name: string;
	/** Seconds. */
	duration: number;
}

/** What the HOST supplies. Every hook is optional; an absent one is a no-op. */
export interface SequencerHost {
	/** Pose the stage at cinematic time `t`. Called on every seek and during drags. */
	evaluate?(t: number): void;
	/** The playhead moved (after `evaluate`) — sync the host's transport readouts. */
	seeked?(t: number): void;
	/** The document changed and is now an undo step (or an undo/redo landed) — save a draft. */
	changed?(): void;
	/** Re-render the host's panel, which places the sequencer's sections + inspector. Default:
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
	/** The row label for an actor. Default: `name`, `target` or the actor id. */
	actorLabel?(cast: CinematicCast): { text: string; title: string };
	/** An actor's clips — the strip inspector's picker; the first is what ＋ strip adds. */
	clips?(actorId: string): SequencerClip[];
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
 * Tool-specific authoring that plugs into the sequencer (in `/rigger`: Tweak Mode, inline posing,
 * bone masks). Markup hooks return HTML strings.
 */
export interface SequencerExtension {
	/** True while something else owns the timeline element (the sequencer will not redraw it). */
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
	/** Claim a keydown before the sequencer's own keys; return true to stop them. */
	keydown?(e: KeyboardEvent): boolean;
}

export interface SequencerOptions {
	doc: CinematicDoc;
	ev: SequencerEvaluator;
	/** Where the selected strip / key / cue's inspector renders. */
	inspector?: HTMLElement | null;
	host?: SequencerHost;
	extensions?: SequencerExtension[];
}

export interface Sequencer {
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
	keyProperty(actorId: string, channel: string, value: number | null): void;
	keyVisibility(actorId: string, visible: boolean): void;
}

export interface SequencerChannel {
	key: string;
	label: string;
	color: string;
}

export const PROP_CHANNELS: SequencerChannel[];
export const CAM_CHANNELS: SequencerChannel[];
export const CUE_KINDS: Array<{ prefix: string; label: string; color: string; hint: string }>;
export function hasStrips(track: Track): boolean;
export function esc(s: unknown): string;
export function mount(el: HTMLElement, options: SequencerOptions): Sequencer;
