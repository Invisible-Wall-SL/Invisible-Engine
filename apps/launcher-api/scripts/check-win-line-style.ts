/**
 * Contract check for the STYLED PAYLINE (Invisible Symbols State Machine → Win lines → Payline
 * style): the `winLine.line` fields `coreColor`, `blend`, `taper`, `tip` and `trailFx` — what the
 * doc persists, what it refuses, and that every asset and effect they name reaches the game.
 *
 *   1. PARITY — a doc that never set them saves exactly as before; a real style round-trips
 *      canonically, defaults drop, and normalizing is a fixed point.
 *   2. REJECTION — the save refuses an unknown tip kind, end or blend; an unknown key is ignored.
 *   3. THE CLIENT HALF — `setWinLineLine` prunes with the same rule as the server, and a draft
 *      signs (`docSignature`) the same as the doc the server hands back; clearing the style unmarks.
 *   4. SHIPPING — a sprite tip reaches the symbols asset refs, a flipbook tip's clip the clip walk;
 *      the bake (by RUNNING `lib/bakeWinLine.mjs`) carries the block and keeps the same effects
 *      reachable as the runtime bundle; both keep-sets, the exporter, the export endpoint and the
 *      game's resolver, asset registration and renderer are wired.
 *   1b. COLOURS — a non-hex core colour is dropped (Pixi would throw on it), the existing colour
 *      fields keep accepting what they always did, and the game re-validates what it strokes.
 *   5. SOUND — the draw / impact sounds persist trimmed (a blank one drops), the sound export keeps
 *      the named library sounds (the symbols doc is a reachability source), and the renderer plays
 *      the draw sound only on an animated (never a slammed) draw and the impact only unskipped;
 *      neither on a resting-cycle replay, nor the impact of a line cleared mid-draw; the card's
 *      reset clears them.
 *
 * Run:  pnpm --filter launcher-api check:win-line-style
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { winLineEffectIds } from 'engine-layout';
import { lfReaderFrom } from '../../../scripts/lib/read-lf.mjs';
import { collectClipIds } from '../src/lib/server/clipReachability.ts';
import { namedSoundNames } from '../src/lib/server/soundReachability.ts';
import { collectSymbolRefs } from '../src/lib/server/symbolExport.ts';
import { emptySymbolsDoc, normalizeSymbolsDoc } from '../src/lib/server/symbolsStorage.ts';
import {
	docSignature,
	setWinLineLine,
	type SymbolsDoc,
} from '../src/routes/(app)/symbols/symbols.client.ts';
import { bakedWinLineEffectIds, bakeWinLine } from './lib/bakeWinLine.mjs';
import { symbolsRouteCarries } from './lib/symbolsRouteBody.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = lfReaderFrom(ROOT);

let failures = 0;
let checks = 0;
const json = (value: unknown): string => JSON.stringify(value);
const check = (label: string, actual: unknown, expected: unknown): void => {
	checks += 1;
	const a = json(actual);
	const e = json(expected);
	if (a === e) return;
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};
const rejects = (label: string, input: unknown): void => {
	checks += 1;
	try {
		normalizeSymbolsDoc(input, 'reject');
	} catch (e) {
		if (e instanceof ZodError) return;
		failures += 1;
		console.log(`FAIL  ${label}\n        threw a non-Zod error: ${String(e)}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        accepted`);
};

const SPRITE = 'c/p/atlases/atlas_manifest_fx.json::flare';

const STYLED = {
	color: '#ff3311',
	glow: true,
	animated: true,
	coreColor: '#ffffff',
	blend: 'add',
	taper: { alpha: 0.3, width: 0.6 },
	tip: { kind: 'sprite', assetKey: SPRITE, scale: 1.5, rotateWithLine: true, blend: 'add' },
	trailFx: ['fx-embers', 'fx-notes'],
};

// 1. PARITY
{
	const plain = { winLine: { line: { color: '#ffcc00', glow: true } } };
	check(
		'a line that never set the styled fields saves exactly as before',
		normalizeSymbolsDoc(plain).winLine,
		plain.winLine,
	);
	check('an empty doc still writes no winLine', 'winLine' in normalizeSymbolsDoc({}), false);
	check(
		'…byte-identical to the never-authored doc',
		json(normalizeSymbolsDoc({})),
		json(emptySymbolsDoc()),
	);
	check(
		'defaults alone persist nothing',
		'winLine' in
			normalizeSymbolsDoc({
				winLine: {
					line: {
						blend: 'normal',
						taper: { alpha: 1, width: 1 },
						tip: { kind: 'effect' },
						trailFx: [],
					},
				},
			}),
		false,
	);
	const saved = normalizeSymbolsDoc({ winLine: { line: STYLED } });
	check('a real style round-trips', saved.winLine?.line, STYLED);
	check('normalising twice is a fixed point', json(normalizeSymbolsDoc(saved)), json(saved));
	check(
		'a tip keeps only its kind’s asset, the burst only when it bursts, numbers clamp',
		normalizeSymbolsDoc({
			winLine: {
				line: {
					tip: {
						kind: 'flipbook',
						clipId: 'clip-flare',
						assetKey: 'stray',
						effectId: 'stray',
						scale: 0,
						atEnd: 'fade',
						endEffectId: 'fx-pop',
					},
					taper: { alpha: 3 },
				},
			},
		}).winLine?.line,
		{ tip: { kind: 'flipbook', clipId: 'clip-flare', scale: 0.05, atEnd: 'fade' } },
	);
}

// 1b. COLOURS
{
	check(
		'a bad core colour is dropped on save — it can never reach a stroke',
		normalizeSymbolsDoc({ winLine: { line: { coreColor: 'hot', glow: true } } }).winLine?.line,
		{ glow: true },
	);
	check(
		'a hex core colour is kept',
		normalizeSymbolsDoc({ winLine: { line: { coreColor: '#FFEEDD' } } }).winLine?.line,
		{ coreColor: '#FFEEDD' },
	);
	check(
		'the existing colour fields are NOT tightened: an already-saved non-hex colour still loads',
		normalizeSymbolsDoc({ winLine: { line: { color: 'red', glowColor: 'gold' } } }).winLine?.line,
		{ color: 'red', glowColor: 'gold' },
	);
	check(
		'the game re-validates the core colour it strokes with',
		read('apps/lines/src/editor-scenes.ts').includes(
			'coreColor: normalizeWinLineColor(w?.line?.coreColor),',
		),
		true,
	);
}

// 2. REJECTION
{
	rejects('an unknown tip kind', { winLine: { line: { tip: { kind: 'rig', assetKey: 'x' } } } });
	rejects('an unknown tip end', {
		winLine: { line: { tip: { kind: 'effect', effectId: 'x', atEnd: 'explode' } } },
	});
	rejects('an unknown blend', { winLine: { line: { blend: 'multiply' } } });
	// An unknown KEY is ignored with a warning, not refused (`docs/conventions/doc-readers.md`).
	const warn = console.warn;
	console.warn = () => undefined;
	try {
		check(
			'an unknown tip field is ignored, the tip kept',
			normalizeSymbolsDoc({
				winLine: { line: { tip: { kind: 'effect', effectId: 'x', tint: '#fff' } } },
			}).winLine?.line,
			{ tip: { kind: 'effect', effectId: 'x' } },
		);
		check(
			'an unknown taper field is ignored',
			'winLine' in normalizeSymbolsDoc({ winLine: { line: { taper: { length: 2 } } } }),
			false,
		);
	} finally {
		console.warn = warn;
	}
}

// 3. THE CLIENT HALF
{
	const base = emptySymbolsDoc() as SymbolsDoc;
	const draft = setWinLineLine(base, STYLED as never);
	check('the client keeps the same canonical style', draft.winLine?.line, STYLED);
	check(
		'a draft signs the same as the doc the server hands back',
		docSignature(draft),
		docSignature({ ...base, winLine: normalizeSymbolsDoc(draft).winLine } as SymbolsDoc),
	);
	check(
		'…and is dirty against the untouched doc',
		docSignature(draft) !== docSignature(base),
		true,
	);
	const cleared = setWinLineLine(draft, {
		color: undefined,
		glow: undefined,
		animated: undefined,
		coreColor: undefined,
		blend: undefined,
		taper: undefined,
		tip: undefined,
		trailFx: undefined,
	});
	check('clearing every field drops the winLine', 'winLine' in cleared, false);
	check('…and reads clean again', docSignature(cleared), docSignature(base));
	check(
		'a tip picked with no asset yet is no tip',
		setWinLineLine(base, { tip: { kind: 'sprite' } }).winLine,
		undefined,
	);
}

// 4. SHIPPING
{
	const doc = normalizeSymbolsDoc({ winLine: { line: STYLED } });
	check(
		'a sprite tip ships its atlas through the symbols export',
		collectSymbolRefs(doc).spriteManifests.has('c/p/atlases/atlas_manifest_fx.json'),
		true,
	);
	check(
		'no styled line ⇒ no extra refs',
		[...collectSymbolRefs(emptySymbolsDoc()).spriteManifests],
		[],
	);
	const clips = new Set<string>();
	collectClipIds(
		normalizeSymbolsDoc({ winLine: { line: { tip: { kind: 'flipbook', clipId: 'clip-flare' } } } }),
		clips,
	);
	check('a flipbook tip is a clip the art export ships', clips.has('clip-flare'), true);

	check(
		'the BAKE carries the block the export hands it, unchanged',
		bakeWinLine(JSON.parse(json(doc.winLine))),
		doc.winLine,
	);
	check('…and an absent block bakes to no key', bakeWinLine(undefined), undefined);
	check('…and an empty one too', bakeWinLine({ line: {}, text: {} }), undefined);
	const effectTip = normalizeSymbolsDoc({
		winLine: {
			line: {
				tip: { kind: 'effect', effectId: 'fx-flare', atEnd: 'burst', endEffectId: 'fx-pop' },
				trailFx: ['fx-embers'],
			},
		},
	}).winLine;
	check(
		'the runtime bundle and the bake keep the SAME effects reachable',
		[...winLineEffectIds(effectTip)].sort(),
		[...bakedWinLineEffectIds(bakeWinLine(effectTip))].sort(),
	);
	check('…which are the tip, its burst and the trail', winLineEffectIds(effectTip).sort(), [
		'fx-embers',
		'fx-flare',
		'fx-pop',
	]);
	check(
		'…and the trail alone for a sprite tip',
		bakedWinLineEffectIds(bakeWinLine(doc.winLine)).sort(),
		['fx-embers', 'fx-notes'],
	);

	const exporter = read('apps/launcher-api/src/lib/server/symbolExport.ts');
	check(
		'the runtime exporter carries the block into the bundle',
		exporter.includes('...(winLine ? { winLine } : {})'),
		true,
	);
	check(
		'the export endpoint forwards it — the bake reads it there',
		symbolsRouteCarries('winLine'),
		true,
	);
	const bake = read('apps/launcher-api/scripts/bake-editor-doc.mjs');
	check(
		'the BAKE assembles it into the baked `symbols` block',
		bake.includes('const winLine = bakeWinLine(s?.winLine);'),
		true,
	);
	check(
		'…and keeps its effects in the reachable set',
		bake.includes('bakedWinLineEffectIds(symbols.winLine)'),
		true,
	);
	const runtime = read('apps/launcher-api/src/lib/server/runtimeBundle.ts');
	check(
		'the runtime bundle keeps its effects in the reachable set',
		runtime.includes('winLineEffectIds(symbols.winLine)'),
		true,
	);
	const scenes = read('apps/lines/src/editor-scenes.ts');
	check(
		'the game resolves the tip and the trail through the shared normalizers',
		scenes.includes('tip: normalizeWinLineTip(w?.line?.tip),') &&
			scenes.includes('trailFx: normalizeWinLineTrailFx(w?.line?.trailFx) ?? [],'),
		true,
	);
	const stateApp = read('apps/lines/src/game/stateApp.ts');
	check('…and registers a sprite tip’s asset', stateApp.includes('...bakedWinLineAssets(),'), true);
	const renderer = read('apps/lines/src/components/WinLine.svelte');
	const shared = read('packages/engine-layout/src/lib/winLineStyle.ts');
	check(
		'the renderer traces the line and places the head with the shared maths',
		renderer.includes('paintWinLine(graphics, line, input, part)') &&
			shared.includes('tracePoints(graphics, pathSlice(pts, 0, p));') &&
			renderer.includes('winLineHeadAt(pts, p)') &&
			shared.includes('pathHeadPose(pts, p) ?? { ...pts[0], angle: 0 }'),
		true,
	);
	check(
		'…and trails through the moving-owner emitter, stopping as the line lands',
		renderer.includes('<FlightView') &&
			renderer.includes('emit={head.trailing}') &&
			renderer.includes('if (entry.head) landHead(entry.head);'),
		true,
	);
	check(
		'…and mounts nothing for a line with no tip and no trail',
		renderer.includes('const headFx = !!tip || line.trailFx.length > 0;') &&
			renderer.includes('{#if headFx}'),
		true,
	);
}

// 5. SOUND
{
	const doc = normalizeSymbolsDoc({
		winLine: { line: { drawSound: ' sfx_whoosh ', endSound: '  ' } },
	});
	check('a draw sound persists trimmed, a blank impact drops', doc.winLine?.line, {
		drawSound: 'sfx_whoosh',
	});
	const named = namedSoundNames({
		symbols: normalizeSymbolsDoc({
			winLine: { line: { drawSound: 'sfx_whoosh', endSound: 'sfx_impact' } },
		}),
	});
	check(
		'the sound export ships both: the symbols doc names them',
		!!named && named.has('sfx_whoosh') && named.has('sfx_impact'),
		true,
	);
	const renderer = read('apps/lines/src/components/WinLine.svelte');
	const animatedBranch = renderer.slice(
		renderer.indexOf('if (animated) {'),
		renderer.indexOf('await entry.progress.set(1, { duration });'),
	);
	check(
		'the draw sound plays only in the animated branch (a slammed round never takes it)',
		animatedBranch.includes('playSound(line.drawSound);') &&
			renderer.split('playSound(line.drawSound)').length === 2,
		true,
	);
	check(
		'the impact plays once the line is drawn, unskipped',
		renderer.includes(
			'if (showLine && !emitterEvent.replay && !roundSkip.isSkipped()) playSound(line.endSound);',
		),
		true,
	);
	check(
		'a resting-cycle replay redraws the line silently: both sounds skip a replay',
		animatedBranch.includes('if (!emitterEvent.replay) playSound(line.drawSound);') &&
			renderer.includes('!emitterEvent.replay && !roundSkip.isSkipped()) playSound(line.endSound)'),
		true,
	);
	const cycle = read('apps/lines/src/game/winSymbolCycle.ts');
	const flowEffects = read('apps/lines/src/game/flowEffects.ts');
	check(
		'…and the cycle marks every re-send a replay — the per-pass draw and the all-at-once set',
		cycle.includes('{ stamp: cfg.showText, replay: true },') &&
			/\.\.\.stamp,\s*replay: true,\s*\}\);/.test(cycle) &&
			flowEffects.includes('...(replay ? { replay: true } : {}),') &&
			cycle.split("type: 'winLineShow'").length === 2,
		true,
	);
	check(
		'…while a round’s own show carries no replay flag',
		!read('apps/lines/src/game/bookEventHandlerMap.ts').includes('replay: true') &&
			!flowEffects.includes('replay: true,'),
		true,
	);
	const landing = renderer.slice(renderer.indexOf('await entry.progress.set(1, { duration });'));
	const cleared = landing.indexOf('if (!lines.some((drawn) => drawn.id === entry.id)) return;');
	check(
		'a line cleared while it drew lands nowhere: the check comes before the tip end and impact',
		cleared > 0 &&
			cleared < landing.indexOf('if (entry.head) landHead(entry.head);') &&
			landing.indexOf('if (entry.head) landHead(entry.head);') <
				landing.indexOf('playSound(line.endSound)'),
		true,
	);
	const page = read('apps/launcher-api/src/routes/(app)/symbols/+page.svelte');
	const reset = page.slice(page.indexOf('function resetWinLinePaylineStyle'));
	const resetBody = reset.slice(0, reset.indexOf('\n\t}'));
	check(
		'the card’s reset clears its sounds too',
		resetBody.includes('drawSound: undefined') && resetBody.includes('endSound: undefined'),
		true,
	);
	check(
		'an unset sound broadcasts nothing',
		renderer.includes("if (name) context.eventEmitter.broadcast({ type: 'soundOnce'"),
		true,
	);
}

console.log(
	failures === 0
		? `\nwin-line style: OK (${checks} checks)`
		: `\nwin-line style: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
