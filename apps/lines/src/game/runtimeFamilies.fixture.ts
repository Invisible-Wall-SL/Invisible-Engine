/**
 * Offline fixture for the BOOT'S FAMILY CHECK (`runtimeFamilies.ts`, `docs/design/phase-11.md`
 * §2.2, P11.1a).
 *
 *   pnpm check:all --only runtimeFamilies
 *
 * TWO claims:
 *
 *  1. A config whose family the bundle was built without is refused, with the boot-failure
 *     screen's message; a slot config never is (every runtime carries the reel stack).
 *  2. Unbuilt (no `__IE_FAMILIES__`: Storybook, these fixtures) carries every family.
 */
import { CONFIG_FAMILIES } from 'game-config';

import { compiledFamilies, familyRefusal } from './runtimeFamilies';

const failures: string[] = [];
const check = (name: string, got: unknown, want: unknown) => {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}`}`);
	if (!ok) failures.push(name);
};

const SLOT_ONLY = ['slot'] as const;
check('slot config on a slot-only runtime', familyRefusal(null, SLOT_ONLY), undefined);
check('slot config (no family) on a slot-only runtime', familyRefusal({}, SLOT_ONLY), undefined);
for (const family of ['match3', 'arcade', 'card'] as const) {
	check(
		`${family} config on a slot-only runtime is refused`,
		familyRefusal({ family }, SLOT_ONLY),
		`this runtime does not play ${family} games`,
	);
	check(
		`${family} config on a runtime that carries it`,
		familyRefusal({ family }, ['slot', family]),
		undefined,
	);
}
check(
	'card config on a match-3 runtime is refused',
	familyRefusal({ family: 'card' }, ['slot', 'match3']),
	'this runtime does not play card games',
);

check('unbuilt ⇒ every family', compiledFamilies(), CONFIG_FAMILIES);
for (const family of CONFIG_FAMILIES)
	check(`unbuilt plays ${family}`, familyRefusal(family === 'slot' ? {} : { family }), undefined);

console.log(`\n${failures.length ? 'family boot check failed' : 'family boot check ok'}`);
if (failures.length) throw new Error(failures.join('\n'));
