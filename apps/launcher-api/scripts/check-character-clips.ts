/**
 * An arcade character's clips (Salmons' S0 art, `engine-layout` `characterClips.ts`) ship and
 * save:
 *
 *  1. reachability (rule 8): a component's `characterClips` names its clips by PREFIX only, and
 *     `clipReachability` counts every project clip under such a prefix as played, so both the clip
 *     export and the art export (which gates the clips' atlas pages on the same set) ship them; a
 *     clip of another prefix, or one that merely starts with a prefix's letters, is not;
 *  2. the save keeps it: `normalizeComponent` (the load and the save path) keeps the Salmons
 *     characters' `characterClips` as written, drops a malformed one, and the unknown-field graft
 *     treats it as a known field (a field it did not know would be put back from the stored copy,
 *     so an author's edit of it would never save);
 *  3. the Salmons export writes it into the three characters' components.
 *
 * Run: pnpm --filter launcher-api check:character-clips
 */
import type { ComponentDef } from 'engine-layout';

const { SALMONS_CHARACTER_CLIPS, SALMONS_CHARACTER_COMPONENTS } =
	await import('../../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts');
const { clipIdsOfPrefixes, collectClipIds, collectClipPrefixes } =
	await import('../src/lib/server/clipReachability.ts');
const { normalizeComponent } = await import('../src/lib/server/componentStorage.ts');
const { COMPONENT_DEF_FIELDS } = await import('../src/lib/server/componentFields.ts');

let failures = 0;
let passes = 0;
function eq(name: string, actual: unknown, expected: unknown): void {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		passes += 1;
		return;
	}
	failures += 1;
	console.error(`✗ ${name}\n    expected ${e}\n    actual   ${a}`);
}

const defs: readonly ComponentDef[] = SALMONS_CHARACTER_COMPONENTS;
const byId = Object.fromEntries(defs.map((def) => [def.id, def]));

// 1. Reachability.
const prefixes = new Set<string>();
collectClipPrefixes(byId, prefixes);
eq('the Salmons characters name their clip prefixes', [...prefixes].sort(), [
	'bear',
	'fisherman',
	'salmon_golden',
	'salmon_pink',
]);
const project = [
	'salmon_pink_swim_se',
	'salmon_pink_hop_ne',
	'salmon_golden_swim_se',
	'bear_swipe_se',
	'fisherman_reel_ne',
	'bearded_idle_se',
	'salmon_blue_swim_se',
	'f_ocean',
];
eq(
	'every project clip under a named prefix is played, and no other',
	clipIdsOfPrefixes(prefixes, project).sort(),
	[
		'bear_swipe_se',
		'fisherman_reel_ne',
		'salmon_golden_swim_se',
		'salmon_pink_hop_ne',
		'salmon_pink_swim_se',
	],
);
eq('no prefix names no clip', clipIdsOfPrefixes([], project), []);
const ids = new Set<string>();
collectClipIds(byId, ids);
eq('a prefix is not read as a clip id (`collectClipIds` is unchanged)', [...ids], []);
const nested = new Set<string>();
collectClipPrefixes(
	{ scenes: [{ nodes: [{ characterClips: { prefixes: { base: 'x' } } }] }] },
	nested,
);
collectClipPrefixes({ characterClips: null, other: { characterClips: { prefixes: 7 } } }, nested);
eq('a prefix is found however deep, a malformed one is skipped', [...nested], ['x']);

// 2. The save keeps it.
for (const def of defs) {
	if (!def.characterClips) continue;
	const saved = normalizeComponent(structuredClone(def));
	eq(`${def.id}: the save keeps its characterClips`, saved.characterClips, def.characterClips);
	eq(
		`${def.id}: saving the saved def again changes nothing`,
		normalizeComponent(structuredClone(saved)),
		saved,
	);
}
const salmon = byId.salmonsSalmon;
eq(
	'the salmon keeps its clips (pink, golden, one-shots on jumped / climbed / caught)',
	normalizeComponent(structuredClone(salmon)).characterClips,
	SALMONS_CHARACTER_CLIPS.salmon,
);
const malformed = (characterClips: unknown) =>
	normalizeComponent({ ...structuredClone(salmon), characterClips } as ComponentDef).characterClips;
eq(
	'no base prefix: dropped',
	malformed({ prefixes: {}, displayWidth: 90, idle: 'swim' }),
	undefined,
);
eq('no width: dropped', malformed({ prefixes: { base: 'a' }, idle: 'swim' }), undefined);
eq('no idle: dropped', malformed({ prefixes: { base: 'a' }, displayWidth: 9 }), undefined);
eq(
	'unknown events and blank states are dropped, the rest kept',
	malformed({
		prefixes: { base: 'a', marked: '' },
		displayWidth: 9,
		anchorY: 0.9,
		idle: 'idle',
		walk: '',
		on: { ability: 'swipe', teleported: 'poof', caught: '' },
	}),
	{
		prefixes: { base: 'a' },
		displayWidth: 9,
		idle: 'idle',
		anchorY: 0.9,
		on: { ability: 'swipe' },
	},
);
eq('the unknown-field graft knows the field', COMPONENT_DEF_FIELDS.has('characterClips'), true);

// 3. The export writes it (the components it writes are these defs).
eq(
	'the three characters carry their clips; the swipe, cast and splash do not',
	defs.filter((def) => def.characterClips).map((def) => def.id),
	['salmonsSalmon', 'salmonsBear', 'salmonsFisherman'],
);

console.log(
	`\n${failures === 0 ? '✅' : '❌'} character clips: ${passes} passed, ${failures} failed`,
);
process.exit(failures ? 1 : 0);
