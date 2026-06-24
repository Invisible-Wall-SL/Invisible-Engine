/**
 * Invisible Flow — Phase 1 pin-derivation headless test (design doc §3/§4/§12).
 *
 *   pnpm --filter flow-spike run pins
 *
 * Proves, HEADLESSLY, that `deriveScreenPins` projects a LayoutDoc screen's components
 * into the right pins with STABLE composite ids — the four-registry projection plus the
 * fixed structural pins — without inventing a new pin vocabulary:
 *
 *  1. Structural pins — every screen node carries `enter` / `active` / `complete`.
 *  2. Value pin   ← a component-instance `source` param (`registerComponentValues`).
 *  3. Action pin  ← a button instance `action` param (`registerComponentActions`).
 *  4. Gate pins   ← a `visibleSource` param AND the scene-level `Scene.visibleSource`
 *                   (`registerComponentVisibility`).
 *  5. Signal pin  ← a spine cue's `signal` in the resolved ComponentDef tree
 *                   (`registerComponentSignals`).
 *  6. Stable ids  ← every dynamic pin id is `${instanceId}::${role}:${key}`, structural
 *                   ids are `${screenId}::${role}` — id derivation is deterministic, and
 *                   a RENAME (label change) / REORDER (position change) leaves ids intact.
 *  7. Orphan      ← an instance whose ComponentDef is missing still derives its
 *                   param-driven pins but flags them `orphaned` (never a silent drop, §4).
 *
 * It runs against a representative `apps/lines`-shaped LayoutDoc fixture (a base-game
 * screen: a win readout, a spin button, a gated free-spin counter, and a celebration
 * spine with a `win` cue) + the real `deriveScreenPins` from `engine-flow`.
 */

import { deriveScreenPins, type ComponentDefResolver, type FlowPin } from 'engine-flow';
import type { ComponentDef, Scene } from 'engine-layout';

// ---------------------------------------------------------------------------
// Fixture — a representative base-game screen + the ComponentDefs it instances.
// ---------------------------------------------------------------------------

const readoutDef: ComponentDef = {
	id: 'hudReadout',
	name: 'HUD Readout',
	version: 1,
	scope: 'shared',
	category: 'ui',
	root: { kind: 'container', id: 'r_root', x: 0, y: 0, children: [] },
	params: [{ key: 'source', kind: 'string', options: ['win', 'balance', 'bet'] }],
};

const buttonDef: ComponentDef = {
	id: 'button',
	name: 'Button',
	version: 1,
	scope: 'shared',
	category: 'ui',
	root: { kind: 'container', id: 'b_root', x: 0, y: 0, children: [] },
	params: [{ key: 'action', kind: 'string', options: ['spin', 'menu', 'buyBonus'] }],
};

const freeSpinCounterDef: ComponentDef = {
	id: 'freeSpinCounter',
	name: 'Free Spin Counter',
	version: 1,
	scope: 'shared',
	category: 'overlay',
	root: { kind: 'container', id: 'fs_root', x: 0, y: 0, children: [] },
	params: [
		{ key: 'source', kind: 'string', default: 'freeSpins' },
		{ key: 'visibleSource', kind: 'string', default: 'freeSpinCounterShow' },
	],
};

// A celebration component whose spine plays a cue on the `win` signal — the signal pin
// derives from the cue in the DEF's resolved tree, not from an instance param.
const winCelebrationDef: ComponentDef = {
	id: 'winCelebration',
	name: 'Win Celebration',
	version: 1,
	scope: 'shared',
	category: 'overlay',
	root: {
		kind: 'container',
		id: 'wc_root',
		x: 0,
		y: 0,
		children: [
			{
				kind: 'spine',
				id: 'wc_spine',
				x: 0,
				y: 0,
				assetKey: 'celebration',
				cues: [{ signal: 'win', animation: 'win' }],
			},
		],
	},
};

const DEFS: Record<string, ComponentDef> = {
	hudReadout: readoutDef,
	button: buttonDef,
	freeSpinCounter: freeSpinCounterDef,
	winCelebration: winCelebrationDef,
};

const resolve: ComponentDefResolver = (id) => DEFS[id];

const baseScene: Scene = {
	id: 'baseGame',
	name: 'Base Game',
	visibleSource: 'baseGameShow',
	nodes: [
		{
			kind: 'componentInstance',
			id: 'n_win',
			label: 'Win readout',
			x: 100,
			y: 50,
			componentId: 'hudReadout',
			params: { source: 'win' },
		},
		{
			kind: 'componentInstance',
			id: 'n_spin',
			label: 'Spin button',
			x: 200,
			y: 400,
			componentId: 'button',
			params: { action: 'spin' },
		},
		// A gated free-spin counter — gate from the def default (no instance override).
		{
			kind: 'componentInstance',
			id: 'n_fscounter',
			x: 300,
			y: 20,
			componentId: 'freeSpinCounter',
		},
		// Signal source: a spine cue inside the resolved def's tree.
		{
			kind: 'componentInstance',
			id: 'n_celebrate',
			x: 0,
			y: 0,
			componentId: 'winCelebration',
		},
	],
};

// ---------------------------------------------------------------------------
// Assert helpers.
// ---------------------------------------------------------------------------

let failures = 0;
const ok = (label: string, cond: boolean): void => {
	console.log(`${cond ? '✅' : '❌'} ${label}`);
	if (!cond) failures += 1;
};
const byId = (pins: FlowPin[], id: string): FlowPin | undefined => pins.find((p) => p.id === id);
const ids = (pins: FlowPin[]): string[] => pins.map((p) => p.id);

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------

console.log('\nInvisible Flow — pin-derivation headless test\n');

const pins = deriveScreenPins(baseScene, resolve);
console.log('Derived pins:');
for (const p of pins) {
	console.log(
		`  ${p.id.padEnd(34)} role=${p.role.padEnd(8)} dir=${p.direction.padEnd(5)} "${p.label}"` +
			(p.orphaned ? ' [ORPHANED]' : ''),
	);
}
console.log('');

// 1. Structural pins.
ok('structural enter pin', byId(pins, 'baseGame::enter')?.direction === 'in');
ok('structural active pin', byId(pins, 'baseGame::active')?.direction === 'state');
ok('structural complete pin', byId(pins, 'baseGame::complete')?.direction === 'out');

// 2. Value pin (registerComponentValues — `source`).
const winPin = byId(pins, 'n_win::value:win');
ok('value pin id (instanceId::value:win)', !!winPin);
ok('value pin direction in', winPin?.direction === 'in');
ok('value pin role value', winPin?.role === 'value');
ok('value pin instanceId tracked', winPin?.instanceId === 'n_win');

// 3. Action pin (registerComponentActions — `action`).
const spinPin = byId(pins, 'n_spin::action:spin');
ok('action pin id (instanceId::action:spin)', !!spinPin);
ok('action pin direction out', spinPin?.direction === 'out');
ok('action pin role action', spinPin?.role === 'action');

// 4. Gate pins (registerComponentVisibility — `visibleSource` + scene gate).
ok(
	'gate pin from def default (freeSpinCounterShow)',
	!!byId(pins, 'n_fscounter::gate:freeSpinCounterShow'),
);
ok('scene-level gate pin (baseGameShow)', !!byId(pins, 'baseGame::gate:baseGameShow'));
// The free-spin counter also exposes a value pin from its def-default `source`.
ok('value pin from def default (freeSpins)', !!byId(pins, 'n_fscounter::value:freeSpins'));

// 5. Signal pin (registerComponentSignals — spine cue in the resolved def tree).
const signalPin = byId(pins, 'n_celebrate::signal:win');
ok('signal pin id (instanceId::signal:win)', !!signalPin);
ok('signal pin role signal', signalPin?.role === 'signal');
ok('signal pin direction in', signalPin?.direction === 'in');

// 6. Stable ids — rename + reorder must not change ANY id.
const renamed: Scene = {
	...baseScene,
	nodes: [
		// reordered (spin first) AND the win readout RELABELLED — ids must be identical.
		baseScene.nodes[1],
		{ ...baseScene.nodes[0], label: 'Total Win' },
		baseScene.nodes[3],
		baseScene.nodes[2],
	],
};
const renamedPins = deriveScreenPins(renamed, resolve);
const sameIds =
	new Set(ids(pins)).size === new Set(ids(renamedPins)).size &&
	ids(pins).every((id) => ids(renamedPins).includes(id));
ok('rename + reorder preserves every pin id', sameIds);
ok(
	'relabel changes the LABEL only',
	byId(renamedPins, 'n_win::value:win')?.label === 'Total Win · win',
);

// 7. Orphan — a missing ComponentDef flags pins, never drops them.
const orphanResolve: ComponentDefResolver = (id) => (id === 'button' ? undefined : DEFS[id]);
const orphanPins = deriveScreenPins(baseScene, orphanResolve);
const orphanSpin = byId(orphanPins, 'n_spin::action:spin');
ok('orphan: missing def keeps the param-driven pin', !!orphanSpin);
ok('orphan: flagged orphaned (validation warning)', orphanSpin?.orphaned === true);

// Determinism — two derivations are byte-identical.
ok(
	'deterministic id order',
	JSON.stringify(ids(pins)) === JSON.stringify(ids(deriveScreenPins(baseScene, resolve))),
);

console.log('');
if (failures === 0) {
	console.log('PIN-DERIVATION: PASSED — all assertions green.\n');
} else {
	console.log(`PIN-DERIVATION: FAILED — ${failures} assertion(s) red.\n`);
	process.exit(1);
}
