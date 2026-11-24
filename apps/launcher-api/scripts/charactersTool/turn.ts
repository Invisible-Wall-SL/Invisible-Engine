/**
 * §17 of `check:characters-tool` — A SHEET'S SMOOTH TURN ON THE VIEW CARD (`view.turn`,
 * `docs/design/character-pipeline.md` §13). The edits (`characterSheetEdit.ts` `setViewTurn`,
 * `setViewTurnLean`, `setViewTurnSpeed`): sparse, refused out of range, dropped by a side view and
 * held in range by a change of facings. The turn preview's driver (`sheetTurn.ts`) over the game's
 * own animator: off it snaps, on it leans and sweeps through the facings in between. And the card
 * and the preview as written.
 */
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { CLIP_FACINGS, type ClipFacing } from 'engine-layout';
import type { FlipbookClip } from 'engine-flipbook';
import {
	normalizeCharacterSheet,
	normalizeGameConfigDoc,
	validateCharacterSheets,
	withCharacterSheets,
	type CharacterSheet,
	type CharacterView,
	type GameConfigDoc,
} from 'game-config';

import { findCharacter } from '../../src/lib/characters/characterEdit.ts';
import * as sheet from '../../src/lib/characters/characterSheetEdit.ts';
import {
	TURN_PREVIEW_CIRCLE_MS,
	headingDegrees,
	leanDegrees,
	turnAnimator,
	turnPreviewKind,
	turnSample,
	turnStageBox,
	type TurnReading,
} from '../../src/lib/characters/sheetTurn.ts';
import { clipDrawing, clipMirror } from '../../src/lib/flipbook/clipDrawing.ts';
import { clipStage } from '../../src/lib/flipbook/characterStage.ts';
import type { Section } from './harness';

const code = (rel: string): string =>
	readFileSync(new URL(`../../src/${rel}`, import.meta.url), 'utf8');
const text = (v: unknown): string => JSON.stringify(v);

const docOf = (view?: CharacterView): GameConfigDoc => {
	const raw = {
		family: 'arcade',
		outcome: 'rules',
		arcade: {
			field: { w: 2000, h: 1200 },
			bodies: { hero: { shape: 'circle', r: 20, tags: ['player'] } },
			characters: [{ id: 'hero', component: 'hero', ...(view ? { view } : {}) }],
		},
	};
	return withCharacterSheets(normalizeGameConfigDoc(raw) as GameConfigDoc, raw);
};
const viewOf = (doc: GameConfigDoc): CharacterView | undefined => findCharacter(doc, 'hero')?.view;

const DEG = Math.PI / 180;
const FRAME_MS = 16;
const ACTIONS = [
	{ id: 'idle', when: { motion: 'still' as const } },
	{ id: 'walk', when: { motion: 'moving' as const } },
];
const sheetOf = (view: CharacterView, source: CharacterSheet['source']): CharacterSheet => ({
	view,
	source,
	draw: { width: 64 },
	actions: ACTIONS,
});
const CLIPS: CharacterSheet['source'] = { kind: 'clips', prefix: 'hero' };
const EVERY = ACTIONS.flatMap((a) => CLIP_FACINGS.map((facing) => `hero_${a.id}_${facing}`));
const NO_RIGS = { has: () => false, durationMs: () => undefined };

/** How long an animator is driven along its first heading before its frames are read: it starts
 *  in its view's first facing, and has turned by then. */
const SETTLE_MS = 992;

/** Drive a sheet's preview animator along `headingAt(ms)` (degrees) for `ms`, a frame at a time,
 *  as the preview does. */
function drive(
	of: CharacterSheet,
	headingAt: (ms: number) => number,
	ms: number,
	clipIds: readonly string[] = EVERY,
	rigs: Parameters<typeof turnAnimator>[2] = NO_RIGS,
): TurnReading[] {
	const animator = turnAnimator(of, clipIds, rigs)!;
	const out: TurnReading[] = [];
	for (let at = -SETTLE_MS; at <= ms; at += FRAME_MS) {
		const reading = animator.read(turnSample(of, headingAt(Math.max(at, 0)) * DEG, at));
		if (reading && at >= 0) out.push(reading);
	}
	return out;
}
/** The facings drawn, each once per run of frames. */
const facingsOf = (readings: readonly TurnReading[]): ClipFacing[] =>
	readings.map((r) => r.facing).filter((facing, i, all) => i === 0 || all[i - 1] !== facing);
const mostLean = (readings: readonly TurnReading[]): number =>
	Math.max(...readings.map((r) => Math.abs(r.lean))) / DEG;
/** North for a second, then about. */
const reversal = (ms: number): number => (ms < 1000 ? 0 : 180);

export const run: Section = (t) => {
	// ── the edits ────────────────────────────────────────────────────────────────────────────
	{
		const none = docOf();
		t.same(
			'17. no view: it cannot turn smoothly, and nothing is stored',
			[
				sheet.setViewTurn(none, 'hero', true),
				sheet.hasSheet(none, 'hero'),
				sheet.turnNote(undefined),
			],
			[
				'Choose Top-down or Isometric to turn smoothly.',
				false,
				'Choose Top-down or Isometric to turn smoothly.',
			],
		);
		const side = docOf({ kind: 'side' });
		const stored3d = docOf({ kind: '3d' });
		t.same(
			'17. a side view and a 3D view take no turn, each for its reason, and store none',
			[
				sheet.setViewTurn(side, 'hero', true),
				sheet.setViewTurnLean(side, 'hero', '10'),
				sheet.setViewTurnSpeed(side, 'hero', '90'),
				viewOf(side),
				sheet.setViewTurn(stored3d, 'hero', true),
				viewOf(stored3d),
				sheet.turnNote({ kind: 'side' }),
				sheet.turnNote({ kind: '3d' }),
			],
			[
				'A side view has two facings: there is nothing to turn through.',
				'A side view has two facings: there is nothing to turn through.',
				'A side view has two facings: there is nothing to turn through.',
				{ kind: 'side' },
				'A 3D view has no facings: the body turns the model.',
				{ kind: '3d' },
				'A side view has two facings: there is nothing to turn through.',
				'A 3D view has no facings: the body turns the model.',
			],
		);
		t.same(
			'17. a view of four or eight facings can: no note, and the most lean is half the angle between two',
			[
				sheet.turnNote({ kind: 'topDown' }),
				sheet.turnNote({ kind: 'isometric', facings: 8 }),
				sheet.turnLeanMax({ kind: 'topDown' }),
				sheet.turnLeanMax({ kind: 'isometric', facings: 8 }),
			],
			['', '', 45, 22.5],
		);

		const doc = docOf({ kind: 'topDown' });
		t.same(
			'17. off: its lean and its speed wait for it',
			[sheet.setViewTurnLean(doc, 'hero', '10'), sheet.setViewTurnSpeed(doc, 'hero', '90')],
			['Turn Smooth turn on first.', 'Turn Smooth turn on first.'],
		);
		sheet.setViewTurn(doc, 'hero', true);
		t.same('17. on at its defaults is `turn: {}`', viewOf(doc), { kind: 'topDown', turn: {} });
		sheet.setViewTurnLean(doc, 'hero', '10');
		sheet.setViewTurnSpeed(doc, 'hero', '720');
		t.same('17. a lean and a speed that are not the defaults are stored', viewOf(doc), {
			kind: 'topDown',
			turn: { lean: 10, speed: 720 },
		});
		sheet.setViewTurn(doc, 'hero', true);
		t.same('17. turning it on again keeps them', viewOf(doc), {
			kind: 'topDown',
			turn: { lean: 10, speed: 720 },
		});
		t.same(
			'17. out of range or not a number is refused in words, and nothing changes',
			[
				sheet.setViewTurnLean(doc, 'hero', '46'),
				sheet.setViewTurnLean(doc, 'hero', '-1'),
				sheet.setViewTurnLean(doc, 'hero', 'far'),
				sheet.setViewTurnSpeed(doc, 'hero', '3601'),
				sheet.setViewTurnSpeed(doc, 'hero', '-5'),
				sheet.setViewTurnSpeed(doc, 'hero', 'fast'),
				viewOf(doc),
			],
			[
				'Most lean is a number from 0 to 45.',
				'Most lean is a number from 0 to 45.',
				'Most lean is a number from 0 to 45.',
				'Turn speed is a number from 0 to 3600.',
				'Turn speed is a number from 0 to 3600.',
				'Turn speed is a number from 0 to 3600.',
				{ kind: 'topDown', turn: { lean: 10, speed: 720 } },
			],
		);
		sheet.setViewTurnLean(doc, 'hero', '0');
		sheet.setViewTurnSpeed(doc, 'hero', '0');
		t.same('17. 0 is a value: no lean, and a turn at once', viewOf(doc), {
			kind: 'topDown',
			turn: { lean: 0, speed: 0 },
		});
		sheet.setViewTurnLean(doc, 'hero', '45');
		sheet.setViewTurnSpeed(doc, 'hero', '360');
		t.same('17. the defaults typed are not stored', viewOf(doc), { kind: 'topDown', turn: {} });
		sheet.setViewTurnLean(doc, 'hero', '12.5');
		sheet.setViewTurnSpeed(doc, 'hero', '3600');
		sheet.setViewTurnLean(doc, 'hero', ' ');
		sheet.setViewTurnSpeed(doc, 'hero', '');
		t.same('17. … and a blank field is the default', viewOf(doc), { kind: 'topDown', turn: {} });

		sheet.setViewTurnLean(doc, 'hero', '30');
		sheet.setViewFacings(doc, 'hero', 8);
		sheet.setViewMirror(doc, 'hero', false);
		t.check(
			'17. four to eight: a lean past the new half (22.5) becomes it, the default; the turn is the view’s last key',
			text(viewOf(doc)) === text({ kind: 'topDown', facings: 8, mirror: false, turn: {} }),
			text(viewOf(doc)),
		);
		t.same(
			'17. … where 22.5 is the most, and is not stored',
			[
				sheet.setViewTurnLean(doc, 'hero', '23'),
				sheet.setViewTurnLean(doc, 'hero', '22.5'),
				viewOf(doc),
			],
			[
				'Most lean is a number from 0 to 22.5.',
				null,
				{ kind: 'topDown', facings: 8, mirror: false, turn: {} },
			],
		);
		sheet.setViewTurnLean(doc, 'hero', '10');
		sheet.setViewTurnSpeed(doc, 'hero', '180');
		sheet.setViewFacings(doc, 'hero', 4);
		t.same('17. eight to four keeps a lean the new view holds', viewOf(doc), {
			kind: 'topDown',
			mirror: false,
			turn: { lean: 10, speed: 180 },
		});
		sheet.setViewKind(doc, 'hero', 'isometric');
		t.same('17. top-down to isometric keeps the turn', viewOf(doc), {
			kind: 'isometric',
			mirror: false,
			turn: { lean: 10, speed: 180 },
		});
		t.check(
			'17. what is stored is what the normalizer stores, and the save’s validator says nothing of it',
			text(normalizeCharacterSheet(findCharacter(doc, 'hero'))) ===
				text(sheet.sheetOf(doc, 'hero')) &&
				!validateCharacterSheets(doc).some((issue) => issue.path.includes('.view')),
			text(validateCharacterSheets(doc)),
		);
		sheet.setViewKind(doc, 'hero', 'side');
		t.same('17. a side view drops it', viewOf(doc), { kind: 'side', mirror: false });
		sheet.setViewKind(doc, 'hero', 'topDown');
		t.same('17. … for good: back to top-down it is off', viewOf(doc), {
			kind: 'topDown',
			mirror: false,
		});
		sheet.setViewTurn(doc, 'hero', true);
		sheet.setViewTurnSpeed(doc, 'hero', '90');
		sheet.setViewTurn(doc, 'hero', false);
		t.same('17. off leaves no key, and forgets its speed', viewOf(doc), {
			kind: 'topDown',
			mirror: false,
		});
		sheet.setViewTurn(doc, 'hero', true);
		sheet.clearView(doc, 'hero');
		t.check(
			'17. taking the view away takes the turn with it',
			!sheet.hasSheet(doc, 'hero') && !('view' in findCharacter(doc, 'hero')!),
		);
	}

	// ── the preview's driver, over the game's animator ───────────────────────────────────────
	{
		const off = sheetOf({ kind: 'topDown', facings: 8 }, CLIPS);
		const on = sheetOf({ kind: 'topDown', facings: 8, turn: {} }, CLIPS);
		t.same(
			'17. what draws a sheet in the preview: clips, a rig, or nothing yet',
			[
				turnPreviewKind(on),
				turnPreviewKind(sheetOf({ kind: 'topDown' }, { kind: 'rig', rig: 'heroRig' })),
				turnPreviewKind({ view: { kind: 'topDown' }, source: CLIPS }),
				turnPreviewKind(undefined),
				turnAnimator({ view: { kind: 'topDown' }, source: CLIPS }, EVERY, NO_RIGS),
			],
			['clips', 'rig', undefined, undefined, undefined],
		);
		const round = (view: CharacterView): string[] =>
			[0, 45, 90, 135, 180, 225, 270, 315].map(
				(heading) => drive(sheetOf(view, CLIPS), () => heading, 600).at(-1)!.facing,
			);
		t.same(
			'17. a heading is sampled as the view moves along it: top-down on its own axes, isometric on the 2:1 screen',
			[
				round({ kind: 'topDown', facings: 8 }),
				round({ kind: 'isometric', facings: 8 }),
				[45, 135, 225, 315].map(
					(heading) =>
						drive(sheetOf({ kind: 'isometric' }, CLIPS), () => heading, 600).at(-1)!.facing,
				),
			],
			[
				['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'],
				['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'],
				['ne', 'se', 'sw', 'nw'],
			],
		);

		const snap = drive(off, reversal, 2000);
		t.same(
			'17. off: turned about, the picture snaps from north to south, upright, in the walk',
			[facingsOf(snap), mostLean(snap), snap.at(-1)!.plays, 'clip' in snap.at(-1)!.frame],
			[['n', 's'], 0, 'hero_walk_s', true],
		);
		const swept = drive(on, reversal, 2000);
		const between = facingsOf(swept).slice(1, -1);
		const sweepMs =
			(swept.findIndex((r, i) => i > 70 && r.facing === 's' && Math.abs(r.lean) < 1e-6) -
				swept.findIndex((r) => r.facing !== 'n')) *
			FRAME_MS;
		t.check(
			'17. on: turned about, it sweeps through the three facings in between at the turn speed, leaning, and ends upright facing south',
			(text(between) === text(['ne', 'e', 'se']) || text(between) === text(['nw', 'w', 'sw'])) &&
				swept.at(-1)!.facing === 's' &&
				Math.abs(swept.at(-1)!.lean) < 1e-6 &&
				mostLean(swept) > 20 &&
				mostLean(swept) <= 22.5 + 1e-6 &&
				sweepMs > 300 &&
				sweepMs < 600,
			text([facingsOf(swept), mostLean(swept), sweepMs]),
		);
		const slow = drive(
			sheetOf({ kind: 'topDown', facings: 8, turn: { speed: 90 } }, CLIPS),
			reversal,
			2000,
		);
		const leanLess = drive(
			sheetOf({ kind: 'topDown', facings: 8, turn: { lean: 10 } }, CLIPS),
			reversal,
			2000,
		);
		const atOnce = drive(
			sheetOf({ kind: 'topDown', facings: 8, turn: { speed: 0 } }, CLIPS),
			(ms) => (ms / TURN_PREVIEW_CIRCLE_MS) * 360,
			TURN_PREVIEW_CIRCLE_MS,
		);
		t.check(
			'17. the sheet’s numbers are the animator’s: a slower turn is still on its way a second on, a smaller lean is held, and a speed of 0 leans with no sweep',
			slow.at(-1)!.facing !== 's' &&
				mostLean(leanLess) > 9 &&
				mostLean(leanLess) <= 10 + 1e-6 &&
				mostLean(atOnce) > 20 &&
				text(facingsOf(atOnce)) === text(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw', 'n']),
			text([slow.at(-1)!.facing, mostLean(leanLess), mostLean(atOnce), facingsOf(atOnce)]),
		);
		const circle = drive(on, (ms) => (ms / TURN_PREVIEW_CIRCLE_MS) * 360, TURN_PREVIEW_CIRCLE_MS);
		t.check(
			'17. the slow circle passes every facing in order, never leaning past half the angle between two',
			text(facingsOf(circle)) === text(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw', 'n']) &&
				mostLean(circle) <= 22.5 + 1e-6,
			text([facingsOf(circle), mostLean(circle)]),
		);

		const east = EVERY.filter((id) => !/_(w|sw|nw)$/.test(id));
		const west = drive(on, () => 280, 1500, east).at(-1)!;
		const eastward = drive(on, () => 80, 1500, east).at(-1)!;
		t.check(
			'17. a west facing with no art of its own is its east twin mirrored, and leans the way it heads (north of west, clockwise) as its twin does not',
			west.facing === 'w' &&
				west.plays === 'hero_walk_e' &&
				'clip' in west.frame &&
				west.frame.clip.flipX &&
				west.lean > 5 * DEG &&
				eastward.facing === 'e' &&
				eastward.lean < -5 * DEG,
			text([west.facing, west.plays, west.lean / DEG, eastward.lean / DEG]),
		);

		const still = { assetKey: 'art/hero', region: 'hero_n' };
		const stills = sheetOf({ kind: 'topDown', turn: {} }, { kind: 'stills' });
		stills.actions = [{ id: 'walk', when: { motion: 'moving' }, anim: { n: { still } } }];
		const drawnStill = drive(stills, () => 20, 800, []).at(-1);
		t.check(
			'17. a still image is there with no clip of the project, and leans as a clip does',
			drawnStill?.plays === 'still::art/hero::hero_n' && Math.abs(drawnStill.lean / DEG - 20) < 0.5,
			text([drawnStill?.plays, (drawnStill?.lean ?? 0) / DEG]),
		);
		const rigged = sheetOf({ kind: 'topDown', turn: {} }, { kind: 'rig', rig: 'heroRig' });
		const rigs = {
			has: (rig: string, animation: string) => rig === 'heroRig' && animation === 'walk',
			durationMs: () => 500,
		};
		const drawnRig = drive(rigged, () => 110, 800, [], rigs).at(-1);
		t.check(
			'17. a rig is read as `rig/animation`, with the frame the game’s look draws, lean and all',
			drawnRig?.plays === 'heroRig/walk' &&
				'rig' in drawnRig.frame &&
				drawnRig.frame.rig.lean === drawnRig.lean &&
				Math.abs(drawnRig.lean / DEG - 20) < 0.5,
			text([drawnRig?.plays, (drawnRig?.lean ?? 0) / DEG]),
		);
		t.same(
			'17. what the preview states: a lean in degrees to one decimal, a heading from north',
			[
				leanDegrees(22.5 * DEG),
				leanDegrees(-7.04 * DEG),
				leanDegrees(-0.0001),
				leanDegrees(0),
				headingDegrees(-90 * DEG),
				headingDegrees(725 * DEG),
			],
			['22.5', '-7.0', '0.0', '0.0', 270, 5],
		);
		const reach = { side: 32, up: 96, down: 0 };
		const stage8 = turnStageBox(on, reach);
		const stage4 = turnStageBox(sheetOf({ kind: 'topDown' }, CLIPS), reach);
		t.check(
			'17. the stage holds the character leaned either way by the most its view allows: the same on or off, wider for four facings, its place in the middle',
			text(stage8) === text(turnStageBox(off, reach)) &&
				stage8.width >= 2 * (32 * Math.cos(22.5 * DEG) + 96 * Math.sin(22.5 * DEG)) &&
				stage4.width > stage8.width &&
				stage8.placeX === stage8.width / 2 &&
				stage8.placeY >= 96 &&
				stage8.height >= stage8.placeY,
			text([stage8, stage4]),
		);
	}

	// ── a clip ready to draw: the directions preview's parts, shared ─────────────────────────
	{
		const art = sheetOf({ kind: 'topDown' }, CLIPS);
		const clip: FlipbookClip = {
			id: 'hero_walk_e',
			name: 'hero_walk_e',
			assetKey: 'art/hero',
			frames: ['a', 'b', 'gone'],
			fps: 8,
			flipX: true,
		};
		const set = {
			assetKey: 'art/hero',
			pageKey: 'art/hero.png',
			pageVersion: '',
			pageWidth: 256,
			pageHeight: 256,
			regions: [
				{ name: 'a', x: 0, y: 0, w: 100, h: 120, origW: 128, origH: 128, offX: 14, offY: 4 },
				{ name: 'b', x: 100, y: 0, w: 90, h: 110, origW: 128, origH: 128, offX: 20, offY: 10 },
			],
		};
		const drawing = clipDrawing(art, clip, { 'art/hero': set }, 1);
		const stage = clipStage(
			art,
			clip,
			[
				{ origW: 128, origH: 128, offX: 14, offY: 4, artW: 100, artH: 120 },
				{ origW: 128, origH: 128, offX: 20, offY: 10, artW: 90, artH: 110 },
			],
			1,
		)!;
		t.same(
			'17. a clip ready to draw: the stage’s size, a frame per authored frame (none for one not in its sheet), its feet under the middle of the box',
			[
				drawing.size,
				drawing.draws.map((d) => (d ? [d.record.name, d.feetX, d.feetY] : null)),
				drawing.walk,
				drawing.fps,
				drawing.problem,
				drawing.reach,
			],
			[
				Math.round(stage.scale * Math.max(stage.view.w, stage.view.h)),
				[['a', 32, 64], ['b', 32, 64], null],
				[0, 1, 2],
				8,
				'',
				{ side: 32, up: 64, down: 0 },
			],
		);
		t.same(
			'17. … nothing to draw before its sheet is read, a reason once it is and the frame is not in it; a clip’s own Mirror X turns the game’s mirror over',
			[
				[clipDrawing(art, clip, {}, 1).size, clipDrawing(art, clip, {}, 1).problem],
				clipDrawing(art, { ...clip, frames: ['gone'] }, { 'art/hero': set }, 1).problem,
				clipMirror(clip, true),
				clipMirror(clip, false),
				clipMirror({ flipY: true }, true),
			],
			[
				[0, ''],
				'Its first frame is not in its sheet.',
				{ sx: 1, sy: 1 },
				{ sx: -1, sy: 1 },
				{ sx: -1, sy: -1 },
			],
		);
	}

	// ── the card and the preview, as written ─────────────────────────────────────────────────
	const card = code('routes/(app)/characters/sheet/ViewCard.svelte');
	const preview = code('lib/characters/SheetTurnPreview.svelte');
	const rig = code('lib/characters/SheetTurnRig.svelte');
	const directions = code('lib/flipbook/CharacterDirections.svelte');
	const compiles = (name: string, source: string): boolean => {
		try {
			return compile(source, { filename: name, generate: 'client' }).js.code.length > 0;
		} catch {
			return false;
		}
	};
	const controls = [...card.matchAll(/<input\b(?:=>|[^>])*data-view-turn[\w-]*(?:=>|[^>])*>/g)].map(
		(m) => m[0],
	);
	t.same(
		'17. the View card: Smooth turn, Most lean and Turn speed, each an edit of the sheet and locked while the page is read-only (source text)',
		[
			controls.map((c) => /data-view-turn[\w-]*/.exec(c)?.[0]),
			controls.every((c) => /\bdisabled=\{readOnly\}/.test(c)),
			/sheets\.setViewTurn\(d, id, on\)/.test(card),
			/sheets\.setViewTurnLean\(d, id, value\)/.test(card),
			/sheets\.setViewTurnSpeed\(d, id, value\)/.test(card),
			/Smooth turn\s*<InfoTip>/.test(card),
			/Most lean \(°\)/.test(card) && /Turn speed \(°\/s\)/.test(card),
			(card.match(/<InfoTip>/g) ?? []).length,
		],
		[
			['data-view-turn', 'data-view-turn-lean', 'data-view-turn-speed'],
			true,
			true,
			true,
			true,
			true,
			true,
			4,
		],
	);
	t.check(
		'17. … the lean and the speed only while it is on, and for a view that cannot turn one line of status in their place, in the edit’s own words (source text)',
		/\{#if !turnNote\}[\s\S]*data-view-turn\b[\s\S]*\{#if turn\}[\s\S]*data-view-turn-lean[\s\S]*data-view-turn-speed[\s\S]*\{\/if\}\s*\{\/if\}/.test(
			card,
		) &&
			/\{#if turnNote\}<p class="status" data-view-turn-note>\{turnNote\}<\/p>\{\/if\}/.test(
				card,
			) &&
			/const turnNote = \$derived\(sheets\.turnNote\(view\)\);/.test(card) &&
			!/nothing to turn through|turns the model|to turn smoothly/.test(card),
	);
	t.check(
		'17. the card shows the character turning for a view that can, off or on, fed what the Actions card is (source text)',
		/\{#if sheet && !turnNote\}\s*<SheetTurnPreview \{sheet\} \{clipIds\} \{clips\} rigs=\{rigs\.facts\} load=\{rigs\.load\} \/>/.test(
			card,
		) &&
			/<ViewCard[\s\S]*?clipIds=\{read\.clipIds\}\s*clips=\{read\.clipById\}\s*\{rigs\}/.test(
				code('routes/(app)/characters/sheet/SheetCards.svelte'),
			),
	);
	t.check(
		'17. the preview asks the game’s animator a sample a frame, on one clock that stops when paused or off screen (source text)',
		compiles('SheetTurnPreview.svelte', preview) &&
			/animator\?\.read\(turnSample\(sheet, heading, at\)\)/.test(preview) &&
			/turnAnimator\(sheet, clipIds, rigSourceOf\(rigs\), facing\)/.test(preview) &&
			/if \(!playing \|\| !visible\) return;[\s\S]*?requestAnimationFrame\(tick\);[\s\S]*?return \(\) => cancelAnimationFrame\(raf\);/.test(
				preview,
			) &&
			(preview.match(/requestAnimationFrame\(/g) ?? []).length === 2 &&
			/new IntersectionObserver/.test(preview) &&
			/heading \+= Math\.PI;\s*playing = true;/.test(preview),
	);
	t.check(
		'17. … draws a clip with the directions preview’s parts, the lean a rotation about the place outside the mirror, and says what it draws on its root (source text)',
		/style:transform="rotate\(\{reading\?\.lean \?\? 0\}rad\)"\s*>\s*<div class="place" style:transform="scale\(\{mirror\.sx\}, \{mirror\.sy\}\)">/.test(
			preview,
		) &&
			/\.place \{[^}]*transform-origin: 0 0;/.test(preview) &&
			/<RegionThumb set=\{draw\.set\} region=\{draw\.record\} size=\{drawing\.size\} box=\{draw\.box\} \/>/.test(
				preview,
			) &&
			/clipDrawing\(sheet, clip, regionSets, 1\)/.test(preview) &&
			/clipMirror\(clip, clipFrame\.flipX\)/.test(preview) &&
			/data-turn-facing=\{reading\?\.facing \?\? ''\}\s*data-turn-lean=\{leanDegrees\(reading\?\.lean \?\? 0\)\}\s*data-turn-clip=\{reading\?\.plays \?\? ''\}/.test(
				preview,
			) &&
			/<IconButton\s+icon=\{playing \? 'pause' : 'play'\}/.test(preview) &&
			/<IconButton\s+icon="reverse"/.test(preview),
	);
	t.check(
		'17. … and a rig with the game’s own look, drawn when a frame is handed over (no ticker); the runtime and Pixi are fetched only for a rig sheet (source text)',
		compiles('SheetTurnRig.svelte', rig) &&
			/import\('\.\/SheetTurnRig\.svelte'\)/.test(preview) &&
			/import type SheetTurnRig from/.test(preview) &&
			!/^\s*import (?!type)[^;]*(rigLoad\.client|SheetTurnRig|from 'pixi\.js'|engine-rig|sheet-rig)/m.test(
				preview,
			) &&
			/import\('engine-layout\/sheet-rig'\)/.test(rig) &&
			/createSheetRigLook\(loaded\.name, loaded\.data, sheet\)/.test(rig) &&
			/look\.frame\(frame, atMs\);/.test(rig) &&
			/autoStart: false,/.test(rig) &&
			!/ticker/.test(rig),
	);
	t.check(
		'17. the directions preview draws through the same parts as before, now shared (source text)',
		compiles('CharacterDirections.svelte', directions) &&
			/clipDrawing\(art, clip, regionSets, zoom, candidate \?\? clip\.bounds\)/.test(directions) &&
			/noClipDrawing\(plays && !clip \? 'Its clip could not be read\.' : ''\)/.test(directions) &&
			/clipMirror\(clip, plays\.flipX\)/.test(directions) &&
			!/boxFit|applyClipBounds|clipStage/.test(directions.replace(/\/\*\*[\s\S]*?\*\//, '')),
	);
};
