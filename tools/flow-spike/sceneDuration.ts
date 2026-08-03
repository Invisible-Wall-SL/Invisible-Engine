/**
 * Invisible Flow v2 — `showContainer.durationMs` scene-duration harness.
 *
 *   pnpm --filter flow-spike run sceneduration
 *
 * Proves the PURE `sceneAnimationDurationMs` calculator (`engine-layout/sceneDuration.ts`) that
 * backs the `showContainer` node's `durationMs` OUTPUT pin:
 *   1. MAX-SELECTION   — a scene's duration is the longest of its animated nodes (spine + effect),
 *                        and a spine node maxes over `defaultAnimation` + every `cues[].animation`.
 *   2. EXPANSION       — it descends into `container` children AND expands `componentInstance` defs
 *                        via `resolveComponent`, with a cycle guard (a self-referential def can't hang).
 *   3. EMPTY / MISSES  — an empty scene, and one whose assets don't resolve (un-loaded skeleton /
 *                        un-baked effect / unknown component), both ⇒ 0 (parity-safe: a Delay fed 0
 *                        simply doesn't wait).
 *
 * Pure data + resolver stubs — no game, no loaded assets. Prints PASS/FAIL per assertion + a final
 * `SCENE DURATION HARNESS: PASSED`.
 */

import {
	sceneAnimationDurationMs,
	type LayoutNode,
	type Scene,
	type SceneDurationResolvers,
} from 'engine-layout';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

// ---------------------------------------------------------------------------
// Node builders (minimal — only the fields the calculator reads).
// ---------------------------------------------------------------------------

const spine = (
	id: string,
	assetKey: string,
	defaultAnimation?: string,
	cues?: { signal: string; animation: string }[],
): LayoutNode => ({ kind: 'spine', id, x: 0, y: 0, assetKey, defaultAnimation, cues });

const effect = (id: string, effectId: string): LayoutNode => ({
	kind: 'effect',
	id,
	x: 0,
	y: 0,
	effectId,
});

const container = (id: string, children: LayoutNode[]): LayoutNode => ({
	kind: 'container',
	id,
	x: 0,
	y: 0,
	children,
});

const instance = (id: string, componentId: string): LayoutNode => ({
	kind: 'componentInstance',
	id,
	x: 0,
	y: 0,
	componentId,
});

const scene = (id: string, nodes: LayoutNode[]): Scene => ({ id, name: id, nodes });

// ---------------------------------------------------------------------------
// A resolver stub: fixed clip/effect durations by name; a component library keyed by def id.
// ---------------------------------------------------------------------------

const makeResolvers = (
	clips: Record<string, number>, // `${assetKey}:${animation}` → ms
	effects: Record<string, number>, // effectId → ms
	components: Record<string, LayoutNode>, // defId → root node
): SceneDurationResolvers => ({
	spineClipMs: (assetKey, animation) =>
		animation === undefined ? undefined : clips[`${assetKey}:${animation}`],
	effectMs: (effectId) => effects[effectId],
	resolveComponent: (defId) => (components[defId] ? { root: components[defId] } : undefined),
});

// ---------------------------------------------------------------------------

const main = () => {
	console.log('Invisible Flow v2 — scene-duration harness\n');

	console.log('1. max-selection:');
	{
		// Two spines: hero maxes over its default (500) + cue (900) ⇒ 900; sidekick 300. Scene ⇒ 900.
		const r = makeResolvers({ 'hero:idle': 500, 'hero:win': 900, 'sidekick:idle': 300 }, {}, {});
		const s = scene('win', [
			spine('a', 'hero', 'idle', [{ signal: 'win', animation: 'win' }]),
			spine('b', 'sidekick', 'idle'),
		]);
		assert(
			'longest across nodes + a spine maxes over default+cues (900)',
			sceneAnimationDurationMs(s, r) === 900,
		);

		// An effect can be the longest element.
		const r2 = makeResolvers({ 'hero:idle': 500 }, { sparkle: 1200 }, {});
		const s2 = scene('fx', [spine('a', 'hero', 'idle'), effect('e', 'sparkle')]);
		assert(
			'an effect node participates in the max (1200)',
			sceneAnimationDurationMs(s2, r2) === 1200,
		);
	}

	console.log('\n2. expansion (container children + componentInstance defs, cycle-guarded):');
	{
		// A container nests a spine; a componentInstance's def root nests a longer spine.
		const r = makeResolvers(
			{ 'hero:idle': 400, 'boss:rage': 1500 },
			{},
			{ bossCard: container('def-root', [spine('ds', 'boss', 'rage')]) },
		);
		const s = scene('mixed', [
			container('c', [spine('a', 'hero', 'idle')]),
			instance('i', 'bossCard'),
		]);
		assert(
			'descends into container + expands component def (1500)',
			sceneAnimationDurationMs(s, r) === 1500,
		);

		// Cycle guard: a def whose root contains an instance of ITSELF must terminate (and still measure
		// the reachable spine before the self-reference is skipped).
		const cyclic: LayoutNode = container('def-root', [
			spine('self-spine', 'hero', 'idle'),
			instance('again', 'loopy'),
		]);
		const rc = makeResolvers({ 'hero:idle': 700 }, {}, { loopy: cyclic });
		const sc = scene('cyclic', [instance('i', 'loopy')]);
		let terminated = true;
		let value = -1;
		try {
			value = sceneAnimationDurationMs(sc, rc);
		} catch {
			terminated = false;
		}
		assert('a self-referential component def terminates (no infinite recursion)', terminated);
		assert('...and still measures the reachable clip (700)', value === 700);
	}

	console.log('\n3. empty scene + unresolved assets ⇒ 0:');
	{
		assert(
			'empty scene ⇒ 0',
			sceneAnimationDurationMs(scene('empty', []), makeResolvers({}, {}, {})) === 0,
		);

		// Every name is unknown to the resolvers (un-loaded skeleton / un-baked effect / unknown def).
		const r = makeResolvers({}, {}, {});
		const s = scene('misses', [
			spine('a', 'ghost', 'idle'),
			effect('e', 'nope'),
			instance('i', 'absent'),
		]);
		assert('all-unmeasurable scene ⇒ 0 (parity-safe)', sceneAnimationDurationMs(s, r) === 0);
	}

	console.log(`\n${failed ? 'SCENE DURATION HARNESS: FAILED' : 'SCENE DURATION HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

main();
