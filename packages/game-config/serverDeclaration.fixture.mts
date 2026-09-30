// The rest of the RGS's boot-config declaration — `maxWinMp`, `symbolsPay.scatter`, `maxWays` —
// cross-checked against the authored config (`src/serverDeclaration.ts`). Discovered by
// `pnpm check:all`; alone:
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs packages/game-config/serverDeclaration.fixture.mts
//
//   1. A server that declares nothing is compared on nothing — silence, on every game.
//   2. Agreement is silence.
//   3. Each disagreement is named, once, in words a person can act on.
//   4. Only what the protocol lets us read is compared: the FIRST `maxWinMp` entry (the base
//      option), and `maxWays` only on a ways game.

import { serverDeclarationDrift } from './src/serverDeclaration.ts';
import type { GameConfigDoc } from './src/types.ts';

let failures = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — got ${JSON.stringify(actual)}`}`);
};

const doc = (over: Partial<GameConfigDoc> = {}): GameConfigDoc =>
	({
		version: 1,
		providerName: '',
		gameName: '',
		gameID: '',
		rtp: 0.96,
		numReels: 5,
		numRows: [3, 3, 3, 3, 3],
		betModes: {
			base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 },
			bonus: { cost: 100, feature: false, buyBonus: true, rtp: 0.96, max_win: 20000 },
		},
		paylines: {},
		symbols: { H1: { paytable: [] }, S: { special_properties: ['scatter'] } },
		paddingReels: {},
		...over,
	}) as GameConfigDoc;

console.log('\n1. nothing declared ⇒ nothing compared');
check('an empty declaration', serverDeclarationDrift(doc(), {}), []);
check('empty lists', serverDeclarationDrift(doc(), { maxWinMp: [], scatterSymbols: [] }), []);

console.log('\n2. agreement is silence');
check('same cap, same scatters', serverDeclarationDrift(doc(), { maxWinMp: [5000], scatterSymbols: ['S'] }), []); // prettier-ignore
check('duplicate scatter names collapse', serverDeclarationDrift(doc(), { scatterSymbols: ['S', 'S'] }), []); // prettier-ignore

console.log('\n3. each disagreement is named');
check(
	'the remake today: authored 5,000×, the book mock caps at 10,000×',
	serverDeclarationDrift(doc(), { maxWinMp: [10000] }),
	["max win: the info page states 5000× (the base mode's max_win), the server caps at 10000×"],
);
check(
	'a scatter the server pays and the config does not mark',
	serverDeclarationDrift(doc(), { scatterSymbols: ['S', 'W'] }),
	['scatter symbols: authored [S], the server pays [S, W] as scatters'],
);
check(
	'a config with no scatter at all',
	serverDeclarationDrift(doc({ symbols: { H1: {} } }), { scatterSymbols: ['S'] }),
	['scatter symbols: authored [none], the server pays [S] as scatters'],
);
const ways = doc({ winModel: { type: 'ways', direction: 'ltr', minKind: 3 }, numRows: [3, 4, 4, 4, 3] }); // prettier-ignore
check('a ways board that agrees (3·4·4·4·3 = 576)', serverDeclarationDrift(ways, { maxWays: 576 }), []); // prettier-ignore
check('a ways board that does not', serverDeclarationDrift(ways, { maxWays: 243 }), ['ways: the authored board gives 576, the server declares 243']); // prettier-ignore

console.log('\n4. only what we can read is compared');
check('a later maxWinMp entry is not compared', serverDeclarationDrift(doc(), { maxWinMp: [5000, 1] }), []); // prettier-ignore
check('maxWays on a LINES game is not compared', serverDeclarationDrift(doc(), { maxWays: 10 }), []); // prettier-ignore
check('an unstated authored cap is not compared', serverDeclarationDrift(doc({ betModes: {} }), { maxWinMp: [10000] }), []); // prettier-ignore

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
