/**
 * Guard the SCENE CUE → Flow palette projection, offline.
 *
 * Run: `pnpm --filter launcher-api run check:scene-cues`
 *
 * WHY. A `fireCue` node's `ref` is checked against `TemplateVocabulary.cues`, and the palette,
 * inspector, pin derivation and validator all read that one list. So the list IS the feature: a
 * name this harvest misses cannot be authored at all, and a name it adds that the runtime cannot
 * fire authors a node that looks wired and silently does nothing. Neither failure is visible in a
 * build — the launcher's `build` is not a typecheck (see apps/launcher-api/CLAUDE.md) — and neither
 * is visible in the editor, which happily saves a cue whose name never reaches the palette.
 *
 * Four rules here are load-bearing:
 *
 *  1. **Both cued kinds are harvested.** A spine cue swaps animation, a flipbook cue swaps clip;
 *     they ride the same bus and differ only in payload field. Harvesting spines alone would leave
 *     a flipbook character un-fireable while the editor saved its cue — the exact bug this exists
 *     to prevent, because a flipbook character is the common case for non-rigged art.
 *  2. **Nested nodes count.** A cued node usually sits inside a `container`, so a top-level-only
 *     scan would miss most of a real scene.
 *  3. **Game-driven names are EXCLUDED.** `getComponentSignal` resolves a registered name against
 *     the game's registry and never consults the open bus, so `emitComponentSignal('win')` is a
 *     no-op — and the emitter broadcast riding along carries the catalog name (`win`), not the
 *     event the game publishes (`winShow`), so it reaches nobody either. They stay perfectly valid
 *     ON a node (that is how art reacts to a real win with no flow); they are just not the flow's
 *     to fire.
 *  4. **Nothing to add ⇒ the SAME object back.** `withSceneCues` mirrors `withProjectSounds`, and
 *     the editor's `vocab` is a `$derived` — returning a fresh object for an unaffected project
 *     would re-derive every downstream consumer on every read.
 */
import type { Scene } from 'engine-layout';
import type { TemplateVocabulary } from 'engine-flow-v2';

import { collectSceneCueNames, withSceneCues } from '../src/lib/sceneCues';
import { collectClipIds } from '../src/lib/server/clipReachability';

let fails = 0;
const check = (name: string, ok: boolean): void => {
	if (!ok) {
		fails++;
		console.error('FAIL:', name);
	}
};
const eq = (name: string, actual: unknown, expected: unknown): void =>
	check(
		`${name} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
		JSON.stringify(actual) === JSON.stringify(expected),
	);

// One scene exercising every branch at once: a SPINE cue, a FLIPBOOK cue two containers deep, a
// game-driven name on each kind, a whitespace-only name, a padded name, a cue-less node, and a
// duplicate across scenes.
const scenes = [
	{
		id: 'basegame',
		nodes: [
			{
				kind: 'spine',
				id: 'rig',
				assetKey: 'a',
				cues: [
					{ signal: 'characterCheer', animation: 'cheer' },
					{ signal: 'win', animation: 'celebrate' }, // game-driven ⇒ excluded
					{ signal: '   ', animation: 'x' }, // blank ⇒ skipped
				],
			},
			{
				kind: 'container',
				id: 'c1',
				children: [
					{
						kind: 'container',
						id: 'c2',
						children: [
							{
								kind: 'flipbook',
								id: 'whaler',
								clipId: 'idle',
								cues: [
									{ signal: '  characterSpin  ', clipId: 'spin' }, // padded ⇒ trimmed
									{ signal: 'bigWin', clipId: 'cheer' }, // game-driven ⇒ excluded
								],
							},
							{ kind: 'flipbook', id: 'nocues', clipId: 'waves' },
							{ kind: 'sprite', id: 's', assetKey: 'b' },
						],
					},
				],
			},
		],
	},
	{
		id: 'bigwin',
		nodes: [
			{
				kind: 'flipbook',
				id: 'dupe',
				clipId: 'x',
				cues: [{ signal: 'characterSpin', clipId: 'y' }],
			},
		],
	},
] as unknown as Scene[];

const harvested = collectSceneCueNames(scenes);

eq('harvests both kinds, trimmed, de-duped and sorted', harvested, [
	'characterCheer',
	'characterSpin',
]);
check('the FLIPBOOK cue two containers deep is found', harvested.includes('characterSpin'));
check('a game-driven name is never offered', !harvested.some((n) => n === 'win' || n === 'bigWin'));
check('a blank signal is skipped', !harvested.some((n) => n.trim() === ''));

// --- withSceneCues: payload-less decls, de-duped against the engine list and each other ---
const vocab = {
	cues: [{ name: 'winShow', payload: [] }],
} as unknown as TemplateVocabulary;

const widened = withSceneCues(vocab, ['characterSpin', 'winShow', 'characterSpin']);
eq('appends only unseen names, once each, as payload-less decls', widened.cues, [
	{ name: 'winShow', payload: [] },
	{ name: 'characterSpin', payload: [] },
]);
check(
	'an author naming an engine cue re-uses its decl instead of shadowing it',
	widened.cues.filter((c) => c.name === 'winShow').length === 1,
);
check('nothing to add ⇒ the SAME object back', withSceneCues(vocab, []) === vocab);
check(
	'every name already known ⇒ the SAME object back',
	withSceneCues(vocab, ['winShow']) === vocab,
);
eq('no scenes ⇒ no names', collectSceneCueNames([]), []);

// --- RULE 8: a clip a cue swaps TO must reach the game, or the cue is a silent no-op ---
// `collectClipIds` gates BOTH exporters — the clip registry and the clip's atlas pages — and main
// recently started pruning whatever it does not name (#644/#645). A cue's target clip is played
// only when a signal fires, so nothing else in the doc references it; if the walk missed it the
// clip would be pruned, the swap would resolve to nothing, and the character would silently keep
// its resting clip. It is reachable because the cue names the field `clipId`, which is exactly what
// the generic walk keys on — this asserts that alignment rather than trusting it.
const reachable = new Set<string>();
collectClipIds(scenes, reachable);
check('a flipbook CUE target clip is reachable, so the bake ships it', reachable.has('spin'));
check('…alongside the resting clip it swaps away from', reachable.has('idle'));
check('…and a cue target on a second scene', reachable.has('y'));

if (fails > 0) {
	console.error(`\n${fails} check(s) failed.`);
	process.exit(1);
}
console.log('scene cues: all checks passed');
