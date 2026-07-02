/**
 * Invisible Flow — Phase 9 / §11.8 step 2 producer-pin-derivation headless test
 * (design doc `flow-driven-game.md` §11.4).
 *
 *   pnpm --filter flow-spike run valuedataflow
 *
 * Proves, HEADLESSLY, that `deriveScreenPins` surfaces the game's DECLARED engine value feeds
 * (`ENGINE_PARAM_CATALOG`) as `producer`-role OUTPUT pins on the value-producer HOST screen —
 * the source half of the value dataflow (§11) — without disturbing the consumer `value` INPUT
 * pins that already exist:
 *
 *  1. Host only    — producer pins appear ONLY on the producer host, never on a non-host screen.
 *  2. One per feed — one `${screenId}::produces:${feedKey}` pin per catalog feed, role `producer`,
 *                    direction `out`, in the catalog's order, deterministic run-to-run.
 *  3. Consumer un-  — the consumer `value` INPUT pins (`${instanceId}::value:${source}`) are
 *     changed        byte-identical to a pre-step-2 derivation (no `engineFeeds`/`isProducerHost`),
 *                    so existing docs render exactly the same.
 *
 * The engine value-feed catalog is PASSED IN (the caller supplies it, §11.4) — `deriveScreenPins`
 * is catalog-agnostic. This harness mirrors the shape + entries of the real `ENGINE_PARAM_CATALOG`
 * (`packages/engine-layout/src/lib/componentCatalog.ts`) as an inline fixture, the same hand-built-
 * fixture convention `pinDerivation.ts` uses (the `engine-layout` runtime barrel pulls in
 * `constants-shared/layout` values tsx can't resolve headlessly, so spikes import only TYPES from it
 * and build their data). The real caller (the `/flow` model, step 5) feeds `ENGINE_PARAM_CATALOG`.
 */

import {
	deriveScreenPins,
	type ComponentDefResolver,
	type EngineFeed,
	type FlowPin,
} from 'engine-flow';
import type { ComponentDef, Scene } from 'engine-layout';

// ---------------------------------------------------------------------------
// Fixture — a producer host (base game, with a value component) + a non-host HUD screen.
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

const DEFS: Record<string, ComponentDef> = { hudReadout: readoutDef };
const resolve: ComponentDefResolver = (id) => DEFS[id];

// The producer host — a base-game screen that ALSO instances a value component, so we can prove
// the consumer `value` input pin is untouched by the producer projection.
const hostScene: Scene = {
	id: 'baseGame',
	name: 'Base Game',
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
	],
};

// A non-host screen (a HUD) — must NOT get producer pins.
const hudScene: Scene = {
	id: 'hud',
	name: 'HUD',
	nodes: [
		{
			kind: 'componentInstance',
			id: 'n_balance',
			label: 'Balance readout',
			x: 20,
			y: 20,
			componentId: 'hudReadout',
			params: { source: 'balance' },
		},
	],
};

// The declared engine feeds the caller passes in (design doc §11.4) — the {key,label} projection of
// `ENGINE_PARAM_CATALOG`, transcribed inline (see header). Order + entries mirror the real catalog.
const engineFeeds: EngineFeed[] = [
	{ key: 'bet', label: 'Bet' },
	{ key: 'win', label: 'Win' },
	{ key: 'balance', label: 'Balance' },
	{ key: 'totalWin', label: 'Total Win' },
	{ key: 'playerName', label: 'Player Name' },
	{ key: 'projectName', label: 'Project Name' },
	{ key: 'freeSpins', label: 'Free Spins' },
	{ key: 'freeSpinsWon', label: 'Free Spins Won' },
	{ key: 'message', label: 'Message' },
	{ key: 'loadingProgress', label: 'Loading Progress' },
];

// ---------------------------------------------------------------------------
// Assert helpers.
// ---------------------------------------------------------------------------

let failures = 0;
const ok = (label: string, cond: boolean): void => {
	console.log(`${cond ? '✅' : '❌'} ${label}`);
	if (!cond) failures += 1;
};
const ids = (pins: FlowPin[]): string[] => pins.map((p) => p.id);
const producers = (pins: FlowPin[]): FlowPin[] => pins.filter((p) => p.role === 'producer');
const valuePins = (pins: FlowPin[]): FlowPin[] => pins.filter((p) => p.role === 'value');

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------

console.log('\nInvisible Flow — producer-pin-derivation headless test (§11.4)\n');

const hostPins = deriveScreenPins(hostScene, resolve, { engineFeeds, isProducerHost: true });
const nonHostPins = deriveScreenPins(hudScene, resolve, { engineFeeds, isProducerHost: false });

console.log('Host producer pins:');
for (const p of producers(hostPins)) {
	console.log(
		`  ${p.id.padEnd(30)} role=${p.role.padEnd(9)} dir=${p.direction.padEnd(4)} "${p.label}"`,
	);
}
console.log('');

// 1. Host only — producer pins on the host, none on the non-host.
ok('producer pins derived on the host', producers(hostPins).length > 0);
ok('NO producer pins on a non-host screen', producers(nonHostPins).length === 0);
// Even a screen that IS the producer host derives NOTHING when no feeds are supplied (parity).
ok(
	'no engineFeeds ⇒ no producer pins even on the host',
	producers(deriveScreenPins(hostScene, resolve, { isProducerHost: true })).length === 0,
);

// 2. One per feed, stable id, role/direction, catalog order.
const expectedProducerIds = engineFeeds.map((f) => `baseGame::produces:${f.key}`);
ok(
	'one producer pin per catalog feed (count matches)',
	producers(hostPins).length === engineFeeds.length,
);
ok(
	'producer ids are ${screenId}::produces:${feedKey} in catalog order',
	JSON.stringify(producers(hostPins).map((p) => p.id)) === JSON.stringify(expectedProducerIds),
);
ok(
	'every producer pin is role=producer direction=out',
	producers(hostPins).every((p) => p.role === 'producer' && p.direction === 'out'),
);
ok(
	'producer pin carries the feed key + a catalog label',
	producers(hostPins).every((p, i) => {
		const feed = engineFeeds[i];
		return p.key === feed.key && p.label === `${feed.label} · ${feed.key}`;
	}),
);
// Deterministic — two derivations are byte-identical.
ok(
	'deterministic producer-pin id order',
	JSON.stringify(ids(hostPins)) ===
		JSON.stringify(
			ids(deriveScreenPins(hostScene, resolve, { engineFeeds, isProducerHost: true })),
		),
);

// 3. Consumer `value` INPUT pins are UNCHANGED vs a pre-step-2 derivation (no producer options).
const baseline = deriveScreenPins(hostScene, resolve); // exactly what step 1 produced
ok(
	'host still exposes the consumer value pin (n_win::value:win)',
	valuePins(hostPins).some((p) => p.id === 'n_win::value:win' && p.direction === 'in'),
);
ok(
	'consumer value pins byte-identical to the pre-step-2 derivation',
	JSON.stringify(valuePins(hostPins)) === JSON.stringify(valuePins(baseline)),
);
// The producer projection is PURELY ADDITIVE: strip the producer pins and the host's pin set is
// identical to the baseline (structural + gate + dynamic all unmoved).
ok(
	'stripping producer pins leaves the baseline pin set intact (additive-only)',
	JSON.stringify(hostPins.filter((p) => p.role !== 'producer')) === JSON.stringify(baseline),
);

console.log('');
if (failures === 0) {
	console.log('VALUE-DATAFLOW: PASSED — all assertions green.\n');
} else {
	console.log(`VALUE-DATAFLOW: FAILED — ${failures} assertion(s) red.\n`);
	process.exit(1);
}
