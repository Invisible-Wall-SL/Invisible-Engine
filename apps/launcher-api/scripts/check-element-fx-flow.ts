/**
 * Guard the Flow half of ELEMENT FX (`docs/design/element-fx.md`), offline.
 *
 * Run: `pnpm --filter launcher-api run check:element-fx-flow`
 *
 * Three rules:
 *
 *  1. **An Element FX cue is fireable.** A node's or a screen's `elementFx` entry that plays (or
 *     stops) on a cue is harvested into the flow's cue list like a rig's own cue, inside components
 *     too; a disabled entry and an unreadable one are not.
 *  2. **The target dropdown lists what the game anchors.** `elementEffect.target` is an enum, and an
 *     enum literal is pick-only, so a target missing here cannot be authored: the reels (first, so
 *     a new node defaults to them), the whole stage (Invisible Shader Graph 8e), every screen, and
 *     every node the game registers an anchor for (a group, a component placement, a coded mount,
 *     any node carrying Element FX — inside a component too). Not a reel grid, whose effects play
 *     on the reel stack.
 *  3. **One composition.** `composeFlowV2Vocab` widens the enum with the targets for the editor and
 *     the publish gate alike; with no targets the vocabulary keeps its identity. The project's
 *     custom kinds widen both `ElementFxKind` and `ScreenTransitionKind` (8e).
 */
import type { ComponentDef, Scene } from 'engine-layout';
import {
	ELEMENT_FX_KIND_ENUM,
	ELEMENT_FX_TARGET_ENUM,
	SCREEN_TRANSITION_KIND_ENUM,
	templateVocabulary,
} from 'engine-flow-v2';
import { SCREEN_TRANSITION_KINDS } from 'constants-shared/screenTransition';

import { collectElementFxTargets, withElementFxTargets } from '../src/lib/elementFxTargets';
import { readFileSync } from 'node:fs';

import { composeFlowV2Vocab } from '../src/lib/flowV2Vocab';
import { collectSceneCueNames } from '../src/lib/sceneCues';
import { soundOptionsFor } from '../src/lib/soundOptions';

let fails = 0;
let passes = 0;
const check = (name: string, ok: boolean): void => {
	if (ok) passes++;
	else {
		fails++;
		console.error('FAIL:', name);
	}
};
const eq = (name: string, actual: unknown, expected: unknown): void =>
	check(
		`${name} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
		JSON.stringify(actual) === JSON.stringify(expected),
	);

const scenes = [
	{
		id: 'basegame',
		name: 'Base',
		elementFx: [{ id: 'efx1', kind: 'shake', trigger: 'cue', cue: 'screenHit' }],
		nodes: [
			{ id: 'logo', kind: 'sprite', assetKey: 'a', x: 0, y: 0 },
			{
				id: 'hero',
				kind: 'spine',
				assetKey: 'r',
				x: 0,
				y: 0,
				elementFx: [
					{ id: 'efx1', kind: 'flipX', trigger: 'cue', cue: ' heroFlip ', stopCue: 'heroRest' },
					{ id: 'efx2', kind: 'glow', trigger: 'cue', cue: 'heroOff', disabled: true },
					{ id: 'efx3', kind: 'video', trigger: 'cue', cue: 'never' },
				],
			},
			{
				id: 'group',
				kind: 'container',
				x: 0,
				y: 0,
				children: [
					{
						id: 'clip',
						kind: 'flipbook',
						clipId: 'c',
						x: 0,
						y: 0,
						elementFx: [{ id: 'efx1', kind: 'crumble', trigger: 'cue', cue: 'clipBreak' }],
					},
				],
			},
			{ id: 'pot', kind: 'componentInstance', componentId: 'Pot', x: 0, y: 0 },
			{
				id: 'grid',
				kind: 'reelGrid',
				x: 0,
				y: 0,
				reels: 5,
				rows: 3,
				elementFx: [{ id: 'efx1', kind: 'waveY', trigger: 'cue', cue: 'reelsWave' }],
			},
		],
	},
	{ id: 'freeSpins', name: 'Free spins', nodes: [] },
] as unknown as Scene[];

const pot = {
	id: 'Pot',
	root: {
		id: 'root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'beam',
				kind: 'effect',
				effectId: 'e',
				x: 0,
				y: 0,
				elementFx: [{ id: 'efx1', kind: 'pulse', trigger: 'cue', cue: 'potPulse' }],
			},
			{ id: 'plain', kind: 'container', x: 0, y: 0, children: [] },
		],
	},
} as unknown as ComponentDef;

// ── 1. cues ───────────────────────────────────────────────────────────────────────────────────
const cues = collectSceneCueNames(scenes, [pot]);
for (const name of ['screenHit', 'heroFlip', 'heroRest', 'clipBreak', 'reelsWave', 'potPulse']) {
	check(`1. the cue "${name}" is harvested`, cues.includes(name));
}
check('1. a disabled entry’s cue is not', !cues.includes('heroOff'));
check('1. an unreadable entry’s cue is not', !cues.includes('never'));
eq(
	'1. without the defs, the component’s cue is not',
	collectSceneCueNames(scenes).includes('potPulse'),
	false,
);

// ── 2. targets ────────────────────────────────────────────────────────────────────────────────
const targets = collectElementFxTargets(scenes, [pot]);
eq('2. the reels, the stage, every screen, then anchored nodes sorted', targets, [
	'reels',
	'stage',
	'screen:basegame',
	'screen:freeSpins',
	'beam',
	'clip',
	'group',
	'hero',
	'pot',
]);
check('2. a plain sprite is not a target', !targets.includes('logo'));
check('2. a reel grid is not (its FX play on the reel stack)', !targets.includes('grid'));
check('2. a group inside a component is not (no anchor there)', !targets.includes('plain'));
eq('2. no scenes ⇒ the reels and the stage', collectElementFxTargets([]), ['reels', 'stage']);

// ── 3. composition ────────────────────────────────────────────────────────────────────────────
const base = templateVocabulary('lines');
const baseTargets = base.enums.find((e) => e.name === ELEMENT_FX_TARGET_ENUM)?.values;
eq('3. the kind’s vocabulary offers the reels, then the stage', baseTargets, ['reels', 'stage']);
const widened = withElementFxTargets(base, targets);
eq(
	'3. widened with the project’s targets',
	widened.enums.find((e) => e.name === ELEMENT_FX_TARGET_ENUM)?.values,
	targets,
);
check(
	'3. nothing to add ⇒ the same object',
	withElementFxTargets(base, ['reels', 'stage']) === base,
);
const composed = composeFlowV2Vocab('lines', {
	sounds: soundOptionsFor(null),
	sceneCues: [],
	fxTargets: targets,
});
eq(
	'3. composeFlowV2Vocab carries them',
	composed.enums.find((e) => e.name === ELEMENT_FX_TARGET_ENUM)?.values,
	targets,
);
const enumOf = (vocab: typeof base, name: string) =>
	vocab.enums.find((e) => e.name === name)?.values;
eq(
	'3. the kind’s transition kinds are the built-in exits',
	enumOf(base, SCREEN_TRANSITION_KIND_ENUM),
	[...SCREEN_TRANSITION_KINDS],
);
const withCustom = composeFlowV2Vocab('lines', {
	sounds: soundOptionsFor(null),
	sceneCues: [],
	customFxKinds: ['custom:swirl'],
});
eq(
	'3. a custom kind widens the Element FX kinds and the transition kinds alike',
	[
		enumOf(withCustom, ELEMENT_FX_KIND_ENUM)?.at(-1),
		enumOf(withCustom, SCREEN_TRANSITION_KIND_ENUM),
	],
	['custom:swirl', [...SCREEN_TRANSITION_KINDS, 'custom:swirl']],
);
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
check(
	'3. the publish gate composes with the targets',
	read('../src/lib/server/flowV2Validation.ts').includes(
		'fxTargets: collectElementFxTargets(scenes, components),',
	),
);
check(
	'3. the editor composes with the targets',
	read('../src/routes/(app)/flow-v2/+page.svelte').includes('fxTargets: data.fxTargets ?? [],'),
);

if (fails) {
	console.error(`\nelement fx flow: ${fails} check(s) FAILED`);
	process.exit(1);
}
console.log(`element fx flow: all ${passes} checks passed`);
