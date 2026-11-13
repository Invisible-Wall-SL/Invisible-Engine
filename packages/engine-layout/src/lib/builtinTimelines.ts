import {
	ENHANCEMENT_DIAL_COMPONENT,
	ENHANCEMENT_DIAL_STATES,
	enhancementDialTimelineId,
	SEGMENTED_COUNTER_LIT_TIMELINE_ID,
	SEGMENTED_COUNTER_SEGMENT_ID,
	SEGMENTED_COUNTER_SEGMENT_NODES,
	SEGMENTED_COUNTER_UNLIT_TIMELINE_ID,
} from './builtinComponents';
import type { CinematicDoc } from './types';

/**
 * BUILT-IN TIMELINES: the timelines the engine's built-in components play, as code — registered
 * first, before the project's baked cinematics, so a project timeline with the same id shadows one
 * exactly as a project component shadows a built-in def. No new asset class (rule 8): a built-in
 * timeline ships in the runtime bundle like a built-in def.
 */

// ---------------------------------------------------------------------------------------------
// THE SEGMENTED COUNTER: its segment's two static poses, which its machine picks between. No
// `playOn`: only the machine plays them. They key `alpha`, not visibility: a hidden node unmounts,
// and a remounted `lit` would paint over the segment's number.
// ---------------------------------------------------------------------------------------------

const segmentPose = (id: string, name: string, lit: boolean): CinematicDoc => {
	const nodes = [SEGMENTED_COUNTER_SEGMENT_NODES.lit, SEGMENTED_COUNTER_SEGMENT_NODES.unlit];
	return {
		schemaVersion: 1,
		id,
		name,
		duration: 1,
		fps: 60,
		markers: [],
		host: { kind: 'component', componentId: SEGMENTED_COUNTER_SEGMENT_ID },
		stage: {
			sceneId: null,
			cast: nodes.map((node) => ({ actorId: node, kind: 'node', target: node, place: {} })),
		},
		tracks: nodes.map((node) => ({
			id: `${node}-alpha`,
			kind: 'property',
			actorId: node,
			channels: {
				alpha: [{ time: 0, value: (node === SEGMENTED_COUNTER_SEGMENT_NODES.lit) === lit ? 1 : 0 }],
			},
		})),
	};
};

export const SEGMENTED_COUNTER_TIMELINES: readonly CinematicDoc[] = [
	segmentPose(SEGMENTED_COUNTER_LIT_TIMELINE_ID, 'Segment: lit', true),
	segmentPose(SEGMENTED_COUNTER_UNLIT_TIMELINE_ID, 'Segment: unlit', false),
];

// ---------------------------------------------------------------------------------------------
// THE ENHANCEMENT DIAL: one timeline per state its machine enters. They key nothing, so the coded
// dial and the bound pulse draw as before; a ⧉ copy gets them as its own to key its art in.
// ---------------------------------------------------------------------------------------------

export const ENHANCEMENT_DIAL_TIMELINES: readonly CinematicDoc[] = ENHANCEMENT_DIAL_STATES.map(
	(state) => ({
		schemaVersion: 1,
		id: enhancementDialTimelineId(state),
		name: `Dial: ${state.toLowerCase()}`,
		duration: 1,
		fps: 60,
		markers: [],
		host: { kind: 'component', componentId: ENHANCEMENT_DIAL_COMPONENT },
		stage: { sceneId: null, cast: [] },
		tracks: [],
	}),
);

export const BUILTIN_TIMELINES: readonly CinematicDoc[] = [
	...SEGMENTED_COUNTER_TIMELINES,
	...ENHANCEMENT_DIAL_TIMELINES,
];
