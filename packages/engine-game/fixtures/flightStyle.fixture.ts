/**
 * The authored flight style (`engine-layout` `flightStyle.ts` + the style half of `flightPath.ts`):
 * an absent block resolves to exactly the coded flight, resolution runs exact key → `toMeter` family
 * → coded default field by field, junk is dropped and numbers are clamped, and the style maps onto
 * `planFlight` the same way for every caller.
 *
 * Run: node --experimental-strip-types packages/engine-game/fixtures/flightStyle.fixture.ts
 */
import {
	FLIGHT_BEND_STRENGTHS,
	flightBendStrengths,
	flightEase,
	flightDuration,
	flightEaseOf,
	flightPlanOptions,
	headingOnCurve,
	planFlight,
} from '../../engine-layout/src/lib/flightPath.ts';
import {
	FLIGHT_DEFAULTS,
	flightEffectIds,
	isFlightKey,
	normalizeFlights,
	resolveFlightStyle,
	type FlightsConfig,
} from '../../engine-layout/src/lib/flightStyle.ts';

let passed = 0;
let failed = 0;
const json = (value: unknown) => JSON.stringify(value);
const it = (label: string, actual: unknown, expected: unknown) => {
	if (json(actual) === json(expected)) {
		passed += 1;
		console.log(`  ok  ${label}`);
		return;
	}
	failed += 1;
	console.log(
		`FAIL  ${label}\n        expected ${json(expected)}\n        actual   ${json(actual)}`,
	);
};

const CODED = {
	overRoute: true,
	avoid: true,
	padding: 0.1,
	speed: 1.1,
	minMs: 350,
	maxMs: 900,
	ease: 'easeInOut',
	stagger: 70,
	size: 1,
	trailAlign: false,
	trailRotation: 0,
};

it('no block ⇒ the coded flight', resolveFlightStyle(undefined, 'toTotal'), CODED);
it('an empty block ⇒ the coded flight', resolveFlightStyle({}, 'toMeter:gold'), CODED);
it('the coded numbers are the ones flyTo used before the block existed', FLIGHT_DEFAULTS, {
	speed: 1.1,
	minMs: 350,
	maxMs: 900,
	stagger: 70,
	ease: 'easeInOut',
	size: 1,
	trailAlign: false,
	trailRotation: 0,
	padding: 0.1,
	overRoute: true,
	avoid: true,
});
it(
	'another kind authored ⇒ this one is still coded',
	resolveFlightStyle({ toCollector: { speed: 3 } }, 'toTotal'),
	CODED,
);

const config: FlightsConfig = {
	toMeter: {
		speed: 2,
		ease: 'linear',
		path: { bend: 0.3, padding: 0.5 },
		trail: { effectId: 'fx-meter' },
	},
	'toMeter:gold': { speed: 4, path: { avoid: false }, head: { kind: 'none' } },
};
it(
	'exact key wins field by field, the family fills the rest, the coded default the remainder',
	resolveFlightStyle(config, 'toMeter:gold'),
	{
		overRoute: true,
		avoid: false,
		padding: 0.5,
		speed: 4,
		minMs: 350,
		maxMs: 900,
		ease: 'linear',
		stagger: 70,
		size: 1,
		trailAlign: false,
		trailRotation: 0,
		head: { kind: 'none' },
		trail: { effectId: 'fx-meter' },
		bend: 0.3,
	},
);
it(
	'a meter with no own key flies the family style',
	resolveFlightStyle(config, 'toMeter:red').speed,
	2,
);
it(
	'the family never leaks into a non-meter kind',
	resolveFlightStyle(config, 'toTotal').speed,
	1.1,
);
it(
	'false and 0 are answers, not gaps — they beat the family',
	resolveFlightStyle(
		{
			toMeter: { path: { overRoute: true, bend: 0.5, arc: 0.3 } },
			'toMeter:a': { path: { overRoute: false, bend: 0, arc: 0 } },
		},
		'toMeter:a',
	),
	{ ...CODED, overRoute: false, bend: 0, arc: 0 },
);

it(
	'flight keys: the seven kinds and toMeter:<id>',
	[
		'toTotal',
		'toCollector',
		'boostBeam',
		'toCounter',
		'upgradeBeam',
		'unlockRow',
		'toMeter',
		'toMeter:gold',
	].map(isFlightKey),
	[true, true, true, true, true, true, true, true],
);
it(
	'an unauthored toCounter / upgradeBeam flies the coded flight',
	[resolveFlightStyle(undefined, 'toCounter'), resolveFlightStyle({}, 'upgradeBeam')],
	[CODED, CODED],
);
it(
	'junk keys are not flight keys',
	['toMeter:', 'toMeter: x', 'meter', 'TOTAL', ''].map(isFlightKey),
	[false, false, false, false, false],
);

it(
	'normalize: junk keys and junk fields dropped, numbers clamped, keys ordered',
	normalizeFlights({
		'toMeter:b': { stagger: 99_999.4 },
		bogus: { speed: 2 },
		toTotal: {
			speed: -1,
			minMs: 120.6,
			maxMs: 50_000,
			ease: 'bounce',
			path: { bend: 7, padding: -3, overRoute: 'yes' },
			head: { kind: 'glow', tint: '#FFAA00', scale: 99 },
			trail: { effectId: '' },
			arrival: { effectId: 'boom' },
		},
		toMeter: {},
	}),
	{
		toTotal: {
			head: { kind: 'glow', scale: 5, tint: '#ffaa00' },
			arrival: { effectId: 'boom' },
			path: { bend: 1, padding: 0 },
			minMs: 121,
			maxMs: 10_000,
		},
		'toMeter:b': { stagger: 2000 },
	},
);
it(
	'normalize: nothing left ⇒ no block',
	normalizeFlights({ toTotal: { speed: 'fast' } }),
	undefined,
);
it('normalize: a non-object ⇒ no block', normalizeFlights('toTotal'), undefined);
it(
	'normalize: arc is clamped to −1…1 and an arc of 0 is kept (it beats an arced family)',
	[
		normalizeFlights({ toTotal: { path: { arc: 3 } } })?.toTotal?.path,
		normalizeFlights({ toTotal: { path: { arc: -0.4 } } })?.toTotal?.path,
		normalizeFlights({ toTotal: { path: { arc: 0 } } })?.toTotal?.path,
	],
	[{ arc: 1 }, { arc: -0.4 }, { arc: 0 }],
);
it(
	'normalize: size is clamped to 0.05…5 and a size ≤ 0 is dropped',
	[
		normalizeFlights({ toTotal: { size: 9 } })?.toTotal,
		normalizeFlights({ toTotal: { size: 0.01 } })?.toTotal,
		normalizeFlights({ toTotal: { size: 0 } }),
	],
	[{ size: 5 }, { size: 0.05 }, undefined],
);
it(
	'resolve: size needs no head and follows the toMeter family',
	[
		resolveFlightStyle({ toMeter: { size: 1.5 } }, 'toMeter:red').size,
		resolveFlightStyle({ toMeter: { size: 1.5 }, 'toMeter:red': { size: 0.5 } }, 'toMeter:red')
			.size,
		resolveFlightStyle({ toMeter: { size: 1.5 } }, 'toTotal').size,
	],
	[1.5, 0.5, 1],
);
it(
	'normalize: trail rotation is clamped to −180…180; align is a boolean; 0 / false are kept',
	[
		normalizeFlights({ toTotal: { trailRotation: 270, trailAlign: 'yes' } })?.toTotal,
		normalizeFlights({ toTotal: { trailRotation: 0, trailAlign: false } })?.toTotal,
	],
	[{ trailRotation: 180 }, { trailAlign: false, trailRotation: 0 }],
);
it(
	'resolve: trail align / rotation follow the toMeter family, an own false beats it',
	[
		resolveFlightStyle({ toMeter: { trailAlign: true, trailRotation: 90 } }, 'toMeter:red'),
		resolveFlightStyle(
			{ toMeter: { trailAlign: true }, 'toMeter:red': { trailAlign: false } },
			'toMeter:red',
		).trailAlign,
	].map((v) => (typeof v === 'object' ? [v.trailAlign, v.trailRotation] : v)),
	[[true, 90], false],
);
it(
	'heading: along a straight route, and the curve tangent at its ends',
	[
		headingOnCurve(
			{ p0: { x: 0, y: 0 }, c1: { x: 0, y: 0 }, c2: { x: 10, y: 0 }, p3: { x: 10, y: 0 } },
			0,
		),
		headingOnCurve(
			{ p0: { x: 0, y: 0 }, c1: { x: 0, y: -10 }, c2: { x: 10, y: -10 }, p3: { x: 10, y: 0 } },
			0,
		),
		headingOnCurve(
			{ p0: { x: 0, y: 0 }, c1: { x: 0, y: -10 }, c2: { x: 10, y: -10 }, p3: { x: 10, y: 0 } },
			1,
		),
	].map((r) => Math.round((r * 180) / Math.PI)),
	[0, -90, 90],
);
it(
	'resolve: arc follows the toMeter family and reaches the plan',
	flightPlanOptions(
		resolveFlightStyle({ toMeter: { path: { arc: 0.25 } } }, 'toMeter:red'),
		120,
		[],
	).arc,
	0.25,
);
it(
	'normalize: a head missing the field its kind needs is dropped',
	normalizeFlights({
		toTotal: { head: { kind: 'spine', assetKey: 'a/spines/x/' } },
		toCollector: { head: { kind: 'flipbook' } },
		boostBeam: { head: { kind: 'sprite', assetKey: 'atlas.json::coin' } },
	}),
	{ boostBeam: { head: { kind: 'sprite', assetKey: 'atlas.json::coin' } } },
);
it(
	'normalize: trail off wins over an effect',
	normalizeFlights({ toTotal: { trail: { off: true, effectId: 'x' } } }),
	{ toTotal: { trail: { off: true } } },
);
{
	const once = normalizeFlights(config);
	it('normalize is a fixed point', normalizeFlights(once), once);
}

it(
	'the effects a block plays — trails and arrivals, once each',
	flightEffectIds({
		toTotal: { trail: { effectId: 'a' }, arrival: { effectId: 'b' } },
		toMeter: { trail: { off: true }, arrival: { effectId: 'a' } },
	}).sort(),
	['a', 'b'],
);

{
	const zero = resolveFlightStyle({ toTotal: { minMs: 0, maxMs: 0 } }, 'toTotal');
	it('a 0 ms min / max is floored to one frame', [zero.minMs, zero.maxMs], [16, 16]);
	const ms = flightDuration(0, zero);
	it(
		'…so even a zero-length flight lasts a frame and progress is never 0/0',
		[ms, Number.isNaN(0 / ms)],
		[16, false],
	);
}
it('the coded ease is the coded curve', flightEaseOf('easeInOut'), flightEase);
it(
	'every ease runs 0 → 1 and clamps',
	(['linear', 'easeIn', 'easeOut', 'easeInOut'] as const).map((ease) => [
		flightEaseOf(ease)(-1),
		flightEaseOf(ease)(0),
		flightEaseOf(ease)(1),
		flightEaseOf(ease)(2),
	]),
	[
		[0, 0, 1, 1],
		[0, 0, 1, 1],
		[0, 0, 1, 1],
		[0, 0, 1, 1],
	],
);
it(
	'ease in starts slow, ease out starts fast',
	[flightEaseOf('easeIn')(0.25) < 0.25, flightEaseOf('easeOut')(0.25) > 0.25],
	[true, true],
);

it('no authored bend ⇒ the coded ladder', flightBendStrengths(undefined), FLIGHT_BEND_STRENGTHS);
it('bend 0 ⇒ no bends', flightBendStrengths(0), []);
it(
	'bend 0.55 (the coded top rung) ⇒ the coded ladder',
	flightBendStrengths(0.55).map((s) => Math.round(s * 1e9) / 1e9),
	FLIGHT_BEND_STRENGTHS,
);
it('the ladder is scaled so its top rung is the authored bend', flightBendStrengths(1).at(-1), 1);

{
	const avoid = [{ x: 260, y: -40, width: 80, height: 80 }];
	const coded = resolveFlightStyle(undefined, 'toTotal');
	const options = flightPlanOptions(coded, 120, avoid);
	it('the coded style plans with the coded options', options, {
		avoid,
		padding: 12,
		overMargin: 42,
		bendStrengths: FLIGHT_BEND_STRENGTHS,
		overRoute: true,
	});
	it(
		'…and so draws the route flyTo drew before the block existed',
		planFlight({ x: 0, y: 0 }, { x: 600, y: 0 }, options),
		planFlight({ x: 0, y: 0 }, { x: 600, y: 0 }, { avoid, padding: 12, overMargin: 42 }),
	);
	it(
		'avoidance off ⇒ the obstacles are dropped and the route is straight',
		planFlight(
			{ x: 0, y: 0 },
			{ x: 600, y: 0 },
			flightPlanOptions({ ...coded, avoid: false }, 120, avoid),
		).kind,
		'straight',
	);
	it(
		'no bends and no over-route ⇒ straight through, the fewest-hits fallback',
		planFlight(
			{ x: 0, y: 0 },
			{ x: 600, y: 0 },
			flightPlanOptions({ ...coded, bend: 0, overRoute: false }, 120, avoid),
		).kind,
		'straight',
	);
}

console.log(`\n${passed} flight style checks passed, ${failed} failed.`);
if (failed > 0) throw new Error('flight style fixture failed');
