// The compare: pairs every scenario's two render units (base = main, head = the branch), compares
// each screen under `tolerance.json`, and builds one row per planned game — build / tests / looks
// the same — then writes the report (`report.mjs`). Runs where the units meet: in-process for a
// local run, in CI's report job over every shard's units.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { compareScreens, cropAround, identical, toleranceFor } from './compare.mjs';
import { gatesFor, runGate } from './gates.mjs';
import { safe, unitId } from './plan.mjs';
import { redactSecrets } from './redact.mjs';
import { writeReport } from './report.mjs';

/** The id half for a screen only one side captured: the side plus that capture's bytes. */
const oneSidedHash = (png, side) =>
	createHash('sha256').update(side).update(png).digest('hex').slice(0, 16);

/** A unit's result and its screen PNGs, from whichever unit dir has it. */
function loadUnit(unitDirs, id) {
	for (const root of unitDirs) {
		const dir = join(root, 'units', id);
		if (!existsSync(join(dir, 'result.json'))) continue;
		const result = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'));
		const shots = Object.fromEntries(
			Object.entries(result.screens).map(([screen, s]) => [
				screen,
				readFileSync(join(dir, s.file)),
			]),
		);
		return { ...result, shots };
	}
	return undefined;
}

const failureOf = (r, side, scenario) =>
	r.error || r.errors || r.stalls
		? {
				side,
				scenario,
				error: r.error,
				errors: r.errors,
				stalls: r.stalls,
				console: r.console,
			}
		: undefined;

function gameRow(
	planned,
	{ unitDirs, out, tolerance, headSha, buildStatus, gates, keepScreens, crops },
) {
	const { game, script } = planned;
	const row = {
		key: game.key,
		name: game.name,
		gameType: game.gameType,
		projectKey: game.projectKey,
		hasOwnBuiltBundle: game.hasOwnBuiltBundle,
		script,
		build: buildStatus,
		tests: { status: 'skip', gates: [] },
		looks: { status: 'skip' },
		screens: [],
		notes: [...planned.notes],
	};
	if (gates) {
		row.tests.gates = gatesFor(script).map(runGate);
		row.tests.status = row.tests.gates.every((g) => g.pass) ? 'pass' : 'fail';
	}
	if (planned.status !== 'render') {
		row.looks =
			planned.status === 'error'
				? { status: 'error', detail: planned.detail }
				: { status: planned.status };
		return row;
	}
	if (buildStatus.status !== 'pass') {
		row.looks = { status: 'error', detail: 'the branch runtime did not build' };
		return row;
	}
	row.snapshot = planned.snapshot.id;
	const smoke = { status: 'pass', errors: 0, stalls: 0, failures: [] };
	const baseFailures = [];
	const missing = [];
	const refusals = { base: new Set(), head: new Set() };
	const refusedUnits = { base: 0, head: 0 };
	row.timings = {};
	for (const { id: scenario } of planned.scenarios) {
		const sides = {};
		for (const side of ['base', 'head']) {
			sides[side] = loadUnit(unitDirs, unitId(game.key, scenario, side));
			if (!sides[side]) missing.push(`${scenario}/${side}`);
		}
		if (!sides.base || !sides.head) continue;
		row.timings[scenario] = { base: sides.base.seconds, head: sides.head.seconds };
		for (const side of ['base', 'head']) {
			const r = sides[side];
			if (r.bootStopped) {
				refusals[side].add(r.bootStopped);
				refusedUnits[side]++;
			}
			const failure = failureOf(r, side, scenario);
			if (!failure) continue;
			if (side === 'base') baseFailures.push(failure);
			else {
				smoke.errors += r.errors;
				smoke.stalls += r.stalls;
				smoke.failures.push(failure);
			}
		}
		const draw = sides.base.draw;
		const screens = [
			...new Set([...Object.keys(sides.base.shots), ...Object.keys(sides.head.shots)]),
		];
		for (const screen of screens) {
			const tol = toleranceFor(tolerance, script, screen);
			const before = sides.base.shots[screen];
			const after = sides.head.shots[screen];
			const pick = (s) => s && { frame: s.frame, screens: s.screens, winLevel: s.winLevel };
			const shot = {
				screen,
				scenario,
				draw,
				tolerance: tol,
				state: { base: pick(sides.base.screens[screen]), head: pick(sides.head.screens[screen]) },
			};
			const stem = `${safe(game.key)}--${safe(screen)}`;
			if (!before || !after) {
				shot.pass = false;
				shot.reason = `captured on ${before ? 'main' : 'the branch'} only — no diff`;
				shot.diffHash = oneSidedHash(before ?? after, before ? 'base' : 'head');
			} else if (identical(before, after)) {
				shot.pass = true;
				shot.identical = true;
				shot.measured = { diffPixels: 0, diffRatio: 0, maxBlockRatio: 0 };
			} else {
				const c = compareScreens(before, after, tol);
				shot.pass = c.pass;
				shot.reason = c.reason;
				shot.measured = {
					diffPixels: c.diffPixels,
					diffRatio: c.diffRatio,
					maxBlockRatio: c.maxBlockRatio,
					box: c.box,
				};
				shot.diffHash = c.diffHash;
				shot.heatmap = c.heatmap;
				if (c.diffPng && process.env.CURRENT_GAMES_LOG_IMAGES) {
					const crop = cropAround(before, after, c.diffPng);
					// A multiset difference: a line twice on one side and once on the other shows.
					const only = (xs = [], ys = []) => {
						const left = [...ys];
						return xs
							.filter((x) => {
								const i = left.indexOf(x);
								if (i < 0) return true;
								left.splice(i, 1);
								return false;
							})
							.join(' | ');
					};
					const fonts = [sides.base, sides.head].map((r) => r.screens[screen]?.fonts);
					const texts = [sides.base, sides.head].map((r) => r.screens[screen]?.texts);
					const layout = [sides.base, sides.head].map((r) => r.screens[screen]?.layout);
					const translucent = [sides.base, sides.head].map((r) => r.screens[screen]?.translucent);
					const ext = [sides.base, sides.head].map((r) => r.external ?? []);
					crops.push(
						...[
							`== ${game.key} ${screen} crop x${crop.x} y${crop.y} ${crop.w}x${crop.h}`,
							`fonts only on main: ${only(fonts[0], fonts[1])}`,
							`fonts only on the branch: ${only(fonts[1], fonts[0])}`,
							`texts only on main: ${only(texts[0], texts[1])}`,
							`texts only on the branch: ${only(texts[1], texts[0])}`,
							`layout on main: ${(layout[0] ?? []).join(' | ')}`,
							`layout only on the branch: ${only(layout[1], layout[0])}`,
							`translucent only on main: ${only(translucent[0], translucent[1])}`,
							`translucent only on the branch: ${only(translucent[1], translucent[0])}`,
							`external on main: ${ext[0].join(' | ')}`,
							`external on the branch: ${ext[1].join(' | ')}`,
						].map((line) => redactSecrets(line)),
						...['before', 'after', 'diff'].map((k, i) => `${k} ${crop.images[i]}`),
					);
				}
				if (c.diffPng) {
					writeFileSync(join(out, 'screens', `${stem}.diff.png`), c.diffPng);
					shot.images = { diff: `screens/${stem}.diff.png` };
				}
			}
			if (shot.diffHash) shot.id = `${headSha}:${game.key}:${screen}:${shot.diffHash}`;
			if (!shot.pass || keepScreens)
				for (const [side, png] of [
					['before', before],
					['after', after],
				])
					if (png) {
						writeFileSync(join(out, 'screens', `${stem}.${side}.png`), png);
						shot.images = { ...shot.images, [side]: `screens/${stem}.${side}.png` };
					}
			row.screens.push(shot);
		}
	}
	if (smoke.failures.length) smoke.status = 'fail';
	row.tests.smoke = smoke;
	if (smoke.status === 'fail') row.tests.status = 'fail';
	else if (row.tests.status === 'skip') row.tests.status = 'pass';
	const changed = row.screens.filter((s) => !s.pass);
	// Main's runtime refuses this published snapshot in every scenario, and so does the branch's,
	// for the same reasons: players get the runtime's error screen today. Nothing is rendered, so
	// nothing is compared — a visible row that never passes, and the branch is not blamed for it.
	// Anything else the branch did (a crash, a scenario it did boot) fails the row as usual.
	const refused = [...refusals.base];
	if (
		refused.length &&
		!missing.length &&
		refusedUnits.base === planned.scenarios.length &&
		refusedUnits.head === planned.scenarios.length &&
		refusals.base.size === refusals.head.size &&
		refused.every((r) => refusals.head.has(r))
	) {
		row.tests.smoke = { ...smoke, status: 'pass', errors: 0, stalls: 0, failures: [] };
		row.tests.status = !gates ? 'skip' : row.tests.gates.every((g) => g.pass) ? 'pass' : 'fail';
		row.looks = { status: 'refused', detail: refused.join('; ') };
		row.notes.push(
			`not rendered: main's runtime refuses this published snapshot (${refused.join('; ')}), so ` +
				'players see the error screen today. Republish the game to fix it.',
		);
		return row;
	}
	row.looks = missing.length
		? {
				status: 'error',
				detail: `no render came back for ${missing.join(', ')} (its shard died)`,
			}
		: baseFailures.length
			? {
					status: 'error',
					detail: `main's runtime failed this game too, so the comparison proves nothing: ${baseFailures
						.map((f) => `${f.scenario}: ${f.error ?? `errors ${f.errors}, stalls ${f.stalls}`}`)
						.join('; ')}`,
					baseFailures,
					changed: changed.length,
					of: row.screens.length,
				}
			: changed.length
				? { status: 'changed', changed: changed.length, of: row.screens.length }
				: { status: 'same', of: row.screens.length };
	return row;
}

/**
 * Build and write the report for `plan` from the units under `unitDirs` (each a dir holding
 * `units/<id>/`). `gates`: run (or read, after `loadGateResults`) each type's gates.
 */
export function assembleReport({
	plan,
	unitDirs,
	out,
	tolerance,
	gates = true,
	keepScreens = false,
	extra = {},
}) {
	mkdirSync(join(out, 'screens'), { recursive: true });
	const crops = [];
	const buildStatus = plan.buildStatus ?? { status: 'pass' };
	const games = plan.aborted
		? []
		: plan.games.map((planned) =>
				gameRow(planned, {
					unitDirs,
					out,
					tolerance,
					headSha: plan.head?.sha,
					buildStatus,
					gates,
					keepScreens,
					crops,
				}),
			);
	// Opt-in (`CURRENT_GAMES_LOG_IMAGES`): never inside the report, whose redaction would mask the
	// base64 as token-shaped.
	if (crops.length) writeFileSync(join(out, 'crops.txt'), `${crops.join('\n')}\n`);
	const seconds = Object.fromEntries(
		games.map((g) => [
			g.key,
			Math.round(Object.values(g.timings ?? {}).reduce((sum, t) => sum + t.base + t.head, 0)),
		]),
	);
	return writeReport(out, {
		version: 2,
		head: plan.head,
		base: plan.base,
		seed: plan.seed,
		viewport: '1280x720@1 UTC en-US',
		aborted: plan.aborted,
		...extra,
		renderSeconds: seconds,
		games,
	});
}
