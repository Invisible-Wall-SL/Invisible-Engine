/**
 * A flight's route (`engine-layout` `flightPath.ts`): straight when nothing is in the way, a bend that misses a
 * blocking obstacle, the fewest hits when every route is blocked, the same route for the same
 * inputs, and a duration that clamps.
 *
 * Run: node --experimental-strip-types packages/engine-game/fixtures/flightPath.fixture.ts
 */
import {
	curveLength,
	flightDuration,
	flightEase,
	flightStagger,
	planFlight,
	pointOnCurve,
	type FlightRect,
	type FlightRoute,
} from '../../engine-layout/src/lib/flightPath.ts';

// No `node:assert` — the package has no Node types, and svelte-check reads this file too.
const assert = {
	equal: (actual: unknown, expected: unknown) => {
		if (actual !== expected) throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
	},
	ok: (value: boolean, message: string) => {
		if (!value) throw new Error(message);
	},
	deepEqual: (actual: unknown, expected: unknown) => {
		const a = JSON.stringify(actual);
		const e = JSON.stringify(expected);
		if (a !== e) throw new Error(`expected ${e}, got ${a}`);
	},
};

let passed = 0;
let failed = 0;
const it = (label: string, run: () => void) => {
	try {
		run();
		passed += 1;
		console.log(`  ok  ${label}`);
	} catch (error) {
		failed += 1;
		console.log(`FAIL  ${label}
        ${(error as Error).message}`);
	}
};

const missesAll = (route: FlightRoute, rects: FlightRect[], padding: number): boolean => {
	for (let i = 1; i < 200; i++) {
		const p = pointOnCurve(route.curve, i / 200);
		for (const r of rects) {
			if (
				p.x >= r.x - padding &&
				p.x <= r.x + r.width + padding &&
				p.y >= r.y - padding &&
				p.y <= r.y + r.height + padding
			) {
				return false;
			}
		}
	}
	return true;
};

const from = { x: 0, y: 0 };
const to = { x: 600, y: 0 };

it('nothing in the way ⇒ the straight route, clean, its length the distance', () => {
	const route = planFlight(from, to);
	assert.equal(route.kind, 'straight');
	assert.equal(route.hits, 0);
	assert.ok(Math.abs(route.length - 600) < 1e-6, `length ${route.length}`);
});

it('an obstacle off the line does not bend the route', () => {
	const route = planFlight(from, to, { avoid: [{ x: 250, y: 200, width: 100, height: 100 }] });
	assert.equal(route.kind, 'straight');
});

it('a blocking obstacle forces a bend that misses it', () => {
	const block = { x: 260, y: -40, width: 80, height: 80 };
	const route = planFlight(from, to, { avoid: [block], padding: 10 });
	assert.ok(route.kind === 'bendLeft' || route.kind === 'bendRight', `kind ${route.kind}`);
	assert.equal(route.hits, 0);
	assert.ok(missesAll(route, [block], 10), 'the chosen bend still crosses the obstacle');
});

it('the gentlest clean bend wins — a small block does not get the strongest bend', () => {
	const route = planFlight(from, to, { avoid: [{ x: 280, y: -20, width: 40, height: 40 }] });
	assert.equal(route.strength, 0.2);
});

it('blocked on one side ⇒ bends to the other', () => {
	// y grows down: travelling +x, LEFT of travel is -y (up the screen).
	const above = { x: 200, y: -200, width: 200, height: 220 };
	const route = planFlight(from, to, { avoid: [above] });
	assert.equal(route.kind, 'bendRight');
	assert.ok(pointOnCurve(route.curve, 0.5).y > 0, 'a right bend travelling +x goes down-screen');
});

it('bends blocked on both sides ⇒ the over-route clears the top of the obstacles', () => {
	const tall = { x: 280, y: -100, width: 40, height: 1000 };
	const route = planFlight({ x: 0, y: 300 }, { x: 600, y: 300 }, { avoid: [tall] });
	assert.equal(route.kind, 'over');
	assert.equal(route.hits, 0);
	assert.ok(pointOnCurve(route.curve, 0.5).y < -100, 'apex is above the obstacle');
});

it('no route is clean ⇒ the fewest hits', () => {
	const wall = { x: 280, y: -10_000, width: 40, height: 20_000 };
	const shelf = { x: 100, y: -10_000, width: 400, height: 9_950 };
	const route = planFlight(from, to, { avoid: [wall, shelf], overRoute: false });
	assert.ok(route.hits > 0, 'expected a blocked route');
	const straight = planFlight(from, to, {
		avoid: [wall, shelf],
		bendStrengths: [],
		overRoute: false,
	});
	assert.ok(
		route.hits <= straight.hits,
		`chose ${route.hits} hits over straight's ${straight.hits}`,
	);
	for (const strength of [0.2, 0.35, 0.55]) {
		const only = planFlight(from, to, {
			avoid: [wall, shelf],
			bendStrengths: [strength],
			overRoute: false,
		});
		assert.ok(route.hits <= only.hits, `a ${strength} candidate had fewer hits`);
	}
});

it('an obstacle around the source or the target is ignored', () => {
	const ownCell = { x: -50, y: -50, width: 100, height: 100 };
	const targetBox = { x: 550, y: -50, width: 100, height: 100 };
	const route = planFlight(from, to, { avoid: [ownCell, targetBox] });
	assert.equal(route.kind, 'straight');
	assert.equal(route.hits, 0);
});

it('the same inputs give the same route, byte for byte', () => {
	const avoid = [
		{ x: 100, y: -60, width: 120, height: 120 },
		{ x: 380, y: -10, width: 60, height: 200 },
	];
	const a = planFlight({ x: 10, y: 20 }, { x: 700, y: -150 }, { avoid, padding: 12 });
	const b = planFlight({ x: 10, y: 20 }, { x: 700, y: -150 }, { avoid, padding: 12 });
	assert.deepEqual(a, b);
});

it('the route starts at the source and ends at the target', () => {
	const route = planFlight(
		{ x: 5, y: 7 },
		{ x: -300, y: 410 },
		{
			avoid: [{ x: -200, y: 150, width: 100, height: 100 }],
		},
	);
	assert.deepEqual(pointOnCurve(route.curve, 0), { x: 5, y: 7 });
	const end = pointOnCurve(route.curve, 1);
	assert.ok(Math.abs(end.x + 300) < 1e-9 && Math.abs(end.y - 410) < 1e-9, 'end point');
});

it('curve length of a bend exceeds the straight distance', () => {
	const route = planFlight(from, to, { avoid: [{ x: 280, y: -20, width: 40, height: 40 }] });
	assert.ok(curveLength(route.curve) > 600, 'a bend is longer than the chord');
});

it('duration = distance / speed, clamped to [min, max]', () => {
	const opts = { speed: 2, minMs: 300, maxMs: 900 };
	assert.equal(flightDuration(1000, opts), 500);
	assert.equal(flightDuration(100, opts), 300);
	assert.equal(flightDuration(10_000, opts), 900);
	assert.equal(flightDuration(-1000, opts), 500);
	assert.equal(flightDuration(1000, { ...opts, speed: 0 }), 900);
});

it('stagger spaces a volley and never goes negative', () => {
	assert.equal(flightStagger(0, 80), 0);
	assert.equal(flightStagger(3, 80), 240);
	assert.equal(flightStagger(-2, 80), 0);
	assert.equal(flightStagger(2, -5), 0);
});

it('no arc ⇒ the same straight route as before the knob existed', () => {
	assert.deepEqual(planFlight(from, to, { arc: 0 }), planFlight(from, to));
	assert.equal(planFlight(from, to).kind, 'straight');
});

it('a positive arc bows the route UP with nothing in the way, either direction of travel', () => {
	const right = planFlight(from, to, { arc: 0.3 });
	assert.equal(right.kind, 'arc');
	assert.ok(pointOnCurve(right.curve, 0.5).y < -100, 'rightward flight bows up');
	const left = planFlight(to, from, { arc: 0.3 });
	assert.ok(pointOnCurve(left.curve, 0.5).y < -100, 'leftward flight bows up');
	const down = planFlight(from, to, { arc: -0.3 });
	assert.ok(pointOnCurve(down.curve, 0.5).y > 100, 'a negative arc bows down');
});

it('an obstacle on the arc still gets a detour', () => {
	const onArc = { x: 260, y: -160, width: 80, height: 80 };
	const route = planFlight(from, to, { arc: 0.3, avoid: [onArc] });
	assert.ok(route.kind !== 'arc', `kept the blocked arc (${route.kind})`);
	assert.equal(route.hits, 0);
});

it('the ease runs 0 → 1 and clamps outside it', () => {
	assert.equal(flightEase(0), 0);
	assert.equal(flightEase(1), 1);
	assert.equal(flightEase(0.5), 0.5);
	assert.equal(flightEase(-1), 0);
	assert.equal(flightEase(2), 1);
});

console.log(`
${passed} flight path checks passed, ${failed} failed.`);
if (failed > 0) throw new Error('flight path fixture failed');
