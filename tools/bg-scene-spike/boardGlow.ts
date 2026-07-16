/**
 * Free-spin BOARD-GLOW ownership harness for the PURE selection + suppression logic
 * (`engine-layout/backgroundScenes`). The live WebGL pixels (the pink reelhouse spine behind the
 * reels) aren't browser-verifiable here, so — exactly as the sibling `select.ts` does — we cover the
 * contract OFFLINE, in Node:
 *
 *   pnpm --filter bg-scene-spike run boardglow
 *
 * The gate mirrors `hasAuthoredBackground` / `hasAuthoredBookReveal`: the `boardGlow` scene ships
 * ONLY the coded `BoardFrame` bind anchor, so a stock game keeps its coded glow; real art in that
 * scene flips ownership to the author. The load-bearing subtlety is (3): counting the anchor itself
 * as "authored content" would suppress the very spine the anchor exists to position — the glow would
 * vanish from every game the moment this shipped. That's the assertion worth having.
 *
 * Proves:
 *   1. `defaultLayout('lines')` ships a `boardGlow` scene, and it is found by `boardGlowScene`.
 *   2. PARITY — that stock scene is anchor-only ⇒ `hasAuthoredBoardGlow` is FALSE ⇒ the coded
 *      `<BoardFrame>` renders unchanged, exactly as before this feature existed.
 *   3. THE TRAP — an anchor-only scene must NOT suppress (see above).
 *   4. Real authored art (a spine node beside the anchor) ⇒ TRUE ⇒ coded glow suppressed.
 *   5. A doc with NO `boardGlow` scene at all ⇒ FALSE + `undefined` scene ⇒ nothing mounts, coded
 *      glow renders (parity for un-migrated docs and for other templates).
 *   6. The `boardGlowShow` / `boardGlowHide` signals are in `ENGINE_SIGNAL_CATALOG`, so an authored
 *      spine can actually bind a cue to them (without this the enter/exit is unauthorable).
 */

import { readFileSync } from 'node:fs';

// Import the source modules directly (not the `engine-layout` barrel) — see `select.ts` for why.
import {
	boardGlowScene,
	hasAuthoredBoardGlow,
} from '../../packages/engine-layout/src/lib/backgroundScenes';
import { extraMountScenes } from '../../packages/engine-layout/src/lib/genericMountScenes';
import type { LayoutDoc, Scene } from '../../packages/engine-layout/src/lib/types';
import { defaultLayout } from '../../packages/engine-layout/src/lib/referenceLayouts/lines';
import { ENGINE_SIGNAL_CATALOG } from '../../packages/engine-layout/src/lib/componentCatalog';

/**
 * The REAL `RESERVED_SCENE_IDS` from `Game.svelte`, scraped from source. A hand-mirrored copy here
 * would assert against itself and pass forever while the game drifted — the point is to fail when
 * someone removes the id from the game. `Game.svelte` can't be imported (Svelte + runes; tsx can't
 * compile it), so parsing the literal is the honest option.
 */
const RESERVED_SCENE_IDS_FROM_GAME: string[] = (() => {
	const src = readFileSync(
		new URL('../../apps/lines/src/components/Game.svelte', import.meta.url),
		'utf8',
	);
	const block = /const RESERVED_SCENE_IDS = \[([\s\S]*?)\] as const;/.exec(src);
	if (!block)
		throw new Error('could not find RESERVED_SCENE_IDS in Game.svelte — update this regex');
	return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
})();

let failures = 0;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failures += 1;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

/** The stock doc every un-authored `apps/lines` game boots with. */
const stock: LayoutDoc = defaultLayout('lines');

/** The same scene with the author's own glow art dropped in beside the anchor. */
const authoredScene = (base: Scene): Scene => ({
	...base,
	nodes: [
		...base.nodes,
		{
			id: 'my-glow',
			kind: 'spine',
			assetKey: 'my_custom_glow',
			x: 0,
			y: 0,
			cues: [
				{ signal: 'boardGlowShow', animation: 'glow_in' },
				{ signal: 'boardGlowHide', animation: 'glow_out' },
			],
		} as Scene['nodes'][number],
	],
});

const withScene = (doc: LayoutDoc, scene: Scene): LayoutDoc => ({
	...doc,
	scenes: doc.scenes.map((s) => (s.id === scene.id ? scene : s)),
});

console.log('Free-spin board-glow ownership harness\n');

// --- 1. the scene ships + is selectable ---
console.log('1. the `boardGlow` scene ships in the reference layout:');
const stockScene = boardGlowScene(stock.scenes);
assert(
	"`defaultLayout('lines')` ships a `boardGlow` scene",
	stockScene !== undefined,
	stock.scenes.map((s) => s.id).join(','),
);
assert(
	'it carries the coded `BoardFrame` bind anchor',
	stockScene?.nodes.some((n) => n.bind?.component === 'BoardFrame') === true,
	JSON.stringify(stockScene?.nodes.map((n) => n.id)),
);

// --- 2 + 3. PARITY: anchor-only must NOT suppress ---
console.log('\n2. PARITY — the stock anchor-only scene keeps the coded glow:');
assert(
	'`hasAuthoredBoardGlow` is FALSE for the stock doc (coded `<BoardFrame>` renders)',
	hasAuthoredBoardGlow(stock.scenes) === false,
);
assert(
	'THE TRAP — the bind anchor alone never counts as authored content',
	stockScene !== undefined && stockScene.nodes.length > 0 && !hasAuthoredBoardGlow(stock.scenes),
	'an anchor-only scene suppressing would delete the glow from every stock game',
);

// --- 4. real art flips ownership ---
console.log('\n3. authored art takes ownership:');
{
	const doc = withScene(stock, authoredScene(stockScene!));
	assert(
		'`hasAuthoredBoardGlow` is TRUE once real art sits beside the anchor',
		hasAuthoredBoardGlow(doc.scenes),
	);
	assert(
		'the authored scene is still selectable for mounting',
		boardGlowScene(doc.scenes) !== undefined,
	);
}

// --- 5. no scene at all ---
console.log('\n4. a doc with no `boardGlow` scene is inert:');
{
	const doc: LayoutDoc = { ...stock, scenes: stock.scenes.filter((s) => s.id !== 'boardGlow') };
	assert(
		'`boardGlowScene` is undefined ⇒ nothing mounts',
		boardGlowScene(doc.scenes) === undefined,
	);
	assert(
		'`hasAuthoredBoardGlow` is FALSE ⇒ coded glow renders',
		hasAuthoredBoardGlow(doc.scenes) === false,
	);
}

// --- 6. THE DOUBLE-MOUNT TRAP ---
// `boardGlow` is mounted by its own below-reel path, so it MUST be reserved against the generic
// overlay mounter. Un-reserved, `extraMountScenes` would mount it a SECOND time above the board —
// and because the stock scene carries the coded `BoardFrame` anchor, an un-authored game would
// render the coded glow twice, the second copy on top of the reels. Pinned here because the failure
// is invisible in `Game.svelte` (a scene id absent from a list) and breaks PARITY for every game.
console.log('\n5. the scene is reserved against the generic overlay mounter:');
{
	const reserved = new Set(RESERVED_SCENE_IDS_FROM_GAME);
	assert(
		"`boardGlow` is in the game's reserved scene ids",
		reserved.has('boardGlow'),
		[...reserved].join(','),
	);
	const extras = extraMountScenes(stock.scenes, reserved);
	assert(
		'`extraMountScenes` does NOT return it (no double-mount above the board)',
		!extras.some((s) => s.id === 'boardGlow'),
		extras.map((s) => s.id).join(',') || '(none)',
	);
}

// --- 7. the cue signals are bindable in the editor ---
console.log('\n6. the glow signals are authorable as spine cues:');
for (const key of ['boardGlowShow', 'boardGlowHide']) {
	assert(
		`ENGINE_SIGNAL_CATALOG offers \`${key}\``,
		ENGINE_SIGNAL_CATALOG.some((s) => s.key === key),
		ENGINE_SIGNAL_CATALOG.map((s) => s.key).join(','),
	);
}

console.log(
	failures ? `\nBOARD-GLOW HARNESS: FAILED (${failures})` : '\nBOARD-GLOW HARNESS: PASSED',
);
process.exit(failures ? 1 : 0);
