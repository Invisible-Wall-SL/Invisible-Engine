/**
 * Per-key cubic easing and the timeline loop type (Rive plan Phase 9b) — the evaluator's format gate:
 *   pnpm --filter launcher-api check:cinematic-ease            # check
 *   pnpm --filter launcher-api check:cinematic-ease --update   # rewrite the golden (main only!)
 *
 *  1. PARITY: every built-in timeline the game ships (transition wipe, buttons, win tiers, free
 *     spins) and a synthetic doc using every legacy `ease` string (and junk) sample BYTE-IDENTICALLY
 *     to the golden captured from the evaluator before `ease: [x1, y1, x2, y2]` existed.
 *  2. CUBIC: a key's `ease: [x1, y1, x2, y2]` matches an independent reference cubic-bezier (a dense
 *     table, not the evaluator's solver) within 1e-4, on number, tint and countUp channels; the
 *     identity curve is linear; a malformed array falls back to linear; x is clamped to [0, 1] and y
 *     may overshoot.
 *  3. LOOP TYPE: `playbackTime` maps elapsed seconds to the time sampled for `loop` absent
 *     (one-shot), `loop` and `pingPong`.
 *  4. The editor's `defaultEase` is authoring-only: a key keeps the ease it was stamped with.
 *  5. The component player honours the loop type: `loop` wraps (and crosses its cue each lap),
 *     `pingPong` comes back (the way back crosses no cue), neither ends or holds a cue, and a doc
 *     without the field still ends on its last frame.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { CinematicDoc, LayoutNode } from 'engine-layout';
import * as EV from '../../../packages/engine-cinematic/src/cinematicEval.js';

const B = await import('../../../packages/engine-layout/src/lib/builtinTimelines.ts');
const GOLDEN = new URL('./check-cinematic-ease.golden.json', import.meta.url);

let failures = 0;
const ok = (label: string, cond: boolean, detail = ''): void => {
	if (cond) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};

type Track = Record<string, unknown> & { kind: string; actorId?: string | null };
type Key = { time: number; value?: number; ease?: unknown };

// ---- 1. parity ------------------------------------------------------------------------------

/** A synthetic doc with every legacy ease, junk eases, a tint, a countUp and a switchKey track. */
const LEGACY: CinematicDoc = {
	schemaVersion: 1,
	id: 'legacy_eases',
	name: 'legacy',
	duration: 3,
	fps: 30,
	host: { kind: 'screen', sceneId: 's' },
	stage: { sceneId: null, cast: [{ actorId: 'a', kind: 'node', target: 'n', place: {} }] },
	tracks: [
		{
			id: 'p',
			actorId: 'a',
			kind: 'property',
			channels: {
				x: [
					{ time: 0, value: 0, ease: 'linear' },
					{ time: 0.5, value: 40, ease: 'ease' },
					{ time: 1, value: -20, ease: 'hold' },
					{ time: 1.5, value: 10 },
					{ time: 2, value: 90, ease: 'bogus' },
					{ time: 2.5, value: 5, ease: null },
					{ time: 3, value: 7 },
				],
				scale: [
					{ time: 0.2, value: 0.5, ease: 'ease' },
					{ time: 2.2, value: 1.5 },
				],
				rotation: [
					{ time: 0, value: 0, ease: 'hold' },
					{ time: 1.1, value: 180, ease: 'linear' },
					{ time: 1.1, value: 90 },
					{ time: 2.9, value: -45 },
				],
				alpha: [{ time: 1, value: 0.25 }],
				tint: [
					{ time: 0, value: 0xff0000, ease: 'ease' },
					{ time: 1, value: 0x00ff00, ease: 'hold' },
					{ time: 2, value: 0x0000ff },
					{ time: 3, value: 0xffffff },
				],
				'fx:intensity': [
					{ time: 0, value: 0, ease: 'ease' },
					{ time: 3, value: 1 },
				],
			},
		},
		{
			id: 'v',
			actorId: 'a',
			kind: 'visibility',
			keys: [
				{ time: 0.4, visible: false },
				{ time: 1.6, visible: true },
			],
		},
		{
			id: 't',
			actorId: 'a',
			kind: 'text',
			mode: 'countUp',
			keys: [
				{ time: 0, value: 0, ease: 'ease' },
				{ time: 2, value: 1000 },
			],
		},
	],
	markers: [],
};

const tiers = [
	{ alias: 'big', intro: 'big_win_intro', idle: 'big_win_idle', outro: 'big_win_exit' },
	{ alias: 'mega', intro: 'mega_win_intro', idle: 'mega_win_idle', caption: 'MEGA WIN' },
];
const clipMs = {
	big_win_intro: 1333.3,
	big_win_idle: 12000,
	big_win_exit: 466.7,
	mega_win_intro: 1366.7,
	mega_win_idle: 12000,
};
const DOCS: CinematicDoc[] = [
	LEGACY,
	B.TRANSITION_WIPE_TIMELINE,
	...B.BUTTON_TIMELINES,
	...B.winTierTimelines(tiers, clipMs),
	...B.FREE_SPIN_TIMELINES,
];

/** The times a doc is sampled at: a grid over its first 10 s, every key's time and its edges. */
function timesOf(doc: CinematicDoc): number[] {
	const span = Math.min(Math.max(doc.duration || 0, 0), 10);
	const out = new Set<number>([-0.1, 0, span, doc.duration + 0.1]);
	for (let i = 0; i <= 240; i++) out.add((span * i) / 240);
	for (const track of doc.tracks as Track[]) {
		const lists = [
			...(Array.isArray(track.keys) ? [track.keys as Key[]] : []),
			...Object.values((track.channels as Record<string, Key[]>) ?? {}),
		];
		for (const keys of lists) for (const k of keys) out.add(k.time);
	}
	return [...out].sort((a, b) => a - b);
}

/** Everything the evaluator says about `doc` at each time, as one string. */
function sampleDoc(doc: CinematicDoc): string {
	const tracks = doc.tracks as Track[];
	const actors = [...new Set(tracks.map((t) => t.actorId ?? '·'))];
	const rows: unknown[] = [];
	for (const t of timesOf(doc)) {
		const row: unknown[] = [t];
		for (const track of tracks) {
			if (track.kind === 'property' || track.kind === 'camera') {
				const channels = (track.channels as Record<string, Key[]>) ?? {};
				for (const [name, keys] of Object.entries(channels)) {
					row.push(name === 'tint' ? EV.sampleTint(keys, t) : EV.sampleChannel(keys, t));
				}
				row.push(EV.sampleTrack(track, t));
			} else if (track.kind === 'visibility') row.push(EV.resolveVisible(true, [track], t));
			else if (track.kind === 'text') row.push(EV.sampleText(track, t));
		}
		for (const id of actors) {
			row.push(
				EV.sampleNodeActor(
					tracks.filter((tr) => (tr.actorId ?? '·') === id),
					t,
				),
			);
		}
		rows.push(row);
	}
	return JSON.stringify(rows, (_k, v) => (v === undefined ? '∅' : v));
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);
const current: Record<string, string> = {};
for (const doc of DOCS) current[doc.id] = sha(sampleDoc(doc));

if (process.argv.includes('--update')) {
	writeFileSync(GOLDEN, JSON.stringify(current, null, '\t') + '\n');
	console.log(`wrote ${Object.keys(current).length} doc hashes to ${GOLDEN.pathname}`);
	process.exit(0);
}

console.log('1. every existing timeline evaluates byte-identically');
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, string>;
ok(
	'the golden covers exactly the docs sampled here',
	JSON.stringify(Object.keys(golden).sort()) === JSON.stringify(Object.keys(current).sort()),
	`golden ${Object.keys(golden).length}, sampled ${Object.keys(current).length}`,
);
for (const [id, hash] of Object.entries(current)) {
	ok(`${id} unchanged`, golden[id] === hash);
}

// ---- 2. cubic --------------------------------------------------------------------------------

/** An independent cubic-bezier: a dense (x, y) table over the curve parameter, read at `u`. */
function referenceBezier(x1: number, y1: number, x2: number, y2: number): (u: number) => number {
	const cx = Math.min(Math.max(x1, 0), 1);
	const dx = Math.min(Math.max(x2, 0), 1);
	const N = 200_000;
	const xs = new Float64Array(N + 1);
	const ys = new Float64Array(N + 1);
	for (let i = 0; i <= N; i++) {
		const s = i / N;
		const a = 3 * (1 - s) * (1 - s) * s;
		const b = 3 * (1 - s) * s * s;
		xs[i] = a * cx + b * dx + s * s * s;
		ys[i] = a * y1 + b * y2 + s * s * s;
	}
	return (u) => {
		let lo = 0;
		let hi = N;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (xs[mid] <= u) lo = mid;
			else hi = mid;
		}
		const span = xs[hi] - xs[lo];
		const f = span > 0 ? (u - xs[lo]) / span : 0;
		return ys[lo] + (ys[hi] - ys[lo]) * f;
	};
}

console.log('2. a cubic ease matches a reference cubic-bezier');
const CURVES: [number, number, number, number][] = [
	[0.76, 0, 0.18, 1],
	[0.42, 0, 0.58, 1],
	[0.25, 0.1, 0.25, 1],
	[0, 0, 0.58, 1],
	[0.5, -0.6, 0.5, 1.6],
	[1, 0, 0, 1],
	[0.05, 0.9, 0.1, 1],
];
const U = Array.from({ length: 41 }, (_, i) => i / 40);
for (const curve of CURVES) {
	const ref = referenceBezier(...curve);
	const keys = [
		{ time: 1, value: 10, ease: curve },
		{ time: 3, value: 30 },
	];
	let worst = 0;
	for (const u of U) {
		const got = EV.sampleChannel(keys, 1 + 2 * u) as number;
		worst = Math.max(worst, Math.abs(got - (10 + 20 * ref(u))));
	}
	ok(`[${curve.join(', ')}] within 1e-4 (worst ${worst.toExponential(2)})`, worst < 1e-4);
}

const linearKeys = (ease: unknown): Key[] => [
	{ time: 0, value: 0, ease },
	{ time: 1, value: 100 },
];
const at = (ease: unknown, u: number): number => EV.sampleChannel(linearKeys(ease), u) as number;
ok(
	'[0, 0, 1, 1] is linear',
	U.every((u) => Math.abs(at([0, 0, 1, 1], u) - 100 * u) < 1e-6),
);
for (const junk of [[0.4, 0, 0.6], [0.4, Number.NaN, 0.6, 1], ['a', 0, 1, 1], [], {}]) {
	ok(
		`malformed ${JSON.stringify(junk)} falls back to linear`,
		U.every((u) => Math.abs(at(junk, u) - 100 * u) < 1e-9),
	);
}
{
	const clamped = referenceBezier(0, 0, 1, 1);
	ok(
		'x outside [0, 1] is clamped ([-2, 0, 3, 1] = [0, 0, 1, 1])',
		U.every((u) => Math.abs(at([-2, 0, 3, 1], u) - 100 * clamped(u)) < 1e-4),
	);
	const over = at([0.5, -0.6, 0.5, 1.6], 0.9);
	ok('y may overshoot the end value', over > 100, `at u=0.9: ${over}`);
}
{
	const curve: [number, number, number, number] = [0.76, 0, 0.18, 1];
	const ref = referenceBezier(...curve);
	const tint = EV.sampleTint(
		[
			{ time: 0, value: 0x000000, ease: curve },
			{ time: 1, value: 0xff0000 },
		],
		0.3,
	) as number;
	ok(
		'a tint channel eases per RGB channel on the cubic',
		tint >> 16 === Math.round(255 * ref(0.3)),
	);
	const text = EV.sampleText(
		{
			mode: 'countUp',
			keys: [
				{ time: 0, value: 0, ease: curve },
				{ time: 2, value: 1000 },
			],
		},
		0.5,
	) as { value: number };
	ok('a countUp text track eases on the cubic', Math.abs(text.value - 1000 * ref(0.25)) < 0.1);
	ok('easeShape exposes the same curve', Math.abs(EV.easeShape(curve)(0.3) - ref(0.3)) < 1e-4);
	ok('isCubicEase', EV.isCubicEase(curve) && !EV.isCubicEase('ease') && !EV.isCubicEase([1, 2]));
}

// ---- 3. loop type ----------------------------------------------------------------------------

console.log('3. the loop type maps elapsed time to sampled time');
const pt = (loop: unknown, elapsed: number): number => EV.playbackTime(loop, elapsed, 2);
ok('one-shot (absent) clamps to the end', pt(undefined, 2.5) === 2 && pt(undefined, 1.25) === 1.25);
ok('an unknown loop type reads as one-shot', pt('bounce', 3) === 2);
ok(
	'loop wraps',
	Math.abs(pt('loop', 2.5) - 0.5) < 1e-12 && Math.abs(pt('loop', 5.25) - 1.25) < 1e-12,
);
ok(
	'pingPong reflects at the end and comes back',
	Math.abs(pt('pingPong', 2.5) - 1.5) < 1e-12 &&
		Math.abs(pt('pingPong', 4) - 0) < 1e-12 &&
		Math.abs(pt('pingPong', 4.5) - 0.5) < 1e-12,
);
ok(
	'loopsForever',
	!EV.loopsForever(undefined) &&
		!EV.loopsForever('oneShot') &&
		EV.loopsForever('loop') &&
		EV.loopsForever('pingPong'),
);
ok(
	'a zero-length timeline stays at 0',
	EV.playbackTime('loop', 3, 0) === 0 && EV.playbackTime('pingPong', 3, 0) === 0,
);

// ---- 4. defaultEase is authoring-only ---------------------------------------------------------

console.log('4. a key keeps the ease it was stamped with');
{
	const keys: Key[] = [];
	EV.putKey(keys, 0, 0, [0.42, 0, 0.58, 1]);
	EV.putKey(keys, 0, 5, 'hold');
	ok(
		're-keying an existing key keeps its ease',
		JSON.stringify(keys[0].ease) === '[0.42,0,0.58,1]',
	);
	EV.putKey(keys, 1, 1);
	ok('a new key with no ease is linear', keys[1].ease === 'linear');
}

// ---- 5. the component player's loop type -----------------------------------------------------

console.log('5. the component player honours the loop type');
// Imported here, not above: `--update` runs on the evaluator from BEFORE the loop type existed.
const L = await import('../../../packages/engine-layout/src/lib/componentTimelines.ts');
{
	const nodes = [{ id: 'n1', kind: 'sprite', label: 'Coin', x: 0, y: 0 }] as LayoutNode[];
	const doc = (id: string, loop?: CinematicDoc['loop']): CinematicDoc =>
		({
			schemaVersion: 1,
			id,
			name: id,
			duration: 1,
			fps: 30,
			host: { kind: 'component', componentId: 'coin' },
			playOn: 'go',
			holdsCue: true,
			...(loop ? { loop } : {}),
			stage: { sceneId: null, cast: [{ actorId: 'a', kind: 'node', target: 'Coin', place: {} }] },
			tracks: [
				{
					id: 'p',
					kind: 'property',
					actorId: 'a',
					channels: {
						x: [
							{ time: 0, value: 0 },
							{ time: 1, value: 100 },
						],
					},
				},
				{ id: 'c', kind: 'cue', actorId: '', keys: [{ time: 0.5, cue: 'signal:mid' }] },
			],
			markers: [],
		}) as unknown as CinematicDoc;
	const run = (loop?: CinematicDoc['loop']) => {
		const p = new L.ComponentTimelinePlayer([doc('t', loop)], nodes);
		p.trigger('go');
		const cues: string[] = [];
		let completed = 0;
		for (let i = 0; i < 20; i++) {
			const step = p.advance(0.125);
			cues.push(...step.cues.map((c) => c.cue));
			completed += step.completed.length;
		}
		return { time: p.timeOf('t') as number, cues: cues.length, completed, holds: p.holdsOn('go') };
	};
	const once = run();
	ok(
		'absent: ends on its last frame, once, holding the cue',
		once.time === 1 && once.completed === 1 && once.cues === 1 && once.holds.length === 1,
	);
	const loop = run('loop');
	ok(
		`loop: wraps (t=${loop.time.toFixed(3)}), crosses its cue each lap, never ends or holds`,
		Math.abs(loop.time - 0.5) < 1e-9 &&
			loop.cues === 3 &&
			loop.completed === 0 &&
			loop.holds.length === 0,
	);
	const pp = run('pingPong');
	ok(
		`pingPong: comes back (t=${pp.time.toFixed(3)}), crosses its cue on the way out only, never ends or holds`,
		Math.abs(pp.time - 0.5) < 1e-9 && pp.cues === 2 && pp.completed === 0 && pp.holds.length === 0,
	);
}

if (failures) {
	console.error(`\n${failures} failure(s)`);
	process.exit(1);
}
console.log('\nall cinematic-ease checks passed');
