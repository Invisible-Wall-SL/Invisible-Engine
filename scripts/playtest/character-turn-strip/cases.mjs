/** The cases `character-turn-strip.mjs` draws: a name and what the page is asked. */
const iso = (turn) => ({ kind: 'isometric', facings: 8, ...(turn ? { turn } : {}) });
const top = (turn) => ({ kind: 'topDown', facings: 8, ...(turn ? { turn } : {}) });
const around = { before: 2, after: 12, circle: 60 };

export default {
	// The published Salmons bear, as the owner saved it: a rig of one drawing a facing.
	'iso-rig-saved': { subject: 'rig', view: iso({}), ...around },
	// The same sheet without the option: the cut every sheet without `turn` draws.
	'iso-rig-off': { subject: 'rig', view: iso(), before: 2, after: 6, circle: 60 },
	// A lean asked for on an upright character: what tips over, and why its default is none.
	'iso-rig-lean': { subject: 'rig', view: iso({ lean: 22.5, pivot: 'feet', blend: 0 }), ...around },
	// A rig whose facings are poses of the same parts: mixed as one pose, but for the mirror.
	'iso-rig-shared': { subject: 'rig-shared', view: iso({}), ...around },
	// A fish seen from above, as saved (`turn: {}`): the lean about its middle, and the blend.
	'top-clip-saved': { subject: 'clip', view: top({}), ...around },
	// The same with no lean: the blend alone.
	'top-clip-blend': { subject: 'clip', view: top({ lean: 0 }), ...around },
	'top-clip-off': { subject: 'clip', view: top(), before: 2, after: 6, circle: 60 },
};
