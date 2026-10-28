/**
 * check:cards-tool — Invisible Card Library (`/cards`, `docs/design/card-games.md` §8, §12.1 C4):
 * the page's pure helpers, run on Game Maker's real sample config (`card.rules.json`).
 *
 *   pnpm --filter launcher-api check:cards-tool
 *
 *  1. THE FORM OFFERS ONLY VALID EFFECTS. Every trigger × verb × target kind × side × include the
 *     form offers, on a unit and on a spell, makes an effect `validateLibrary` passes; and every
 *     combination the validator accepts is offered (the form hides nothing the rules allow).
 *     `fitEffect` repairs whatever it is given into a valid effect.
 *  2. THE EDITS MIRROR THE NORMALIZER: each card and deck edit leaves the doc exactly as a save
 *     would store it, and refused edits (a summoned card, a taken id) leave it alone.
 *  3. THE RULES TEXT is `cardText` for a valid card and none for a card with errors; the preview's
 *     frame values are the game's (`apps/lines` `cards.ts` `valuesOf`) for a card in hand.
 *  4. THE TEST MATCH uses the game's modules: its match is the very match the game's
 *     `cardSession.ts` deals from the same config and seed, and the device's moves are the same;
 *     a match replays from its record (`replayMatch`); "Run 100" is seeds 1 … 100, deterministic.
 *  5. SAVING AND ACCESS: the page saves through `PUT /api/game-config` under the `gameConfig` lease
 *     with the read etag; the load refuses (403) without the Card Library grant and without the Game
 *     Config grant, before it reads anything; every role holding Game Config holds the Card Library.
 *  6. THE REGISTRY: the tool, its stage, `FAMILY_TOOLS`, and its guide (rule 9).
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	CARD_INCLUDES,
	CARD_KEYWORDS,
	CARD_SIDES,
	CARD_TARGET_KINDS,
	CARD_TRIGGERS,
	CARD_VERBS,
	cardText,
	replayMatch,
	validateLibrary,
	type CardDef,
	type CardEffect,
	type Target,
} from 'engine-mechanics';
import { normalizeGameConfigDoc, resolveCard, type GameConfigDoc } from 'game-config';
import { createCardSession, DEVICE } from 'engine-game/src/game/cardSession';
import * as edit from '../src/lib/cards/cardEdit.ts';
import {
	createTestMatch,
	playAiMatch,
	recordFor,
	runMany,
	seatFor,
} from '../src/lib/cards/testMatch.ts';
import {
	FAMILY_TOOLS,
	ROLE_TOOLS,
	TOOLS,
	TOOL_STAGES,
	roleHasTool,
	toolDocPath,
} from '../src/lib/roles.ts';

let passes = 0;
let fails = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
	if (ok) passes++;
	else {
		fails++;
		console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
	}
};
const canon = (v: unknown): string =>
	JSON.stringify(v, (_k, value: unknown) =>
		value && typeof value === 'object' && !Array.isArray(value)
			? Object.fromEntries(
					Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
				)
			: value,
	);
const same = (name: string, actual: unknown, expected: unknown): void =>
	check(name, canon(actual) === canon(expected), `${canon(actual)} ≠ ${canon(expected)}`);

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const sample = normalizeGameConfigDoc(
	JSON.parse(readFileSync(here('../src/lib/data/gameConfig/card.rules.json'), 'utf8')),
) as GameConfigDoc;
const fresh = (): GameConfigDoc => JSON.parse(JSON.stringify(sample)) as GameConfigDoc;
const library = resolveCard(sample).library;
const unitId = library.find((c) => c.type === 'unit')!.id;

// ── 1. The form ──────────────────────────────────────────────────────────────────────────────────
const errorsOf = (card: CardDef): string[] =>
	validateLibrary([card, ...library.filter((c) => c.id !== card.id)])
		.filter((i) => i.severity === 'error' && i.card === card.id)
		.map((i) => `${i.path}: ${i.message}`);
const probe = (type: CardDef['type'], effect: CardEffect): CardDef =>
	type === 'unit'
		? { id: 'probe', name: 'Probe', type, cost: 1, attack: 1, health: 1, effects: [effect] }
		: { id: 'probe', name: 'Probe', type, cost: 1, effects: [effect] };

/** One effect per verb with its fields filled, before a trigger and a target are chosen. */
const fields: Record<CardEffect['verb'], Record<string, unknown>> = {
	damage: { amount: 2 },
	heal: { amount: 2 },
	draw: { amount: 1 },
	summon: { card: unitId, count: 2 },
	buff: { attack: 1, health: 1, until: 'endOfTurn' },
	destroy: {},
	giveKeyword: { keyword: 'guard' },
};
const targetsFor = (kind: Target['kind']): Target[] =>
	kind === 'self'
		? [{ kind }]
		: kind === 'chosen'
			? CARD_SIDES.flatMap((side) => CARD_INCLUDES.map((include) => ({ kind, side, include })))
			: CARD_INCLUDES.map((include) => ({ kind, include }) as Target);

let offered = 0;
let accepted = 0;
for (const type of ['unit', 'spell'] as const) {
	for (const trigger of CARD_TRIGGERS)
		for (const verb of CARD_VERBS) {
			const kinds = edit.targetChoices({ type }, trigger, verb);
			const raws: Record<string, unknown>[] = kinds.length
				? CARD_TARGET_KINDS.flatMap((kind) =>
						targetsFor(kind).map((target) => ({ trigger, verb, ...fields[verb], target })),
					)
				: [{ trigger, verb, ...fields[verb] }];
			for (const raw of raws) {
				const target = raw.target as Target | undefined;
				const isOffered =
					edit.triggerChoices({ type }).includes(trigger) &&
					edit.verbChoices(library).includes(verb) &&
					(!target ||
						(kinds.includes(target.kind) &&
							(target.kind === 'self' ||
								(edit.includeChoices(verb).includes((target as { include: never }).include) &&
									(target.kind !== 'chosen' || edit.sideChoices().includes(target.side))))));
				const valid = errorsOf(probe(type, raw as CardEffect)).length === 0;
				if (isOffered) offered++;
				if (valid) accepted++;
				if (isOffered !== valid)
					check(
						`1. ${type} ${trigger} ${verb} ${canon(target)}: offered ⇔ valid`,
						false,
						`offered ${isOffered}, valid ${valid}`,
					);
				// Whatever the form is handed, its repair validates.
				const fitted = edit.fitEffect({ type }, raw as Partial<CardEffect>, library);
				const fittedErrors = errorsOf(probe(type, fitted));
				if (fittedErrors.length)
					check(
						`1. fitEffect(${type} ${trigger} ${verb}) validates`,
						false,
						fittedErrors.join('; '),
					);
				if (isOffered)
					same(`1. fitEffect keeps an offered ${type} ${trigger} ${verb}`, fitted, raw);
			}
		}
}
check(
	'1. the form offers exactly what the validator accepts',
	offered === accepted && offered > 0,
	`${offered} offered, ${accepted} valid`,
);
check(
	'1. a spell is offered onPlay only',
	canon(edit.triggerChoices({ type: 'spell' })) === canon(['onPlay']),
);
check(
	'1. self is never offered on a spell',
	!edit.targetChoices({ type: 'spell' }, 'onPlay', 'damage').includes('self'),
);
check(
	'1. chosen only on onPlay',
	!edit.targetChoices({ type: 'unit' }, 'onDeath', 'damage').includes('chosen'),
);
check(
	'1. a units-only verb never offers the hero',
	canon(edit.includeChoices('buff')) === canon(['units']),
);
check('1. no summon offered without a unit to summon', !edit.verbChoices([]).includes('summon'));
for (const junk of [
	{},
	{ verb: 'explode', trigger: 'never', amount: 99, target: { kind: 'everyone' } },
])
	check(
		`1. fitEffect repairs ${canon(junk)}`,
		errorsOf(probe('unit', edit.fitEffect({ type: 'unit' }, junk as Partial<CardEffect>, library)))
			.length === 0,
	);

// ── 2. The edits mirror the normalizer ──────────────────────────────────────────────────────────
const stored = (d: GameConfigDoc) => normalizeGameConfigDoc(JSON.parse(JSON.stringify(d)));
const edits: [string, (d: GameConfigDoc) => unknown][] = [
	['add a unit', (d) => edit.addCard(d, 'unit')],
	['add a spell', (d) => edit.addCard(d, 'spell')],
	['duplicate', (d) => edit.duplicateCard(d, unitId)],
	['rename', (d) => edit.renameCard(d, unitId, 'renamed-unit')],
	['unit → spell', (d) => edit.setCardType(d, unitId, 'spell')],
	['spell → unit', (d) => edit.setCardType(d, library.find((c) => c.type === 'spell')!.id, 'unit')],
	['cost clamped', (d) => edit.setCardNumber(d, unitId, 'cost', 99)],
	['attack', (d) => edit.setCardNumber(d, unitId, 'attack', '4')],
	['blank flavour', (d) => edit.setCardText(d, unitId, 'flavor', '  ')],
	['flavour', (d) => edit.setCardText(d, unitId, 'flavor', 'Moss and moonlight.')],
	['keyword on', (d) => edit.toggleKeyword(d, unitId, 'shield')],
	[
		'keyword twice',
		(d) => (edit.toggleKeyword(d, unitId, 'swift'), edit.toggleKeyword(d, unitId, 'swift')),
	],
	['token', (d) => edit.setToken(d, unitId, true)],
	['frame', (d) => edit.setFrame(d, unitId, 'myFrame')],
	['frame cleared', (d) => edit.setFrame(d, unitId, '')],
	['art', (d) => edit.setFrameParam(d, unitId, 'art', 'sheet::hero')],
	[
		'art cleared',
		(d) => (edit.setFrameParam(d, unitId, 'art', 'x::y'), edit.setFrameParam(d, unitId, 'art', '')),
	],
	['add an effect', (d) => edit.addEffect(d, unitId)],
	[
		'effect verb',
		(d) => (edit.addEffect(d, unitId), edit.setEffectField(d, unitId, 0, 'verb', 'buff')),
	],
	[
		'effect target',
		(d) => (
			edit.addEffect(d, unitId),
			edit.setEffectField(d, unitId, 0, 'target.kind', 'allEnemies')
		),
	],
	[
		'remove effects',
		(d) => {
			const c = d.card!.library!.find((x) => x.id === unitId)!;
			while (c.effects?.length) edit.removeEffect(d, unitId, 0);
		},
	],
	['add a deck', (d) => edit.addDeck(d, 'ai')],
	['duplicate a deck', (d) => edit.duplicateDeck(d, d.card!.decks![0].id)],
	['rename a deck', (d) => edit.renameDeck(d, d.card!.decks![0].id, 'starter')],
	['deck name', (d) => edit.setDeckName(d, d.card!.decks![0].id, 'Starter')],
	[
		'deck count +1',
		(d) =>
			edit.setDeckCount(
				d,
				d.card!.decks![0].id,
				unitId,
				edit.deckCount(d.card!.decks![0], unitId) + 1,
			),
	],
	['deck count 0', (d) => edit.setDeckCount(d, d.card!.decks![0].id, unitId, 0)],
	['deck count clamped', (d) => edit.setDeckCount(d, d.card!.decks![0].id, unitId, 9)],
	[
		'difficulty',
		(d) => edit.setDeckDifficulty(d, d.card!.decks!.find((x) => x.side === 'ai')!.id, 'hard'),
	],
	[
		'weight',
		(d) => edit.setDeckWeight(d, d.card!.decks!.find((x) => x.side === 'ai')!.id, 'board', '2.5'),
	],
	[
		'weight cleared',
		(d) => {
			const id = d.card!.decks!.find((x) => x.side === 'ai')!.id;
			edit.setDeckWeight(d, id, 'board', '2');
			edit.setDeckWeight(d, id, 'board', '');
		},
	],
	['remove a deck', (d) => edit.removeDeck(d, d.card!.decks![0].id)],
];
for (const [name, run] of edits) {
	const d = fresh();
	run(d);
	same(`2. ${name}: stored as edited`, stored(d), d);
}
{
	const d = fresh();
	const summoned = library.find((c) =>
		library.some((x) => x.effects?.some((e) => e.verb === 'summon' && e.card === c.id)),
	);
	if (summoned) {
		const refused = edit.removeCard(d, summoned.id);
		check('2. a summoned card cannot be deleted', !!refused && canon(d) === canon(sample));
	}
	const other = library[1].id;
	check(
		'2. a rename onto a taken id is refused',
		!!edit.renameCard(d, unitId, other) && canon(d) === canon(sample),
	);
	check(
		'2. a bad id is refused',
		!!edit.renameCard(d, unitId, 'has space') && canon(d) === canon(sample),
	);
	const renamed = fresh();
	edit.renameCard(renamed, unitId, 'renamed');
	check(
		'2. a rename reaches the decks and summons',
		!canon(renamed.card).includes(`"${unitId}"`) && canon(renamed.card).includes('"renamed"'),
	);
	const removed = fresh();
	const lone = library.find((c) => c.type === 'spell')!.id;
	check(
		'2. a delete leaves the decks',
		edit.removeCard(removed, lone) === null && !canon(removed.card?.decks).includes(`"${lone}"`),
	);
	const merged = fresh();
	const spellId = library.find((c) => c.type === 'spell')!.id;
	merged.card!.decks![0].cards = [
		{ card: unitId, count: 1 },
		{ card: spellId, count: 2 },
		{ card: unitId, count: 1 },
	];
	edit.setDeckCount(merged, merged.card!.decks![0].id, unitId, 1);
	same('2. a count merges duplicate entries into the first', merged.card!.decks![0].cards, [
		{ card: unitId, count: 1 },
		{ card: spellId, count: 2 },
	]);
	edit.setDeckCount(merged, merged.card!.decks![0].id, 'not-a-card', 0);
	edit.setDeckCount(merged, merged.card!.decks![0].id, spellId, 0);
	same('2. a count of 0 removes the entry', merged.card!.decks![0].cards, [
		{ card: unitId, count: 1 },
	]);
	const summonedUnit = library.find((c) => edit.summonedBy(sample, c.id).length);
	if (summonedUnit) {
		const typed = fresh();
		check(
			'2. a summoned unit cannot become a spell',
			!!edit.setCardType(typed, summonedUnit.id, 'spell') && canon(typed) === canon(sample),
		);
	}
	check('2. the sample has a summoned unit to refuse', !!summonedUnit);
	const full = fresh();
	for (let i = 0; i < 5; i++) edit.addEffect(full, unitId);
	check(
		'2. at most three effects',
		(full.card!.library!.find((c) => c.id === unitId)!.effects?.length ?? 0) === 3,
	);
}

// ── 3. Rules text and frame values ──────────────────────────────────────────────────────────────
for (const card of library)
	same(
		`3. ${card.id}: its rules text is cardText`,
		edit.rulesTextOf(card, library),
		cardText(card, library),
	);
{
	const broken: CardDef = { ...library.find((c) => c.effects?.length)!, cost: 99 };
	same('3. a card with errors has no rules text', edit.rulesTextOf(broken, library), []);
	const unit =
		library.find((c) => c.type === 'unit' && c.keywords?.length) ??
		library.find((c) => c.type === 'unit')!;
	const v = edit.frameValues(unit, library);
	same(
		'3. the frame values of a unit in hand',
		[v.name, v.cost, v.attack, v.health, v.isUnit, v.inHand, v.onBoard, v.faceDown, v.rulesText],
		[unit.name, unit.cost, unit.attack, unit.health, 1, 1, 0, 0, cardText(unit, library).join(' ')],
	);
	for (const k of CARD_KEYWORDS)
		check(`3. keyword flag ${k}`, v[k] === (unit.keywords?.includes(k) ? 1 : 0));
	check(
		'3. a spell has the unit flag off',
		edit.frameValues(
			library.find((c) => c.type === 'spell')!,
			library,
		).isUnit === 0,
	);
	check('3. the face-down look', edit.frameValues(unit, library, 'faceDown').faceDown === 1);
	check('3. a ready unit is on the board', edit.frameValues(unit, library, 'ready').onBoard === 1);
	const source = readFileSync(here('../../lines/src/game/cards.ts'), 'utf8');
	const runtimeKeys = [
		...source
			.slice(
				source.indexOf('function valuesOf'),
				source.indexOf('\n}\n', source.indexOf('function valuesOf')),
			)
			.matchAll(/^\t\t(\w+):/gm),
	].map((m) => m[1]);
	const missing = runtimeKeys.filter((k) => !(k in v));
	same('3. every value the game feeds a frame, the preview feeds too', missing, []);
}

// ── 4. The test match ───────────────────────────────────────────────────────────────────────────
{
	const { decks } = resolveCard(sample);
	const player = decks.find((d) => d.side === 'player')!;
	const ai = decks.find((d) => d.side === 'ai')!;
	for (const seed of [1, 7, 'cards']) {
		const session = createCardSession(sample, { seed, deck: player.id });
		const run = createTestMatch(recordFor(sample, [seatFor(player), seatFor(ai)], seed, 0));
		same(`4. seed ${seed}: the game's opening match`, run.match, session.match);
		// Play the player's side by the same first legal action on both; the device side is the AI.
		for (let step = 0; step < 400 && !session.match.result; step++) {
			if (session.match.active === DEVICE) {
				session.deviceStep();
				run.aiStep();
			} else {
				const action = session.legal()[0];
				session.act(action);
				run.act(action);
			}
		}
		same(`4. seed ${seed}: the game's whole match`, run.match, session.match);
		same(`4. seed ${seed}: replays from its record`, replayMatch(run.replay()).match, run.match);
	}
	const seats = [seatFor(player), seatFor(ai)] as const;
	const watched = createTestMatch(recordFor(sample, seats, 3));
	while (!watched.match.result) watched.aiStep();
	same('4. an AI-vs-AI match replays', replayMatch(watched.replay()).match, watched.match);
	same(
		'4. playAiMatch is that match',
		playAiMatch(recordFor(sample, seats, 3)).result,
		watched.match.result,
	);
	const a = runMany(sample, seats, 100);
	const b = runMany(sample, seats, 100);
	check('4. Run 100 plays 100', a?.played === 100);
	same('4. Run 100 is deterministic', a, b);
	check('4. Run 100 adds up', !!a && a.wins[0] + a.wins[1] + a.draws === 100);
	const src = readFileSync(here('../src/lib/cards/testMatch.ts'), 'utf8');
	check(
		'4. the test match imports the rules and the AI from engine-mechanics',
		/from 'engine-mechanics'/.test(src) && !/cards\.js'/.test(src),
	);
}

// ── 5. Saving and access ────────────────────────────────────────────────────────────────────────
{
	const page = readFileSync(here('../src/routes/(app)/cards/+page.svelte'), 'utf8');
	check(
		'5. saves through PUT /api/game-config',
		page.includes('`/api/game-config?project=') && page.includes("method: 'PUT'"),
	);
	check(
		'5. under the gameConfig lease',
		page.includes("toolId: 'gameConfig'") && page.includes("docKey: 'gameConfig'"),
	);
	check(
		'5. with the read etag and the conflict path',
		page.includes('initialEtag: data.etag') &&
			page.includes('baseEtag') &&
			page.includes('res.status === 409'),
	);
	check('5. a read-only lease blocks the save', page.includes('blockWhen: () => lease.readOnly'));
	const server = readFileSync(here('../src/routes/(app)/cards/+page.server.ts'), 'utf8');
	const gate = (id: string) => server.indexOf(`roleHasTool(locals.user.role, '${id}'`);
	const firstRead = Math.min(
		server.indexOf('resolveToolScope('),
		server.indexOf('resolveGameConfig('),
	);
	check('5. 403 without the Card Library grant', gate('cards') > 0 && gate('cards') < firstRead);
	check(
		'5. 403 without the Game Config grant',
		gate('gameConfig') > 0 && gate('gameConfig') < firstRead,
	);
	check(
		'5. both are errors, not redirects',
		(server.match(/throw error\(\s*403/g) ?? []).length === 2,
	);
	for (const role of Object.keys(ROLE_TOOLS) as (keyof typeof ROLE_TOOLS)[])
		check(
			`5. ${role}: the Card Library exactly with Game Config`,
			roleHasTool(role, 'cards') === roleHasTool(role, 'gameConfig'),
		);
	check(
		'5. a Game Config override off takes the page with it',
		!roleHasTool('developer', 'gameConfig', { gameConfig: false }) &&
			roleHasTool('developer', 'cards', { gameConfig: false }),
	);
}

// ── 6. The registry ─────────────────────────────────────────────────────────────────────────────
{
	const tool = TOOLS.cards;
	same(
		'6. the tool',
		[tool?.name, tool?.url, tool?.kind],
		['Invisible Card Library', '/cards', 'online'],
	);
	check(
		'6. in the Build stage beside Characters',
		!!TOOL_STAGES.find((s) => s.id === 'build')?.tools.includes('cards'),
	);
	for (const family of ['slot', 'match3', 'arcade'] as const)
		check(`6. hidden from ${family}`, FAMILY_TOOLS[family].includes('cards'));
	check('6. offered to card', !FAMILY_TOOLS.card.includes('cards'));
	same('6. the guide slug', toolDocPath('cards'), 'docs/invisible-card-library');
	const docs = here('../../../docs/tools/');
	check(
		'6. docs/tools/invisible-card-library.md exists',
		existsSync(`${docs}invisible-card-library.md`),
	);
	check(
		'6. its row in docs/tools/README.md',
		readFileSync(`${docs}README.md`, 'utf8').includes('(invisible-card-library.md)'),
	);
}

console.log(`check:cards-tool — ${passes}/${passes + fails} passed`);
if (fails) process.exit(1);
