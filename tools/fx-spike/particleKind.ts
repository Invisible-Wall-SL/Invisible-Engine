/**
 * Invisible FX — Tier C `/fx` particle-KIND mutators headless harness (the UI logic behind the
 * inspector's "Particle" section: the Sprite↔rig toggle + the skeleton/animation/loop pickers).
 * The live WebGL pixels are authed-page-only, so — as the sibling tools do — the PURE editing
 * logic + its save→reopen survival are pinned OFFLINE:
 *
 *   pnpm --filter fx-spike run particle-kind
 *
 * Proves:
 *  1. `setParticleKind` is pure/immutable, flips ONLY `particleKind` (never `config`/`art`/
 *     `placement`/`trigger`), and is NON-DESTRUCTIVE: a sprite↔rig toggle preserves the atlas
 *     `art` AND a drafted `spineParticle` block (the runtime + normalize ignore the dormant one).
 *  2. The `setRigParticle*` setters force `particleKind:'spine'`, edit ONLY `spineParticle`
 *     (never `config`), are immutable, and keep the other spineParticle fields.
 *  3. `rigParticleReady` gates a fully-bound rig layer (skeleton AND clip).
 *  4. The kind discipline holds through `normalizeEffectDoc` (the save→reopen gatekeeper): a true
 *     rig layer's spineParticle round-trips; a sprite layer's dormant spineParticle is DROPPED.
 */

import { normalizeEffectDoc, type EffectDoc, type EmitterLayer } from 'engine-fx';
import {
	newLayer,
	setParticleKind,
	setRigParticleAnimation,
	setRigParticleLoop,
	setRigParticleSkeleton,
	rigParticleReady,
} from '../../apps/launcher-api/src/routes/(app)/fx/fxModel.client';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const SKEL = 'borut/bookofborut/editor-art/spines/coin';

// ---------------------------------------------------------------------------
// 1. setParticleKind — pure, immutable, flips ONLY particleKind, non-destructive.
// ---------------------------------------------------------------------------
console.log('fx particle-kind — setParticleKind');
const base = newLayer('layer-1');
const baseSnapshot = JSON.stringify(base);

assert(base.particleKind === 'sprite', 'a new layer is `sprite` by default');

const toRig = setParticleKind(base, 'spine');
assert(JSON.stringify(base) === baseSnapshot, 'setParticleKind does not mutate its input');
assert(toRig.particleKind === 'spine', 'switching to rig sets particleKind=rig');
assert(eq(toRig.config, base.config), 'setParticleKind leaves `config` byte-identical');
assert(eq(toRig.art, base.art), 'setParticleKind leaves `art` byte-identical');
assert(eq(toRig.placement, base.placement), 'setParticleKind leaves `placement` byte-identical');
assert(
	setParticleKind(base, 'sprite') === base,
	'setParticleKind to the SAME kind returns the same layer (no-op)',
);

// Build a sprite layer with REAL atlas art, draft a rig binding, then toggle back and forth —
// both the atlas art AND the rig draft must survive (non-destructive).
const spriteWithArt: EmitterLayer = {
	...base,
	art: { assetKey: 'atlas/fx.json', frames: ['s1', 's2'], animated: true },
};
const drafted = setRigParticleAnimation(setRigParticleSkeleton(spriteWithArt, SKEL), 'spin');
assert(drafted.particleKind === 'spine', 'authoring a spineParticle forces rig kind');
const backToSprite = setParticleKind(drafted, 'sprite');
assert(
	eq(backToSprite.art, spriteWithArt.art),
	'toggling rig→sprite preserves the atlas art (the sprite path is byte-identical again)',
);
assert(
	eq(backToSprite.spineParticle, drafted.spineParticle),
	'toggling rig→sprite KEEPS the drafted spineParticle (dormant; runtime/normalize ignore it)',
);
const backToRig = setParticleKind(backToSprite, 'spine');
assert(
	eq(backToRig.spineParticle, drafted.spineParticle),
	'toggling sprite→rig restores the same spineParticle (non-destructive round-trip)',
);

// ---------------------------------------------------------------------------
// 2. setRigParticle* — force rig, edit ONLY spineParticle, immutable, keep siblings.
// ---------------------------------------------------------------------------
console.log('fx particle-kind — spineParticle setters');

const skel = setRigParticleSkeleton(base, SKEL);
assert(JSON.stringify(base) === baseSnapshot, 'setRigParticleSkeleton does not mutate its input');
assert(skel.particleKind === 'spine', 'setRigParticleSkeleton forces rig kind');
assert(skel.spineParticle?.skeletonKey === SKEL, 'the skeletonKey is set');
assert(skel.spineParticle?.animation === '', 'animation defaults empty until picked');
assert(eq(skel.config, base.config), 'setRigParticleSkeleton leaves `config` byte-identical');

const anim = setRigParticleAnimation(skel, 'spin');
assert(anim.spineParticle?.animation === 'spin', 'the animation is set');
assert(anim.spineParticle?.skeletonKey === SKEL, 'setting animation keeps the skeletonKey');
assert(skel.spineParticle?.animation === '', 'animation edit does not mutate the prior layer');

const looped = setRigParticleLoop(anim, true);
assert(looped.spineParticle?.loop === true, 'the loop flag is set');
assert(
	looped.spineParticle?.skeletonKey === SKEL && looped.spineParticle?.animation === 'spin',
	'setting loop keeps skeletonKey + animation',
);

// An empty skeleton/animation clears just that field (the fail-safe — never throws).
const clearedSkel = setRigParticleSkeleton(looped, '   ');
assert(clearedSkel.spineParticle?.skeletonKey === '', 'a blank skeletonKey clears the binding');
assert(clearedSkel.spineParticle?.animation === 'spin', 'clearing the skeleton keeps the clip');

// ---------------------------------------------------------------------------
// 3. rigParticleReady — fully bound (skeleton AND clip).
// ---------------------------------------------------------------------------
console.log('fx particle-kind — rigParticleReady gate');
assert(!rigParticleReady(base), 'a sprite layer is never rig-ready');
assert(!rigParticleReady(skel), 'a rig layer with a skeleton but no clip is NOT ready');
assert(!rigParticleReady(anim) === false, 'a rig layer with skeleton + clip IS ready');
assert(
	!rigParticleReady(setRigParticleSkeleton(anim, '')),
	'clearing the skeleton makes it not-ready again',
);

// ---------------------------------------------------------------------------
// 4. Kind discipline survives normalizeEffectDoc (the save→reopen gatekeeper).
// ---------------------------------------------------------------------------
console.log('fx particle-kind — normalize round-trip (kind discipline)');

const config = base.config;
const doc: EffectDoc = {
	version: 1,
	id: 'coin_burst',
	name: 'Coin Burst',
	layers: [
		// A true rig layer (skeleton + clip) — its spineParticle MUST survive.
		{
			key: 'coins',
			config,
			art: { assetKey: '', frames: [] },
			placement: { space: 'free' },
			particleKind: 'spine',
			spineParticle: { skeletonKey: SKEL, animation: 'spin', loop: true },
		},
		// A sprite layer carrying a DORMANT spineParticle draft — normalize MUST drop it.
		{
			key: 'sparks',
			config,
			art: { assetKey: 'atlas/fx.json', frames: ['s1'] },
			placement: { space: 'free' },
			particleKind: 'sprite',
			spineParticle: { skeletonKey: SKEL, animation: 'spin' },
		},
	],
};

const normalized = normalizeEffectDoc(JSON.parse(JSON.stringify(doc)), 'coin_burst');
assert(
	eq(normalized.layers[0].spineParticle, { skeletonKey: SKEL, animation: 'spin', loop: true }),
	'a true rig layer keeps its spineParticle through normalize',
);
assert(
	!('spineParticle' in (normalized.layers[1] as unknown as Record<string, unknown>)),
	'a sprite layer DROPS its dormant spineParticle through normalize (kind discipline)',
);
assert(
	normalized.layers[1].particleKind === 'sprite' && eq(normalized.layers[1].config, config),
	'the sprite layer stays sprite with a byte-identical config (verbatim contract)',
);
// Idempotent + a fixed point.
const twice = normalizeEffectDoc(JSON.parse(JSON.stringify(normalized)), 'coin_burst');
assert(eq(twice, normalized), 'normalizeEffectDoc is a fixed point for a Tier-C doc (idempotent)');

console.log('');
if (failures === 0) {
	console.log('FX PARTICLE-KIND: PASSED');
} else {
	console.error(`FX PARTICLE-KIND: ${failures} FAILURE(S)`);
	process.exit(1);
}
