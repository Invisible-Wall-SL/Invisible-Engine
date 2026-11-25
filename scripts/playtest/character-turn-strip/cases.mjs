/** The cases `character-turn-strip.mjs` draws: a name and what the page is asked. */
const iso = (turn) => ({ kind: 'isometric', facings: 8, ...(turn ? { turn } : {}) });
const top = (turn) => ({ kind: 'topDown', facings: 8, ...(turn ? { turn } : {}) });
// Walked round at the samples page's 70° a second.
const around = { before: 2, after: 12, circle: 70 };

export default {
	// The published Salmons bear as the owner saved it (`turn: {}`), one cell a heading from north
	// to east and from west to north (mirrored), as the samples page's stage B draws them.
	'iso-rig-sweep': {
		subject: 'rig',
		view: iso({}),
		...around,
		sweep: { from: 0, to: 90, step: 2.5 },
	},
	'iso-rig-sweep-west': {
		subject: 'rig',
		view: iso({}),
		...around,
		sweep: { from: 270, to: 360, step: 2.5 },
	},
	// The same sheet walked round and round from north on the isometric screen, at the samples
	// page's 70° a second and at the default turn speed's 360: every frame around each switch.
	'iso-rig-round-70': {
		subject: 'rig',
		view: iso({}),
		before: 3,
		after: 3,
		circle: 70,
		round: true,
	},
	'iso-rig-round-360': {
		subject: 'rig',
		view: iso({}),
		before: 2,
		after: 2,
		circle: 360,
		round: true,
	},
	// The same sheet walked round: every frame around each switch (no fade, the walk carried on).
	'iso-rig-saved': { subject: 'rig', view: iso({}), ...around },
	// The same sheet without the option: the cut every sheet without `turn` draws.
	'iso-rig-off': { subject: 'rig', view: iso(), before: 2, after: 6, circle: 70 },
	// A cross-fade asked for (off by default): what the owner saw flicker.
	'iso-rig-blend': { subject: 'rig', view: iso({ blend: 160 }), ...around },
	// A lean of half the sector about the feet: what tipped the bear over in PR 1891.
	'iso-rig-lean': { subject: 'rig', view: iso({ lean: 22.5, pivot: 'feet' }), ...around },
	// A rig whose facings are poses of the same parts.
	'iso-rig-shared': { subject: 'rig-shared', view: iso({}), ...around },
	// A fish seen from above, as saved (`turn: {}`): the lean of half the sector about its middle.
	'top-clip-saved': { subject: 'clip', view: top({}), ...around },
	// The same with a cross-fade asked for.
	'top-clip-blend': { subject: 'clip', view: top({ blend: 160 }), ...around },
	'top-clip-off': { subject: 'clip', view: top(), before: 2, after: 6, circle: 70 },
};
