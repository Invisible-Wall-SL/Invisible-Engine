// One render unit: one side (base = main's runtime, head = the branch's) of one scenario of one
// game, played from a fresh test server and a fresh browser so the seeded deal starts over. Writes
// `<out>/units/<unit id>/result.json` and one PNG per captured screen; the compare
// (`assemble.mjs`) pairs the two sides.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openPage } from './browser.mjs';
import { at, loadScript, safe } from './plan.mjs';
import { playScenario } from './play.mjs';
import { redactText } from './redact.mjs';
import { serveSnapshot, startTestServer, testServerTree } from './serve.mjs';

// The runtime's own refusal to boot a bundle (`editor-scenes.ts`): it shows its error screen, so no
// frame count would ever reach a game state.
const BOOT_STOPPED = '[runtime] boot stopped — ';
// Frames run before the script starts, enough for the runtime fetch (I/O, which frames wait for)
// to answer and a refused boot to say so.
const BOOT_PROBE_FRAMES = 10;

// Diagnostics (`CURRENT_GAMES_LOG_IMAGES`): every web font face the page knows, at a capture.
const FONTS =
	'[...document.fonts].map((f) => `${f.family} ${f.weight} ${f.style} ${f.status}`).sort()';

/** A forced beat with `{path}` placeholders filled from the game's contract (its own pot ids…). */
const fillBeat = (beat, contract) =>
	beat.replace(/\{([\w.-]+)\}/g, (_m, path) => {
		const v = at(contract, path);
		if (v === undefined) throw new Error(`force "${beat}": the contract has no ${path}`);
		return String(v);
	});

/**
 * Render `unit` of `planned` (a plan entry) with `runtimeDir`, dealt from `contract` (the game's
 * mock contract, checked against the plan's hash). `snapshotDir` is the downloaded snapshot.
 * `intercept` answers the Typekit hosts from the mirror (`typekit.mjs`); without it the browser
 * loads fonts from Adobe. Returns the result it wrote.
 */
export async function renderUnit({
	unit,
	planned,
	contract,
	runtimeDir,
	snapshotDir,
	chrome,
	seed,
	cache,
	out,
	trace,
	intercept,
}) {
	const { game } = planned;
	const scenario = loadScript(planned.script).scenarios.find((sc) => sc.id === unit.scenario);
	const draw = scenario.canary ? 'every' : 'last';
	const dir = join(out, 'units', unit.id);
	mkdirSync(dir, { recursive: true });
	const tree = testServerTree(
		join(cache, 'trees', `${unit.side}-${safe(game.key)}-${safe(scenario.id)}`),
		runtimeDir,
		game.key,
		contract,
	);
	const screens = {};
	const started = Date.now();
	let server;
	let snap;
	let profile;
	let page;
	let error;
	let bootStopped;
	let final;
	let consoleLines = [];
	const play = async () => {
		const sid = `cg-${game.key}-${scenario.id}`;
		const rgs = `${server.origin}/api/${game.key}/authoring`;
		const params = new URLSearchParams({
			runtime: '1',
			project: game.projectKey ?? game.key,
			k: 'current-games',
			editorDocBase: snap.origin,
			rgs_url: rgs.replace(/^http:\/\//, ''),
			sessionID: sid,
			lang: 'en',
			currency: 'USD',
			device: 'desktop',
			ie_determinism: seed,
		});
		await page.navigate(`${server.origin}/${game.key}/?${params}`);
		let ready = false;
		for (let i = 0; i < 300 && !ready; i++) {
			ready = await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false);
			if (!ready) await new Promise((r) => setTimeout(r, 100));
		}
		if (!ready) throw new Error('the runtime never installed determinism mode');
		await page.evaluate(
			`window.__IE_DETERMINISM__.step(${BOOT_PROBE_FRAMES}, { draw: '${draw}' })`,
		);
		const stopped = page.consoleLines.find((l) => l.includes(BOOT_STOPPED));
		if (stopped) {
			bootStopped = stopped.slice(stopped.indexOf(BOOT_STOPPED) + BOOT_STOPPED.length);
			throw new Error(`the runtime refused to boot this snapshot: ${bootStopped}`);
		}
		await playScenario(scenario, {
			page,
			draw,
			force: async (spec) => {
				const beat = fillBeat(spec, contract);
				const res = await fetch(
					`${rgs}/force?sid=${encodeURIComponent(sid)}&beat=${encodeURIComponent(beat)}`,
					{ method: 'POST' },
				);
				if (!res.ok) throw new Error(`force ${beat}: HTTP ${res.status} ${await res.text()}`);
			},
			trace: trace
				? (i, op, s) =>
						trace(
							`  ${unit.id} #${i + 1} ${op.op} → frame ${s.frame} idle ${s.idle} ` +
								`win ${s.win} tier ${s.winLevel ?? '-'} [${s.screens.join('>')}]`,
						)
				: undefined,
			capture: async (screen, state) => {
				const file = `${safe(screen)}.png`;
				const shot = await page.screenshot();
				writeFileSync(join(dir, file), shot);
				// Diagnostics: the same frame captured again after 300 ms of real time, no frame
				// stepped. A difference means the first capture was of a frame not yet presented.
				const later = process.env.CURRENT_GAMES_LOG_IMAGES
					? await new Promise((r) => setTimeout(r, 300)).then(() => page.screenshot())
					: undefined;
				screens[screen] = {
					file,
					frame: state.frame,
					screens: state.screens,
					winLevel: state.winLevel,
					...(later
						? {
								stableLater: later.equals(shot),
								fonts: await page.evaluate(FONTS).catch((e) => [e.message]),
							}
						: {}),
				};
			},
		});
	};
	try {
		server = await startTestServer(tree, { SEED: seed, ...(scenario.env ?? {}) });
		snap = await serveSnapshot({
			dir: snapshotDir,
			name: game.name,
			snapshotId: planned.snapshot.id,
			assetBase: game.local?.assetBase === 'runtime' ? `${server.origin}/${game.key}/` : undefined,
		});
		profile = mkdtempSync(join(tmpdir(), 'cg-profile-'));
		page = await openPage(chrome, profile, { intercept });
		await play();
	} catch (e) {
		error = e.message;
	} finally {
		final = await page
			?.evaluate(
				'window.__IE_DETERMINISM__ && { ...window.__IE_DETERMINISM__.state(), renderer: window.__PIXI_APP__?.renderer?.name }',
			)
			.catch(() => undefined);
		consoleLines = [...(page?.consoleLines ?? [])];
		await page?.close();
		server?.stop();
		await snap?.close();
		if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
	}
	// Players render with WebGL; a page that fell back to Pixi's Canvas renderer (no WebGL in the
	// browser) draws through other code and proves nothing about theirs.
	if (!error && final?.renderer && final.renderer !== 'webgl')
		error = `the page rendered with Pixi's ${final.renderer} renderer, not WebGL`;
	// A kit URL the mirror lacks was refused, so a text may have drawn in a fallback face on this
	// side only: not a comparison, a mirror to refresh.
	const unmirrored = page?.unmirrored ?? [];
	if (!error && unmirrored.length)
		error =
			`the Typekit mirror has no entry for ${unmirrored.slice(0, 3).join(', ')}` +
			(unmirrored.length > 3 ? ` (+${unmirrored.length - 3} more)` : '') +
			' — refresh it (the "Typekit mirror" workflow)';
	const result = {
		unit,
		draw,
		screens,
		error: error === undefined ? undefined : redactText(error),
		bootStopped: bootStopped === undefined ? undefined : redactText(bootStopped),
		errors: final?.errors ?? 0,
		stalls: final?.stalls ?? 0,
		frame: final?.frame,
		renderer: final?.renderer,
		console: consoleLines.slice(-10).map((l) => redactText(l)),
		external: [...(page?.external ?? [])].map((l) => redactText(l)),
		seconds: (Date.now() - started) / 1000,
	};
	writeFileSync(join(dir, 'result.json'), JSON.stringify(result, null, '\t'));
	return result;
}
