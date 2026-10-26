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
 *  2. THE PICKER MIRRORS THE NORMALIZER. Every `/config` family setter (`familyDoc.ts`) leaves the
 *     doc exactly as a save would store it, so the page never looks dirty for a value a save drops.
 *  3. THE PAGE SHOWS EACH FAMILY §6.2's SECTIONS. `/config` is rendered on the server for a slot, a
 *     match-3 game decided each way and an arcade game: a non-slot family shows exactly its
 *     sections, and a slot project shows no family picker and no section outside the slot's. Only
 *     an arcade page shows the Characters line (its count and the link to Invisible Characters).
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
step('solid', (d) => familyDoc.setBodySolid(d, 'player', true));
step(
	'not solid',
	(d) => familyDoc.setBodySolid(d, 'player', false),
	(d) => d.arcade?.bodies?.player?.solid === undefined,
);
step(
	'remove the body',
	(d) => familyDoc.removeBody(d, 'player'),
	(d) => d.arcade?.bodies === undefined,
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
	'Reel behaviour': 'reelBehaviour',
	'Game modes': 'gameModes',
	Sounds: 'sounds',
	Paylines: 'paylines',
	'Big win tiers': 'winLevels',
	'Match-3': 'match3',
	Arcade: 'arcade',
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
	for (const [label, config, family, outcome] of [
		['match-3, RGS', m3, 'match3', 'rgs'],
		['match-3, rules', m3Rules, 'match3', 'rules'],
		['arcade', arcade, 'arcade', 'rules'],
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
