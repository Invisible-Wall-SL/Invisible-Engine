/**
 * check:game-config-family — the authoring side of the game families (`docs/design/game-families.md`
 * §6.1, §6.2, §7.2 P10.1).
 *
 *   pnpm --filter launcher-api check:game-config-family
 *
 *  1. CAPABILITIES. A match-3 or arcade project — by its kind, or by its config's family — is
 *     offered none of a slot's sections; its outcome decides the wallet; a match-3 board tumbles and
 *     pops its matches. A slot kind answers the three new flags `true` and every other flag as with
 *     no family at all (the full slot table is pinned by `check:symbols-kind-gating`).
 *  2. THE PICKER MIRRORS THE NORMALIZER. Every `/config` family setter (`familyDoc.ts`, and the
 *     online room / rules / bots setters in `onlineDoc.ts`) leaves the doc exactly as a save would
 *     store it, so the page never looks dirty for a value a save drops.
 *  3. THE PAGE SHOWS EACH FAMILY §6.2's SECTIONS. `/config` is rendered on the server for a slot, a
 *     match-3 game decided each way and an arcade game: a non-slot family shows exactly its
 *     sections, and a slot project shows no family picker and no section outside the slot's. Only
 *     an arcade page shows the Characters line (its count and the link to Invisible Characters),
 *     and only an online arcade page its Online room, Mouse and touch, Online rules and Bots sections.
 *  4. THE FAMILY GATE. Publish and the bake refuse a non-slot config, never a slot one.
 *  5. CHARACTER SHEETS ARE CARRIED, NOT NORMALIZED (`docs/design/character-pipeline.md` §9, step
 *     C2a; `game-config` `characterSheet.ts`). A stored config with no sheet comes back byte for
 *     byte and as the same object through the carry; one with a canonical sheet comes back byte
 *     for byte through a load and the real save's `prepareGameConfigDoc`; a default, an unknown
 *     field and an unreadable value are dropped; `normalizeGameConfigDoc` alone still drops the
 *     sheet (it is in the slot, match-3 and card bundles, which must keep their bytes); the game
 *     server's read of the config is the same with and without sheets; the save refuses frame
 *     clips with no width or no action, and only warns of a sheet that plays but not as it reads
 *     and of a class whose `sheet` cannot be used (it is drawn as before, so a renamed or removed
 *     character never locks a project's saves); nothing is reported for a block the normalizer
 *     does not store; a sheet is read up to `CHARACTER_SHEET_LIMITS`; a variant or a point may
 *     have any name but `__proto__`; Raw JSON's Apply (`pageDoc.ts`) keeps the pasted sheets; and
 *     the validator's "a character no bot plays" warning is dropped exactly when every such
 *     character is a class's sheet.
 *  6. THE ROOM'S SIZE AND THE BOTS' SHARES (`arcade.online.maxPlayers`, `bots.characters[].share`).
 *     `botShareCounts` at every size from the number of classes to 100, for five share sets: the
 *     counts sum to the size, no class has none, none has a whole place more than its quota, and
 *     (where no quota is under 1) none a whole place less. A config by count is stored and resolved
 *     as before; one by shares round-trips, resolves its counts, each class's places and a full
 *     room, and a test room's size is held to `onlineTestSizeRange`. Every validator rule of the
 *     shares is pinned.
 *  7. TOUCH CONTROL SCHEMES ARE CARRIED, AND EDITED AS STORED (`arcade.online.touch`, `game-config`
 *     `touchScheme.ts`; `docs/design/arcade-touch-controls.md`). A stored config with no touch
 *     block comes back byte for byte through a load and the real save, as the same object through
 *     the carry and with no `touch` key; one with schemes keeps them through the save and a load,
 *     though the normalizer alone drops them; what a save warns of them the page lists too. Every
 *     setter of `config/touchDoc.ts` (add from a preset, rename, duplicate, delete, a field, a
 *     class's scheme) leaves the block exactly as it is stored: a default is not stored, a class
 *     names a scheme that exists, a deleted scheme un-assigns its classes and the last one takes
 *     the block. A class renamed keeps its scheme and one removed loses it. Raw JSON's Apply keeps
 *     the pasted schemes, and `/config` renders the editor in the Mouse and touch card.
 */

import { createServer } from 'vite';
import {
	CHARACTER_SHEET_LIMITS,
	CONFIG_SECTIONS,
	UNPLAYED_CHARACTER_WARNING,
	botShareCounts,
	botsByShares,
	characterActionPlay,
	characterActionPriority,
	characterSheetClipRoots,
	characterSheetRigRoots,
	characterSheetStillRoots,
	characterSheetOf,
	characterTriggers,
	characterViewFacings,
	configSectionsFor,
	isClipSheet,
	normalizeCharacterSheet,
	normalizeGameConfigDoc,
	onlineClassSheetOf,
	onlineGameOf,
	onlineTestSizeRange,
	resolveArcadeOnline,
	sheetAwareIssues,
	validateCharacterSheets,
	validateGameConfigDoc,
	ARCADE_TOUCH_DEFAULTS,
	ARCADE_TOUCH_LIMITS,
	ARCADE_TOUCH_PRESETS,
	slideOf,
	touchOf,
	withCharacterSheets,
	withOnlineCarry,
	withSlide,
	withTouchSchemes,
	type ConfigSection,
	type GameConfigDoc,
	type GameConfigIssue,
} from 'game-config';
import { GAME_KINDS, SLOT_GAME_KINDS, familyOfKind } from 'constants-shared/gameKinds';
import { kindCapabilities, type KindCapabilities } from 'engine-layout';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { projectAddOns } from '../src/lib/addOns.ts';
import { mechanicFor } from 'engine-game/src/game/mechanic';
import { partnerRgsRefusal, unplayableFamilyMessage } from '../src/lib/server/familyGate.ts';
import * as familyDoc from '../src/routes/(app)/config/familyDoc.ts';
import * as pageDoc from '../src/routes/(app)/config/pageDoc.ts';
import * as onlineDoc from '../src/routes/(app)/config/onlineDoc.ts';
import * as touchDoc from '../src/routes/(app)/config/touchDoc.ts';
import * as touchText from '../src/lib/touch/touchSchemeText.ts';
import * as wildsDoc from '../src/routes/(app)/config/wildsDoc.ts';

let fails = 0;
let passes = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
	if (ok) passes++;
	else {
		fails++;
		console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
	}
};
const same = (name: string, actual: unknown, expected: unknown): void =>
	check(
		name,
		JSON.stringify(actual) === JSON.stringify(expected),
		`${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`,
	);

// ── 1. capabilities ─────────────────────────────────────────────────────────────────────────────
const NONE_OF_A_SLOT: Partial<KindCapabilities> = {
	freeSpins: false,
	bookReveal: false,
	stackedPictures: false,
	multiplierCollect: false,
	holdAndWin: false,
	coinSymbols: false,
	pots: false,
	potsOverlay: false,
	winLines: false,
	bookSymbolVfx: false,
	symbolTransition: false,
};
const pick = (caps: KindCapabilities, keys: string[]) =>
	Object.fromEntries(keys.map((k) => [k, caps[k as keyof KindCapabilities]]));
for (const [label, kind, config] of [
	['the match3 kind', 'match3', {}],
	['a slot kind with a match-3 config', 'lines', { family: 'match3' }],
	[
		'a Hold and Win kind with a match-3 config and a bonus',
		'holdAndWin',
		{ family: 'match3', holdAndWin: true, potsOverlay: true },
	],
] as const) {
	const caps = kindCapabilities(kind, config);
	same(
		`1. ${label}: none of a slot's sections`,
		pick(caps, Object.keys(NONE_OF_A_SLOT)),
		NONE_OF_A_SLOT,
	);
	same(
		`1. ${label}: a board that tumbles and pops`,
		[caps.board, caps.cascade, caps.tumblePattern],
		[true, true, true],
	);
	same(`1. ${label}: RGS-decided, so a wallet`, [caps.wallet, caps.betControls], [true, true]);
	same(`1. ${label}: the player moves its gems`, caps.boardInput, true);
}
same(
	'1. a match-3 rules game has no wallet',
	pick(kindCapabilities('match3', { outcome: 'rules' }), ['wallet', 'betControls']),
	{ wallet: false, betControls: false },
);
for (const [label, kind, config] of [
	['the arcade kind', 'arcade', { outcome: 'rules' }],
	['a slot kind with an arcade config', 'ways', { family: 'arcade', outcome: 'rules' }],
] as const) {
	const caps = kindCapabilities(kind, config);
	same(
		`1. ${label}: none of a slot's sections`,
		pick(caps, Object.keys(NONE_OF_A_SLOT)),
		NONE_OF_A_SLOT,
	);
	same(
		`1. ${label}: no board, no wallet`,
		[caps.board, caps.cascade, caps.tumblePattern, caps.wallet, caps.betControls],
		[false, false, false, false, false],
	);
}
for (const kind of [...GAME_KINDS, 'myCustomKind', 'toString', undefined]) {
	// `kindCapabilities` names the non-slot kinds itself (engine-layout loads with no install).
	same(
		`1. ${kind}: kindCapabilities reads the family familyOfKind gives`,
		kindCapabilities(kind),
		kindCapabilities(kind, { family: familyOfKind(kind) }),
	);
}
for (const kind of [...SLOT_GAME_KINDS, 'myCustomKind', undefined]) {
	const caps = kindCapabilities(kind);
	same(
		`1. ${kind}: a wallet, bet controls and a board`,
		[caps.wallet, caps.betControls, caps.board],
		[true, true, true],
	);
	same(
		`1. ${kind}: naming the slot family changes nothing`,
		kindCapabilities(kind, { family: 'slot', outcome: 'rgs' }),
		caps,
	);
	same(
		`1. ${kind}: a rules outcome on a slot changes nothing`,
		kindCapabilities(kind, { outcome: 'rules' }),
		caps,
	);
}
{
	// What the tools pass `kindCapabilities`: a slot config adds no family key, so its answers are
	// unchanged; a match-3 config on a slot kind's project is offered match-3's.
	const slotDoc = { symbols: { A: {} }, paddingReels: { basegame: [[{ name: 'A' }]] } };
	const addOns = projectAddOns(slotDoc as never).addOns;
	same(
		'1. a slot config adds no family to the add-ons',
		[Object.hasOwn(addOns, 'family'), Object.hasOwn(addOns, 'outcome')],
		[false, false],
	);
	const m3 = projectAddOns({ ...slotDoc, family: 'match3', outcome: 'rules' } as never).addOns;
	same(
		'1. a match-3 config adds its family and outcome',
		[m3.family, m3.outcome],
		['match3', 'rules'],
	);
	same(
		'1. …so a lines project with a match-3 config gets match-3 answers',
		pick(kindCapabilities('lines', m3), ['freeSpins', 'board', 'wallet']),
		{ freeSpins: false, board: true, wallet: false },
	);
}
same(
	'1. a match-3 config on the arcade kind is match-3',
	kindCapabilities('arcade', { family: 'match3' }).board,
	true,
);

// ── 2. the picker mirrors the normalizer ────────────────────────────────────────────────────────
const SLOT: GameConfigDoc = normalizeGameConfigDoc({
	numReels: 3,
	numRows: [3, 3, 3],
	betModes: { base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 1000 } },
	paylines: { '1': [0, 0, 0] },
	symbols: { A: { paytable: [{ '3': 5 }] }, B: {} },
	paddingReels: {
		basegame: [
			['A', 'B', 'A'],
			['B', 'A', 'B'],
			['A', 'B', 'A'],
		],
	},
	winModel: { type: 'cluster', minCluster: 3, adjacency: 'orthogonal' },
	cascade: false,
})!;
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
let doc: GameConfigDoc = structuredClone(SLOT);
const step = (
	label: string,
	edit: (d: GameConfigDoc) => void,
	expect?: (d: GameConfigDoc) => boolean,
) => {
	edit(doc);
	// A save stores the normalized doc with the rules' `carry` and `stains` carried past it
	// (`gameConfigStorage.ts` `withStoredBlocks`).
	const stored = withOnlineCarry(normalizeGameConfigDoc(structuredClone(doc)), doc);
	check(
		`2. ${label}: the page holds what a save stores`,
		JSON.stringify(canonical(stored)) === JSON.stringify(canonical(doc)),
		JSON.stringify(doc),
	);
	if (expect) check(`2. ${label}: as expected`, expect(doc), JSON.stringify(doc));
};
step(
	'slot → match-3',
	(d) => familyDoc.setFamily(d, 'match3'),
	(d) => d.family === 'match3' && !d.winModel && d.cascade === undefined,
);
step(
	'the default min run',
	(d) => familyDoc.setMinRun(d, '3'),
	(d) => d.match3 === undefined,
);
step(
	'a min run of 4',
	(d) => familyDoc.setMinRun(d, '4'),
	(d) => d.match3?.minRun === 4,
);
step(
	'a min run of 1 is not a run',
	(d) => familyDoc.setMinRun(d, '1'),
	(d) => d.match3 === undefined,
);
step(
	'rules',
	(d) => familyDoc.setOutcome(d, 'rules'),
	(d) => d.outcome === 'rules',
);
step(
	'moves',
	(d) => familyDoc.setMoves(d, '20'),
	(d) => d.match3?.moves === 20,
);
step('a score goal', (d) => familyDoc.addGoal(d, 'score', 'A'));
step('a collect goal', (d) => familyDoc.addGoal(d, 'collect', 'A'));
step(
	'a goal count',
	(d) => familyDoc.setGoalField(d, 1, 'count', '7'),
	(d) => d.match3?.goals?.[1]?.type === 'collect',
);
step('a bad goal target is ignored', (d) => familyDoc.setGoalField(d, 0, 'target', '-3'));
step(
	'a score table, typed out of order',
	(d) => familyDoc.setScoreTable(d, '5:300, 3:50, x:1, 4:'),
	(d) => familyDoc.scoreTableText(d) === '3:50, 5:300',
);
step(
	'a refill strip',
	(d) => familyDoc.setStrip(d, 'basegame', 1, 'B, A , ,B'),
	(d) => familyDoc.stripText(d, 'basegame', 1) === 'B, A, B',
);
step(
	'remove both goals',
	(d) => {
		familyDoc.removeGoal(d, 0);
		familyDoc.removeGoal(d, 0);
	},
	(d) => d.match3?.goals === undefined,
);
step(
	'back to rgs',
	(d) => familyDoc.setOutcome(d, 'rgs'),
	(d) => d.outcome === undefined && d.match3?.moves === 20,
);
step(
	'match-3 → arcade',
	(d) => familyDoc.setFamily(d, 'arcade'),
	(d) => d.family === 'arcade' && d.outcome === 'rules' && !d.match3,
);
step(
	'a field',
	(d) => familyDoc.setField(d, '1080', '1920'),
	(d) => d.arcade?.field?.w === 1080,
);
step(
	'half a field clears it',
	(d) => familyDoc.setField(d, '1080', ''),
	(d) => d.arcade === undefined,
);
step(
	'the default rate',
	(d) => familyDoc.setFixedHz(d, '60'),
	(d) => d.arcade === undefined,
);
step(
	'a rate',
	(d) => familyDoc.setFixedHz(d, '120'),
	(d) => d.arcade?.fixedHz === 120,
);
step(
	'a body',
	(d) => familyDoc.addBody(d, ' player '),
	(d) => d.arcade?.bodies?.player?.shape === 'box',
);
step(
	'a circle',
	(d) => familyDoc.setBodyShape(d, 'player', 'circle'),
	(d) => d.arcade?.bodies?.player?.shape === 'circle',
);
step('a radius', (d) => familyDoc.setBodySize(d, 'player', 'r', '40'));
step(
	'tags',
	(d) => familyDoc.setBodyTags(d, 'player', 'player, hero, player, '),
	(d) => d.arcade?.bodies?.player?.tags?.length === 2,
);
step(
	'ground',
	(d) => familyDoc.setBodyGround(d, 'player', true),
	(d) => d.arcade?.bodies?.player?.ground === true,
);
step(
	'one-way',
	(d) => familyDoc.setBodyOneWay(d, 'player', true),
	(d) => d.arcade?.bodies?.player?.oneWay === true,
);
step(
	'a box keeps ground and one-way',
	(d) => familyDoc.setBodyShape(d, 'player', 'box'),
	(d) => d.arcade?.bodies?.player?.ground === true && d.arcade.bodies.player.oneWay === true,
);
step(
	'solid drops one-way',
	(d) => familyDoc.setBodySolid(d, 'player', true),
	(d) => d.arcade?.bodies?.player?.solid === true && d.arcade.bodies.player.oneWay === undefined,
);
step(
	'one-way on a solid is refused',
	(d) => familyDoc.setBodyOneWay(d, 'player', true),
	(d) => d.arcade?.bodies?.player?.oneWay === undefined,
);
step(
	'not solid',
	(d) => familyDoc.setBodySolid(d, 'player', false),
	(d) => d.arcade?.bodies?.player?.solid === undefined,
);
step(
	'not ground',
	(d) => familyDoc.setBodyGround(d, 'player', false),
	(d) => d.arcade?.bodies?.player?.ground === undefined,
);
step(
	'remove the body',
	(d) => familyDoc.removeBody(d, 'player'),
	(d) => d.arcade?.bodies === undefined,
);
step(
	'netcode on a game that is not online is ignored',
	(d) => familyDoc.setNetcode(d, 'colyseus'),
	(d) => d.arcade?.online === undefined,
);
step('an online block', (d) => {
	(d.arcade ??= {}).online = { characters: [] };
});
step(
	'netcode colyseus',
	(d) => familyDoc.setNetcode(d, 'colyseus'),
	(d) => d.arcade?.online?.netcode === 'colyseus',
);
step(
	'netcode engine (the default)',
	(d) => familyDoc.setNetcode(d, 'engine'),
	(d) => d.arcade?.online !== undefined && !('netcode' in d.arcade.online),
);
step(
	'an unknown netcode',
	(d) => familyDoc.setNetcode(d, 'rollback'),
	(d) => d.arcade?.online !== undefined && !('netcode' in d.arcade.online),
);
const online = () => doc.arcade!.online!;
step('a body and a zone to play on', (d) => {
	familyDoc.addBody(d, 'salmon');
	familyDoc.addZone(d);
	d.arcade!.characters = normalizeGameConfigDoc({
		family: 'arcade',
		outcome: 'rules',
		arcade: { characters: [{ id: 'hunter', component: 'bear' }] },
	})!.arcade!.characters;
});
step(
	'a room size, and the default one',
	(d) => {
		onlineDoc.setRoomInt(d, 'maxPlayers', '100');
		onlineDoc.setRoomInt(d, 'tickHz', '30');
		onlineDoc.setRoomInt(d, 'rejoinSeconds', '0');
		onlineDoc.setRoomInt(d, 'subSteps', '0');
	},
	(d) =>
		d.arcade?.online?.maxPlayers === 100 &&
		!('tickHz' in online()) &&
		online().rejoinSeconds === 0 &&
		!('subSteps' in online()),
);
step(
	'a spawn, a layer and a nearby box; half of one clears it',
	(d) => {
		onlineDoc.setRoomSpawn(d, '200', '3000');
		onlineDoc.setRoomLayer(d, ' river ');
		onlineDoc.setNearby(d, '2400', '1800');
		onlineDoc.setRoomLayer(d, 'field');
		onlineDoc.setNearby(d, '2400', '');
	},
	(d) => d.arcade?.online?.spawn?.y === 3000 && !('layer' in online()) && !('nearby' in online()),
);
step(
	'a nearby max needs a box; with one it is stored, half of one clears it, and a new box keeps it',
	(d) => {
		onlineDoc.setNearbyMax(d, '6400', '6400');
		onlineDoc.setNearby(d, '3300', '3300');
		onlineDoc.setNearbyMax(d, '6400', '');
		onlineDoc.setNearbyMax(d, '6400', '4600');
		onlineDoc.setNearby(d, '2400', '1800');
	},
	(d) =>
		JSON.stringify(d.arcade?.online?.nearby) ===
		JSON.stringify({ w: 2400, h: 1800, max: { w: 6400, h: 4600 } }),
);
step(
	'clearing the max leaves the box',
	(d) => onlineDoc.setNearbyMax(d, '', ''),
	(d) => JSON.stringify(d.arcade?.online?.nearby) === JSON.stringify({ w: 2400, h: 1800 }),
);
step(
	'clearing the box takes its max with it',
	(d) => {
		onlineDoc.setNearbyMax(d, '6400', '6400');
		onlineDoc.setNearby(d, '', '1800');
	},
	() => !('nearby' in online()),
);
step(
	'mouse and touch on: every default; tuned; a default value, a bad tap and off clear',
	(d) => {
		onlineDoc.setPointerOn(d, true);
		onlineDoc.setPointerField(d, 'mouse', 'hover');
		onlineDoc.setPointerField(d, 'deadZone', '72');
		onlineDoc.setPointerField(d, 'tapPx', '12');
		onlineDoc.setPointerTap(d, 'salmon', 'jump');
		onlineDoc.setPointerTap(d, 'bear', 'kick');
	},
	(d) =>
		JSON.stringify(d.arcade?.online?.pointer) ===
		JSON.stringify({ mouse: 'hover', deadZone: 72, taps: { salmon: 'jump' } }),
);
step(
	'mouse and touch: the default mouse, an emptied tap, then off',
	(d) => {
		onlineDoc.setPointerField(d, 'mouse', 'press');
		onlineDoc.setPointerTap(d, 'salmon', '');
		onlineDoc.setPointerField(d, 'deadZone', '');
	},
	(d) => JSON.stringify(d.arcade?.online?.pointer) === '{}',
);
step(
	'mouse and touch off',
	(d) => onlineDoc.setPointerOn(d, false),
	() => !('pointer' in online()),
);
step(
	'a character needs a body',
	(d) => onlineDoc.addOnlineCharacter(d, ' '),
	(d) => d.arcade?.online?.characters.length === 0,
);
step(
	'two characters',
	(d) => {
		onlineDoc.addOnlineCharacter(d, 'salmon');
		onlineDoc.addOnlineCharacter(d, 'salmon');
		onlineDoc.setOnlineCharacterField(d, 1, 'id', 'character1');
		onlineDoc.setOnlineCharacterField(d, 0, 'speed', '-4');
		onlineDoc.setOnlineCharacterField(d, 1, 'max', '6');
		onlineDoc.setOnlineCharacterField(d, 1, 'spawns', '10, 20; nonsense; 30, 40');
	},
	(d) =>
		d.arcade?.online?.characters.map((c) => c.id).join() === 'character1,character2' &&
		online().characters[0].speed === 300 &&
		online().characters[1].max === 6 &&
		online().characters[1].spawns?.length === 2,
);
step(
	'a zone rule: the goal, then a current, then neither is refused',
	(d) => {
		onlineDoc.addZoneRule(d, 'zone1');
		onlineDoc.setZoneRuleField(d, 0, 'forceY', '-80');
		onlineDoc.setZoneRuleField(d, 0, 'goal', false);
		onlineDoc.setZoneRuleField(d, 0, 'forceY', '0');
		onlineDoc.setZoneRuleField(d, 0, 'characters', 'character1, character1');
	},
	(d) =>
		d.arcade?.online?.rules?.zones?.[0].force?.y === -80 &&
		!('goal' in online().rules!.zones![0]) &&
		online().rules!.zones![0].characters?.join() === 'character1',
);
step(
	'P11.3: a solid or a kind keeps a zone rule, so its goal unticks and its push clears',
	(d) => {
		online().rules!.zones!.push(
			{ zone: 'zone1', goal: true, solid: true },
			{ zone: 'zone1', force: { x: 5, y: 0 }, kind: 'sandbank' },
		);
		onlineDoc.setZoneRuleField(d, 1, 'goal', false);
		onlineDoc.setZoneRuleField(d, 2, 'forceX', '0');
	},
	(d) => {
		const [, solid, kind] = d.arcade?.online?.rules?.zones ?? [];
		return (
			solid?.solid === true && !('goal' in solid) && kind?.kind === 'sandbank' && !('force' in kind)
		);
	},
);
step(
	'…and removing them leaves the first rule',
	(d) => {
		onlineDoc.removeZoneRule(d, 2);
		onlineDoc.removeZoneRule(d, 1);
	},
	(d) => d.arcade?.online?.rules?.zones?.length === 1,
);
step(
	'an ability and its numbers',
	(d) => {
		onlineDoc.addAbility(d);
		onlineDoc.setAbilityField(d, 0, 'effect', 'stun');
		onlineDoc.setAbilityField(d, 0, 'reach', '0');
		onlineDoc.setAbilityField(d, 0, 'targets', '');
		onlineDoc.setAbilityField(d, 0, 'ms', '1500');
		onlineDoc.setAbilityField(d, 0, 'score', '0');
		onlineDoc.setAbilityField(d, 0, 'cooldownMs', '2000');
		onlineDoc.setAbilityField(d, 0, 'cooldownMs', '');
	},
	(d) => {
		const a = d.arcade?.online?.rules?.abilities?.[0];
		return (
			a?.character === 'character1' &&
			a.targets.join() === 'character2' &&
			a.effect === 'stun' &&
			a.reach === 100 &&
			a.ms === 1500 &&
			!('score' in a) &&
			!('cooldownMs' in a)
		);
	},
);
step(
	'a hook holds its catch and throws it: on at the defaults, each field, and off with the effect',
	(d) => {
		// Only a hook has a carry.
		onlineDoc.setAbilityCarry(d, 0, true);
		const refused = d.arcade?.online?.rules?.abilities?.[0].carry === undefined;
		onlineDoc.setAbilityField(d, 0, 'effect', 'hook');
		onlineDoc.setAbilityCarry(d, 0, true);
		const on = JSON.stringify(d.arcade?.online?.rules?.abilities?.[0].carry) === '{}';
		onlineDoc.setCarryField(d, 0, 'holdMs', '6000');
		onlineDoc.setCarryField(d, 0, 'throwPx', '500');
		onlineDoc.setCarryField(d, 0, 'flightMs', '-3');
		onlineDoc.setCarryField(d, 0, 'walk', false);
		const set =
			JSON.stringify(d.arcade?.online?.rules?.abilities?.[0].carry) ===
			'{"holdMs":6000,"throwPx":500,"walk":false}';
		onlineDoc.setCarryField(d, 0, 'holdMs', '');
		onlineDoc.setCarryField(d, 0, 'walk', true);
		const cleared =
			JSON.stringify(d.arcade?.online?.rules?.abilities?.[0].carry) === '{"throwPx":500}';
		// Another effect has no carry: changing the effect drops it.
		onlineDoc.setAbilityField(d, 0, 'effect', 'stun');
		if (!(refused && on && set && cleared)) throw new Error('carry edits');
	},
	(d) => !('carry' in (d.arcade?.online?.rules?.abilities?.[0] ?? { carry: 1 })),
);
step(
	'how see-through the marks are drawn: 0 to 1, empty for the default',
	(d) => {
		onlineDoc.setStainField(d, 'opacity', '0.5');
		onlineDoc.setStainField(d, 'trailOpacity', '7');
		onlineDoc.setStainField(d, 'opacity', '');
		onlineDoc.setStainField(d, 'opacity', '-1');
	},
	(d) => JSON.stringify(d.arcade?.online?.rules?.stains) === '{"trailOpacity":1}',
);
step(
	'…and cleared, the block is gone',
	(d) => onlineDoc.setStainField(d, 'trailOpacity', ''),
	(d) => !('stains' in (d.arcade?.online?.rules ?? { stains: 1 })),
);
step(
	'renaming a character renames what names it',
	(d) => onlineDoc.setOnlineCharacterField(d, 1, 'id', 'bear'),
	(d) =>
		d.arcade?.online?.rules?.abilities?.[0].targets.join() === 'bear' &&
		online().characters[1].id === 'bear',
);
step(
	'the round and a module',
	(d) => {
		onlineDoc.setRoundField(d, 'seconds', '120');
		onlineDoc.setRoundField(d, 'nextRoundSeconds', '-1');
		onlineDoc.setRoundField(d, 'goalScore', '5');
		onlineDoc.setRulesModule(d, 'tag');
	},
	(d) =>
		d.arcade?.online?.rules?.round?.seconds === 120 &&
		!('nextRoundSeconds' in online().rules!.round!) &&
		online().rules!.module === 'tag',
);
step(
	'a lobby: ticked it is stored empty (its defaults), its numbers parse, unticked it goes',
	(d) => {
		onlineDoc.setLobbyField(d, 'minPlayers', '6');
		onlineDoc.setLobbyOn(d, true);
		onlineDoc.setLobbyField(d, 'minPlayers', '0');
		onlineDoc.setLobbyField(d, 'maxWaitSeconds', '45');
		onlineDoc.setLobbyField(d, 'countdownSeconds', '-1');
	},
	(d) => {
		const lobby = d.arcade?.online?.rules?.lobby;
		return (
			!!lobby &&
			!('minPlayers' in lobby) &&
			lobby.maxWaitSeconds === 45 &&
			!('countdownSeconds' in lobby)
		);
	},
);
step(
	'…and unticking it removes it',
	(d) => onlineDoc.setLobbyOn(d, false),
	(d) => !('lobby' in (d.arcade?.online?.rules ?? {})),
);
step(
	'removing every rule removes the rules',
	(d) => {
		onlineDoc.removeZoneRule(d, 0);
		onlineDoc.removeAbility(d, 0);
		onlineDoc.setRoundField(d, 'seconds', '');
		onlineDoc.setRoundField(d, 'goalScore', '');
		onlineDoc.setRulesModule(d, '');
	},
	(d) => d.arcade?.online !== undefined && !('rules' in online()),
);
step(
	'a bot needs a character and a brain',
	(d) => onlineDoc.addBot(d, 'bear', ''),
	(d) => d.arcade?.online !== undefined && !('bots' in online()),
);
step(
	'a bot and its block',
	(d) => {
		onlineDoc.addBot(d, 'bear', 'hunter');
		onlineDoc.setBotsField(d, 'fillTo', '20');
		onlineDoc.setBotsField(d, 'fillTo', '8');
		onlineDoc.setBotsField(d, 'canWin', true);
		onlineDoc.setBotsField(d, 'spawns', '5, 5');
		onlineDoc.setBotField(d, 0, 'brain', ' ');
	},
	(d) => {
		const bots = d.arcade?.online?.bots;
		return (
			bots?.characters[0]?.brain === 'hunter' &&
			bots.fillTo === 8 &&
			bots.canWin === true &&
			bots.spawns?.[0]?.x === 5
		);
	},
);
step(
	"bots by shares: a class's Most becomes its share, and Fill room to goes",
	(d) => onlineDoc.setBotsByShares(d, true),
	() => {
		const bots = online().bots;
		return (
			botsByShares(bots) &&
			bots?.characters[0]?.share === 6 &&
			!('fillTo' in (bots ?? {})) &&
			!('max' in online().characters[1])
		);
	},
);
step(
	'by shares: a second class takes the average share; a repeated class and a bad share are refused',
	(d) => {
		onlineDoc.addBot(d, 'character1', 'hunter');
		onlineDoc.addBot(d, 'character1', 'hunter');
		onlineDoc.setBotShare(d, 1, '18');
		onlineDoc.setBotShare(d, 1, '0');
		onlineDoc.setBotShare(d, 1, 'much');
		onlineDoc.setBotField(d, 1, 'character', 'bear');
	},
	(d) =>
		JSON.stringify(d.arcade?.online?.bots?.characters) ===
		JSON.stringify([
			{ character: 'bear', brain: 'hunter', share: 6 },
			{ character: 'character1', brain: 'hunter', share: 18 },
		]),
);
same(
	"2. by shares: the panel shows each class's percentage and its places at the room's size and the samples",
	[onlineDoc.botShareSizes(online()), onlineDoc.botShareRows(online(), [100, 10, 20, 50])],
	[
		[100, 10, 20, 50],
		[
			{ character: 'bear', percent: 25, counts: [25, 2, 5, 12] },
			{ character: 'character1', percent: 75, counts: [75, 8, 15, 38] },
		],
	],
);
same(
	"2. by shares: the samples are sizes a test room could have, under the room's own",
	[
		onlineDoc.botShareSizes({ characters: [], maxPlayers: 20 }),
		onlineDoc.botShareSizes({
			characters: [],
			maxPlayers: 30,
			bots: {
				characters: Array.from({ length: 12 }, (_, i) => ({
					character: `c${i}`,
					brain: 'hunter',
					share: 1,
				})),
			},
		}),
	],
	[
		[20, 10],
		[30, 20],
	],
);
{
	const three: GameConfigDoc = structuredClone(doc);
	three.arcade!.online!.bots!.characters[1].share = 3;
	onlineDoc.addBot(three, 'otter', 'hunter');
	same(
		'2. by shares: an added class takes the average of the shares there are',
		three.arcade?.online?.bots?.characters.map((b) => b.share),
		[6, 3, 4.5],
	);
}
same(
	'2. the test size is held to what a test room may be, and nothing typed is no parameter',
	['', '1', '12.4', '500', 'x'].map((typed) => onlineDoc.testSizeParam(online(), typed)),
	['', 'room_size=2', 'room_size=12', 'room_size=100', ''],
);
step(
	"back to count: the places become each class's Most and the room is filled to its size",
	(d) => {
		onlineDoc.setBotsByShares(d, false);
		onlineDoc.setBotShare(d, 0, '5');
	},
	(d) =>
		JSON.stringify(d.arcade?.online?.bots?.characters) ===
			JSON.stringify([
				{ character: 'bear', brain: 'hunter' },
				{ character: 'character1', brain: 'hunter' },
			]) &&
		online().bots?.fillTo === 100 &&
		online()
			.characters.map((c) => c.max)
			.join() === '75,25',
);
step(
	'to shares with a class that has no Most: a share is how often the class is listed',
	(d) => {
		onlineDoc.setOnlineCharacterField(d, 0, 'max', '');
		onlineDoc.addBot(d, 'bear', 'hunter');
		onlineDoc.setBotsByShares(d, true);
	},
	(d) =>
		JSON.stringify(d.arcade?.online?.bots?.characters) ===
			JSON.stringify([
				{ character: 'bear', brain: 'hunter', share: 2 },
				{ character: 'character1', brain: 'hunter', share: 1 },
			]) &&
		!('fillTo' in online().bots!) &&
		online().characters.every((c) => !('max' in c)),
);
step(
	'one bot by count again',
	(d) => {
		onlineDoc.setBotsByShares(d, false);
		onlineDoc.removeBot(d, 1);
	},
	() => online().bots?.characters.length === 1 && !botsByShares(online().bots),
);
step(
	'the last bot removes the bots',
	(d) => {
		onlineDoc.setBotsField(d, 'canWin', false);
		onlineDoc.removeBot(d, 0);
	},
	(d) => d.arcade?.online !== undefined && !('bots' in online()),
);
step(
	'not played online removes the block',
	(d) => onlineDoc.setPlayedOnline(d, false),
	(d) => d.arcade !== undefined && !('online' in d.arcade),
);
step(
	'played online again starts empty',
	(d) => onlineDoc.setPlayedOnline(d, true),
	(d) => d.arcade?.online?.characters.length === 0 && Object.keys(online()).length === 1,
);
step(
	'arcade → slot',
	(d) => familyDoc.setFamily(d, 'slot'),
	(d) => !('family' in d) && !('outcome' in d) && !('arcade' in d),
);
same(
	'2. back on a slot, the doc is the slot it was but the win model and cascade match-3 dropped',
	canonical(doc),
	canonical({ ...SLOT, winModel: undefined, cascade: undefined, paddingReels: doc.paddingReels }),
);
doc = structuredClone(SLOT);
familyDoc.setOutcome(doc, 'rules');
check('2. a slot takes no outcome', doc.outcome === undefined);

// ── 3. the page shows each family §6.2's sections ───────────────────────────────────────────────
const HEADINGS: Record<string, ConfigSection> = {
	'Return to player': 'rtp',
	Grid: 'grid',
	'Bet modes': 'betModes',
	'Coin board': 'coinBoard',
	'Coin overlay': 'coinOverlay',
	'Bonus modes': 'bonusModes',
	Symbols: 'symbols',
	Coins: 'coinSymbols',
	'How wins are decided': 'winModel',
	'Free spins': 'freeSpins',
	'Expanding symbol': 'expandingSymbol',
	'Expanding wilds': 'expandingWilds',
	'Growing wild': 'growingWild',
	'Reel behaviour': 'reelBehaviour',
	'Game modes': 'gameModes',
	Sounds: 'sounds',
	Paylines: 'paylines',
	'Big win tiers': 'winLevels',
	'Match-3': 'match3',
	Arcade: 'arcade',
	'Online room': 'arcade',
	'Mouse and touch': 'arcade',
	'Online rules': 'arcade',
	Bots: 'arcade',
	'Card game': 'card',
};
/** The dialogs' titles, rendered closed, and the family picker's own heading. */
const NOT_SECTIONS = new Set([
	'Import from a pasted capture',
	'Import paytable from server',
	'Version history',
	'Raw JSON',
	'Game family',
]);

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({
	configFile: `${root}vite.config.js`,
	server: { middlewareMode: true, hmr: false },
	appType: 'custom',
	logLevel: 'error',
	// The workspace packages are TypeScript with extensionless imports, which Node cannot load.
	ssr: {
		noExternal: [
			/^(game-config|engine-|constants-|rgs-|utils-|components-|pixi-svelte|state-shared|config-)/,
		],
	},
});
try {
	const { render } = (await server.ssrLoadModule(
		'svelte/server',
	)) as typeof import('svelte/server');
	const page = (await server.ssrLoadModule('/src/routes/(app)/config/+page.svelte')) as {
		default: never;
	};
	const lines = JSON.parse(
		readFileSync(new URL('../src/lib/data/gameConfig/lines.json', import.meta.url), 'utf8'),
	) as GameConfigDoc;
	const renderPage = (config: GameConfigDoc, gameType = 'lines') => {
		const data = {
			clientKey: 'c',
			projectKey: 'p',
			projectName: 'P',
			gameType,
			tools: [],
			doc: config,
			source: 'authored',
			etag: 'e',
			templateDefault: config,
			templateIsBuiltIn: true,
			presets: [],
			serverPaylines: null,
			serverGameKeys: [],
			components: [],
			pickSheets: [],
			spines: [],
			issues: [],
		};
		const { body } = render(page.default, { props: { data } } as never);
		const headings = [...body.matchAll(/<h2[^>]*>(?:<button[^>]*>)?([^<]*)<\/(?:button|h2)>/g)].map(
			(m) => m[1].trim(),
		);
		const unknown = headings.filter((h) => !HEADINGS[h] && !NOT_SECTIONS.has(h));
		check(`3. every heading is known`, !unknown.length, unknown.join());
		return {
			sections: new Set(headings.flatMap((h) => (HEADINGS[h] ? [HEADINGS[h]] : []))),
			picker: headings.includes('Game family'),
			body,
		};
	};
	const board = {
		numReels: 6,
		numRows: [6, 6, 6, 6, 6, 6],
		paylines: {},
		paddingReels: {
			basegame: Array.from({ length: 6 }, () =>
				['H1', 'H2', 'L1', 'L2', 'H1', 'L3'].map((name) => ({ name })),
			),
		},
	};
	const m3 = normalizeGameConfigDoc({ ...lines, ...board, family: 'match3' })!;
	const m3Rules = normalizeGameConfigDoc({
		...m3,
		outcome: 'rules',
		betModes: {},
		match3: { moves: 20 },
	})!;
	const arcade = normalizeGameConfigDoc({
		family: 'arcade',
		outcome: 'rules',
		arcade: { fixedHz: 120 },
	})!;
	const card = normalizeGameConfigDoc({
		family: 'card',
		outcome: 'rules',
		card: { rules: { deckSize: 15 } },
	})!;
	for (const [label, config, family, outcome] of [
		['match-3, RGS', m3, 'match3', 'rgs'],
		['match-3, rules', m3Rules, 'match3', 'rules'],
		['arcade', arcade, 'arcade', 'rules'],
		['card', card, 'card', 'rules'],
	] as const) {
		const shown = renderPage(config);
		same(
			`3. ${label}: exactly its sections`,
			[...shown.sections].sort(),
			[...configSectionsFor(family, outcome)].sort(),
		);
		check(`3. ${label}: the family picker`, shown.picker);
		check(
			`3. ${label}: the Characters link only on an arcade page`,
			shown.body.includes('href="/characters?project=p"') === (family === 'arcade'),
		);
		if (family === 'match3') {
			check(
				`3. ${label}: the board's size is editable, its rows per column are not`,
				/<span>Reels<\/span>/.test(shown.body) &&
					/<span>Rows \(all reels\)<\/span>/.test(shown.body) &&
					!shown.body.includes('rows-per-reel'),
			);
		}
	}
	const withCharacters = normalizeGameConfigDoc({
		...arcade,
		arcade: {
			characters: [
				{ id: 'hero', component: 'heroLook' },
				{ id: 'guard', component: 'guardLook' },
			],
		},
	})!;
	check(
		'3. arcade: the Characters line counts the characters',
		renderPage(arcade).body.includes('No characters yet.') &&
			renderPage(withCharacters).body.includes('2 characters.'),
	);
	const online = normalizeGameConfigDoc({
		...arcade,
		arcade: { online: { characters: [], netcode: 'colyseus' } },
	})!;
	const ONLINE_HEADINGS = ['Online room', 'Mouse and touch', 'Online rules', 'Bots'];
	const headingsOf = (body: string) =>
		[...body.matchAll(/<h2[^>]*>(?:<button[^>]*>)?([^<]*)<\/(?:button|h2)>/g)].map((m) =>
			m[1].trim(),
		);
	check(
		'3. arcade: the online sections only on an online game, after Arcade',
		!headingsOf(renderPage(arcade).body).some((h) => ONLINE_HEADINGS.includes(h)) &&
			headingsOf(renderPage(online).body)
				.join()
				.includes(['Arcade', ...ONLINE_HEADINGS].join()),
	);
	const salmonsLike = normalizeGameConfigDoc({
		...arcade,
		arcade: {
			field: { w: 1422, h: 3200 },
			bodies: { salmonLook: { shape: 'circle', r: 30 } },
			zones: [{ id: 'source', x: 0, y: 0, w: 1422, h: 200 }],
			characters: [{ id: 'bearBrain', component: 'bearLook' }],
			online: {
				characters: [{ id: 'salmon', body: 'salmonLook', speed: 260 }],
				rules: {
					zones: [{ zone: 'source', goal: true }],
					abilities: [
						{
							character: 'salmon',
							button: 'ability1',
							reach: 90,
							targets: ['salmon'],
							effect: 'stun',
						},
					],
					round: { seconds: 180 },
				},
				bots: { characters: [{ character: 'salmon', brain: 'bearBrain' }], fillTo: 12 },
			},
		},
	})!;
	const shownOnline = renderPage(salmonsLike).body;
	check(
		'3. arcade: an online page shows its room, rules and bots',
		shownOnline.includes('value="salmon"') &&
			/Round seconds<input[^>]*value="180"/.test(shownOnline) &&
			/Fill room to<input[^>]*value="12"/.test(shownOnline) &&
			/<option value="bearBrain"[^>]*selected/.test(shownOnline) &&
			/Played online<\/label>/.test(shownOnline) &&
			/<input type="checkbox"[^>]*checked[^>]*\/?>Played online/.test(shownOnline),
	);
	const touched = structuredClone(salmonsLike);
	touched.arcade!.online!.pointer = { taps: { salmon: 'ability1' } };
	const noSchemes = renderPage(touched).body;
	touched.arcade!.online!.touch = {
		schemes: { Swim: { gestures: 'both', ability: 'target', targetRadius: 90 }, Spare: {} },
		characters: { salmon: 'Swim' },
	};
	const shownTouch = renderPage(touched).body;
	const TOUCH_LABELS = [
		'Gestures',
		'Hold steers',
		'Lifting the finger stops',
		'Dead zone around the player (field px)',
		'Tap length (ms)',
		'Tap distance (px)',
		'The ability is pressed by',
		'The ability is aimed',
		'Target radius (field px)',
	];
	same(
		'3. arcade: Mouse and touch lists the schemes, edits the first with one control a tunable, and gives each class its scheme',
		[
			[...shownTouch.matchAll(/class="scheme[^"]*"[^>]*>([^<]*)<em[^>]*>(\d+)</g)].map(
				(m) => `${m[1]} ${m[2]}`,
			),
			/data-touch-scheme="Swim"/.test(shownTouch),
			TOUCH_LABELS.filter((label) => !shownTouch.includes(`>${label}<`)),
			/data-touch-users[^>]*>Used by salmon</.test(shownTouch),
			/<select[^>]*data-class-touch="salmon"[\s\S]*?<option value="Swim"[^>]*selected/.test(
				shownTouch,
			),
			/Target radius \(field px\)[\s\S]*?<input[^>]*value="90"/.test(shownTouch),
			/placeholder="the game's \(24\)"/.test(shownTouch) &&
				/placeholder="the game's \(12\)"/.test(shownTouch),
			shownTouch.includes('id="touch-schemes"'),
		],
		[['Swim 1', 'Spare 0'], true, [], true, true, true, true, true],
	);
	check(
		'3. arcade: with no scheme the card offers the presets and no scheme panel; with mouse and touch off, neither',
		noSchemes.includes('Add scheme') &&
			!noSchemes.includes('data-touch-scheme=') &&
			/<select[^>]*data-class-touch="salmon"[^>]*disabled/.test(noSchemes) &&
			!shownOnline.includes('Add scheme') &&
			!shownOnline.includes('data-class-touch'),
	);
	const onlineSection = readFileSync(
		new URL('../src/routes/(app)/config/OnlineSection.svelte', import.meta.url),
		'utf8',
	);
	same(
		'3. source text: every touch control of the card writes through `touchDoc.ts`, and the class select is the shared one',
		[
			'addTouchScheme(doc, id)',
			'renameTouchScheme(doc, schemeName, field.value)',
			'duplicateTouchScheme(doc, schemeName)',
			'removeTouchScheme(doc, name)',
			'onpick={(name) => setClassTouchScheme(doc, id, name)}',
			"setTouchSchemeField(doc, schemeName, 'releaseStops', e.currentTarget.checked)",
			...['gestures', 'steer', 'ability', 'aim'].map(
				(field) => `setTouchSchemeField(doc, schemeName, '${field}', e.currentTarget.value)`,
			),
			...['deadZone', 'tapMs', 'tapPx', 'targetRadius'].map(
				(field) => `typeSchemeNumber('${field}', e.currentTarget)`,
			),
			'setTouchSchemeField(doc, schemeName, field, input.value)',
		].filter((call) => !onlineSection.replace(/\s+/g, ' ').includes(call)),
		[],
	);
	const byShares = structuredClone(salmonsLike);
	byShares.arcade!.online!.maxPlayers = 30;
	byShares.arcade!.online!.bots = {
		characters: [{ character: 'salmon', brain: 'bearBrain', share: 3 }],
	};
	const shownShares = renderPage(byShares).body;
	check(
		'3. arcade: one Room size; by count it shows Fill room to and no shares',
		/Room size[\s\S]*?<input[^>]*placeholder="16"/.test(shownOnline) &&
			!shownOnline.includes('Players a room holds') &&
			/<input type="checkbox"(?![^>]*checked)[^>]*\/?>By shares/.test(shownOnline) &&
			!shownOnline.includes('Room kept full') &&
			!shownOnline.includes('>Share</th>'),
	);
	check(
		'3. arcade: by shares it shows each share, its percentage and places, a full room and no Fill room to',
		/<input type="checkbox"[^>]*checked[^>]*\/?>By shares/.test(shownShares) &&
			shownShares.includes('Room kept full: 30') &&
			!shownShares.includes('Fill room to<input') &&
			shownShares.includes('>Share</th>') &&
			shownShares.includes('Places (30)') &&
			shownShares.includes('At 10') &&
			shownShares.includes('100%') &&
			/<input type="number"[^>]*value="30"[^>]*disabled/.test(shownShares),
	);
	check(
		'3. arcade: the Test size is offered within what a test room may be',
		/Test size[\s\S]*?<input[^>]*min="2"[^>]*max="30"/.test(shownShares) &&
			/Test size[\s\S]*?<input[^>]*min="2"[^>]*max="16"/.test(shownOnline),
	);
	// A class's character sheet (`check:config-character-sheets` runs the pure side): its row names
	// it, linked to Invisible Characters on this project, and its warning is listed in the panel as
	// well as in the page's summary.
	const classRow = (sheet: string) =>
		renderPage(
			withCharacterSheets(salmonsLike, {
				arcade: {
					characters: [{ id: 'bearBrain', component: 'bearLook' }],
					online: { characters: [{ id: 'salmon', body: 'salmonLook', speed: 260, sheet }] },
				},
			}),
		).body;
	const SHEET_ISSUE = 'arcade.online.characters[0].sheet</code>';
	const count = (body: string, part: string) => body.split(part).length - 1;
	const named = classRow('nobody');
	same(
		'3. arcade: a class’s row links the sheet it names, and one it cannot use is warned of in the page’s summary and in the Online room',
		[
			named.includes('href="/characters?character=nobody&amp;project=p"'),
			count(named, SHEET_ISSUE),
			count(shownOnline, SHEET_ISSUE),
			count(shownOnline, 'href="/characters?character='),
		],
		[true, 2, 0, 0],
	);
	const withMax = structuredClone(salmonsLike);
	withMax.arcade!.online!.nearby = { w: 3300, h: 3300, max: { w: 6400, h: 4600 } };
	const shownMax = renderPage(withMax).body;
	const maxInput = (side: string, body: string) =>
		new RegExp(`Nearby max ${side}[\\s\\S]*?(<input[^>]*)`).exec(body)?.[1] ?? '';
	check(
		'3. arcade: the Online room card shows the nearby max beside the box, explained in a tip',
		/value="6400"/.test(maxInput('width', shownMax)) &&
			/value="4600"/.test(maxInput('height', shownMax)) &&
			!/disabled/.test(maxInput('width', shownMax)) &&
			/role="tooltip"[^>]*>(?:<!--[^>]*-->|\s)*With a max, a device that says how much/.test(
				shownMax,
			),
		maxInput('width', shownMax) + maxInput('height', shownMax),
	);
	check(
		'3. arcade: with no box the max cannot be typed',
		/disabled/.test(maxInput('width', shownOnline)) &&
			/disabled/.test(maxInput('height', shownOnline)),
		maxInput('width', shownOnline),
	);
	const slideInput = (body: string) =>
		/Slide round corners \(px\)[\s\S]*?(<input[^>]*)/.exec(body)?.[1] ?? '';
	const slideLike = structuredClone(salmonsLike);
	slideLike.arcade!.online!.slide = { corner: 168 };
	const shownSlide = renderPage(slideLike).body;
	check(
		'3. arcade: the Online room card shows the corner slide, empty when off, explained in a tip',
		/value="168"/.test(slideInput(shownSlide)) &&
			/value=""/.test(slideInput(shownOnline)) &&
			/role="tooltip"[^>]*>(?:<!--[^>]*-->|\s)*A player stopped by a solid/.test(shownOnline),
		slideInput(shownSlide) + slideInput(shownOnline),
	);
	const farSlide = structuredClone(salmonsLike);
	farSlide.arcade!.online!.slide = { corner: 900 };
	const SLIDE_ISSUE = 'arcade.online.slide.corner</code>';
	same(
		'3. arcade: a corner slide out of range is warned of in the page’s summary and in the Online room',
		[count(renderPage(farSlide).body, SLIDE_ISSUE), count(shownSlide, SLIDE_ISSUE)],
		[2, 0],
	);
	const generatedNotices = (config: GameConfigDoc) =>
		(renderPage(config).body.match(/Each room's generator \(<code>/g) ?? []).length;
	const withGenerator = structuredClone(salmonsLike);
	withGenerator.arcade!.online!.generator = 'salmonsRiver';
	const withUnknown = structuredClone(salmonsLike);
	withUnknown.arcade!.online!.generator = 'lake';
	check(
		'3. arcade: a known generator is noted by the four values it replaces',
		generatedNotices(salmonsLike) === 0 &&
			generatedNotices(withGenerator) === 4 &&
			generatedNotices(withUnknown) === 0,
		String(generatedNotices(withGenerator)),
	);
	check(
		'3. arcade: the Netcode picker only on an online game, showing its netcode',
		!renderPage(arcade).body.includes('Netcode') &&
			/Netcode<select[^>]*>[\s\S]*<option value="colyseus"[^>]*\bselected/.test(
				renderPage(online).body,
			),
	);
	const slotSections = configSectionsFor('slot', 'rgs');
	const ALWAYS: ConfigSection[] = [
		'rtp',
		'grid',
		'betModes',
		'coinOverlay',
		'bonusModes',
		'symbols',
		'winModel',
		'reelBehaviour',
		'gameModes',
		'sounds',
		'paylines',
		'winLevels',
	];
	for (const [label, config, kind] of [
		['the lines seed', lines, 'lines'],
		['the lines seed on a Hold and Win project', lines, 'holdAndWin'],
	] as const) {
		const shown = renderPage(config, kind);
		check(`3. ${label}: no family picker`, !shown.picker);
		const outside = [...shown.sections].filter((s) => !slotSections.has(s));
		check(`3. ${label}: no section outside the slot's`, !outside.length, outside.join());
		const missing = ALWAYS.filter((s) => !shown.sections.has(s));
		check(`3. ${label}: every slot section it always had`, !missing.length, missing.join());
		check(`3. ${label}: the slot intro`, shown.body.includes('its symbol dictionary and payouts'));
		check(`3. ${label}: no Characters link`, !shown.body.includes('href="/characters"'));
	}
	check(
		'3. a match-3 project on a slot config is offered the picker',
		renderPage(lines, 'match3').picker,
	);

	// The wild sections: offered on a lines game that does not tumble; elsewhere only a stored
	// block shows, so it can be removed.
	const wilds = ['expandingWilds', 'growingWild'] as const;
	const has = (shown: { sections: Set<ConfigSection> }) => wilds.map((w) => shown.sections.has(w));
	same('3. a lines game: both wild sections', has(renderPage(lines, 'lines')), [true, true]);
	same('3. a Book-of kind: no wild sections', has(renderPage(lines, 'bookOf')), [false, false]);
	same('3. Hold and Win: no wild sections', has(renderPage(lines, 'holdAndWin')), [false, false]);
	const tumbling = normalizeGameConfigDoc({ ...lines, cascade: true })!;
	same('3. a tumbling game: no wild sections', has(renderPage(tumbling)), [false, false]);
	const dealtW = structuredClone(lines.paddingReels);
	dealtW.basegame[1][0] = { name: 'W' };
	dealtW.basegame[3][0] = { name: 'W' };
	const withWilds = normalizeGameConfigDoc({
		...lines,
		paddingReels: dealtW,
		expandingWilds: { symbols: ['W'], show: 'always' },
		growingWild: { symbol: 'W', reels: [1, 3], pattern: 'all8' },
	})!;
	same(
		'3. a stored block on a tumbling game shows, to be removed',
		has(renderPage({ ...withWilds, cascade: true })),
		[true, true],
	);
	const wildBody = renderPage(withWilds).body;
	check(
		'3. the wild sections show the stored blocks and their issues',
		/aria-label="W expands"[^>]*\bchecked/.test(wildBody) &&
			/<option value="all8"[^>]*\bselected/.test(wildBody) &&
			wildBody.includes('is also the growing wild') &&
			/<td[^>]*>2, 4<\/td>/.test(wildBody),
	);
	doc = structuredClone(normalizeGameConfigDoc(lines)!);
	step(
		'expanding wilds on',
		(d) => wildsDoc.setExpandingWildsOn(d, true, 'W'),
		(d) => d.expandingWilds?.symbols[0] === 'W',
	);
	step(
		'show every expansion',
		(d) => wildsDoc.setExpandShowAlways(d, true),
		(d) => d.expandingWilds?.show === 'always',
	);
	step(
		'show it only when a win uses the reel (the default)',
		(d) => wildsDoc.setExpandShowAlways(d, false),
		(d) => d.expandingWilds !== undefined && !('show' in d.expandingWilds),
	);
	step(
		'untick the last wild keeps the block',
		(d) => wildsDoc.setExpandingWild(d, 'W', false),
		(d) => d.expandingWilds?.symbols.length === 0,
	);
	step(
		'expanding wilds off',
		(d) => wildsDoc.setExpandingWildsOn(d, false),
		(d) => d.expandingWilds === undefined,
	);
	step(
		'growing wild on, none picked',
		(d) => wildsDoc.setGrowingWildOn(d, true),
		(d) => d.growingWild?.symbol === '',
	);
	step('pick the growing wild', (d) => wildsDoc.setGrowingSymbol(d, 'W'));
	step(
		'tick reels out of order',
		(d) => {
			wildsDoc.setGrowingReel(d, 'reels', 3, true);
			wildsDoc.setGrowingReel(d, 'reels', 1, true);
		},
		(d) => JSON.stringify(d.growingWild?.reels) === '[1,3]',
	);
	step(
		'untick every free-spin reel: the default',
		(d) => {
			wildsDoc.setGrowingReel(d, 'freeSpinReels', 2, true);
			wildsDoc.setGrowingReel(d, 'freeSpinReels', 2, false);
		},
		(d) => d.growingWild !== undefined && !('freeSpinReels' in d.growingWild),
	);
	step(
		'a pattern',
		(d) => wildsDoc.setGrowingPattern(d, 'vertical'),
		(d) => d.growingWild?.pattern === 'vertical',
	);
	step(
		'the plus pattern (the default)',
		(d) => wildsDoc.setGrowingPattern(d, 'plus'),
		(d) => d.growingWild !== undefined && !('pattern' in d.growingWild),
	);
	step(
		'growing wild off',
		(d) => wildsDoc.setGrowingWildOn(d, false),
		(d) => d.growingWild === undefined,
	);
	same('3. the wild choices are the dictionary wilds', wildsDoc.wildChoices(lines), ['W']);
	check(
		'3. the section table names every section once',
		new Set(Object.values(HEADINGS)).size === CONFIG_SECTIONS.length,
	);
} finally {
	await server.close();
}

// ── 4. the family gate ──────────────────────────────────────────────────────────────────────────
check(
	'4. a slot config is never refused',
	unplayableFamilyMessage(SLOT) === null && unplayableFamilyMessage(null) === null,
);
check(
	'4. an RGS-decided match-3 config publishes: the runtime plays it (P10.6)',
	unplayableFamilyMessage({ ...SLOT, family: 'match3' }) === null,
);
check(
	'4. a rules-decided match-3 config publishes: the runtime plays it (P10.5)',
	unplayableFamilyMessage({ ...SLOT, family: 'match3', outcome: 'rules' }) === null,
);
check(
	'4. the gate follows the runtime: refused exactly when mechanicFor() says unplayable',
	[
		SLOT,
		null,
		{ ...SLOT, family: 'match3' as const },
		{ ...SLOT, family: 'arcade' as const },
	].every((doc) => (unplayableFamilyMessage(doc) === null) === !mechanicFor(doc).unplayable),
);
check(
	'4. an arcade config is refused while its mechanic is unplayable (P10.8)',
	!mechanicFor({ ...SLOT, family: 'arcade' }).unplayable ||
		/an arcade/.test(unplayableFamilyMessage({ ...SLOT, family: 'arcade' }) ?? ''),
);

check(
	'4. only a slot is launched against a partner RGS',
	partnerRgsRefusal(SLOT) === null &&
		partnerRgsRefusal(null) === null &&
		/free play/.test(partnerRgsRefusal({ ...SLOT, family: 'match3', outcome: 'rules' }) ?? '') &&
		/not a slot/.test(partnerRgsRefusal({ ...SLOT, family: 'match3' }) ?? '') &&
		/not a slot/.test(partnerRgsRefusal({ ...SLOT, family: 'arcade' }) ?? ''),
);

// ── 5. character sheets ─────────────────────────────────────────────────────────────────────────
{
	const { prepareGameConfigDoc, InvalidGameConfigError } =
		await import('../src/lib/server/gameConfigStorage.ts');
	const dataDir = new URL('../src/lib/data/gameConfig/', import.meta.url);
	const read = (name: string): Record<string, unknown> =>
		JSON.parse(readFileSync(fileURLToPath(new URL(name, dataDir)), 'utf8'));
	const seed = read('arcade.rules.json');
	const text = (v: unknown) => JSON.stringify(v);
	const withoutUndefined = (v: unknown): unknown => JSON.parse(text(v));
	/** What a load makes of stored bytes: the normalizer, then the carry. */
	const load = (stored: unknown) =>
		withCharacterSheets(normalizeGameConfigDoc(stored) as GameConfigDoc, stored);

	const BEAR_SHEET = {
		view: { kind: 'isometric', facings: 8 },
		source: { kind: 'clips', prefix: 'bear', variants: { marked: 'bear_gold' } },
		draw: { width: 92, feet: 0.9, points: { hand: { x: 0.75, y: 0.4 } } },
		actions: [
			{ id: 'idle', when: { motion: 'still' } },
			{ id: 'walk', when: { motion: 'moving' }, fallback: 'idle' },
			{ id: 'swipe', when: { ability: 'ability1' }, interrupt: 'none', fallback: 'idle' },
			{
				id: 'grab',
				name: 'Grab',
				when: [{ event: 'caught' }, { event: 'hooked', as: 'target' }],
				again: 'ignore',
				anim: { e: { clip: 'bear_grab_side' } },
			},
			{ id: 'gold', when: { status: 'marked' }, play: 'once', priority: 5 },
		],
	};
	type Entry = Record<string, unknown>;
	const online = (characters: Entry[], classes: Entry[], arcade: Entry = {}) => ({
		...seed,
		arcade: {
			...(seed.arcade as object),
			field: { w: 2000, h: 1200 },
			characters,
			online: {
				characters: classes,
				bots: { fillTo: 4, characters: [{ character: 'bear', brain: 'bearBot' }] },
			},
			...arcade,
		},
	});
	const BRAIN = {
		initial: 'roam',
		states: [{ id: 'roam', behaviour: 'wander' }],
		transitions: [],
	};
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
	const salmon = (more: Entry = {}) => ({
		id: 'salmon',
		body: 'arcadeSalmon',
		speed: 240,
		...more,
	});
	const SALMON_SHEET = {
		source: { kind: 'clips', prefix: 'salmon' },
		draw: { width: 60 },
		actions: [{ id: 'swim', when: [{ motion: 'still' }, { motion: 'moving' }] }],
	};
	const plain = online([bearBot(), salmonLook()], [bear(), salmon()]);
	const sheeted = online(
		[bearBot(BEAR_SHEET), salmonLook(SALMON_SHEET)],
		[bear({ sheet: 'bearBot' }), salmon({ sheet: 'salmonLook' })],
	);

	for (const name of readdirSync(fileURLToPath(dataDir)).filter((n) => n.endsWith('.json'))) {
		const normalized = normalizeGameConfigDoc(read(name)) as GameConfigDoc;
		check(
			`5. ${name}: no sheet, so the carry returns the doc itself`,
			withCharacterSheets(normalized, read(name)) === normalized,
		);
	}
	const storedPlain = normalizeGameConfigDoc(plain) as GameConfigDoc;
	const plainAgain = normalizeGameConfigDoc(JSON.parse(text(storedPlain))) as GameConfigDoc;
	same('5. a stored online config with no sheet normalizes byte for byte', plainAgain, storedPlain);
	check(
		'5. …and the carry returns the same object',
		withCharacterSheets(plainAgain, JSON.parse(text(storedPlain))) === plainAgain,
	);
	same(
		'5. …and the save stores it as the normalizer makes it',
		prepareGameConfigDoc(plain).doc,
		storedPlain,
	);
	same('5. a config with no sheet names no clip', characterSheetClipRoots(storedPlain), {
		prefixes: [],
		clipIds: [],
	});

	const sheetedBefore = text(sheeted);
	const storedSheeted = prepareGameConfigDoc(sheeted).doc;
	const characters = storedSheeted.arcade?.characters ?? [];
	same('5. the save keeps a canonical sheet as authored', characters[0], bearBot(BEAR_SHEET));
	same('5. …and each class’s sheet', storedSheeted.arcade?.online?.characters, [
		bear({ sheet: 'bearBot' }),
		salmon({ sheet: 'salmonLook' }),
	]);
	const bytes = text(storedSheeted);
	same(
		'5. a stored sheet comes back byte for byte through a load',
		load(JSON.parse(bytes)),
		storedSheeted,
	);
	check(
		'5. …and through the save after it',
		text(prepareGameConfigDoc(load(JSON.parse(bytes))).doc) === bytes,
	);
	same(
		'5. normalizeGameConfigDoc alone drops the sheets: they are carried, not normalized',
		normalizeGameConfigDoc(JSON.parse(bytes)),
		storedPlain,
	);
	same(
		'5. the game server reads the same game with and without sheets',
		onlineGameOf(normalizeGameConfigDoc(JSON.parse(bytes))),
		onlineGameOf(storedPlain),
	);
	check(
		'5. …and it is a game, not a refusal',
		!!onlineGameOf(storedPlain) && !('refused' in onlineGameOf(storedPlain)!),
	);
	check('5. the save changes nothing of what it was given', text(sheeted) === sheetedBefore);

	same(
		'5. a sheet’s defaults are not stored',
		normalizeCharacterSheet({
			view: { kind: 'topDown', facings: 4, mirror: true },
			source: { kind: 'clips', prefix: ' hero ', variants: {} },
			draw: { width: 40, feet: 1, points: {} },
			actions: [
				{
					id: ' idle ',
					name: ' ',
					when: [{ motion: 'still' }],
					play: 'loop',
					priority: 1,
					anim: {},
				},
				{ id: 'hit', when: { ability: 'ability2' }, play: 'once', priority: 3, fallback: ' ' },
				{ id: 'cry', when: { event: 'caught', as: 'user' } },
				{ id: 'held', when: { status: 'holding' }, priority: 2, play: 'loop' },
				{ id: 'spare', play: 'loop', priority: 0 },
			],
		}),
		{
			view: { kind: 'topDown' },
			source: { kind: 'clips', prefix: 'hero' },
			draw: { width: 40 },
			actions: [
				{ id: 'idle', when: { motion: 'still' } },
				{ id: 'hit', when: { ability: 'ability2' } },
				{ id: 'cry', when: { event: 'caught' } },
				{ id: 'held', when: { status: 'holding' } },
				{ id: 'spare' },
			],
		},
	);
	same(
		'5. what a sheet cannot use is dropped',
		normalizeCharacterSheet({
			view: { kind: 'isometric', facings: 6, tilt: 30 },
			source: { kind: 'clips', prefix: 'hero', variants: { marked: 7, ' ': 'x' }, rate: 2 },
			draw: { width: 40, feet: Number.NaN, points: { hand: { x: 'a', y: 1 } }, depth: 3 },
			actions: [
				{ id: 'idle', when: { motion: 'still' }, markers: [{ id: 'hit', at: 180 }], rate: 2 },
				{ id: 'idle', when: { motion: 'moving' } },
				{ when: { motion: 'moving' } },
				{
					id: 'walk',
					play: 'pingpong',
					interrupt: 'any',
					again: 'restart',
					anim: { up: { clip: 'x' }, e: {} },
				},
			],
			markers: {},
		}),
		{
			view: { kind: 'isometric' },
			source: { kind: 'clips', prefix: 'hero' },
			draw: { width: 40 },
			actions: [{ id: 'idle', when: { motion: 'still' } }, { id: 'walk' }],
		},
	);
	const HELD = {
		...BEAR_SHEET,
		actions: [
			...BEAR_SHEET.actions,
			{ id: 'landed', when: { event: 'caught', as: 'target' }, play: 'hold' },
			{ id: 'dazed', when: { status: 'stunned' }, play: 'hold' },
		],
	};
	same('5. a hold is read and kept', normalizeCharacterSheet(HELD), HELD);
	check(
		'5. …byte for byte through a save, beside the defaults that are not stored',
		text(
			(
				prepareGameConfigDoc(online([bearBot(HELD)], [bear({ sheet: 'bearBot' })])).doc.arcade
					?.characters?.[0] as Entry
			).actions,
		) === text(HELD.actions),
	);
	same(
		'5. a hold is never a default: nothing else stores one',
		[
			characterActionPlay({ when: { event: 'caught' } }),
			characterActionPlay({ when: { status: 'out' } }),
			characterActionPlay({ when: { status: 'out' }, play: 'hold' }),
		],
		['once', 'loop', 'hold'],
	);
	same(
		'5. a view, a source or a draw box this build cannot read is no field at all',
		normalizeCharacterSheet({
			view: { kind: 'vr' },
			source: { kind: 'rig', prefix: 'hero' },
			draw: { width: 0 },
			actions: [],
		}),
		undefined,
	);
	same(
		'5. …nor is a clips source with no prefix',
		normalizeCharacterSheet({ source: { kind: 'clips' } }),
		undefined,
	);
	same(
		'5. a trigger this build does not know is dropped, the others kept; with none left nothing starts the action',
		normalizeCharacterSheet({
			actions: [
				{ id: 'a', when: [{ motion: 'rising' }, { ability: 'ability1' }] },
				{ id: 'b', when: { motion: 'rising' }, fallback: 'a' },
				{ id: 'c', when: [{ status: 's' }, { status: ' s ' }] },
			],
		}),
		{
			actions: [
				{ id: 'a', when: { ability: 'ability1' } },
				{ id: 'b', fallback: 'a' },
				{ id: 'c', when: { status: 's' } },
			],
		},
	);
	const canonical = normalizeCharacterSheet(BEAR_SHEET);
	same('5. a canonical sheet is its own normal form', canonical, BEAR_SHEET);
	check(
		'5. …byte for byte, a second time',
		text(normalizeCharacterSheet(JSON.parse(text(canonical)))) === text(BEAR_SHEET),
	);
	const messy = load(
		online(
			[
				{
					...bearBot(BEAR_SHEET),
					mood: 'grumpy',
					actions: [...BEAR_SHEET.actions, { id: 'x', rate: 2 }],
				},
			],
			[bear({ sheet: ' bearBot ', tint: 'red' })],
		),
	);
	same(
		'5. an unknown field of a character or a class is still dropped, beside a carried sheet',
		[messy.arcade?.characters?.[0], messy.arcade?.online?.characters[0]],
		[
			bearBot({ ...BEAR_SHEET, actions: [...BEAR_SHEET.actions, { id: 'x' }] }),
			bear({ sheet: 'bearBot' }),
		],
	);
	same(
		'5. a sheet on an entry the normalizer drops is not carried',
		load(
			online(
				[bearBot(), { id: 'ghost', ...BEAR_SHEET }],
				[bear(), { id: 'ghost', sheet: 'bearBot' }],
			),
		),
		normalizeGameConfigDoc(online([bearBot()], [bear()])),
	);

	same(
		'5. the facings of each view',
		[
			characterViewFacings(undefined),
			characterViewFacings({ kind: 'side' }),
			characterViewFacings({ kind: 'topDown' }),
			characterViewFacings({ kind: 'isometric' }),
			characterViewFacings({ kind: 'topDown', facings: 8 }).length,
			characterViewFacings({ kind: 'isometric', facings: 8 }).length,
			characterViewFacings({ kind: '3d' }),
		],
		[
			['ne', 'se', 'sw', 'nw'],
			['e', 'w'],
			['n', 'e', 's', 'w'],
			['ne', 'se', 'sw', 'nw'],
			8,
			8,
			[],
		],
	);
	same(
		'5. an action’s play and priority, when it names neither',
		(canonical?.actions ?? []).map((a) => [
			a.id,
			characterTriggers(a).length,
			characterActionPlay(a),
			characterActionPriority(a),
		]),
		[
			['idle', 1, 'loop', 1],
			['walk', 1, 'loop', 1],
			['swipe', 1, 'once', 3],
			['grab', 2, 'once', 3],
			['gold', 1, 'once', 5],
		],
	);
	same(
		'5. an action nothing starts loops at priority 0',
		[characterActionPlay({}), characterActionPriority({})],
		['loop', 0],
	);
	check(
		'5. a sheet is a clip sheet with a source, a width and an action',
		isClipSheet(canonical) &&
			!isClipSheet({ ...canonical, draw: undefined }) &&
			!isClipSheet({ ...canonical, actions: [] }) &&
			!isClipSheet({ view: { kind: 'side' } }) &&
			!isClipSheet(undefined),
	);
	same(
		'5. a character’s sheet is read off the stored doc',
		characterSheetOf(storedSheeted, 'bearBot'),
		BEAR_SHEET,
	);
	same('5. …and none off one with no sheet', characterSheetOf(storedPlain, 'bearBot'), undefined);
	same('5. a class’s sheet is its character’s', onlineClassSheetOf(storedSheeted, 'bear'), {
		id: 'bearBot',
		sheet: BEAR_SHEET,
	});
	same(
		'5. a class has no sheet when it names none, a missing character, one with no sheet, or another component’s',
		[
			onlineClassSheetOf(storedPlain, 'bear'),
			onlineClassSheetOf(online([bearBot(BEAR_SHEET)], [bear({ sheet: 'nobody' })]), 'bear'),
			onlineClassSheetOf(online([bearBot()], [bear({ sheet: 'bearBot' })]), 'bear'),
			onlineClassSheetOf(online([bearBot(BEAR_SHEET)], [salmon({ sheet: 'bearBot' })]), 'salmon'),
		],
		[undefined, undefined, undefined, undefined],
	);
	same('5. the clips the sheets name, for the ship chain', characterSheetClipRoots(storedSheeted), {
		prefixes: ['bear', 'bear_gold', 'salmon'],
		clipIds: ['bear_grab_side'],
	});

	const issuesOf = (doc: unknown, context?: { projection?: 'isometric' | 'flat' }) =>
		validateCharacterSheets(doc, context).map((i) => `${i.severity} ${i.path}`);
	same('5. a sound sheet raises nothing', issuesOf(sheeted, { projection: 'isometric' }), []);
	same('5. nor does a config with no sheet', issuesOf(plain), []);
	const refusal = (doc: unknown): string[] => {
		try {
			prepareGameConfigDoc(doc);
			return [];
		} catch (e) {
			if (!(e instanceof InvalidGameConfigError)) throw e;
			return e.issues.map((i) => i.path);
		}
	};
	const sheetWarnings = (doc: unknown): string[] =>
		prepareGameConfigDoc(doc)
			.warnings.filter((w) => /^arcade\.(online\.)?characters\[/.test(w.path))
			.map((w) => `${w.path}: ${w.message}`);
	const unusable = [
		online([bearBot(BEAR_SHEET)], [bear({ sheet: 'nobody' })]),
		online([bearBot()], [bear({ sheet: 'bearBot' })]),
		online([bearBot(BEAR_SHEET)], [bear(), salmon({ sheet: 'bearBot' })]),
		online([bearBot({ view: { kind: 'isometric' } })], [bear({ sheet: 'bearBot' })]),
	];
	same('5. a class whose sheet cannot be used is saved, never refused', unusable.map(refusal), [
		[],
		[],
		[],
		[],
	]);
	same(
		'5. …and warned of: it names no character, one with no sheet, another component’s, or a sheet with no frame clips',
		unusable.map((doc) => sheetWarnings(doc).map((w) => w.split(':')[0])),
		[
			['arcade.online.characters[0].sheet'],
			['arcade.online.characters[0].sheet'],
			['arcade.online.characters[1].sheet'],
			['arcade.online.characters[0].sheet'],
		],
	);
	check(
		'5. …in words that say the class plays as it did before',
		unusable.every((doc) => sheetWarnings(doc).every((w) => / it (was|did) before\.$/.test(w))),
	);
	same(
		'5. a class whose sheet is a 3D view is not told it has no frame clips',
		issuesOf(
			online([bearBot({ view: { kind: '3d' } })], [bear({ sheet: 'bearBot' })], { world3d: {} }),
		),
		[],
	);

	const stray = {
		characters: [bearBot({ ...BEAR_SHEET, draw: { feet: 1 } })],
		online: { characters: [bear({ sheet: 'nobody' })] },
	};
	const slotSaved = prepareGameConfigDoc(SLOT);
	const straySaved = prepareGameConfigDoc({ ...SLOT, arcade: stray });
	check(
		'5. the fixture: that stray block is refused on an arcade game',
		refusal(online(stray.characters, stray.online.characters)).length === 1,
	);
	same(
		'5. a slot holding a stray arcade block with a broken sheet saves as it did, with nothing reported',
		[straySaved.doc, straySaved.warnings],
		[slotSaved.doc, slotSaved.warnings],
	);

	const L = CHARACTER_SHEET_LIMITS;
	same('5. the sheet’s limits', L, { actions: 64, triggers: 8, variants: 8, points: 16 });
	const many = (n: number) => Array.from({ length: n }, (_, i) => i);
	const big = {
		source: {
			kind: 'clips',
			prefix: 'hero',
			variants: Object.fromEntries(many(L.variants + 1).map((i) => [`s${i}`, `hero${i}`])),
		},
		draw: {
			width: 40,
			points: Object.fromEntries(many(L.points + 1).map((i) => [`p${i}`, { x: i, y: 0 }])),
		},
		actions: [
			{ id: 'a0', when: many(L.triggers + 1).map((i) => ({ status: `s${i}` })) },
			...many(L.actions + 5).map((i) => ({
				id: `a${i}`,
				when: i === 1 ? { motion: 'still' } : { status: `t${i}` },
			})),
		],
	};
	const bounded = normalizeCharacterSheet(big);
	same(
		'5. a sheet keeps the first of each, up to its limits',
		[
			bounded?.actions?.map((a) => a.id),
			characterTriggers(bounded!.actions![0]),
			Object.keys(bounded?.source?.variants ?? {}),
			Object.keys(bounded?.draw?.points ?? {}),
		],
		[
			many(L.actions).map((i) => `a${i}`),
			many(L.triggers).map((i) => ({ status: `s${i}` })),
			many(L.variants).map((i) => `s${i}`),
			many(L.points).map((i) => `p${i}`),
		],
	);
	same(
		'5. …and the bounded sheet is its own normal form',
		normalizeCharacterSheet(bounded),
		bounded,
	);
	same(
		'5. a sheet past a limit is warned of, by path',
		issuesOf(online([bearBot(big)], [bear()])),
		[
			'warning arcade.characters[0].actions',
			'warning arcade.characters[0].source.variants',
			'warning arcade.characters[0].draw.points',
			'warning arcade.characters[0].actions[0].when',
		],
	);
	same('5. …and one at its limits is not', issuesOf(online([bearBot(bounded!)], [bear()])), []);
	const huge = {
		actions: many(20_000).map((i) => ({ id: `a${i % 7}`, when: { motion: 'still' } })),
	};
	same(
		'5. 20,000 actions of seven ids are seven actions',
		normalizeCharacterSheet(huge)?.actions?.length,
		7,
	);

	const named = normalizeCharacterSheet(
		JSON.parse(
			`{"source":{"kind":"clips","prefix":"hero","variants":{"constructor":"a","toString":"b","valueOf":"c","__proto__":"d"}},
			  "draw":{"width":40,"points":{"constructor":{"x":1,"y":1},"toString":{"x":2,"y":2},"__proto__":{"x":3,"y":3}}}}`,
		),
	);
	same(
		'5. a variant or a point may be named as a built-in of an object is',
		[named?.source?.variants, named?.draw?.points],
		[
			{ constructor: 'a', toString: 'b', valueOf: 'c' },
			{ constructor: { x: 1, y: 1 }, toString: { x: 2, y: 2 } },
		],
	);
	check(
		'5. …but never `__proto__`, which stays the object’s own',
		[named?.source?.variants, named?.draw?.points].every(
			(map) =>
				!!map &&
				!Object.hasOwn(map, '__proto__') &&
				Object.getPrototypeOf(map) === Object.prototype,
		),
	);

	const pasted = pageDoc.applyPasted(JSON.parse(bytes));
	same(
		'5. Raw JSON’s Apply keeps the pasted sheets',
		pasted && withoutUndefined(pasted),
		JSON.parse(bytes),
	);
	check(
		'5. …and a paste with no sheet has none',
		characterSheetOf(pageDoc.applyPasted(JSON.parse(text(storedPlain))), 'bearBot') === undefined,
	);
	same(
		'5. a reset replaces the characters, so it keeps no sheet',
		characterSheetOf(pageDoc.resetTo(storedPlain, storedSheeted), 'bearBot'),
		undefined,
	);

	let clones = 0;
	const counted = online([bearBot()], [bear()], {
		world3d: {
			get level() {
				clones += 1;
				return {};
			},
		},
	});
	refusal(counted);
	same('5. a save reads the 3D blocks off its input once', clones, 1);

	same(
		'5. …frame clips with no width, and frame clips with no action',
		refusal(
			online(
				[
					bearBot({ ...BEAR_SHEET, draw: { feet: 1 } }),
					salmonLook({ ...SALMON_SHEET, actions: [] }),
				],
				[bear(), salmon()],
			),
		),
		['arcade.characters[0].draw', 'arcade.characters[1].actions'],
	);
	same(
		'5. a sheet that plays but not as it reads is warned of, by path',
		issuesOf(
			online(
				[
					bearBot({
						view: { kind: 'side' },
						source: BEAR_SHEET.source,
						draw: BEAR_SHEET.draw,
						controller: { kind: 'topDown', speed: 100 },
						actions: [
							{ id: 'walk', when: { motion: 'moving' }, fallback: 'crawl' },
							{ id: 'run', when: [{ motion: 'moving' }, { motion: 'rising' }], fallback: 'run' },
							{ id: 'fly', when: { motion: 'rising' } },
							{ id: 'swipe', when: { ability: 'ability1' } },
							{ id: 'swipe2', when: { ability: 'ability1' } },
						],
					}),
					salmonLook({
						view: { kind: '3d' },
						source: SALMON_SHEET.source,
						draw: { width: 1 },
						actions: SALMON_SHEET.actions,
					}),
				],
				[bear(), salmon()],
			),
			{ projection: 'isometric' },
		),
		[
			'warning arcade.characters[0].view',
			'warning arcade.characters[0].view',
			'warning arcade.characters[0].actions[0].fallback',
			'warning arcade.characters[0].actions[1].fallback',
			'warning arcade.characters[0].actions[1].when',
			'warning arcade.characters[0].actions[1]',
			'warning arcade.characters[0].actions[2].when',
			'warning arcade.characters[0].actions',
			'warning arcade.characters[1].view',
			'warning arcade.characters[1].source',
		],
	);
	same(
		'5. an isometric view on a flat screen is warned of; with no screen named it is not',
		[
			issuesOf(sheeted, { projection: 'flat' }),
			issuesOf(sheeted),
			issuesOf(online([bearBot({ view: { kind: '3d' } })], [bear()], { world3d: {} })),
			issuesOf(online([bearBot({ ...BEAR_SHEET, view: undefined })], [bear()], {}), {
				projection: 'flat',
			}),
		],
		[['warning arcade.characters[0].view'], [], [], []],
	);
	same(
		'5. two actions standing in for each other are not warned of',
		issuesOf(
			online(
				[
					bearBot({
						...BEAR_SHEET,
						actions: [
							{ id: 'idle', when: { motion: 'still' }, fallback: 'walk' },
							{ id: 'walk', when: { motion: 'moving' }, fallback: 'idle' },
						],
					}),
				],
				[bear()],
			),
		),
		[],
	);

	const unplayed = (doc: GameConfigDoc) =>
		validateGameConfigDoc(doc).filter(
			(i) =>
				i.severity === 'warning' &&
				i.path === 'arcade.characters' &&
				i.message.includes(UNPLAYED_CHARACTER_WARNING),
		);
	check(
		'5. the validator’s "a character no bot plays" warning is still worded as sheetAwareIssues finds it',
		unplayed(storedPlain).length === 1,
	);
	const warned = (doc: unknown) => prepareGameConfigDoc(doc).warnings.map((i) => i.path);
	check(
		'5. the save warns of a character no bot plays',
		warned(plain).includes('arcade.characters'),
	);
	check(
		'5. …not when every such character is a class’s sheet',
		!warned(sheeted).includes('arcade.characters'),
	);
	check(
		'5. …but still when one of them is not',
		warned(
			online(
				[bearBot(BEAR_SHEET), salmonLook(SALMON_SHEET)],
				[bear({ sheet: 'bearBot' }), salmon()],
			),
		).includes('arcade.characters'),
	);
	const others = validateGameConfigDoc(storedPlain);
	check(
		'5. sheetAwareIssues returns the list itself when it drops nothing, and drops only that warning',
		sheetAwareIssues(others, storedPlain) === others &&
			sheetAwareIssues(others, storedSheeted).length === others.length - 1,
	);

	// A rig source and a still image (character pipeline C6a).
	const CRATE = 'invisible_wall/demo/manifests/atlas_manifest_S_Props.json';
	const RIG_SHEET = {
		view: { kind: 'side' },
		source: {
			kind: 'rig',
			rig: 'bearRig',
			rigs: { e: 'bearSide' },
			variants: { marked: 'gold' },
		},
		draw: { width: 92, bones: { hand: 'hand_r' } },
		actions: [
			{ id: 'idle', when: { motion: 'still' } },
			{ id: 'swipe', when: { ability: 'ability1' }, anim: { e: { anim: 'attack' } } },
			{ id: 'roar', when: { ability: 'ability2' }, anim: { e: { anim: 'roar', rig: 'bearHead' } } },
		],
	};
	const STILL_SHEET = {
		source: { kind: 'stills' },
		draw: { width: 48 },
		actions: [
			{
				id: 'idle',
				when: { motion: 'still' },
				anim: { se: { still: { assetKey: CRATE, region: 'crate' } } },
			},
			{ id: 'walk', when: { motion: 'moving' }, fallback: 'idle' },
		],
	};
	const MIXED_SHEET = {
		source: { kind: 'clips', prefix: 'salmon' },
		draw: { width: 60 },
		actions: [
			{
				id: 'idle',
				when: { motion: 'still' },
				anim: {
					ne: { still: { assetKey: CRATE, region: 'fin' } },
					se: { clip: 'salmon_rest' },
				},
			},
		],
	};
	for (const [name, sheet] of [
		['a rig', RIG_SHEET],
		['still images', STILL_SHEET],
		['clips with a still cell', MIXED_SHEET],
	] as const) {
		same(
			`5. a canonical sheet of ${name} comes back key for key`,
			normalizeCharacterSheet(sheet),
			sheet,
		);
		const doc = online([bearBot(sheet)], [bear({ sheet: 'bearBot' })]);
		same(
			`5. …the save keeps it as authored`,
			prepareGameConfigDoc(doc).doc.arcade?.characters?.[0],
			bearBot(sheet),
		);
		same(`5. …and a sound one raises nothing`, issuesOf(doc), []);
		same(
			'5. …and the room’s game is the same with or without it',
			normalizeGameConfigDoc(doc),
			normalizeGameConfigDoc(online([bearBot()], [bear()])),
		);
	}
	same(
		'5. a rig source is trimmed and sparse: unknown facings, empty names and cells with no animation are dropped',
		normalizeCharacterSheet({
			source: {
				kind: 'rig',
				rig: ' bearRig ',
				rigs: { e: ' bearSide ', up: 'x', w: '' },
				variants: { ' marked ': ' gold ', out: '' },
				prefix: 'bear',
			},
			draw: { width: 92, bones: { ' hand ': ' hand_r ', foot: 7 } },
			actions: [
				{
					id: 'idle',
					anim: {
						e: { anim: ' rest ', rig: ' ' },
						w: { rig: 'bearHead' },
						n: { still: { assetKey: CRATE } },
						s: { still: { assetKey: ` ${CRATE} `, region: ' crate ' } },
						ne: { clip: 'a', anim: 'b', still: { assetKey: CRATE, region: 'c' } },
					},
				},
			],
		}),
		{
			source: {
				kind: 'rig',
				rig: 'bearRig',
				rigs: { e: 'bearSide' },
				variants: { marked: 'gold' },
			},
			draw: { width: 92, bones: { hand: 'hand_r' } },
			actions: [
				{
					id: 'idle',
					anim: {
						ne: { clip: 'a' },
						e: { anim: 'rest' },
						s: { still: { assetKey: CRATE, region: 'crate' } },
					},
				},
			],
		},
	);
	same(
		'5. a rig source that names no rig is no source; a rig per facing alone is one',
		[
			normalizeCharacterSheet({ source: { kind: 'rig' } }),
			normalizeCharacterSheet({ source: { kind: 'rig', rigs: { up: 'x' } } }),
			normalizeCharacterSheet({ source: { kind: 'rig', rigs: { ne: 'back' } } }),
		],
		[undefined, undefined, { source: { kind: 'rig', rigs: { ne: 'back' } } }],
	);
	const namesOf = (n: number) =>
		Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, 'v']));
	const capped = normalizeCharacterSheet({
		source: { kind: 'rig', rig: 'r', variants: namesOf(CHARACTER_SHEET_LIMITS.variants + 3) },
		draw: { width: 1, bones: namesOf(CHARACTER_SHEET_LIMITS.points + 3) },
	});
	check(
		'5. a rig’s skins and a draw box’s bones are read up to the sheet’s limits',
		capped?.source?.kind === 'rig' &&
			Object.keys(capped.source.variants ?? {}).length === CHARACTER_SHEET_LIMITS.variants &&
			Object.keys(capped.draw?.bones ?? {}).length === CHARACTER_SHEET_LIMITS.points,
	);
	const c6 = online(
		[
			bearBot(RIG_SHEET),
			salmonLook(MIXED_SHEET),
			{ id: 'crate', component: 'crateLook', ...STILL_SHEET },
		],
		[bear({ sheet: 'bearBot' })],
	);
	same('5. the rigs the sheets name, for the ship chain', characterSheetRigRoots(c6), [
		'bearRig',
		'bearSide',
		'bearHead',
	]);
	same('5. …and their still images', characterSheetStillRoots(c6), [
		{ assetKey: CRATE, region: 'fin' },
		{ assetKey: CRATE, region: 'crate' },
	]);
	same('5. …and their clips: a rig and a still name none', characterSheetClipRoots(c6), {
		prefixes: ['salmon'],
		clipIds: ['salmon_rest'],
	});
	same(
		'5. a config with no sheet names no rig and no still',
		[characterSheetRigRoots(storedPlain), characterSheetStillRoots(storedPlain)],
		[[], []],
	);
	same(
		'5. the carry puts a rig and a still back on the normalized doc',
		withCharacterSheets(normalizeGameConfigDoc(c6), c6),
		prepareGameConfigDoc(c6).doc,
	);
	const sheetIssues = (sheet: Entry) =>
		issuesOf(online([bearBot(sheet)], [bear({ sheet: 'bearBot' })]));
	same(
		'5. a rig source that names no rig is refused',
		sheetIssues({ ...RIG_SHEET, source: { kind: 'rig' } }),
		['warning arcade.online.characters[0].sheet', 'error arcade.characters[0].source'],
	);
	same(
		'5. a rig with no width or no action is refused, as clips are',
		[
			sheetIssues({ ...RIG_SHEET, draw: undefined }),
			sheetIssues({ ...RIG_SHEET, actions: undefined }),
			sheetIssues({ ...STILL_SHEET, draw: undefined }),
		],
		[
			['error arcade.characters[0].draw'],
			['error arcade.characters[0].actions'],
			['error arcade.characters[0].draw'],
		],
	);
	same(
		'5. still images with no image are refused',
		sheetIssues({ ...STILL_SHEET, actions: [{ id: 'idle', when: { motion: 'still' } }] }),
		['error arcade.characters[0].actions'],
	);
	same(
		'5. a cell its source does not draw, a cell that names nothing, a still that cannot ship, a rig of a facing the view lacks and bones off a rig are warned of',
		[
			sheetIssues({
				...RIG_SHEET,
				source: { kind: 'rig', rig: 'bearRig', rigs: { n: 'bearBack' } },
				actions: [
					{
						id: 'idle',
						when: { motion: 'still' },
						anim: { e: { clip: 'bear_idle_e' }, w: { rig: 'bearHead' }, n: { still: {} } },
					},
				],
			}),
			sheetIssues({
				...MIXED_SHEET,
				draw: { width: 60, bones: { hand: 'hand_r' } },
				actions: [
					{
						id: 'idle',
						when: { motion: 'still' },
						anim: { e: { anim: 'rest' }, se: { still: { assetKey: 'S_Props', region: 'fin' } } },
					},
				],
			}),
			sheetIssues({
				...STILL_SHEET,
				actions: [
					{
						id: 'idle',
						when: { motion: 'still' },
						anim: { se: { still: { assetKey: CRATE, region: 'crate' } }, e: { clip: 'x' } },
					},
				],
			}),
		],
		[
			[
				'warning arcade.characters[0].source.rigs.n',
				'warning arcade.characters[0].actions[0].anim.n',
				'warning arcade.characters[0].actions[0].anim.e',
				'warning arcade.characters[0].actions[0].anim.w',
			],
			[
				'warning arcade.characters[0].draw.bones',
				'warning arcade.characters[0].actions[0].anim.e',
				'warning arcade.characters[0].actions[0].anim.se',
			],
			['warning arcade.characters[0].actions[0].anim.e'],
		],
	);
	const holdIssues = (actions: Entry[]) =>
		sheetIssues({ ...BEAR_SHEET, actions: [BEAR_SHEET.actions[0], ...actions] });
	same(
		'5. a hold nothing played once may cut is warned of, never refused',
		[
			holdIssues([{ id: 'dead', when: { event: 'caught', as: 'target' }, play: 'hold' }]),
			holdIssues([
				{ id: 'dead', when: { event: 'caught', as: 'target' }, play: 'hold' },
				{ id: 'swipe', when: { ability: 'ability1' } },
			]),
			holdIssues([
				{
					id: 'dead',
					when: { event: 'caught', as: 'target' },
					play: 'hold',
					interrupt: 'none',
				},
				{ id: 'swipe', when: { ability: 'ability1' } },
			]),
			holdIssues([
				{
					id: 'dead',
					when: { event: 'caught', as: 'target' },
					play: 'hold',
					interrupt: 'priority',
				},
				{ id: 'swipe', when: { ability: 'ability1' }, priority: 2 },
			]),
			holdIssues([
				{
					id: 'dead',
					when: { event: 'caught', as: 'target' },
					play: 'hold',
					interrupt: 'priority',
				},
				{ id: 'swipe', when: { ability: 'ability1' }, priority: 4 },
			]),
			holdIssues([{ id: 'dead', when: { status: 'out' }, play: 'hold' }]),
		],
		[
			['warning arcade.characters[0].actions[1].play'],
			[],
			['warning arcade.characters[0].actions[1].play'],
			['warning arcade.characters[0].actions[1].play'],
			[],
			[],
		],
	);
	same(
		'5. a hold and a loop on one trigger at one priority are warned of, as two loops are',
		[
			holdIssues([
				{ id: 'dead', when: { status: 'out' }, play: 'hold' },
				{ id: 'flop', when: { status: 'out' } },
			]),
			holdIssues([{ id: 'stand', when: { motion: 'still' }, play: 'hold' }]),
		],
		[['warning arcade.characters[0].actions[2]'], ['warning arcade.characters[0].actions[1]']],
	);
	check(
		'5. …in words that do not call a hold a loop',
		sheetWarnings(
			online(
				[
					bearBot({
						...BEAR_SHEET,
						actions: [
							{ id: 'stand', when: { motion: 'still' }, play: 'hold' },
							BEAR_SHEET.actions[0],
						],
					}),
				],
				[bear({ sheet: 'bearBot' })],
			),
		).some((w) =>
			w.endsWith(
				'"stand" and "idle" are drawn on the same trigger at the same priority, so only "stand" plays.',
			),
		),
	);
	same(
		'5. a save refuses a rig that names none, and keeps one that only warns',
		[
			refusal(online([bearBot({ ...RIG_SHEET, source: { kind: 'rig' } })], [bear()])),
			refusal(
				online([bearBot({ ...RIG_SHEET, draw: { width: 92 }, view: { kind: '3d' } })], [bear()]),
			),
		],
		[['arcade.characters[0].source'], []],
	);
}

// ── 6. the room's size and the bots' shares ─────────────────────────────────────────────────────
{
	type Share = { character: string; share: number };
	const shares = (...list: number[]): Share[] =>
		list.map((share, i) => ({ character: 'abcdefghijklmnop'[i], share }));
	const SALMONS: Share[] = [
		{ character: 'salmon', share: 60 },
		{ character: 'fisherman', share: 25 },
		{ character: 'bear', share: 15 },
	];
	for (const [label, set] of [
		['60 / 25 / 15', SALMONS],
		['equal shares', shares(1, 1, 1)],
		['one dominant share', shares(97, 1, 1, 1)],
		['five classes', shares(40, 25, 15, 12, 8)],
		['decimal shares', shares(0.7, 0.2, 0.1)],
		['sixteen classes', shares(...Array.from({ length: 16 }, (_, i) => i + 1))],
	] as const) {
		const sum = set.reduce((total, c) => total + c.share, 0);
		const wrong: string[] = [];
		for (let size = set.length; size <= 100; size += 1) {
			const counts = botShareCounts(size, set);
			const quotas = set.map((c) => (size * c.share) / sum);
			const got = set.map((c) => counts[c.character]);
			const fair = quotas.every((q) => q >= 1);
			const ok =
				got.reduce((total, n) => total + n, 0) === size &&
				got.every((n) => Number.isInteger(n) && n >= 1) &&
				got.every((n, i) => n - quotas[i] < 1 - 1e-9) &&
				(!fair || got.every((n, i) => quotas[i] - n < 1 - 1e-9));
			if (!ok) wrong.push(`${size}: ${got.join('/')}`);
		}
		same(
			`6. ${label}: every size from ${set.length} to 100 adds up, with no class at 0`,
			wrong,
			[],
		);
	}
	same(
		'6. 60 / 25 / 15 at 3, 4, 5, 10, 20, 30, 50 and 100',
		[3, 4, 5, 10, 20, 30, 50, 100].map((size) => {
			const c = botShareCounts(size, SALMONS);
			return `${c.salmon}/${c.fisherman}/${c.bear}`;
		}),
		['1/1/1', '2/1/1', '3/1/1', '6/3/1', '12/5/3', '18/8/4', '30/13/7', '60/25/15'],
	);
	same(
		'6. shares are relative: 12 / 5 / 3 is 60 / 25 / 15 at every size',
		Array.from({ length: 98 }, (_, i) =>
			botShareCounts(
				i + 3,
				SALMONS.map((c) => ({ ...c, share: c.share / 5 })),
			),
		),
		Array.from({ length: 98 }, (_, i) => botShareCounts(i + 3, SALMONS)),
	);
	same(
		'6. a tie goes to the larger share, then the earlier class; places over leave the later first',
		[
			botShareCounts(4, shares(1, 1, 1)),
			botShareCounts(10, shares(25, 60, 15)),
			botShareCounts(5, shares(50, 50, 1, 1)),
		],
		[
			{ a: 2, b: 1, c: 1 },
			{ a: 3, b: 6, c: 1 },
			{ a: 2, b: 1, c: 1, d: 1 },
		],
	);
	same(
		'6. a share that is not a positive number, and a repeated class, have no places',
		botShareCounts(10, [
			{ character: 'a', share: 3 },
			{ character: 'b', share: 0 },
			{ character: 'c', share: Number.NaN },
			{ character: 'a', share: 9 },
			{ character: 'd', share: 1 },
		]),
		{ a: 8, d: 2 },
	);

	const BRAIN = { initial: 'roam', states: [{ id: 'roam', behaviour: 'wander' }], transitions: [] };
	const body = { shape: 'box', w: 40, h: 40 };
	type Entry = Record<string, unknown>;
	const raw = (online: Entry = {}, bots: Entry = {}, classes: Record<string, Entry> = {}) => ({
		family: 'arcade',
		outcome: 'rules',
		arcade: {
			field: { w: 2000, h: 1200 },
			bodies: { salmonBody: body, fishermanBody: body, bearBody: body },
			characters: ['salmonBot', 'fishermanBot', 'bearBot'].map((id) => ({
				id,
				component: id.replace('Bot', 'Body'),
				brain: BRAIN,
			})),
			online: {
				maxPlayers: 30,
				characters: ['salmon', 'fisherman', 'bear'].map((id) => ({
					id,
					body: `${id}Body`,
					speed: 200,
					...classes[id],
				})),
				bots: {
					characters: [
						{ character: 'salmon', brain: 'salmonBot', share: 60 },
						{ character: 'fisherman', brain: 'fishermanBot', share: 25 },
						{ character: 'bear', brain: 'bearBot', share: 15 },
					],
					spawns: [
						{ x: 100, y: 100 },
						{ x: 300, y: 100 },
					],
					...bots,
				},
				...online,
			},
		},
	});
	const BY_COUNT = [
		{ character: 'salmon', brain: 'salmonBot' },
		{ character: 'bear', brain: 'bearBot' },
	];
	const stored = (doc: unknown) => JSON.stringify(normalizeGameConfigDoc(doc));
	const byCount = raw({}, { characters: BY_COUNT, fillTo: 8 }, { bear: { max: 3 } });
	const byShares = raw();
	check(
		'6. a config by count is stored byte for byte, with no share',
		stored(JSON.parse(stored(byCount))) === stored(byCount) &&
			!stored(byCount).includes('share') &&
			stored(byCount).includes(
				'"bots":{"characters":[{"character":"salmon","brain":"salmonBot"},{"character":"bear","brain":"bearBot"}],"fillTo":8,',
			),
		stored(byCount),
	);
	check(
		'6. a config by shares round-trips with its shares',
		stored(JSON.parse(stored(byShares))) === stored(byShares) &&
			stored(byShares).includes('{"character":"salmon","brain":"salmonBot","share":60}'),
		stored(byShares),
	);
	same(
		'6. a share that is not a positive number is not stored',
		normalizeGameConfigDoc(
			raw(
				{},
				{
					characters: [0, -5, '60', null, 0.5].map((share) => ({
						character: 'salmon',
						brain: 'salmonBot',
						share,
					})),
				},
			),
		)?.arcade?.online?.bots?.characters.map((b) => b.share),
		[undefined, undefined, undefined, undefined, 0.5],
	);

	const FIELD = { w: 2000, h: 1200 };
	const resolved = (doc: unknown, size?: number) =>
		resolveArcadeOnline(normalizeGameConfigDoc(doc), FIELD, size === undefined ? {} : { size })!;
	const facts = (doc: unknown, size?: number) => {
		const r = resolved(doc, size);
		return [r.maxPlayers, r.bots.fillTo, r.bots.counts, r.characters.map((c) => c.max)];
	};
	same(
		"6. by shares: the counts, each class's places (over an authored Most) and a full room",
		facts(raw({}, { fillTo: 4 }, { bear: { max: 9 } })),
		[30, 30, { salmon: 18, fisherman: 8, bear: 4 }, [18, 8, 4]],
	);
	same(
		'6. by count: no counts, the fill and each Most as authored',
		[facts(byCount), 'counts' in resolved(byCount).bots],
		[[30, 8, undefined, [undefined, undefined, 3]], false],
	);
	same(
		'6. a class no bot plays keeps its own Most beside the shares',
		facts(
			raw(
				{},
				{ characters: [{ character: 'salmon', brain: 'salmonBot', share: 1 }] },
				{ bear: { max: 2 } },
			),
		),
		[30, 30, { salmon: 30 }, [30, undefined, 2]],
	);
	same(
		"6. a test room's size: everything follows it, held from one of each class to the room size",
		[10, 1, 500, 3.4, Number.NaN].map((size) => facts(byShares, size)),
		[
			[10, 10, { salmon: 6, fisherman: 3, bear: 1 }, [6, 3, 1]],
			[3, 3, { salmon: 1, fisherman: 1, bear: 1 }, [1, 1, 1]],
			[30, 30, { salmon: 18, fisherman: 8, bear: 4 }, [18, 8, 4]],
			[3, 3, { salmon: 1, fisherman: 1, bear: 1 }, [1, 1, 1]],
			[30, 30, { salmon: 18, fisherman: 8, bear: 4 }, [18, 8, 4]],
		],
	);
	same(
		'6. a test room by count: the size and the fill held to it',
		[facts(byCount, 1), facts(byCount, 5), facts(byCount, 99)],
		[
			[2, 2, undefined, [undefined, undefined, 3]],
			[5, 5, undefined, [undefined, undefined, 3]],
			[30, 8, undefined, [undefined, undefined, 3]],
		],
	);
	same(
		'6. the sizes a test room may have, of an authored block and of a resolved one',
		[
			onlineTestSizeRange(normalizeGameConfigDoc(byShares)!.arcade!.online!),
			onlineTestSizeRange(resolved(byShares)),
			onlineTestSizeRange(normalizeGameConfigDoc(byCount)!.arcade!.online!),
			onlineTestSizeRange({ characters: [] } as never),
			onlineTestSizeRange(normalizeGameConfigDoc(raw({ maxPlayers: 500 }))!.arcade!.online!),
			onlineTestSizeRange(normalizeGameConfigDoc(raw({ maxPlayers: 2 }))!.arcade!.online!),
		],
		[
			{ min: 3, max: 30 },
			{ min: 3, max: 30 },
			{ min: 2, max: 30 },
			{ min: 2, max: 16 },
			{ min: 3, max: 100 },
			{ min: 2, max: 2 },
		],
	);
	const game = (doc: unknown, size?: number) => {
		const made = onlineGameOf(normalizeGameConfigDoc(doc), size === undefined ? {} : { size });
		return made && 'online' in made
			? [made.online.maxPlayers, made.online.bots.counts]
			: made?.refused;
	};
	same(
		"6. the game a room plays: its own size, and a test room's",
		[game(byShares), game(byShares, 10)],
		[
			[30, { salmon: 18, fisherman: 8, bear: 4 }],
			[10, { salmon: 6, fisherman: 3, bear: 1 }],
		],
	);

	const issues = (doc: unknown) =>
		validateGameConfigDoc(normalizeGameConfigDoc(doc)!)
			.filter((i) => /^arcade\.online\.(bots|maxPlayers|characters\[\d+\]\.max)/.test(i.path))
			.map((i) => `${i.severity} ${i.path}: ${i.message}`);
	same('6. bots by shares with spawns of their own: nothing to say', issues(byShares), []);
	same('6. bots by count: nothing to say', issues(byCount), []);
	same(
		'6. some bots with a share and some without is refused',
		issues(
			raw({}, { characters: [{ character: 'salmon', brain: 'salmonBot', share: 3 }, ...BY_COUNT] }),
		),
		[
			'error arcade.online.bots.characters: Some bots have a share of the room and some have none: give every bot a share, or none.',
		],
	);
	// A class with no share has no place in a room that is kept full by shares.
	const PLACELESS =
		'warning arcade.online.bots.characters: No bot has a share for "fisherman", "bear": every place of the room belongs to a class with a share, so nobody can play it. Give it a share.';
	same(
		'6. two shares for one class is refused',
		issues(
			raw(
				{},
				{
					characters: [
						{ character: 'salmon', brain: 'salmonBot', share: 3 },
						{ character: 'salmon', brain: 'bearBot', share: 1 },
					],
				},
			),
		),
		[
			'error arcade.online.bots.characters[1].character: Two bots with a share play "salmon": a class has one share of the room.',
			PLACELESS,
		],
	);
	same(
		'6. a room too small for one of each class is refused, and the game with it',
		[issues(raw({ maxPlayers: 2 })), game(raw({ maxPlayers: 2 }))],
		[
			[
				"error arcade.online.maxPlayers: A room of 2 cannot hold one of each of 3 classes: the bots' shares need a room size of at least 3.",
			],
			"arcade.online.maxPlayers: A room of 2 cannot hold one of each of 3 classes: the bots' shares need a room size of at least 3.",
		],
	);
	same(
		'6. by shares, an authored fill and an authored Most are said to be unread',
		issues(raw({}, { fillTo: 8 }, { bear: { max: 9 } })),
		[
			'warning arcade.online.bots.fillTo: fillTo (8) is not read: bots with shares keep the room full (30).',
			'warning arcade.online.characters[2].max: The most of "bear" (9) is not read: its places follow from its share of the room (4 of 30).',
		],
	);
	same(
		"6. a room size past the server's limit says what the server holds it to",
		issues(raw({ maxPlayers: 250 })),
		[
			'warning arcade.online.maxPlayers: The room size is 250; the game server holds a room to 2–100 players.',
		],
	);
	same(
		'6. a share outside its range is warned of',
		issues(raw({}, { characters: [{ character: 'salmon', brain: 'salmonBot', share: 5000 }] })),
		[
			'warning arcade.online.bots.characters[0].share: The share of "salmon" is 5000; a room holds it to 0.01–1000.',
			PLACELESS,
		],
	);
	const points = [
		{ x: 10, y: 10 },
		{ x: 20, y: 20 },
	];
	const STACKED =
		'warning arcade.online.bots.spawns: The bots have no spawns, so every bot of "salmon" (18), "fisherman" (8) starts on the room\'s one spawn: give the bots spawns, or each class spawns of its own.';
	same(
		'6. bots with no spawns start on one point, but for a class with spawns of its own (in turn or at random), a class of one bot and a generated field',
		[
			issues(raw({}, { spawns: undefined }, { bear: { spawns: points, randomSpawn: true } })),
			issues(raw({}, { spawns: undefined }, { bear: { spawns: points } })),
			issues(raw({ maxPlayers: 3 }, { spawns: undefined })),
			issues(raw({ generator: 'salmonsMap' }, { spawns: undefined })),
		],
		[[STACKED], [STACKED], [], []],
	);
}

// ── 7. touch control schemes ────────────────────────────────────────────────────────────────────
{
	const { prepareGameConfigDoc } = await import('../src/lib/server/gameConfigStorage.ts');
	const dataDir = new URL('../src/lib/data/gameConfig/', import.meta.url);
	const read = (name: string): Record<string, unknown> =>
		JSON.parse(readFileSync(fileURLToPath(new URL(name, dataDir)), 'utf8'));
	const seed = read('arcade.rules.json');
	const text = (v: unknown) => JSON.stringify(v);
	type Entry = Record<string, unknown>;
	const game = (online: Entry = {}): Entry => ({
		...seed,
		arcade: {
			...(seed.arcade as object),
			field: { w: 2000, h: 1200 },
			online: {
				characters: [
					{ id: 'salmon', body: 'arcadeSalmon', speed: 240 },
					{ id: 'bear', body: 'arcadeBear', speed: 190 },
				],
				pointer: { taps: { salmon: 'ability1', bear: 'ability1' } },
				...online,
			},
		},
	});
	/** What a load makes of stored bytes: the normalizer, then the carries
	 *  (`loadGameConfigDocWithEtag`). */
	const load = (stored: unknown): GameConfigDoc =>
		withSlide(
			withOnlineCarry(
				withTouchSchemes(
					withCharacterSheets(normalizeGameConfigDoc(stored) as GameConfigDoc, stored),
					stored,
				),
				stored,
			),
			stored,
		);
	const save = (live: GameConfigDoc) =>
		prepareGameConfigDoc(JSON.parse(text(pageDoc.bodyFor(live))));
	const touchIn = (doc: unknown) =>
		((((doc as Entry).arcade as Entry).online as Entry) ?? {}).touch as Entry | undefined;

	// A hook's `carry` and the marks' opacity ride the same carry through a save and a load.
	{
		const live = game() as GameConfigDoc;
		const rules = (live.arcade!.online!.rules ??= {});
		rules.abilities = [
			{
				character: live.arcade!.online!.characters[0].id,
				button: 'ability1',
				reach: 60,
				targets: [live.arcade!.online!.characters[0].id],
				effect: 'hook',
				carry: { holdMs: 6000, walk: false },
			},
		];
		rules.stains = { opacity: 0.5 };
		const saved = save(live);
		const back = load(JSON.parse(text(saved.doc)));
		same(
			'7. a hook’s carry survives a save and a load',
			back.arcade?.online?.rules?.abilities?.[0].carry,
			{ holdMs: 6000, walk: false },
		);
		same('7. …and so does the marks’ opacity', back.arcade?.online?.rules?.stains, {
			opacity: 0.5,
		});
	}

	// No touch block: nothing changes.
	for (const name of readdirSync(fileURLToPath(dataDir)).filter((n) => n.endsWith('.json'))) {
		const normalized = normalizeGameConfigDoc(read(name)) as GameConfigDoc;
		check(
			`7. ${name}: no touch scheme, so the carry returns the doc itself`,
			withTouchSchemes(normalized, read(name)) === normalized,
		);
	}
	const plain = game();
	const storedPlain = prepareGameConfigDoc(plain);
	const plainBytes = text(storedPlain.doc);
	same(
		'7. no touch block: the save stores what the normalizer makes, byte for byte',
		plainBytes,
		text(normalizeGameConfigDoc(plain)),
	);
	check(
		'7. …a load and the save after it give the same bytes',
		text(save(pageDoc.openDoc(load(JSON.parse(plainBytes)))).doc) === plainBytes,
	);
	check(
		'7. …with no touch key and no touch warning',
		!plainBytes.includes('"touch"') &&
			!storedPlain.warnings.some((i) => i.path.startsWith('arcade.online.touch')),
	);

	// The slide (`arcade.online.slide`): dropped by the normalizer, carried by the save and the load.
	{
		const slideIn = (doc: unknown) =>
			((((doc as Entry).arcade as Entry).online as Entry) ?? {}).slide;
		const slideWarnings = (issues: GameConfigIssue[]) =>
			issues.filter((i) => i.path.startsWith('arcade.online.slide')).map((i) => i.severity);
		check(
			'7. no slide: the save adds none and warns of none',
			!plainBytes.includes('"slide"') && !slideWarnings(storedPlain.warnings).length,
		);
		const sliding = prepareGameConfigDoc(game({ slide: { corner: 168 } }));
		same(
			'7. a slide: the normalizer drops it, the save keeps it and has no warning of it',
			[
				slideIn(normalizeGameConfigDoc(game({ slide: { corner: 168 } }))),
				slideIn(sliding.doc),
				slideWarnings(sliding.warnings),
			],
			[undefined, { corner: 168 }, []],
		);
		const slidingBytes = text(sliding.doc);
		check(
			'7. …a load and the save after it give the same bytes',
			text(save(pageDoc.openDoc(load(JSON.parse(slidingBytes)))).doc) === slidingBytes,
		);
		const far = prepareGameConfigDoc(game({ slide: { corner: 900 } }));
		same(
			'7. a corner out of range is stored as written and the save warns of it',
			[slideIn(far.doc), slideWarnings(far.warnings)],
			[{ corner: 900 }, ['warning']],
		);
		same(
			'7. a corner of no size, or not a number, is not stored',
			[
				text(prepareGameConfigDoc(game({ slide: { corner: 0 } })).doc),
				text(prepareGameConfigDoc(game({ slide: { corner: 'far' } })).doc),
			],
			[plainBytes, plainBytes],
		);
		same(
			'7. a slide on a game not played online is not stored',
			text(
				prepareGameConfigDoc({ ...seed, arcade: { ...(seed.arcade as object), slide: 168 } }).doc,
			).includes('"slide"'),
			false,
		);
		const paged = pageDoc.openDoc(load(JSON.parse(plainBytes)));
		const pagedSlide = () => paged.arcade?.online?.slide;
		const typedSlide = (value: string) => {
			onlineDoc.setSlideCorner(paged, value);
			return [pagedSlide(), slideOf(paged), slideIn(save(paged).doc)];
		};
		same(
			'7. the page’s setter: a corner as typed, as the carry reads it and as the save stores it',
			typedSlide('168'),
			[{ corner: 168 }, { corner: 168 }, { corner: 168 }],
		);
		same(
			'7. …the page lists an out-of-range corner as the save warns of it',
			[
				(typedSlide('900'), pageDoc.pageIssues(paged, 'arcade').map((i) => i.path)).filter((p) =>
					p.startsWith('arcade.online.slide'),
				),
				slideWarnings(save(paged).warnings),
			],
			[['arcade.online.slide.corner'], ['warning']],
		);
		for (const [what, value] of [
			['of no size', '0'],
			['that cannot be read', 'far'],
			['left empty', ''],
		]) {
			onlineDoc.setSlideCorner(paged, '168');
			same(`7. …a corner ${what} is none`, typedSlide(value), [undefined, undefined, undefined]);
		}
		same('7. …and the save is the plain one again', text(save(paged).doc), plainBytes);
		const pasted = pageDoc.applyPasted(game({ slide: { corner: 168 } }));
		same(
			'7. Raw JSON’s Apply keeps the pasted slide, and one removed from the text is removed',
			[pasted?.arcade?.online?.slide, pageDoc.applyPasted(game())?.arcade?.online?.slide],
			[{ corner: 168 }, undefined],
		);
	}

	// The setters, on the page's live doc.
	const live = pageDoc.openDoc(load(JSON.parse(plainBytes)));
	const liveBefore = text(live);
	const touch = () => live.arcade?.online?.touch;
	/** After an edit: the block is exactly its stored form, and the save stores it as it is. */
	const stored = (name: string, expected: unknown): void => {
		same(`7. ${name}`, touch(), expected);
		same(`7. ${name}: as the carry reads it`, touch(), touchOf(live));
		same(`7. ${name}: as the save stores it`, touchIn(save(live).doc), touch());
	};
	check('7. (fixture) a scheme can be added', touchDoc.canAddTouchScheme(live));
	same(
		'7. add from a preset: a copy of its fields under its label, a second under a numbered name, an unknown preset refused',
		[
			touchDoc.addTouchScheme(live, 'heading'),
			touchDoc.addTouchScheme(live, 'steer'),
			touchDoc.addTouchScheme(live, 'heading'),
			touchDoc.addTouchScheme(live, 'nothing'),
		],
		['Hold or tap to head', 'Hold to steer', 'Hold or tap to head 2', undefined],
	);
	stored('add: sparse, in the order added, and no class is given one', {
		schemes: {
			'Hold or tap to head': { gestures: 'both' },
			'Hold to steer': {},
			'Hold or tap to head 2': { gestures: 'both' },
		},
	});
	check(
		'7. a scheme is a copy: the preset is not the stored object',
		touch()?.schemes['Hold or tap to head'] !== ARCADE_TOUCH_PRESETS.heading.scheme &&
			text(ARCADE_TOUCH_PRESETS.heading.scheme) === text({ gestures: 'both' }),
	);

	const S = 'Hold to steer';
	const set = (field: touchDoc.TouchSchemeField, value: string | boolean) =>
		touchDoc.setTouchSchemeField(live, S, field, value);
	set('gestures', 'tap');
	set('steer', 'stick');
	set('deadZone', '40');
	set('tapPx', '20');
	set('tapMs', '0');
	set('releaseStops', false);
	set('ability', 'target');
	set('aim', 'ahead');
	set('targetRadius', '90');
	stored('every field tuned, in the stored order', {
		schemes: {
			'Hold or tap to head': { gestures: 'both' },
			[S]: {
				gestures: 'tap',
				steer: 'stick',
				deadZone: 40,
				tapPx: 20,
				tapMs: 0,
				releaseStops: false,
				ability: 'target',
				aim: 'ahead',
				targetRadius: 90,
			},
			'Hold or tap to head 2': { gestures: 'both' },
		},
	});
	set('deadZone', '5000');
	set('tapPx', '-1');
	set('tapMs', 'soon');
	stored('a number over its limit is held to it; one below 0 or unreadable is cleared', {
		schemes: {
			'Hold or tap to head': { gestures: 'both' },
			[S]: {
				gestures: 'tap',
				steer: 'stick',
				deadZone: ARCADE_TOUCH_LIMITS.deadZone.max,
				releaseStops: false,
				ability: 'target',
				aim: 'ahead',
				targetRadius: 90,
			},
			'Hold or tap to head 2': { gestures: 'both' },
		},
	});
	set('gestures', 'hold');
	set('steer', 'finger');
	set('deadZone', '');
	set('tapMs', String(ARCADE_TOUCH_DEFAULTS.tapMs));
	set('releaseStops', true);
	set('ability', 'tap');
	set('aim', 'point');
	set('targetRadius', String(ARCADE_TOUCH_DEFAULTS.targetRadius));
	touchDoc.setTouchSchemeField(live, 'nobody', 'gestures', 'both');
	stored('a default is not stored, and a scheme that does not exist is not made', {
		schemes: {
			'Hold or tap to head': { gestures: 'both' },
			[S]: {},
			'Hold or tap to head 2': { gestures: 'both' },
		},
	});

	// A class's scheme.
	touchDoc.setClassTouchScheme(live, 'salmon', S);
	touchDoc.setClassTouchScheme(live, 'bear', S);
	touchDoc.setClassTouchScheme(live, 'bear', 'nobody');
	touchDoc.setClassTouchScheme(live, 'otter', S);
	stored(
		'two classes given one scheme share it; an unknown scheme and an unknown class are refused',
		{
			schemes: {
				'Hold or tap to head': { gestures: 'both' },
				[S]: {},
				'Hold or tap to head 2': { gestures: 'both' },
			},
			characters: { salmon: S, bear: S },
		},
	);
	same(
		'7. the classes of a scheme, in the room’s order, and each class’s scheme',
		[
			touchText.classesUsingTouchScheme(live, S),
			touchText.classesUsingTouchScheme(live, 'Hold or tap to head'),
			touchText.classTouchScheme(live, 'bear'),
			touchText.touchSchemeNames(live),
		],
		[['salmon', 'bear'], [], S, ['Hold or tap to head', S, 'Hold or tap to head 2']],
	);
	set('ability', 'button');
	same(
		'7. one edit of a shared scheme changes every class that names it',
		['salmon', 'bear'].map((id) => touchText.classTouchSummary(live, id)),
		Array(2).fill(
			`Hold to steer · towards the finger · lifting stops · the ability by an on-screen button, aimed where tapped · dead zone 24 px · a tap within 12 px and ${ARCADE_TOUCH_DEFAULTS.tapMs} ms`,
		),
	);
	set('ability', 'tap');

	same(
		'7. rename: a blank and a taken name are refused, another is taken',
		[
			touchDoc.renameTouchScheme(live, S, '  '),
			touchDoc.renameTouchScheme(live, S, 'Hold or tap to head'),
			touchDoc.renameTouchScheme(live, 'nobody', 'Swim'),
			touchDoc.renameTouchScheme(live, S, ' Swim '),
		],
		[false, false, false, true],
	);
	stored('rename keeps the scheme’s place and re-points its classes', {
		schemes: {
			'Hold or tap to head': { gestures: 'both' },
			Swim: {},
			'Hold or tap to head 2': { gestures: 'both' },
		},
		characters: { salmon: 'Swim', bear: 'Swim' },
	});
	same(
		'7. duplicate: a copy after it under a new name',
		[
			touchDoc.duplicateTouchScheme(live, 'Hold or tap to head'),
			touchDoc.duplicateTouchScheme(live, 'nobody'),
		],
		['Hold or tap to head copy', undefined],
	);
	touchDoc.setTouchSchemeField(live, 'Hold or tap to head copy', 'steer', 'stick');
	stored('a duplicate is its own scheme, given to no class', {
		schemes: {
			'Hold or tap to head': { gestures: 'both' },
			'Hold or tap to head copy': { gestures: 'both', steer: 'stick' },
			Swim: {},
			'Hold or tap to head 2': { gestures: 'both' },
		},
		characters: { salmon: 'Swim', bear: 'Swim' },
	});

	// A class renamed and removed (`onlineDoc`).
	touchDoc.setClassTouchScheme(live, 'bear', 'Hold or tap to head');
	onlineDoc.setOnlineCharacterField(live, 1, 'id', 'grizzly');
	stored('a class renamed keeps its scheme', {
		schemes: {
			'Hold or tap to head': { gestures: 'both' },
			'Hold or tap to head copy': { gestures: 'both', steer: 'stick' },
			Swim: {},
			'Hold or tap to head 2': { gestures: 'both' },
		},
		characters: { salmon: 'Swim', grizzly: 'Hold or tap to head' },
	});
	onlineDoc.addOnlineCharacter(live, 'arcadeBear');
	touchDoc.setClassTouchScheme(live, 'character3', 'Swim');
	onlineDoc.removeOnlineCharacter(live, 2);
	same('7. a class removed no longer names a scheme', touch()?.characters, {
		salmon: 'Swim',
		grizzly: 'Hold or tap to head',
	});
	onlineDoc.setOnlineCharacterField(live, 1, 'id', 'bear');

	// Delete.
	touchDoc.removeTouchScheme(live, 'Hold or tap to head');
	touchDoc.removeTouchScheme(live, 'nobody');
	stored('delete un-assigns the classes that named it, and no other', {
		schemes: {
			'Hold or tap to head copy': { gestures: 'both', steer: 'stick' },
			Swim: {},
			'Hold or tap to head 2': { gestures: 'both' },
		},
		characters: { salmon: 'Swim' },
	});
	touchDoc.setClassTouchScheme(live, 'salmon', '');
	stored('the last class un-assigned takes `characters`', {
		schemes: {
			'Hold or tap to head copy': { gestures: 'both', steer: 'stick' },
			Swim: {},
			'Hold or tap to head 2': { gestures: 'both' },
		},
	});
	for (const name of touchText.touchSchemeNames(live)) touchDoc.removeTouchScheme(live, name);
	check(
		'7. the last scheme deleted takes the block: the doc is as it was loaded, byte for byte',
		text(live) === liveBefore && text(save(live).doc) === plainBytes,
		text(live),
	);

	for (let i = 0; i < ARCADE_TOUCH_LIMITS.schemes + 2; i++) touchDoc.addTouchScheme(live, 'stick');
	same(
		'7. a project holds no more schemes than the stored form reads',
		[
			touchText.touchSchemeNames(live).length,
			touchDoc.canAddTouchScheme(live),
			touchDoc.duplicateTouchScheme(live, 'Virtual stick'),
			text(touchIn(save(live).doc)) === text(touch()),
		],
		[ARCADE_TOUCH_LIMITS.schemes, false, undefined, true],
	);
	const offline = normalizeGameConfigDoc(read('arcade.rules.json')) as GameConfigDoc;
	const offlineBefore = text(offline);
	touchDoc.addTouchScheme(offline, 'steer');
	touchDoc.setClassTouchScheme(offline, 'salmon', 'Hold to steer');
	check(
		'7. a game not played online is given no scheme',
		text(offline) === offlineBefore && !touchDoc.canAddTouchScheme(offline),
	);

	// The save and a load keep a posted block.
	const posted = game({
		touch: {
			schemes: {
				Swim: {
					gestures: 'both',
					tapMs: ARCADE_TOUCH_DEFAULTS.tapMs,
					steer: 'finger',
					made: 'up',
					deadZone: 30,
				},
				Paw: { ability: 'target', targetRadius: 90 },
			},
			characters: { salmon: 'Swim', bear: 'Paw', otter: 'Swim' },
		},
	});
	const kept = prepareGameConfigDoc(posted);
	const CANONICAL = {
		schemes: {
			Swim: { gestures: 'both', deadZone: 30 },
			Paw: { ability: 'target', targetRadius: 90 },
		},
		characters: { salmon: 'Swim', bear: 'Paw', otter: 'Swim' },
	};
	same('7. the save keeps a posted touch block, as it is stored', touchIn(kept.doc), CANONICAL);
	const keptBytes = text(kept.doc);
	same('7. …a load brings it back', touchIn(load(JSON.parse(keptBytes))), CANONICAL);
	check(
		'7. …and the save after it stores the same bytes',
		text(save(pageDoc.openDoc(load(JSON.parse(keptBytes)))).doc) === keptBytes,
	);
	same(
		'7. normalizeGameConfigDoc alone drops the block: it is carried, not normalized',
		normalizeGameConfigDoc(JSON.parse(keptBytes)),
		normalizeGameConfigDoc(game()),
	);
	const touchWarnings = (issues: { severity: string; path: string }[]) =>
		issues
			.filter((i) => i.path.startsWith('arcade.online.touch'))
			.map((i) => `${i.severity} ${i.path}`);
	same(
		'7. the save warns of a class that is not one, and never refuses',
		touchWarnings(kept.warnings),
		['warning arcade.online.touch.characters.otter'],
	);
	const off = game({ pointer: undefined, touch: CANONICAL });
	same(
		'7. …and of schemes with mouse and touch off, and of a target press on a class with no tap button',
		touchWarnings(prepareGameConfigDoc(off).warnings),
		[
			'warning arcade.online.touch',
			'warning arcade.online.touch.characters.otter',
			'warning arcade.online.touch.characters.bear',
		],
	);
	const liveOff = pageDoc.openDoc(load(JSON.parse(text(prepareGameConfigDoc(off).doc))));
	same(
		'7. the page lists what the save warns of',
		pageDoc.pageIssues(liveOff, 'arcade'),
		save(liveOff).warnings,
	);
	same(
		'7. …in the Mouse and touch card, and under the class in Invisible Characters',
		[
			touchWarnings(
				pageDoc.issuesUnder(pageDoc.pageIssues(liveOff, 'arcade'), 'arcade.online.touch'),
			).length,
			touchWarnings(
				touchText.classTouchIssues(pageDoc.pageIssues(liveOff, 'arcade'), liveOff, 'bear'),
			),
			touchWarnings(
				touchText.classTouchIssues(
					pageDoc.pageIssues(game() as GameConfigDoc, 'arcade'),
					liveOff,
					'bear',
				),
			),
		],
		[3, ['warning arcade.online.touch', 'warning arcade.online.touch.characters.bear'], []],
	);
	const slot = { ...read('lines.json'), arcade: posted.arcade as Entry };
	const storedSlot = prepareGameConfigDoc(slot);
	check(
		'7. a slot posted with a touch block stores none and is warned of none',
		!text(storedSlot.doc).includes('"touch"') && !touchWarnings(storedSlot.warnings).length,
	);

	// Raw JSON's Apply.
	same(
		'7. Raw JSON’s Apply keeps the pasted schemes, and a text with none has none',
		[touchIn(pageDoc.applyPasted(posted)), touchIn(pageDoc.applyPasted(game()))],
		[CANONICAL, undefined],
	);
}

if (fails) {
	console.error(`\ncheck:game-config-family — ${fails} FAILED, ${passes} passed`);
	process.exit(1);
}
console.log(`check:game-config-family — ${passes} passed`);
