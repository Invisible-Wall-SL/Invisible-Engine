/**
 * HUD-MENU PIN CONTRACT — an offline guard that the bet-menu / auto-spin authoring story still has
 * the pins it is built on. It reproduces the Scene→decl projection `/flow-v2`'s `+page.server.ts`
 * runs, over the REAL modules, and asserts:
 *
 *   - the seeded HUD bar projects `hud-bet.onBetMenu` (the readout's press, which is the whole
 *     point — a bet readout with no `action` binding gives the author nothing to wire) and
 *     `hud-btn-autospin.onAutoSpin`, while the balance/win readouts project NOTHING;
 *   - each menu screen's repeaters project `<id>.onSelect` plus the three selection data-outs, so a
 *     tile press can feed both a string action (`setAutoSpins`) and a numeric one (`setBetAmount`);
 *   - a doc that WIRES one of those pins reads as OWNED, which is what suppresses the coded press.
 *
 * Run: `pnpm --filter launcher-api run check:hud-menu-pins`
 *
 * It lives HERE, not in either engine package, because it spans BOTH: it reproduces the Scene→decl
 * projection that `/flow-v2`'s `+page.server.ts` runs over an `engine-layout` scene and an
 * `engine-flow-v2` deriver. Those two packages deliberately do not depend on each other (which is
 * why the repeater vocabulary lives in `constants-shared`), and the launcher is the one place that
 * legitimately sees both. A fixture rather than a type-only guard because this app's build does not
 * type-check (see `apps/launcher-api/CLAUDE.md`), and because every link in this chain is a STRING
 * that no type relates to the next.
 */
import {
	defaultAutoSpinScene,
	defaultBetMenuScene,
	hudScenes,
	normalizeHudScenes,
	type LayoutDoc,
	type LayoutNode,
	type Scene,
} from 'engine-layout';
import {
	derivePins,
	flowOwnsContainerEvent,
	standardVocabulary,
	validateFlowDoc,
	type FlowDoc,
	type Node as FlowNode,
	type PinContext,
} from 'engine-flow-v2';
import { projectContainerEvents } from '../src/lib/flowV2Projection';

const fails: string[] = [];
const ok = (label: string, cond: boolean, detail?: unknown): void => {
	if (!cond)
		fails.push(`${label}${detail === undefined ? '' : ` — got ${JSON.stringify(detail)}`}`);
	console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
};

/** Every pin a `showContainer` node for `scene` exposes, through the projection `/flow-v2` and the
 * publish gate both use. */
const pinIds = (scene: Scene, containerId: string): string[] => {
	const decls =
		projectContainerEvents([{ id: containerId, sceneId: scene.id, z: 0 }], [scene])[containerId] ??
		[];
	const node = {
		id: 'show',
		kind: 'showContainer',
		pos: { x: 0, y: 0 },
		ref: containerId,
	} as FlowNode;
	const ctx = { containerEvents: { [containerId]: decls } } as PinContext;
	return derivePins(node, ctx).map((pin) => pin.id);
};

// --- the seeded HUD bar ----------------------------------------------------
const hud = hudScenes({ readouts: true, buttons: true }).find((scene) => scene.id === 'hudBar');
ok('the seeded HUD bar exists', !!hud);
const hudPins = hud ? pinIds(hud, 'hudBar') : [];
ok('HUD projects hud-bet.onBetMenu', hudPins.includes('hud-bet.onBetMenu'), hudPins);
ok('HUD projects hud-btn-autospin.onAutoSpin', hudPins.includes('hud-btn-autospin.onAutoSpin'));
ok('HUD projects hud-btn-bet.onSpin', hudPins.includes('hud-btn-bet.onSpin'));
ok(
	'the balance/win readouts project no press pin',
	!hudPins.some((pin) => pin.startsWith('hud-balance.') || pin.startsWith('hud-win.')),
	hudPins.filter((pin) => pin.startsWith('hud-balance.') || pin.startsWith('hud-win.')),
);

// --- a readout placed before the seed carried the action -------------------
// The shape a real project had: a `hudReadout` bet readout with NO `action`, on an authored `hud_*`
// screen. Unhealed it projects no pin, so the bet menu was not authorable at all.
const readout = (id: string, source: string, action?: string): LayoutNode =>
	({
		id,
		kind: 'componentInstance',
		componentId: 'hudReadout',
		x: 0,
		y: 0,
		params: { source, label: source, ...(action ? { action } : {}) },
	}) as LayoutNode;
const legacyHud: Scene = {
	id: 'hud_infos',
	name: 'HUD - infos',
	nodes: [
		readout('n_balance', 'balance'),
		readout('n_bet', 'bet'),
		readout('n_bet2', 'bet', 'menu'),
		{ ...readout('n_bet3', 'bet'), params: { source: 'bet', action: ' ' } } as LayoutNode,
	],
} as Scene;
const legacyDoc = { scenes: [legacyHud] } as unknown as LayoutDoc;
ok(
	'an action-less bet readout projects no pin as stored',
	!pinIds(legacyHud, 'hud_infos').includes('n_bet.onBetMenu'),
);
const healed = normalizeHudScenes(legacyDoc).scenes[0];
const healedPins = pinIds(healed, 'hud_infos');
ok('once loaded it projects n_bet.onBetMenu', healedPins.includes('n_bet.onBetMenu'), healedPins);
ok('a blank action counts as none', healedPins.includes('n_bet3.onBetMenu'), healedPins);
ok(
	'a bet readout naming another action keeps it',
	healedPins.includes('n_bet2.onMenu'),
	healedPins,
);
ok(
	'the balance readout still projects nothing',
	!healedPins.some((pin) => pin.startsWith('n_balance.')),
	healedPins,
);
ok('the stored doc is not mutated', !pinIds(legacyHud, 'hud_infos').includes('n_bet.onBetMenu'));
const seededDoc = { scenes: hudScenes({ readouts: true, buttons: true }) } as unknown as LayoutDoc;
ok(
	'a doc with nothing to heal is returned as the same object',
	normalizeHudScenes(seededDoc) === seededDoc,
);

// --- the bet-menu screen ---------------------------------------------------
const betMenu = defaultBetMenuScene();
const betPins = pinIds(betMenu, 'betMenu');
ok(
	'bet menu projects bet-menu-options.onSelect',
	betPins.includes('bet-menu-options.onSelect'),
	betPins,
);
ok(
	'bet menu carries the numeric selectedValue data-out',
	betPins.includes('bet-menu-options.onSelect.selectedValue'),
);
ok(
	'bet menu still carries the legacy betModeKey data-out',
	betPins.includes('bet-menu-options.onSelect.betModeKey'),
);
ok(
	'bet menu carries the generic selectedKey data-out',
	betPins.includes('bet-menu-options.onSelect.selectedKey'),
);
ok('bet menu scene carries its role', betMenu.role === 'betMenu', betMenu.role);
// Every seeded menu needs a WAY OUT: a flow-shown screen is a full-canvas takeover, so a doc that
// wires only the `Show` would strand the player on it.
ok('bet menu has a close pin to wire to Hide', betPins.includes('bet-menu-close.onClose'), betPins);

// --- the auto-spin screen --------------------------------------------------
const autoSpin = defaultAutoSpinScene();
const autoPins = pinIds(autoSpin, 'autoSpin');
for (const id of ['auto-spin-options', 'auto-spin-loss-options', 'auto-spin-win-options']) {
	ok(`auto spin projects ${id}.onSelect`, autoPins.includes(`${id}.onSelect`), autoPins);
	ok(
		`auto spin projects ${id}.onSelect.selectedKey`,
		autoPins.includes(`${id}.onSelect.selectedKey`),
	);
}
ok(
	'the START button projects its own pin',
	autoPins.includes('auto-spin-start.onAutoSpinStart'),
	autoPins,
);
ok(
	'auto spin has a close pin to wire to Hide',
	autoPins.includes('auto-spin-close.onClose'),
	autoPins,
);
ok('auto spin scene carries its role', autoSpin.role === 'autoSpin', autoSpin.role);

// --- ownership: a wired pin suppresses the coded press ---------------------
const doc = {
	version: 2,
	containers: [
		{ id: 'hudBar', sceneId: 'hudBar', z: 10 },
		{ id: 'betMenu', sceneId: 'betMenu', z: 90 },
	],
	graph: {
		nodes: [
			{ id: 'show_hud', kind: 'showContainer', pos: { x: 0, y: 0 }, ref: 'hudBar' },
			{ id: 'show_bet', kind: 'showContainer', pos: { x: 300, y: 0 }, ref: 'betMenu' },
		],
		exec: [
			{
				from: { node: 'show_hud', pin: 'hud-bet.onBetMenu' },
				to: { node: 'show_bet', pin: 'exec' },
			},
		],
		data: [],
	},
	functions: [],
} as unknown as FlowDoc;

ok('a wired hud-bet.onBetMenu reads as OWNED', flowOwnsContainerEvent(doc, 'hud-bet', 'betMenu'));
ok(
	'an unwired pin does NOT read as owned',
	!flowOwnsContainerEvent(doc, 'hud-btn-autospin', 'autoSpin'),
);

// --- the engine SCALARS a guard tests ---------------------------------------
// The auto-spin button is DUAL (open the menu when idle, stop a live run otherwise), and a flow
// that owns its press suppresses the coded body — so the stop half is only reproducible if the
// author can read the autoplay state. Two surfaces have to agree for that: the vocabulary must
// DECLARE the scalar (the inspector's `$engine` picker lists exactly what it declares) and the
// validator must RESOLVE it.
const vocab = standardVocabulary({ templateId: 'lines', symbolNames: ['L1'] });
ok(
	'the vocabulary declares the autoplay engine values',
	['isAutoSpinning', 'autoSpinsRemaining'].every((name) =>
		vocab.values.some((v) => v.name === name),
	),
	vocab.values.map((v) => v.name),
);

// The validator governs an accessor used as a node INPUT. (A `branch` guard's operands are NOT
// pins — `guardPins` emits one only for a `wire` source, so an inline accessor there is never
// validated. The picker is what gates that case, which is why the declaration above is the
// load-bearing half for the branch.)
const inputDoc = (key: string): FlowDoc =>
	({
		version: 2,
		containers: [],
		graph: {
			nodes: [
				{
					id: 'stake',
					kind: 'action',
					pos: { x: 0, y: 0 },
					ref: 'setBetAmount',
					inputs: { amount: { kind: 'accessor', path: { on: 'engine', key } } },
				},
			],
			exec: [],
			data: [],
		},
		functions: [],
	}) as unknown as FlowDoc;

const unresolved = (key: string): boolean =>
	validateFlowDoc(inputDoc(key), vocab, { version: 1, functions: [] } as unknown as never).some(
		(issue) => issue.code === 'accessor-unresolved',
	);
ok('an action input reading $engine.bet resolves', !unresolved('bet'));
ok('an action input reading an unknown $engine key is rejected', unresolved('notAThing'));

console.log(
	fails.length ? `\n${fails.length} FAILURE(S):\n - ${fails.join('\n - ')}` : '\nALL PASS',
);
if (fails.length) process.exit(1);
