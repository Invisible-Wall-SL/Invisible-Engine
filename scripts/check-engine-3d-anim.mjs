// The 3D animation graph (`packages/engine-3d` `pure/animGraph.ts`, `pure/animDoc.ts`;
// `docs/design/3d/animation-evaluation.md` §2–§3, Phase 2 A1–A2), in Node with no three.js: the
// gradient-band 2D weights, phase sync, crossfades that keep the state left moving, masked override
// layers (weights sum to 1 on every bone), additive layers, weight inputs, cues, the validator, and
// that the shared component-state-machine runner reads a 3D doc exactly as the same doc without its
// 3D fields (the evaluator extensions live in `engine-3d`; 2D components are untouched).
//
// Run: pnpm check:engine-3d-anim

import { readFileSync } from 'node:fs';

import { ComponentStateMachineRunner } from '../packages/engine-layout/src/lib/stateMachine.ts';
import {
	animDocsOf3d,
	createAnimGraph3d,
	gradientBand,
	maskBones,
	validateCharacterAnim3d,
} from '../packages/engine-3d/pure.ts';

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
	if (ok) passed += 1;
	else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const DOC = JSON.parse(
	readFileSync(
		new URL('../packages/engine-3d/fixtures/ie-humanoid.anim.json', import.meta.url),
		'utf8',
	),
);

// The IE Humanoid hierarchy (tools/blender/ie_conventions.py HUMANOID_BONES).
const PARENT = {
	pelvis: 'root',
	spine_01: 'pelvis',
	spine_02: 'spine_01',
	spine_03: 'spine_02',
	neck_01: 'spine_03',
	head: 'neck_01',
	clavicle_l: 'spine_03',
	upperarm_l: 'clavicle_l',
	lowerarm_l: 'upperarm_l',
	hand_l: 'lowerarm_l',
	clavicle_r: 'spine_03',
	upperarm_r: 'clavicle_r',
	lowerarm_r: 'upperarm_r',
	hand_r: 'lowerarm_r',
	weapon_r: 'hand_r',
	thigh_l: 'pelvis',
	calf_l: 'thigh_l',
	foot_l: 'calf_l',
	ball_l: 'foot_l',
	thigh_r: 'pelvis',
	calf_r: 'thigh_r',
	foot_r: 'calf_r',
	ball_r: 'foot_r',
};
const BONES = ['root', ...Object.keys(PARENT)];
const parentOf = (b) => PARENT[b];

// The test character's clip lengths (tools/blender/ie_test_character.py).
const DURATIONS = new Map([
	['locomotion.idle', 2.0],
	['locomotion.walk_fwd', 1.0],
	['locomotion.walk_bwd', 1.0],
	['locomotion.run_fwd', 0.6],
	['locomotion.strafe_l', 0.8],
	['locomotion.strafe_r', 0.8],
	['locomotion.jump', 0.4],
	['locomotion.fall', 0.5],
	['combat.attack', 0.6],
	['reactions.hit', 0.4],
]);
const graphOf = (doc = DOC, durations = DURATIONS) => {
	const graph = createAnimGraph3d({ doc, durations, bones: BONES, parentOf });
	graphRegions = graph.regions;
	return graph;
};
const run = (graph, seconds, dt = 1 / 60) => {
	let out;
	for (let i = Math.round(seconds / dt); i > 0; i--) out = graph.advance(dt);
	return out;
};
/** Total override weight per bone from a frame's contributions (what three's mixer would average). */
const boneWeights = (graph, frame, mode = 'override') => {
	const w = new Map(BONES.map((b) => [b, 0]));
	for (const c of frame.contributions)
		if (c.mode === mode) for (const b of graph.regions.get(c.region)) w.set(b, w.get(b) + c.weight);
	return w;
};
/** A clip's weight on one bone (the region holding it; a clip is split across a layer's regions). */
const weightOf = (frame, clip, mode, bone = 'hand_r') =>
	frame.contributions
		.filter(
			(c) => c.clip === clip && (!mode || c.mode === mode) && graphRegions.get(c.region)?.has(bone),
		)
		.reduce((s, c) => s + c.weight, 0);
let graphRegions = new Map();

// ── Gradient band ───────────────────────────────────────────────────────────────────────────────
const PTS = DOC.machine.layers[0].states[0].blend2d.points.map((p) => p.at);
check(
	'gradient band: at a point, that point alone',
	PTS.every((p, i) => gradientBand(p, PTS).every((w, j) => near(w, i === j ? 1 : 0))),
);
let banded = true;
for (let i = 0; i < 400; i++) {
	const p = [Math.random() * 1.2 - 0.6, Math.random() * 1.6 - 0.6];
	const w = gradientBand(p, PTS);
	if (
		!near(
			w.reduce((a, b) => a + b, 0),
			1,
		) ||
		w.some((v) => v < 0)
	)
		banded = false;
}
check('gradient band: weights are non-negative and sum to 1 everywhere in the space', banded);
const between = gradientBand([0, 0.8], PTS);
check(
	'gradient band: between walk (0.6) and run (1) only those two play, half each',
	near(between[1], 0.5) && near(between[2], 0.5) && between.filter((w) => w > 1e-9).length === 2,
	between.join(),
);

// ── Phase sync ──────────────────────────────────────────────────────────────────────────────────
const g1 = graphOf();
g1.setInput('moveY', 0.8);
const f1 = run(g1, 3.3);
const walk = f1.contributions.find((c) => c.clip === 'locomotion.walk_fwd');
const runC = f1.contributions.find((c) => c.clip === 'locomotion.run_fwd');
check(
	'phase sync: walk (1 s) and run (0.6 s) stay at one normalised phase',
	!!walk && !!runC && near(walk.time / 1.0, runC.time / 0.6, 1e-9),
	JSON.stringify([walk, runC]),
);
const blended = 0.5 * 1.0 + 0.5 * 0.6;
const played = 3.3;
check(
	'phase sync: the shared cycle is the weighted duration (Σ wᵢ·dᵢ)',
	near(walk.time / 1.0, (played / blended) % 1, 1e-6),
	`${walk.time} vs ${(played / blended) % 1}`,
);
const noSync = structuredClone(DOC);
noSync.machine.layers[0].states[0].sync = 'none';
const g2 = graphOf(noSync);
g2.setInput('moveY', 0.8);
const f2 = run(g2, 3.3);
check(
	"sync 'none': each point on the state's own clock",
	near(f2.contributions.find((c) => c.clip === 'locomotion.run_fwd').time, played % 0.6, 1e-6),
);

// ── Masks ───────────────────────────────────────────────────────────────────────────────────────
const upper = maskBones(DOC.masks.upperBody, BONES, parentOf);
check(
	'mask: spine_02 and everything under it, nothing else',
	upper.has('spine_02') &&
		upper.has('hand_r') &&
		upper.has('head') &&
		!upper.has('spine_01') &&
		!upper.has('thigh_l'),
	[...upper].join(),
);
check(
	'mask: exclude drops a subtree',
	!maskBones({ include: ['spine_02'], exclude: ['clavicle_l'] }, BONES, parentOf).has('hand_l'),
);

// ── Layers: attack while running ────────────────────────────────────────────────────────────────
const g3 = graphOf();
g3.setInput('moveY', 1);
run(g3, 1);
g3.fire('attack');
const swing = run(g3, 0.2);
const w3 = boneWeights(g3, swing);
check(
	'attack while running: override weights sum to 1 on every bone',
	[...w3].filter(([b]) => b !== 'root').every(([, w]) => near(w, 1)),
	JSON.stringify(Object.fromEntries(w3)),
);
check(
	'attack while running: the upper body plays the attack, the legs keep running',
	swing.states.upper === 'attack' &&
		near(
			swing.contributions
				.filter((c) => c.clip === 'combat.attack')
				.reduce((s, c) => s + c.weight, 0),
			1,
		) &&
		swing.contributions.some(
			(c) =>
				c.clip === 'locomotion.run_fwd' &&
				g3.regions.get(c.region).has('thigh_l') &&
				near(c.weight, 1),
		) &&
		!swing.contributions.some(
			(c) =>
				c.clip === 'locomotion.run_fwd' &&
				g3.regions.get(c.region).has('hand_r') &&
				c.weight > 1e-9,
		),
	JSON.stringify(swing.contributions.map((c) => [c.clip, c.region, c.weight.toFixed(3)])),
);
const recovered = run(g3, 1);
check(
	'after the swing the upper layer rests and running owns the whole body again',
	recovered.states.upper === 'none' &&
		!recovered.contributions.some((c) => c.clip === 'combat.attack') &&
		[...boneWeights(g3, recovered)].filter(([b]) => b !== 'root').every(([, w]) => near(w, 1)),
);
g3.setInput('upperWeight', 0.5);
g3.fire('attack');
const half = run(g3, 0.2);
check(
	'weightInput 0.5: the attack takes half the upper body, running the other half',
	near(weightOf(half, 'combat.attack'), 0.5) &&
		[...boneWeights(g3, half)].filter(([b]) => b !== 'root').every(([, w]) => near(w, 1)),
);

// ── Crossfades ──────────────────────────────────────────────────────────────────────────────────
const g4 = graphOf();
g4.setInput('moveY', 1);
const before = run(g4, 1);
const runBefore = before.contributions.find((c) => c.clip === 'locomotion.run_fwd').time;
g4.setInput('grounded', false);
const fading = run(g4, 0.1);
const fadeRun = fading.contributions.find((c) => c.clip === 'locomotion.run_fwd');
check(
	'a crossfade: the state left and the state entered share the body (weights sum to 1)',
	fading.states.base === 'air' &&
		near(weightOf(fading, 'locomotion.fall') + weightOf(fading, 'locomotion.run_fwd'), 1) &&
		weightOf(fading, 'locomotion.fall') > 0 &&
		weightOf(fading, 'locomotion.run_fwd') > 0,
);
check(
	'a crossfade keeps the state left moving under the blend (3D default)',
	!!fadeRun && !near(fadeRun.time, runBefore, 1e-3),
	`${runBefore} → ${fadeRun?.time}`,
);
const frozen = structuredClone(DOC);
frozen.machine.layers[0].transitions.find((t) => t.id === 'falloff').pauseSource = true;
const g5 = graphOf(frozen);
g5.setInput('moveY', 1);
const b5 = run(g5, 1);
const t5 = b5.contributions.find((c) => c.clip === 'locomotion.run_fwd').time;
g5.setInput('grounded', false);
const f5 = run(g5, 0.1);
check(
	'pauseSource: true freezes the state left',
	near(f5.contributions.find((c) => c.clip === 'locomotion.run_fwd').time, t5, 1e-9),
);
const landed = run(g4, 1);
check(
	'the fade completes: only the new state plays',
	landed.states.base === 'air' && near(weightOf(landed, 'locomotion.fall'), 1),
);

// ── Additive ────────────────────────────────────────────────────────────────────────────────────
const g6 = graphOf();
g6.setInput('moveY', 0.6);
run(g6, 0.5);
g6.fire('hit');
const hit = run(g6, 0.1);
check(
	'a hit plays additive over the locomotion, which keeps the whole body',
	hit.states.flinch === 'hit' &&
		weightOf(hit, 'reactions.hit', 'additive') > 0.9 &&
		weightOf(hit, 'reactions.hit', 'override') === 0 &&
		[...boneWeights(g6, hit)].filter(([b]) => b !== 'root').every(([, w]) => near(w, 1)),
);
check('…and is gone once it settles', !run(g6, 1).contributions.some((c) => c.mode === 'additive'));

// ── Jump ────────────────────────────────────────────────────────────────────────────────────────
const g7 = graphOf();
run(g7, 0.5);
g7.fire('jump');
g7.setInput('grounded', false);
const up = run(g7, 0.1);
const states = [up.states.base];
const air = run(g7, 0.6);
states.push(air.states.base);
g7.setInput('grounded', true);
states.push(run(g7, 0.4).states.base);
check('jump → air → move on landing', states.join() === 'jump,air,move', states.join());

// ── Cues ────────────────────────────────────────────────────────────────────────────────────────
const g8 = graphOf();
g8.setInput('moveY', 1);
const steps = [];
for (let i = 0; i < 120; i++) steps.push(...g8.advance(1 / 60).cues);
check(
	'cues: the leading clip’s steps, twice a 0.6 s cycle, over 2 s',
	steps.length >= 6 && steps.length <= 7 && steps.every((c) => c === 'locomotion.run_fwd:sfx:step'),
	steps.join(),
);

// ── Validator ───────────────────────────────────────────────────────────────────────────────────
const clean = validateCharacterAnim3d(DOC, { clips: DURATIONS, bones: BONES });
check('the humanoid doc validates clean', clean.length === 0, JSON.stringify(clean));
const VM_DOC = JSON.parse(
	readFileSync(
		new URL('../packages/engine-3d/fixtures/ie-humanoid-viewmodel.anim.json', import.meta.url),
		'utf8',
	),
);
const VM_DURATIONS = new Map([
	['viewmodel.idle', 2],
	['viewmodel.walk_bob', 0.8],
	['viewmodel.attack', 0.6],
	['viewmodel.hit', 0.4],
	['viewmodel.carry', 2],
]);
const vmIssues = validateCharacterAnim3d(VM_DOC, { clips: VM_DURATIONS, bones: BONES });
check('the viewmodel doc validates clean', vmIssues.length === 0, JSON.stringify(vmIssues));
// The stage validates at mount, before any clip library has loaded: no clip list at all.
const early = [DOC, VM_DOC].flatMap((d) => validateCharacterAnim3d(d, { bones: BONES }));
check(
	'with no clip list yet, a doc naming its clips in a 1D or 2D blend still validates clean',
	early.length === 0,
	JSON.stringify(early),
);
const vm = createAnimGraph3d({ doc: VM_DOC, durations: VM_DURATIONS, bones: BONES, parentOf });
vm.setInput('speed', 4);
run(vm, 0.5);
vm.fire('attack');
const vmSwing = run(vm, 0.1);
check(
	'the viewmodel bobs at walking speed and swings on attack, over the bob',
	vmSwing.states.swing === 'attack' &&
		vmSwing.contributions.some((c) => c.clip === 'viewmodel.walk_bob') &&
		vmSwing.contributions.some((c) => c.clip === 'viewmodel.attack' && c.weight > 0.5),
	JSON.stringify(vmSwing.contributions.map((c) => [c.clip, c.weight.toFixed(2)])),
);
const bad = structuredClone(DOC);
bad.machine.layers[1].mask = 'arms';
bad.machine.layers[1].weightInput = 'grounded';
bad.machine.layers[2].mode = 'multiply';
bad.machine.layers[0].states[0].blend2d.x = 'grounded';
bad.machine.layers[0].states[0].blend2d.points.push({ timeline: 'locomotion.sprint', at: [0, 1] });
bad.masks.upperBody.include.push('tail');
bad.clips['combat.attack'].cues.push({ at: 3, cue: 'late' });
const codes = new Set(
	validateCharacterAnim3d(bad, { clips: DURATIONS, bones: BONES }).map((i) => i.code),
);
check(
	'the validator names every planted mistake',
	[
		'layer-mask-unknown',
		'layer-weight-input',
		'layer-mode-unknown',
		'blend2d-input',
		'blend2d-duplicate-at',
		'blend2d-clip-missing',
		'mask-bone-unknown',
		'cue-outside-clip',
	].every((c) => codes.has(c)),
	[...codes].join(),
);
const missing = graphOf(DOC, new Map([...DURATIONS].filter(([k]) => k !== 'combat.attack')));
check('a missing clip is listed, never thrown', missing.missingClips.join() === 'combat.attack');
check(
	'docs read from arcade.world3d.anim, a malformed one reported by path',
	(() => {
		const { docs, problems } = animDocsOf3d({ humanoid: DOC, broken: { inputs: [] } });
		return (
			!!docs.humanoid &&
			!docs.broken &&
			problems[0] === 'arcade.world3d.anim.broken: needs inputs and machine.layers'
		);
	})(),
);

// ── The shared runner is untouched by the 3D fields ─────────────────────────────────────────────
const strip3d = (doc) => {
	const machine = structuredClone(doc.machine);
	for (const layer of machine.layers) {
		for (const key of ['mask', 'mode', 'weightInput']) delete layer[key];
		for (const state of layer.states) for (const key of ['blend2d', 'sync']) delete state[key];
	}
	return machine;
};
const trace = (machine) => {
	const r = new ComponentStateMachineRunner(machine, DOC.inputs, DURATIONS);
	const out = [];
	const script = [
		[0.5, () => r.setInput('moveY', 1)],
		[0.3, () => r.fire('attack')],
		[0.4, () => r.fire('hit')],
		[0.2, () => r.setInput('grounded', false)],
		[0.6, () => r.setInput('grounded', true)],
		[0.5, () => r.fire('jump')],
	];
	for (const [seconds, act] of script) {
		act();
		for (let t = 0; t < seconds; t += 1 / 60) {
			r.advance(1 / 60);
			out.push(JSON.stringify(r.plays()));
		}
	}
	return out.join('\n');
};
check(
	'the 2D runner plays a 3D doc exactly as the same doc with its 3D fields removed',
	trace(DOC.machine) === trace(strip3d(DOC)),
);

if (failures.length) {
	console.error(`check:engine-3d-anim — ${failures.length} failed:\n  ${failures.join('\n  ')}`);
	process.exit(1);
}
console.log(`check:engine-3d-anim — ${passed} checks passed`);
