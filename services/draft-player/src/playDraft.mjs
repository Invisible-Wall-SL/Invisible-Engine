// The draft player (ADR-0010 §2–§4, PLAN card 9D): plays ONE side of a draft game's screen script
// and reports what QA needs — which screens were reached, which were not and where the script
// stalled, the console errors, whether the runtime refused to boot. It is the current-games
// harness's render of one unit (`scripts/current-games/lib/render.mjs`) with nothing to compare
// against: the harness libs are imported unchanged, and nothing here touches math, R2 or a publish.
//
// A draft folder has the layout of a published snapshot (`runtime.json` + `deploy/**`) plus
// `draft.json` ({ draftId, runtime, projectKey?, gameKey?, name?, standIn?, assetBase? }).

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import {
	contractHash,
	loadScript,
	safe,
	scriptFor,
	unitId,
} from '../../../scripts/current-games/lib/plan.mjs';
import { redactText } from '../../../scripts/current-games/lib/redact.mjs';
import { renderUnit } from '../../../scripts/current-games/lib/render.mjs';

const SCREENS_DIR = resolve(import.meta.dirname, '../../../scripts/current-games/screens');
const CONSOLE_LINES = 20;
const CONSOLE_CHARS = 300;
const DEFAULT_SEED = 'current-games';
// `ScriptError`s of `lib/play.mjs`'s `fail()`: `step 3 (waitFor never): not reached — {probe state}`.
const NOT_REACHED = /^step (\d+) \((\w+)(?: ([^)]*))?\): not reached — (\{[\s\S]*\})$/;

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const clip = (line) => redactText(line).slice(0, CONSOLE_CHARS);

/** The screens a scenario's script captures, in order: what a complete play reaches. */
export const expectedScreens = (scenario) =>
	scenario.steps.filter((s) => s.op === 'capture').map((s) => s.screen);

/** Where a wait ran out, from the harness's error text; `null` when the unit did not stall. */
export function stallOf(result) {
	const found = NOT_REACHED.exec(result.error ?? '');
	if (found) {
		let probe;
		try {
			probe = JSON.parse(found[4]);
		} catch {
			probe = { raw: found[4].slice(0, CONSOLE_CHARS) };
		}
		return {
			step: Number(found[1]),
			op: found[2],
			...(found[3] ? { screen: found[3] } : {}),
			frames: probe.frame ?? result.frame ?? null,
			probe,
		};
	}
	// The page's own stall count (an I/O wait the frames could not get past), no script step named.
	if (result.stalls > 0)
		return {
			step: null,
			op: null,
			frames: result.frame ?? null,
			probe: { stalls: result.stalls, errors: result.errors },
		};
	return null;
}

/**
 * One scenario's entry of the report, from the harness's `result.json` (what `renderUnit` returns).
 * Pure: the unit-level test feeds it results without a browser.
 */
export function reduceScenario(scenario, result, shotsDir) {
	const expected = expectedScreens(scenario);
	const reached = expected.filter((screen) => screen in result.screens);
	const stall = result.bootStopped ? null : stallOf(result);
	return {
		id: scenario.id,
		expected,
		reached,
		missing: expected.filter((screen) => !reached.includes(screen)),
		stall,
		consoleErrors: (result.console ?? []).slice(-CONSOLE_LINES).map(clip),
		// Page-reported counts: errors the game logged, frames it stalled on.
		pageErrors: result.errors ?? 0,
		pageStalls: result.stalls ?? 0,
		// A failure that is neither a stall nor a refused boot (no WebGL, a script error…).
		error: result.error && !stall && !result.bootStopped ? clip(result.error) : null,
		seconds: Math.round((result.seconds ?? 0) * 10) / 10,
		shots: Object.fromEntries(
			reached.map((screen) => [
				screen,
				join(shotsDir, result.unit.id, result.screens[screen].file),
			]),
		),
	};
}

/**
 * Play `kind`'s script on the draft in `draftDir` with the runtime build in `runtimeDir`, dealt from
 * `contract` (the object, or the path of its JSON). `scenarios` limits the ids played (default:
 * all of them, minus those needing a feature the contract lacks). `chrome` is the headless shell,
 * `out` where the report and the screenshots go, `intercept` the Typekit answer (`typekit.mjs`;
 * without it the browser loads fonts from Adobe, as players do). `screens` (a test seam) names a
 * screens file to play instead of `screens/<kind script>.json`. `signal` stops the play between
 * scenarios (the service's cancel); the report then lists the scenarios played so far.
 */
export async function playDraft({
	draftDir,
	runtimeDir,
	contract,
	kind,
	scenarios,
	chrome,
	out,
	seed = DEFAULT_SEED,
	intercept,
	screens,
	trace,
	signal,
}) {
	const started = Date.now();
	const draft = readJson(join(draftDir, 'draft.json'));
	if (!existsSync(join(draftDir, 'runtime.json')))
		throw new Error(`${draftDir} has no runtime.json: a draft without one is never played`);
	const theContract = typeof contract === 'string' ? readJson(contract) : contract;
	out = resolve(out);
	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });

	const scriptName = screens
		? // `loadScript` joins its argument onto the harness's screens folder: a relative path reaches a file elsewhere.
			relative(SCREENS_DIR, resolve(screens)).replace(/\.json$/, '')
		: scriptFor(kind);
	const script = loadScript(scriptName);
	const ids = new Set(script.scenarios.map((sc) => sc.id));
	for (const id of scenarios ?? [])
		if (!ids.has(id)) throw new Error(`the ${kind} script has no scenario "${id}"`);
	const at = (path) =>
		path
			.split('.')
			.reduce((v, k) => (v == null ? v : Array.isArray(v) ? v.at(Number(k)) : v[k]), theContract);
	const wanted = script.scenarios.filter((sc) => !scenarios || scenarios.includes(sc.id));
	const playable = wanted.filter((sc) => (sc.requires ?? []).every((p) => at(p)));
	const notPlayed = wanted.filter((sc) => !playable.includes(sc)).map((sc) => sc.id);

	const key = safe(draft.gameKey ?? draft.projectKey ?? 'draft');
	const planned = {
		game: {
			key,
			name: draft.name ?? key,
			gameType: kind,
			projectKey: draft.projectKey ?? key,
			...(draft.standIn ? { standIn: true } : {}),
			...(draft.assetBase ? { local: { assetBase: draft.assetBase } } : {}),
		},
		script: scriptName,
		snapshot: { id: draft.draftId },
	};
	const work = join(out, '.work');
	const entries = [];
	let bootRefused = null;
	for (const scenario of playable) {
		if (signal?.aborted) break;
		if (bootRefused) {
			// The runtime refuses the whole draft, not one scenario: nothing more to learn by booting again.
			const expected = expectedScreens(scenario);
			entries.push({
				id: scenario.id,
				expected,
				reached: [],
				missing: expected,
				stall: null,
				consoleErrors: [],
				pageErrors: 0,
				pageStalls: 0,
				error: 'not played: the runtime refused to boot this draft',
				seconds: 0,
				shots: {},
			});
			continue;
		}
		const unit = {
			id: unitId(key, scenario.id, 'head'),
			key,
			scenario: scenario.id,
			side: 'head',
			variant: 'published',
		};
		const result = await renderUnit({
			unit,
			planned,
			contract: theContract,
			runtimeDir,
			snapshotDir: draftDir,
			chrome,
			seed,
			cache: work,
			out,
			trace,
			intercept,
		});
		if (result.bootStopped) bootRefused = result.bootStopped;
		entries.push(reduceScenario(scenario, result, 'units'));
	}
	rmSync(work, { recursive: true, force: true });

	const versionFile = join(runtimeDir, 'version.json');
	const report = {
		draftId: draft.draftId,
		runtime: draft.runtime ?? (existsSync(versionFile) ? readJson(versionFile) : null),
		kind,
		contractHash: contractHash(theContract),
		seconds: Math.round((Date.now() - started) / 100) / 10,
		bootRefused,
		...(notPlayed.length ? { notPlayed } : {}),
		scenarios: entries,
	};
	writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, '\t'));
	return report;
}
