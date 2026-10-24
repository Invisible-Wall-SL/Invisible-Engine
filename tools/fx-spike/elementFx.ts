/**
 * ELEMENT FX — the headless gate (`docs/design/element-fx.md`). Drives the real runtime
 * (`pixi-svelte/src/lib/elementFx`) on real Pixi containers with a hand-stepped ticker, and holds
 * the catalog, the reader and the engine wiring to it.
 *
 *   pnpm --filter fx-spike run element-fx      (root: pnpm check:element-fx)
 *
 * Proves, offline:
 *  1. The catalog: unique kinds, sane param specs, and an implementation for every kind (and none
 *     for a kind the catalog lacks).
 *  2. The reader: unknown kinds, triggers and params dropped; numbers clamped; repeat ids dropped;
 *     the cue names a list listens for.
 *  3. Every motion sampler is finite everywhere, an emphasis / loop / enter kind ends at rest, an
 *     exit kind ends hidden, and an enter kind starts hidden.
 *  4. The runtime: a play moves the container and puts it back EXACTLY; a value the owner writes
 *     mid-play is kept; an exit holds the element hidden until stopped or an enter plays; a break
 *     with no renderer fades instead; filters stack after the container's own and leave with its
 *     own list and filter area intact; nothing is filtered before the element has a size; a
 *     destroyed container settles everything; the time scale (turbo) speeds plays up.
 *  5. The shaders compile on WebGL1 too: no GLSL ES 3.00-only built-in in any fragment source.
 *     They share one GLSL library: a pass gets exactly the building blocks it calls, and no pass
 *     carries a private copy of one.
 *  6. The wiring: nodes, screens and the reels play authored FX and register the Flow's targets;
 *     the Flow declares and implements `elementEffect` / `stopElementEffect`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	Container,
	DOMAdapter,
	Filter,
	GlProgram,
	Graphics,
	Matrix,
	MeshSimple,
	Rectangle,
	Texture,
	TextureSource,
	Ticker,
} from 'pixi.js';
import {
	ELEMENT_FX,
	ELEMENT_FX_CHANNEL_PREFIX,
	ELEMENT_FX_KINDS,
	elementFxChannels,
	elementFxCueNames,
	elementFxEnterEnds,
	elementFxIntensityChannel,
	elementFxOfChannel,
	elementFxProgressChannel,
	readElementFxEntries,
	readElementFxEntry,
	resolveElementFxParams,
	type ElementFxKind,
} from '../../packages/constants-shared/elementFx';
import { stateFxGate } from '../../apps/lines/src/game/stateFxGate';
import {
	ELEMENT_FX_CHANNEL_PREFIX as CINEMATIC_ELEMENT_FX_PREFIX,
	sampleNodeActor,
} from '../../packages/engine-cinematic/src/cinematicEval.js';
import {
	keyableElementFxEntries,
	validateNodeActors,
} from '../../packages/engine-layout/src/lib/cinematicNodes';
import { blendNodeSamples } from '../../packages/engine-layout/src/lib/stateMachine';
import { startBreak } from '../../packages/pixi-svelte/src/lib/elementFx/breakApart';
import {
	EFX_GLSL,
	EFX_SIDES,
	efxSide,
	linkGlsl,
} from '../../packages/constants-shared/glslLibrary';
import * as SHADERS from '../../packages/pixi-svelte/src/lib/elementFx/shaders';
import type { ElementFxFilter } from '../../packages/pixi-svelte/src/lib/elementFx/shaders';
import { KINDS } from '../../packages/pixi-svelte/src/lib/elementFx/kinds';
import { REST, type FxFrame } from '../../packages/pixi-svelte/src/lib/elementFx/frame';
import {
	elementFxCount,
	playElementFx,
	stopElementFx,
	type ElementFxHost,
} from '../../packages/pixi-svelte/src/lib/elementFx/runtime';

// Building a GL program probes a canvas for the fragment precision; Node has none, so the probe
// gets a canvas with no context and Pixi falls back to mediump. Nothing is drawn here.
DOMAdapter.set({
	...DOMAdapter.get(),
	createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement,
});

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

// -------------------------------------------------------------------------------------------------
console.log('element fx — the catalog');
{
	const kinds = ELEMENT_FX.map((s) => s.kind);
	assert(new Set(kinds).size === kinds.length, `${kinds.length} kinds, each named once`);
	const implemented = Object.keys(KINDS).sort();
	assert(
		JSON.stringify(implemented) === JSON.stringify([...kinds].sort()),
		'every kind has an implementation, and every implementation a kind',
	);
	const bad: string[] = [];
	for (const spec of ELEMENT_FX) {
		if (!(spec.durationMs >= 50)) bad.push(`${spec.kind}.durationMs`);
		const ids = spec.params.map((p) => p.id);
		if (new Set(ids).size !== ids.length) bad.push(`${spec.kind} param ids`);
		for (const p of spec.params) {
			if (p.kind === 'number' && !(p.min <= p.default && p.default <= p.max)) {
				bad.push(`${spec.kind}.${p.id} default outside min..max`);
			}
			if (p.kind === 'choice' && !p.options.includes(p.default)) {
				bad.push(`${spec.kind}.${p.id} default not an option`);
			}
			if (p.kind === 'color' && !/^#[0-9a-f]{6}$/.test(p.default)) {
				bad.push(`${spec.kind}.${p.id} default not #rrggbb`);
			}
		}
		const impl = KINDS[spec.kind];
		if (!impl.motion && !impl.filter && !impl.breaks) bad.push(`${spec.kind} does nothing`);
	}
	assert(!bad.length, `every spec is sane${bad.length ? `: ${bad.join(', ')}` : ''}`);
	assert(
		ELEMENT_FX.filter((s) => s.phase === 'exit').every(
			(s) => s.kind !== 'crash' || KINDS.crash.breaks === 'crash',
		),
		'crash breaks into shards',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('element fx — the reader');
{
	assert(
		readElementFxEntry({ id: 'a', kind: 'video', trigger: 'always' }) === undefined,
		'an unknown kind is dropped',
	);
	assert(
		readElementFxEntry({ id: 'a', kind: 'shake', trigger: 'sometimes' }) === undefined,
		'an unknown trigger is dropped',
	);
	assert(
		readElementFxEntry({ kind: 'shake', trigger: 'always' }) === undefined,
		'an entry with no id is dropped',
	);
	const e = readElementFxEntry({
		id: ' a ',
		kind: 'glow',
		trigger: 'cue',
		cue: ' bigWin ',
		stopCue: '',
		durationMs: 1e9,
		delayMs: -5,
		intensity: Number.NaN,
		repeat: 2.6,
		params: { color: '#FFAA00', distance: 999, strength: 'loud', bogus: 1 },
		disabled: 'yes',
	});
	assert(
		e?.id === 'a' && e.cue === 'bigWin' && e.stopCue === undefined,
		'names are trimmed, blanks dropped',
	);
	assert(e?.durationMs === 20_000 && e.delayMs === 0, 'times are clamped to their limits');
	assert(e?.intensity === undefined, 'a NaN intensity is dropped (default 1)');
	assert(e?.repeat === 3, 'repeat is a whole number');
	assert(
		JSON.stringify(e?.params) === JSON.stringify({ color: '#ffaa00', distance: 40 }),
		'params: a colour lower-cased, a number clamped, a mistyped and an unknown one dropped',
	);
	assert(e?.disabled === undefined, 'disabled only when true');
	const list = readElementFxEntries([
		{ id: 'x', kind: 'pulse', trigger: 'enter' },
		{ id: 'x', kind: 'spin', trigger: 'enter' },
		'junk',
		{ id: 'y', kind: 'shine', trigger: 'cue', cue: 'win', stopCue: 'idle' },
		{ id: 'z', kind: 'shine', trigger: 'cue', cue: 'off', disabled: true },
	]);
	assert(list.map((x) => x.id).join() === 'x,y,z', 'a repeat id and junk are dropped');
	assert(
		JSON.stringify(elementFxCueNames(list)) === JSON.stringify(['win', 'idle']),
		'cue names: plays and stops, not a disabled entry',
	);
	assert(
		readElementFxEntries(undefined).length === 0 && readElementFxEntries({}).length === 0,
		'no list ⇒ none',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('element fx — the motion samplers');
{
	const frame = (kind: ElementFxKind, t: number, looping = false): FxFrame => ({
		t,
		seconds: t * 0.8,
		playSeconds: 0.8,
		intensity: 1,
		params: resolveElementFxParams(kind, undefined),
		looping,
		width: 120,
		height: 160,
	});
	const finiteAll: string[] = [];
	const notRest: string[] = [];
	for (const spec of ELEMENT_FX) {
		const motion = KINDS[spec.kind].motion;
		if (!motion) continue;
		for (let i = 0; i <= 200; i++) {
			for (const looping of [false, true]) {
				const m = { ...REST, ...motion(frame(spec.kind, i / 200, looping)) };
				if (!Object.values(m).every(Number.isFinite)) finiteAll.push(`${spec.kind}@${i / 200}`);
			}
		}
		const end = { ...REST, ...motion(frame(spec.kind, 1)) };
		const turned = Math.abs(Math.sin(end.rotation)) < 1e-6 && Math.cos(end.rotation) > 0;
		if (spec.phase === 'exit') {
			if (!(end.alpha < 1e-6 || Math.abs(end.scaleX) < 1e-3))
				notRest.push(`${spec.kind} ends visible`);
		} else if (!(
			near(end.x, 0, 1e-6) &&
			near(end.y, 0, 1e-6) &&
			near(end.scaleX, 1, 1e-6) &&
			near(end.scaleY, 1, 1e-6) &&
			turned &&
			near(end.alpha, 1, 1e-6)
		)) {
			notRest.push(`${spec.kind} ends off rest ${JSON.stringify(end)}`);
		}
		if (spec.phase === 'enter') {
			const start = { ...REST, ...motion(frame(spec.kind, 0)) };
			if (!(start.alpha < 1e-6 || Math.abs(start.scaleX) < 1e-3))
				notRest.push(`${spec.kind} starts visible`);
		}
	}
	assert(
		!finiteAll.length,
		`every motion sample is finite${finiteAll.length ? `: ${finiteAll.slice(0, 5)}` : ''}`,
	);
	assert(
		!notRest.length,
		`rest at the end, hidden where it should be${notRest.length ? `: ${notRest.join('; ')}` : ''}`,
	);

	const melt = KINDS.melt;
	const pass = melt.filter?.create(frame('melt', 0));
	const at = (t: number): { run: number; room: number } => {
		melt.filter?.update(pass as Filter, frame('melt', t), { screenWidth: 120, screenHeight: 160 });
		return {
			run: Array.from((pass as unknown as { efx: { uMelt: Float32Array } }).efx.uMelt)[0],
			room: melt.filter?.padding?.(frame('melt', t), { screenWidth: 120, screenHeight: 160 }) ?? 0,
		};
	};
	const [start, mid, end] = [at(0), at(0.5), at(1)];
	assert(
		start.run === 0 && start.room <= 2 && mid.run > 0 && end.run === 1 && end.room > mid.room,
		'melt starts untouched, runs to its end, and its pass makes more room below as it runs',
	);
	assert(
		near(melt.motion?.(frame('melt', 0.6)).alpha ?? 0, 1) &&
			near(melt.motion?.(frame('melt', 1)).alpha ?? 1, 0),
		'and it stays whole while it runs, then fades out at the end',
	);
	pass?.destroy();

	const freeze = KINDS.freeze;
	const ice = freeze.filter?.create(frame('freeze', 0));
	const iced = (t: number): { cover: number; glint: number } => {
		freeze.filter?.update(ice as Filter, frame('freeze', t), {
			screenWidth: 120,
			screenHeight: 160,
		});
		const u = (ice as unknown as { efx: { uFreeze: Float32Array; uGlint: Float32Array } }).efx;
		return { cover: u.uFreeze[0], glint: u.uGlint[1] };
	};
	const [bare, icing, held, thawed] = [iced(0), iced(0.15), iced(0.5), iced(1)];
	assert(
		bare.cover === 0 &&
			icing.cover > 0 &&
			icing.cover < 1 &&
			near(held.cover, 1) &&
			near(thawed.cover, 0) &&
			held.glint > -1 &&
			bare.glint < -1 &&
			icing.glint < -1 &&
			thawed.glint < -1,
		'freeze ices over, holds frozen with a glint sweeping across, and thaws back',
	);
	const shiver = (t: number): number => freeze.motion?.(frame('freeze', t)).x ?? 0;
	assert(
		Math.abs(shiver(0.32)) > 0 && shiver(0.1) === 0 && shiver(0.5) === 0,
		'it shivers only as the ice locks in',
	);
	ice?.destroy();

	const burn = KINDS.burn;
	const fire = burn.filter?.create(frame('burn', 0));
	const front = (t: number): number => {
		burn.filter?.update(fire as Filter, frame('burn', t), { screenWidth: 120, screenHeight: 160 });
		return (fire as unknown as { efx: { uBurn: Float32Array } }).efx.uBurn[0];
	};
	assert(
		front(0) < 0 && front(0.25) < front(0.5) && front(0.5) < front(0.75) && front(1) >= 1.65,
		'burn: the fire starts short of the element, sweeps on, and is past all its ash by the end',
	);
	fire?.destroy();

	const poison = KINDS.poison;
	const venom = poison.filter?.create(frame('poison', 0));
	const dose = (t: number, looping = false): number => {
		poison.filter?.update(venom as Filter, frame('poison', t, looping), {
			screenWidth: 120,
			screenHeight: 160,
		});
		return (venom as unknown as { efx: { uPoison: Float32Array } }).efx.uPoison[0];
	};
	const sway = (t: number): number => poison.motion?.(frame('poison', t)).rotation ?? 0;
	assert(
		dose(0) === 0 &&
			near(dose(0.5), 1) &&
			dose(1) === 0 &&
			near(dose(0, true), 1) &&
			near(sway(0), 0) &&
			near(sway(1), 0) &&
			Math.abs(sway(0.25)) > 0,
		'poison seeps in and out of a counted play, stays full while it loops, and sways between',
	);
	venom?.destroy();

	const electrocute = KINDS.electrocute;
	const arcs = electrocute.filter?.create(frame('electrocute', 0));
	const view = { screenWidth: 120, screenHeight: 160 };
	const bite = (t: number, looping = false): { amount: number; room: number } => {
		const f = frame('electrocute', t, looping);
		electrocute.filter?.update(arcs as Filter, f, view);
		return {
			amount: (arcs as unknown as { efx: { uZap: Float32Array } }).efx.uZap[0],
			room: electrocute.filter?.padding?.(f, view) ?? 0,
		};
	};
	const jolt = (t: number): number => {
		const m = electrocute.motion?.(frame('electrocute', t)) ?? {};
		return Math.abs(m.x ?? 0) + Math.abs(m.y ?? 0) + Math.abs(m.rotation ?? 0);
	};
	const [struck, biting, freed] = [bite(0), bite(0.5), bite(1)];
	assert(
		struck.amount === 0 &&
			near(biting.amount, 1) &&
			freed.amount === 0 &&
			near(bite(0, true).amount, 1) &&
			biting.room > 0 &&
			freed.room === 0 &&
			jolt(0) === 0 &&
			jolt(1) === 0 &&
			jolt(0.43) > 0,
		'electrocute bites at once, holds while it loops, makes room for its arcs only while they bite, and jitters between',
	);
	arcs?.destroy();

	const petrify = KINDS.petrify;
	const rock = petrify.filter?.create(frame('petrify', 0));
	const stony = (t: number): { cover: number; flaking: number; dust: number } => {
		petrify.filter?.update(rock as Filter, frame('petrify', t), {
			screenWidth: 120,
			screenHeight: 160,
		});
		const u = (rock as unknown as { efx: { uStone: Float32Array; uChip: Float32Array } }).efx;
		return { cover: u.uStone[0], flaking: u.uChip[0], dust: u.uChip[1] };
	};
	const [flesh, setting, stone, chipping, crumbled] = [
		stony(0),
		stony(0.15),
		stony(0.5),
		stony(0.85),
		stony(1),
	];
	assert(
		flesh.cover === 0 &&
			setting.cover > 0 &&
			setting.cover < 1 &&
			setting.flaking === 0 &&
			setting.dust > 0 &&
			near(stone.cover, 1) &&
			stone.flaking === 0 &&
			stone.dust === 0 &&
			chipping.cover > 0 &&
			near(chipping.cover + chipping.flaking, 1) &&
			chipping.flaking > 0 &&
			chipping.dust === 0 &&
			near(crumbled.cover, 0),
		'petrify creeps in with a dusty front, holds as stone, then flakes off in chips',
	);
	const thud = (t: number): number => petrify.motion?.(frame('petrify', t)).y ?? 0;
	assert(
		thud(0.34) > 0 && thud(0.1) === 0 && thud(0.5) === 0 && thud(0.9) === 0,
		'and it drops with a thud only as the stone locks',
	);
	rock?.destroy();

	const gold = KINDS.turnToGold;
	const metal = gold.filter?.create(frame('turnToGold', 0));
	const gilded = (
		t: number,
	): { cover: number; glint: number; molten: number; sparkles: number } => {
		gold.filter?.update(metal as Filter, frame('turnToGold', t), {
			screenWidth: 120,
			screenHeight: 160,
		});
		const u = (metal as unknown as { efx: { uGold: Float32Array; uShine: Float32Array } }).efx;
		return { cover: u.uGold[0], glint: u.uShine[0], molten: u.uShine[2], sparkles: u.uShine[1] };
	};
	const [plain, gilding, golden, ungilding, restored] = [
		gilded(0),
		gilded(0.15),
		gilded(0.5),
		gilded(0.85),
		gilded(1),
	];
	assert(
		plain.cover === 0 &&
			gilding.cover > 0 &&
			gilding.cover < 1 &&
			gilding.molten === 1 &&
			gilding.glint < -1 &&
			near(golden.cover, 1) &&
			golden.molten === 0 &&
			golden.glint > -1 &&
			golden.sparkles === 1 &&
			ungilding.cover > 0 &&
			ungilding.cover < 1 &&
			ungilding.molten === 0 &&
			ungilding.glint < -1 &&
			near(restored.cover, 0),
		'gold spreads behind a molten front, holds with a glint and sparkles, then draws back',
	);
	const ring = (t: number): number => gold.motion?.(frame('turnToGold', t)).scaleX ?? 1;
	assert(
		ring(0.34) > 1 && ring(0.1) === 1 && ring(0.5) === 1 && ring(0.9) === 1,
		'and it swells as it rings only as the gold sets',
	);
	metal?.destroy();
}

// -------------------------------------------------------------------------------------------------
console.log('element fx — a symbol state’s beat');
{
	const enter = (repeat?: number, disabled?: boolean) =>
		readElementFxEntry({ id: 'e', kind: 'shake', trigger: 'enter', repeat, disabled })!;
	assert(
		elementFxEnterEnds(enter()) &&
			elementFxEnterEnds(enter(3)) &&
			!elementFxEnterEnds(enter(0)) &&
			!elementFxEnterEnds(enter(1, true)) &&
			!elementFxEnterEnds(readElementFxEntry({ id: 'a', kind: 'glow', trigger: 'always' })!),
		'an enter entry with a count of plays ends; one set to 0, a disabled one and an always loop do not',
	);
	const beat = (waits: boolean, ownArt: boolean) => {
		let reports = 0;
		return { gate: stateFxGate(waits, ownArt, () => reports++), reports: () => reports };
	};
	const still = beat(true, true);
	still.gate.art();
	const heldForFx = still.reports();
	still.gate.fx();
	const afterFx = still.reports();
	still.gate.art();
	assert(
		heldForFx === 0 && afterFx === 1 && still.reports() === 2,
		'a still picture completing at once is held until the land shake has played out, then passes through',
	);
	const longArt = beat(true, true);
	longArt.gate.fx();
	const fxFirst = longArt.reports();
	longArt.gate.art();
	assert(
		fxFirst === 0 && longArt.reports() === 1,
		'art longer than the effect still sets the pace',
	);
	const borrowed = beat(true, false);
	borrowed.gate.fx();
	borrowed.gate.fx();
	assert(
		borrowed.reports() === 1,
		'a state with no art of its own (it may never report) is paced by its effect alone, once',
	);
	const plain = beat(false, false);
	plain.gate.art();
	plain.gate.fx();
	plain.gate.art();
	assert(
		plain.reports() === 2,
		'with no effect to wait for, every art completion passes straight through',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('element fx — the runtime');

const makeHost = (scale = 1): { host: ElementFxHost; advance: (ms: number) => void } => {
	const ticker = new Ticker();
	ticker.autoStart = false;
	ticker.stop();
	let now = 1000;
	ticker.update(now);
	return {
		host: { ticker, timeScale: () => scale },
		advance: (ms) => {
			const end = now + ms;
			while (now < end) {
				now = Math.min(end, now + 16);
				ticker.update(now);
			}
		},
	};
};

const makeTarget = (): Container => {
	const parent = new Container();
	const target = new Container();
	target.boundsArea = new Rectangle(-50, -60, 100, 120);
	target.position.set(300, 200);
	target.scale.set(1.5, 1.5);
	target.pivot.set(4, 2);
	target.rotation = 0.2;
	target.alpha = 0.8;
	parent.addChild(target);
	return target;
};

const snapshot = (c: Container) => [
	c.x,
	c.y,
	c.scale.x,
	c.scale.y,
	c.rotation,
	c.skew.x,
	c.skew.y,
	c.alpha,
];

{
	const { host, advance } = makeHost();
	const target = makeTarget();
	const rest = snapshot(target);
	const handle = playElementFx(target, { kind: 'bounce', durationMs: 600 }, host);
	advance(200);
	assert(JSON.stringify(snapshot(target)) !== JSON.stringify(rest), 'a play moves the container');
	assert(elementFxCount(target) === 1 && handle.active, 'one effect playing');
	let settled = false;
	void handle.done.then(() => (settled = true));
	advance(500);
	await Promise.resolve();
	assert(
		JSON.stringify(snapshot(target)) === JSON.stringify(rest),
		'it ends with every value exactly as it was',
	);
	assert(
		elementFxCount(target) === 0 && settled && !handle.active,
		'and leaves, its promise settled',
	);
}
{
	const { host, advance } = makeHost();
	const target = makeTarget();
	playElementFx(target, { kind: 'shake', durationMs: 600 }, host);
	advance(160);
	target.x = 512;
	target.alpha = 0.3;
	advance(160);
	assert(
		Math.abs(target.x - 512) < 60,
		'a value the owner writes mid-play becomes the rest the shake moves about',
	);
	advance(400);
	assert(target.x === 512 && target.alpha === 0.3, 'and is kept when the play ends');
}
{
	const { host, advance } = makeHost();
	const target = makeTarget();
	const out = playElementFx(target, { kind: 'fadeOut', durationMs: 300 }, host);
	advance(400);
	assert(target.alpha === 0 && out.active, 'an exit holds the element hidden after it plays');
	playElementFx(target, { kind: 'popIn', durationMs: 300 }, host);
	assert(!out.active, 'an enter releases the held exit');
	advance(400);
	assert(
		near(target.alpha, 0.8) && elementFxCount(target) === 0,
		'and the element is back at rest',
	);
	const again = playElementFx(target, { kind: 'dissolveOut', durationMs: 200 }, host);
	advance(300);
	assert(again.active && target.filters?.length === 1, 'a held dissolve keeps its pass');
	stopElementFx(target);
	assert(!again.active && !target.filters?.length && near(target.alpha, 0.8), 'stop puts it back');
}
{
	const { host, advance } = makeHost();
	const target = makeTarget();
	const rest = snapshot(target);
	const crash = playElementFx(target, { kind: 'crash', durationMs: 400 }, host);
	advance(100);
	assert(target.alpha < 0.8, 'a break with no renderer fades instead');
	advance(400);
	assert(target.alpha === 0 && crash.active, 'and holds hidden like any exit');
	crash.stop();
	assert(JSON.stringify(snapshot(target)) === JSON.stringify(rest), 'stop restores it exactly');
}
{
	const { host, advance } = makeHost();
	const target = makeTarget();
	const own = new Filter({
		glProgram: GlProgram.from({ vertex: 'void main(){}', fragment: 'void main(){}', name: 'own' }),
	});
	target.filters = [own];
	const glow = playElementFx(target, { kind: 'glow', durationMs: 400 }, host);
	const wave = playElementFx(target, { kind: 'waveX', durationMs: 400, repeat: 0 }, host);
	advance(50);
	assert(
		target.filters?.length === 3 && target.filters[0] === own,
		'passes stack after the container’s own filter',
	);
	assert(target.filterArea !== undefined, 'the passes are bounded to the element');
	glow.stop();
	advance(16);
	assert(target.filters?.length === 2 && target.filters[0] === own, 'one ends, the others stay');
	wave.stop();
	assert(
		target.filters?.length === 1 && target.filters[0] === own,
		'the last one leaves the container’s own list',
	);
	assert(target.filterArea === undefined, 'and its filter area as it was');
}
{
	const { host, advance } = makeHost();
	const parent = new Container();
	const empty = new Container();
	parent.addChild(empty);
	playElementFx(empty, { kind: 'glow', repeat: 0 }, host);
	advance(50);
	assert(!empty.filters?.length, 'nothing is filtered before the element has a size');
	const art = new Container();
	art.boundsArea = new Rectangle(0, 0, 40, 40);
	empty.addChild(art);
	advance(32);
	assert(empty.filters?.length === 1, 'and the pass arrives once it does');
	stopElementFx(empty);
}
{
	const { host, advance } = makeHost();
	const target = makeTarget();
	const loop = playElementFx(target, { kind: 'float', repeat: 0 }, host);
	let settled = false;
	void loop.done.then(() => (settled = true));
	advance(50);
	target.destroy();
	advance(32);
	await Promise.resolve();
	assert(settled && !loop.active, 'a destroyed container settles everything on it');
}
{
	const slow = makeHost(1);
	const fast = makeHost(2);
	const a = makeTarget();
	const b = makeTarget();
	const pa = playElementFx(a, { kind: 'pulse', durationMs: 600 }, slow.host);
	const pb = playElementFx(b, { kind: 'pulse', durationMs: 600 }, fast.host);
	slow.advance(320);
	fast.advance(320);
	assert(pa.active && !pb.active, 'at a time scale of 2 a play takes half the time');
	slow.advance(400);
}
{
	const target = makeTarget();
	const none = playElementFx(target, { kind: 'shake' }, undefined);
	assert(!none.active && elementFxCount(target) === 0, 'no host ⇒ nothing plays');
	const unknown = playElementFx(target, { kind: 'video' as ElementFxKind }, makeHost().host);
	assert(!unknown.active, 'an unknown kind ⇒ nothing plays');
}

// -------------------------------------------------------------------------------------------------
console.log('element fx — shatter (glass)');
{
	assert(KINDS.shatter.breaks === 'glass', 'shatter breaks like glass');
	const parent = new Container();
	const target = new Container();
	parent.addChild(target);
	const box = new Rectangle(-100, -60, 200, 120);
	const renderer = {
		generateTexture: ({ frame }: { frame: Rectangle }) =>
			new Texture({ source: new TextureSource({ width: frame.width, height: frame.height }) }),
	};
	const run = startBreak({
		style: 'glass',
		target,
		renderer: renderer as never,
		box,
		rest: new Matrix(),
		intensity: 1,
		params: { impact: 'center', pieces: 56, crack: 0.3 },
		playSeconds: 2,
	});
	const layer = parent.children.find((c) => c.label === 'elementFx:break')?.children[0];
	const meshes = (layer?.children ?? []).filter((c): c is MeshSimple => c instanceof MeshSimple);
	const cracks = layer?.children.find((c) => c instanceof Graphics);
	/** Every triangle as [centroid x, centroid y, area]. */
	const triangles = (): number[][] =>
		meshes.flatMap((mesh) => {
			const v = mesh.vertices;
			const ix = mesh.geometry.indices;
			const out: number[][] = [];
			for (let i = 0; i < ix.length; i += 3) {
				const [a, b, c] = [ix[i] * 2, ix[i + 1] * 2, ix[i + 2] * 2];
				const area =
					Math.abs((v[b] - v[a]) * (v[c + 1] - v[a + 1]) - (v[c] - v[a]) * (v[b + 1] - v[a + 1])) /
					2;
				out.push([(v[a] + v[b] + v[c]) / 3, (v[a + 1] + v[b + 1] + v[c + 1]) / 3, area]);
			}
			return out;
		});
	assert(
		!!run && meshes.length > 0 && meshes.every((m) => m.vertices.length / 2 <= 96),
		'the shards come in small meshes the batcher draws together',
	);
	const atRest = triangles();
	const inside = meshes.every((mesh) => {
		const v = mesh.vertices;
		for (let i = 0; i < v.length; i += 2) {
			if (v[i] < box.x - 1e-6 || v[i] > box.right + 1e-6) return false;
			if (v[i + 1] < box.y - 1e-6 || v[i + 1] > box.bottom + 1e-6) return false;
		}
		return true;
	});
	assert(
		inside &&
			near(
				atRest.reduce((sum, [, , a]) => sum + a, 0),
				box.width * box.height,
				1,
			),
		'at the start the shards tile the element exactly',
	);
	run?.update(0.15);
	const cracking = cracks?.visible === true;
	const held = triangles().every(([x, y], i) => Math.hypot(x - atRest[i][0], y - atRest[i][1]) < 4);
	assert(cracking && held, 'while it cracks the lines show and no shard has fallen');
	run?.update(0.48);
	const reach = Math.hypot(100, 60);
	const fell = (from: number, to: number): number => {
		const now = triangles();
		const group = atRest
			.map((tri, i) => i)
			.filter((i) => {
				const d = Math.hypot(atRest[i][0], atRest[i][1]) / reach;
				return d >= from && d < to;
			});
		return group.filter((i) => now[i][1] - atRest[i][1] > 3).length / group.length;
	};
	assert(
		cracks?.visible === false && fell(0, 0.3) > fell(0.7, 1.01),
		'then the cracks go and the shards by the impact fall first',
	);
	run?.update(1);
	assert(layer?.alpha === 0, 'by the end the shards have gone');
	run?.destroy();
}

// -------------------------------------------------------------------------------------------------
console.log('element fx — crystallize (ice shards)');
{
	assert(KINDS.crystallize.breaks === 'ice', 'crystallize breaks into ice shards');
	const box = new Rectangle(-100, -60, 200, 120);
	const burst = 0.45;
	const start = (from: string) => {
		const parent = new Container();
		const target = new Container();
		parent.addChild(target);
		const made: { texture: Texture; frozen: boolean }[] = [];
		const renderer = {
			generateTexture: ({ frame, target: drawn }: { frame: Rectangle; target: Container }) => {
				const texture = new Texture({
					source: new TextureSource({ width: frame.width, height: frame.height }),
				});
				// Read as it draws: the frozen still's holder is gone as soon as it is drawn.
				const frozen = drawn.children.some((c) =>
					[c.filters ?? []]
						.flat()
						.some((f) => /uniform vec4 uFreeze;/.test(f.glProgram?.fragment ?? '')),
				);
				made.push({ texture, frozen });
				return texture;
			},
		};
		const run = startBreak({
			style: 'ice',
			target,
			renderer: renderer as never,
			box,
			rest: new Matrix(),
			intensity: 1,
			params: { from, pieces: 28, freeze: burst, color: '#9fdcff' },
			playSeconds: 2.4,
		});
		const holder = parent.children.find((c) => c.label === 'elementFx:break');
		const layer = holder?.children[0];
		const meshes = (layer?.children ?? []).filter((c): c is MeshSimple => c instanceof MeshSimple);
		const plain = meshes.filter((m) => m.texture === made[0]?.texture);
		const ice = meshes.filter((m) => m.texture === made[1]?.texture);
		const frost = layer?.children.find((c) => c instanceof Graphics);
		/** Every shard as [centre x, centre y, area], in the order they were cut. */
		const shards = (set: MeshSimple[]): number[][] =>
			set.flatMap((mesh) => {
				const v = mesh.vertices;
				const ix = mesh.geometry.indices;
				const out: number[][] = [];
				let first = -1;
				let area = 0;
				let sx = 0;
				let sy = 0;
				let n = 0;
				const flush = (): void => {
					if (n) out.push([sx / n, sy / n, area]);
					area = 0;
					sx = 0;
					sy = 0;
					n = 0;
				};
				for (let i = 0; i < ix.length; i += 3) {
					// A shard is a fan: its triangles share their first vertex.
					if (ix[i] !== first) {
						flush();
						first = ix[i];
					}
					const [a, b, c] = [ix[i] * 2, ix[i + 1] * 2, ix[i + 2] * 2];
					area +=
						Math.abs(
							(v[b] - v[a]) * (v[c + 1] - v[a + 1]) - (v[c] - v[a]) * (v[b + 1] - v[a + 1]),
						) / 2;
					for (const k of [a, b, c]) {
						sx += v[k];
						sy += v[k + 1];
						n++;
					}
				}
				flush();
				return out;
			});
		return { run, made, holder, layer, plain, ice, frost, shards };
	};

	const { run, made, holder, layer, plain, ice, frost, shards } = start('center');
	assert(
		made.length === 2 && !made[0].frozen && made[1].frozen,
		'it cuts the plain still and a frozen one (the freeze pass at full cover)',
	);
	assert(
		plain.length > 0 &&
			plain.length === ice.length &&
			[...plain, ...ice].every((m) => m.vertices.length / 2 <= 96) &&
			frost !== undefined,
		'the plain and the ice shards come in matching small meshes, with the frost drawn over them',
	);
	const atRest = shards(plain);
	assert(
		near(
			atRest.reduce((sum, [, , a]) => sum + a, 0),
			box.width * box.height,
			1,
		) && shards(ice).every(([, , a]) => a < 1e-6),
		'at the start the plain facets tile the element exactly and no ice has grown',
	);
	run?.update(0.4 * burst);
	const growing = shards(ice);
	const reach = Math.hypot(100, 60);
	const icedShare = (from: number, to: number): number => {
		const group = atRest
			.map((_, i) => i)
			.filter((i) => {
				const d = Math.hypot(atRest[i][0], atRest[i][1]) / reach;
				return d >= from && d < to;
			});
		return group.filter((i) => growing[i][2] > 0.5 * atRest[i][2]).length / group.length;
	};
	assert(
		icedShare(0, 0.3) > icedShare(0.7, 1.01),
		'the ice grows from the middle out, facet by facet',
	);
	run?.update(0.97 * burst);
	const locked = shards(ice);
	const held = locked.every(([x, y], i) => Math.hypot(x - atRest[i][0], y - atRest[i][1]) < 4);
	assert(
		held &&
			locked.reduce((sum, [, , a]) => sum + a, 0) > 0.85 * box.width * box.height &&
			plain.every((m) => !m.visible),
		'before it bursts every facet is ice, the plain still is covered and no shard has moved',
	);
	run?.update(burst + 0.25);
	const flying = shards(ice);
	const outward = flying.filter(
		([x, y], i) => Math.hypot(x, y) > Math.hypot(atRest[i][0], atRest[i][1]) + 2,
	).length;
	assert(outward > 0.7 * flying.length, 'then it bursts: the shards fly out from its middle');
	run?.update(1);
	assert(layer?.alpha === 0, 'by the end the shards have gone');
	run?.destroy();
	assert(
		holder?.destroyed === true && made.every(({ texture }) => texture.destroyed),
		'it cleans up its pieces and both stills',
	);

	const edges = start('edges');
	const edgeRest = edges.shards(edges.plain);
	edges.run?.update(0.4 * burst);
	const edgeGrowing = edges.shards(edges.ice);
	const fromEdge = (i: number): number => {
		const u = (edgeRest[i][0] - box.x) / box.width;
		const v = (edgeRest[i][1] - box.y) / box.height;
		return Math.min(u, 1 - u, v, 1 - v);
	};
	const rim = edgeRest.map((_, i) => i).filter((i) => fromEdge(i) < 0.15);
	const core = edgeRest.map((_, i) => i).filter((i) => fromEdge(i) > 0.3);
	const share = (group: number[]): number =>
		group.filter((i) => edgeGrowing[i][2] > 0.5 * edgeRest[i][2]).length /
		Math.max(1, group.length);
	assert(share(rim) > share(core), 'from the edges, the rim ices over before the middle');
	edges.run?.destroy();
}

// -------------------------------------------------------------------------------------------------
console.log('element fx — dissolve to particles');
{
	assert(KINDS.disintegrate.breaks === 'dust', 'dissolve to particles breaks into dust');
	const parent = new Container();
	const target = new Container();
	parent.addChild(target);
	const box = new Rectangle(-100, -50, 200, 100);
	const renderer = {
		generateTexture: ({ frame }: { frame: Rectangle }) =>
			new Texture({ source: new TextureSource({ width: frame.width, height: frame.height }) }),
	};
	const run = startBreak({
		style: 'dust',
		target,
		renderer: renderer as never,
		box,
		rest: new Matrix(),
		intensity: 1,
		params: { particles: 400, drift: 'right' },
		playSeconds: 2,
	});
	const holder = parent.children.find((c) => c.label === 'elementFx:break');
	const meshes = (holder?.children[0]?.children ?? []) as MeshSimple[];
	/** Every speck as [centre x, centre y, area]. */
	const specks = (): number[][] =>
		meshes.flatMap((mesh) => {
			const v = mesh.vertices;
			const out: number[][] = [];
			for (let i = 0; i < v.length; i += 8) {
				const area = Math.abs(
					(v[i + 2] - v[i]) * (v[i + 5] - v[i + 3]) - (v[i + 3] - v[i + 1]) * (v[i + 4] - v[i + 2]),
				);
				out.push([(v[i] + v[i + 4]) / 2, (v[i + 1] + v[i + 5]) / 2, area]);
			}
			return out;
		});
	assert(
		!!run && meshes.length > 1 && meshes.every((m) => m.vertices.length / 2 <= 96),
		'the specks come in small meshes the batcher draws together',
	);
	const atRest = specks();
	assert(
		atRest.length >= 350 &&
			near(
				atRest.reduce((sum, [, , a]) => sum + a, 0),
				box.width * box.height,
				1,
			) &&
			atRest.every(([x, y]) => box.contains(x, y)),
		'at the start the specks tile the element exactly',
	);
	run?.update(0.3);
	const moved = specks().map(([x, y], i) => Math.hypot(x - atRest[i][0], y - atRest[i][1]) > 0.5);
	const share = (side: (x: number) => boolean): number => {
		const on = atRest.map((_, i) => i).filter((i) => side(atRest[i][0]));
		return on.filter((i) => moved[i]).length / on.length;
	};
	assert(
		share((x) => x > 50) > 0.5 && share((x) => x < -50) === 0,
		'the side the wind blows to lets go first; the far side still holds',
	);
	run?.update(1);
	assert(
		specks().every(([, , a]) => a < 1e-6) && holder?.children[0]?.alpha === 0,
		'by the end every speck has shrunk to nothing',
	);
	run?.destroy();
	assert(parent.children.length === 1 && !!holder?.destroyed, 'and the pieces leave with the run');

	assert(
		KINDS.assemble.breaks === 'dust' && KINDS.assemble.reversed === true,
		'assemble from particles plays the dust backwards',
	);
	const { host, advance } = makeHost();
	const element = makeTarget();
	const rest = snapshot(element);
	const assemble = playElementFx(
		element,
		{ kind: 'assemble', durationMs: 1000, params: { particles: 200 } },
		{ ...host, renderer: renderer as never },
	);
	advance(16);
	const layer = element.parent?.children.find((c) => c.label === 'elementFx:break')?.children[0];
	assert(
		element.alpha === 0 && !!layer && layer.alpha < 0.05,
		'it starts hidden, its specks not yet blown in',
	);
	advance(500);
	assert(element.alpha === 0 && layer?.alpha === 1, 'midway the specks are coming together');
	advance(600);
	assert(
		!assemble.active &&
			!!layer?.destroyed &&
			JSON.stringify(snapshot(element)) === JSON.stringify(rest),
		'at the end the element is back exactly and the specks are gone',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('element fx — keyed: a timeline poses it');
{
	const { host, advance } = makeHost();
	const target = makeTarget();
	const rest = snapshot(target);
	let pose: { progress?: number; intensity?: number } | undefined;
	const keyed = playElementFx(target, { kind: 'spin', durationMs: 800, pose: () => pose }, host);
	advance(400);
	assert(JSON.stringify(snapshot(target)) === JSON.stringify(rest), 'no pose ⇒ at rest');
	pose = { progress: 0.5 };
	advance(16);
	const half = target.rotation;
	advance(2000);
	assert(target.rotation === half, 'a pose holds still: the effect does not run on its own clock');
	pose = { progress: 0.25 };
	advance(16);
	assert(target.rotation !== half, 'scrubbing the pose scrubs the effect');
	pose = { progress: 0 };
	advance(16);
	assert(JSON.stringify(snapshot(target)) === JSON.stringify(rest), 'progress 0 ⇒ back at rest');
	assert(keyed.active, 'and it stays on the element, waiting for the next pose');
	pose = { progress: 1 };
	const exit = playElementFx(target, { kind: 'fadeOut', pose: () => pose }, host);
	advance(16);
	assert(target.alpha === 0, 'an exit posed at its end is hidden');
	pose = { progress: Number.NaN };
	advance(16);
	assert(near(target.alpha, 0.8), 'a bad pose reads as at rest');
	keyed.stop();
	exit.stop();
	assert(elementFxCount(target) === 0, 'stopping a posed effect takes it off');
}
{
	const { host, advance } = makeHost();
	const target = makeTarget();
	let pose: { progress?: number; intensity?: number } | undefined = { progress: 0.5 };
	playElementFx(target, { kind: 'pulse', pose: () => pose }, host);
	advance(16);
	const full = target.scale.x;
	pose = { progress: 0.5, intensity: 0.5 };
	advance(16);
	assert(
		target.scale.x < full && target.scale.x > 1.5,
		'the intensity channel scales its strength',
	);
	stopElementFx(target);
}
{
	assert(
		readElementFxEntry({ id: 'k', kind: 'curl', trigger: 'keyed' })?.trigger === 'keyed',
		'`keyed` is a trigger the reader keeps',
	);
	assert(
		ELEMENT_FX_CHANNEL_PREFIX === CINEMATIC_ELEMENT_FX_PREFIX,
		'the channel prefix is the evaluator’s',
	);
	assert(
		JSON.stringify(elementFxOfChannel(elementFxIntensityChannel('efx2'))) ===
			JSON.stringify({ id: 'efx2', value: 'intensity' }) &&
			JSON.stringify(elementFxOfChannel(elementFxProgressChannel('efx2'))) ===
				JSON.stringify({ id: 'efx2', value: 'progress' }) &&
			elementFxOfChannel('fx:intensity') === undefined,
		'a channel names its entry and value',
	);
	const entries = readElementFxEntries([
		{ id: 'a', kind: 'curl', trigger: 'keyed' },
		{ id: 'b', kind: 'shake', trigger: 'cue', cue: 'x' },
		{ id: 'c', kind: 'glow', trigger: 'keyed', disabled: true },
	]);
	assert(
		JSON.stringify(elementFxChannels(entries)) === JSON.stringify(['efx:a', 'efx:a:intensity']),
		'two channels per enabled keyed entry, none for others',
	);
	const blended = blendNodeSamples({ 'efx:a': 1, 'efx:a:intensity': 2 }, {}, 0.25) as Record<
		string,
		unknown
	>;
	assert(
		near(blended['efx:a'] as number, 0.75) && near(blended['efx:a:intensity'] as number, 1.75),
		'a state blend mixes them toward rest (progress 0, strength ×1)',
	);
	const sampled = sampleNodeActor(
		[
			{
				kind: 'property',
				channels: {
					'efx:a': [
						{ time: 0, value: 0 },
						{ time: 1, value: 1 },
					],
				},
			},
		],
		0.5,
	) as Record<string, unknown>;
	assert(near(sampled['efx:a'] as number, 0.5), 'the evaluator samples an efx channel');
	const doc = {
		id: 't',
		host: { kind: 'screen', sceneId: 's' },
		stage: { cast: [{ actorId: 'n', kind: 'node', target: 'hero' }] },
		tracks: [
			{
				id: 'p',
				kind: 'property',
				actorId: 'n',
				channels: { 'efx:a': [{ time: 0, value: 1 }], 'efx:zz': [{ time: 0, value: 1 }] },
			},
		],
	};
	const scene = {
		id: 's',
		name: 'S',
		nodes: [{ id: 'hero', kind: 'sprite', assetKey: 'k', x: 0, y: 0, elementFx: entries }],
	};
	const issues = validateNodeActors(doc as never, scene as never);
	assert(
		issues.length === 1 && issues[0].message.includes('efx:zz'),
		'validation takes a keyed entry’s channel and reports one naming no keyed entry',
	);
	const reels = { ...scene, nodes: [{ ...scene.nodes[0], kind: 'reelGrid' }] };
	assert(
		keyableElementFxEntries(reels.nodes[0] as never).length === 0 &&
			validateNodeActors(doc as never, reels as never).some((i) => i.message.includes('efx:a')),
		'nothing poses the reel grid’s Element FX: no keyable entry, its keys reported',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('element fx — the shared GLSL library');
{
	const defined = (code: string): string[] =>
		[...code.matchAll(/^(?:float|vec[234]|mat[234]|int|bool|void)\s+(\w+)\s*\(/gm)].map(
			(m) => m[1],
		);
	const linked = linkGlsl(
		'void main(void) { float g = efxGlint(u, 0.5, 0.1); float n = efxNoise(p); }',
	);
	const order = defined(linked);
	assert(
		order.join() === 'efxBand,efxGlint,efxHash,efxNoise,main',
		`a pass gets exactly what it calls, each building block before its callers (${order.join()})`,
	);
	assert(
		linkGlsl('void main(void) { efxSample(efxPx()); }') ===
			'\nvoid main(void) { efxSample(efxPx()); }',
		'the pass header’s own helpers are not library entries: nothing is linked for them',
	);

	const factories = Object.entries(SHADERS).filter(
		(entry): entry is [string, () => Filter] =>
			/^[a-z]\w*Filter$/.test(entry[0]) && typeof entry[1] === 'function',
	);
	const fragments = factories.map(([name, make]) => [name, make().glProgram.fragment] as const);
	const twice = fragments.flatMap(([name, fragment]) => {
		const names = defined(fragment);
		return names.filter((n, i) => names.indexOf(n) !== i).map((n) => `${name}:${n}`);
	});
	assert(
		factories.length === 17 && !twice.length,
		`all 17 passes link, no function defined twice in one${twice.length ? `: ${twice.join(', ')}` : ''}`,
	);
	// A misspelt or missing building block is otherwise found only when the browser compiles it.
	const unresolved = fragments.flatMap(([name, fragment]) => {
		const have = defined(fragment);
		const live = fragment.replace(/\/\/[^\n]*/g, '');
		return [...new Set([...live.matchAll(/\b(efx\w+)\s*\(/g)].map((m) => m[1]))]
			.filter((call) => !have.includes(call))
			.map((call) => `${name}:${call}`);
	});
	assert(
		!unresolved.length,
		`every efx… a pass calls is defined in it${unresolved.length ? `: ${unresolved.join(', ')}` : ''}`,
	);
	const EFX_GLSL_MUTABLE = EFX_GLSL as Record<string, string>;
	const ORIGINAL_HASH = EFX_GLSL.efxHash;
	let cycle = '';
	try {
		EFX_GLSL_MUTABLE.efxHash = '\nfloat efxHash(vec2 p) { return efxNoise(p); }';
		linkGlsl('void main(void) { efxNoise(p); }');
	} catch (error) {
		cycle = error instanceof Error ? error.message : String(error);
	} finally {
		EFX_GLSL_MUTABLE.efxHash = ORIGINAL_HASH;
	}
	assert(
		cycle.includes('efxNoise → efxHash → efxNoise') &&
			linkGlsl('void main(void) { // not efxCells(p)\n efxLuma(c); }').includes('float efxLuma') &&
			!linkGlsl('void main(void) { // not efxCells(p)\n efxLuma(c); }').includes('float efxCells'),
		'the linker reads calls, not comments, and names entries that call each other',
	);

	/** Every function in `code` as [name, its body with comments, whitespace and the names of the
	 *  functions it calls normalised away], so a renamed copy reads the same as its original. */
	const bodies = (code: string, names: string[]): [string, string][] => {
		const out: [string, string][] = [];
		for (const m of code.matchAll(/^(?:float|vec[234]|mat[234])\s+(\w+)\s*\(([^)]*)\)\s*\{/gm)) {
			let depth = 1;
			let end = (m.index ?? 0) + m[0].length;
			while (depth && end < code.length) {
				depth += code[end] === '{' ? 1 : code[end] === '}' ? -1 : 0;
				end++;
			}
			const norm = (m[2] + code.slice((m.index ?? 0) + m[0].length, end))
				.replace(/\/\/[^\n]*/g, '')
				.replace(new RegExp(`\\b(${names.join('|')})\\b`, 'g'), 'F')
				.replace(/\s+/g, ' ');
			out.push([m[1], norm]);
		}
		return out;
	};
	const shaderSource = read('packages/pixi-svelte/src/lib/elementFx/shaders.ts');
	const library = Object.values(EFX_GLSL).join('\n');
	const names = [...new Set([...defined(shaderSource), ...defined(library)])];
	const copies = (code: string): string[] => {
		const all = bodies(code, names);
		return all
			.filter(([, body], i) => all.findIndex(([, other]) => other === body) !== i)
			.map(([name]) => name);
	};
	const found = copies(library + '\n' + shaderSource.replace(/^[\s\S]*?const HEADER/, ''));
	assert(
		!found.length,
		`no pass carries a private copy of a building block${found.length ? `: ${found.join(', ')}` : ''}`,
	);
	const planted = `
float myHash(vec2 p)
{
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
`;
	assert(
		copies(library + planted + '\n').length === 1,
		'and a renamed copy is caught (a planted copy of efxHash is found)',
	);

	// efxAway's arms, in order, against what each side means: arm i must read side EFX_SIDES[i].
	const ARM: Record<string, string> = {
		bottom: '1.0 - u.y',
		top: 'u.y',
		edges: 'efxEdgeDistance(u)',
		center: 'length(u - 0.5) * 1.4142',
		left: 'u.x',
		right: '1.0 - u.x',
	};
	const arms = [
		...EFX_GLSL.efxAway
			.replace(/\/\/[^\n]*/g, '')
			.matchAll(/(?:side < (\d)\.5 \?|:)\s*([^:?\n;]+?)\s*(?=\n|;)/g),
	]
		.map((m) => m[2].trim())
		.filter((arm) => !arm.startsWith('side <'));
	assert(
		arms.length === EFX_SIDES.length && EFX_SIDES.every((side, i) => arms[i] === ARM[side]),
		`efxAway reads the six sides in EFX_SIDES order (${arms.join(' | ')})`,
	);
	// Each spreading kind passes the side its param names, and its catalog default for anything else.
	const SIDE_UNIFORM: Record<string, [string, number]> = {
		freeze: ['uFreeze', 3],
		petrify: ['uStone', 3],
		turnToGold: ['uGold', 2],
		burn: ['uBurn', 3],
	};
	const wrongSides = Object.entries(SIDE_UNIFORM).flatMap(([kind, [uniform, at]]) => {
		const spec = ELEMENT_FX.find((k) => k.kind === kind);
		const param = spec?.params.find((p) => p.id === 'from');
		if (!param || param.kind !== 'choice') return [`${kind}: no from choice`];
		const impl = KINDS[kind as ElementFxKind].filter;
		const sent = (from: string): number => {
			const frame: FxFrame = {
				t: 0.5,
				seconds: 0.5,
				playSeconds: 1,
				intensity: 1,
				params: { ...resolveElementFxParams(kind as ElementFxKind, undefined), from },
				looping: false,
				width: 100,
				height: 100,
			};
			const filter = impl?.create(frame) as ElementFxFilter;
			impl?.update(filter, frame, { screenWidth: 100, screenHeight: 100 });
			return (filter.efx[uniform] as Float32Array)[at];
		};
		return [
			...param.options
				.filter((option) => !(EFX_SIDES as readonly string[]).includes(option))
				.map((option) => `${kind}: '${option}' is no side`),
			...param.options
				.filter((option) => sent(option) !== EFX_SIDES.indexOf(option as never))
				.map((option) => `${kind}: '${option}' sent as ${sent(option)}`),
			...(sent('nowhere') === EFX_SIDES.indexOf(param.default as never)
				? []
				: [`${kind}: an unknown side is not its default '${param.default}'`]),
		];
	});
	assert(
		!wrongSides.length && efxSide('nowhere', 'edges') === EFX_SIDES.indexOf('edges'),
		`freeze, petrify, gold and burn send their side as efxAway reads it, an unknown one as their default${wrongSides.length ? `: ${wrongSides.join('; ')}` : ''}`,
	);
}

// -------------------------------------------------------------------------------------------------
console.log('element fx — the shaders run on WebGL1');
{
	const shaders = read('packages/pixi-svelte/src/lib/elementFx/shaders.ts');
	const code = (shaders + read('packages/constants-shared/glslLibrary.ts')).replace(
		/\/\/[^\n]*/g,
		'',
	);
	const es3Only = ['transpose(', 'inverse(', 'texelFetch(', 'textureSize(', 'determinant('];
	// GLSL ES 1.00 and 3.00 keywords and words reserved for future use (Pixi compiles a pass as
	// `#version 300 es` on WebGL2): none may name a variable or a function.
	const GLSL_RESERVED = [
		...['attribute', 'varying', 'in', 'out', 'inout', 'uniform', 'precision', 'invariant'],
		...['flat', 'smooth', 'centroid', 'layout', 'sample', 'patch', 'noperspective', 'switch'],
		...['case', 'default', 'discard', 'uint', 'filter', 'input', 'output', 'active', 'common'],
		...['resource', 'partition', 'subroutine', 'coherent', 'volatile', 'restrict', 'readonly'],
		...['writeonly', 'packed', 'superp', 'half', 'fixed', 'long', 'short', 'double', 'unsigned'],
		...['interface', 'extern', 'external', 'static', 'public', 'inline', 'noinline', 'goto'],
		...['this', 'template', 'typedef', 'enum', 'union', 'class', 'asm', 'cast', 'namespace'],
		...['using', 'sizeof'],
	];
	const reserved = GLSL_RESERVED.filter((word) =>
		new RegExp(`\\b(?:float|vec[234]|mat[234]|int|bool|void)\\s+${word}\\b`).test(code),
	);
	assert(
		!reserved.length,
		`no GLSL reserved word as a variable${reserved.length ? `: ${reserved.join(', ')}` : ''}`,
	);
	const found = es3Only.filter((builtin) => code.includes(builtin));
	assert(
		!found.length,
		`no GLSL ES 3.00-only built-in${found.length ? `: ${found.join(', ')}` : ''}`,
	);
	assert(
		/precision highp float;/.test(shaders),
		'fragments declare highp (they share uOutputFrame with the vertex stage)',
	);
}

// -------------------------------------------------------------------------------------------------
console.log('element fx — the wiring');
{
	const view = read('packages/engine-layout/src/lib/LayoutNodeView.svelte');
	assert(
		/\{#if elementFx\.length\}\s*<Container zIndex=\{transform\.zIndex\}>/.test(view),
		'a node with FX renders in one container that sorts as the node did',
	);
	assert(
		/<Anchor name=\{node\.id\} \/>\s*\{#if transform\.visible && revealed\}\s*<ElementFxPlayer/.test(
			view,
		),
		'anchored by node id, playing only while shown',
	);
	assert(
		/\{:else\}\s*\{@render listened\(\)\}\s*\{\/if\}\s*$/.test(view.trim() + '\n'),
		'a node without FX renders bare (parity)',
	);
	assert(
		view.includes('pose={elementFxPose}') && view.includes('fold.timelineSample'),
		'a keyed entry is posed by the timeline driving the node',
	);
	const player = read('packages/engine-layout/src/lib/ElementFxPlayer.svelte');
	assert(
		player.includes('fired.counts[cue]'),
		'inside a component, the instance’s own fires (its timelines, its state machine) play cue entries',
	);
	assert(
		player.includes('getComponentSignal(cue).subscribe') &&
			player.includes('scopeMatches(props.scope, scope)'),
		'cues come off the component-signal bus, scoped',
	);
	assert(player.includes('particleTimeScale'), 'the player follows turbo');
	assert(
		player.includes('props.entries.filter(elementFxEnterEnds)') &&
			/if \(!host\) \{\s*ondone\?\.\(\);\s*return;/.test(player) &&
			/if \(mounted\) ondone\(\);/.test(player) &&
			player.includes('mounted = false;'),
		'its ondone waits for the enter entries that end, fires when there is nothing to play on, and never after unmount',
	);
	const scene = read('packages/engine-layout/src/lib/LayoutScene.svelte');
	assert(
		scene.includes('<Anchor name={elementFxScreenTarget(scene.id)} />'),
		'a screen with FX anchors as screen:<id>',
	);
	assert(
		scene.includes('registerAnchor(name, parentContext.parent)'),
		'a screen registers its own mount container when asked',
	);
	assert(
		read('packages/engine-layout/src/lib/FlowV2Mount.svelte').includes(
			'parentTarget={elementFxScreenTarget(container.sceneId)}',
		),
		'every flow-mounted screen is a target',
	);
	assert(
		read('apps/lines/src/components/EngineScreenMount.svelte').includes(
			'parentTarget={elementFxScreenTarget(sceneId)}',
		),
		'an engine-mounted screen is a target',
	);
	const game = read('apps/lines/src/components/Game.svelte');
	assert(
		game.includes('<Anchor name={ELEMENT_FX_REELS_TARGET} />') &&
			game.includes('<ElementFxPlayer entries={reelFx} />'),
		'the reel stack is the reels target and plays the reel grid’s FX',
	);
	const symbol = read('apps/lines/src/components/Symbol.svelte');
	const stateFxSource = read('apps/lines/src/game/symbolStateFx.ts');
	assert(
		symbol.includes('bakedSymbolFx()[props.rawSymbol.name]') &&
			symbol.includes('symbolStateFx(props.rawSymbol.name, props.state)') &&
			/\{#key props\.state\}\s*\{#if stateFx\.length\}\s*<ElementFxPlayer entries=\{stateFx\} ondone=\{gate\.fx\} \/>/.test(
				symbol,
			) &&
			/entry\.trigger === 'enter' \|\| entry\.trigger === 'always'/.test(stateFxSource),
		'a symbol plays its state’s FX — enter and always — and ends them as it leaves the state',
	);
	assert(
		(symbol.match(/oncomplete=\{artComplete\}/g) ?? []).length === 3 &&
			symbol.includes('complete: artComplete,') &&
			!/oncomplete=\{props\.oncomplete\}|complete: props\.oncomplete/.test(symbol) &&
			symbol.includes(
				'const artComplete = $derived(symbolFx ? () => gate.art() : props.oncomplete);',
			) &&
			symbol.includes('stateFxGate(waitsForFx, ownArt, () => {') &&
			symbol.includes('if (visit === gate) props.oncomplete?.();'),
		'every renderer reports through the gate when the symbol has FX, and straight through when it has none',
	);
	const board = read('apps/lines/src/components/Board.svelte');
	assert(
		board.includes("if (!symbolStateHasBeat(reelSymbol.rawSymbol.name, 'explosion')) {") &&
			board.includes("symbolStateHasBeat(reelSymbol.rawSymbol.name, 'win')") &&
			read('apps/lines/src/components/TumbleBoard.svelte').includes(
				"symbolStateHasBeat(tumbleSymbol.rawSymbol.name, 'intro')",
			) &&
			stateFxSource.includes('symbolStateFx(symbolName, state).some(elementFxEnterEnds)'),
		'an explosion with only a melt authored still explodes; win and intro caps count an ending effect as authored',
	);
	assert(
		/\{:else\}\s*\{@render bands\(\)\}\s*\{\/if\}/.test(symbol) &&
			read('apps/lines/src/editor-scenes.ts').includes(
				'return bakedBundle.symbols?.symbolFx ?? {};',
			),
		'a symbol with no FX draws as before; the baked symbols carry them',
	);
	const vocab = read('packages/engine-flow-v2/src/reference/standardVocab.ts');
	assert(
		vocab.includes("name: 'elementEffect'") && vocab.includes("name: 'stopElementEffect'"),
		'the flow declares elementEffect / stopElementEffect',
	);
	assert(
		vocab.includes("{ name: 'ElementFxKind', values: [...ELEMENT_FX_KINDS] }"),
		'its kind dropdown is the catalog',
	);
	const effects = read('apps/lines/src/game/flowEffects.ts');
	assert(
		/\n\telementEffect: \(payload\) =>/.test(effects) &&
			/\n\tstopElementEffect: \(payload\) =>/.test(effects),
		'the game implements both',
	);
	assert(ELEMENT_FX_KINDS.length === ELEMENT_FX.length, 'the kind list is the catalog’s');
}

if (failures) {
	console.error(`\nelement fx: ${failures} check(s) FAILED`);
	process.exit(1);
}
console.log('\nelement fx: all checks passed');
