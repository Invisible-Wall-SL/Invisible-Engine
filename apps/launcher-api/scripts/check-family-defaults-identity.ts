// check:family-defaults-identity — every config this repo ships is UNCHANGED by the family fields
// (`docs/design/game-families.md` §7.1 item 1, §7.2 P10.1).
//
//   pnpm --filter launcher-api check:family-defaults-identity
//
// The family fields are optional and their defaults are never stored, so a slot config authored
// before them must normalize, validate and resolve exactly as it did. This runs that claim over the
// whole corpus the repo commits: every seed under `src/lib/data/gameConfig/`, every preset and
// template in `packages/game-config`, and the compiled `src/game/config.ts` of each game app. For
// each one:
//
//   1. the normalized doc holds no family key (`family`, `outcome`, `match3`, `arcade`, `card`);
//   2. naming the defaults (`family: 'slot'`, `outcome: 'rgs'`), or giving a slot a rules outcome
//      or a family block it cannot use, normalizes to the same BYTES;
//   3. it is a fixed point of the normalizer;
//   4. the validator reports the same issues, and the win model, cascade and `/config` sections
//      resolve the same, with the defaults named.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	CONFIG_SECTIONS,
	HOLD_AND_WIN_COIN_BOARD_TEMPLATE,
	HOLD_AND_WIN_PRESETS,
	HOLD_AND_WIN_TEMPLATES,
	HOLD_AND_WIN_TEST_FIXTURES,
	bookOfThermopylaePreset,
	configSectionsOf,
	normalizeGameConfigDoc,
	resolveCascade,
	resolveFamily,
	resolveOutcome,
	resolveWinModel,
	validateGameConfigDoc,
	type GameConfigDoc,
} from 'game-config';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEEDS = resolve(HERE, '../src/lib/data/gameConfig');
const APPS = resolve(HERE, '../..');

let fails = 0;
let passes = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
	if (ok) passes++;
	else {
		fails++;
		console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
	}
};

const seeds = readdirSync(SEEDS)
	.filter((f) => f.endsWith('.json'))
	.map((f): [string, unknown] => [
		`seed ${f}`,
		JSON.parse(readFileSync(resolve(SEEDS, f), 'utf8')),
	]);
/** The seeds of another family (P10.5's `match3.rules.json`): checked as what they are, below. */
const familySeeds = seeds.filter(
	([, raw]) => typeof (raw as { family?: unknown }).family === 'string',
);
const corpus: [string, unknown][] = [
	...seeds.filter((seed) => !familySeeds.includes(seed)),
	...Object.entries(HOLD_AND_WIN_PRESETS).map(([id, raw]): [string, unknown] => [
		`preset ${id}`,
		raw,
	]),
	...Object.entries(HOLD_AND_WIN_TEMPLATES).map(([id, raw]): [string, unknown] => [
		`template ${id}`,
		raw,
	]),
	['template coinBoard', HOLD_AND_WIN_COIN_BOARD_TEMPLATE],
	...Object.entries(HOLD_AND_WIN_TEST_FIXTURES).map(([id, raw]): [string, unknown] => [
		`fixture ${id}`,
		raw,
	]),
	['preset bookOfThermopylae', bookOfThermopylaePreset()],
];
for (const app of readdirSync(APPS)) {
	const path = resolve(APPS, app, 'src/game/config.ts');
	try {
		readFileSync(path);
	} catch {
		continue;
	}
	const mod = (await import(pathToFileURL(path).href)) as { default?: unknown };
	corpus.push([`app ${app}`, mod.default]);
}

const FAMILY_KEYS = ['family', 'outcome', 'match3', 'arcade', 'card'];
const SLOT_SECTIONS = CONFIG_SECTIONS.filter(
	(s) => s !== 'match3' && s !== 'arcade' && s !== 'card',
);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

let normalized = 0;
for (const [name, raw] of corpus) {
	const doc = normalizeGameConfigDoc(clone(raw));
	if (!doc) {
		// A config the normalizer refuses (the cluster sample has no strips) must still be refused.
		check(
			`${name}: still refused with the defaults named`,
			!normalizeGameConfigDoc({ ...clone(raw as object), family: 'slot' }),
		);
		continue;
	}
	normalized++;
	const bytes = JSON.stringify(doc);
	const present = FAMILY_KEYS.filter((k) => Object.hasOwn(doc, k));
	check(`${name}: holds no family key`, !present.length, present.join());
	const variants: [string, Record<string, unknown>][] = [
		['the defaults named', { family: 'slot', outcome: 'rgs' }],
		['a rules outcome', { outcome: 'rules' }],
		[
			'family blocks',
			{ match3: { moves: 10 }, arcade: { fixedHz: 30 }, card: { rules: { deckSize: 15 } } },
		],
		['an unknown family', { family: 'poker' }],
	];
	for (const [label, extra] of variants) {
		const withExtra = normalizeGameConfigDoc({ ...clone(raw as object), ...extra });
		check(`${name}: ${label} normalizes to the same bytes`, JSON.stringify(withExtra) === bytes);
	}
	check(`${name}: is a fixed point`, JSON.stringify(normalizeGameConfigDoc(clone(doc))) === bytes);
	const named = { ...clone(doc), family: 'slot', outcome: 'rgs' } as unknown as GameConfigDoc;
	check(
		`${name}: validates the same with the defaults named`,
		JSON.stringify(validateGameConfigDoc(named)) === JSON.stringify(validateGameConfigDoc(doc)),
	);
	check(
		`${name}: resolves to a slot decided by the RGS`,
		resolveFamily(doc) === 'slot' && resolveOutcome(doc) === 'rgs',
	);
	check(
		`${name}: win model is the stored one`,
		JSON.stringify(resolveWinModel(doc)) === JSON.stringify(doc.winModel ?? { type: 'lines' }),
	);
	check(
		`${name}: cascade unchanged`,
		resolveCascade(doc) === resolveCascade({ winModel: doc.winModel, cascade: doc.cascade }),
	);
	check(
		`${name}: /config shows every slot section`,
		JSON.stringify([...configSectionsOf(doc)]) === JSON.stringify(SLOT_SECTIONS),
	);
}
check('the corpus is not empty', normalized >= 15, `${normalized} configs normalized`);

// A seed of another family is no slot: it is stored canonical, resolves to its family and outcome,
// validates with no error, and `/config` shows that family's sections.
check(
	'the match-3 rules seed is committed',
	familySeeds.some(([name]) => name === 'seed match3.rules.json'),
);
for (const [name, raw] of familySeeds) {
	const doc = normalizeGameConfigDoc(clone(raw as object));
	if (!doc) {
		check(`${name}: normalizes`, false);
		continue;
	}
	check(`${name}: is stored canonical`, JSON.stringify(doc) === JSON.stringify(raw));
	check(
		`${name}: resolves to its own family and outcome`,
		resolveFamily(doc) === (raw as GameConfigDoc).family &&
			resolveOutcome(doc) === ((raw as GameConfigDoc).outcome ?? 'rgs'),
	);
	check(
		`${name}: validates with no error`,
		!validateGameConfigDoc(doc).some((issue) => issue.severity === 'error'),
	);
	check(
		`${name}: /config shows its family's section and no slot-only one`,
		configSectionsOf(doc).has(resolveFamily(doc) as 'match3' | 'arcade' | 'card') &&
			!configSectionsOf(doc).has('paylines'),
	);
}

if (fails) {
	console.error(`\ncheck:family-defaults-identity — ${fails} FAILED, ${passes} passed`);
	process.exit(1);
}
console.log(`check:family-defaults-identity — ${passes} passed over ${normalized} configs`);
