import {
	WIN_FADE_HIDDEN_TIMELINE_ID,
	WIN_FADE_MS,
	WIN_FADE_SHOWN_TIMELINE_ID,
	WIN_PRESENTATION_NODES,
} from './builtinComponents';
import type { CinematicDoc } from './types';

/**
 * BUILT-IN TIMELINES (Rive plan Phase 8a, `docs/design/rive-style-editor.md` §13.2): the timelines
 * the engine's built-in components play, as code — registered first, before the project's baked
 * cinematics, so a project timeline with the same id shadows one exactly as a project component
 * shadows a built-in def. No new asset class (rule 8): a built-in timeline ships in the runtime
 * bundle like a built-in def, and the art it plays is the engine's own static rig bundle.
 */

/** The `transition` rig's one clip: `animation`, 1.6667 s (its last key) — the coded wipe's length. */
export const TRANSITION_WIPE_CLIP = 'animation';
export const TRANSITION_WIPE_CLIP_SECONDS = 1.6667;
// Lower-case, as a project's cinematic ids are stored (`r2Slug`), so a project timeline CAN shadow it.
export const TRANSITION_WIPE_TIMELINE_ID = 'c_transitionwipe_wipe';

/**
 * The authored Transition: on the game's `transition` cue, play the wipe rig's clip once, from the
 * rig node named `wipe`, and HOLD the awaited cue until the clip ends — what the coded
 * `Transition.svelte` did with its `complete` listener. The node is visible only while the clip
 * plays (the coded part unmounted its rig at `complete`): the visibility track shows it at 0 and
 * hides it at the end, and the node's own `hiddenUntilSignal` keeps it hidden before the first fire.
 */
export const TRANSITION_WIPE_TIMELINE: CinematicDoc = {
	schemaVersion: 1,
	id: TRANSITION_WIPE_TIMELINE_ID,
	name: 'Transition wipe',
	duration: TRANSITION_WIPE_CLIP_SECONDS,
	fps: 60,
	markers: [],
	host: { kind: 'component', componentId: 'transitionWipe' },
	playOn: 'transition',
	holdsCue: true,
	stage: {
		sceneId: null,
		cast: [{ actorId: 'wipe', kind: 'node', target: 'wipe', place: {} }],
	},
	tracks: [
		{
			id: 'wipe-clip',
			kind: 'animation',
			actorId: 'wipe',
			strips: [
				{
					id: 'wipe-strip',
					clip: { src: 'rig', name: TRANSITION_WIPE_CLIP },
					start: 0,
					length: TRANSITION_WIPE_CLIP_SECONDS,
					clipLength: TRANSITION_WIPE_CLIP_SECONDS,
				},
			],
		},
		{
			id: 'wipe-visible',
			kind: 'visibility',
			actorId: 'wipe',
			keys: [
				{ time: 0, visible: true },
				{ time: TRANSITION_WIPE_CLIP_SECONDS, visible: false },
			],
		},
	],
};

export const BUILTIN_TIMELINES: readonly CinematicDoc[] = [TRANSITION_WIPE_TIMELINE];

// ---------------------------------------------------------------------------------------------
// THE AUTHORED WIN (Rive plan Phase 8b, §13.6.4): per-tier timelines GENERATED at boot from the
// active big tiers and the published presentation params, with clip lengths read off the loaded
// skeleton — never typed. Pure and deterministic: the same tiers and lengths produce the same docs.
// ---------------------------------------------------------------------------------------------

export const WIN_PRESENTATION_COMPONENT_ID = 'winPresentation';
/** The signal the conductor fires per tier phase (`winTier.<alias>` …), and the two tier-less ones. */
export const winTierSignal = (alias: string, mode?: string): string =>
	mode === undefined ? `winTier.${alias}` : `winTier.${alias}@${mode}`;
export const winTierIdleSignal = (alias: string): string => `winTierIdle.${alias}`;
export const winTierLoopSignal = (alias: string): string => `winTierLoop.${alias}`;
export const winTierRewindSignal = (alias: string): string => `winTierRewind.${alias}`;
export const winTierOutroSignal = (alias: string): string => `winTierOutro.${alias}`;
export const WIN_PLAIN_SIGNAL = 'winPlain';
export const WIN_HIDE_SIGNAL = 'winHide';
/** The fade layer's show trigger — fired by the gate where the coded `FadeContainer` started its tween. */
export const WIN_FADE_SIGNAL = 'winFade';
/** The coded `FadeContainer`'s default tween, in seconds — the hide timeline's visibility cut. */
export const WIN_FADE_SECONDS = WIN_FADE_MS / 1000;
/** A looping idle has no end; the loop timeline runs this long before it would hold (an hour). */
export const WIN_LOOP_SECONDS = 3600;

/** One active big tier, as the game resolved its presentation (`resolveTierPresentation`). */
export interface WinTierTimelineTier {
	alias: string;
	intro: string;
	idle: string;
	/** The exit clip — absent when the tier has none (`tierHasExit` is false: no outro, or the idle). */
	outro?: string;
	/** The tier's Win Text caption (a key or source text); absent ⇒ no text track. */
	caption?: string;
	/** The spins modes whose own Win Text caption for this tier differs from `caption` (mode id →
	 *  caption, `''` ⇒ none): each gets its own walk, fired by `winTierSignal(alias, mode)`. */
	modeCaptions?: Record<string, string>;
}

/** Lower-case, as a project's cinematic ids are stored, so a project timeline CAN shadow one. */
const winTimelineId = (suffix: string): string =>
	`c_winpresentation_${suffix.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
export const winTierWalkTimelineId = (alias: string, mode?: string): string =>
	winTimelineId(mode === undefined ? `${alias}_walk` : `${alias}_walk_mode_${mode}`);
export const winTierIdleTimelineId = (alias: string): string => winTimelineId(`${alias}_idle`);
export const winTierLoopTimelineId = (alias: string): string => winTimelineId(`${alias}_loop`);
export const winTierRewindTimelineId = (alias: string): string => winTimelineId(`${alias}_rewind`);
export const winTierOutroTimelineId = (alias: string): string => winTimelineId(`${alias}_outro`);
export const WIN_PLAIN_TIMELINE_ID = winTimelineId('plain');
export const WIN_HIDE_TIMELINE_ID = winTimelineId('hide');
export const WIN_REST_TIMELINE_ID = winTimelineId('rest');

const N = WIN_PRESENTATION_NODES;
/** Only the actors a doc keys: a timeline wins a node WHOLE once started, so a walk that cast the
 *  `fade` node without keying it would take it from the fade-in and leave its alpha unkeyed. */
const winCast = (tracks: Record<string, unknown>[]) =>
	[...new Set(tracks.map((t) => t.actorId as string))].map((name) => ({
		actorId: name,
		kind: 'node' as const,
		target: name,
		place: {},
	}));
const visibility = (actorId: string, keys: { time: number; visible: boolean }[]) => ({
	id: `${actorId}-visible`,
	kind: 'visibility',
	actorId,
	keys,
});
/** A static alpha pose for the fade layer's states (the machine blends between them). */
const alphaPose = (actorId: string, value: number) => ({
	id: `${actorId}-alpha`,
	kind: 'property',
	actorId,
	channels: { alpha: [{ time: 0, value }] },
});
const strip = (id: string, clip: string, start: number, length: number) => ({
	id,
	clip: { src: 'rig', name: clip },
	start,
	length,
	clipLength: length,
});
const winDoc = (
	id: string,
	name: string,
	playOn: string,
	duration: number,
	tracks: Record<string, unknown>[],
	holdsCue = false,
): CinematicDoc => ({
	schemaVersion: 1,
	id,
	name,
	duration,
	fps: 60,
	markers: [],
	host: { kind: 'component', componentId: WIN_PRESENTATION_COMPONENT_ID },
	playOn,
	...(holdsCue ? { holdsCue: true } : {}),
	stage: { sceneId: null, cast: winCast(tracks) },
	tracks,
});
/** The show side: the visual on (the fade-in, when one is due, is the gate's `winFadeIn`), the tier
 *  or the plain number. No alpha key: a first win shows at once, as the coded container did. */
const showVisual = (plain: boolean) => [
	visibility(N.visual, [{ time: 0, visible: true }]),
	visibility(N.tier, [{ time: 0, visible: !plain }]),
	visibility(N.countPlain, [{ time: 0, visible: plain }]),
];

/**
 * Every timeline the authored win presentation plays, for `tiers` (the active big tiers, each with
 * the clips the coded `resolveTierPresentation` would pick) and `clipMs` (clip name → length in
 * ms, read off the loaded skeleton; a clip it lacks measures 0 and gets no strip). Per tier:
 * - `…_walk` (`winTier.<alias>`, HOLDS): the intro strip; the hold's end is the coded intro
 *   `complete`. The visual shows at 0, the caption switches to the tier's Win Text key when it has
 *   one (a spins mode with its own caption gets its own walk, `winTier.<alias>@<mode>`).
 * - `…_idle` (`winTierIdle.<alias>`, HOLDS): ONE idle cycle — a chain's non-final tier; the hold's
 *   end is the coded "idle `complete` ⇒ next tier" clock.
 * ONE CLIP PER TIMELINE, because a timeline ends on the rig's own clock that way: the coded track
 * completes a clip when the frame deltas summed SINCE THAT CLIP STARTED reach its length — no
 * rounding, no snap — and the next clip starts at 0 from that `complete`. A held timeline is the
 * same sum and the same compare, and the conductor starts the next one from its hold's end, so a
 * whole-frame clip (the 12 s idle is 720 frames, whose 720 deltas may sum a hair under 12 s) ends
 * on the frame the rig's does (measured by `check:win-parity` escalation).
 * - `…_loop` (`winTierLoop.<alias>`): the idle looping; never holds.
 * - `…_rewind` (`winTierRewind.<alias>`): the intro again on the tier rig alone, never holding —
 *   the coded walk's rewind under the fade-out: `winHide` clears the count latch, and
 *   `WinAnimation` rewinds an escalating chain to its first tier's intro while the overlay fades.
 *   It keys only `tier`, so the hide keeps `visual`.
 * - `…_outro` (`winTierOutro.<alias>`, HOLDS): the exit strip; only for a tier with an exit.
 * Plus `…_plain` (`winPlain`: the plain number alone, tier hidden), `…_hide` (`winHide`: the visual
 * hidden once the coded `FadeContainer`'s 400 ms tween would have reached 0), `…_rest` (`enter`:
 * everything hidden until a win shows it) and the fade layer's two static poses
 * (`…_fade_hidden` / `…_fade_shown`: the `fade` node at alpha 0 / 1 — the def's state machine
 * blends between them over 400 ms on `winFade` / `winHide`, from the pose on screen, which is the
 * coded tween exactly, a hide inside the fade-in included).
 */
export function winTierTimelines(
	tiers: readonly WinTierTimelineTier[],
	clipMs: Readonly<Record<string, number>>,
): CinematicDoc[] {
	const seconds = (clip: string): number => Math.max((clipMs[clip] ?? 0) / 1000, 0);
	const docs: CinematicDoc[] = [
		winDoc(WIN_REST_TIMELINE_ID, 'Win: rest', 'enter', 0, [
			visibility(N.visual, [{ time: 0, visible: false }]),
		]),
		winDoc(WIN_PLAIN_TIMELINE_ID, 'Win: plain number', WIN_PLAIN_SIGNAL, WIN_FADE_SECONDS, [
			...showVisual(true),
		]),
		{
			...winDoc(WIN_FADE_HIDDEN_TIMELINE_ID, 'Win: faded out', '', 1, [alphaPose(N.fade, 0)]),
			playOn: undefined,
		},
		{
			...winDoc(WIN_FADE_SHOWN_TIMELINE_ID, 'Win: faded in', '', 1, [alphaPose(N.fade, 1)]),
			playOn: undefined,
		},
		winDoc(WIN_HIDE_TIMELINE_ID, 'Win: hide', WIN_HIDE_SIGNAL, WIN_FADE_SECONDS, [
			// A keyed visibility track holds its first key backwards in time, so the cut needs the
			// `true` at 0 or the node would vanish at once (the fade itself is the machine's blend).
			visibility(N.visual, [
				{ time: 0, visible: true },
				{ time: WIN_FADE_SECONDS, visible: false },
			]),
		]),
	];
	for (const tier of tiers) {
		const intro = seconds(tier.intro);
		const idle = seconds(tier.idle);
		const walkDoc = (mode: string | undefined, caption: string | undefined): CinematicDoc =>
			winDoc(
				winTierWalkTimelineId(tier.alias, mode),
				mode === undefined ? `Win: ${tier.alias} walk` : `Win: ${tier.alias} walk (${mode})`,
				winTierSignal(tier.alias, mode),
				intro > 0 ? intro : WIN_FADE_SECONDS,
				[
					...showVisual(false),
					...(intro > 0
						? [
								{
									id: 'tier-clip',
									kind: 'animation',
									actorId: N.tier,
									strips: [strip('intro', tier.intro, 0, intro)],
								},
							]
						: []),
					...(caption
						? [
								{
									id: 'caption-text',
									kind: 'text',
									actorId: N.caption,
									mode: 'switchKey',
									keys: [{ time: 0, key: caption }],
								},
							]
						: []),
				],
				intro > 0,
			);
		docs.push(walkDoc(undefined, tier.caption));
		// A spins mode that speaks its own caption for the tier walks it (the coded caption reads
		// `boardWinText()`, the mode on top); the conductor fires the mode's signal.
		const modeCaptions = tier.modeCaptions ?? {};
		for (const mode of Object.keys(modeCaptions).sort())
			docs.push(walkDoc(mode, modeCaptions[mode] || undefined));
		docs.push(
			winDoc(
				winTierRewindTimelineId(tier.alias),
				`Win: ${tier.alias} rewind`,
				winTierRewindSignal(tier.alias),
				intro > 0 ? intro : WIN_FADE_SECONDS,
				[
					visibility(N.tier, [{ time: 0, visible: true }]),
					...(intro > 0
						? [
								{
									id: 'tier-clip',
									kind: 'animation',
									actorId: N.tier,
									strips: [strip('intro', tier.intro, 0, intro)],
								},
							]
						: []),
				],
			),
		);
		docs.push(
			winDoc(
				winTierIdleTimelineId(tier.alias),
				`Win: ${tier.alias} idle`,
				winTierIdleSignal(tier.alias),
				idle > 0 ? idle : WIN_FADE_SECONDS,
				[
					visibility(N.tier, [{ time: 0, visible: true }]),
					...(idle > 0
						? [
								{
									id: 'tier-clip',
									kind: 'animation',
									actorId: N.tier,
									strips: [strip('idle', tier.idle, 0, idle)],
								},
							]
						: []),
				],
				idle > 0,
			),
		);
		docs.push(
			winDoc(
				winTierLoopTimelineId(tier.alias),
				`Win: ${tier.alias} loop`,
				winTierLoopSignal(tier.alias),
				WIN_LOOP_SECONDS,
				[
					visibility(N.tier, [{ time: 0, visible: true }]),
					...(idle > 0
						? [
								{
									id: 'tier-clip',
									kind: 'animation',
									actorId: N.tier,
									strips: [
										{
											id: 'idle',
											clip: { src: 'rig', name: tier.idle },
											start: 0,
											length: WIN_LOOP_SECONDS,
											clipLength: idle,
											loop: { mode: 'fill' },
										},
									],
								},
							]
						: []),
				],
			),
		);
		const outro = tier.outro ? seconds(tier.outro) : 0;
		if (tier.outro && outro > 0) {
			docs.push(
				winDoc(
					winTierOutroTimelineId(tier.alias),
					`Win: ${tier.alias} outro`,
					winTierOutroSignal(tier.alias),
					outro,
					[
						visibility(N.tier, [{ time: 0, visible: true }]),
						{
							id: 'tier-clip',
							kind: 'animation',
							actorId: N.tier,
							strips: [strip('outro', tier.outro, 0, outro)],
						},
					],
					true,
				),
			);
		}
	}
	return docs;
}
