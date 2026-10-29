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
 *     and only an online arcade page its Online room, Online rules and Bots sections.
 *  4. THE FAMILY GATE. Publish and the bake refuse a non-slot config, never a slot one.
 */

import { createServer } from 'vite';
import {
	CONFIG_SECTIONS,
	configSectionsFor,
	normalizeGameConfigDoc,
	type ConfigSection,
	type GameConfigDoc,
} from 'game-config';
import { GAME_KINDS, SLOT_GAME_KINDS, familyOfKind } from 'constants-shared/gameKinds';
import { kindCapabilities, type KindCapabilities } from 'engine-layout';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { projectAddOns } from '../src/lib/addOns.ts';
import { mechanicFor } from 'engine-game/src/game/mechanic';
import { partnerRgsRefusal, unplayableFamilyMessage } from '../src/lib/server/familyGate.ts';
import * as familyDoc from '../src/routes/(app)/config/familyDoc.ts';
import * as onlineDoc from '../src/routes/(app)/config/onlineDoc.ts';
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
	const stored = normalizeGameConfigDoc(structuredClone(doc));
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
		const headings = [...body.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1].trim());
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
			shown.body.includes('href="/characters"') === (family === 'arcade'),
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
	const ONLINE_HEADINGS = ['Online room', 'Online rules', 'Bots'];
	const headingsOf = (body: string) =>
		[...body.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1].trim());
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

if (fails) {
	console.error(`\ncheck:game-config-family — ${fails} FAILED, ${passes} passed`);
	process.exit(1);
}
console.log(`check:game-config-family — ${passes} passed`);
