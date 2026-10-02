/**
 * A `winLevel` the active ladder does not have still presents on a tier (`gameConfig.ts`
 * `ladderLevel`). The free-spin outro (`FreeSpinOutroDriver`) and the big win (`WinGate`) mount
 * their count-up only `{#if winLevelData}`, so a level that resolved to no tier held the round on a
 * tap that never armed, with the button inert under the celebration lock. A book stamped from
 * another ladder (the coded ten against a nine-tier authored list) froze the game that way.
 *
 * On the Hold and Win Pots preset's own ladder (nine tiers, no `max`) and on the coded ladder.
 *
 * Run: node --experimental-strip-types packages/engine-game/fixtures/winLadder.fixture.ts
 */

// No `node:assert` — the package has no Node types, and svelte-check reads this file too.
const assert = {
	equal: (actual: unknown, expected: unknown) => {
		if (actual !== expected) throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
	},
	deepEqual: (actual: unknown, expected: unknown) => {
		const a = JSON.stringify(actual);
		const e = JSON.stringify(expected);
		if (a !== e) throw new Error(`expected ${e}, got ${a}`);
	},
};

let passed = 0;
let failed = 0;
const it = (label: string, run: () => void) => {
	try {
		run();
		passed += 1;
		console.log(`  ok  ${label}`);
	} catch (error) {
		failed += 1;
		console.log(`FAIL  ${label}\n        ${(error as Error).message}`);
	}
};

// The package sources import each other without extensions, so the repo's resolve hook goes in
// first. Named through a variable so the type check does not follow it into a Node-typed script.
const LOADER = '../../../scripts/ts-loader.mjs';

const main = async () => {
	await import(LOADER);
	const { createGameConfig } = await import('../src/game/gameConfig.ts');
	const { winLevelMap } = await import('../src/game/winLevelMap.ts');
	const { HOLD_AND_WIN_PRESETS, normalizeGameConfigDoc } = await import('game-config');

	const said: string[] = [];
	const warn = console.warn;
	console.warn = (...args: unknown[]) => said.push(args.join(' '));

	const pots = normalizeGameConfigDoc(HOLD_AND_WIN_PRESETS.pots);
	if (!pots?.winLevels) throw new Error('the Pots preset no longer authors a win ladder');
	const ladder = pots.winLevels;
	const authored = createGameConfig({ bakedConfig: () => pots, compiledConfig: pots });
	const coded = createGameConfig({
		bakedConfig: () => undefined,
		compiledConfig: { ...pots, winLevels: undefined },
	});

	it('the Pots ladder has nine tiers and no `max`, so the coded level 10 is off it', () => {
		assert.equal(ladder.length, 9);
		assert.equal(authored.activeWinLevelData(9)?.alias, 'epic');
	});

	it('a level on the ladder presents exactly its own tier, and says nothing', () => {
		for (const [index, tier] of ladder.entries()) {
			const level = index + 1;
			assert.equal(authored.activeWinLevelData(level)?.alias, tier.alias);
			assert.equal(authored.activeWinLevelIsBig(level), tier.type === 'big');
		}
		assert.deepEqual(said, []);
	});

	it('a level above the top tier presents on the top tier, and is big', () => {
		assert.equal(authored.activeWinLevelData(10)?.alias, 'epic');
		assert.equal(authored.activeWinLevelData(10)?.level, 9);
		assert.equal(authored.activeWinLevelIsBig(10), true);
	});

	it('…and the mismatch is said once, not on every lookup', () => {
		assert.equal(said.filter((line) => line.includes('win level 10 ')).length, 1);
	});

	it('a level below the first tier presents on the first tier', () => {
		assert.equal(authored.activeWinLevelData(0)?.alias, ladder[0].alias);
		assert.equal(authored.activeWinLevelIsBig(0), false);
	});

	it('every whole level from -2 to 15 has a tier, so a count-up always mounts', () => {
		for (let level = -2; level <= 15; level++) {
			assert.equal(authored.activeWinLevelData(level) !== undefined, true);
			assert.equal(coded.activeWinLevelData(level) !== undefined, true);
		}
	});

	it('the big-win gate agrees with the tier shown, on and off the ladder', () => {
		for (let level = -2; level <= 15; level++) {
			assert.equal(
				authored.activeWinLevelIsBig(level),
				authored.activeWinLevelData(level)?.type === 'big',
			);
		}
	});

	it('an escalating ladder escalates a level above its top as the top tier', () => {
		const escalating = { ...pots, escalateTiers: true };
		const config = createGameConfig({ bakedConfig: () => escalating, compiledConfig: escalating });
		const top = config.activeWinLevelChain(9)?.map((tier) => tier.alias);
		assert.equal(Array.isArray(top) && top.length > 0, true);
		assert.deepEqual(
			config.activeWinLevelChain(10)?.map((tier) => tier.alias),
			top,
		);
	});

	it('with no authored ladder, levels 1 to 10 are the coded table, unchanged', () => {
		for (const data of Object.values(winLevelMap)) {
			assert.equal(coded.activeWinLevelData(data.level), data);
			assert.equal(coded.activeWinLevelIsBig(data.level), data.type === 'big');
		}
	});

	it('…and a level off the coded ten presents on its nearest end', () => {
		assert.equal(coded.activeWinLevelData(11)?.alias, 'max');
		assert.equal(coded.activeWinLevelData(0)?.alias, 'zero');
	});

	it('a non-number is not a level, and stays unresolved', () => {
		assert.equal(authored.activeWinLevelData(Number.NaN), undefined);
		assert.equal(authored.activeWinLevelChain(Number.NaN), undefined);
	});

	console.warn = warn;
	console.log(`\n${passed} passed, ${failed} failed`);
	if (failed > 0) throw new Error('win ladder fixture failed');
};

// A rejection fails the run: node exits non-zero on an unhandled one.
void main();
