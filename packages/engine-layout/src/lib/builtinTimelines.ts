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
