/**
 * check:config-character-sheets — Invisible Game Config (`/config`) and the character sheet
 * (`docs/design/character-pipeline.md` §2, step C2b; `game-config` `characterSheet.ts`: a
 * character's `view`, `source`, `draw` and `actions`, an online class's `sheet`). The page does not
 * edit a sheet; it must show what a save would say of one, and never lose one. Over the page's own
 * pure modules (`config/pageDoc.ts`, `onlineDoc.ts`, `familyDoc.ts`) and the real save
 * (`prepareGameConfigDoc`):
 *
 *   1. the page's issues (`pageIssues`) are the save's, errors and warnings, for a config with
 *      sheets and for one with none; a sheet's character is not warned of as one no bot plays; the
 *      screens' projection adds only the view warnings the save cannot know; and every sheet issue
 *      lands in a panel (the Arcade card, or the Online room's Characters table);
 *   2. every exported edit of `onlineDoc.ts` and `familyDoc.ts` is audited here by name (a new one
 *      fails until it is added), and each keeps the four sheet fields of every character it keeps
 *      and the `sheet` of every class it keeps;
 *   3. a class's change of body removes a `sheet` the new body puts out of force and answers what
 *      it removed; a body of the sheet's component, a no-op and a sheet naming no character keep
 *      it; a rename keeps it and a removal takes it;
 *   4. a reset replaces the characters and their sheets, and its confirmation counts them
 *      (`sheetsHeld`, `sheetsRemovedNote`); turning online off counts the links;
 *   5. Raw JSON's Apply keeps a pasted sheet and drops one removed from the text, into the save;
 *   6. a config with NO sheet goes `openDoc` → `bodyFor` → the save as the normalizer makes it,
 *      with no new key.
 *
 *   pnpm --filter launcher-api check:config-character-sheets
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	characterSheetOf,
	normalizeGameConfigDoc,
	validateGameConfigDoc,
	withCharacterSheets,
	UNPLAYED_CHARACTER_WARNING,
	type GameConfigDoc,
	type GameConfigIssue,
} from 'game-config';
import {
	InvalidGameConfigError,
	prepareGameConfigDoc,
} from '../src/lib/server/gameConfigStorage.ts';
import * as familyDoc from '../src/routes/(app)/config/familyDoc.ts';
import * as onlineDoc from '../src/routes/(app)/config/onlineDoc.ts';
import * as pageDoc from '../src/routes/(app)/config/pageDoc.ts';

let fails = 0;
let passes = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
	if (ok) passes++;
	else {
		fails++;
		console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
	}
};
const text = (v: unknown): string => JSON.stringify(v);
const same = (name: string, actual: unknown, expected: unknown): void =>
	check(name, text(actual) === text(expected), `${text(actual)} ≠ ${text(expected)}`);

type Entry = Record<string, unknown>;
const seed: Entry = JSON.parse(
	readFileSync(
		fileURLToPath(new URL('../src/lib/data/gameConfig/arcade.rules.json', import.meta.url)),
		'utf8',
	),
);

const BEAR_SHEET = {
	view: { kind: 'isometric', facings: 8 },
	source: { kind: 'clips', prefix: 'bear', variants: { marked: 'bear_gold' } },
	draw: { width: 92, feet: 0.9, points: { hand: { x: 0.75, y: 0.4 } } },
	actions: [
		{ id: 'idle', when: { motion: 'still' } },
		{ id: 'walk', when: { motion: 'moving' }, fallback: 'idle' },
		{ id: 'swipe', when: { ability: 'ability1' }, interrupt: 'none', fallback: 'idle' },
	],
};
const SALMON_SHEET = {
	source: { kind: 'clips', prefix: 'salmon' },
	draw: { width: 60 },
	actions: [{ id: 'swim', when: [{ motion: 'still' }, { motion: 'moving' }] }],
};
const BRAIN = { initial: 'roam', states: [{ id: 'roam', behaviour: 'wander' }], transitions: [] };
const bearBot = (sheet: Entry = {}) => ({
	id: 'bearBot',
	component: 'arcadeBear',
	brain: BRAIN,
	...sheet,
});
const salmonLook = (sheet: Entry = {}) => ({
	id: 'salmonLook',
	component: 'arcadeSalmon',
	...sheet,
});
const bear = (more: Entry = {}) => ({ id: 'bear', body: 'arcadeBear', speed: 190, ...more });
const salmon = (more: Entry = {}) => ({ id: 'salmon', body: 'arcadeSalmon', speed: 240, ...more });
/** The arcade seed as an online game: a room, a rule of each kind, a pointer and a bot, so every
 *  edit has something to change. */
const online = (characters: Entry[], classes: Entry[], arcade: Entry = {}): Entry => ({
	...structuredClone(seed),
	arcade: {
		...structuredClone(seed.arcade as object),
		field: { w: 2000, h: 1200 },
		zones: [{ id: 'pool', x: 0, y: 0, w: 200, h: 200 }],
		characters,
		online: {
			characters: classes,
			pointer: {},
			rules: {
				zones: [{ zone: 'pool', goal: true }],
				abilities: [
					{
						character: 'bear',
						button: 'ability1',
						reach: 100,
						targets: ['salmon'],
						effect: 'catch',
					},
				],
				lobby: {},
			},
			bots: { fillTo: 4, characters: [{ character: 'bear', brain: 'bearBot' }] },
		},
		...arcade,
	},
});
const plain = online([bearBot(), salmonLook()], [bear(), salmon()]);
const sheeted = online(
	[bearBot(BEAR_SHEET), salmonLook(SALMON_SHEET)],
	[bear({ sheet: 'bearBot' }), salmon({ sheet: 'salmonLook' })],
);

/** What a load makes of stored bytes: the normalizer, then the carry (`loadGameConfigDocWithEtag`). */
const load = (stored: unknown): GameConfigDoc =>
	withCharacterSheets(normalizeGameConfigDoc(stored) as GameConfigDoc, stored);
/** The page's live doc for a project whose stored config is the save of `authored`. */
const liveOf = (authored: unknown): GameConfigDoc =>
	pageDoc.openDoc(load(JSON.parse(text(prepareGameConfigDoc(authored).doc))));
/** What the save says of the body the page PUTs: the issues it refuses with, else its warnings. */
const saveIssues = (live: GameConfigDoc): GameConfigIssue[] => {
	try {
		return prepareGameConfigDoc(JSON.parse(text(pageDoc.bodyFor(live)))).warnings;
	} catch (e) {
		if (!(e instanceof InvalidGameConfigError)) throw e;
		return e.issues;
	}
};
const stored = (live: GameConfigDoc): GameConfigDoc =>
	prepareGameConfigDoc(JSON.parse(text(pageDoc.bodyFor(live)))).doc;
const paths = (issues: GameConfigIssue[]): string[] => issues.map((i) => `${i.severity} ${i.path}`);

/** Every sheet field a doc holds, by character and by class. */
const sheetsOf = (doc: unknown): { characters: Entry; classes: Entry } => {
	const arcade = ((doc as Entry).arcade ?? {}) as Entry;
	const characters = (arcade.characters ?? []) as Entry[];
	const classes = (((arcade.online ?? {}) as Entry).characters ?? []) as Entry[];
	return {
		characters: Object.fromEntries(
			characters.map((c) => [
				c.id,
				{ view: c.view, source: c.source, draw: c.draw, actions: c.actions },
			]),
		),
		classes: Object.fromEntries(classes.map((c) => [c.id, c.sheet])),
	};
};
const SHEETED_STATE = {
	characters: { bearBot: BEAR_SHEET, salmonLook: { view: undefined, ...SALMON_SHEET } },
	classes: { bear: 'bearBot', salmon: 'salmonLook' },
};

// ── 1. the page's issues are the save's ─────────────────────────────────────────────────────────
{
	const live = liveOf(sheeted);
	same(
		'1. (fixture) the live doc holds the sheets it was saved with',
		sheetsOf(live),
		SHEETED_STATE,
	);
	same(
		'1. a sound sheet: the page says what the save says',
		pageDoc.pageIssues(live, 'arcade'),
		saveIssues(live),
	);

	const warned = online(
		[
			bearBot({
				...BEAR_SHEET,
				actions: [{ id: 'walk', when: { motion: 'moving' }, fallback: 'nothing' }],
			}),
			salmonLook(),
		],
		[bear({ sheet: 'bearBot' }), salmon({ sheet: 'nobody' })],
	);
	const liveWarned = liveOf(warned);
	const pageWarned = pageDoc.pageIssues(liveWarned, 'arcade');
	same(
		'1. a sheet that plays but not as it reads: the same warnings',
		pageWarned,
		saveIssues(liveWarned),
	);
	const sheetPaths = [
		'warning arcade.online.characters[1].sheet',
		'warning arcade.characters[0].actions[0].fallback',
		'warning arcade.characters[0].actions',
	];
	check(
		'1. …the sheet’s among them, which the validator alone does not raise',
		sheetPaths.every((p) => paths(pageWarned).includes(p)) &&
			sheetPaths.every((p) => !paths(validateGameConfigDoc(liveWarned)).includes(p)),
		text(paths(pageWarned)),
	);

	const HELD_SHEET = {
		...BEAR_SHEET,
		actions: [
			{ id: 'idle', when: { motion: 'still' } },
			{ id: 'dead', when: { event: 'caught', as: 'target' }, play: 'hold' },
		],
	};
	const liveHeld = liveOf(
		online(
			[bearBot(HELD_SHEET), salmonLook(SALMON_SHEET)],
			[bear({ sheet: 'bearBot' }), salmon({ sheet: 'salmonLook' })],
		),
	);
	same(
		'1. a held action: the page opens it, and its save stores it, as it was authored',
		[
			sheetsOf(liveHeld).characters.bearBot.actions,
			sheetsOf(stored(liveHeld)).characters.bearBot.actions,
		],
		[HELD_SHEET.actions, HELD_SHEET.actions],
	);
	same(
		'1. …and says what the save says of it: a hold nothing played once may cut',
		[pageDoc.pageIssues(liveHeld, 'arcade'), paths(pageDoc.pageIssues(liveHeld, 'arcade'))],
		[saveIssues(liveHeld), ['warning arcade.characters[0].actions[1].play']],
	);

	// Frame clips with no width cannot be saved, so the doc reaches the page through Raw JSON.
	const broken = pageDoc.applyPasted(
		online(
			[bearBot({ ...BEAR_SHEET, draw: undefined }), salmonLook(SALMON_SHEET)],
			[bear({ sheet: 'bearBot' }), salmon({ sheet: 'salmonLook' })],
		),
	) as GameConfigDoc;
	const pageErrors = pageDoc.pageIssues(broken, 'arcade').filter((i) => i.severity === 'error');
	same(
		'1. frame clips with no width: the page’s errors are what the save refuses with',
		pageErrors,
		saveIssues(broken),
	);
	same('1. …at the draw box', paths(pageErrors), ['error arcade.characters[0].draw']);

	const unplayed = (issues: GameConfigIssue[]) =>
		issues.filter((i) => i.message.includes(UNPLAYED_CHARACTER_WARNING)).length;
	const livePlain = liveOf(plain);
	same(
		'1. no sheet: the page says what the save says',
		pageDoc.pageIssues(livePlain, 'arcade'),
		saveIssues(livePlain),
	);
	same(
		'1. a character no bot plays is warned of; not when it is a class’s sheet; the validator alone still does',
		[
			unplayed(pageDoc.pageIssues(livePlain, 'arcade')),
			unplayed(pageDoc.pageIssues(live, 'arcade')),
			unplayed(validateGameConfigDoc(live)),
		],
		[1, 0, 1],
	);

	const flat = pageDoc.pageIssues(live, 'arcade', { projection: 'flat' });
	same(
		'1. the screens’ projection adds only the view warning the save cannot know',
		paths(flat.filter((i) => !text(saveIssues(live)).includes(text(i)))),
		['warning arcade.characters[0].view'],
	);
	same(
		'1. …and none when the view fits the screens',
		pageDoc.pageIssues(live, 'arcade', { projection: 'isometric' }),
		saveIssues(live),
	);
	same(
		'1. the projection is isometric when a screen is, else flat',
		[
			pageDoc.screensProjection([{}, { projection: 'isometric' }]),
			pageDoc.screensProjection([{}, {}]),
			pageDoc.screensProjection([]),
		],
		['isometric', 'flat', 'flat'],
	);

	// Where the page lists them: the Arcade card takes `arcade` bar `arcade.online`
	// (`FamilySection`), the Online room takes its classes' (`OnlineSection`).
	const all = [...pageWarned, ...flat, ...pageDoc.pageIssues(broken, 'arcade')];
	const isSheet = (i: GameConfigIssue) => /^arcade\.(online\.)?characters\[/.test(i.path);
	const arcadeCard = pageDoc
		.issuesUnder(all, 'arcade')
		.filter((i) => !i.path.startsWith('arcade.online'));
	const onlineRoom = onlineDoc.onlineClassIssues(pageDoc.issuesUnder(all, 'arcade.online'));
	check(
		'1. every sheet issue lands in a panel: the Arcade card or the Online room',
		all.filter(isSheet).length >= 5 &&
			all.filter(isSheet).every((i) => arcadeCard.includes(i) !== onlineRoom.includes(i)),
	);
	same(
		'1. …a class’s in the Online room, which its exact-prefix list does not take',
		[
			paths(onlineRoom),
			paths(pageDoc.issuesUnder(all, 'arcade.online.characters').filter(isSheet)),
		],
		[['warning arcade.online.characters[1].sheet'], []],
	);
	// The page computes its issues in two places, the load (first paint) and the live doc; both
	// must be `pageIssues`, or one of them stops saying what the save says.
	const source = (name: string): string =>
		readFileSync(
			fileURLToPath(new URL(`../src/routes/(app)/config/${name}`, import.meta.url)),
			'utf8',
		);
	same(
		'1. the load and the page both list `pageIssues`, with the screens’ projection, and neither validates on its own',
		['+page.server.ts', '+page.svelte'].map((name) => [
			/pageIssues\([^;]*\{ projection/.test(source(name)),
			/validate(GameConfigDoc|CharacterSheets)\(/.test(source(name)),
		]),
		[
			[true, false],
			[true, false],
		],
	);
	same(
		'1. a config with no character: the page says what the validator says',
		pageDoc.pageIssues(pageDoc.openDoc(normalizeGameConfigDoc(seed) as GameConfigDoc), 'arcade'),
		validateGameConfigDoc(normalizeGameConfigDoc(seed) as GameConfigDoc),
	);
}

// ── 2. every edit keeps the sheets of what it keeps ─────────────────────────────────────────────
{
	type Edit = (doc: GameConfigDoc) => unknown;
	/** What an edit removes: classes, characters, or every class (`online`). */
	type Removes = { classes?: string[]; online?: true; all?: true };
	const edits: Record<string, [Edit, Removes?] | 'reads'> = {
		// onlineDoc.ts
		setPlayedOnline: [(d) => onlineDoc.setPlayedOnline(d, false), { online: true }],
		setRoomInt: [(d) => onlineDoc.setRoomInt(d, 'maxPlayers', '8')],
		setRoomSpawn: [(d) => onlineDoc.setRoomSpawn(d, '10', '20')],
		setRoomLayer: [(d) => onlineDoc.setRoomLayer(d, 'top')],
		setNearby: [(d) => onlineDoc.setNearby(d, '800', '600')],
		setNearbyMax: [
			(d) => {
				onlineDoc.setNearby(d, '800', '600');
				onlineDoc.setNearbyMax(d, '1600', '1200');
			},
		],
		setPointerOn: [(d) => onlineDoc.setPointerOn(d, false)],
		setPointerField: [(d) => onlineDoc.setPointerField(d, 'deadZone', '40')],
		setPointerTap: [(d) => onlineDoc.setPointerTap(d, 'bear', 'ability1')],
		pointsText: 'reads',
		addOnlineCharacter: [(d) => onlineDoc.addOnlineCharacter(d, 'arcadeHook')],
		removeOnlineCharacter: [(d) => onlineDoc.removeOnlineCharacter(d, 0), { classes: ['bear'] }],
		classSheet: 'reads',
		sheetUnlinkedNote: 'reads',
		onlineClassIssues: 'reads',
		setOnlineCharacterField: [
			(d) => {
				onlineDoc.setOnlineCharacterField(d, 0, 'speed', '210');
				onlineDoc.setOnlineCharacterField(d, 0, 'max', '2');
				onlineDoc.setOnlineCharacterField(d, 1, 'spawns', '10, 20; 30, 40');
				onlineDoc.setOnlineCharacterField(d, 1, 'body', 'arcadeSalmon');
			},
		],
		addZoneRule: [(d) => onlineDoc.addZoneRule(d, 'pool')],
		removeZoneRule: [(d) => onlineDoc.removeZoneRule(d, 0)],
		setZoneRuleField: [(d) => onlineDoc.setZoneRuleField(d, 0, 'characters', 'bear, salmon')],
		addAbility: [(d) => onlineDoc.addAbility(d)],
		removeAbility: [(d) => onlineDoc.removeAbility(d, 0)],
		setAbilityField: [(d) => onlineDoc.setAbilityField(d, 0, 'reach', '140')],
		setRoundField: [(d) => onlineDoc.setRoundField(d, 'seconds', '90')],
		setLobbyOn: [(d) => onlineDoc.setLobbyOn(d, false)],
		setLobbyField: [(d) => onlineDoc.setLobbyField(d, 'minPlayers', '3')],
		setRulesModule: [(d) => onlineDoc.setRulesModule(d, 'salmons')],
		addBot: [(d) => onlineDoc.addBot(d, 'salmon', 'salmonLook')],
		removeBot: [(d) => onlineDoc.removeBot(d, 0)],
		setBotField: [(d) => onlineDoc.setBotField(d, 0, 'brain', 'salmonLook')],
		setBotsField: [(d) => onlineDoc.setBotsField(d, 'fillTo', '6')],
		// familyDoc.ts
		setFamily: [(d) => familyDoc.setFamily(d, 'match3'), { all: true }],
		setOutcome: [(d) => familyDoc.setOutcome(d, 'rgs')],
		setMinRun: [(d) => familyDoc.setMinRun(d, '4')],
		setMoves: [(d) => familyDoc.setMoves(d, '20')],
		addGoal: [(d) => familyDoc.addGoal(d, 'score', 'A')],
		setGoalField: [
			(d) => {
				familyDoc.addGoal(d, 'score', 'A');
				familyDoc.setGoalField(d, 0, 'target', '5');
			},
		],
		removeGoal: [
			(d) => {
				familyDoc.setMoves(d, '20');
				familyDoc.addGoal(d, 'score', 'A');
				familyDoc.removeGoal(d, 0);
			},
		],
		scoreTableText: 'reads',
		setScoreTable: [(d) => familyDoc.setScoreTable(d, '3:50')],
		stripText: 'reads',
		setStrip: [
			(d) => {
				d.paddingReels.basegame = [[{ name: 'A' }]];
				familyDoc.setStrip(d, 'basegame', 0, 'X, Y, Z');
			},
		],
		setField: [(d) => familyDoc.setField(d, '1000', '800')],
		setFixedHz: [(d) => familyDoc.setFixedHz(d, '30')],
		setNetcode: [(d) => familyDoc.setNetcode(d, 'colyseus')],
		addBody: [(d) => familyDoc.addBody(d, 'arcadeRock')],
		// The body a class and its sheet's character both name: the two still agree, and the
		// validator points at the missing body.
		removeBody: [(d) => familyDoc.removeBody(d, 'arcadeBear')],
		setBodyShape: [(d) => familyDoc.setBodyShape(d, 'arcadeBear', 'box')],
		setBodySize: [(d) => familyDoc.setBodySize(d, 'arcadeBear', 'r', '50')],
		setBodyTags: [(d) => familyDoc.setBodyTags(d, 'arcadeBear', 'hazard, big')],
		setBodySolid: [(d) => familyDoc.setBodySolid(d, 'arcadeBear', true)],
		setBodyGround: [(d) => familyDoc.setBodyGround(d, 'arcadeBear', true)],
		setBodyOneWay: [(d) => familyDoc.setBodyOneWay(d, 'arcadeSalmon', true)],
		setBodyEdges: [(d) => familyDoc.setBodyEdges(d, 'arcadeBear', 'wrap')],
		setPairs: [(d) => familyDoc.setPairs(d, 'player + hazard')],
		pairsText: 'reads',
		addZone: [(d) => familyDoc.addZone(d)],
		removeZone: [(d) => familyDoc.removeZone(d, 0)],
		setZoneField: [(d) => familyDoc.setZoneField(d, 0, 'id', 'lake')],
		setCardRule: [(d) => familyDoc.setCardRule(d, 'handLimit', '7')],
		setCardResource: [(d) => familyDoc.setCardResource(d, 'max', '9')],
		setCardFirst: [(d) => familyDoc.setCardFirst(d, 'player')],
		setCardTurnOrder: [(d) => familyDoc.setCardTurnOrder(d, 'mixed')],
	};
	same(
		'2. every export of onlineDoc.ts and familyDoc.ts is audited here',
		[...Object.keys(onlineDoc), ...Object.keys(familyDoc)].sort(),
		Object.keys(edits).sort(),
	);

	const base = liveOf(sheeted);
	for (const [name, edit] of Object.entries(edits)) {
		if (edit === 'reads') continue;
		const [run, removes = {}] = edit;
		const doc = structuredClone(base);
		const before = text(doc);
		run(doc);
		check(`2. (fixture) ${name} changes the doc`, text(doc) !== before);
		const gone = removes.classes ?? [];
		const expected = removes.all
			? { characters: {}, classes: {} }
			: {
					characters: SHEETED_STATE.characters,
					classes: removes.online
						? {}
						: Object.fromEntries(
								Object.entries(SHEETED_STATE.classes).filter(([id]) => !gone.includes(id)),
							),
				};
		const kept = sheetsOf(doc);
		// A class an edit ADDS has no sheet; only the kept ones are compared.
		for (const id of Object.keys(kept.classes))
			if (!(id in SHEETED_STATE.classes)) delete kept.classes[id];
		same(`2. ${name} keeps the sheets of what it keeps`, kept, expected);
	}

	const renamed = structuredClone(base);
	onlineDoc.setOnlineCharacterField(renamed, 0, 'id', 'grizzly');
	same('2. a class renamed keeps its sheet', sheetsOf(renamed), {
		characters: SHEETED_STATE.characters,
		classes: { grizzly: 'bearBot', salmon: 'salmonLook' },
	});
	same('2. …into the save', sheetsOf(stored(renamed)).classes, {
		grizzly: 'bearBot',
		salmon: 'salmonLook',
	});
	same(
		'2. …which draws the renamed class with it',
		[onlineDoc.classSheet(renamed, 0), onlineDoc.classSheet(renamed, 1)],
		[
			{ id: 'bearBot', inForce: true },
			{ id: 'salmonLook', inForce: true },
		],
	);

	const off = structuredClone(base);
	onlineDoc.setPlayedOnline(off, false);
	onlineDoc.setPlayedOnline(off, true);
	same(
		'2. online off, then on: the sheets stay on their characters, the links are gone',
		sheetsOf(off),
		{
			characters: SHEETED_STATE.characters,
			classes: {},
		},
	);

	const chained = structuredClone(base);
	for (const edit of Object.values(edits)) if (edit !== 'reads' && !edit[1]) edit[0](chained);
	same(
		'2. every edit that removes nothing, one after another, then the normalizer and the carry of a save: the sheets as authored',
		sheetsOf(load(JSON.parse(text(pageDoc.bodyFor(chained))))).characters,
		SHEETED_STATE.characters,
	);
}

// ── 3. a class's change of body ─────────────────────────────────────────────────────────────────
{
	const base = liveOf(sheeted);
	const doc = structuredClone(base);
	const unlinked = onlineDoc.setOnlineCharacterField(doc, 0, 'body', 'arcadeSalmon');
	same('3. a body of another component: the removal is answered', unlinked, {
		classId: 'bear',
		sheet: 'bearBot',
		component: 'arcadeBear',
		body: 'arcadeSalmon',
	});
	same('3. …the class has the new body and no sheet key', doc.arcade?.online?.characters[0], {
		id: 'bear',
		body: 'arcadeSalmon',
		speed: 190,
	});
	same('3. …and nothing else of the sheets changed', sheetsOf(doc), {
		characters: SHEETED_STATE.characters,
		classes: { bear: undefined, salmon: 'salmonLook' },
	});
	check(
		'3. …so the page no longer shows one on its row, and the save is not warned of the pair',
		onlineDoc.classSheet(doc, 0) === undefined &&
			!paths(saveIssues(doc)).includes('warning arcade.online.characters[0].sheet'),
	);
	const note = unlinked ? onlineDoc.sheetUnlinkedNote(unlinked) : '';
	check(
		'3. the note names the class, the character, its component and the new body',
		['"bear"', '"bearBot"', '"arcadeBear"', '"arcadeSalmon"'].every((part) => note.includes(part)),
		note,
	);

	const noop = structuredClone(base);
	same(
		'3. the same body, an empty one and another field remove nothing',
		[
			onlineDoc.setOnlineCharacterField(noop, 0, 'body', 'arcadeBear'),
			onlineDoc.setOnlineCharacterField(noop, 0, 'body', '  '),
			onlineDoc.setOnlineCharacterField(noop, 0, 'speed', '200'),
			onlineDoc.setOnlineCharacterField(noop, 0, 'id', 'grizzly'),
			sheetsOf(noop).classes,
		],
		[undefined, undefined, undefined, undefined, { grizzly: 'bearBot', salmon: 'salmonLook' }],
	);

	// A class whose sheet is another component's (warned of, drawn as before): choosing that
	// component puts the sheet in force, so it is kept.
	const mismatched = liveOf(
		online(
			[bearBot(BEAR_SHEET), salmonLook(SALMON_SHEET)],
			[bear({ sheet: 'salmonLook' }), salmon({ sheet: 'nobody' })],
		),
	);
	same(
		'3. (fixture) a sheet of another component is not in force',
		onlineDoc.classSheet(mismatched, 0),
		{
			id: 'salmonLook',
			inForce: false,
		},
	);
	same(
		'3. the body it already has removes nothing, even from a sheet not in force',
		[
			onlineDoc.setOnlineCharacterField(mismatched, 0, 'body', 'arcadeBear'),
			onlineDoc.classSheet(mismatched, 0),
		],
		[undefined, { id: 'salmonLook', inForce: false }],
	);
	same(
		'3. a body of the sheet’s component keeps the sheet, now in force',
		[
			onlineDoc.setOnlineCharacterField(mismatched, 0, 'body', 'arcadeSalmon'),
			onlineDoc.classSheet(mismatched, 0),
		],
		[undefined, { id: 'salmonLook', inForce: true }],
	);
	same(
		'3. a sheet naming no character is not the body’s to remove: kept, and still warned of',
		[
			onlineDoc.setOnlineCharacterField(mismatched, 1, 'body', 'arcadeBear'),
			onlineDoc.classSheet(mismatched, 1),
			paths(pageDoc.pageIssues(mismatched, 'arcade')).includes(
				'warning arcade.online.characters[1].sheet',
			),
		],
		[undefined, { id: 'nobody', inForce: false }, true],
	);
	same('3. a class with no sheet shows none', onlineDoc.classSheet(liveOf(plain), 0), undefined);

	const removed = structuredClone(base);
	onlineDoc.removeOnlineCharacter(removed, 0);
	same('3. a class removed takes its link, and no sheet', sheetsOf(removed), {
		characters: SHEETED_STATE.characters,
		classes: { salmon: 'salmonLook' },
	});
}

// ── 4. a reset, and turning online off ──────────────────────────────────────────────────────────
{
	const live = liveOf(sheeted);
	const template = normalizeGameConfigDoc(seed) as GameConfigDoc;
	same('4. the sheets a config holds, and the classes naming one', pageDoc.sheetsHeld(live), {
		sheets: 2,
		links: 2,
	});
	same(
		'4. a character with none of the four fields and a class naming none are not counted',
		[
			pageDoc.sheetsHeld(liveOf(online([bearBot(BEAR_SHEET), salmonLook()], [bear(), salmon()]))),
			pageDoc.sheetsHeld(liveOf(plain)),
			pageDoc.sheetsHeld(template),
			pageDoc.sheetsHeld(null),
		],
		[
			{ sheets: 1, links: 0 },
			{ sheets: 0, links: 0 },
			{ sheets: 0, links: 0 },
			{ sheets: 0, links: 0 },
		],
	);
	const reset = pageDoc.resetTo(template, live);
	same(
		'4. a reset replaces the characters, and their sheets with them',
		pageDoc.sheetsHeld(reset),
		{
			sheets: 0,
			links: 0,
		},
	);
	same('4. …the template’s arcade block is what is left', reset.arcade, template.arcade);
	same(
		'4. …also when the reset’s characters have the same ids and components',
		[
			pageDoc.sheetsHeld(pageDoc.resetTo(liveOf(plain), live)),
			characterSheetOf(pageDoc.resetTo(liveOf(plain), live), 'bearBot'),
		],
		[{ sheets: 0, links: 0 }, undefined],
	);
	const note = pageDoc.sheetsRemovedNote(live);
	check(
		'4. the confirmation counts both, and says where they come back from',
		note.includes('2 character sheets') &&
			note.includes('2 online class links') &&
			note.includes('History'),
		note,
	);
	const one = pageDoc.sheetsRemovedNote(
		liveOf(online([bearBot(BEAR_SHEET), salmonLook()], [bear({ sheet: 'bearBot' }), salmon()])),
	);
	check(
		'4. …one of each in the singular',
		one.includes('1 character sheet and 1 online class’s link') ||
			one.includes("1 character sheet and 1 online class's link"),
		one,
	);
	same(
		'4. a config with no sheet adds nothing to a confirmation',
		[pageDoc.sheetsRemovedNote(liveOf(plain)), pageDoc.sheetLinksRemovedNote(liveOf(plain))],
		['', ''],
	);
	const links = pageDoc.sheetLinksRemovedNote(live);
	check(
		'4. turning online off counts the links it removes',
		links.includes('2 classes name'),
		links,
	);
}

// ── 5. Raw JSON's Apply ─────────────────────────────────────────────────────────────────────────
{
	const live = liveOf(sheeted);
	/** The text the page prints, edited, then Apply. */
	const apply = (edit: (shown: Entry) => void = () => {}): GameConfigDoc => {
		const shown: Entry = JSON.parse(JSON.stringify(live, null, 2));
		edit(shown);
		const next = pageDoc.applyPasted(shown);
		if (!next) throw new Error('fixture: the paste was refused');
		return next;
	};
	const arcadeOf = (shown: Entry) =>
		shown.arcade as { characters: Entry[]; online: { characters: Entry[] } };
	same('5. the text untouched: Apply keeps every sheet', sheetsOf(apply()), SHEETED_STATE);
	same('5. …and the save stores the config it had', stored(apply()), stored(live));
	const edited = apply((shown) => {
		delete arcadeOf(shown).characters[1].source;
		delete arcadeOf(shown).characters[1].draw;
		delete arcadeOf(shown).characters[1].actions;
		delete arcadeOf(shown).online.characters[0].sheet;
		(arcadeOf(shown).characters[0].draw as Entry).width = 120;
	});
	const expected = {
		characters: {
			bearBot: { ...BEAR_SHEET, draw: { ...BEAR_SHEET.draw, width: 120 } },
			salmonLook: {},
		},
		classes: { bear: undefined, salmon: 'salmonLook' },
	};
	same(
		'5. a sheet removed from the text is removed, one edited is the pasted one',
		sheetsOf(edited),
		expected,
	);
	same('5. …into the save', sheetsOf(stored(edited)), expected);
	check(
		'5. …and the page then says the class names a character with no sheet, as the save does',
		paths(pageDoc.pageIssues(edited, 'arcade')).includes(
			'warning arcade.online.characters[1].sheet',
		) && text(pageDoc.pageIssues(edited, 'arcade')) === text(saveIssues(edited)),
	);
}

// ── 6. a config with no sheet ───────────────────────────────────────────────────────────────────
{
	const normalized = normalizeGameConfigDoc(structuredClone(plain)) as GameConfigDoc;
	const loaded = load(JSON.parse(text(normalized)));
	const body = pageDoc.bodyFor(pageDoc.openDoc(loaded));
	same('6. no sheet: the body the page PUTs is the stored doc', body, normalized);
	same(
		'6. …and the save stores what the normalizer makes',
		prepareGameConfigDoc(body).doc,
		normalized,
	);
	const keys = new Set<string>();
	const walk = (v: unknown): void => {
		if (Array.isArray(v)) return v.forEach(walk);
		if (!v || typeof v !== 'object') return;
		for (const [key, value] of Object.entries(v)) {
			keys.add(key);
			walk(value);
		}
	};
	walk((prepareGameConfigDoc(body).doc.arcade ?? {}) as Entry);
	same(
		'6. …with no sheet key anywhere in its arcade block',
		['view', 'source', 'draw', 'actions', 'sheet'].filter((key) => keys.has(key)),
		[],
	);
	const edited = pageDoc.openDoc(loaded);
	onlineDoc.setOnlineCharacterField(edited, 0, 'body', 'arcadeSalmon');
	same(
		'6. a change of body on a class with no sheet answers nothing and adds no key',
		[Object.keys(edited.arcade?.online?.characters[0] ?? {}), pageDoc.sheetsHeld(edited)],
		[['id', 'body', 'speed'], { sheets: 0, links: 0 }],
	);
}

if (fails) {
	console.error(`\ncheck:config-character-sheets — ${fails} FAILED, ${passes} passed`);
	process.exit(1);
}
console.log(`check:config-character-sheets — ${passes} passed`);
