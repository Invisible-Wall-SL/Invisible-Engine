/**
 * Invisible FX — RIG-BOUND CONTENT SEAM headless harness:
 *
 *   pnpm --filter fx-spike run rig-bound
 *
 * What this pins. Rig-timeline bindings (`event.fx` / `event.flipbook`, authored in the Rigger and
 * baked into the `rigFx` / `rigFlipbooks` manifests) used to be resolved-and-mounted by a ~25-line
 * block hand-copied into `LayoutNodeView`'s spine branch and `SymbolSpineMain`. A rig mounted by
 * ANY OTHER path — the big-win rig (`WinAnimation`), a backdrop, a transition, a cinematic actor —
 * read the manifest nowhere and silently played nothing, with the binding baked and correct.
 *
 * The join now lives at `<SpineProvider>`, the one component every rig goes through:
 * `engine-layout` installs a resolver into `pixi-svelte`'s `rigBoundContent` seam, and
 * `SpineProvider` mounts whatever it returns. The WebGL half still needs live verify; what IS
 * verifiable offline is the whole lookup — which is where every failure so far has lived:
 *
 *   1. No resolver installed ⇒ the frozen empty, by IDENTITY (nothing mounts, no churn).
 *   2. `registerRigFx` installs the seam ITSELF — no boot step to forget.
 *   3. A binding resolves to mount-ready `<RiggedEffect>` props, `slot` → `drawSlot` (the rename
 *      that decides draw order and cannot be passed under its authored name in Svelte).
 *   4. Folder tolerance: a full R2 bundle prefix resolves to the same bindings as the bare folder.
 *   5. A dangling effect/clip id is DROPPED, not mounted empty.
 *   6. The flipbook twin, with playback overrides folded through the shared `foldFlipbookPlayback`.
 *   7. REGRESSION — the real `R_Wins` rig that surfaced this bug: one effect keyed `continuous` on
 *      ten animations must yield ten DISTINCT `{#each}` keys, or Svelte collapses them and only
 *      one animation ever fires.
 *
 * Source modules are imported by path, not through the `engine-layout` barrel, so tsx resolves
 * without pulling Svelte components — the same convention as `bg-scene-spike`.
 */

import {
	registerEffects,
	clearEffects,
	type EffectDoc,
} from '../../packages/engine-layout/src/lib/registerEffects';
import {
	registerFlipbooks,
	clearFlipbooks,
	type FlipbookClipEntry,
} from '../../packages/engine-layout/src/lib/registerFlipbooks';
import {
	registerRigFx,
	clearRigFx,
	type RigFxBinding,
} from '../../packages/engine-layout/src/lib/registerRigFx';
import {
	registerRigFlipbooks,
	clearRigFlipbooks,
	type RigFlipbookBinding,
} from '../../packages/engine-layout/src/lib/registerRigFlipbooks';
import { uninstallRigBoundContent } from '../../packages/engine-layout/src/lib/rigBoundContentInstall';
import {
	resolveRigBoundContent,
	EMPTY_RIG_BOUND_CONTENT,
} from '../../packages/pixi-svelte/src/lib/rigBoundContent';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.log(`  ✗ ${msg}`);
	}
};

const resetAll = (): void => {
	clearEffects();
	clearFlipbooks();
	clearRigFx();
	clearRigFlipbooks();
	uninstallRigBoundContent();
};

/** A minimal but REAL-shaped effect doc — only `id` is read by the registry. */
const effectDoc = (id: string): EffectDoc =>
	({ version: 1, id, name: id, layers: [] }) as unknown as EffectDoc;

const clipEntry = (id: string, over: Partial<FlipbookClipEntry> = {}): FlipbookClipEntry => ({
	id,
	name: id,
	assetKey: 'S_Sheet',
	frames: ['f0', 'f1', 'f2'],
	fps: 24,
	loop: true,
	...over,
});

console.log('\n1. No resolver installed ⇒ the shared frozen empty');
{
	resetAll();
	const a = resolveRigBoundContent('R_Wins');
	assert(a === EMPTY_RIG_BOUND_CONTENT, 'un-installed seam returns EMPTY by identity');
	assert(resolveRigBoundContent('') === EMPTY_RIG_BOUND_CONTENT, 'empty key returns EMPTY');
	assert(
		resolveRigBoundContent(undefined) === EMPTY_RIG_BOUND_CONTENT,
		'undefined key returns EMPTY (a rig whose bundle has not resolved yet)',
	);
	assert(
		Object.isFrozen(EMPTY_RIG_BOUND_CONTENT),
		'EMPTY is frozen — no consumer can push into it',
	);
}

console.log('\n2. registerRigFx installs the seam itself — no boot step to forget');
{
	resetAll();
	registerEffects([effectDoc('v_winripple')]);
	registerRigFx({
		R_Wins: [
			{
				event: 'event',
				animation: 'Big_Intro',
				time: 0.0152,
				effectId: 'v_winripple',
				bone: 'bone114',
				slot: 'slot12',
				continuous: true,
			},
		] as RigFxBinding[],
	});
	const bound = resolveRigBoundContent('R_Wins');
	assert(bound !== EMPTY_RIG_BOUND_CONTENT, 'the seam resolves without any explicit install call');
	assert(bound.effects.length === 1, 'one binding ⇒ one mount');
}

console.log('\n3. A binding becomes mount-ready <RiggedEffect> props');
{
	resetAll();
	registerEffects([effectDoc('v_winripple')]);
	registerRigFx({
		R_Wins: [
			{
				event: 'event',
				animation: 'Big_Intro',
				time: 0.0152,
				effectId: 'v_winripple',
				bone: 'bone114',
				slot: 'slot12',
				alpha: 0.5,
				scale: 2,
				delay: 100,
				duration: 900,
				speed: 1.5,
				continuous: true,
			},
		] as RigFxBinding[],
	});
	const [e] = resolveRigBoundContent('R_Wins').effects;
	assert(e.doc.id === 'v_winripple', 'effectId resolved to its registered doc');
	assert(e.event === 'event' && e.animation === 'Big_Intro' && e.time === 0.0152, 'beat carried');
	assert(e.bone === 'bone114', 'host bone carried');
	assert(
		e.drawSlot === 'slot12',
		'slot → drawSlot (the rename Svelte forces, and draw order needs)',
	);
	assert(
		(e as { slot?: string }).slot === undefined,
		'the authored `slot` name is NOT also passed through (it would be read as a legacy Svelte slot)',
	);
	assert(
		e.alpha === 0.5 && e.scale === 2 && e.delay === 100 && e.duration === 900 && e.speed === 1.5,
		'all five numeric overrides carried',
	);
	assert(e.continuous === true, 'continuous carried');
	assert(typeof e.key === 'string' && e.key.length > 0, 'an {#each} key is produced');
}

console.log('\n4. Folder tolerance — a full R2 bundle prefix resolves like the bare folder');
{
	resetAll();
	registerEffects([effectDoc('v_winripple')]);
	registerRigFx({
		R_Wins: [{ event: 'event', effectId: 'v_winripple' }] as RigFxBinding[],
	});
	const bare = resolveRigBoundContent('R_Wins');
	const prefixed = resolveRigBoundContent('invisible_wall/test6/spines/R_Wins/');
	assert(bare.effects.length === 1, 'bare folder resolves');
	assert(prefixed.effects.length === 1, 'full R2 bundle prefix resolves too');
	assert(prefixed.effects[0].doc.id === bare.effects[0].doc.id, 'both reach the same effect');
	assert(
		resolveRigBoundContent('R_SomethingElse') === EMPTY_RIG_BOUND_CONTENT,
		'an unbound rig still gets EMPTY by identity',
	);
}

console.log('\n5. A dangling id is DROPPED, never mounted empty');
{
	resetAll();
	// Effect registry deliberately left without `v_missing`.
	registerEffects([effectDoc('v_present')]);
	registerRigFx({
		R_Wins: [
			{ event: 'a', effectId: 'v_present' },
			{ event: 'b', effectId: 'v_missing' },
		] as RigFxBinding[],
	});
	const bound = resolveRigBoundContent('R_Wins');
	assert(bound.effects.length === 1, 'only the resolvable binding mounts');
	assert(bound.effects[0].doc.id === 'v_present', 'and it is the right one');

	resetAll();
	registerRigFx({ R_Wins: [{ event: 'a', effectId: 'v_missing' }] as RigFxBinding[] });
	assert(
		resolveRigBoundContent('R_Wins') === EMPTY_RIG_BOUND_CONTENT,
		'a rig whose every binding dangles collapses to EMPTY (identity preserved)',
	);
}

console.log('\n6. The flipbook twin — clip resolved, playback overrides folded');
{
	resetAll();
	registerFlipbooks([clipEntry('f_ocean', { fps: 24, loop: true, direction: 'forward' })]);
	registerRigFlipbooks({
		R_Wins: [
			{
				event: 'event',
				animation: 'Big_Idle',
				time: 0,
				clipId: 'f_ocean',
				bone: 'bone114',
				slot: 'slot12',
				fps: 12,
				loop: false,
				direction: 'pingpong',
				alpha: 0.8,
				continuous: true,
			},
		] as RigFlipbookBinding[],
	});
	const [f] = resolveRigBoundContent('R_Wins').flipbooks;
	assert(!!f, 'the clip binding mounts');
	assert(f.clip.fps === 12, 'binding fps folded over the clip');
	assert(f.clip.loop === false, 'binding loop:false folded (?? not ||)');
	assert(f.clip.direction === 'pingpong', 'binding direction folded');
	assert(f.drawSlot === 'slot12' && f.bone === 'bone114', 'slot → drawSlot + bone carried');
	assert(f.alpha === 0.8 && f.continuous === true, 'overrides carried');

	// Both kinds on one rig.
	registerEffects([effectDoc('v_winripple')]);
	registerRigFx({ R_Wins: [{ event: 'event', effectId: 'v_winripple' }] as RigFxBinding[] });
	const both = resolveRigBoundContent('R_Wins');
	assert(
		both.effects.length === 1 && both.flipbooks.length === 1,
		'a rig can carry BOTH an effect and a clip binding',
	);
}

console.log('\n7. REGRESSION — the real R_Wins rig: 10 animations, one effect, one event name');
{
	resetAll();
	registerEffects([effectDoc('v_winripple')]);
	// Verbatim shape of `invisible_wall/test6/spines/R_Wins/R_Wins.irig`: every tier's Intro + Idle
	// carries ONE event, all named `event`, all binding the same effect at the same bone + slot.
	const anims = [
		'Big_Intro',
		'Big_Idle',
		'Super_Intro',
		'Super_Idle',
		'Mega_Intro',
		'Mega_Idle',
		'Epic_Intro',
		'Epic_Idle',
		'Max_Intro',
		'Max_Idle',
	];
	registerRigFx({
		R_Wins: anims.map((animation) => ({
			event: 'event',
			animation,
			time: animation === 'Big_Intro' ? 0.0152 : 0,
			effectId: 'v_winripple',
			bone: 'bone114',
			slot: 'slot12',
			continuous: true,
		})) as RigFxBinding[],
	});
	const bound = resolveRigBoundContent('R_Wins');
	assert(bound.effects.length === 10, 'all ten keyframes become ten bindings');
	const keys = new Set(bound.effects.map((e) => e.key));
	assert(
		keys.size === 10,
		'…with TEN DISTINCT {#each} keys — a collision would silently drop nine tiers',
	);
	assert(
		bound.effects.every((e) => e.continuous === true && e.drawSlot === 'slot12'),
		'every binding keeps its continuous flag and draw slot',
	);
	assert(
		bound.effects.filter((e) => e.animation === 'Big_Intro')[0].time === 0.0152,
		'the one non-zero keyframe time survives (it fires on ITS beat, not at 0)',
	);
}

console.log('\n8. Re-registering is latest-wins and keeps the seam live');
{
	resetAll();
	registerEffects([effectDoc('v_a'), effectDoc('v_b')]);
	registerRigFx({ R_Wins: [{ event: 'e', effectId: 'v_a' }] as RigFxBinding[] });
	assert(resolveRigBoundContent('R_Wins').effects[0].doc.id === 'v_a', 'first registration reads');
	registerRigFx({ R_Wins: [{ event: 'e', effectId: 'v_b' }] as RigFxBinding[] });
	assert(
		resolveRigBoundContent('R_Wins').effects[0].doc.id === 'v_b',
		'a re-bake overrides it — the resolver is not caching a stale answer',
	);
	uninstallRigBoundContent();
	assert(
		resolveRigBoundContent('R_Wins') === EMPTY_RIG_BOUND_CONTENT,
		'uninstall tears the seam back down',
	);
}

console.log(
	failures === 0 ? '\nAll rig-bound-content assertions passed.' : `\n${failures} FAILURE(S).`,
);
process.exit(failures === 0 ? 0 : 1);
