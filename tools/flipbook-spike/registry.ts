/**
 * Invisible Flipbook — headless harness for the runtime clip registry
 * (`engine-layout`'s `registerFlipbooks` / `resolveFlipbook`):
 *
 *   pnpm --filter flipbook-spike run registry
 *
 * Imported by PATH, not through the `engine-layout` barrel: that barrel pulls in Svelte
 * components and pixi, which Node cannot resolve — see
 * [[gotcha_constants_shared_not_node_resolvable]], where exactly this kind of import broke every
 * spike harness while all builds stayed green. The registry module itself is dependency-free by
 * design, so importing it directly keeps this fixture runnable.
 *
 * Proves: registration round-trips, latest-wins matches `registerEffects`, an unknown id resolves
 * to `undefined` (the never-crash contract a dangling `clipId` depends on), and garbage input is
 * survivable.
 */

import {
	clearFlipbooks,
	registerFlipbooks,
	resolveFlipbook,
	type FlipbookClipEntry,
} from '../../packages/engine-layout/src/lib/registerFlipbooks';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};

const SHEET = 'borut/book_of_borut/manifests/atlas_manifest_fx.json';
const clip = (id: string, frames: string[], name = id): FlipbookClipEntry => ({
	id,
	name,
	assetKey: SHEET,
	frames,
});

console.log('flipbook registry — register / resolve');
clearFlipbooks();
registerFlipbooks([clip('boom', ['f1', 'f2', 'f3']), clip('idle', ['i1', 'i2'])]);
assert(resolveFlipbook('boom')?.frames.length === 3, 'a registered clip resolves');
assert(
	resolveFlipbook('boom')?.frames.join(',') === 'f1,f2,f3',
	'the resolved clip keeps its frame ORDER',
);

// The never-crash contract: every consumer renders a static fallback instead of dying.
assert(
	resolveFlipbook('nope') === undefined,
	'an unknown clipId resolves to undefined, not a throw',
);
assert(resolveFlipbook('') === undefined, 'an empty clipId resolves to undefined');

console.log('flipbook registry — latest wins');
registerFlipbooks([clip('boom', ['x'], 'reauthored')]);
assert(resolveFlipbook('boom')?.name === 'reauthored', 'a later registration overrides an id');
assert(
	resolveFlipbook('idle')?.frames.length === 2,
	'an untouched id survives a partial re-register',
);

console.log('flipbook registry — hostile input');
// A malformed baked payload must never take the boot path down with it.
registerFlipbooks(undefined as unknown as FlipbookClipEntry[]);
registerFlipbooks([null as unknown as FlipbookClipEntry, clip('', ['a'])]);
assert(
	resolveFlipbook('boom')?.name === 'reauthored',
	'garbage registration leaves the registry intact',
);
assert(resolveFlipbook('') === undefined, 'a clip with a blank id is refused');

clearFlipbooks();
assert(resolveFlipbook('boom') === undefined, 'clearFlipbooks empties the registry');

console.log('');
if (failures > 0) {
	console.error(`FLIPBOOK REGISTRY: ${failures} FAILURE(S)`);
	process.exit(1);
}
console.log('FLIPBOOK REGISTRY: PASSED');
