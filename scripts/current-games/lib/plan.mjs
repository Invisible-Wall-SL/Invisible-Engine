// The run's plan, made once and shared by every render shard and the compare: which games are
// rendered, from which PINNED snapshot (a republish mid-run must not give two shards two different
// snapshots), with which mock contract and scenarios, and the render UNITS — one side
// (base | head) of one scenario of one game — balanced across the shards.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { currentSnapshot } from './games.mjs';

const HERE = join(import.meta.dirname, '..');

const SCRIPT_FOR_KIND = {
	bookOf: 'bookOf',
	holdAndWin: 'holdAndWin',
	ways: 'ways',
	cluster: 'cluster',
	scatter: 'scatter',
};
export const scriptFor = (gameType) => SCRIPT_FOR_KIND[gameType] ?? 'lines';
export const loadScript = (name) =>
	JSON.parse(readFileSync(join(HERE, 'screens', `${name}.json`), 'utf8'));

const protocolFor = (gameType) => {
	if (gameType === 'bookOf') return 'book';
	return ['ways', 'cluster', 'scatter', 'holdAndWin'].includes(gameType) ? gameType : 'lines';
};

/** `grid.potsOverlay.pots.0.id` in a manifest entry; a negative index counts from the end. */
export const at = (value, path) =>
	path.split('.').reduce((v, key) => {
		if (v === undefined || v === null) return undefined;
		const i = Number(key);
		return Array.isArray(v) && Number.isInteger(i) ? v.at(i) : v[key];
	}, value);

export const safe = (s) => String(s).replace(/[^\w.-]/g, '_');
export const unitId = (key, scenario, side) => `${safe(key)}--${safe(scenario)}--${side}`;

/**
 * The game's mock contract: a fixture's own entry, else its test-server manifest entry. The
 * launcher link (`docBase` / `readToken`) is dropped here, so it never reaches the plan artifact
 * and the mock never follows live data mid-run.
 */
function contractFor(game, manifest) {
	const entry = game.local?.manifestEntry ??
		manifest[game.key] ?? { protocol: protocolFor(game.gameType), name: game.name };
	const contract = { ...entry };
	for (const key of ['docBase', 'readToken', 'runtimeVersion']) delete contract[key];
	return contract;
}

/**
 * Relative cost of rendering one side of a scenario, measured on the live games (2026-10-05, CI
 * runner, SwiftShader WebGL): a `draw: 'every'` canary 120–330 s, big-wins 90–135 s (18 000 frames),
 * free spins ~55 s, the rest 10–25 s. Only the balance across shards depends on it.
 */
const weightOf = (scenario) =>
	scenario.canary ? 300 : scenario.id === 'big-wins' ? 130 : scenario.id === 'free-spins' ? 60 : 25;

/**
 * `games` as the list endpoint gives them, filtered by `only` (keys) and `scenarioIds`. Every game
 * gets an entry; only `status: 'render'` ones get units.
 */
export async function makePlan({ games, manifest, only, scenarioIds }) {
	const planned = [];
	for (const g of games
		.filter((g) => !only || only.has(g.key))
		.sort((a, b) => a.key.localeCompare(b.key))) {
		const game = {
			key: g.key,
			name: g.name,
			gameType: g.gameType,
			projectKey: g.projectKey,
			hasOwnBuiltBundle: Boolean(g.hasOwnBuiltBundle),
			publishedPointerKey: g.publishedPointerKey,
			...(g.local ? { local: g.local } : {}),
		};
		const entry = { game, script: scriptFor(g.gameType), notes: [], scenarios: [] };
		planned.push(entry);
		if (game.hasOwnBuiltBundle) {
			entry.status = 'own-bundle';
			entry.notes.push(
				'Desktop-built game: it serves its own bundle, which is the same bundle on both sides, so ' +
					'it is not rendered; only build and tests are checked against the branch.',
			);
			continue;
		}
		if (!game.publishedPointerKey && !game.local) {
			entry.status = 'no-snapshot';
			entry.notes.push('not rendered (no snapshot): a global game has no published snapshot.');
			continue;
		}
		try {
			entry.snapshot = await currentSnapshot(game);
		} catch (e) {
			entry.status = 'error';
			entry.detail = `snapshot lookup failed: ${e.message}`;
			continue;
		}
		if (!entry.snapshot) {
			entry.status = 'unpublished';
			entry.notes.push('skip: not published (its published pointer does not exist).');
			continue;
		}
		entry.status = 'render';
		entry.contract = contractFor(g, manifest);
		const scenarios = loadScript(entry.script).scenarios.filter(
			(sc) => !scenarioIds || scenarioIds.includes(sc.id),
		);
		// A scenario for a feature this game does not have (`requires`: contract paths) is not played.
		const skipped = scenarios.filter((sc) =>
			(sc.requires ?? []).some((p) => !at(entry.contract, p)),
		);
		if (skipped.length)
			entry.notes.push(
				`scenario(s) not played, the game has no such feature: ${skipped.map((sc) => sc.id).join(', ')}`,
			);
		entry.scenarios = scenarios
			.filter((sc) => !skipped.includes(sc))
			.map((sc) => ({ id: sc.id, canary: Boolean(sc.canary), weight: weightOf(sc) }));
	}
	const units = planned.flatMap((p) =>
		p.scenarios.flatMap((sc) =>
			['base', 'head'].map((side) => ({
				id: unitId(p.game.key, sc.id, side),
				key: p.game.key,
				scenario: sc.id,
				side,
				weight: sc.weight,
			})),
		),
	);
	return { games: planned, units };
}

/**
 * The units shard `index` (1-based) of `count` renders: heaviest first, each to the least-loaded
 * shard (ties to the lower index), so every shard computes the same split.
 */
export function unitsForShard(units, index, count) {
	const load = new Array(count).fill(0);
	const mine = [];
	const order = [...units].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
	for (const u of order) {
		let best = 0;
		for (let s = 1; s < count; s++) if (load[s] < load[best]) best = s;
		load[best] += u.weight;
		if (best === index - 1) mine.push(u);
	}
	return mine;
}
