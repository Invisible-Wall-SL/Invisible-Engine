/**
 * `/editor`'s generator settings and biomes (`docs/design/salmons-levels.md` §6), the pure half
 * of the Generated level's cards (`generatedLevelParams.ts`, `generatedLevelBiomes.ts`,
 * `generatedLevel.ts` `setGenerator` / `setBiomes`):
 *
 *   pnpm --filter launcher-api check:editor-level-generator
 *
 *  1. Every setting of `levels.generator` is in exactly one card, with a label and help; a value
 *     set to its default, or cleared, is left out, and a group's reset clears it alone.
 *  2. The biomes tick writes the built-in six, which play and draw as no biomes at all; add,
 *     patch, move and remove act on the authored kinds, and removing one drops its stretches.
 *  3. The sequence: laid out from the cycle, a boundary dragged stays between its neighbours, a
 *     stretch splits and drops, a scope's own sequence is kept apart from every level's.
 *  4. The strip's colours: the grass as tinted, and a name's ink readable on its floor.
 */
import assert from 'node:assert/strict';

import {
	ONLINE_GENERATORS,
	SALMONS_BIOMES,
	generatorParams,
	resolveBiomes,
} from 'engine-mechanics';
import { LEVELS_GENERATOR_DEFAULTS, normalizeShapedLevels } from 'game-config';

import { setBiomes, setGenerator } from '../src/lib/editor/generatedLevel';
import {
	addBiome,
	biomesOf,
	builtInBiomes,
	dropStretch,
	grassOf,
	inkOn,
	moveBiome,
	moveStart,
	patchBiome,
	removeBiome,
	sequenceFrom,
	setSequence,
	splitStretch,
} from '../src/lib/editor/generatedLevelBiomes';
import {
	LEVEL_PARAM_GROUPS,
	heldParam,
	paramValue,
	withParam,
	withoutGroup,
} from '../src/lib/editor/generatedLevelParams';

let passed = 0;
const check = (name: string, fn: () => void) => {
	fn();
	passed++;
	console.log(`  ok  ${name}`);
};

check('every generator setting is in one card, with a label and help', () => {
	const keys = LEVEL_PARAM_GROUPS.flatMap((g) => g.params.map((p) => p.key));
	assert.deepEqual([...keys].sort(), Object.keys(LEVELS_GENERATOR_DEFAULTS).sort());
	assert.equal(new Set(keys).size, keys.length, 'no setting twice');
	for (const g of LEVEL_PARAM_GROUPS) {
		assert.ok(g.title && g.info, g.id);
		for (const p of g.params) assert.ok(p.label && p.help && p.step > 0, p.key);
	}
	assert.deepEqual(
		LEVEL_PARAM_GROUPS.map((g) => g.title),
		[
			'River shape',
			'Course',
			'Waterfalls',
			'Rocks and whirlpools',
			'Bridges',
			'Sea and delta',
			'Spawns',
		],
	);
});

check('a setting at its default or cleared is left out; a group resets alone', () => {
	let g = withParam(undefined, 'riverLength', 300);
	g = withParam(g, 'bridgeCount', 1);
	assert.deepEqual(g, { riverLength: 300, bridgeCount: 1 });
	assert.deepEqual(withParam(g, 'riverLength', LEVELS_GENERATOR_DEFAULTS.riverLength), {
		bridgeCount: 1,
	});
	assert.deepEqual(withParam(g, 'riverLength', undefined), { bridgeCount: 1 });
	assert.equal(heldParam('riverLength', 9999), 800);
	assert.equal(heldParam('riverLength', 300.4), 300, 'whole');
	assert.equal(paramValue(g, 'riverLength'), 300);
	assert.equal(paramValue(undefined, 'rockSize'), 1.5);
	const river = LEVEL_PARAM_GROUPS.find((x) => x.id === 'level-river');
	assert.ok(river);
	assert.deepEqual(withoutGroup(g, river), { bridgeCount: 1 });
	assert.deepEqual(setGenerator({ seeds: [3] }, {}), { seeds: [3] }, 'an empty block is dropped');
	assert.deepEqual(setGenerator({}, g).generator, g);
	assert.deepEqual(generatorParams(setGenerator({}, g).generator), {
		...LEVELS_GENERATOR_DEFAULTS,
		...g,
	});
});

check('the biomes tick: the built-in six, played and drawn as none', () => {
	const on = builtInBiomes();
	assert.deepEqual(
		on.kinds?.map((k) => k.id),
		SALMONS_BIOMES.map((b) => b.id),
	);
	assert.deepEqual(resolveBiomes(on, 1), resolveBiomes({}, 1));
	const levels = setBiomes({ seeds: [1] }, on);
	assert.deepEqual(normalizeShapedLevels(levels)?.biomes, on, 'kept through the save’s read');
	assert.deepEqual(setBiomes(levels, undefined), { seeds: [1] });
	const made = ONLINE_GENERATORS.salmonsMap.make(1, levels) as { biomes?: unknown };
	assert.deepEqual(made.biomes, biomesOf(on, 1), 'the level carries what the card shows');
});

check('add, patch, move and remove act on the authored kinds', () => {
	const added = addBiome(builtInBiomes());
	assert.equal(added.id, 'biome7');
	assert.equal(added.biomes.kinds?.at(-1)?.name, 'Biome 7');
	const patched = patchBiome(added.biomes, 'biome7', { rocks: 2, forestFloor: '#112233' });
	const kind = biomesOf(patched, 1).kinds.find((k) => k.id === 'biome7');
	assert.equal(kind?.rocks, 2);
	assert.equal(kind?.forestFloor, '#112233');
	assert.deepEqual(kind?.trees, [0, 1, 2, 3, 4, 5], 'a new kind grows all six trees');
	const back = patchBiome(patched, 'biome7', { rocks: undefined });
	assert.equal(
		back.kinds?.find((k) => k.id === 'biome7')?.rocks,
		undefined,
		'unset: its default plays',
	);
	const moved = moveBiome(patched, 'biome7', -1);
	assert.deepEqual(
		moved.kinds?.slice(-2).map((k) => k.id),
		['biome7', 'forest6'],
	);
	assert.equal(moveBiome(patched, 'forest1', -1), patched, 'the first goes no higher');
	const laid = setSequence(patched, '*', [
		{ from: 0, biome: 'forest1' },
		{ from: 100, biome: 'biome7' },
	]);
	const removed = removeBiome(laid, 'biome7');
	assert.deepEqual(removed.sequences, { '*': [{ from: 0, biome: 'forest1' }] });
	assert.ok(!removed.kinds?.some((k) => k.id === 'biome7'));
	const one = { kinds: [{ id: 'only' }] };
	assert.equal(removeBiome(one, 'only'), one, 'the last kind stays');
});

check('the sequence: laid from the cycle, dragged between neighbours, split and dropped', () => {
	const on = builtInBiomes();
	const laid = sequenceFrom(on, 1, 400);
	assert.equal(laid.length, Math.ceil(400 / 35));
	assert.deepEqual(laid[1], { from: 35, biome: 'forest2' });
	assert.deepEqual(laid[6], { from: 210, biome: 'forest1' });
	const scoped = setSequence(on, '*', laid);
	assert.deepEqual(resolveBiomes(scoped, 1)?.sequence, laid, 'the same stretches as the cycle');
	assert.equal(moveStart(laid, 1, -50, 400)[1].from, 1, 'a column past the one before');
	assert.equal(moveStart(laid, 1, 900, 400)[1].from, 69, 'short of the one after');
	assert.equal(moveStart(laid, 0, 30, 400), laid, 'the first starts at the source');
	assert.equal(moveStart(laid, 2, 88.6, 400)[2].from, 89);
	const split = splitStretch(laid, 0, 400);
	assert.deepEqual(split.slice(0, 3), [
		{ from: 0, biome: 'forest1' },
		{ from: 18, biome: 'forest1' },
		{ from: 35, biome: 'forest2' },
	]);
	const dropped = dropStretch(laid, 0);
	assert.equal(dropped[0].from, 0, 'the next takes the source');
	assert.equal(dropped.length, laid.length - 1);
	const own = setSequence(scoped, '12', [{ from: 0, biome: 'forest3' }]);
	assert.equal(biomesOf(own, 12).sequence?.[0].biome, 'forest3');
	assert.deepEqual(biomesOf(own, 13).sequence, laid, 'another seed plays every level’s');
	assert.equal(setSequence(own, '12', undefined).sequences?.['12'], undefined);
	assert.equal(setSequence(setSequence(own, '12', []), '*', undefined).sequences, undefined);
});

check('the strip’s colours: the grass as tinted, a name readable on its floor', () => {
	const [first] = biomesOf(undefined, 1).kinds;
	assert.equal(grassOf(first), '#5d8c35', 'white: the art’s own green');
	assert.equal(grassOf({ ...first, grassTint: '#000000' }), '#000000');
	assert.equal(grassOf({ ...first, grassTint: '#ff8080' }), '#5d461b');
	assert.equal(inkOn('#28591e'), '#ffffff', 'white on the original’s dark floor');
	assert.equal(inkOn('#f0e8c0'), '#111318', 'near-black on a pale one');
});

console.log(`check:editor-level-generator — ${passed} checks passed`);
