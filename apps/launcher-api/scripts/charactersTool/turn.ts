/**
 * §17 of `check:characters-tool` — A SHEET'S SMOOTH TURN ON THE VIEW CARD (`view.turn`,
 * `docs/design/character-pipeline.md` §13). The edits (`characterSheetEdit.ts` `setViewTurn`,
 * `setViewTurnBlend`, `setViewTurnSpeed`, `setViewTurnLean`, `setViewTurnPivot`): sparse, refused
 * out of range, dropped by a side view and held in range by a change of facings, the lean's
 * default following the view's kind. The turn preview's driver (`sheetTurn.ts`) over the game's
 * own animator: off it snaps, on it sweeps through the facings in between, each change of picture
 * a blend of the two, and leans where the sheet has a lean. And the card and the preview as
 * written.
 */
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import {
	CLIP_FACINGS,
	fadeAlphas,
	frameKept,
	sheetClipPoints,
	sheetLeanPivot,
	type ClipFacing,
	type SheetClipFrame,
} from 'engine-layout';
import type { FlipbookClip } from 'engine-flipbook';
import {
	characterTurnOf,
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
	blendSays,
	createTurnClipLayers,
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

	// ── the blend, the pivot and the lean's default by the view's kind ───────────────────────
	{
		const doc = docOf({ kind: 'topDown' });
		t.same(
			'17. off: its blend and its pivot wait for it too',
			[sheet.setViewTurnBlend(doc, 'hero', '80'), sheet.setViewTurnPivot(doc, 'hero', 'feet')],
			['Turn Smooth turn on first.', 'Turn Smooth turn on first.'],
		);
		sheet.setViewTurn(doc, 'hero', true);
		sheet.setViewTurnBlend(doc, 'hero', '80');
		sheet.setViewTurnPivot(doc, 'hero', 'feet');
		t.same('17. a blend and a pivot that are not the defaults are stored', viewOf(doc), {
			kind: 'topDown',
			turn: { blend: 80, pivot: 'feet' },
		});
		t.same(
			'17. a blend out of range or not a number, and a pivot that is not one, are refused in words, and nothing changes',
			[
				sheet.setViewTurnBlend(doc, 'hero', '1001'),
				sheet.setViewTurnBlend(doc, 'hero', '-1'),
				sheet.setViewTurnBlend(doc, 'hero', 'slow'),
				sheet.setViewTurnPivot(doc, 'hero', 'head'),
				sheet.setViewTurnPivot(doc, 'hero', ''),
				viewOf(doc),
			],
			[
				'Blend is a number from 0 to 1000.',
				'Blend is a number from 0 to 1000.',
				'Blend is a number from 0 to 1000.',
				'A lean turns the picture about its middle or its feet.',
				'A lean turns the picture about its middle or its feet.',
				{ kind: 'topDown', turn: { blend: 80, pivot: 'feet' } },
			],
		);
		sheet.setViewTurnBlend(doc, 'hero', '0');
		t.same('17. a blend of 0 is a value: the picture changes at once', viewOf(doc), {
			kind: 'topDown',
			turn: { blend: 0, pivot: 'feet' },
		});
		sheet.setViewTurnBlend(doc, 'hero', '1000');
		t.same('17. … and so is the most', viewOf(doc)?.kind === 'topDown' && viewOf(doc), {
			kind: 'topDown',
			turn: { blend: 1000, pivot: 'feet' },
		});
		sheet.setViewTurnBlend(doc, 'hero', '160');
		sheet.setViewTurnPivot(doc, 'hero', 'middle');
		t.same('17. the blend’s default (160) and Middle typed are not stored', viewOf(doc), {
			kind: 'topDown',
			turn: {},
		});
		sheet.setViewTurnBlend(doc, 'hero', '300');
		sheet.setViewTurnBlend(doc, 'hero', ' ');
		t.same('17. … and a blank blend is the default', viewOf(doc), { kind: 'topDown', turn: {} });
		t.same('17. the pivot’s choices are the config’s, Middle first', sheet.TURN_PIVOT_OPTIONS, [
			{ value: 'middle', label: 'Middle' },
			{ value: 'feet', label: 'Feet' },
		]);

		t.same(
			'17. the lean of a turn that names none follows the view’s kind: half the angle between two facings seen from above, none on an isometric view (whose most is unchanged)',
			[
				sheet.turnLeanDefault({ kind: 'topDown' }),
				sheet.turnLeanDefault({ kind: 'topDown', facings: 8 }),
				sheet.turnLeanDefault({ kind: 'isometric' }),
				sheet.turnLeanDefault({ kind: 'isometric', facings: 8 }),
				sheet.turnLeanMax({ kind: 'isometric' }),
			],
			[45, 22.5, 0, 0, 45],
		);
		t.same(
			'17. the pivot matters only while the pictures lean: a top-down turn, an isometric one given a lean; not an isometric turn at its defaults, a lean of 0, or no turn',
			[
				sheet.turnLeans({ kind: 'topDown', turn: {} }),
				sheet.turnLeans({ kind: 'isometric', turn: { lean: 5 } }),
				sheet.turnLeans({ kind: 'isometric', turn: {} }),
				sheet.turnLeans({ kind: 'topDown', turn: { lean: 0 } }),
				sheet.turnLeans({ kind: 'topDown' }),
				sheet.turnLeans(undefined),
			],
			[true, true, false, false, false, false],
		);

		// A sheet saved with the option on, before the blend: `turn: {}` on an isometric view.
		const saved = docOf({ kind: 'isometric', turn: {} });
		const read = characterTurnOf(viewOf(saved));
		t.same(
			'17. a saved `turn: {}` on an isometric view reads no lean, a blend of 160 about its middle, and is stored as it was',
			[read?.lean, read?.blend, read?.pivot, read?.speed, viewOf(saved)],
			[0, 160, 'middle', 360, { kind: 'isometric', turn: {} }],
		);
		sheet.setViewTurnLean(saved, 'hero', '0');
		sheet.setViewTurnBlend(saved, 'hero', '160');
		sheet.setViewTurnPivot(saved, 'hero', 'middle');
		sheet.setViewTurnSpeed(saved, 'hero', '360');
		t.same('17. … and its defaults typed leave it `{}`', viewOf(saved), {
			kind: 'isometric',
			turn: {},
		});
		sheet.setViewTurnLean(saved, 'hero', '45');
		t.same(
			'17. on an isometric view half the angle is a lean like another: stored',
			viewOf(saved),
			{
				kind: 'isometric',
				turn: { lean: 45 },
			},
		);
		t.same(
			'17. … past it is refused, and a blank lean is none again',
			[
				sheet.setViewTurnLean(saved, 'hero', '45.5'),
				sheet.setViewTurnLean(saved, 'hero', ''),
				viewOf(saved),
			],
			['Most lean is a number from 0 to 45.', null, { kind: 'isometric', turn: {} }],
		);
		sheet.setViewTurnLean(saved, 'hero', '6');
		sheet.setViewTurnPivot(saved, 'hero', 'feet');
		sheet.setViewTurnBlend(saved, 'hero', '240');
		sheet.setViewKind(saved, 'hero', 'topDown');
		t.same('17. isometric to top-down keeps the blend, the lean and the pivot', viewOf(saved), {
			kind: 'topDown',
			turn: { blend: 240, lean: 6, pivot: 'feet' },
		});
		sheet.setViewTurnLean(saved, 'hero', '0');
		sheet.setViewKind(saved, 'hero', 'isometric');
		t.same(
			'17. a lean of 0 stored on a top-down view is the default of an isometric one: no longer stored',
			viewOf(saved),
			{ kind: 'isometric', turn: { blend: 240, pivot: 'feet' } },
		);
		t.check(
			'17. what is stored of the blend and the pivot is what the normalizer stores, and the save’s validator says nothing of it',
			text(normalizeCharacterSheet(findCharacter(saved, 'hero'))) ===
				text(sheet.sheetOf(saved, 'hero')) &&
				!validateCharacterSheets(saved).some((issue) => issue.path.includes('.view')),
			text(validateCharacterSheets(saved)),
		);
		sheet.setViewTurn(saved, 'hero', false);
		t.same('17. off forgets the blend and the pivot', viewOf(saved), { kind: 'isometric' });
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

	// ── the blend in the preview: the readings, and the frames two clips are on ──────────────
	{
		const iso = sheetOf({ kind: 'isometric', turn: {} }, CLIPS);
		const top = sheetOf({ kind: 'topDown', facings: 8, turn: {} }, CLIPS);
		const blends = (readings: readonly TurnReading[]) => readings.filter((r) => r.blend);
		const isoTurn = drive(iso, (ms) => (ms < 1000 ? 45 : 225), 2000);
		const isoBlends = blends(isoTurn);
		t.check(
			'17. an isometric sheet with the option on at its defaults: turned about it never leans, and each change of picture is a blend from the picture left, its weight rising to the picture taken',
			mostLean(isoTurn) === 0 &&
				facingsOf(isoTurn).length > 2 &&
				isoBlends.length >= 9 &&
				isoBlends.every(
					(r) =>
						'clip' in r.frame &&
						r.blend!.from === r.frame.clip.blend?.from.clipId &&
						r.blend!.weight === r.frame.clip.blend.weight &&
						r.blend!.from !== r.plays &&
						r.blend!.weight >= 0 &&
						r.blend!.weight <= 1,
				) &&
				isoBlends.some((r) => r.blend!.weight > 0.9) &&
				isoBlends.some((r) => r.blend!.weight < 0.2) &&
				!isoTurn.at(-1)!.blend,
			text([facingsOf(isoTurn), mostLean(isoTurn), isoBlends.length]),
		);
		const first = isoTurn.findIndex((r) => r.blend);
		const run = isoTurn.slice(first).findIndex((r) => r.blend?.from !== isoTurn[first].blend!.from);
		const weights = isoTurn.slice(first, first + run).map((r) => r.blend!.weight);
		t.check(
			'17. … one blend lasts the sheet’s 160 ms and never goes back',
			Math.abs(run * FRAME_MS - 160) <= FRAME_MS &&
				weights.every((w, i) => i === 0 || w >= weights[i - 1]),
			text([run * FRAME_MS, weights]),
		);
		const longer = drive(
			sheetOf({ kind: 'isometric', turn: { blend: 480, speed: 0 } }, CLIPS),
			(ms) => (ms < 1000 ? 45 : 135),
			2000,
		);
		t.check(
			'17. the sheet’s blend is the animator’s: 480 ms is three times as many frames of two pictures; 0, and the option off, draw one picture throughout',
			Math.abs(blends(longer).length * FRAME_MS - 480) <= FRAME_MS &&
				blends(drive(sheetOf({ kind: 'isometric', turn: { blend: 0 } }, CLIPS), reversal, 2000))
					.length === 0 &&
				blends(drive(sheetOf({ kind: 'isometric' }, CLIPS), reversal, 2000)).length === 0,
			text([blends(longer).length]),
		);
		const topBlend = blends(drive(top, reversal, 2000));
		t.check(
			'17. a top-down sheet blends too, each picture at its own lean',
			topBlend.length > 0 &&
				topBlend.some(
					(r) =>
						'clip' in r.frame &&
						Math.abs((r.frame.clip.blend?.from.lean ?? 0) - r.lean) > 1e-3 &&
						Math.abs(r.lean) > 1e-3,
				),
			text(topBlend.length),
		);
		const rigs = {
			has: (rig: string, animation: string) => rig === 'heroRig' && animation.startsWith('walk'),
			durationMs: () => 500,
		};
		const rigged = sheetOf({ kind: 'isometric', turn: {} }, { kind: 'rig', rig: 'heroRig' });
		rigged.actions = [
			{
				id: 'walk',
				when: { motion: 'moving' },
				anim: Object.fromEntries(
					(['ne', 'se', 'sw', 'nw'] as const).map((f) => [f, { anim: `walk_${f}` }]),
				),
			},
		];
		const rigBlend = blends(drive(rigged, reversal, 2000, [], rigs));
		t.check(
			'17. a rig’s blend is read as `rig/animation`, and its frame carries it to the game’s look',
			rigBlend.length > 0 &&
				rigBlend.every(
					(r) =>
						'rig' in r.frame &&
						r.blend!.from === `heroRig/${r.frame.rig.blend?.from.animation}` &&
						r.blend!.from !== r.plays,
				),
			text(rigBlend[0]?.blend),
		);
		t.same(
			'17. what the preview states of a blend: the picture left and the weight to two decimals, nothing while one picture is drawn',
			[
				blendSays({ ...isoTurn[first], blend: { from: 'hero_walk_ne', weight: 0.4567 } }),
				blendSays(isoTurn.at(-1)),
				blendSays(undefined),
			],
			['hero_walk_ne 0.46', '', ''],
		);

		// The frames two clips are on, on the preview's own clock.
		const frameOf = (clipId: string, more: Partial<SheetClipFrame> = {}): SheetClipFrame => ({
			clipId,
			flipX: false,
			loop: true,
			play: 0,
			marked: false,
			action: 'walk',
			variant: undefined,
			...more,
		});
		const cycles: Record<string, { count: number; fps: number }> = {
			a: { count: 8, fps: 10 },
			b: { count: 4, fps: 10 },
			once: { count: 3, fps: 10 },
		};
		const cycleOf = (id: string) => cycles[id];
		const layers = createTurnClipLayers();
		const a = frameOf('a');
		const mix = (weight: number, from = a, to = 'b'): SheetClipFrame =>
			frameOf(to, { lean: 0.2, blend: { from, weight, leftMs: 0, pose: false } });
		t.same(
			'17. one clip: it starts at its first frame, plays at its own rate and comes round; nothing is drawn before its frames are known',
			[
				[0, 99, 100, 650, 800].map((at) => layers.read(a, at, cycleOf)),
				createTurnClipLayers().read(frameOf('unread'), 0, cycleOf),
				createTurnClipLayers().read(undefined, 0, cycleOf),
			],
			[
				[0, 0, 1, 6, 0].map((step) => ({
					front: { clipId: 'a', flipX: false, lean: 0, step, alpha: 1 },
				})),
				undefined,
				undefined,
			],
		);
		// `a` is on frame 6 of 8 at 1450: `b`, of 4, starts three quarters through, on frame 3.
		const taken = layers.read(mix(0.25), 1450, cycleOf)!;
		t.same(
			'17. two clips mixed: the one left is drawn under the one taken, cross-faded as the game fades them, and the one taken starts at the phase the other had reached',
			[taken, frameKept(6, 8, 4), fadeAlphas(0.25)],
			[
				{
					front: { clipId: 'b', flipX: false, lean: 0.2, step: 3, alpha: 0.5 },
					back: { clipId: 'a', flipX: false, lean: 0, step: 6, alpha: 1 },
				},
				3,
				{ from: 1, to: 0.5 },
			],
		);
		const later = layers.read(mix(0.75), 1550, cycleOf)!;
		t.same(
			'17. … both play on, each at its own rate',
			[later.front.step, later.back?.step, later.front.alpha, later.back?.alpha],
			[0, 7, 1, 0.5],
		);
		// Turned back at 1650: `a` (on frame 0 by now) is the picture taken, `b` (on 1) the one left.
		const back = layers.read(mix(0.4, frameOf('b', { lean: 0.2 }), 'a'), 1650, cycleOf)!;
		t.same(
			'17. … turned back, the two change places and neither starts again',
			[back.front.clipId, back.front.step, back.back?.clipId, back.back?.step],
			['a', 0, 'b', 1],
		);
		const done = layers.read(a, 1750, cycleOf)!;
		t.same('17. … and when the blend ends the clip taken plays on alone', done, {
			front: { clipId: 'a', flipX: false, lean: 0, step: 1, alpha: 1 },
		});
		const once = createTurnClipLayers();
		const shot = frameOf('once', { loop: false, play: 1 });
		t.same(
			'17. a clip not looped stays on its last frame, and starts again when it is played again',
			[
				[0, 150, 900].map((at) => once.read(shot, at, cycleOf)?.front.step),
				once.read({ ...shot, play: 2 }, 950, cycleOf)?.front.step,
			],
			[[0, 1, 2], 0],
		);
		const unread = createTurnClipLayers();
		unread.read(a, 0, cycleOf);
		t.same(
			'17. a clip left whose frames are not read yet is not drawn, and the clip taken is drawn whole, carrying on from the clip drawn before',
			unread.read(mix(0.25, frameOf('unread')), 300, cycleOf),
			{ front: { clipId: 'b', flipX: false, lean: 0.2, step: 1, alpha: 1 } },
		);

		const reach = { side: 32, up: 96, down: 0 };
		const feet = turnStageBox(top, reach);
		const middle = turnStageBox(top, reach, 48);
		const half = 22.5 * DEG;
		t.check(
			'17. the stage holds the character leaned about its middle too (its head rises further than about its feet), whatever pivot the sheet names',
			middle.placeY >= 48 + 48 * Math.cos(half) + 32 * Math.sin(half) &&
				middle.placeY > feet.placeY &&
				middle.width >= feet.width &&
				middle.height - middle.placeY >= 32 * Math.sin(half) - 48 * (1 - Math.cos(half)),
			text([feet, middle]),
		);
		const tall = { w: 64, h: 128 };
		t.same(
			'17. the pivot the preview turns a clip about is the game’s: the middle of its box above its place, or its place for a sheet that names its feet, and none with the option off',
			[
				sheetLeanPivot(sheetOf({ kind: 'topDown', turn: {} }, CLIPS), tall),
				sheetLeanPivot(sheetOf({ kind: 'topDown', turn: { pivot: 'feet' } }, CLIPS), tall),
				sheetLeanPivot(sheetOf({ kind: 'topDown' }, CLIPS), tall),
				sheetClipPoints(sheetOf({ kind: 'topDown' }, CLIPS), tall, false).middle,
			],
			[64, 0, 0, 64],
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
		'17. the View card: Smooth turn, then Blend, Turn speed, Most lean and Lean pivot, each an edit of the sheet and locked while the page is read-only (source text)',
		[
			controls.map((c) => /data-view-turn[\w-]*/.exec(c)?.[0]),
			controls.every((c) => /\bdisabled=\{readOnly\}/.test(c)),
			/sheets\.setViewTurn\(d, id, on\)/.test(card),
			/sheets\.setViewTurnLean\(d, id, value\)/.test(card),
			/sheets\.setViewTurnSpeed\(d, id, value\)/.test(card),
			/sheets\.setViewTurnBlend\(d, id, value\)/.test(card),
			/sheets\.setViewTurnPivot\(d, id, pivot\)/.test(card),
			/Smooth turn\s*<InfoTip>/.test(card),
			[...card.matchAll(/>(Blend \(ms\)|Turn speed \(°\/s\)|Most lean \(°\)|Lean pivot)\s/g)].map(
				(m) => m[1],
			),
			(card.match(/<InfoTip>/g) ?? []).length,
		],
		[
			['data-view-turn', 'data-view-turn-blend', 'data-view-turn-speed', 'data-view-turn-lean'],
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			['Blend (ms)', 'Turn speed (°/s)', 'Most lean (°)', 'Lean pivot'],
			6,
		],
	);
	t.check(
		'17. … the lean’s placeholder is its view’s default and its tip says, on an isometric view only, why that is none; the pivot is a choice of the config’s two, locked while nothing leans; the blend’s placeholder and range are the config’s (source text)',
		/data-view-turn-lean\s+value=\{turn\.lean \?\? ''\}\s+placeholder=\{String\(leanDefault\)\}/.test(
			card,
		) &&
			/const leanDefault = \$derived\(sheets\.turnLeanDefault\(view\)\);/.test(card) &&
			/\{#if view\?\.kind === 'isometric'\}\s*Empty is 0: an upright character seen in three-quarter view turns about its own\s+height, and a lean tips its picture over\.[^{]*subjects seen from above[^{]*\{:else\}\s*Empty is \{leanDefault\}/.test(
				card,
			) &&
			/<select\s+data-view-turn-pivot\s+value=\{turn\.pivot \?\? 'middle'\}\s+disabled=\{readOnly \|\| !leans\}/.test(
				card,
			) &&
			/const leans = \$derived\(sheets\.turnLeans\(view\)\);/.test(card) &&
			/\{#each sheets\.TURN_PIVOT_OPTIONS as option \(option\.value\)\}/.test(card) &&
			/max=\{CHARACTER_TURN_BLEND_MAX\}[\s\S]*?data-view-turn-blend\s+value=\{turn\.blend \?\? ''\}\s+placeholder=\{String\(CHARACTER_TURN_BLEND\)\}/.test(
				card,
			) &&
			!/<p(?![^>]*class="(status|err|note)")[^>]*>[^<]*(lean|blend)/i.test(
				card.slice(card.indexOf('<div class="fields">')),
			),
	);
	t.check(
		'17. … its four fields only while it is on, and for a view that cannot turn one line of status in their place, in the edit’s own words (source text)',
		/\{#if !turnNote\}[\s\S]*data-view-turn\b[\s\S]*\{#if turn\}[\s\S]*data-view-turn-blend[\s\S]*data-view-turn-speed[\s\S]*data-view-turn-lean[\s\S]*data-view-turn-pivot[\s\S]*\{\/if\}\s*\{\/if\}/.test(
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
		'17. … draws a clip with the directions preview’s parts, the lean a rotation about the sheet’s pivot outside the mirror, and says what it draws on its root (source text)',
		/style:opacity=\{piece\.alpha\}\s*style:transform="translateY\(\{-about\}px\) rotate\(\{piece\.lean\}rad\) translateY\(\{about\}px\)"\s*>\s*<div class="place" style:transform="scale\(\{piece\.mirror\.sx\}, \{piece\.mirror\.sy\}\)">/.test(
			preview,
		) &&
			/\.place \{[^}]*transform-origin: 0 0;/.test(preview) &&
			/<RegionThumb\s+set=\{piece\.draw\.set\}\s+region=\{piece\.draw\.record\}\s+size=\{piece\.size\}\s+box=\{piece\.draw\.box\}\s+\/>/.test(
				preview,
			) &&
			/clipDrawing\(sheet, clip, regionSets, 1\)/.test(preview) &&
			/clipMirror\(its, layer\.flipX\)/.test(preview) &&
			/const about = \$derived\(box \? sheetLeanPivot\(sheet, box\) : 0\);/.test(preview) &&
			/data-turn-facing=\{reading\?\.facing \?\? ''\}\s*data-turn-lean=\{leanDegrees\(reading\?\.lean \?\? 0\)\}\s*data-turn-clip=\{reading\?\.plays \?\? ''\}\s*data-turn-blend=\{blendSays\(reading\)\}/.test(
				preview,
			) &&
			/<IconButton\s+icon=\{playing \? 'pause' : 'play'\}/.test(preview) &&
			/<IconButton\s+icon="reverse"/.test(preview),
	);
	t.check(
		'17. … while two clips are mixed the one left is drawn under the one taken, each on the frame of the clock’s layers, its sheet read like the other’s (source text)',
		/const shown = \$derived\(layers\.read\(clipFrame, clock, cycleOf\)\);/.test(preview) &&
			/const leftId = \$derived\(clipFrame\?\.blend\?\.from\.clipId\);/.test(preview) &&
			/\.\.\.piece\(shown\?\.back, leftDrawing, left\),\s*\.\.\.piece\(shown\?\.front, drawing, clip\)/.test(
				preview,
			) &&
			/for \(const each of \[clip, left, \.\.\.round\]/.test(preview) &&
			/\{#each pieces as piece, at \(at\)\}/.test(preview),
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
