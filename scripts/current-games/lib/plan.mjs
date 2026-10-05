// The run's plan, made once and shared by every render shard and the compare: which games are
// rendered, from which PINNED snapshot (a republish mid-run must not give two shards two different
// snapshots), with which scenarios, and the render UNITS — one side (base | head) of one VARIANT
// (`published`: the snapshot as it is; `republished`: with the baked copies of built-in component
// defs replaced by each side's built-ins, `builtins.mjs`) of one scenario of one game — balanced
// across the shards. The plan is an artifact of a PUBLIC repository: it names each game's mock
// contract by hash only, and a render shard reads the contract itself.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { currentSnapshot } from './games.mjs';
import { redactText } from './redact.mjs';

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
export const unitId = (key, scenario, side, variant = 'published') =>
	`${safe(key)}--${safe(scenario)}--${side}${variant === 'republished' ? '--republished' : ''}`;

/** The two sides of every comparison. */
const SIDES = ['base', 'head'];

/** The units of one planned game's scenarios, for `variant`. */
const unitsOf = (planned, variant) =>
	planned.scenarios.flatMap((sc) =>
		SIDES.map((side) => ({
			id: unitId(planned.game.key, sc.id, side, variant),
			key: planned.game.key,
			scenario: sc.id,
			side,
			variant,
			weight: sc.weight,
		})),
	);

/**
 * The game's mock contract: a fixture's own entry, else its test-server manifest entry. The
 * launcher link (`docBase` / `readToken`) is dropped here, so it never reaches the plan artifact
 * and the mock never follows live data mid-run.
 */
export function contractFor(game, manifest) {
	const entry = game.local?.manifestEntry ??
		manifest[game.key] ?? { protocol: protocolFor(game.gameType), name: game.name };
	const contract = { ...entry };
	for (const key of ['docBase', 'readToken', 'runtimeVersion']) delete contract[key];
	return contract;
}

export const contractHash = (contract) =>
	createHash('sha256').update(JSON.stringify(contract)).digest('hex').slice(0, 16);

/**
 * Seconds one side of a scenario takes to render: measured per game in `costs.json` (`<game
 * key>/<scenario>` → seconds, the larger side; the report's `costs` line refreshes it), else by
 * scenario from the live games' 2026-10-05 runs on a CI runner with SwiftShader WebGL: a
 * `draw: 'every'` canary 120–350 s, big-wins 90–210 s, free spins ~60 s, the rest 10–45 s. Only
 * the balance across shards depends on it.
 */
const COSTS_FILE = join(HERE, 'costs.json');
const measured = existsSync(COSTS_FILE) ? JSON.parse(readFileSync(COSTS_FILE, 'utf8')).seconds : {};
const weightOf = (key, scenario) =>
	measured[`${key}/${scenario.id}`] ??
	(scenario.canary
		? 300
		: scenario.id === 'big-wins'
			? 130
			: scenario.id === 'free-spins'
				? 60
				: 25);

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
			entry.detail = redactText(`snapshot lookup failed: ${e.message}`);
			continue;
		}
		if (!entry.snapshot) {
			entry.status = 'unpublished';
			entry.notes.push('skip: not published (its published pointer does not exist).');
			continue;
		}
		entry.status = 'render';
		const contract = contractFor(g, manifest);
		entry.contractHash = contractHash(contract);
		const scenarios = loadScript(entry.script).scenarios.filter(
			(sc) => !scenarioIds || scenarioIds.includes(sc.id),
		);
		// A scenario for a feature this game does not have (`requires`: contract paths) is not played.
		const skipped = scenarios.filter((sc) => (sc.requires ?? []).some((p) => !at(contract, p)));
		if (skipped.length)
			entry.notes.push(
				`scenario(s) not played, the game has no such feature: ${skipped.map((sc) => sc.id).join(', ')}`,
			);
		entry.scenarios = scenarios
			.filter((sc) => !skipped.includes(sc))
			.map((sc) => ({ id: sc.id, canary: Boolean(sc.canary), weight: weightOf(g.key, sc) }));
	}
	return { games: planned, units: planned.flatMap((p) => unitsOf(p, 'published')) };
}

/**
 * Add the `republished` units to `plan` (a `makePlan` result): for every game to be rendered,
 * `variantsFor(entry, bundleFile)` makes both sides' republished variants of its snapshot
 * (`republishVariants` in `builtins.mjs`) from the `runtime.json` that `bundleFor(entry)` fetched,
 * and the game is rendered a second time only when the two variants differ — a built-in the snapshot
 * ships as a copy changed between the sides. Each entry records the classification
 * (`entry.republished`: `copies`, `authored`, `changed`, `affected`), and an entry whose variants
 * could not be made gets `status: 'error'`, which the compare turns into a failing row rather than
 * a silent gap. `reason` is kept on `plan.republish` for the report.
 */
export async function planRepublished(plan, { bundleFor, variantsFor }) {
	for (const entry of plan.games) {
		if (entry.status !== 'render') continue;
		try {
			const bundleFile = await bundleFor(entry);
			const meta = await variantsFor(entry, bundleFile);
			entry.republished = {
				status: 'planned',
				affected: Boolean(meta.affected),
				copies: meta.copies,
				authored: meta.authored,
				changed: meta.changed,
			};
			if (entry.republished.affected) plan.units.push(...unitsOf(entry, 'republished'));
		} catch (e) {
			entry.republished = {
				status: 'error',
				detail: redactText(`the republished variant could not be made: ${e.message}`),
			};
		}
	}
	return plan;
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
