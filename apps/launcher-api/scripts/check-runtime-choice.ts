/**
 * Which runtime a publish points a game at (`runtimeChoice.ts`, `docs/design/phase-11.md` §2.4):
 *   pnpm --filter launcher-api check:runtime-choice
 *
 * Pins, each because getting it wrong is silent until a player loads the game:
 *  - every family maps to its own id, `slot` to `lines`, and each id's build carries its family;
 *  - a project whose kind and config disagree on the family is refused;
 *  - an id with no release yet falls back to `lines`, so a game is never pointed at nothing;
 *  - the release and rollback workflows offer exactly the ids publish can pick.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compiledFamilies } from '../../../packages/config-vite/families.js';
import { GAME_FAMILIES, GAME_KINDS, familyOfKind } from 'constants-shared/gameKinds';
import { RUNTIMES, RUNTIME_IDS, releaseFamiliesOf } from 'constants-shared/runtimes';
import type { GameConfigDoc } from 'game-config';
import { chooseRuntime, kindFamilyRefusal, runtimeFor } from '../src/lib/server/runtimeChoice';

let failures = 0;
const check = async (name: string, fn: () => void | Promise<void>) => {
	try {
		await fn();
		console.log(`ok   ${name}`);
	} catch (e) {
		failures++;
		console.error(`FAIL ${name}\n     ${(e as Error).message}`);
	}
};

const configOf = (family?: string) => (family ? { family } : {}) as GameConfigDoc;

await check('every family has one runtime; slot (and no config) is lines', () => {
	assert.deepEqual(
		GAME_FAMILIES.map((f) => runtimeFor(configOf(f))),
		['lines', 'match3', 'arcade', 'card'],
	);
	assert.equal(runtimeFor(null), 'lines');
	assert.equal(runtimeFor(configOf()), 'lines');
	assert.deepEqual(new Set(RUNTIMES.map((r) => r.family)), new Set(GAME_FAMILIES));
});

await check("each id's build carries its family and slot, and nothing else", () => {
	for (const { id, family } of RUNTIMES) {
		const built = compiledFamilies(releaseFamiliesOf(id));
		assert.ok(built.includes(family), `${id} is built without ${family}`);
		assert.deepEqual(built, id === 'lines' ? ['slot'] : ['slot', family], id);
	}
	assert.throws(() => releaseFamiliesOf('ways'));
});

await check("a config of another family than the project's kind is refused", () => {
	for (const kind of GAME_KINDS) {
		for (const family of GAME_FAMILIES) {
			const refusal = kindFamilyRefusal(kind, configOf(family));
			assert.equal(refusal === null, familyOfKind(kind) === family, `${kind} + ${family}`);
		}
	}
	assert.equal(kindFamilyRefusal('ways', null), null);
	assert.match(kindFamilyRefusal('lines', configOf('arcade')) ?? '', /arcade runtime/);
	assert.notEqual(kindFamilyRefusal('arcade', null), null);
});

await check('an id with a release is used as it is', async () => {
	const asked: string[] = [];
	const got = await chooseRuntime(configOf('arcade'), async (id) => {
		asked.push(id);
		return { version: `${id}@v1` };
	});
	assert.deepEqual(got, { id: 'arcade', pointer: { version: 'arcade@v1' }, unreleased: false });
	assert.deepEqual(asked, ['arcade']);
});

await check('a family runtime with no release is unreleased, never lines', async () => {
	const got = await chooseRuntime(configOf('card'), async (id) =>
		id === 'lines' ? { version: 'lines@v9' } : null,
	);
	assert.deepEqual(got, { id: 'card', pointer: null, unreleased: true });
});

await check('lines with no pointer stays lines (a fresh bucket publishes as before)', async () => {
	const got = await chooseRuntime(configOf('slot'), async () => null);
	assert.deepEqual(got, { id: 'lines', pointer: null, unreleased: false });
});

const choices = (workflow: string) => {
	const text = readFileSync(
		new URL(`../../../.github/workflows/${workflow}`, import.meta.url),
		'utf8',
	);
	const block = /\n {6}runtime:\n(?: {8}.*\n)*? {8}options: \[([^\]]*)\]/.exec(text);
	assert.ok(block, `${workflow}: no runtime choice`);
	return block[1].split(',').map((s) => s.trim());
};

for (const workflow of ['runtime-release.yml', 'runtime-rollback.yml']) {
	await check(`${workflow} offers exactly the runtime ids`, () => {
		assert.deepEqual(choices(workflow), [...RUNTIME_IDS]);
	});
}

if (failures) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nruntime choice: all checks pass');
