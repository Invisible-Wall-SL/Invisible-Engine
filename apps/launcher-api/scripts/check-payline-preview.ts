/**
 * Contract check for the PAYLINE PREVIEW (Invisible Symbols → Win lines → Payline style):
 *
 *   1. THE BOARD — the project's reels, rows and paylines (5 × 3 without a config); a payline that
 *      does not fit the board is left out; a colour is kept only when it is a hex.
 *   2. THE SAMPLE — the most zig-zagging payline is picked (first declared on a tie); a project
 *      with none draws a triangle zig-zag; a win of N traces the first N cells of the full line.
 *   3. THE STYLE — the sparse line resolves to the game's coded defaults, read off
 *      `bakedWinLineConfig` in the game's source so the two cannot drift.
 *   4. REPLAY — every line setting and the sample change the replay key; nothing else does.
 *   5. THE TIMELINE — the draw takes the game's time, linear; the trail emits until the line
 *      lands; the tip stays, fades over `WIN_LINE_TIP_FADE_MS` or is removed for the burst, which
 *      emits for the game's burst time; a line that is not animated lands at once with no trail;
 *      each sound fires once, the draw sound only for an animated line.
 *   6. EFFECTS — the burst's emit time is `SymbolLayer`'s; trail layers are freed and re-keyed.
 *   7. WIRING — the preview and the game paint through the same `paintWinLine`, head and draw
 *      time; the page mounts the preview in the card; the server hands it the board.
 *
 * Run:  pnpm --filter launcher-api check:payline-preview
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EffectDoc } from 'engine-fx';
import { emitterSecondsToWallMs } from 'engine-fx';
import { WIN_LINE_TIP_FADE_MS, winLineDrawMs } from 'engine-layout';
import { bookOfThermopylaePreset } from 'game-config';
import { lfReaderFrom } from '../../../scripts/lib/read-lf.mjs';
import {
	burstEmitMs,
	cellCentre,
	effectSettleMs,
	freeLayers,
	PREVIEW_BURST_FALLBACK_MS,
	PREVIEW_CELL,
	PREVIEW_LINE_DEFAULTS,
	PREVIEW_REPLAY_DEBOUNCE_MS,
	PREVIEW_WAIT_MS,
	previewBoardOf,
	previewCues,
	previewFrame,
	previewPlan,
	previewReplayKey,
	resolvePreviewLine,
	sampleLineId,
	samplePoints,
	sampleRows,
	zigzagRows,
} from '../src/routes/(app)/symbols/paylinePreview.ts';
import type { WinLineLineStyle } from '../src/routes/(app)/symbols/symbols.client.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = lfReaderFrom(ROOT);

let failures = 0;
let checks = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	checks += 1;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};
const ok = (label: string, value: boolean): void => check(label, value, true);

// 1. THE BOARD
{
	check('no config: 5 × 3 and no paylines', previewBoardOf(null), {
		reels: 5,
		rows: [3, 3, 3, 3, 3],
		paylines: [],
	});
	const preset = bookOfThermopylaePreset();
	const board = previewBoardOf(preset);
	check('a real config: its reels and rows', [board.reels, board.rows], [5, [3, 3, 3, 3, 3]]);
	check(
		'…and every payline, in its order',
		board.paylines.map((line) => line.id),
		Object.keys(preset.paylines),
	);
	const mixed = previewBoardOf({
		numReels: 3,
		numRows: [3, 4, 3],
		paylines: { a: [0, 3, 2], b: [0, 3, 3], c: [0, 1], d: [1, 1, 1, 9] },
		paylineColors: { a: '#ff0000', d: 'red' },
	});
	check('a row a reel does not have, or a short line, is left out', mixed.paylines, [
		{ id: 'a', rows: [0, 3, 2], color: '#ff0000' },
		{ id: 'd', rows: [1, 1, 1] },
	]);
	check('a shorter reel is centred in the tallest', cellCentre(mixed, 0, 0).y, PREVIEW_CELL);
}

// 2. THE SAMPLE
{
	const board = previewBoardOf(bookOfThermopylaePreset());
	check('the most zig-zagging payline is picked', sampleLineId(board), '10');
	check(
		'on a tie, the first declared',
		sampleLineId(
			previewBoardOf({
				numReels: 3,
				numRows: [3, 3, 3],
				paylines: { x: [0, 1, 0], y: [2, 1, 2] },
			}),
		),
		'x',
	);
	const none = previewBoardOf(null);
	check('no payline: no id', sampleLineId(none), undefined);
	check('…and a triangle zig-zag', sampleRows(none, undefined), [0, 1, 2, 1, 0]);
	check(
		'a one-row board draws straight',
		zigzagRows({ reels: 4, rows: [1, 1, 1, 1] }),
		[0, 0, 0, 0],
	);
	check(
		'six reels of four bounce off the bottom',
		zigzagRows({ reels: 6, rows: [4, 4, 4, 4, 4, 4] }),
		[0, 1, 2, 3, 2, 1],
	);
	const { points, fullPoints } = samplePoints(board, [1, 0, 1, 2, 1], 3);
	check('a win of 3 traces the first 3 cells', points, fullPoints.slice(0, 3));
	check('…at the cell centres', points[0], { x: 60, y: 180 });
	check('a win is at least 2 cells', samplePoints(board, [1, 0, 1, 2, 1], 0).points.length, 2);
}

// 3. THE STYLE
{
	const resolved = resolvePreviewLine(undefined);
	const scenes = read('apps/lines/src/editor-scenes.ts');
	const resolver = scenes.slice(scenes.indexOf('export function bakedWinLineConfig'));
	const coded = (key: string): unknown => {
		const match = new RegExp(`w\\?\\.line\\?\\.${key} \\?\\? ([^,;\\n]+)`).exec(resolver);
		return match ? JSON.parse(match[1].replace(/'/g, '"')) : 'missing';
	};
	for (const key of Object.keys(PREVIEW_LINE_DEFAULTS) as (keyof typeof PREVIEW_LINE_DEFAULTS)[]) {
		check(`the default ${key} is the game's`, PREVIEW_LINE_DEFAULTS[key], coded(key));
	}
	check('an unset line: no core, normal glow, no taper, tip, trail or sound', resolved, {
		enabled: true,
		color: '#ffcc00',
		width: 0.03,
		glow: false,
		glowColor: '#ffcc00',
		animated: false,
		speed: 1,
		fullPayline: false,
		fullPaylineColor: '#4a90d9',
		useConfigColor: true,
		coreColor: undefined,
		blend: 'normal',
		taper: { alpha: 1, width: 1 },
		tip: undefined,
		trailFx: [],
		drawSound: undefined,
		endSound: undefined,
	});
	check(
		'the glow colour falls back to the line colour, as in the game',
		resolvePreviewLine({ color: '#00ff00' }).glowColor,
		'#00ff00',
	);
	check(
		'a tip waiting for its asset draws as no tip',
		resolvePreviewLine({ tip: { kind: 'sprite' } }).tip,
		undefined,
	);
}

// 4. REPLAY
{
	const base: WinLineLineStyle = { animated: true, glow: true };
	const sample = { lineId: '10', ofAKind: 5 };
	const key = previewReplayKey(resolvePreviewLine(base), sample);
	check(
		'the same line and sample: the same key',
		previewReplayKey(resolvePreviewLine({ ...base }), sample),
		key,
	);
	const edits: [string, WinLineLineStyle][] = [
		['colour', { color: '#123456' }],
		['width', { width: 0.06 }],
		['speed', { speed: 2 }],
		['full payline', { fullPayline: true }],
		['core', { coreColor: '#ffffff' }],
		['blend', { blend: 'add' }],
		['taper', { taper: { alpha: 0.2 } }],
		['tip', { tip: { kind: 'effect', effectId: 'fx' } }],
		['tip end', { tip: { kind: 'effect', effectId: 'fx', atEnd: 'fade' } }],
		['trail', { trailFx: ['embers'] }],
		['draw sound', { drawSound: 'whoosh' }],
	];
	for (const [label, edit] of edits) {
		ok(
			`a changed ${label} replays`,
			previewReplayKey(resolvePreviewLine({ ...base, ...edit }), sample) !== key,
		);
	}
	ok(
		'another payline replays',
		previewReplayKey(resolvePreviewLine(base), { ...sample, lineId: '4' }) !== key,
	);
	ok(
		'another win length replays',
		previewReplayKey(resolvePreviewLine(base), { ...sample, ofAKind: 3 }) !== key,
	);
	ok('the replay waits for the edits to settle', PREVIEW_REPLAY_DEBOUNCE_MS > 0);
}

// 5. THE TIMELINE
{
	const length = 4 * PREVIEW_CELL * 2;
	const line = resolvePreviewLine({
		animated: true,
		speed: 1,
		trailFx: ['embers'],
		tip: { kind: 'effect', effectId: 'flare' },
	});
	const plan = previewPlan(line, length, null);
	const drawMs = winLineDrawMs(length, 1, PREVIEW_CELL);
	check("the draw takes the game's time", plan.drawMs, drawMs);
	check("…which is the game's formula for 8 cells", drawMs, 440);
	const start = PREVIEW_WAIT_MS;
	check('before it starts nothing shows', previewFrame(plan, start - 1).shown, false);
	const at = (t: number) => previewFrame(plan, start + t);
	check(
		'it starts at 0 with the trail emitting and the tip up',
		[at(0).progress, at(0).trailing, at(0).tipShown],
		[0, true, true],
	);
	check('it draws linearly', at(drawMs / 4).progress, 0.25);
	check('the trail stops as it lands', [at(drawMs).progress, at(drawMs).trailing], [1, false]);
	check(
		'a tip that stays stays',
		[at(drawMs + 5000).tipShown, at(drawMs + 5000).tipAlpha],
		[true, 1],
	);

	const fade = previewPlan(
		resolvePreviewLine({ animated: true, tip: { kind: 'effect', effectId: 'f', atEnd: 'fade' } }),
		length,
		null,
	);
	const fadeAt = (t: number) => previewFrame(fade, start + fade.drawMs + t);
	check(
		'a fading tip is at half after half the fade',
		fadeAt(WIN_LINE_TIP_FADE_MS / 2).tipAlpha,
		0.5,
	);
	check('…and gone after it', fadeAt(WIN_LINE_TIP_FADE_MS).tipShown, false);
	check('…and no trail was authored, so none emits', previewFrame(fade, start).trailing, false);

	const burstDoc = { layers: [{ config: { emitterLifetime: 0.5 } }] } as unknown as EffectDoc;
	const burst = previewPlan(
		resolvePreviewLine({
			animated: true,
			tip: { kind: 'effect', effectId: 'f', atEnd: 'burst', endEffectId: 'pop' },
		}),
		length,
		burstDoc,
	);
	const burstAt = (t: number) => previewFrame(burst, start + burst.drawMs + t);
	check(
		'a bursting tip goes as the line lands, and the burst emits',
		[burstAt(0).tipShown, burstAt(0).bursting],
		[false, true],
	);
	check(
		'…for the burst time',
		[burstAt(burst.burstMs - 1).bursting, burstAt(burst.burstMs + 1).bursting],
		[true, false],
	);
	check(
		'a burst with no effect only removes the tip',
		previewFrame(
			previewPlan(
				resolvePreviewLine({
					animated: true,
					tip: { kind: 'effect', effectId: 'f', atEnd: 'burst' },
				}),
				length,
				null,
			),
			start + 10_000,
		),
		{ shown: true, progress: 1, trailing: false, tipShown: false, tipAlpha: 1, bursting: false },
	);

	const still = previewPlan(
		resolvePreviewLine({
			trailFx: ['embers'],
			tip: { kind: 'effect', effectId: 'f', atEnd: 'fade' },
		}),
		length,
		null,
	);
	check(
		'a line that is not animated: drawn whole at once, no trail',
		[still.drawMs, previewFrame(still, start).progress, previewFrame(still, start).trailing],
		[0, 1, false],
	);
	check(
		'…and its tip ends at once',
		previewFrame(still, start + WIN_LINE_TIP_FADE_MS).tipShown,
		false,
	);

	const sweep = (p: typeof plan) => {
		const cues: string[] = [];
		let last = -1;
		for (let t = 0; t <= start + p.drawMs + 500; t += 16.7) {
			cues.push(...previewCues(p, last, t));
			last = t;
		}
		return cues;
	};
	check('an animated line: the whoosh once, then the impact once', sweep(plan), ['draw', 'end']);
	check('a line drawn at once: the impact only, as in the game', sweep(still), ['end']);
}

// 6. EFFECTS
{
	const doc = {
		layers: [
			{ config: { emitterLifetime: 0.4, lifetime: { min: 0.1, max: 1 } } },
			{ config: {}, trigger: { duration: 900 } },
			{ config: { emitterLifetime: -1 } },
		],
	} as unknown as EffectDoc;
	check('a burst emits for its longest layer bound', burstEmitMs(doc), 900);
	check(
		'…a layer with no bound counts the fallback',
		burstEmitMs({ layers: [{ config: { emitterLifetime: -1 } }] } as unknown as EffectDoc),
		PREVIEW_BURST_FALLBACK_MS,
	);
	check(
		'…an emitter lifetime is emitter seconds',
		burstEmitMs({ layers: [{ config: { emitterLifetime: 2 } }] } as unknown as EffectDoc),
		emitterSecondsToWallMs(2),
	);
	ok(
		"the fallback is the game's transit beat",
		read('apps/lines/src/game/symbolBeat.ts').includes(
			`export const TRANSIT_BEAT_CAP_MS = ${PREVIEW_BURST_FALLBACK_MS};`,
		) &&
			read('apps/lines/src/components/SymbolLayer.svelte').includes(
				'ms = Math.max(ms, own ?? TRANSIT_BEAT_CAP_MS);',
			),
	);
	check('the settle is the longest particle life', effectSettleMs(doc), emitterSecondsToWallMs(1));
	const layers = freeLayers([
		{
			id: 'a',
			layers: [{ key: 'l', placement: { space: 'bone', bone: 'b', offset: { x: 2, y: 3 } } }],
		},
		{ id: 'b', layers: [{ key: 'l', placement: { space: 'free' } }] },
	] as unknown as EffectDoc[]);
	check(
		'trail layers are freed with their offset, and keyed by their effect',
		layers.map((l) => [l.key, l.placement]),
		[
			['a/l', { space: 'free', offset: { x: 2, y: 3 } }],
			['b/l', { space: 'free' }],
		],
	);
}

// 7. WIRING
{
	const renderer = read('apps/lines/src/components/WinLine.svelte');
	const preview = read('apps/launcher-api/src/routes/(app)/symbols/PaylinePreview.svelte');
	ok(
		'the game strokes through paintWinLine, its head and its draw time',
		renderer.includes('paintWinLine(graphics, line, input, part)') &&
			renderer.includes('winLineHeadAt(pts, p)') &&
			renderer.includes('winLineDrawMs(pathLength(emitterEvent.points), line.speed, SYMBOL_SIZE)'),
	);
	ok(
		'…and the preview paints with the same function and head',
		preview.includes("from 'engine-layout'") &&
			preview.includes("paintWinLine(graphics, line, input, 'both')") &&
			preview.includes("paintWinLine(graphics, line, input, 'glow')") &&
			preview.includes('winLineHeadAt(sample.points, f.progress)'),
	);
	ok(
		'the trail plays from a moving owner on a see-through stage, emitting only while it draws',
		preview.includes('ownerPos={trailOwner}') && preview.includes('emitting={trailing}'),
	);
	const page = read('apps/launcher-api/src/routes/(app)/symbols/+page.svelte');
	const card = page.slice(page.indexOf('id="winline-payline-style"'));
	ok(
		'the page mounts the preview inside the Payline style card',
		card.indexOf('<PaylinePreview') > 0 &&
			card.indexOf('<PaylinePreview') < card.indexOf('</SectionCard>'),
	);
	ok(
		'…drawing the doc line resolved as the game resolves it',
		page.includes('resolvePreviewLine($state.snapshot(wlLine), winLineOn)'),
	);
	ok(
		'the server hands it the project board',
		read('apps/launcher-api/src/routes/(app)/symbols/+page.server.ts').includes(
			'paylineBoard: previewBoardOf(config.doc),',
		),
	);
}

console.log(
	failures === 0
		? `\npayline preview: OK (${checks} checks)`
		: `\npayline preview: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
