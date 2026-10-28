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
 *  7. Custom effects (Invisible Shader Graph step 3): a compiled graph registered as `custom:<id>`
 *     behaves like a built-in — read with every trigger (and kept before it is registered), posed
 *     by a timeline, sped up by turbo, held as an exit, stopped back to rest — its graph pass, its
 *     built-in passes (their params tied to its own) and its motion curves all playing. One reading
 *     the per-element seed (step 6) draws one for each element it plays on, as the built-ins do, and
 *     keeps it; one that reads none draws none. The registry leaves out an effect whose pass calls
 *     an `efx…` function this version's library and pass header lack (one compiled by a newer
 *     Shader Graph), or reads two seeds; `EFX_HEADER_FUNCTIONS` is what the header declares, and
 *     what the particle shell's header (step 8d) and the screen shell's (step 8e) declare too, each
 *     as `EFX_HEADER_SIGNATURES` says. A body reading the Particle node, or the Screens node, is
 *     kept; a runtime from before its helpers drops it.
 *  8. Motion programs (Shader Graph step 8a): the twins' motion graphs move and pad as the built-ins'
 *     own samplers do over every param, size, strength and play — the freeze shiver, petrify thud
 *     and gold ring timed by Hold, the electrocute jitter of the seconds played, the poison sway
 *     counted or looping, the Bounce 3D squash by its Bounces param, and the room of Bounce 3D,
 *     Melt, the waves and the flag growing with a param × strength (× progress), to the top.
 *     The runtime: a driven channel overrides its curve at its final value, kept to its range; the
 *     padding is per frame; the program reads the seed the graph's pass reads, one per element; a
 *     program this version cannot run is dropped and the effect plays its curves.
 *  9. Custom breaks (Shader Graph step 8b): the graph plays on the element until the break's start,
 *     where the still is cut with the graph's pass on it (held at that moment, drawn as smoothly as
 *     a built-in's still), placed and faded by its motion; the pieces fly over the window as the
 *     built-in's over a play of the window's length; its params come through its ties (a constant
 *     holds); an assemble's specks fly in over [0, 1 − at], redrawn from the live element with the
 *     graph's look, and the graph has the element after; with no renderer it leaves as that break
 *     leaves, from where the graph held it. The fade an exit's break carries for older runtimes
 *     never shows on this one, and on an older one takes the element off screen. The registry
 *     drops a break it cannot play and keeps the effect.
 * 10. A pass the GPU refuses (Shader Graph step 8c): an `ElementFxFilter` whose program did not
 *     compile or link (the driver's own answer, asked once per program) draws the element as it is
 *     that frame and is disabled after, logged once per program, while one that links draws as ever;
 *     a lost context or a renderer that is not WebGL changes nothing. Every built-in pass and every
 *     custom effect's graph pass is one. A pass's own functions (a Custom GLSL node's) are no unknown
 *     calls; the header's signatures, which the Custom GLSL checker types calls by, are the header's.
 *     (`pnpm --filter fx-spike shader-compile` plays broken passes on WebGL1 and WebGL2.)
 * 11. Post FX (Shader Graph step 8e): played on its host's stage, an effect folds no motion, measures
 *     nothing, and never writes the stage's filters, filter area or transform: its passes, fed the
 *     viewport, go to the stage's post FX slot, which hears null before they are destroyed. Every
 *     break, exit, enter and motion-only kind is refused with its reason, said once; a third entry,
 *     or one past four filters, does not play. `settings.postFx` reads triggers `always` and `cue`
 *     only, drops a refused kind and one past the caps with a warning, and ignores unknown fields;
 *     `stageFxAntialias` is on only when `true`. The game anchors the stage and mounts its player
 *     only for a doc with post FX.
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
	RendererType,
	Texture,
	TextureSource,
	Ticker,
} from 'pixi.js';
import {
	CUSTOM_ELEMENT_FX_MOTION_PADDING_MAX,
	ELEMENT_FX,
	ELEMENT_FX_BREAK_KINDS,
	ELEMENT_FX_CHANNEL_PREFIX,
	ELEMENT_FX_KINDS,
	ELEMENT_FX_PASS_KINDS,
	ELEMENT_FX_STAGE_TARGET,
	STAGE_FX_LIMITS,
	customElementFx,
	customElementFxBreakWindow,
	elementFxChannels,
	elementFxCueNames,
	elementFxEnterEnds,
	elementFxIntensityChannel,
	elementFxOfChannel,
	elementFxProgressChannel,
	isCustomElementFxKind,
	isElementFxKind,
	isPlayableElementFxKind,
	isReversedElementFxBreak,
	readCustomElementFx,
	readElementFxEntries,
	readElementFxEntry,
	resolveElementFxParams,
	sampleElementFxCurve,
	setCustomElementFx,
	type CustomElementFx,
	type ElementFxKind,
	type ElementFxKindId,
	type ElementFxMotionOutput,
	type ElementFxParamValue,
} from '../../packages/constants-shared/elementFx';
import {
	BREAK_FADE_FROM,
	BREAK_OUTPUT,
	BUILTIN_TWINS,
	REFERENCE_GRAPHS,
	builtinTwin,
	compileShaderEffect,
	graphBuilder,
	type GraphNode,
	type GraphWire,
	type ShaderGraphDoc,
} from '../../packages/engine-shadergraph/index';
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
	EFX_HEADER_FUNCTIONS,
	EFX_HEADER_SIGNATURES,
	EFX_SIDES,
	efxSide,
	linkGlsl,
	unknownEfxCalls,
} from '../../packages/constants-shared/glslLibrary';
import { PARTICLE_HEADER } from '../../packages/constants-shared/particleShell';
import { SCREEN_HEADER } from '../../packages/constants-shared/screenShell';
import * as SHADERS from '../../packages/pixi-svelte/src/lib/elementFx/shaders';
import type { ElementFxFilter } from '../../packages/pixi-svelte/src/lib/elementFx/shaders';
import { KINDS } from '../../packages/pixi-svelte/src/lib/elementFx/kinds';
import { customKindImpl } from '../../packages/pixi-svelte/src/lib/elementFx/custom';
import { REST, type FxFrame } from '../../packages/pixi-svelte/src/lib/elementFx/frame';
import {
	elementFxCount,
	elementFxHostFor,
	playElementFx,
	stopElementFx,
	type ElementFxHost,
} from '../../packages/pixi-svelte/src/lib/elementFx/runtime';
import {
	bindStagePostFx,
	bindStagePostFxSlot,
	stageFxFilterCount,
	stageFxLoadText,
	stageFxRefusal,
	stagePostFx,
} from '../../packages/pixi-svelte/src/lib/elementFx/stage';
import { readPostFx, readStageFxAntialias } from '../../packages/engine-layout/src/lib/postFx';

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
	assert(!KINDS.disintegrate.live && !run?.follow, 'dissolve to particles breaks a still');

	assert(
		KINDS.assemble.breaks === 'dust' && KINDS.assemble.reversed === true,
		'assemble from particles plays the dust backwards',
	);
	assert(KINDS.assemble.live === true, 'assemble from particles plays on the live element');
	// What a live break asks of the renderer: each draw, recorded. Drawing a container makes it a
	// render group, as Pixi's does.
	const draws: { container: Container; alpha: number; transform: Matrix; texture: Texture }[] = [];
	const liveRenderer = {
		...renderer,
		resolution: 1,
		render: (o: { container: Container; transform: Matrix; target: Texture }) => {
			o.container.enableRenderGroup();
			draws.push({
				container: o.container,
				alpha: o.container.alpha,
				transform: o.transform.clone(),
				texture: o.target,
			});
		},
	};
	const localOf = (c: Container): Matrix => {
		c.updateLocalTransform();
		return c.localTransform.clone();
	};
	const sameMatrix = (a: Matrix, b: Matrix): boolean =>
		(['a', 'b', 'c', 'd', 'tx', 'ty'] as const).every((k) => near(a[k], b[k], 1e-4));
	/** The element's resting local matrix, as it would draw at rest. */
	const restOf = (c: Container): Matrix => {
		const probe = new Container();
		probe.position.copyFrom(c.position);
		probe.scale.copyFrom(c.scale);
		probe.pivot.copyFrom(c.pivot);
		probe.rotation = c.rotation;
		return localOf(probe);
	};
	const { host, advance } = makeHost();
	// What it shows is a child the element holds, so a zoom of that child grows the element's box.
	const element = makeTarget();
	element.boundsArea = undefined as unknown as Rectangle;
	const art = element.addChild(new Container());
	art.boundsArea = new Rectangle(-50, -60, 100, 120);
	const rest = snapshot(element);
	const assemble = playElementFx(
		element,
		{ kind: 'assemble', durationMs: 1000, params: { particles: 200 } },
		{ ...host, renderer: liveRenderer as never },
	);
	advance(16);
	const assembleHolder = element.parent?.children.find((c) => c.label === 'elementFx:break');
	const layer = assembleHolder?.children[0];
	const assembleMeshes = (layer?.children ?? []) as MeshSimple[];
	assert(
		element.alpha === 0 && !!layer && layer.alpha < 0.05,
		'it starts hidden, its specks not yet blown in',
	);
	const before = draws.length;
	advance(160);
	assert(
		draws.length >= before + 10 &&
			draws.every((d) => d.container === element && d.alpha === 1) &&
			element.alpha === 0,
		'every frame it draws the live element into its specks, at full alpha, and keeps it hidden',
	);
	assert(
		near(assembleHolder?.alpha ?? 0, 0.8) &&
			sameMatrix(localOf(assembleHolder as Container), restOf(element)),
		'its specks sit where the element rests, faded as the element is',
	);
	element.position.set(340, 260);
	element.rotation = 0.5;
	advance(16);
	assert(
		sameMatrix(localOf(assembleHolder as Container), restOf(element)),
		'the owner moving the element mid-play (a timeline) moves its specks with it',
	);
	const firstStill = draws[0].texture;
	art.scale.set(2);
	advance(16);
	const grown = draws[draws.length - 1];
	assert(
		sameMatrix(
			localOf(assembleHolder as Container),
			restOf(element).append(new Matrix(2, 0, 0, 2, 0, 0)),
		) &&
			grown.texture.width === 200 &&
			assembleMeshes.every((m) => m.texture === grown.texture) &&
			near(grown.transform.a, 1) &&
			near(grown.transform.tx, 100),
		'the element growing (a zoom) lays the specks over its new box, from a still remade to fit',
	);
	advance(16);
	assert(
		firstStill !== grown.texture && firstStill.destroyed && !grown.texture.destroyed,
		'the still it outgrew is let go a frame later',
	);
	advance(500);
	assert(element.alpha === 0 && layer?.alpha === 1, 'midway the specks are coming together');
	advance(600);
	element.position.set(rest[0], rest[1]);
	element.rotation = rest[4];
	assert(
		!assemble.active &&
			!!layer?.destroyed &&
			!element.isRenderGroup &&
			JSON.stringify(snapshot(element)) === JSON.stringify(rest),
		'at the end the element is back exactly, no longer a render group, and the specks are gone',
	);

	// A zoom from nothing: the cue fires while the element has no size to cut.
	const fromNothing = makeTarget();
	fromNothing.boundsArea = undefined as unknown as Rectangle;
	const seed = fromNothing.addChild(new Container());
	seed.boundsArea = new Rectangle(-50, -60, 100, 120);
	seed.scale.set(0);
	playElementFx(
		fromNothing,
		{ kind: 'assemble', durationMs: 1000, params: { particles: 200 } },
		{ ...host, renderer: liveRenderer as never },
	);
	const breakOf = (c: Container) => c.parent?.children.find((x) => x.label === 'elementFx:break');
	advance(200);
	assert(
		fromNothing.alpha === 0 && !breakOf(fromNothing),
		'with no size yet it waits hidden, rather than fading in instead',
	);
	seed.scale.set(0.5);
	advance(16);
	const late = breakOf(fromNothing);
	assert(
		!!late &&
			fromNothing.alpha === 0 &&
			sameMatrix(localOf(late), restOf(fromNothing)) &&
			draws[draws.length - 1].container === fromNothing,
		'and breaks as soon as it has one, laid over it',
	);
	advance(1000);

	// Shown by a key on the frame its cue fires: hidden when the break would start.
	const shownLate = makeTarget();
	shownLate.visible = false;
	playElementFx(
		shownLate,
		{ kind: 'assemble', durationMs: 1000, params: { particles: 200 } },
		{ ...host, renderer: liveRenderer as never },
	);
	advance(100);
	assert(
		!breakOf(shownLate) && shownLate.alpha === 0,
		'hidden when it would start, it waits rather than fading in instead',
	);
	shownLate.visible = true;
	advance(16);
	assert(!!breakOf(shownLate) && shownLate.alpha === 0, 'and breaks once shown');
	advance(1000);

	// A rig swinging: the element's box changes shape every frame.
	const swinging = makeTarget();
	swinging.boundsArea = undefined as unknown as Rectangle;
	const limb = swinging.addChild(new Container());
	limb.boundsArea = new Rectangle(-50, -60, 100, 120);
	playElementFx(
		swinging,
		{ kind: 'assemble', durationMs: 1000, params: { particles: 200 } },
		{ ...host, renderer: liveRenderer as never },
	);
	advance(16);
	const swing = breakOf(swinging) as Container;
	const scales: number[][] = [];
	for (const [sx, sy] of [
		[1.4, 1],
		[1, 1],
		[1.2, 0.8],
		[1, 1],
	]) {
		limb.scale.set(sx, sy);
		advance(16);
		const m = localOf(swing);
		const r = restOf(swinging);
		scales.push([
			Math.hypot(m.a, m.b) / Math.hypot(r.a, r.b),
			Math.hypot(m.c, m.d) / Math.hypot(r.c, r.d),
		]);
	}
	assert(
		scales.every(([x, y]) => near(x, y, 1e-4)) &&
			scales.every(([x], i) => i === 0 || x >= scales[i - 1][0] - 1e-6) &&
			near(scales[0][0], 1.4, 1e-4),
		'its specks grow evenly to what it fills and never shrink back, so a swing neither stretches nor shakes them',
	);
	advance(1000);

	// Two at once on one element (two entries, or a keyed pose over a cued play).
	const twice = makeTarget();
	const first = playElementFx(
		twice,
		{ kind: 'assemble', durationMs: 600, params: { particles: 100 } },
		{ ...host, renderer: liveRenderer as never },
	);
	advance(300);
	playElementFx(
		twice,
		{ kind: 'assemble', durationMs: 600, params: { particles: 100 } },
		{ ...host, renderer: liveRenderer as never },
	);
	advance(400);
	assert(
		!first.active && twice.isRenderGroup,
		'two live breaks on one element: the first ending leaves it drawing for the second',
	);
	advance(400);
	assert(!twice.isRenderGroup, 'and the last gives it back no longer a render group');
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
	const header = (
		read('packages/pixi-svelte/src/lib/elementFx/shaders.ts')
			.split('const HEADER = `')[1]
			?.split('`;')[0] ?? ''
	).replace(/\/\/[^\n]*/g, '');
	const declared = [...header.matchAll(/^(?:vec[234]|float|bool)\s+(efx\w+)\s*\(/gm)].map(
		(m) => m[1],
	);
	assert(
		declared.length >= 8 &&
			[...declared].sort().join() === [...EFX_HEADER_FUNCTIONS].sort().join() &&
			declared.every((name) => !(name in EFX_GLSL)),
		`EFX_HEADER_FUNCTIONS is what the pass header declares (${declared.length}), none a library entry`,
	);
	assert(
		JSON.stringify(unknownEfxCalls('void main(void) { efxSample(efxPx()); efxNoise(p); }')) ===
			'[]' &&
			JSON.stringify(
				unknownEfxCalls('void main(void) { efxFuture(p); efxNoise(p); // efxGone(p)\n }'),
			) === '["efxFuture"]' &&
			fragments.every(([, fragment]) => !unknownEfxCalls(fragment).length),
		'unknownEfxCalls names a call neither the library nor the header has (comments aside); no built-in pass makes one',
	);
	const own =
		'void efxGlsl_0(inout vec4 color)\n{\n    color = efxSample(efxPx());\n}\nvoid main(void) { vec4 c = vec4(0.0); efxGlsl_0(c); efxGlsl_1(c); }';
	assert(
		JSON.stringify(unknownEfxCalls(own)) === '["efxGlsl_1"]',
		'a function the pass declares itself (a Custom GLSL node’s) is no unknown call; one it does not declare is',
	);
	const flat = (text: string): string => text.replace(/\s+/g, ' ').trim();
	const headerSource = flat(header);
	const signatureNames = Object.keys(EFX_HEADER_SIGNATURES).sort().join();
	const unheld = Object.values(EFX_HEADER_SIGNATURES).filter(
		(signature) => !headerSource.includes(flat(signature)),
	);
	assert(
		signatureNames === [...EFX_HEADER_FUNCTIONS].sort().join() && !unheld.length,
		`EFX_HEADER_SIGNATURES is each header function as the header declares it${unheld.length ? `: ${unheld.join(', ')}` : ''}`,
	);
	// The particle shell (Shader Graph step 8d) runs the same bodies: its header declares the same
	// helpers, each as the element's does.
	const particleHeader = PARTICLE_HEADER.replace(/\/\/[^\n]*/g, '');
	const particleDeclared = [
		...particleHeader.matchAll(/^(?:vec[234]|float|bool)\s+(efx\w+)\s*\(/gm),
	].map((m) => m[1]);
	const particleUnheld = Object.values(EFX_HEADER_SIGNATURES).filter(
		(signature) => !flat(particleHeader).includes(flat(signature)),
	);
	assert(
		[...particleDeclared].sort().join() === [...EFX_HEADER_FUNCTIONS].sort().join() &&
			particleDeclared.every((name) => !(name in EFX_GLSL)) &&
			!particleUnheld.length,
		`EFX_HEADER_FUNCTIONS is what the particle shell's header declares too (${particleDeclared.length}), each as EFX_HEADER_SIGNATURES says${particleUnheld.length ? `: not ${particleUnheld.join(', ')}` : ''}`,
	);
	// The screen shell (Shader Graph step 8e) runs them too: its header declares the same helpers.
	const screenHeader = SCREEN_HEADER.replace(/\/\/[^\n]*/g, '');
	const screenDeclared = [
		...screenHeader.matchAll(/^(?:vec[234]|float|bool)\s+(efx\w+)\s*\(/gm),
	].map((m) => m[1]);
	const screenUnheld = Object.values(EFX_HEADER_SIGNATURES).filter(
		(signature) => !flat(screenHeader).includes(flat(signature)),
	);
	assert(
		[...screenDeclared].sort().join() === [...EFX_HEADER_FUNCTIONS].sort().join() &&
			screenDeclared.every((name) => !(name in EFX_GLSL)) &&
			!screenUnheld.length,
		`EFX_HEADER_FUNCTIONS is what the screen shell's header declares too (${screenDeclared.length}), each as EFX_HEADER_SIGNATURES says${screenUnheld.length ? `: not ${screenUnheld.join(', ')}` : ''}`,
	);
	// A body reading the Particle node (step 8d) calls its three helpers: this runtime keeps it, and a
	// runtime whose header list lacks them (before 8d) leaves the effect out.
	const reading = graphBuilder({
		id: 'particle-reader',
		name: 'Particle reader',
		phase: 'emphasis',
		durationMs: 1000,
	});
	const particleNode = reading.node('particle');
	const plusWave = reading.node('add');
	const plusOrder = reading.node('add');
	reading.wire(particleNode, 'color', plusWave, 'a');
	reading.wire(particleNode, 'wave', plusWave, 'b');
	reading.wire(plusWave, 'out', plusOrder, 'a');
	reading.wire(particleNode, 'order', plusOrder, 'b');
	reading.wire(plusOrder, 'out', reading.node('output'), 'color');
	const readingEffect = compileShaderEffect(reading.doc());
	const particleBody = readingEffect.ok ? readingEffect.effect.shader.body : '';
	const headerList = EFX_HEADER_FUNCTIONS as unknown as string[];
	const current = [...headerList];
	let older: { calls: string[]; read: boolean } | undefined;
	try {
		headerList.splice(0, headerList.length, ...current.filter((n) => !n.startsWith('efxParticle')));
		older = {
			calls: unknownEfxCalls(particleBody),
			read: !!(readingEffect.ok && readCustomElementFx(readingEffect.effect)),
		};
	} finally {
		headerList.splice(0, headerList.length, ...current);
	}
	assert(
		readingEffect.ok &&
			['efxParticleColor(', 'efxParticleWave(', 'efxParticleOrder('].every((c) =>
				particleBody.includes(c),
			) &&
			!unknownEfxCalls(particleBody).length &&
			!!readCustomElementFx(readingEffect.effect) &&
			older?.calls.join() === 'efxParticleColor,efxParticleWave,efxParticleOrder' &&
			older.read === false,
		`the reader keeps an effect whose body calls the Particle node's helpers; with the header list before 8d (without them) it would drop it (unknown: ${older?.calls.join(', ')})`,
	);
	// A body reading the Screens node (step 8e) calls its three helpers: this runtime keeps it, and a
	// runtime whose header list lacks them (before 8e) leaves the effect out.
	const crossing = graphBuilder({
		id: 'screens-reader',
		name: 'Screens reader',
		phase: 'enter',
		durationMs: 1000,
	});
	const screensNode = crossing.node('screens');
	const crossfade = crossing.node('mix');
	const mirrored = crossing.node('add');
	crossing.wire(screensNode, 'from', crossfade, 'a');
	crossing.wire(screensNode, 'to', crossfade, 'b');
	crossing.wire(screensNode, 'reverse', crossfade, 't');
	crossing.wire(crossfade, 'out', mirrored, 'a');
	crossing.wire(screensNode, 'reverse', mirrored, 'b');
	crossing.wire(mirrored, 'out', crossing.node('output'), 'color');
	const crossingEffect = compileShaderEffect(crossing.doc());
	const screensBody = crossingEffect.ok ? crossingEffect.effect.shader.body : '';
	let beforeScreens: { calls: string[]; read: boolean } | undefined;
	try {
		headerList.splice(0, headerList.length, ...current.filter((n) => !n.startsWith('efxScreen')));
		beforeScreens = {
			calls: unknownEfxCalls(screensBody),
			read: !!(crossingEffect.ok && readCustomElementFx(crossingEffect.effect)),
		};
	} finally {
		headerList.splice(0, headerList.length, ...current);
	}
	assert(
		crossingEffect.ok &&
			['efxScreenFrom(', 'efxScreenTo(', 'efxScreenReverse('].every((c) =>
				screensBody.includes(c),
			) &&
			!unknownEfxCalls(screensBody).length &&
			!!readCustomElementFx(crossingEffect.effect) &&
			beforeScreens?.calls.join() === 'efxScreenFrom,efxScreenTo,efxScreenReverse' &&
			beforeScreens.read === false,
		`the reader keeps an effect whose body calls the Screens node's helpers; with the header list before 8e (without them) it would drop it (unknown: ${beforeScreens?.calls.join(', ')})`,
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
	// The pass header's helpers are no building blocks: two of its neutral ones may answer alike.
	const helper = (name: string): boolean =>
		(EFX_HEADER_FUNCTIONS as readonly string[]).includes(name);
	const copies = (code: string): string[] => {
		const all = bodies(code, names);
		return all
			.filter(
				([name, body], i) =>
					all.findIndex(
						([other, otherBody], j) =>
							otherBody === body && (j === i || !(helper(name) && helper(other))),
					) !== i,
			)
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
console.log('element fx — a pass the GPU refuses (the fail-safe)');
{
	const LINK_STATUS = 0x8b82;
	/**
	 * A stand-in WebGL renderer whose driver links the programs `links` says (null: no boolean, as a
	 * context lost while asking answers), counting questions.
	 */
	const renderer = (
		links: (fragment: string) => boolean | null,
		lost = false,
		type = RendererType.WEBGL,
	) => {
		const made = new Map<GlProgram, object>();
		const asked = { link: 0 };
		return {
			asked,
			type,
			gl: {
				LINK_STATUS,
				isContextLost: () => lost,
				getProgramParameter: (program: { fragment: string }, what: number) => {
					if (what !== LINK_STATUS) return null;
					asked.link++;
					return links(program.fragment);
				},
			},
			shader: {
				_getProgramData: (program: GlProgram) => {
					if (!made.has(program)) made.set(program, { fragment: program.fragment });
					return { program: made.get(program) };
				},
			},
		};
	};
	type Applied = { filter: Filter; enabled: boolean };
	const system = (r: ReturnType<typeof renderer>) => {
		const applied: Applied[] = [];
		return {
			applied,
			manager: {
				renderer: r,
				applyFilter: (filter: Filter) => applied.push({ filter, enabled: filter.enabled }),
			} as unknown as Parameters<Filter['apply']>[0],
		};
	};
	const apply = (filter: Filter, s: ReturnType<typeof system>): Applied | undefined => {
		filter.apply(s.manager, Texture.WHITE, Texture.WHITE as never, true);
		return s.applied[s.applied.length - 1];
	};
	const warned: string[] = [];
	const warn = console.warn;
	console.warn = (...args: unknown[]) => warned.push(args.map(String).join(' '));
	try {
		const refuseShine = renderer((fragment) => !fragment.includes('element-fx-shine'));
		const s = system(refuseShine);
		const shine = SHADERS.shineFilter();
		const wave = SHADERS.waveFilter();
		const first = apply(shine, s);
		const drawn = apply(wave, s);
		const second = SHADERS.shineFilter();
		const again = apply(second, s);
		const later = apply(shine, s);
		const throughs = [first, again, later].map((a) => a?.filter);
		assert(
			first?.filter !== shine &&
				first?.enabled === true &&
				/finalColor = texture\(uTexture, vTextureCoord\);/.test(
					(first?.filter.glProgram as GlProgram).fragment,
				) &&
				shine.enabled === false &&
				drawn?.filter === wave &&
				wave.enabled === true &&
				throughs.every((f) => f === first?.filter) &&
				second.enabled === false,
			'a pass the driver refuses draws the element through as it is (a pass-through of its own, not Pixi’s) and is disabled; one it links draws itself; a second filter of the refused program likewise',
		);
		assert(
			warned.length === 1 && warned[0].includes('shine') && warned[0].includes('did not compile'),
			`the refused pass is logged once, however often it is drawn (${warned.length})`,
		);
		assert(
			refuseShine.asked.link === 2,
			`the driver is asked once per program, not per frame (${refuseShine.asked.link} questions for 2 programs over 5 draws)`,
		);
		const lost = system(renderer(() => false, true));
		const gpu = system(renderer(() => false, false, RendererType.WEBGPU));
		const flag = SHADERS.twistFilter();
		const glitch = SHADERS.bulgeFilter();
		assert(
			apply(flag, lost)?.filter === flag &&
				flag.enabled &&
				apply(glitch, gpu)?.filter === glitch &&
				glitch.enabled,
			'a lost context, or a renderer that is not WebGL, changes nothing: the pass draws as it would have',
		);
		const pixi = renderer(() => false);
		const curl = SHADERS.curlFilter();
		const ripple = SHADERS.rippleFilter();
		let thrown = '';
		let drawnAnyway = false;
		try {
			drawnAnyway =
				apply(curl, system({ ...pixi, shader: {} as typeof pixi.shader }))?.filter === curl &&
				apply(
					ripple,
					system({
						...pixi,
						shader: {
							_getProgramData: () => {
								throw new Error('a newer Pixi');
							},
						},
					}),
				)?.filter === ripple;
		} catch (error) {
			thrown = (error as Error).message;
		}
		assert(
			!thrown && drawnAnyway && curl.enabled && ripple.enabled,
			`a Pixi without _getProgramData, or one whose call throws, changes nothing: the pass draws and nothing throws out of apply${thrown ? `: threw ${thrown}` : ''}`,
		);
		const answers: (boolean | null)[] = [null, false];
		const flaky = renderer(() => (answers.length ? (answers.shift() as boolean | null) : false));
		const melt = SHADERS.meltFilter();
		const asked = system(flaky);
		const before = apply(melt, asked);
		const wasOn = melt.enabled;
		const after = apply(melt, asked);
		assert(
			before?.filter === melt &&
				wasOn &&
				after?.filter !== melt &&
				!melt.enabled &&
				flaky.asked.link === 2,
			'a driver answering no boolean (the context lost while asking) is no answer: the pass draws, nothing is kept, and the next draw asks again',
		);
		const graph = compileShaderEffect(REFERENCE_GRAPHS[0]);
		if (!graph.ok) throw new Error('reference graph');
		const pass = customKindImpl({ ...graph.effect, passes: [] }).filters?.[0];
		const frame: FxFrame = {
			t: 0.5,
			seconds: 0.5,
			playSeconds: 1,
			intensity: 1,
			params: {},
			looping: false,
			width: 100,
			height: 100,
		};
		const made = pass?.create(frame);
		const refuseAll = system(renderer(() => false));
		assert(
			!!made &&
				made instanceof SHADERS.ElementFxFilter &&
				apply(made, refuseAll)?.filter !== made &&
				made.enabled === false,
			'a custom effect’s graph pass is such a pass: refused, it is left out the same way',
		);
	} finally {
		console.warn = warn;
	}
}

// -------------------------------------------------------------------------------------------------
console.log('element fx — custom effects (Shader Graph)');
{
	assert(
		ELEMENT_FX_PASS_KINDS.every((kind) => {
			const impl = KINDS[kind];
			return !!impl.filter && !impl.motion && !impl.breaks && !impl.filters;
		}),
		'every pass kind a custom effect may draw is a single shader pass: no motion, no break',
	);
	const curve = [
		{ t: 0, v: 0, ease: 'hold' as const },
		{ t: 0.5, v: 10, ease: 'smooth' as const },
		{ t: 1, v: 20 },
	];
	assert(
		sampleElementFxCurve(curve, -1) === 0 &&
			sampleElementFxCurve(curve, 0.49) === 0 &&
			sampleElementFxCurve(curve, 0.5) === 10 &&
			near(sampleElementFxCurve(curve, 0.75), 15) &&
			sampleElementFxCurve(curve, 2) === 20 &&
			sampleElementFxCurve([], 0.5) === 0,
		'a curve holds its ends, eases between keys (a hold steps), and an empty one reads 0',
	);

	const compiled = REFERENCE_GRAPHS.map((doc) => compileShaderEffect(doc));
	const effects = compiled.flatMap((r) => (r.ok ? [r.effect] : []));
	const PULSE = 'custom:pulseTint';
	const POWER = 'custom:powerUp';
	const DISSOLVE = 'custom:noiseDissolve';

	assert(
		!isPlayableElementFxKind(PULSE) &&
			isCustomElementFxKind(PULSE) &&
			!isCustomElementFxKind('custom:a.b') &&
			!isCustomElementFxKind('pulseTint'),
		'a custom kind is custom:<slug>, and plays only once registered',
	);
	const stored = [
		{ id: 'a', kind: PULSE, trigger: 'always' },
		{ id: 'b', kind: POWER, trigger: 'enter', params: { color: '#00ff00', stray: 1 } },
		{ id: 'c', kind: PULSE, trigger: 'cue', cue: 'go', stopCue: 'halt' },
		{ id: 'k', kind: DISSOLVE, trigger: 'keyed' },
		{ id: 'u', kind: 'custom:later', trigger: 'cue', cue: 'later', params: { n: 2, o: {} } },
		{ id: 'z', kind: 'custom:not.a.slug', trigger: 'cue', cue: 'x' },
	];
	const early = readElementFxEntries(stored);
	assert(
		early.map((e) => e.id).join() === 'a,b,c,k,u' &&
			JSON.stringify(early.find((e) => e.id === 'u')?.params) === JSON.stringify({ n: 2 }),
		'read before anything is registered, every well-formed custom entry is kept (plain values), a bad id dropped',
	);
	const playUnregistered = playElementFx(makeTarget(), { kind: PULSE }, makeHost().host);
	assert(!playUnregistered.active, 'an unregistered custom kind plays nothing');

	setCustomElementFx(effects);
	assert(
		effects.length === REFERENCE_GRAPHS.length &&
			isPlayableElementFxKind(PULSE) &&
			!isElementFxKind(PULSE) &&
			customElementFx(POWER)?.passes.length === 1,
		'registered, each reference graph is a playable custom kind (not a built-in)',
	);
	const entries = readElementFxEntries(stored);
	assert(
		JSON.stringify(entries.find((e) => e.id === 'b')?.params) ===
			JSON.stringify({ color: '#00ff00' }) &&
			JSON.stringify(elementFxCueNames(entries)) === JSON.stringify(['go', 'halt', 'later']) &&
			JSON.stringify(elementFxChannels(entries)) === JSON.stringify(['efx:k', 'efx:k:intensity']) &&
			elementFxEnterEnds(entries.find((e) => e.id === 'b') as never),
		'registered, its params read against its spec; its cues, keyed channels and enter beat count like a built-in’s',
	);
	assert(
		JSON.stringify(resolveElementFxParams(POWER, { color: '#123456' })) ===
			JSON.stringify({ color: '#123456' }) &&
			JSON.stringify(resolveElementFxParams('custom:later', { n: 2 })) === '{}',
		'its params resolve over its defaults; an unregistered one resolves to none',
	);

	{
		const { host, advance } = makeHost();
		const target = makeTarget();
		const own = new Filter({
			glProgram: GlProgram.from({
				vertex: 'void main(){}',
				fragment: 'void main(){}',
				name: 'own',
			}),
		});
		target.filters = [own];
		const play = playElementFx(target, { kind: PULSE, durationMs: 400 }, host);
		advance(100);
		const graph = target.filters?.[1] as ElementFxFilter | undefined;
		const fx = graph?.efx.uFx as Float32Array | undefined;
		assert(
			target.filters?.length === 2 &&
				target.filters[0] === own &&
				graph instanceof SHADERS.ElementFxFilter &&
				!!fx &&
				fx[0] > 0.1 &&
				fx[0] < 0.5 &&
				near(fx[2], 1),
			'its graph plays as one pass after the container’s own, fed its progress and strength',
		);
		const tint = graph?.efx.uP0 as Float32Array | undefined;
		assert(
			!!tint && near(tint[0], 0x66 / 255) && near(tint[2], 1),
			'its colour param reaches its uniform',
		);
		let settled = false;
		void play.done.then(() => (settled = true));
		advance(400);
		await Promise.resolve();
		assert(
			settled &&
				!play.active &&
				target.filters?.length === 1 &&
				target.filters[0] === own &&
				target.filterArea === undefined,
			'it ends and leaves the container’s own list and filter area as they were',
		);
	}
	{
		const { host, advance } = makeHost();
		const target = makeTarget();
		const rest = snapshot(target);
		playElementFx(target, { kind: POWER, durationMs: 600, params: { color: '#00ff00' } }, host);
		advance(200);
		const [graph, glow] = target.filters ?? [];
		assert(
			target.filters?.length === 2 &&
				graph instanceof SHADERS.ElementFxFilter &&
				!(glow instanceof SHADERS.ElementFxFilter) &&
				String((glow as unknown as { color: unknown }).color) === '#00ff00',
			'its built-in pass draws after its graph, its colour tied to the effect’s param',
		);
		assert(
			JSON.stringify(snapshot(target)) !== JSON.stringify(rest),
			'its motion curves move the element',
		);
		advance(500);
		assert(
			JSON.stringify(snapshot(target)) === JSON.stringify(rest) && !target.filters?.length,
			'and it ends with every value exactly as it was',
		);
	}
	{
		const { host, advance } = makeHost();
		const target = makeTarget();
		const out = playElementFx(target, { kind: DISSOLVE, durationMs: 300 }, host);
		advance(400);
		assert(
			out.active && target.filters?.length === 1,
			'a custom exit holds its last frame after it plays',
		);
		playElementFx(target, { kind: 'popIn', durationMs: 200 }, host);
		assert(!out.active && !target.filters?.length, 'an enter releases it');
		advance(300);
		const again = playElementFx(target, { kind: DISSOLVE, durationMs: 200 }, host);
		advance(300);
		stopElementFx(target);
		assert(
			!again.active && !target.filters?.length && near(target.alpha, 0.8),
			'stop puts it back',
		);
	}
	{
		const { host, advance } = makeHost();
		const target = makeTarget();
		let pose: { progress?: number; intensity?: number } | undefined;
		const keyed = playElementFx(target, { kind: PULSE, pose: () => pose }, host);
		advance(200);
		assert(!target.filters?.length, 'posed at nothing, it is at rest');
		pose = { progress: 0.5, intensity: 0.5 };
		advance(16);
		const fx = (target.filters?.[0] as ElementFxFilter | undefined)?.efx.uFx as
			Float32Array | undefined;
		assert(
			!!fx && near(fx[0], 0.5) && near(fx[2], 0.5),
			'a timeline poses it: its progress and strength are the keys’',
		);
		advance(1000);
		assert(!!fx && near(fx[0], 0.5), 'a pose holds still');
		pose = { progress: 0 };
		advance(16);
		assert(!target.filters?.length && keyed.active, 'back to 0, it is at rest and waits');
		keyed.stop();
	}
	{
		const slow = makeHost(1);
		const fast = makeHost(2);
		const a = playElementFx(makeTarget(), { kind: PULSE, durationMs: 600 }, slow.host);
		const b = playElementFx(makeTarget(), { kind: PULSE, durationMs: 600 }, fast.host);
		slow.advance(320);
		fast.advance(320);
		assert(a.active && !b.active, 'turbo: at a time scale of 2 it plays in half the time');
		slow.advance(400);
	}
	{
		const { host, advance } = makeHost();
		const target = makeTarget();
		const playing = playElementFx(target, { kind: PULSE, durationMs: 400 }, host);
		setCustomElementFx([]);
		advance(100);
		const next = playElementFx(target, { kind: PULSE }, host);
		assert(
			playing.active && target.filters?.length === 1 && !next.active,
			'a new set leaves what is playing alone; the kind it dropped plays nothing new',
		);
		const later: CustomElementFx = {
			...effects[0],
			spec: { ...effects[0].spec, kind: 'custom:later', label: 'Later' },
		};
		setCustomElementFx([later]);
		const now = playElementFx(makeTarget(), { kind: 'custom:later' }, host);
		assert(now.active, 'and an entry kept from before plays once its effect is registered');
		advance(2000);
		setCustomElementFx([]);
	}
	{
		const good = effects[0];
		const named = (kind: string) => ({ ...good.spec, kind });
		const bad = [
			{
				...good,
				spec: named('custom:badUniform'),
				shader: {
					...good.shader,
					uniforms: [{ name: 'uFx', type: 'mat4', source: { kind: 'time' } }],
				},
			},
			{
				...good,
				spec: named('custom:nullParam'),
				passes: [{ kind: 'glow', params: { color: null } }],
			},
			{
				...good,
				spec: named('custom:badEase'),
				motion: { channels: { x: [{ t: 0, v: 0, ease: 'bounce' }] } },
			},
			{ spec: named('custom:noPasses'), shader: good.shader, padding: 0 },
			{ ...good, spec: named('custom:tooWide'), padding: 5 },
		];
		const twice = { ...good, spec: { ...good.spec, label: 'Second' } };
		let registered: CustomElementFx[] = [];
		let threw = false;
		try {
			registered = setCustomElementFx([...bad, good, twice]);
		} catch {
			threw = true;
		}
		assert(
			!threw &&
				registered.length === 1 &&
				registered[0].spec.label === 'Second' &&
				registered[0] !== twice &&
				bad.every((b) => !isPlayableElementFxKind(b.spec.kind)),
			'the registry reads what it is given: a malformed effect (an unknown uniform type, a null pass value, an unknown ease, no passes, padding past 2) is left out, never thrown on; a kind given twice plays as its last, kept as a copy',
		);
		setCustomElementFx([
			{ ...good, spec: named('custom:padded'), padding: 0.5 },
			{
				...good,
				spec: named('custom:shrink'),
				motion: { channels: { scale: [{ t: 0, v: 0.5 }] } },
			},
		]);
		const { host, advance } = makeHost();
		const padded = makeTarget();
		playElementFx(padded, { kind: 'custom:padded', durationMs: 400 }, host);
		const shrunk = makeTarget();
		playElementFx(shrunk, { kind: 'custom:shrink', intensity: 4, durationMs: 400 }, host);
		advance(50);
		assert(
			(padded.filters?.[0]?.padding ?? 0) > 2,
			'padding asks its pass for room around the element',
		);
		assert(
			shrunk.scale.x > 0 && shrunk.scale.y > 0 && near(shrunk.rotation, 0.2, 1e-3),
			'a shrink played four times as strong stops short of nothing: it never turns the element over',
		);
		stopElementFx(padded);
		stopElementFx(shrunk);
		setCustomElementFx([]);
	}
	{
		const burn = BUILTIN_TWINS.find((t) => t.kind === 'burn');
		const seeded = burn ? compileShaderEffect(burn.doc) : undefined;
		setCustomElementFx([...(seeded?.ok ? [seeded.effect] : []), effects[0]]);
		const { host, advance } = makeHost();
		const random = Math.random;
		let draws = 0;
		Math.random = () => {
			draws++;
			return random();
		};
		const a = makeTarget();
		const b = makeTarget();
		playElementFx(a, { kind: 'custom:burn', durationMs: 400 }, host);
		playElementFx(b, { kind: 'custom:burn', durationMs: 400 }, host);
		const seedDraws = draws;
		const plain = makeTarget();
		playElementFx(plain, { kind: PULSE, durationMs: 400 }, host);
		const plainDraws = draws - seedDraws;
		Math.random = random;
		const seedOf = (t: Container): unknown =>
			(t.filters?.[0] as ElementFxFilter | undefined)?.efx.uSeed;
		const [first, second] = [seedOf(a), seedOf(b)];
		advance(100);
		assert(
			seedDraws === 2 &&
				plainDraws === 0 &&
				typeof first === 'number' &&
				typeof second === 'number' &&
				first !== second &&
				first >= 0 &&
				first < 97 &&
				seedOf(a) === first &&
				seedOf(plain) === undefined,
			'a custom effect reading the seed draws one for each element (two burning at once differ) and keeps it while it plays; one that reads none draws none',
		);
		for (const t of [a, b, plain]) stopElementFx(t);
		setCustomElementFx([]);
	}
	{
		// An effect compiled by a newer Shader Graph may call a library entry this version lacks:
		// left out (it plays nothing), never handed to the GPU as a shader that fails.
		const good = effects[0];
		const calling = (call: string, kind: string) => ({
			...good,
			spec: { ...good.spec, kind },
			shader: {
				...good.shader,
				body: good.shader.body.replace('void main(void)\n{', `void main(void)\n{\n    ${call};`),
			},
		});
		const unknown = calling('float later = efxNotYetWritten(px)', 'custom:fromTheFuture');
		const known = calling('float seen = efxNoise(px)', 'custom:fromNow');
		const seed = { name: 'uSeed', type: 'float', source: { kind: 'seed' } };
		const twoSeeds = {
			...good,
			spec: { ...good.spec, kind: 'custom:twoSeeds' },
			shader: {
				...good.shader,
				uniforms: [...good.shader.uniforms, seed, { ...seed, name: 'uSeed2' }],
			},
		};
		const shipped = [...REFERENCE_GRAPHS, ...BUILTIN_TWINS.map((t) => t.doc)].map((doc) =>
			compileShaderEffect(doc),
		);
		const registered = setCustomElementFx([unknown, known, twoSeeds]);
		const play = playElementFx(makeTarget(), { kind: 'custom:fromTheFuture' }, makeHost().host);
		assert(
			unknown.shader.body.includes('efxNotYetWritten(px)') &&
				registered.map((e) => e.spec.kind).join() === 'custom:fromNow' &&
				!play.active &&
				shipped.every((r) => r.ok && !!readCustomElementFx(r.effect)),
			'the registry leaves out an effect calling an efx… function neither the library nor the pass header has (it plays nothing), and one with two seeds; every reference graph and twin reads',
		);
		setCustomElementFx([]);
	}
}

// -------------------------------------------------------------------------------------------------
console.log('element fx — motion programs (Shader Graph motion graph)');
{
	type Ref = readonly [string, string];
	type In = Ref | number;
	/** A motion graph written as expressions: each call adds a node and returns its output. */
	const motionGraph = () => {
		const nodes: GraphNode[] = [];
		const wires: GraphWire[] = [];
		const add = (type: string, inputs: Record<string, In> = {}, values = {}): string => {
			const id = `n${nodes.length}`;
			const own: Record<string, number | string> = { ...values };
			for (const [port, v] of Object.entries(inputs)) {
				if (typeof v === 'number') own[port] = v;
				else wires.push({ from: { node: v[0], port: v[1] }, to: { node: id, port } });
			}
			nodes.push({ id, type, x: 0, y: 0, ...(Object.keys(own).length ? { values: own } : {}) });
			return id;
		};
		const f = (type: string, inputs: Record<string, In> = {}, values = {}): Ref => [
			add(type, inputs, values),
			'out',
		];
		const time = add('time');
		const shape = add('shape');
		return {
			f,
			add,
			t: [time, 'progress'] as Ref,
			seconds: [time, 'seconds'] as Ref,
			intensity: [time, 'intensity'] as Ref,
			looping: [time, 'looping'] as Ref,
			width: [shape, 'width'] as Ref,
			height: [shape, 'height'] as Ref,
			param: (id: string): Ref => f('param', {}, { param: id }),
			mul: (a: In, b: In): Ref => f('multiply', { a, b }),
			sin: (x: In): Ref => f('sin', { x }),
			graph: (outputs: Partial<Record<ElementFxMotionOutput, Ref>>) => {
				const out = add('motionOutput');
				for (const [port, from] of Object.entries(outputs))
					wires.push({ from: { node: from[0], port: from[1] }, to: { node: out, port } });
				return { nodes, wires };
			},
		};
	};
	type G = ReturnType<typeof motionGraph>;
	/** An effect of `kind`'s params, phase and length: the element as it is, moved by `graph`. */
	const effectOf = (
		kind: ElementFxKind,
		graph: (g: G) => ReturnType<G['graph']>,
		more: Partial<ShaderGraphDoc> = {},
	): CustomElementFx => {
		const spec = ELEMENT_FX.find((s) => s.kind === kind) as (typeof ELEMENT_FX)[number];
		const doc: ShaderGraphDoc = {
			version: 1,
			id: `moving-${kind}`,
			name: spec.label,
			phase: spec.phase,
			durationMs: spec.durationMs,
			params: spec.params.map((p) => ({ ...p })),
			nodes: [{ id: 'out', type: 'output', x: 0, y: 0 }],
			wires: [],
			motionGraph: graph(motionGraph()),
			...more,
		};
		const result = compileShaderEffect(doc);
		const read = result.ok ? readCustomElementFx(result.effect) : undefined;
		if (!read?.motion?.program)
			throw new Error(
				`${kind}: ${result.ok ? 'not read' : result.issues.map((i) => i.message).join('; ')}`,
			);
		return read;
	};
	/** What the twins' motion graphs move by, or grow their room with, that a curve could not. */
	const MOVES: Partial<Record<ElementFxKind, string>> = {
		freeze:
			'a shiver at 95 rad/s of the seconds played, when the Hold param says, 1.2% of the shorter side',
		petrify: 'a thud when the Hold param says',
		turnToGold: 'a ring when the Hold param says',
		electrocute:
			'a jitter up to 25 Hz of the seconds played, sized in the element’s units, full while looping; room only while it bites',
		poison: 'a sway eased in and out when counted, full while looping',
		bounce3D:
			'a squash landing as the Bounces param lands it, no harder past strength 1.5; room growing with Lift × strength',
		melt: 'room growing with Drip length × strength × how far it has melted',
		waveX: 'room growing with Amplitude × strength',
		waveY: 'room growing with Amplitude × strength',
		flag: 'room growing with Amplitude × strength',
	};
	const GAPS = Object.entries(MOVES).map(([kind, gap]) => {
		const twin = BUILTIN_TWINS.find((t) => t.kind === kind);
		const compiled = twin ? compileShaderEffect(twin.doc) : undefined;
		const effect = compiled?.ok ? readCustomElementFx(compiled.effect) : undefined;
		if (!effect?.motion?.program) throw new Error(`the ${kind} twin has no motion program`);
		return { kind: kind as ElementFxKind, gap, effect };
	});
	const SIZES = [
		[100, 120],
		[200, 80],
	];
	const COMPS = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'alpha', 'pivotX', 'pivotY'] as const;
	for (const { kind, gap, effect } of GAPS) {
		const spec = ELEMENT_FX.find((s) => s.kind === kind) as (typeof ELEMENT_FX)[number];
		const builtIn = KINDS[kind];
		const ours = customKindImpl(effect);
		const range = (id: string): unknown[] => {
			const p = spec.params.find((q) => q.id === id);
			if (p?.kind !== 'number') return [undefined];
			return id === 'bounces' ? [1, 2, 3, 4, 5] : [p.min, p.default, p.max];
		};
		const swept = spec.params.find((p) =>
			['hold', 'bounces', 'length', 'amplitude', 'height'].includes(p.id),
		);
		let frames = 0;
		let worst = 0;
		let rooms = 0;
		let roomOff = 0;
		for (const value of swept ? range(swept.id) : [undefined])
			for (const [width, height] of SIZES)
				for (const intensity of [0.5, 1, 2, 3, 4])
					for (const looping of [false, true])
						for (const loop of [0, 2])
							for (let i = 0; i <= 64; i++) {
								const t = i / 64;
								const playSeconds = spec.durationMs / 1000;
								const frame: FxFrame = {
									t,
									seconds: (loop + t) * playSeconds,
									playSeconds,
									intensity,
									params: resolveElementFxParams(kind, swept ? { [swept.id]: value } : {}),
									looping,
									width,
									height,
								};
								const a = { ...REST, ...builtIn.motion?.(frame) };
								const b = { ...REST, ...ours.motion?.(frame) };
								for (const c of COMPS) worst = Math.max(worst, Math.abs(a[c] - b[c]));
								frames++;
								const view = { screenWidth: width * 1.5, screenHeight: height * 1.5 };
								const want = builtIn.filter?.padding?.(frame, view);
								const room = ours.filters?.[0].padding?.(frame, view);
								if (want === undefined) continue;
								rooms++;
								// A room of nothing is 0 px here; a built-in still adds its 2 px margin.
								roomOff = Math.max(
									roomOff,
									Math.abs(Math.max(0, want - 2) - Math.max(0, (room ?? 0) - 2)),
								);
							}
		assert(
			worst < 1e-9 && roomOff <= 1,
			`${kind}: ${gap} — its twin's motion graph moves it as the built-in does over ${frames} frames (every ${swept ? `${swept.id}, ` : ''}size, strength up to 4, counted or looping, first or third play; largest difference ${worst.toExponential(1)})${rooms ? `, its room within ${roomOff} px over ${rooms}` : ''}`,
		);
	}

	// The runtime: a driven channel overrides its curve, at its value, kept to its range.
	const curved = (channels: object, graph: (g: G) => ReturnType<G['graph']>) =>
		effectOf('glow', graph, { motion: { channels: channels as never } });
	const over = customKindImpl(
		curved({ x: [{ t: 0, v: 0.3 }], alpha: [{ t: 0, v: 0.5 }], scaleX: [{ t: 0, v: 2 }] }, (g) =>
			g.graph({
				x: g.mul(g.t, 0.1),
				rotation: g.f('number', {}, { value: 30 }),
				scale: g.f('number', {}, { value: 1.5 }),
			}),
		),
	);
	const at = (t: number, intensity = 1): FxFrame => ({
		t,
		seconds: t,
		playSeconds: 1,
		intensity,
		params: {},
		looping: false,
		width: 100,
		height: 120,
	});
	const m = over.motion?.(at(0.5, 4));
	assert(
		!!m &&
			near(m.x ?? NaN, 0.05 * 100) &&
			near(m.rotation ?? NaN, (30 * Math.PI) / 180) &&
			near(m.alpha ?? NaN, 0.5) &&
			near(m.scaleX ?? NaN, 1.5 * (1 + 4 * (2 - 1))) &&
			near(m.scaleY ?? NaN, 1.5) &&
			near(m.y ?? NaN, 0),
		'a driven channel overrides its curve and is final (strength 4 does not scale it); an undriven one keeps its curve, scaled as before; a driven scale multiplies a curved scale X',
	);
	const wild = customKindImpl(
		curved({}, (g) =>
			g.graph({
				x: g.f('number', {}, { value: 50 }),
				alpha: g.f('number', {}, { value: 3 }),
				scaleX: g.f('number', {}, { value: -5 }),
				rotation: g.f('number', {}, { value: 1e6 }),
				padding: g.f('number', {}, { value: 50 }),
			}),
		),
	);
	const w = wild.motion?.(at(0.5));
	assert(
		!!w &&
			near(w.x ?? NaN, 10 * 100) &&
			w.alpha === 1 &&
			(w.scaleX ?? 0) > 0 &&
			near(w.rotation ?? NaN, (3600 * Math.PI) / 180) &&
			wild.filters?.[0].padding?.(at(0.5), { screenWidth: 100, screenHeight: 120 }) ===
				Math.ceil(CUSTOM_ELEMENT_FX_MOTION_PADDING_MAX * 120) + 2,
		`a driven value is kept to its channel’s range: x within 10 widths, alpha 0…1, a scale above 0, rotation within 3600°, padding within ${CUSTOM_ELEMENT_FX_MOTION_PADDING_MAX} shares`,
	);
	const roomOnly = customKindImpl(curved({}, (g) => g.graph({ padding: g.t })));
	assert(
		!roomOnly.motion &&
			roomOnly.filters?.[0].padding?.(at(0), { screenWidth: 100, screenHeight: 100 }) === 0 &&
			roomOnly.filters?.[0].padding?.(at(0.5), { screenWidth: 100, screenHeight: 100 }) === 52,
		'a program driving the padding alone writes no transform; its room is per frame, nothing at 0',
	);
	{
		const growing = curved({ alpha: [{ t: 0, v: 0.6 }] }, (g) =>
			g.graph({ padding: g.mul(g.t, 0.5), y: g.mul(g.t, 0.25) }),
		);
		setCustomElementFx([growing]);
		const { host, advance } = makeHost();
		const target = makeTarget();
		const rest = snapshot(target);
		playElementFx(target, { kind: growing.spec.kind, durationMs: 1000 }, host);
		advance(250);
		const early = target.filters?.[0]?.padding ?? 0;
		const moved = JSON.stringify(snapshot(target)) !== JSON.stringify(rest);
		advance(500);
		const late = target.filters?.[0]?.padding ?? 0;
		advance(400);
		assert(
			early > 2 &&
				late > early &&
				moved &&
				JSON.stringify(snapshot(target)) === JSON.stringify(rest),
			`played, its room grows with the play (${early} px, then ${late} px), it moves, and it ends with every value as it was`,
		);
		setCustomElementFx([]);
	}
	{
		// One seed per element, shared by the graph's pass and the program.
		const seeded = effectOf('glow', (g) => g.graph({ x: g.mul(g.f('seed'), 0.001) }), {
			nodes: [
				{ id: 's', type: 'seed', x: 0, y: 0 },
				{ id: 'f', type: 'fade', x: 0, y: 0 },
				{ id: 'out', type: 'output', x: 0, y: 0 },
			],
			wires: [
				{ from: { node: 's', port: 'out' }, to: { node: 'f', port: 'amount' } },
				{ from: { node: 'f', port: 'out' }, to: { node: 'out', port: 'color' } },
			],
		});
		setCustomElementFx([seeded]);
		const random = Math.random;
		let draws = 0;
		Math.random = () => {
			draws++;
			return random();
		};
		const { host, advance } = makeHost();
		const a = makeTarget();
		const b = makeTarget();
		playElementFx(a, { kind: seeded.spec.kind, durationMs: 400 }, host);
		playElementFx(b, { kind: seeded.spec.kind, durationMs: 400 }, host);
		advance(50);
		Math.random = random;
		const uSeed = (t: Container) =>
			(t.filters?.[0] as ElementFxFilter | undefined)?.efx.uSeed as number;
		const impl = customKindImpl(customElementFx(seeded.spec.kind) as CustomElementFx);
		const params = {};
		const frame = { ...at(0.5), params };
		const filter = impl.filters?.[0].create(frame) as ElementFxFilter;
		const shared = near(
			(impl.motion?.(frame).x ?? NaN) / 100,
			(filter.efx.uSeed as number) * 0.001,
			1e-12,
		);
		assert(
			draws === 2 && uSeed(a) !== uSeed(b) && shared,
			'the program reads the element’s seed: the one its graph’s pass reads, drawn once per element (two draws for two elements)',
		);
		filter.destroy();
		stopElementFx(a);
		stopElementFx(b);
		setCustomElementFx([]);
	}
	{
		// A program this version cannot run is dropped: the effect plays, on its curves.
		const good = curved({ x: [{ t: 0, v: 0.2 }] }, (g) => g.graph({ x: g.mul(g.t, 0.5) }));
		const future = {
			...good,
			spec: { ...good.spec, kind: 'custom:fromTheFuture' },
			motion: { ...good.motion, program: { ops: [['progress'], ['warp', 0]], outputs: { x: 1 } } },
		};
		const [registered] = setCustomElementFx([future]);
		const impl = registered ? customKindImpl(registered) : undefined;
		assert(
			!!registered &&
				registered.motion?.program === undefined &&
				near(impl?.motion?.(at(0.5)).x ?? NaN, 0.2 * 100),
			'an effect whose program uses an op this version lacks still plays: its program dropped, its curves move it, as a runtime from before motion programs plays it',
		);
		setCustomElementFx([]);
	}
}

// -------------------------------------------------------------------------------------------------
console.log('element fx — custom breaks (Shader Graph Break Output)');
{
	assert(
		JSON.stringify(ELEMENT_FX_BREAK_KINDS) ===
			JSON.stringify(ELEMENT_FX.filter((s) => s.category === 'break').map((s) => s.kind)) &&
			ELEMENT_FX_BREAK_KINDS.every(
				(kind) => !!KINDS[kind].breaks && isReversedElementFxBreak(kind) === !!KINDS[kind].reversed,
			),
		'the break kinds a custom effect may play are the catalog’s breaks, in order; the reversed one is the enter',
	);
	assert(
		JSON.stringify(customElementFxBreakWindow({ kind: 'shatter', at: 0.3 })) ===
			JSON.stringify({ from: 0.3, to: 1, edge: 0.3, reversed: false }) &&
			JSON.stringify(customElementFxBreakWindow({ kind: 'assemble', at: 0.3 })) ===
				JSON.stringify({ from: 0, to: 0.7, edge: 0.7, reversed: true }),
		'a forward break plays over [at, 1]; an assemble, mirrored, over [0, 1 − at]',
	);

	/** A break twin's doc under `id`, its break starting at `at`, with `more` of the doc. */
	const breakDoc = (
		kind: ElementFxKind,
		at: number,
		id: string,
		more: Partial<ShaderGraphDoc> = {},
	): ShaderGraphDoc => {
		const doc = JSON.parse(JSON.stringify(builtinTwin(kind)?.doc)) as ShaderGraphDoc;
		const brk = doc.nodes.find((n) => n.type === BREAK_OUTPUT) as GraphNode;
		brk.values = { ...brk.values, at };
		return { ...doc, id, ...more };
	};
	const effectOf = (doc: ShaderGraphDoc): CustomElementFx => {
		const r = compileShaderEffect(doc);
		if (!r.ok) throw new Error(`${doc.id}: ${r.issues.map((i) => i.message).join('; ')}`);
		return r.effect;
	};
	/** What each still was cut from: the element's filters then (the graph's progress), its alpha. */
	const stills: { filters: Filter[]; progress: number; alpha: number; smooth: string[] }[] = [];
	const stillRenderer = {
		generateTexture: ({ frame, target }: { frame: Rectangle; target: Container }) => {
			const filters = [...(target.filters ?? [])];
			const graph = filters.find((f) => f instanceof SHADERS.ElementFxFilter) as
				ElementFxFilter | undefined;
			stills.push({
				filters,
				progress: (graph?.efx.uFx as Float32Array | undefined)?.[0] ?? NaN,
				alpha: target.alpha,
				smooth: filters.map((f) => String(f.antialias)),
			});
			return new Texture({
				source: new TextureSource({ width: frame.width, height: frame.height }),
			});
		},
	};
	const breakOf = (c: Container) => c.parent?.children.find((x) => x.label === 'elementFx:break');
	const localOf = (c: Container): Matrix => {
		c.updateLocalTransform();
		return c.localTransform.clone();
	};
	const sameMatrix = (a: Matrix, b: Matrix): boolean =>
		(['a', 'b', 'c', 'd', 'tx', 'ty'] as const).every((k) => near(a[k], b[k], 1e-4));
	const graphOf = (c: Container): ElementFxFilter | undefined =>
		c.filters?.find((f) => f instanceof SHADERS.ElementFxFilter) as ElementFxFilter | undefined;
	const progressOf = (c: Container): number =>
		(graphOf(c)?.efx.uFx as Float32Array | undefined)?.[0] ?? NaN;

	{
		// The graph moves the element right and fades it over the play; it breaks halfway.
		const doc = breakDoc('shatter', 0.5, 'brkMove', {
			motion: {
				channels: {
					x: [
						{ t: 0, v: 0 },
						{ t: 1, v: 0.5 },
					],
					alpha: [
						{ t: 0, v: 1 },
						{ t: 1, v: 0.5 },
					],
				},
			},
		});
		setCustomElementFx([effectOf(doc)]);
		const { host, advance } = makeHost();
		const target = makeTarget();
		target.updateLocalTransform();
		const rest = target.localTransform.clone();
		const restValues = snapshot(target);
		stills.length = 0;
		const play = playElementFx(
			target,
			{ kind: 'custom:brkMove', durationMs: 1000 },
			{ ...host, renderer: stillRenderer as never },
		);
		advance(300);
		assert(
			!stills.length &&
				!breakOf(target) &&
				near(progressOf(target), 0.3, 1e-6) &&
				near(target.alpha, 0.8 * 0.85, 1e-6),
			'before its break the graph plays on the element: its pass on it, its motion moving and fading it',
		);
		advance(300);
		const [still] = stills;
		const holder = breakOf(target);
		assert(
			stills.length === 1 &&
				still.filters.some((f) => f instanceof SHADERS.ElementFxFilter) &&
				still.progress === 0.5 &&
				still.alpha === 1 &&
				still.smooth.every((s) => s === 'inherit'),
			'at its start the still is cut from the element with the graph’s pass on it, at the moment the break starts (0.5, not the frame’s), at full alpha, its passes drawing as smoothly as the still is cut',
		);
		assert(
			!!holder &&
				sameMatrix(localOf(holder), rest.clone().append(new Matrix(1, 0, 0, 1, 25, 0))) &&
				near(holder.alpha, 0.8 * 0.75),
			'its pieces start where the graph’s motion drew the element then (a quarter of its width right) and as faded (0.75 of its alpha)',
		);
		assert(
			target.alpha === 0 && !target.filters?.length && target.filterArea === undefined,
			'then the element is hidden and its passes are off it (the still has their look)',
		);
		advance(500);
		assert(
			play.active &&
				target.alpha === 0 &&
				!breakOf(target) &&
				!target.filters?.length &&
				target.filterArea === undefined,
			'it plays out and holds the element hidden, as an exit does, its passes still off it',
		);
		play.stop();
		assert(
			JSON.stringify(snapshot(target)) === JSON.stringify(restValues),
			'stop puts it back exactly',
		);
		setCustomElementFx([]);
	}

	const seeded = (seed: number) => {
		let s = seed;
		return () => {
			s = (s * 16807) % 2147483647;
			return (s - 1) / 2147483646;
		};
	};
	/** The pieces a play posed at `progress` cuts (a seeded layout), and its layer's alpha. */
	const piecesAt = (
		kind: ElementFxKindId,
		durationMs: number,
		progress: number,
		params: Record<string, ElementFxParamValue> = {},
		renderer: object = stillRenderer,
	) => {
		const random = Math.random;
		Math.random = seeded(4242);
		try {
			const target = makeTarget();
			const handle = playElementFx(
				target,
				{ kind, durationMs, params, pose: () => ({ progress }) },
				{ ...makeHost().host, renderer: renderer as never },
			);
			const layer = breakOf(target)?.children[0];
			const meshes = (layer?.children ?? []).filter(
				(c): c is MeshSimple => c instanceof MeshSimple,
			);
			const out = {
				layer: layer?.alpha ?? NaN,
				vertices: meshes.flatMap((m) => [...m.vertices]),
				triangles: meshes.reduce((n, m) => n + m.geometry.indices.length / 3, 0),
				target,
			};
			handle.stop();
			return out;
		} finally {
			Math.random = random;
		}
	};
	const samePieces = (a: { vertices: number[]; layer: number }, b: typeof a): boolean =>
		a.vertices.length > 0 &&
		a.vertices.length === b.vertices.length &&
		a.vertices.every((v, i) => near(v, b.vertices[i], 1e-9)) &&
		near(a.layer, b.layer, 1e-12);

	{
		setCustomElementFx([effectOf(breakDoc('crumble', 0.5, 'brkCrumble'))]);
		const params = { pieces: 16 };
		const mid = [
			piecesAt('custom:brkCrumble', 2000, 0.75, params),
			piecesAt('crumble', 1000, 0.5, params),
		];
		const late = [
			piecesAt('custom:brkCrumble', 2000, 0.975, params),
			piecesAt('crumble', 1000, 0.95, params),
		];
		assert(
			samePieces(mid[0], mid[1]) && samePieces(late[0], late[1]) && late[0].layer < 0.5,
			'its pieces fly over its window: a crumble starting halfway through 2 s, posed at 0.75 and 0.975, is the built-in’s posed at 0.5 and 0.95 over 1 s (its progress and seconds both the window’s)',
		);
		setCustomElementFx([]);
	}
	{
		const tied = breakDoc('crash', 0, 'brkTied');
		const fixed = breakDoc('crash', 0, 'brkFixed');
		const brk = fixed.nodes.find((n) => n.type === BREAK_OUTPUT) as GraphNode;
		fixed.wires = fixed.wires.filter((w) => w.to.port !== 'pieces' && w.to.port !== 'force');
		fixed.nodes.push({ id: 'k', type: 'number', x: 0, y: 0, values: { value: 2 } });
		fixed.wires.push({ from: { node: 'k', port: 'out' }, to: { node: brk.id, port: 'force' } });
		brk.values = { ...brk.values, pieces: 10 };
		const fixedEffect = effectOf(fixed);
		setCustomElementFx([effectOf(tied), fixedEffect]);
		const asked = { pieces: 40, force: 2, gravity: 0.5 };
		assert(
			samePieces(
				piecesAt('custom:brkTied', 1400, 0.5, asked),
				piecesAt('crash', 1400, 0.5, asked),
			) &&
				piecesAt('custom:brkTied', 1400, 0.5, asked).triangles ===
					piecesAt('crash', 1400, 0.5, asked).triangles &&
				piecesAt('crash', 1400, 0.5, asked).triangles !==
					piecesAt('crash', 1400, 0.5, {}).triangles,
			'its params are the effect’s, read through its ties each play: a crash tied by id plays an entry’s 40 shards, force and gravity as the built-in does',
		);
		assert(
			JSON.stringify(fixedEffect.break?.params) ===
				JSON.stringify({ pieces: 10, force: 2, gravity: { param: 'gravity' } }) &&
				samePieces(
					piecesAt('custom:brkFixed', 1400, 0.5, asked),
					piecesAt('crash', 1400, 0.5, { pieces: 10, force: 2, gravity: 0.5 }),
				),
			'a constant (its own value, a Number node) holds whatever the entry sets: 10 shards at force 2, its gravity still tied',
		);
		setCustomElementFx([]);
	}
	{
		// Assemble, mirrored: its pieces fly in over [0, 0.6], then the graph has the element.
		setCustomElementFx([effectOf(breakDoc('assemble', 0.4, 'brkAssemble'))]);
		const draws: { progress: number; alpha: number }[] = [];
		const liveRenderer = {
			resolution: 1,
			generateTexture: stillRenderer.generateTexture,
			render: (o: { container: Container }) => {
				o.container.enableRenderGroup();
				draws.push({ progress: progressOf(o.container), alpha: o.container.alpha });
			},
		};
		const custom = piecesAt('custom:brkAssemble', 2200, 0.3, { particles: 100 }, liveRenderer);
		const builtIn = piecesAt('assemble', 2200 * 0.6, 0.5, { particles: 100 }, liveRenderer);
		assert(
			samePieces(custom, builtIn) &&
				draws.length >= 2 &&
				near(draws[0].progress, 0.6, 1e-6) &&
				draws.every((d) => d.alpha === 1),
			'an assemble’s specks fly in over its window as the built-in’s do (posed at 0.3 of [0, 0.6] = the built-in at 0.5), redrawn from the live element with the graph’s pass on it, held where the graph takes over (0.6)',
		);
		const { host, advance } = makeHost();
		const target = makeTarget();
		let progress = 0.3;
		const handle = playElementFx(
			target,
			{ kind: 'custom:brkAssemble', durationMs: 2200, pose: () => ({ progress }) },
			{ ...host, renderer: liveRenderer as never },
		);
		const hidden = target.alpha === 0 && !!breakOf(target) && near(progressOf(target), 0.6, 1e-6);
		progress = 0.8;
		advance(16);
		assert(
			hidden && !breakOf(target) && near(target.alpha, 0.8) && near(progressOf(target), 0.8, 1e-6),
			'while its specks fly in its pass stays on the live element they are drawn from; past its window the specks are gone and the element shows, the graph playing on it',
		);
		handle.stop();
		setCustomElementFx([]);
	}
	{
		// A window with no length cuts nothing.
		setCustomElementFx([
			effectOf(breakDoc('shatter', 1, 'brkAtEnd')),
			effectOf(breakDoc('assemble', 1, 'brkNoFlight')),
		]);
		const { host, advance } = makeHost();
		let draws = 0;
		const counting = {
			resolution: 1,
			generateTexture: (o: { frame: Rectangle; target: Container }) => {
				draws++;
				return stillRenderer.generateTexture(o);
			},
			render: (o: { container: Container }) => {
				draws++;
				o.container.enableRenderGroup();
			},
		};
		const end = makeTarget();
		const ending = playElementFx(
			end,
			{ kind: 'custom:brkAtEnd', durationMs: 1000, pose: () => ({ progress: 1 }) },
			{ ...host, renderer: counting as never },
		);
		const atEnd = !draws && end.alpha === 0 && !breakOf(end);
		ending.stop();
		const arrive = makeTarget();
		const arriving = playElementFx(
			arrive,
			{ kind: 'custom:brkNoFlight', durationMs: 1000 },
			{ ...host, renderer: counting as never },
		);
		const first = !draws && arrive.alpha === 0 && !breakOf(arrive);
		advance(16);
		assert(
			atEnd && first && !draws && near(arrive.alpha, 0.8) && !breakOf(arrive),
			'a break with no time to play cuts nothing: one starting at the very end hides the element there, an assemble over none of the play hides it for its first instant, then shows it',
		);
		arriving.stop();
		setCustomElementFx([]);
	}
	{
		// A renderer that cannot draw the still: it fades, said once, never thrown into the ticker.
		setCustomElementFx([effectOf(breakDoc('shatter', 0.5, 'brkThrows'))]);
		const { host, advance } = makeHost();
		let draws = 0;
		const failing = {
			generateTexture: () => {
				draws++;
				throw new Error('no still');
			},
		};
		const warn = console.warn;
		const warned: unknown[] = [];
		console.warn = (...args: unknown[]) => warned.push(args);
		let threw = false;
		const custom = makeTarget();
		const builtIn = makeTarget();
		try {
			playElementFx(
				custom,
				{ kind: 'custom:brkThrows', durationMs: 1000 },
				{ ...host, renderer: failing as never },
			);
			playElementFx(
				builtIn,
				{ kind: 'shatter', durationMs: 1000 },
				{ ...host, renderer: failing as never },
			);
			advance(700);
		} catch {
			threw = true;
		} finally {
			console.warn = warn;
		}
		const graph = graphOf(custom);
		assert(
			!threw &&
				draws === 2 &&
				warned.length === 1 &&
				!breakOf(custom) &&
				!breakOf(builtIn) &&
				custom.alpha > 0 &&
				custom.alpha < 0.8 &&
				builtIn.alpha < 0.8 &&
				graph?.antialias === 'off',
			'a still the renderer cannot draw is tried once: the custom break and the built-in fade instead, said once, never thrown into the ticker; the element’s alpha and its passes’ smoothing are put back',
		);
		stopElementFx(custom);
		stopElementFx(builtIn);
		setCustomElementFx([]);
	}
	{
		// No renderer: it cannot cut, so it leaves as that break leaves without one.
		const plain = (): Container => {
			const parent = new Container();
			const target = new Container();
			target.boundsArea = new Rectangle(-50, -60, 100, 120);
			target.position.set(300, 200);
			target.alpha = 0.8;
			parent.addChild(target);
			return target;
		};
		const alpha = [
			{ t: 0, v: 1 },
			{ t: 1, v: 0.5 },
		];
		setCustomElementFx([
			effectOf(breakDoc('crumble', 0.4, 'brkFallback', { motion: { channels: { alpha } } })),
			effectOf(breakDoc('disintegrate', 0, 'brkDust')),
		]);
		const { host, advance } = makeHost();
		const target = plain();
		let progress = 0.2;
		const handle = playElementFx(
			target,
			{ kind: 'custom:brkFallback', durationMs: 1800, pose: () => ({ progress }) },
			host,
		);
		const before = target.alpha;
		progress = 0.7;
		advance(16);
		const k = (0.5 - 0.15) / 0.85;
		const fade = 1 - k * k * (3 - 2 * k);
		assert(
			near(before, 0.8 * 0.9) &&
				near(target.alpha, 0.8 * 0.8 * fade, 1e-9) &&
				near(target.y, 200 + 0.25 * 0.3 * 120, 1e-9),
			'with no renderer, a crumble leaves as a crumble does (sinking, fading over its window) from where the graph held it at its start, its alpha then (0.8), the compiled fade for older runtimes never applied',
		);
		handle.stop();
		const dust = plain();
		const blown = playElementFx(
			dust,
			{ kind: 'custom:brkDust', params: { drift: 'left' }, pose: () => ({ progress: 0.6 }) },
			host,
		);
		assert(
			dust.x < 300 - 1 && near(dust.y, 200, 1e-9),
			'a dissolve to particles drifts on its wind, as its tied Wind param says (left)',
		);
		blown.stop();
		setCustomElementFx([]);
	}
	{
		// The fade a runtime from before breaks plays, in an effect's curves and its motion program.
		const keys = [
			{ t: 0, v: 1, ease: 'smooth' as const },
			{ t: 0.45, v: 0.9 },
			{ t: 0.8, v: 0.6 },
			{ t: 1, v: 0.3 },
		];
		const doc = breakDoc('crumble', 0.4, 'brkFade', {
			motion: { channels: { alpha: keys } },
			motionGraph: {
				nodes: [
					{ id: 'mt', type: 'time', x: 0, y: 0 },
					{ id: 'mm', type: 'multiply', x: 0, y: 0, values: { b: -0.3 } },
					{ id: 'ma', type: 'add', x: 0, y: 0, values: { b: 1 } },
					{ id: 'mo', type: 'motionOutput', x: 0, y: 0 },
				],
				wires: [
					{ from: { node: 'mt', port: 'progress' }, to: { node: 'mm', port: 'a' } },
					{ from: { node: 'mm', port: 'out' }, to: { node: 'ma', port: 'a' } },
					{ from: { node: 'ma', port: 'out' }, to: { node: 'mo', port: 'alpha' } },
				],
			},
		});
		const programmed = effectOf(doc);
		const curved = effectOf({ ...doc, id: 'brkFadeCurve', motionGraph: undefined });
		const start = 0.4 + BREAK_FADE_FROM * 0.6;
		const frame = (t: number): FxFrame => ({
			t,
			seconds: t * 1.8,
			playSeconds: 1.8,
			intensity: 1,
			params: resolveElementFxParams('crumble', {}),
			looping: false,
			width: 100,
			height: 120,
		});
		const old = (e: CustomElementFx): CustomElementFx => {
			const copy = JSON.parse(JSON.stringify(e)) as CustomElementFx;
			delete copy.break;
			return copy;
		};
		const alphaOf = (e: CustomElementFx, t: number): number =>
			customKindImpl(e).motion?.(frame(t)).alpha ?? NaN;
		const ts = Array.from({ length: 201 }, (_, i) => i / 200);
		const raw = (t: number): number => sampleElementFxCurve(keys, t);
		const program = (t: number): number => 1 - 0.3 * t;
		assert(
			JSON.stringify(curved.motion?.channels.alpha) ===
				JSON.stringify([keys[0], keys[1], { ...keys[2], ease: 'smooth' }, { t: 1, v: 0 }]) &&
				start === 0.49,
			'the compiled alpha curve keeps the doc’s up to its first key past the fade’s start (0.49: 0.15 through the window), which eases to 0 at the end',
		);
		assert(
			ts.every((t) => alphaOf(curved, t) === (t <= 0.4 ? raw(t) : raw(0.4))) &&
				ts.every((t) => alphaOf(programmed, t) === (t <= 0.4 ? program(t) : program(0.4))),
			'on a runtime with breaks the fade never shows: before the break the curve and the program are the doc’s exactly; in its window the motion holds the doc’s at its start (and the pieces hide the element)',
		);
		assert(
			ts.every((t) => t > start || alphaOf(old(curved), t) === raw(t)) &&
				ts.every((t) => t > start || alphaOf(old(programmed), t) === program(t)) &&
				alphaOf(old(curved), 1) === 0 &&
				alphaOf(old(programmed), 1) === 0 &&
				alphaOf(old(curved), 0.9) < raw(0.9) &&
				alphaOf(old(programmed), 0.9) < program(0.9),
			'a runtime from before breaks (the break ignored) plays the doc’s alpha up to the fade’s start, then fades the element out, its curve or its program, gone by the end: an exit never stays on screen',
		);
		const brkId = doc.nodes.find((n) => n.type === BREAK_OUTPUT)?.id;
		const unbroken = compileShaderEffect({
			...doc,
			id: 'brkNone',
			nodes: doc.nodes.filter((n) => n.id !== brkId),
			wires: doc.wires.filter((w) => w.to.node !== brkId),
		});
		const ops = programmed.motion?.program?.ops ?? [];
		const own = unbroken.ok ? (unbroken.effect.motion?.program?.ops ?? []) : [];
		assert(
			own.length > 0 &&
				ops.length - own.length >= 3 &&
				ops.length - own.length <= 6 &&
				JSON.stringify(ops.slice(0, own.length)) === JSON.stringify(own) &&
				ops[ops.length - 1][0] === 'multiply',
			'the program’s fade is a few steps after the graph’s own, which are unchanged',
		);
		const entrance = effectOf(breakDoc('assemble', 0.3, 'brkIn'));
		assert(
			!entrance.motion,
			'an assemble carries no fade: on a runtime from before breaks the element simply shows and its graph plays',
		);
	}
	{
		const twins = BUILTIN_TWINS.filter((t) => ELEMENT_FX_BREAK_KINDS.includes(t.kind as never));
		const compiled = twins.map((t) => effectOf(t.doc));
		const good = compiled[ELEMENT_FX_BREAK_KINDS.indexOf('shatter')];
		const bad: [string, unknown][] = [
			['not a map', 5],
			['an unknown kind', { ...good.break, kind: 'explode' }],
			['a start past 1', { ...good.break, at: 1.5 }],
			['a start as text', { ...good.break, at: '0' }],
			['a param the kind lacks', { ...good.break, params: { ...good.break?.params, shards: 3 } }],
			['a number out of range', { ...good.break, params: { pieces: 999 } }],
			['a tie to no param', { ...good.break, params: { pieces: { param: 'nope' } } }],
			['a tie to another kind', { ...good.break, params: { impact: { param: 'pieces' } } }],
			[
				'a prototype key',
				JSON.parse('{"kind":"shatter","at":0,"params":{"__proto__":{"param":"pieces"}}}'),
			],
			['params as a list', { ...good.break, params: [] }],
		];
		let threw = false;
		const kept = bad.map(([label, brk]) => {
			try {
				const read = readCustomElementFx({ ...good, break: brk });
				return !!read && read.break === undefined && read.shader.body === good.shader.body
					? ''
					: label;
			} catch {
				threw = true;
				return label;
			}
		});
		const wrongPhase = readCustomElementFx({ ...good, spec: { ...good.spec, phase: 'loop' } });
		const many = {
			kind: 'shatter',
			at: 0,
			params: Object.fromEntries(Array.from({ length: 100_000 }, (_, i) => [`p${i}`, i])),
		};
		const began = performance.now();
		const flooded = readCustomElementFx({ ...good, break: many });
		const ms = performance.now() - began;
		assert(
			compiled.every(
				(e, i) =>
					e.break?.kind === twins[i].kind &&
					JSON.stringify(readCustomElementFx(e)?.break) === JSON.stringify(e.break),
			) &&
				!threw &&
				!kept.some(Boolean) &&
				!!wrongPhase &&
				wrongPhase.break === undefined &&
				!!flooded &&
				flooded.break === undefined &&
				ms < 200,
			`the registry reads each break twin’s break; a break it cannot play (not a map, an unknown kind, a start past 1 or as text, a param the kind lacks, a number out of range, a tie to no param or another kind, a prototype key, params as a list, an effect of another phase, 100 000 params in ${ms.toFixed(0)} ms) is dropped and the effect kept, never thrown on${kept.some(Boolean) ? `: kept ${kept.filter(Boolean).join(', ')}` : ''}`,
		);
		const plainEffect = effectOf(REFERENCE_GRAPHS[0]);
		assert(
			!plainEffect.break && !customKindImpl(plainEffect).breakWindow,
			'an effect without a break has none, and plays as before',
		);
	}
}

// -------------------------------------------------------------------------------------------------
console.log('element fx — the stage (post FX, Shader Graph 8e)');
{
	const compiled = REFERENCE_GRAPHS.map((doc) => compileShaderEffect(doc));
	const base = compiled.flatMap((r) => (r.ok ? [r.effect] : []));
	const TINT = 'custom:pulseTint';
	const POWER = 'custom:powerUp';
	const tint = base.find((e) => e.spec.kind === TINT) as CustomElementFx;
	const passing = (id: string, kinds: readonly string[]): CustomElementFx => ({
		...tint,
		spec: { ...tint.spec, kind: `custom:${id}`, label: id },
		passes: kinds.map((kind) => ({ kind, params: {} })) as CustomElementFx['passes'],
	});
	const registered = setCustomElementFx([
		...base,
		passing('fourFilters', ['glow', 'shine', 'flash']),
		passing('fiveFilters', ['glow', 'shine', 'flash', 'blur']),
		{ ...passing('costed', []), cost: 24 },
	]);
	assert(
		registered.length === base.length + 3 &&
			customElementFx('custom:fourFilters')?.passes.length === 3 &&
			customElementFx('custom:fiveFilters')?.passes.length === 4 &&
			customElementFx(POWER)?.motion !== undefined &&
			customElementFx(POWER)?.passes.length === 1,
		'set up: a graph with motion and a pass, and graphs drawing four and five filters',
	);

	const VIEW = new Rectangle(0, 0, 1280, 720);
	interface Stage {
		stage: Container;
		host: ElementFxHost;
		advance: (ms: number) => void;
		heard: (readonly Filter[] | null)[];
		measured: () => number;
		untouched: () => boolean;
		unbind: () => void;
	}
	const makeStage = (renderer: object | null = { screen: VIEW, resolution: 2 }): Stage => {
		const { host, advance } = makeHost();
		const stage = new Container();
		const art = new Container();
		art.boundsArea = new Rectangle(-500, -500, 4000, 4000);
		stage.addChild(art);
		// What the stage's owner (the camera's wobble) may have put there: never touched.
		const own = new Filter({
			glProgram: GlProgram.from({
				vertex: 'void main(){}',
				fragment: 'void main(){}',
				name: 'own',
			}),
		});
		stage.filters = [own];
		const ownList = stage.filters;
		const ownArea = new Rectangle(-3, -4, 1290, 730);
		stage.filterArea = ownArea;
		stage.position.set(5, 7);
		stage.scale.set(1.1, 1.1);
		stage.alpha = 0.9;
		const rest = JSON.stringify(snapshot(stage));
		let measures = 0;
		const bounds = stage.getLocalBounds.bind(stage);
		stage.getLocalBounds = () => {
			measures++;
			return bounds();
		};
		const heard: (readonly Filter[] | null)[] = [];
		const unbind = bindStagePostFxSlot(stage, (postFx) => heard.push(postFx));
		return {
			stage,
			host: { ...host, renderer: (renderer ?? undefined) as never, stage },
			advance,
			heard,
			measured: () => measures,
			untouched: () =>
				stage.filters === ownList &&
				stage.filters.length === 1 &&
				stage.filters[0] === own &&
				stage.filterArea === ownArea &&
				JSON.stringify(snapshot(stage)) === rest,
			unbind,
		};
	};
	const last = (s: Stage): readonly Filter[] | null | undefined => s.heard[s.heard.length - 1];

	{
		const s = makeStage();
		assert(s.heard.length === 1 && s.heard[0] === null, 'a slot bound to a quiet stage hears null');
		const play = playElementFx(s.stage, { kind: POWER, durationMs: 600, repeat: 0 }, s.host);
		s.advance(16 * 20);
		const fx = last(s);
		const graph = fx?.[0] as ElementFxFilter | undefined;
		assert(
			play.active &&
				fx?.length === 2 &&
				graph instanceof SHADERS.ElementFxFilter &&
				stagePostFx(s.stage) === fx,
			'a graph with a pass plays on the stage: its two filters handed to the slot, in order',
		);
		assert(
			s.untouched(),
			'no motion is folded: the stage’s transform, alpha, own filters and filter area are never written',
		);
		assert(s.measured() === 0, 'nothing is measured: the box is the viewport');
		const element = graph?.efx.uElement as Float32Array | undefined;
		const uFx = graph?.efx.uFx as Float32Array | undefined;
		assert(
			!!element &&
				[...element].join() === '0,0,1,1' &&
				!!uFx &&
				uFx[0] > 0 &&
				uFx[0] < 1 &&
				uFx[3] === 1,
			'its unit square is the viewport, fed its progress, looping',
		);

		const heardBefore = s.heard.length;
		s.advance(16 * 10);
		assert(s.heard.length === heardBefore, 'a steady play hands the slot nothing new');
		const late: (readonly Filter[] | null)[] = [];
		bindStagePostFxSlot(s.stage, (postFx) => late.push(postFx));
		assert(late.length === 1 && late[0] === fx, 'a slot bound late hears what plays at once');
		(VIEW as { width: number }).width = 1024;
		s.advance(16);
		assert(late.length === 1, 'a resized viewport hands the slot nothing new: the owner bounds it');
		(VIEW as { width: number }).width = 1280;
		const destroyed: Filter[] = [];
		const order: string[] = [];
		for (const f of fx ?? []) {
			const destroy = f.destroy.bind(f);
			f.destroy = (...args: Parameters<typeof destroy>) => {
				order.push('destroy');
				destroyed.push(f);
				return destroy(...args);
			};
		}
		bindStagePostFxSlot(s.stage, (postFx) => order.push(postFx ? 'list' : 'null'));
		order.length = 0;
		play.stop();
		assert(
			order[0] === 'null' &&
				destroyed.length === 2 &&
				order.lastIndexOf('null') < order.indexOf('destroy'),
			'stopped, the slot hears null before its filters are destroyed',
		);
		assert(
			s.untouched() && elementFxCount(s.stage) === 0 && stagePostFx(s.stage) === null,
			'and the stage is exactly as it was: its own filters and filter area, its transform',
		);
	}
	{
		const s = makeStage();
		const first = playElementFx(s.stage, { kind: 'glow', durationMs: 300 }, s.host);
		const second = playElementFx(s.stage, { kind: TINT, durationMs: 300, repeat: 0 }, s.host);
		s.advance(32);
		assert(
			first.active && second.active && last(s)?.length === 2,
			'a built-in pixel kind and a graph play together, in the order they started',
		);
		s.advance(400);
		assert(
			!first.active && last(s)?.length === 1,
			'one that plays out leaves the list, the other stays',
		);
		stopElementFx(s.stage);
		assert(last(s) === null && s.untouched(), 'stopping all empties the slot');
		const plain = playElementFx(s.stage, { kind: TINT, repeat: 0 }, s.host);
		s.advance(32);
		const tinted = last(s)?.[0] as ElementFxFilter | undefined;
		assert(
			plain.active && tinted?.padding === 1 && tinted.efx.uPad === 1,
			'a stack that pads nothing is padded a pixel past the viewport, so its edge pixels are read, and told so (uPad)',
		);
		stopElementFx(s.stage);
		s.unbind();
		const quiet = s.heard.length;
		playElementFx(s.stage, { kind: 'glow', durationMs: 300 }, s.host);
		s.advance(32);
		assert(s.heard.length === quiet, 'an unbound slot hears nothing more');
		stopElementFx(s.stage);
	}

	// Every kind: refused with its reason, or played.
	{
		const why = (kind: ElementFxKindId): string | undefined => {
			const spec = ELEMENT_FX.find((x) => x.kind === kind) ?? customElementFx(kind)?.spec;
			const impl = isElementFxKind(kind)
				? KINDS[kind]
				: customKindImpl(customElementFx(kind) as CustomElementFx);
			if (impl.breaks || impl.breakWindow) return 'a break';
			if (spec?.phase === 'exit') return 'an exit kind';
			if (spec?.phase === 'enter') return 'an enter kind';
			if (!impl.filter && !impl.filters?.length) return 'a motion-only kind';
			return undefined;
		};
		const warnings: string[] = [];
		const warn = console.warn;
		console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(' '));
		const wrong: string[] = [];
		// Its filter draws its noise on a canvas, which Node has none of: its answer alone is checked.
		const DRAWS_A_CANVAS = new Set<ElementFxKindId>(['glitch']);
		const counts = { break: 0, exit: 0, enter: 0, motion: 0, played: 0 };
		// The graph drawing five filters is refused by the caps, below.
		const kinds = [...ELEMENT_FX_KINDS, ...registered.map((e) => e.spec.kind)].filter(
			(kind) => kind !== 'custom:fiveFilters',
		);
		try {
			for (const kind of kinds) {
				const expected = why(kind);
				const s = makeStage();
				const reason = stageFxRefusal(kind);
				if (!expected && DRAWS_A_CANVAS.has(kind)) {
					if (reason !== undefined) wrong.push(`${kind} (expected to play, refused "${reason}")`);
					counts.played++;
					continue;
				}
				const handle = playElementFx(s.stage, { kind, durationMs: 300 }, s.host);
				s.advance(48);
				if (expected) {
					const said = warnings.some((w) => w.includes(kind) && !!reason && w.includes(reason));
					if (
						!reason?.startsWith(expected) ||
						handle.active ||
						elementFxCount(s.stage) !== 0 ||
						s.heard.length !== 1 ||
						!said ||
						!s.untouched()
					) {
						wrong.push(`${kind} (expected "${expected}", got "${reason}")`);
					}
					if (expected === 'a break') counts.break++;
					else if (expected === 'an exit kind') counts.exit++;
					else if (expected === 'an enter kind') counts.enter++;
					else counts.motion++;
				} else {
					if (reason !== undefined || !handle.active || !last(s)?.length || !s.untouched()) {
						wrong.push(`${kind} (expected to play, refused "${reason}")`);
					}
					if (s.measured() !== 0) wrong.push(`${kind} measured the stage`);
					counts.played++;
				}
				stopElementFx(s.stage);
			}
			const before = warnings.length;
			const s = makeStage();
			playElementFx(s.stage, { kind: 'shake' }, s.host);
			playElementFx(s.stage, { kind: 'shake' }, s.host);
			assert(warnings.length === before, 'a refusal is warned once per kind and reason');
		} finally {
			console.warn = warn;
		}
		assert(
			!wrong.length,
			`every kind on the stage: ${counts.played} play; refused with the reason, nothing written: ${counts.break} breaks, ${counts.exit} exit, ${counts.enter} enter, ${counts.motion} motion-only kinds${wrong.length ? ` — wrong: ${wrong.join('; ')}` : ''}`,
		);
		assert(
			counts.break > 0 &&
				counts.exit > 0 &&
				counts.enter > 0 &&
				counts.motion > 0 &&
				counts.played > 0,
			'every reason is met at least once',
		);
		const element = makeTarget();
		const s = makeStage();
		const rest = JSON.stringify(snapshot(element));
		const shake = playElementFx(element, { kind: 'shake', durationMs: 300 }, s.host);
		s.advance(64);
		assert(
			shake.active && JSON.stringify(snapshot(element)) !== rest && s.heard.length === 1,
			'a host with a stage plays on any other container as ever',
		);
		stopElementFx(element);
	}

	// The caps: two entries, four filters, decided when an entry starts.
	{
		const warnings: string[] = [];
		const warn = console.warn;
		console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(' '));
		try {
			const s = makeStage();
			const a = playElementFx(s.stage, { kind: POWER, repeat: 0 }, s.host);
			const b = playElementFx(s.stage, { kind: TINT, repeat: 0 }, s.host);
			const c = playElementFx(s.stage, { kind: 'glow', repeat: 0 }, s.host);
			s.advance(32);
			assert(
				a.active &&
					b.active &&
					!c.active &&
					elementFxCount(s.stage) === 2 &&
					last(s)?.length === 3 &&
					warnings.some((w) => w.includes(`at most ${STAGE_FX_LIMITS.entries} post FX at once`)),
				'a third entry does not play, and says why',
			);
			b.stop();
			const d = playElementFx(s.stage, { kind: 'custom:fourFilters', repeat: 0 }, s.host);
			assert(
				!d.active &&
					warnings.some((w) => w.includes('at most 4 post FX filters (2 drawing, this one 4)')),
				'one that would draw past four filters does not play, and says why',
			);
			a.stop();
			const e = playElementFx(s.stage, { kind: 'custom:fourFilters', repeat: 0 }, s.host);
			const f = playElementFx(s.stage, { kind: 'glow', repeat: 0 }, s.host);
			s.advance(16);
			assert(
				e.active && !f.active && last(s)?.length === 4,
				'four filters alone play; one more does not',
			);
			stopElementFx(s.stage);
			const g = playElementFx(s.stage, { kind: 'custom:fiveFilters', repeat: 0 }, s.host);
			assert(
				!g.active && last(s) === null,
				'a graph drawing five filters never plays on the stage',
			);
			const none = makeStage(null);
			const h = playElementFx(none.stage, { kind: 'glow' }, none.host);
			assert(
				!h.active && warnings.some((w) => w.includes('no renderer to size the viewport')),
				'with no renderer to size the viewport, nothing plays',
			);
		} finally {
			console.warn = warn;
		}
	}
	{
		const s = makeStage();
		playElementFx(s.stage, { kind: 'glow', repeat: 0 }, s.host);
		s.advance(16);
		s.stage.destroy();
		s.advance(16);
		assert(last(s) === null, 'a destroyed stage empties its slot');
	}
	{
		const app = { ticker: new Ticker(), renderer: { screen: VIEW }, stage: new Container() };
		const host = elementFxHostFor(app as never);
		assert(host?.stage === app.stage, 'a game’s host carries its stage, so post FX play there');
	}
	{
		// The game's adapter: the post FX in the stage filter owner's slot.
		const { host, advance } = makeHost();
		const stage = new Container();
		const app = { ticker: host.ticker, stage, screen: VIEW, renderer: { screen: VIEW } };
		const stageHost = { ...host, renderer: app.renderer as never, stage };
		const unbind = bindStagePostFx(app as never);
		assert(
			!stage.filters?.length && !stage.filterArea,
			'bound to a quiet stage, nothing is put on it',
		);
		const glow = playElementFx(stage, { kind: 'glow', repeat: 0 }, stageHost);
		advance(16);
		const on = stage.filters ?? [];
		const bounded =
			!!stage.filterArea &&
			Math.abs(stage.filterArea.width - VIEW.width) < 1 &&
			Math.abs(stage.filterArea.height - VIEW.height) < 1;
		glow.stop();
		const off = !stage.filters?.length && !stage.filterArea;
		const again = playElementFx(stage, { kind: 'glow', repeat: 0 }, stageHost);
		advance(16);
		const playing = stage.filters?.length === 1;
		unbind();
		assert(
			on.length === 1 &&
				bounded &&
				off &&
				playing &&
				!stage.filters?.length &&
				!stage.filterArea &&
				again.active,
			'bindStagePostFx: a post FX lands on the stage through the owner, over the viewport; stopped, the stage is back at rest; unbound while one plays, the slot is emptied',
		);
		again.stop();
	}
	{
		const fxdebug = read('packages/pixi-svelte/src/lib/elementFx/stage.ts');
		assert(
			stageFxLoadText('custom:costed', VIEW, 2) === '3.69 M px × cost 24 = 88.47 M' &&
				stageFxLoadText('glow', VIEW, 1) === '0.92 M px × cost not compiled in' &&
				fxdebug.includes('`post fx ${kind} on the stage: ${state} (${caps})'),
			'?fxdebug=1: the load is the viewport’s device pixels × the compiled cost',
		);
	}

	console.log('element fx — post FX in the doc (settings.postFx, stageFxAntialias)');
	const judge = { refusal: stageFxRefusal, filters: stageFxFilterCount };
	const warnings: string[] = [];
	const warn = console.warn;
	console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(' '));
	try {
		const ids = (postFx: unknown, withJudge = true) =>
			readPostFx({ postFx }, withJudge ? judge : undefined).map((e) => e.id);
		assert(
			ids(undefined).length === 0 &&
				readPostFx(undefined).length === 0 &&
				readPostFx(null, judge).length === 0 &&
				ids({}).length === 0 &&
				warnings.length === 0,
			'no post FX (no settings, no list, not a list) reads as none, quietly',
		);
		assert(
			ids([
				{ id: 'a', kind: 'glow', trigger: 'always' },
				{ id: 'b', kind: 'shine', trigger: 'enter' },
				{ id: 'c', kind: 'glow', trigger: 'keyed' },
				{ id: 'd', kind: TINT, trigger: 'cue', cue: 'bonus', stopCue: 'base' },
			]).join() === 'a,d' &&
				warnings.some((w) => w.includes('"b"') && w.includes('not "enter"')) &&
				warnings.some((w) => w.includes('"c"') && w.includes('not "keyed"')),
			'triggers always and cue only: the rest dropped with a warning',
		);
		warnings.length = 0;
		assert(
			ids([
				{ id: 'a', kind: 'shake', trigger: 'always' },
				{ id: 'b', kind: 'fadeOut', trigger: 'always' },
				{ id: 'c', kind: 'shatter', trigger: 'cue', cue: 'x' },
				{ id: 'd', kind: 'glow', trigger: 'always' },
			]).join() === 'd' &&
				warnings.some((w) => w.includes('"a"') && w.includes('motion-only')) &&
				warnings.some((w) => w.includes('"b"') && w.includes('exit kind')) &&
				warnings.some((w) => w.includes('"c"') && w.includes('a break')),
			'a kind the stage refuses is dropped with its reason, before the caps count',
		);
		warnings.length = 0;
		assert(
			ids([
				{ id: 'off', kind: 'glow', trigger: 'always', disabled: true },
				{ id: 'a', kind: 'glow', trigger: 'always' },
				{ id: 'b', kind: 'shine', trigger: 'always' },
				{ id: 'c', kind: 'flash', trigger: 'cue', cue: 'x' },
			]).join() === 'a,b' &&
				warnings.length === 1 &&
				warnings[0].includes('"c"') &&
				warnings[0].includes(`at most ${STAGE_FX_LIMITS.entries} post FX play`),
			'past two entries, the rest dropped with a warning; a disabled one counts for nothing',
		);
		warnings.length = 0;
		assert(
			ids([
				{ id: 'a', kind: POWER, trigger: 'always' },
				{ id: 'b', kind: 'custom:fourFilters', trigger: 'always' },
				{ id: 'c', kind: 'glow', trigger: 'always' },
			]).join() === 'a,c' &&
				warnings.length === 1 &&
				warnings[0].includes('"b"') &&
				warnings[0].includes(`at most ${STAGE_FX_LIMITS.filters} filters`) &&
				ids([{ id: 'z', kind: 'custom:fiveFilters', trigger: 'always' }]).length === 0,
			'past four filters, an entry is dropped with a warning, and the next that fits plays',
		);
		warnings.length = 0;
		assert(
			ids(
				[
					{ id: 'later', kind: 'custom:notYet', trigger: 'always' },
					{ id: 'a', kind: 'shake', trigger: 'always' },
					{ id: 'b', kind: 'glow', trigger: 'always' },
					{ id: 'c', kind: 'glow', trigger: 'always' },
				],
				false,
			).join() === 'later,a',
			'an unregistered custom kind is kept (the runtime decides it); without the runtime’s judge, triggers and entries alone',
		);
		warnings.length = 0;
		const doc = {
			jurisdiction: 'UK',
			postFx: [
				{ id: 'a', kind: TINT, trigger: 'always', intensity: 0.5, params: {} },
				{ id: 'b', kind: 'glow', trigger: 'cue', cue: 'big', params: { color: '#ffaa00' } },
			],
			stageFxAntialias: true,
		};
		const extras = JSON.parse(JSON.stringify(doc)) as typeof doc & Record<string, unknown>;
		extras.postFxBudget = 9;
		Object.assign(extras.postFx[0], { layer: 'underHud', note: 'x' });
		Object.assign(extras.postFx[1].params, { future: 3 });
		const a = JSON.stringify(readPostFx(doc, judge));
		const b = JSON.stringify(readPostFx(extras, judge));
		assert(
			a === b && a.includes('"id":"a"') && a.includes('"color":"#ffaa00"') && warnings.length === 0,
			'unknown fields (in settings, an entry, its params) are ignored: the output is byte-identical, quietly',
		);
		assert(
			readStageFxAntialias(doc) === true &&
				readStageFxAntialias(extras) === true &&
				[
					undefined,
					null,
					{},
					{ stageFxAntialias: false },
					{ stageFxAntialias: 'true' },
					{ stageFxAntialias: 1 },
				].every((settings) => readStageFxAntialias(settings) === false),
			'stageFxAntialias reads as on only when it is true',
		);
	} finally {
		console.warn = warn;
	}

	const game = read('apps/lines/src/components/Game.svelte');
	assert(
		game.includes('<Anchor name={ELEMENT_FX_STAGE_TARGET} />') &&
			/\{#key postFx\}\s*\{#if postFx\.length\}\s*<ElementFxPlayer entries=\{postFx\} \/>\s*\{\/if\}\s*\{\/key\}/.test(
				game,
			) &&
			game.includes(
				'readPostFx(editorDoc.settings, { refusal: stageFxRefusal, filters: stageFxFilterCount })',
			) &&
			ELEMENT_FX_STAGE_TARGET === 'stage' &&
			/const app = stateApp\.pixiApplication;\s*if \(app\) return bindStagePostFx\(app\);/.test(
				game,
			) &&
			/if \(app\) setStageFxAntialias\(app, readStageFxAntialias\(editorDoc\.settings\)\);/.test(
				game,
			),
		'the game: the stage anchored as `stage`, its post FX played at the root (no player for a doc without any) into the owner’s post FX slot, and the project’s anti-aliasing under stage effects handed to the owner',
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
		vocab.includes("export const ELEMENT_FX_KIND_ENUM = 'ElementFxKind';") &&
			vocab.includes('{ name: ELEMENT_FX_KIND_ENUM, values: [...ELEMENT_FX_KINDS] }'),
		'its kind dropdown is the catalog',
	);
	const effects = read('apps/lines/src/game/flowEffects.ts');
	assert(
		/\n\telementEffect: \(payload\) =>/.test(effects) &&
			/\n\tstopElementEffect: \(payload\) =>/.test(effects),
		'the game implements both',
	);
	assert(
		effects.includes('if (!isPlayableElementFxKind(kind) || !target) return;'),
		'the Flow plays a registered custom kind as it does a built-in',
	);
	assert(ELEMENT_FX_KINDS.length === ELEMENT_FX.length, 'the kind list is the catalog’s');
}

if (failures) {
	console.error(`\nelement fx: ${failures} check(s) FAILED`);
	process.exit(1);
}
console.log('\nelement fx: all checks passed');
