/**
 * Invisible FX — Tier C `/fx` particle-KIND mutators headless harness (the UI logic behind the
 * inspector's "Particle" section: the Sprite↔Spine toggle + the skeleton/animation/loop pickers).
 * The live WebGL pixels are authed-page-only, so — as the sibling tools do — the PURE editing
 * logic + its save→reopen survival are pinned OFFLINE:
 *
 *   pnpm --filter fx-spike run particle-kind
 *
 * Proves:
 *  1. `setParticleKind` is pure/immutable, flips ONLY `particleKind` (never `config`/`art`/
 *     `placement`/`trigger`), and is NON-DESTRUCTIVE: a sprite↔spine toggle preserves the atlas
 *     `art` AND a drafted `spineParticle` block (the runtime + normalize ignore the dormant one).
 *  2. The `setSpineParticle*` setters force `particleKind:'spine'`, edit ONLY `spineParticle`
 *     (never `config`), are immutable, and keep the other spineParticle fields.
 *  3. `spineParticleReady` gates a fully-bound spine layer (skeleton AND clip).
 *  4. The kind discipline holds through `normalizeEffectDoc` (the save→reopen gatekeeper): a true
 *     spine layer's spineParticle round-trips; a sprite layer's dormant spineParticle is DROPPED.
 */

import { normalizeEffectDoc, type EffectDoc, type EmitterLayer } from 'engine-fx';
import {
	newLayer,
	setParticleKind,
	setSpineParticleAnimation,
	setSpineParticleLoop,
	setSpineParticleSkeleton,
	spineParticleReady,
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

const toSpine = setParticleKind(base, 'spine');
assert(JSON.stringify(base) === baseSnapshot, 'setParticleKind does not mutate its input');
assert(toSpine.particleKind === 'spine', 'switching to spine sets particleKind=spine');
assert(eq(toSpine.config, base.config), 'setParticleKind leaves `config` byte-identical');
assert(eq(toSpine.art, base.art), 'setParticleKind leaves `art` byte-identical');
assert(eq(toSpine.placement, base.placement), 'setParticleKind leaves `placement` byte-identical');
assert(
	setParticleKind(base, 'sprite') === base,
	'setParticleKind to the SAME kind returns the same layer (no-op)',
);

// Build a sprite layer with REAL atlas art, draft a spine binding, then toggle back and forth —
// both the atlas art AND the spine draft must survive (non-destructive).
const spriteWithArt: EmitterLayer = {
	...base,
	art: { assetKey: 'atlas/fx.json', frames: ['s1', 's2'], animated: true },
};
const drafted = setSpineParticleAnimation(setSpineParticleSkeleton(spriteWithArt, SKEL), 'spin');
assert(drafted.particleKind === 'spine', 'authoring a spineParticle forces spine kind');
const backToSprite = setParticleKind(drafted, 'sprite');
assert(
	eq(backToSprite.art, spriteWithArt.art),
	'toggling spine→sprite preserves the atlas art (the sprite path is byte-identical again)',
);
assert(
	eq(backToSprite.spineParticle, drafted.spineParticle),
	'toggling spine→sprite KEEPS the drafted spineParticle (dormant; runtime/normalize ignore it)',
);
const backToSpine = setParticleKind(backToSprite, 'spine');
assert(
	eq(backToSpine.spineParticle, drafted.spineParticle),
	'toggling sprite→spine restores the same spineParticle (non-destructive round-trip)',
);

// ---------------------------------------------------------------------------
// 2. setSpineParticle* — force spine, edit ONLY spineParticle, immutable, keep siblings.
// ---------------------------------------------------------------------------
console.log('fx particle-kind — spineParticle setters');

const skel = setSpineParticleSkeleton(base, SKEL);
assert(JSON.stringify(base) === baseSnapshot, 'setSpineParticleSkeleton does not mutate its input');
assert(skel.particleKind === 'spine', 'setSpineParticleSkeleton forces spine kind');
assert(skel.spineParticle?.skeletonKey === SKEL, 'the skeletonKey is set');
assert(skel.spineParticle?.animation === '', 'animation defaults empty until picked');
assert(eq(skel.config, base.config), 'setSpineParticleSkeleton leaves `config` byte-identical');

const anim = setSpineParticleAnimation(skel, 'spin');
assert(anim.spineParticle?.animation === 'spin', 'the animation is set');
assert(anim.spineParticle?.skeletonKey === SKEL, 'setting animation keeps the skeletonKey');
assert(skel.spineParticle?.animation === '', 'animation edit does not mutate the prior layer');

const looped = setSpineParticleLoop(anim, true);
assert(looped.spineParticle?.loop === true, 'the loop flag is set');
assert(
	looped.spineParticle?.skeletonKey === SKEL && looped.spineParticle?.animation === 'spin',
	'setting loop keeps skeletonKey + animation',
);

// An empty skeleton/animation clears just that field (the fail-safe — never throws).
const clearedSkel = setSpineParticleSkeleton(looped, '   ');
assert(clearedSkel.spineParticle?.skeletonKey === '', 'a blank skeletonKey clears the binding');
assert(clearedSkel.spineParticle?.animation === 'spin', 'clearing the skeleton keeps the clip');

// ---------------------------------------------------------------------------
// 3. spineParticleReady — fully bound (skeleton AND clip).
// ---------------------------------------------------------------------------
console.log('fx particle-kind — spineParticleReady gate');
assert(!spineParticleReady(base), 'a sprite layer is never spine-ready');
assert(!spineParticleReady(skel), 'a spine layer with a skeleton but no clip is NOT ready');
assert(!spineParticleReady(anim) === false, 'a spine layer with skeleton + clip IS ready');
assert(
	!spineParticleReady(setSpineParticleSkeleton(anim, '')),
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
		// A true spine layer (skeleton + clip) — its spineParticle MUST survive.
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
	'a true spine layer keeps its spineParticle through normalize',
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
