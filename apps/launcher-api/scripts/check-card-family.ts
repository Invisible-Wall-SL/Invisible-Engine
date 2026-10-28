/**
 * check:card-family — the card family on every list and gate (`docs/design/card-games.md` §9, §12.1,
 * C3).
 *
 *   pnpm --filter launcher-api check:card-family
 *
 *  1. ONE FAMILY, EVERY LIST. `card` is a kind and a family in `constants-shared`, a config family,
 *     a family kind of `kindCapabilities` (no board, no wallet, no bet controls), and has a name in
 *     the publish gate, the launcher's labels and tool table, and the delivery gate.
 *  2. NOTHING ELSE MOVES. Every committed Game Config seed of another family normalizes to the same
 *     bytes with a `card` block beside it, and a slot doc carries no `card` key.
 *  3. FREE PLAY ONLY. An RGS-decided card config is refused by the validator, is `unplayable`, is
 *     refused by publish, delivery and partner sessions; a rules one plays `CARD_RULES_MECHANIC`
 *     and publishes.
 *  4. `/config` shows a card project only its `card` section, and its setters store what a save
 *     stores (defaults deleted).
 *  5. THE TOOLS. A card project is not offered Symbols, Win Text or Invisible Characters; every
 *     other family keeps what it had.
 *  6. THE SAMPLE. `card.rules.json` is stored canonical, validates with no error, has ~24 cards and a
 *     player and an AI deck of `deckSize`; its frames and art are listed for the bake, and its text
 *     is harvested into the Localization tool's "Cards" section.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	GAME_FAMILIES,
	GAME_KINDS,
	SLOT_GAME_KINDS,
	familyOfKind,
} from 'constants-shared/gameKinds';
import { kindCapabilities } from 'engine-layout';
import { CARD_RULES_MECHANIC, mechanicFor } from 'engine-game/src/game/mechanic';
import {
	CONFIG_FAMILIES,
	DEFAULT_CARD_FRAME_ID,
	cardGameComponentIds,
	cardGameParamRefs,
	configSectionsFor,
	normalizeGameConfigDoc,
	resolveCard,
	validateGameConfigDoc,
	type GameConfigDoc,
} from 'game-config';
import { FAMILY_LABELS, FAMILY_TOOLS, familyUsesTool } from '../src/lib/roles.ts';
import { partnerRgsRefusal, unplayableFamilyMessage } from '../src/lib/server/familyGate.ts';
import { CARDS_SECTION_ID, harvestCardText } from '../src/lib/server/localizationHarvest.ts';
import * as familyDoc from '../src/routes/(app)/config/familyDoc.ts';
import { deliveryFamilyRefusal } from '../../../scripts/delivery-family-gate.mjs';

let fails = 0;
let passes = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
	if (ok) passes++;
	else {
		fails++;
		console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
	}
};
const json = (v: unknown) => JSON.stringify(v);
/** Key order aside: a setter appends a field the normalizer writes in its own order. */
const canonical = (v: unknown): unknown =>
	Array.isArray(v)
		? v.map(canonical)
		: v && typeof v === 'object'
			? Object.fromEntries(
					Object.entries(v)
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([k, x]) => [k, canonical(x)]),
				)
			: v;

// ── 1. every list ───────────────────────────────────────────────────────────────────────────────
check('1. GAME_KINDS has card', (GAME_KINDS as readonly string[]).includes('card'));
check('1. card is not a slot kind', !(SLOT_GAME_KINDS as readonly string[]).includes('card'));
check('1. GAME_FAMILIES has card', (GAME_FAMILIES as readonly string[]).includes('card'));
check('1. the card kind plays as the card family', familyOfKind('card') === 'card');
check('1. CONFIG_FAMILIES has card', (CONFIG_FAMILIES as readonly string[]).includes('card'));
check('1. the family lists agree', json([...CONFIG_FAMILIES]) === json([...GAME_FAMILIES]));
const caps = kindCapabilities('card', {});
check(
	'1. kindCapabilities: a card kind has no board, wallet or bet controls',
	!caps.board && !caps.wallet && !caps.betControls,
	json({ board: caps.board, wallet: caps.wallet, betControls: caps.betControls }),
);
const byConfig = kindCapabilities('lines', { family: 'card' });
check('1. kindCapabilities: a card config on a slot kind is a card game', !byConfig.board);
check('1. FAMILY_LABELS names card', FAMILY_LABELS.card === 'card');
check('1. FAMILY_TOOLS has a card row', Array.isArray(FAMILY_TOOLS.card));
for (const family of GAME_FAMILIES) {
	check(`1. FAMILY_LABELS names ${family}`, typeof FAMILY_LABELS[family] === 'string');
	check(`1. FAMILY_TOOLS has a ${family} row`, Array.isArray(FAMILY_TOOLS[family]));
}
const rgsCard = { family: 'card', outcome: undefined } as unknown as GameConfigDoc;
check(
	'1. the publish gate names a card game',
	unplayableFamilyMessage(rgsCard)?.includes('a card game') === true,
	String(unplayableFamilyMessage(rgsCard)),
);
check(
	'1. the delivery gate names a card game',
	deliveryFamilyRefusal({ family: 'card', outcome: 'rules' })?.includes('a card free-play') ===
		true,
);

// ── 2. nothing else moves ───────────────────────────────────────────────────────────────────────
const SEEDS = fileURLToPath(new URL('../src/lib/data/gameConfig/', import.meta.url));
const seeds = readdirSync(SEEDS)
	.filter((f) => f.endsWith('.json'))
	.map((f) => [f, JSON.parse(readFileSync(SEEDS + f, 'utf8'))] as const);
const CARD_BLOCK = { rules: { deckSize: 12 }, decks: [{ id: 'd', side: 'ai', cards: [] }] };
let others = 0;
for (const [name, raw] of seeds) {
	if (raw.family === 'card') continue;
	const doc = normalizeGameConfigDoc(structuredClone(raw));
	if (!doc) continue;
	others++;
	check(`2. ${name}: carries no card key`, !Object.hasOwn(doc, 'card'));
	check(
		`2. ${name}: a card block beside another family is dropped`,
		json(normalizeGameConfigDoc({ ...structuredClone(raw), card: CARD_BLOCK })) === json(doc),
	);
	check(`2. ${name}: does not play the card table`, !mechanicFor(doc).cardTable);
}
check('2. the corpus is not empty', others >= 10, `${others}`);

// ── 3. free play only ───────────────────────────────────────────────────────────────────────────
const sample = JSON.parse(
	readFileSync(SEEDS + 'card.rules.json', 'utf8'),
) as unknown as GameConfigDoc;
const rules = normalizeGameConfigDoc(structuredClone(sample))!;
const rgs = normalizeGameConfigDoc({ ...structuredClone(sample), outcome: undefined })!;
check(
	'3. an RGS card config is refused by the validator',
	validateGameConfigDoc(rgs).some((i) => i.severity === 'error' && i.path === 'outcome'),
);
check('3. an RGS card config is unplayable', !!mechanicFor(rgs).unplayable);
check('3. … and publish refuses it', unplayableFamilyMessage(rgs) !== null);
check(
	'3. delivery refuses a card game either way',
	deliveryFamilyRefusal(rules) !== null && deliveryFamilyRefusal(rgs) !== null,
);
check(
	'3. partner sessions refuse a card game either way',
	partnerRgsRefusal(rules) !== null && partnerRgsRefusal(rgs) !== null,
);
check(
	'3. a rules card config plays CARD_RULES_MECHANIC',
	mechanicFor(rules) === CARD_RULES_MECHANIC,
);
check(
	'3. … with no reels, bets, RGS session or wallet',
	(() => {
		const m = mechanicFor(rules);
		return m.cardTable && !m.spins && !m.bets && !m.rgsSession && !m.wallet && !m.playField;
	})(),
);
check('3. … and publishes', unplayableFamilyMessage(rules) === null);

// ── 4. /config ──────────────────────────────────────────────────────────────────────────────────
check(
	'4. /config shows a card game only its card section',
	json([...configSectionsFor('card', 'rules')]) === json(['card']),
);
check(
	'4. no other family shows the card section',
	(['slot', 'match3', 'arcade'] as const).every(
		(f) => !configSectionsFor(f, 'rules').has('card') && !configSectionsFor(f, 'rgs').has('card'),
	),
);
let doc: GameConfigDoc = normalizeGameConfigDoc({
	family: 'arcade',
	outcome: 'rules',
	arcade: { fixedHz: 120 },
})!;
const step = (
	label: string,
	edit: (d: GameConfigDoc) => void,
	expect: (d: GameConfigDoc) => boolean,
) => {
	edit(doc);
	const stored = normalizeGameConfigDoc(structuredClone(doc));
	check(
		`4. ${label}: the page holds what a save stores`,
		json(canonical(stored)) === json(canonical(doc)),
		json(doc),
	);
	check(`4. ${label}: as expected`, expect(doc), json(doc));
};
step(
	'arcade → card',
	(d) => familyDoc.setFamily(d, 'card'),
	(d) => d.family === 'card' && d.outcome === 'rules' && !d.arcade,
);
step(
	'a deck size',
	(d) => familyDoc.setCardRule(d, 'deckSize', '15'),
	(d) => d.card?.rules?.deckSize === 15,
);
step(
	'the default hero health',
	(d) => familyDoc.setCardRule(d, 'startHealth', '30'),
	(d) => d.card?.rules?.startHealth === undefined,
);
step(
	'an opening hand of 0',
	(d) => familyDoc.setCardRule(d, 'openingHand', '0'),
	(d) => d.card?.rules?.openingHand === 0,
);
step(
	'a bad hand limit is ignored',
	(d) => familyDoc.setCardRule(d, 'handLimit', '-2'),
	(d) => d.card?.rules?.handLimit === undefined,
);
step(
	'a resource cap',
	(d) => familyDoc.setCardResource(d, 'max', '8'),
	(d) => d.card?.rules?.resource?.max === 8,
);
step(
	'the default cap',
	(d) => familyDoc.setCardResource(d, 'max', '10'),
	(d) => d.card?.rules?.resource === undefined,
);
step(
	'the AI first',
	(d) => familyDoc.setCardFirst(d, 'ai'),
	(d) => d.card?.rules?.first === 'ai',
);
step(
	'random first',
	(d) => familyDoc.setCardFirst(d, 'random'),
	(d) => d.card?.rules?.first === undefined,
);
// Leaving the family: the board-less doc is no slot or match-3 a save would keep, so only the
// fields are checked.
familyDoc.setFamily(doc, 'slot');
check('4. card → slot drops every family field', !doc.family && !doc.card && !doc.outcome);
doc = structuredClone(rules);
familyDoc.setFamily(doc, 'match3');
check('4. card → match-3 drops the cards', doc.family === 'match3' && !doc.card);

// ── 5. the tools ────────────────────────────────────────────────────────────────────────────────
for (const tool of ['symbols', 'winText', 'characters'])
	check(`5. a card project is not offered ${tool}`, !familyUsesTool('card', tool));
for (const tool of ['gameConfig', 'editor', 'flowV2', 'localization', 'cards'])
	check(`5. a card project keeps ${tool}`, familyUsesTool('card', tool));
check(
	'5. every other family keeps its row',
	json(FAMILY_TOOLS.slot) === json(['characters', 'cards']) &&
		json(FAMILY_TOOLS.match3) === json(['characters', 'cards']) &&
		json(FAMILY_TOOLS.arcade) === json(['symbols', 'winText', 'cards']),
);

// ── 6. the sample ───────────────────────────────────────────────────────────────────────────────
check('6. the sample is stored canonical', json(rules) === json(sample));
const errors = validateGameConfigDoc(rules).filter((i) => i.severity === 'error');
check('6. the sample validates with no error', !errors.length, json(errors));
const warnings = validateGameConfigDoc(rules).filter((i) => i.severity === 'warning');
check('6. … and no warning', !warnings.length, json(warnings));
const { library, decks, rules: cardRules } = resolveCard(rules);
check('6. about 24 cards', library.length >= 20 && library.length <= 28, `${library.length}`);
check(
	'6. a player deck and an AI deck',
	decks.some((d) => d.side === 'player') && decks.some((d) => d.side === 'ai'),
);
check(
	'6. every deck holds deckSize cards',
	decks.every((d) => d.cards.reduce((n, c) => n + c.count, 0) === cardRules.deckSize),
);
check(
	'6. its frames ride the bake (the default frame)',
	json(cardGameComponentIds(rules)) === json([DEFAULT_CARD_FRAME_ID]),
);
check(
	'6. a card naming a frame and art is listed for the export',
	json(
		cardGameParamRefs({
			...rules,
			card: { library: [{ ...library[0], frame: 'gold', params: { art: 'a::b' } }] },
		}),
	) === json([{ frame: 'gold', params: { art: 'a::b' } }]) &&
		json(
			cardGameComponentIds({ ...rules, card: { library: [{ ...library[0], frame: 'gold' }] } }),
		) === json(['gold']),
);
check(
	'6. a doc with no cards lists nothing',
	!cardGameComponentIds({ ...rules, card: undefined }).length,
);
const harvested = harvestCardText(rules);
const keys = harvested.flatMap((s) => s.items.map((i) => i.key));
check('6. the "Cards" localization section', harvested[0]?.sceneId === CARDS_SECTION_ID);
check(
	'6. … holds every card name',
	library.every((c) => keys.includes(c.name)),
);
check(
	'6. … the generated rules text',
	keys.includes('Deal 3 damage to a chosen character.'),
	json(keys.filter((k) => k.startsWith('Deal'))),
);
check(
	'6. … and every deck name',
	decks.every((d) => keys.includes(d.name)),
);
check('6. … each sentence once', keys.length === new Set(keys).size);
const linesSeed = seeds.find(([n]) => n === 'lines.json')![1];
check(
	'6. no Cards section for another family',
	!harvestCardText(normalizeGameConfigDoc(linesSeed)).length,
);

if (fails) {
	console.error(`\ncheck:card-family — ${fails} FAILED, ${passes} passed`);
	process.exit(1);
}
console.log(`check:card-family — ${passes} passed`);
