/**
 * Guard the CONTAINER → "can this screen complete itself?" projection, offline.
 *
 * Run: `pnpm --filter launcher-api run check:container-taps`
 *
 * WHY. This map is the only thing the Flow validator's hold-safety checks can read about a SCENE, and
 * it is read in both directions: a container it says has no release turns a `showContainer{await}`
 * RED, and one it says has a release stays silent. So a wrong answer here is either a false error on
 * a working flow or a missed round-hang — and neither is visible in a build (`apps/launcher-api`'s
 * build is not a typecheck; see apps/launcher-api/CLAUDE.md).
 *
 * Four rules are load-bearing:
 *
 *  1. **An unresolved container is ABSENT, not `false`.** The "never guess" rule the whole check
 *     rests on: an unsaved or standalone project has no scenes, and must produce NO issues rather
 *     than a false error on every flow. `false` would mean "resolved, and it has no release".
 *  2. **Nested instances count.** An overlay's tap instance routinely sits inside a `container`.
 *  3. **The def SEED counts.** `LOADING_BAR_DEF` seeds `tapToContinue: true` via
 *     `defaultInstanceParams`, applied at RUNTIME by `resolveComponentParams` — so a hand-authored
 *     splash has a tap that appears nowhere in the doc. Reading `node.params` alone would flag the
 *     scaffolded loading screen of every project.
 *  4. **`completeOnLoaded` is a release too.** It calls the same `completeActiveScreen`, so an
 *     author who ticks "On loaded" instead of a tap must not be flagged.
 */
import type { Scene } from 'engine-layout';

import { collectContainerTaps } from '../src/lib/containerTaps';

let fails = 0;
const check = (name: string, ok: boolean): void => {
	if (!ok) {
		fails++;
		console.error('FAIL:', name);
	}
};

const instance = (id: string, componentId: string, params?: Record<string, unknown>) => ({
	kind: 'componentInstance' as const,
	id,
	componentId,
	x: 0,
	y: 0,
	...(params ? { params } : {}),
});

const scenes = [
	// A tap authored explicitly, on a TOP-LEVEL instance.
	{ id: 'intro', name: 'Intro', nodes: [instance('tap', 'imagePanel', { tapToContinue: true })] },
	// The same, NESTED two containers deep.
	{
		id: 'outro',
		name: 'Outro',
		nodes: [
			{
				kind: 'container' as const,
				id: 'c1',
				x: 0,
				y: 0,
				children: [
					{
						kind: 'container' as const,
						id: 'c2',
						x: 0,
						y: 0,
						children: [instance('deepTap', 'imagePanel', { tapToContinue: true })],
					},
				],
			},
		],
	},
	// The loading bar's RUNTIME seed — no `tapToContinue` anywhere in the doc.
	{ id: 'loading', name: 'Loading', nodes: [instance('bar', 'loadingBar')] },
	// The same def with the toggle explicitly CLEARED — an explicit false beats the seed.
	{
		id: 'cleared',
		name: 'Cleared',
		nodes: [instance('bar2', 'loadingBar', { tapToContinue: false })],
	},
	// Auto-advance instead of a tap.
	{ id: 'auto', name: 'Auto', nodes: [instance('bar3', 'imagePanel', { completeOnLoaded: true })] },
	// A tap authored for PORTRAIT only (a per-layoutType param patch).
	{
		id: 'portraitOnly',
		name: 'Portrait only',
		nodes: [
			{
				...instance('pTap', 'imagePanel'),
				overrides: { portrait: { params: { tapToContinue: true } } },
			},
		],
	},
	// Nothing that can complete it.
	{ id: 'silent', name: 'Silent', nodes: [instance('art', 'imagePanel')] },
	{ id: 'empty', name: 'Empty', nodes: [] },
] as unknown as Scene[];

const containers = [
	{ id: 'intro', sceneId: 'intro' },
	{ id: 'outro', sceneId: 'outro' },
	{ id: 'loading', sceneId: 'loading' },
	{ id: 'cleared', sceneId: 'cleared' },
	{ id: 'auto', sceneId: 'auto' },
	{ id: 'portraitOnly', sceneId: 'portraitOnly' },
	{ id: 'silent', sceneId: 'silent' },
	{ id: 'empty', sceneId: 'empty' },
	{ id: 'ghost', sceneId: 'deleted-scene' }, // no such scene ⇒ unresolved
];

const taps = collectContainerTaps(containers, scenes);

check('an explicit tap resolves true', taps.intro === true);
check('a tap nested two containers deep resolves true', taps.outro === true);
check("the loading bar's defaultInstanceParams seed resolves true", taps.loading === true);
check('an explicit false beats the def seed', taps.cleared === false);
check('completeOnLoaded counts as a release', taps.auto === true);
check('a per-layoutType params patch counts', taps.portraitOnly === true);
check('a scene with no release surface resolves false', taps.silent === false);
check('an empty scene resolves false (resolved, and it has nothing)', taps.empty === false);
check('a container whose scene is missing is ABSENT, not false', !('ghost' in taps));

// NEVER GUESS — a project with no scenes at all keys nothing.
const none = collectContainerTaps(containers, []);
check('no scenes ⇒ an EMPTY map (every container unresolved)', Object.keys(none).length === 0);
check('no containers ⇒ an empty map', Object.keys(collectContainerTaps([], scenes)).length === 0);

if (fails > 0) {
	console.error(`\ncheck:container-taps — ${fails} failure(s)`);
	process.exit(1);
}
console.log('check:container-taps — OK');
