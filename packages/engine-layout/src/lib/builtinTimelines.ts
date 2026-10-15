import {
	FREE_SPIN_INTRO_HIDE_SIGNAL,
	FREE_SPIN_INTRO_PRESENTATION_ID,
	FREE_SPIN_INTRO_SHOW_SIGNAL,
	FREE_SPIN_OUTRO_BIG_SIGNAL,
	FREE_SPIN_OUTRO_HIDE_SIGNAL,
	FREE_SPIN_OUTRO_SMALL_SIGNAL,
	FREE_SPIN_OUTRO_PRESENTATION_ID,
	FREE_SPIN_PRESENTATION_NODES,
	FREE_SPIN_PRESENTATION_RIGS,
	freeSpinFadeTimelineId,
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

// ---------------------------------------------------------------------------------------------
// THE AUTHORED WIN (Rive plan Phase 8b, §13.6.4): per-tier timelines GENERATED at boot from the
// active big tiers and the published presentation params, with clip lengths read off the loaded
// skeleton — never typed. Pure and deterministic: the same tiers and lengths produce the same docs.
// ---------------------------------------------------------------------------------------------

export const WIN_PRESENTATION_COMPONENT_ID = 'winPresentation';
/** The signal the conductor fires per tier phase (`winTier.<alias>` …), and the two tier-less ones. */
export const winTierSignal = (alias: string): string => `winTier.${alias}`;
export const winTierLoopSignal = (alias: string): string => `winTierLoop.${alias}`;
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
}

/** A clip end rounded UP to the 60 fps frame the coded track completes it on (`fps: 60`). */
const toFrame = (seconds: number): number => Math.ceil(seconds * 60 - 1e-9) / 60;

/** Lower-case, as a project's cinematic ids are stored, so a project timeline CAN shadow one. */
const winTimelineId = (suffix: string): string =>
	`c_winpresentation_${suffix.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
export const winTierWalkTimelineId = (alias: string): string => winTimelineId(`${alias}_walk`);
export const winTierLoopTimelineId = (alias: string): string => winTimelineId(`${alias}_loop`);
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
 * - `…_walk` (`winTier.<alias>`, HOLDS): the intro strip, then ONE idle strip; the hold's end is the
 *   coded "idle `complete` ⇒ next tier" clock. The visual shows and fades in at 0 (the coded
 *   `FadeContainer`), the caption switches to the tier's Win Text key when it has one.
 * - `…_loop` (`winTierLoop.<alias>`): the idle looping; never holds.
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
		// The coded track completes a clip on the first FRAME at or past its end and starts the next
		// clip at 0 there, dropping the overshoot (a 1.3667 s intro is 82.002 frames: its idle starts
		// on frame 83, not at 1.3667 s); the idle strip starts on that frame too, or the authored
		// idle would run a frame ahead at every tier boundary (measured by `check:win-parity`
		// escalation). A clip that is a whole number of frames (1.3333 s = 80) is unchanged.
		const intro = toFrame(seconds(tier.intro));
		const idle = seconds(tier.idle);
		const walk = Math.max(intro + idle, WIN_FADE_SECONDS);
		const walkStrips = [
			...(intro > 0 ? [strip('intro', tier.intro, 0, intro)] : []),
			...(idle > 0 ? [strip('idle', tier.idle, intro, idle)] : []),
		];
		docs.push(
			winDoc(
				winTierWalkTimelineId(tier.alias),
				`Win: ${tier.alias} walk`,
				winTierSignal(tier.alias),
				walk,
				[
					...showVisual(false),
					...(walkStrips.length
						? [{ id: 'tier-clip', kind: 'animation', actorId: N.tier, strips: walkStrips }]
						: []),
					...(tier.caption
						? [
								{
									id: 'caption-text',
									kind: 'text',
									actorId: N.caption,
									mode: 'switchKey',
									keys: [{ time: 0, key: tier.caption }],
								},
							]
						: []),
				],
				intro + idle > 0,
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

// ---------------------------------------------------------------------------------------------
// THE AUTHORED FREE-SPIN INTRO / OUTRO (Rive plan Phase 8c, §13.7.3): static, because the clips
// are fixed — the three shipped rigs (`fsIntro`, `fsIntroNumber`, `fsOutroNumber`) carry `intro`
// 0.6667 s and `idle` 2.8 s, the lengths `check:authored-freespins` reads off the skeletons. None
// holds a cue: the coded visuals held nothing (the outro driver and the screens' taps hold the
// round).
// ---------------------------------------------------------------------------------------------

export const FREE_SPIN_INTRO_CLIP_SECONDS = 0.6667;
export const FREE_SPIN_IDLE_CLIP_SECONDS = 2.8;
/** The coded track loops the idle forever; the timeline runs this long (an hour). */
const FS_LOOP_SECONDS = 3600;
const FS_FADE_SECONDS = WIN_FADE_MS / 1000;

const fsTimelineId = (defId: string, suffix: string): string =>
	`c_${defId.toLowerCase()}_${suffix}`;
export const freeSpinTimelineId = fsTimelineId;

const FS = FREE_SPIN_PRESENTATION_NODES;

/** A rig's coded walk: `intro` once, then `idle` looping from the frame the coded track switches on. */
const fsWalk = (actorId: string) => {
	const intro = toFrame(FREE_SPIN_INTRO_CLIP_SECONDS);
	return {
		id: `${actorId}-clip`,
		kind: 'animation',
		actorId,
		strips: [
			strip('intro', FREE_SPIN_PRESENTATION_RIGS.intro, 0, intro),
			{
				id: 'idle',
				clip: { src: 'rig', name: FREE_SPIN_PRESENTATION_RIGS.idle },
				start: intro,
				length: FS_LOOP_SECONDS - intro,
				clipLength: FREE_SPIN_IDLE_CLIP_SECONDS,
				loop: { mode: 'fill' },
			},
		],
	};
};

const fsDoc = (
	defId: string,
	suffix: string,
	name: string,
	playOn: string | undefined,
	duration: number,
	tracks: Record<string, unknown>[],
): CinematicDoc => ({
	schemaVersion: 1,
	id: fsTimelineId(defId, suffix),
	name,
	duration,
	fps: 60,
	markers: [],
	host: { kind: 'component', componentId: defId },
	...(playOn ? { playOn } : {}),
	stage: { sceneId: null, cast: winCast(tracks) },
	tracks,
});

/** One presentation's timelines: rest, the show(s), the hide and the fade machine's two poses. */
const fsTimelines = (
	defId: string,
	label: string,
	shows: { suffix: string; signal: string; visible: string[]; hidden: string[] }[],
	hide: string,
): CinematicDoc[] => [
	fsDoc(defId, 'rest', `${label}: rest`, 'enter', 0, [
		visibility(FS.visual, [{ time: 0, visible: false }]),
	]),
	...shows.map(({ suffix, signal, visible, hidden }) =>
		fsDoc(defId, suffix, `${label}: show`, signal, FS_LOOP_SECONDS, [
			visibility(FS.visual, [{ time: 0, visible: true }]),
			...visible.map((node) => visibility(node, [{ time: 0, visible: true }])),
			...hidden.map((node) => visibility(node, [{ time: 0, visible: false }])),
			fsWalk(FS.frame),
			fsWalk(FS.number),
		]),
	),
	fsDoc(defId, 'hide', `${label}: hide`, hide, FS_FADE_SECONDS, [
		visibility(FS.visual, [
			{ time: 0, visible: true },
			{ time: FS_FADE_SECONDS, visible: false },
		]),
	]),
	{
		...fsDoc(defId, 'fade_hidden', `${label}: faded out`, undefined, 1, [alphaPose(FS.fade, 0)]),
		id: freeSpinFadeTimelineId(defId, 'hidden'),
	},
	{
		...fsDoc(defId, 'fade_shown', `${label}: faded in`, undefined, 1, [alphaPose(FS.fade, 1)]),
		id: freeSpinFadeTimelineId(defId, 'shown'),
	},
];

/** Every timeline the two free-spin presentations play. */
export const FREE_SPIN_TIMELINES: readonly CinematicDoc[] = [
	...fsTimelines(
		FREE_SPIN_INTRO_PRESENTATION_ID,
		'Free-spin intro',
		[{ suffix: 'show', signal: FREE_SPIN_INTRO_SHOW_SIGNAL, visible: [], hidden: [] }],
		FREE_SPIN_INTRO_HIDE_SIGNAL,
	),
	...fsTimelines(
		FREE_SPIN_OUTRO_PRESENTATION_ID,
		'Free-spin outro',
		[
			{
				suffix: 'show_big',
				signal: FREE_SPIN_OUTRO_BIG_SIGNAL,
				visible: [FS.captionBig, FS.footerBig],
				hidden: [FS.captionSmall, FS.footerSmall],
			},
			{
				suffix: 'show_small',
				signal: FREE_SPIN_OUTRO_SMALL_SIGNAL,
				visible: [FS.captionSmall, FS.footerSmall],
				hidden: [FS.captionBig, FS.footerBig],
			},
		],
		FREE_SPIN_OUTRO_HIDE_SIGNAL,
	),
];

export const BUILTIN_TIMELINES: readonly CinematicDoc[] = [
	TRANSITION_WIPE_TIMELINE,
	...FREE_SPIN_TIMELINES,
];
