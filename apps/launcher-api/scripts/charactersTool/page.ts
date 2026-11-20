/**
 * 15. THE CARDS OF A RIG AND OF STILL IMAGES, AS WIRED (character pipeline C6b). The cards hold no
 * logic, so what they show and write is decided here: what the rig cards list
 * (`characterSheetRigCard.ts`), the cell editors' values and their Replace, the region picker's
 * pick as a still image, the stills the Directions preview draws, the words of a fill and of an
 * add, a rig's cost line, and the project's sheets on the page's one read
 * (`GET /api/characters/whole`, driven for real over the gate's in-memory R2). Then the source
 * text of the cards: one picker, one grid shell, the preview fetched lazily.
 *
 * `tools/rigger-spike/characters-page-browser.mjs` drives the same cards in a browser.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isHttpError } from '@sveltejs/kit';
import type { FlipbookClip } from 'engine-flipbook';
import {
	normalizeCharacterSheet,
	normalizeGameConfigDoc,
	withCharacterSheets,
	type CharacterSheet,
	type GameConfigDoc,
} from 'game-config';
import {
	addedNote,
	characterNamePlanText,
	looksAfterAdd,
	type AddCharacterResult,
	type ListedLook,
} from '../../src/lib/characters/characterAdd.ts';
import { sheetOf } from '../../src/lib/characters/characterSheetEdit.ts';
import { SOURCE_NOT_CHOSEN, sourceChoiceHint } from '../../src/lib/characters/characterWhole.ts';
import {
	applyFill,
	fillDoneText,
	fillFromNames,
	fillSourceOf,
	sheetReadFailed,
	startStillsCharacter,
	startStillsText,
} from '../../src/lib/characters/characterSheetFill.ts';
import {
	SHEET_CARD_TITLES,
	needsReplace,
	parseSheetQuery,
	pickOfValue,
	setCellValue,
	sheetCardLink,
	stillOfPick,
} from '../../src/lib/characters/characterSheetPage.ts';
import {
	BONE_POINT_READ,
	RIG_CELL_MARKS,
	animationLabel,
	bonePointRows,
	rigCellDefault,
	rigCellLook,
	rigCellRig,
	rigCellSays,
	rigCellStored,
	rigCellTitle,
	rigCellValue,
	rigsReading,
	rigsShown,
	sheetBones,
	sheetSkins,
} from '../../src/lib/characters/characterSheetRigCard.ts';
import { rigGrid, type RigGridCell } from '../../src/lib/characters/characterSheetRigGrid.ts';
import {
	RIG_COST_LEVEL_LABELS,
	rigCostLine,
	rigCostVerdict,
} from '../../src/lib/characters/rigCost.ts';
import type { RigFacts } from '../../src/lib/characters/rigFacts.ts';
import { NO_SOURCE_YET, SOURCE_KINDS } from '../../src/lib/characters/sheetCore.ts';
import { clipsWithStills } from '../../src/lib/flipbook/characterSet.ts';
import type { Section } from './harness';
import { standIns, withServerLog } from './routeStandIns.ts';

const src = (rel: string): string => new URL(`../../src/${rel}`, import.meta.url).href;
const code = (rel: string): string => readFileSync(fileURLToPath(src(rel)), 'utf8');

const KEY = 'acme/cloud/sheets/trial/atlas_manifest_trial.json';
const sheetOfRaw = (raw: unknown): CharacterSheet => normalizeCharacterSheet(raw) as CharacterSheet;
const facts = (
	name: string,
	animations: [string, number][],
	skins: string[] = [],
	bones: string[] = [],
): RigFacts => ({
	name,
	animations: animations.map(([n, durationMs]) => ({ name: n, durationMs })),
	skins,
	bones,
	cost: { drawCalls: 1, blendSwitches: 0, darkTintSlots: 0, drawnSlots: 1, bones: bones.length },
});
const OTTER = facts('otter', [['idle', 1500]], ['default', 'gold'], ['root', 'hand_r']);
const BACK = facts('back', [['turn', 0]], ['gold', 'winter'], ['root', 'tail_1']);
const TAIL = facts('tail', [['wag', 400]], ['stripes'], ['tip']);
const rigSheet = (): CharacterSheet =>
	sheetOfRaw({
		view: { kind: 'isometric' },
		source: { kind: 'rig', rig: 'otter', rigs: { ne: 'back' }, variants: { marked: 'gold' } },
		draw: {
			width: 64,
			points: { hand: { x: 0.4, y: 0.6 }, head: { x: 0.5, y: 0.1 } },
			bones: { hand: 'hand_r', tail: 'tail_1' },
		},
		actions: [
			{ id: 'idle', when: { motion: 'still' } },
			{ id: 'wag', anim: { se: { anim: 'wag', rig: 'tail' } } },
		],
	});
const docOf = (sheet: unknown): GameConfigDoc => {
	const raw = {
		family: 'arcade',
		outcome: 'rules',
		arcade: {
			field: { w: 2000, h: 1200 },
			bodies: { look: { shape: 'circle', r: 20 } },
			characters: [{ id: 'hero', component: 'look', ...(sheet as object) }],
		},
	};
	return withCharacterSheets(normalizeGameConfigDoc(raw) as GameConfigDoc, raw);
};
const cell = (over: Partial<RigGridCell>): RigGridCell => ({
	state: 'walk',
	facing: 'se',
	drawn: true,
	looksFor: [],
	how: 'none',
	flipX: false,
	...over,
});

export const run: Section = async (t) => {
	// ── what the rig cards list ───────────────────────────────────────────────────────────────
	const sheet = rigSheet();
	t.same(
		'15. the rigs a sheet names, each with what the page has read: read, being read, or why not',
		rigsShown(sheet, { otter: OTTER }, { tail: 'gone' }),
		[
			{ name: 'otter', state: 'read', facts: OTTER },
			{ name: 'back', state: 'reading' },
			{ name: 'tail', state: 'failed', why: 'gone' },
		],
	);
	t.same(
		'15. a rig being read is said: no rig, all read, one missing, one failed, a sheet that is not a rig',
		[
			rigsReading(sheet, {}),
			rigsReading(sheet, { otter: OTTER, back: BACK, tail: TAIL }),
			rigsReading(sheet, { otter: OTTER, back: BACK }),
			rigsReading(sheet, { otter: OTTER, back: BACK }, { tail: 'gone' }),
			rigsReading(sheetOfRaw({ source: { kind: 'stills' } }), {}),
			rigsShown(undefined, {}),
		],
		[true, false, true, false, false, []],
	);
	t.same(
		'15. the skins and bones a picker offers are those of the source’s rigs that are read (not a cell’s), each once',
		[
			sheetSkins(sheet, { otter: OTTER, back: BACK, tail: TAIL }),
			sheetBones(sheet, { otter: OTTER, back: BACK, tail: TAIL }),
			sheetSkins(sheet, { back: BACK }),
			sheetBones(sheet, {}),
			sheetSkins(sheetOfRaw({ source: { kind: 'clips', prefix: 'p' } }), { otter: OTTER }),
		],
		[['default', 'gold', 'winter'], ['root', 'hand_r', 'tail_1'], ['gold', 'winter'], [], []],
	);
	t.same(
		'15. the bone pickers: every point of the box, every other point a bone is stored for, and always the hand, the one the game reads',
		[
			bonePointRows(sheet),
			bonePointRows(sheetOfRaw({ source: { kind: 'rig', rig: 'otter' }, draw: { width: 10 } })),
			BONE_POINT_READ,
		],
		[
			[
				{ point: 'hand', bone: 'hand_r', onBox: true, read: true },
				{ point: 'head', onBox: true, read: false },
				{ point: 'tail', bone: 'tail_1', onBox: false, read: false },
			],
			[{ point: 'hand', onBox: false, read: true }],
			'hand',
		],
	);
	t.same(
		'15. an animation in a picker: its length in seconds, or that it is a pose',
		[
			animationLabel({ name: 'walk', durationMs: 800 }),
			animationLabel({ name: 'walk', durationMs: 1234 }),
			animationLabel({ name: 'walk', durationMs: 2000 }),
			animationLabel({ name: 'stand', durationMs: 0 }),
		],
		['walk (0.8 s)', 'walk (1.23 s)', 'walk (2 s)', 'stand (a pose)'],
	);

	// ── a cell of the rig grid ────────────────────────────────────────────────────────────────
	t.same(
		'15. a rig cell’s look is the clips grid’s: made, mirrored, a stand-in, nothing',
		[
			cell({ how: 'none' }),
			cell({ how: 'cell' }),
			cell({ how: 'byName' }),
			cell({ how: 'byName', flipX: true, facing: 'sw' }),
			cell({ how: 'standIn', flipX: true, facing: 'sw', from: 'se' }),
			cell({ how: 'standIn', flipX: false, facing: 'ne', from: 'se' }),
			cell({ how: 'standIn', flipX: true, facing: 'nw', from: 'se' }),
			cell({ how: 'fallback', flipX: true, action: 'idle' }),
		].map(rigCellLook),
		['none', 'made', 'made', 'mirrored', 'mirrored', 'standIn', 'standIn', 'standIn'],
	);
	t.same('15. … and its glyph', RIG_CELL_MARKS, {
		made: '✓',
		mirrored: '⇋',
		standIn: '≈',
		none: '—',
	});
	const grid = rigGrid(sheet, { otter: OTTER, back: BACK, tail: TAIL });
	const at = (state: string, facing: string): RigGridCell =>
		grid.rows.find((row) => row.state === state)!.cells.find((c) => c.facing === facing)!;
	t.same(
		'15. over the game’s own grid: the one rig mirrored west, a facing’s rig as made, a named cell',
		[
			grid.rows[0].cells.map((c) => [c.facing, rigCellLook(c)]),
			rigCellLook(at('wag', 'se')),
			at('wag', 'se').how,
		],
		[
			[
				['ne', 'made'],
				['se', 'made'],
				['sw', 'mirrored'],
				['nw', 'mirrored'],
			],
			'made',
			'cell',
		],
	);
	t.same(
		'15. what an empty cell looks for, in the game’s order; nothing for a named cell or with no rig asked',
		[
			rigCellDefault(at('idle', 'se')),
			rigCellDefault(at('idle', 'ne')),
			rigCellDefault(at('wag', 'se')),
			rigCellDefault(cell({ looksFor: ['walk_se'] })),
			rigCellDefault(cell({ looksOn: 'otter' })),
		],
		['idle_se, then idle on otter', 'idle_ne, then idle on back', '', '', ''],
	);
	t.same(
		'15. a cell in a sentence: what it looks for and what the game draws',
		[
			rigCellTitle(at('idle', 'se')),
			rigCellTitle(at('idle', 'sw')),
			rigCellSays(at('wag', 'se')),
			rigCellSays(cell({ unread: 'Clip: fox_idle_se', looksOn: 'otter', looksFor: ['walk_se'] })),
			rigCellSays(cell({})),
		],
		[
			'idle, facing se. By name: idle_se, then idle on otter. Draws idle (otter), by name.',
			'idle, facing sw. By name: idle_sw, then idle on otter. Draws idle (otter), mirrored, by name.',
			'Named here: wag on tail. Draws wag (tail), named here.',
			'Holds a clip: fox_idle_se, which a rig does not draw. Nothing is drawn: the look’s own animation shows.',
			'No rig is asked for this facing. Nothing is drawn: the look’s own animation shows.',
		],
	);
	t.same(
		'15. a cell that draws nothing while a rig is being read says so, not "nothing"',
		[
			rigCellSays(rigGrid(sheet, {}).rows[0].cells[1], true),
			rigCellTitle(rigGrid(sheet, {}).rows[0].cells[1], true).startsWith('idle, facing se. '),
			rigCellSays(at('idle', 'se'), true),
		],
		[
			'By name: idle_se, then idle on otter. Reading the rig…',
			true,
			'By name: idle_se, then idle on otter. Draws idle (otter), by name.',
		],
	);
	t.same(
		'15. the rig a cell’s picker lists: the one picked, else the cell’s, else the facing’s',
		[
			rigCellRig(at('wag', 'se'), 'back'),
			rigCellRig(at('wag', 'se')),
			rigCellRig(at('idle', 'ne')),
			rigCellRig(cell({})),
		],
		['back', 'tail', 'back', undefined],
	);
	t.same(
		'15. a rig cell’s value: an animation, on another rig when one is picked; no animation empties the cell, and a rig alone is not stored',
		[
			rigCellValue('wag'),
			rigCellValue(' wag ', ' tail '),
			rigCellValue('', 'tail'),
			rigCellStored({ kind: 'rig', anim: 'wag', rig: 'tail' }),
			rigCellStored({ kind: 'rig', anim: 'wag' }),
			rigCellStored({ kind: 'clip', clip: 'c' }),
			rigCellStored(undefined),
		],
		[
			{ kind: 'rig', anim: 'wag' },
			{ kind: 'rig', anim: 'wag', rig: 'tail' },
			undefined,
			{ animation: 'wag', rig: 'tail' },
			{ animation: 'wag' },
			undefined,
			undefined,
		],
	);
	{
		const doc = docOf(rigSheet());
		const value = rigCellValue('idle', 'back');
		t.same(
			'15. … and it is the value the sheet stores and reads back',
			[setCellValue(doc, 'hero', 'idle', 'ne', value), sheetOf(doc, 'hero')?.actions?.[0].anim],
			[null, { ne: { anim: 'idle', rig: 'back' } }],
		);
	}

	// ── Replace, and a pick as a still image ──────────────────────────────────────────────────
	const mixed = sheetOfRaw({
		source: { kind: 'clips', prefix: 'fox' },
		actions: [
			{
				id: 'idle',
				anim: { se: { clip: 'fox_look' }, ne: { still: { assetKey: KEY, region: 'a' } } },
			},
		],
	});
	const still = { kind: 'still' as const, assetKey: KEY, region: 'b' };
	t.same(
		'15. Replace is asked for only when a value of another kind is written over',
		[
			needsReplace(mixed, 'idle', 'se', still),
			needsReplace(mixed, 'idle', 'se', { kind: 'clip', clip: 'other' }),
			needsReplace(mixed, 'idle', 'ne', still),
			needsReplace(mixed, 'idle', 'ne', { kind: 'clip', clip: 'other' }),
			needsReplace(mixed, 'idle', 'sw', still),
			needsReplace(mixed, 'idle', 'se', undefined),
			needsReplace(undefined, 'idle', 'se', still),
		],
		[true, false, false, true, false, false, false],
	);
	{
		const doc = docOf(mixed);
		t.same(
			'15. … which is when the write refuses without it, and writes with it',
			[
				typeof setCellValue(doc, 'hero', 'idle', 'se', still),
				setCellValue(doc, 'hero', 'idle', 'se', still, { replace: true }),
				sheetOf(doc, 'hero')?.actions?.[0].anim?.se,
			],
			['string', null, { still: { assetKey: KEY, region: 'b' } }],
		);
	}
	t.same(
		'15. the region picker’s scoped pick is a still image by its manifest key; a cleared or a bare pick is none',
		[
			stillOfPick(`${KEY}::bear_idle_ne`),
			stillOfPick(''),
			stillOfPick('bear_idle_ne'),
			pickOfValue(still),
			pickOfValue({ kind: 'clip', clip: 'c' }),
			pickOfValue(undefined),
			stillOfPick(pickOfValue(still)),
		],
		[
			{ kind: 'still', assetKey: KEY, region: 'bear_idle_ne' },
			undefined,
			undefined,
			`${KEY}::b`,
			'',
			'',
			still,
		],
	);
	{
		const link = sheetCardLink('bearBot', 'source', 'p1');
		const doc = docOf({});
		t.same(
			'15. the Whole view’s link to the choice is the link the page opens a card from',
			[
				link,
				sheetCardLink('hero', 'draw'),
				parseSheetQuery(
					new URL(`https://x${sheetCardLink('hero', 'source', 'p1')}`).searchParams,
					doc,
				),
			],
			[
				'/characters?character=bearBot&card=source&project=p1',
				'/characters?character=hero&card=draw',
				{ characterId: 'hero', card: 'source' },
			],
		);
	}
	t.same(
		'15. the three kinds are offered in one order, each with a line saying what it is',
		[
			SOURCE_KINDS.map((k) => k.value),
			SOURCE_KINDS.every((k) => k.description.length > 20),
			NO_SOURCE_YET,
		],
		[
			['clips', 'rig', 'stills'],
			true,
			'Drawn by its component’s own animation: choose frame clips, a rig or still images.',
		],
	);

	t.same(
		'15. the Whole view beside a source no sheet chose: a character its component draws is told so, one a clip block or code draws only that none is chosen; nothing once a sheet names one, or for a 3D model',
		[
			sourceChoiceHint('component', false),
			sourceChoiceHint('none', false),
			sourceChoiceHint('clips', false),
			sourceChoiceHint('code', false),
			sourceChoiceHint('clips', true),
			sourceChoiceHint('rig', true),
			sourceChoiceHint('model', false),
		],
		[NO_SOURCE_YET, NO_SOURCE_YET, SOURCE_NOT_CHOSEN, SOURCE_NOT_CHOSEN, '', '', ''],
	);

	// ── the stills a preview draws ────────────────────────────────────────────────────────────
	{
		const stills = sheetOfRaw({
			source: { kind: 'stills' },
			actions: [{ id: 'idle', anim: { se: { still: { assetKey: KEY, region: 'bear_idle_se' } } } }],
		});
		const project = { fox_idle_se: { id: 'fox_idle_se' } as FlipbookClip };
		const drawn = clipsWithStills(stills, project);
		const id = `still::${KEY}::bear_idle_se`;
		t.same(
			'15. the Directions preview is handed each still image as the clip of one frame the game makes of it, a sheet with no width yet too',
			[
				Object.keys(drawn),
				[drawn[id]?.assetKey, drawn[id]?.frames],
				Object.keys(clipsWithStills({ ...stills, draw: { width: 48 } }, {})),
				Object.keys(clipsWithStills(rigSheet(), project)),
				Object.keys(
					clipsWithStills({ prefixes: { base: 'bear' }, displayWidth: 10, idle: 'idle' }, project),
				),
			],
			[['fox_idle_se', id], [KEY, ['bear_idle_se']], [id], ['fox_idle_se'], ['fox_idle_se']],
		);
		const preview = code('lib/flipbook/CharacterDirections.svelte');
		t.check(
			'15. … by the preview itself, so every host draws them, and it no longer says a still is not previewed (source text)',
			/clipsWithStills\(art, projectClips\)/.test(preview) && !/not previewed/.test(preview),
		);
	}

	// ── the words of a fill ───────────────────────────────────────────────────────────────────
	const set = {
		assetKey: KEY,
		regions: ['n', 'ne', 'e', 'se', 's'].flatMap((f) => [
			{ name: `bear_idle_${f}`, x: 0, y: 0, w: 90, h: 80, origW: 96, origH: 96 },
			{ name: `fisherman_idle_${f}`, x: 0, y: 0, w: 64, h: 64 },
		]),
	};
	const source = fillSourceOf(set);
	t.same(
		'15. a sheet’s region read as what a fill is handed: its key, its frames and their untrimmed sizes',
		[
			source.assetKey,
			source.regions.length,
			source.sizes?.bear_idle_n,
			source.sizes?.fisherman_idle_s,
		],
		[KEY, 10, { w: 96, h: 96 }, { w: 64, h: 64 }],
	);
	{
		const doc = docOf({ view: { kind: 'isometric', facings: 8 }, source: { kind: 'stills' } });
		const plan = fillFromNames(sheetOf(doc, 'hero'), source, { prefix: 'bear' });
		const did = applyFill(doc, 'hero', plan, { overwrite: false, addActions: true });
		const again = fillFromNames(sheetOf(doc, 'hero'), source, { prefix: 'fisherman' });
		const kept = applyFill(doc, 'hero', again, { overwrite: false, addActions: true });
		const over = applyFill(doc, 'hero', again, { overwrite: true, addActions: true });
		const skipped = applyFill(
			docOf({ source: { kind: 'stills' }, view: { kind: 'isometric', facings: 8 } }),
			'hero',
			plan,
			{ overwrite: false, addActions: false },
		);
		t.same(
			'15. what Apply did, in a sentence: placed, kept, replaced, added, skipped, and what the sheet still needs',
			[
				fillDoneText(did),
				plan.width,
				fillDoneText(kept),
				fillDoneText(over),
				fillDoneText(skipped),
			],
			[
				'5 images placed. Added "idle". Set a width for the draw box.',
				96,
				'0 images placed. 5 cells kept what they held. Set a width for the draw box.',
				'5 images placed, 5 of them replacing what the cell held. Set a width for the draw box.',
				'0 images placed. Skipped the images of "idle": the sheet has no such action. Set a width for the draw box. Add an action.',
			],
		);
		t.same(
			'15. … and a refused fill says why',
			fillDoneText(
				applyFill(doc, 'hero', fillFromNames(sheetOf(doc, 'hero'), source), {
					overwrite: false,
					addActions: true,
				}),
			),
			'The sheet holds images of 2 characters (bear, fisherman): pick which one this is.',
		);
	}
	{
		const doc = docOf({});
		const asked = startStillsCharacter(doc, 'hero', source);
		const did = startStillsCharacter(doc, 'hero', source, { prefix: 'fisherman' });
		const viewed = docOf({ view: { kind: 'isometric' }, draw: { width: 30 } });
		t.same(
			'15. what Images from a sheet did: the images, the action, the view it chose and the width it gave; a view and a width already set are not said',
			[
				startStillsText(asked),
				asked.plan.ambiguous,
				startStillsText(did),
				startStillsText(startStillsCharacter(viewed, 'hero', source, { prefix: 'bear' })),
			],
			[
				'The sheet holds images of 2 characters (bear, fisherman): pick which one this is.',
				true,
				'Still images: 5 images placed. Added "idle". The view is isometric, 8 facings, the smallest that has every facing the images name. The draw box is 64 px wide, the widest image.',
				'Still images: 2 images placed. Added "idle".',
			],
		);
	}

	// ── adding by name, in words ──────────────────────────────────────────────────────────────
	const look = (id: string): Required<ListedLook> => ({
		id,
		name: id,
		scope: 'project',
		inputs: [],
	});
	const created: AddCharacterResult = {
		ok: true,
		characterId: 'polar_bear',
		component: { ...look('polar_bear'), name: 'Polar Bear' },
		how: 'created',
		listed: false,
	};
	t.same(
		'15. what adding a name would do, said as it is typed',
		[
			characterNamePlanText({ kind: 'create', id: 'polar_bear', name: 'Polar Bear' }),
			characterNamePlanText({
				kind: 'adopt',
				id: 'polar_bear',
				name: 'Polar Bear',
				component: 'Polar-Bear',
			}),
			characterNamePlanText({ kind: 'refused', reason: 'Type a name for the character.' }),
		],
		[
			'Adds the character "polar_bear" and creates its look "polar_bear".',
			'Adds the character "polar_bear", using the existing component "Polar-Bear" as its look.',
			'Type a name for the character.',
		],
	);
	t.same(
		'15. what an add did: an adopted look is named, a refusal is said as it is',
		[
			addedNote(created),
			addedNote({ ...created, how: 'adopted', listed: true }),
			addedNote({ ok: false, refused: 'No.' }),
		],
		[
			'Added "polar_bear" and created its look. The character is saved when you press Save.',
			'Added "polar_bear". It uses the existing component "Polar Bear" as its look, as it is. The character is saved when you press Save.',
			'No.',
		],
	);
	t.same(
		'15. the page’s looks after an add: one it learned of is listed once, after a failure too; one it already lists is not added',
		[
			looksAfterAdd([look('a')], created).map((c) => c.id),
			looksAfterAdd([look('a')], { ...created, listed: true }).map((c) => c.id),
			looksAfterAdd([look('a'), look('polar_bear')], created).map((c) => c.id),
			looksAfterAdd([look('a')], { ok: false, refused: 'No.', component: look('found') }).map(
				(c) => c.id,
			),
			looksAfterAdd([look('a')], { ok: false, refused: 'No.' }).map((c) => c.id),
		],
		[['a', 'polar_bear'], ['a'], ['a', 'polar_bear'], ['a', 'found'], ['a']],
	);

	// ── a rig's cost, in a line ───────────────────────────────────────────────────────────────
	t.same(
		'15. a rig’s cost in one line, and a word for each verdict',
		[
			rigCostLine({ drawCalls: 6, blendSwitches: 5, darkTintSlots: 0, drawnSlots: 9, bones: 3 }),
			rigCostLine({ drawCalls: 1, blendSwitches: 1, darkTintSlots: 1, drawnSlots: 1, bones: 1 }),
			[1, 30, 80].map(
				(drawCalls) =>
					RIG_COST_LEVEL_LABELS[
						rigCostVerdict({
							drawCalls,
							blendSwitches: 0,
							darkTintSlots: 0,
							drawnSlots: 1,
							bones: 1,
						}).level
					],
			),
		],
		[
			'6 draw calls · 5 blend switches · 0 dark-tint slots',
			'1 draw call · 1 blend switch · 1 dark-tint slot',
			['Light', 'Heavy', 'Too heavy'],
		],
	);

	// ── the project's sheets, on the page's one read ──────────────────────────────────────────
	{
		const r2 = (await import(src('lib/server/r2.ts'))) as {
			putObjectText: (key: string, body: string, type: string) => Promise<string>;
			listAllObjects: (prefix: string) => Promise<{ key: string }[]>;
		};
		const put = (key: string): Promise<string> => r2.putObjectText(key, '{}', 'application/json');
		await put('acme/cloud/manifests/hud.json');
		await put('acme/cloud/atlas/hud.png');
		await put(KEY);
		await put('acme/cloud/sheets/trial/trial.png');
		await put('acme/cloud/sheets/unfinished/page.png');
		await put('_shared/sheets/library/atlas_manifest_library.json');
		await put('_shared/sheets/trial/atlas_manifest_trial.json');
		await put('acme/elsewhere/sheets/secret/atlas_manifest_secret.json');
		const before = (await r2.listAllObjects('')).map((o) => o.key).sort();
		const { GET } = (await import(src('routes/api/characters/whole/+server.ts'))) as {
			GET: (event: never) => Promise<Response>;
		};
		const ask = async (role: string | null = 'developer') => {
			const url = new URL('https://launcher.test/api/characters/whole');
			try {
				const res = await GET({
					url,
					request: new Request(url),
					locals: { user: role ? { id: 'u1', role } : null },
					cookies: { get: () => 'token' },
				} as never);
				return { status: res.status, body: (await res.json()) as Record<string, unknown> };
			} catch (e) {
				if (!isHttpError(e)) throw e;
				return { status: e.status, body: e.body as Record<string, unknown> };
			}
		};
		const whole = await ask();
		const listed = whole.body.sheets as { key: string; name: string }[];
		/** What an earlier section of the gate left in the store. */
		const EARLIER = /atlas_manifest_Sheet\.json$/;
		t.same(
			'15. the whole read lists the project’s atlases and sheets a still is picked from, each by its MANIFEST key: its own, then the shared ones it does not shadow',
			[
				whole.status,
				listed.filter((s) => !EARLIER.test(s.key)),
				listed.some((s) => /elsewhere|_shared\/sheets\/trial|\.png$/.test(s.key)),
				'sheetsError' in whole.body,
			],
			[
				200,
				[
					{ key: 'acme/cloud/manifests/hud.json', name: 'hud.json' },
					{ key: KEY, name: 'trial' },
					{ key: 'acme/cloud/sheets/unfinished/', name: 'unfinished' },
					{ key: '_shared/sheets/library/atlas_manifest_library.json', name: 'library' },
				],
				false,
				false,
			],
		);
		t.same(
			'15. … to the Characters grant only',
			[(await ask('localizationReviewer')).status, (await ask(null)).status],
			[403, 401],
		);
		standIns.listingFault = { under: '/sheets/', message: 'R2 is not answering' };
		const { out: faulted, logged } = await withServerLog(() => ask());
		standIns.listingFault = undefined;
		t.same(
			'15. a sheet listing that fails leaves the rest readable and says so in a plain sentence: the storage’s own words go to the server log, not to the page',
			[
				faulted.status,
				faulted.body.sheets,
				faulted.body.sheetsError,
				JSON.stringify(faulted.body).includes('R2 is not answering'),
				logged.length === 1 && logged[0].includes('R2 is not answering'),
				faulted.body.rigs,
				faulted.body.clipIds,
			],
			[
				200,
				[],
				"The project's sheets could not be listed. Reload the page to try again.",
				false,
				true,
				whole.body.rigs,
				whole.body.clipIds,
			],
		);
		t.same(
			'15. … and the read wrote nothing',
			(await r2.listAllObjects('')).map((o) => o.key).sort(),
			before,
		);
		const route = code('routes/api/characters/whole/+server.ts');
		t.check(
			'15. the route is a GET alone, behind the Characters gate (source text)',
			/export const GET\b/.test(route) &&
				!/export const (POST|PUT|PATCH|DELETE)\b/.test(route) &&
				/tool: 'characters'/.test(route),
		);
	}

	// ── a sheet whose frames could not be read ────────────────────────────────────────────────
	{
		const { fetchRegions, readRegions } = await import(
			src('routes/(app)/editor/editorRegions.client.ts')
		);
		const set = (sheet: string, regions: string[]): Response =>
			Response.json({
				assetKey: sheet,
				pageKey: 'page.png',
				pageVersion: '',
				pageWidth: 1,
				pageHeight: 1,
				regions: regions.map((name) => ({ name, x: 0, y: 0, w: 1, h: 1 })),
			});
		/** What the next reads answer, in turn; the last one is every later read's. */
		let answers: (number | 'offline')[] = [];
		const asked: string[] = [];
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const sheet = new URL(String(input), 'https://launcher.test').searchParams.get('sheet') ?? '';
			asked.push(sheet);
			const answer = answers.length > 1 ? answers.shift() : answers[0];
			if (answer === 'offline') throw new TypeError('fetch failed');
			return answer === 200 ? set(sheet, ['bear_idle_ne']) : new Response('no', { status: answer });
		}) as typeof fetch;
		const outcome = (read: Promise<{ regions: { name: string }[] }>): Promise<string> =>
			read.then(
				(got) => `read ${got.regions.map((r) => r.name).join(',')}`,
				(e: unknown) => `rejected ${e instanceof Error ? e.message : String(e)}`,
			);
		try {
			answers = [500, 200];
			const strict = [await outcome(readRegions('a')), await outcome(readRegions('a'))];
			const kept = [await outcome(readRegions('a')), asked.filter((k) => k === 'a').length];
			answers = [403];
			const refused = [await outcome(readRegions('b'))];
			answers = [200];
			refused.push(await outcome(fetchRegions('b')));
			answers = ['offline', 200];
			const offline = [await outcome(readRegions('c')), await outcome(readRegions('c'))];
			answers = [500, 200];
			const editor = [await outcome(fetchRegions('d')), await outcome(fetchRegions('d'))];
			const afterEditor = [await outcome(readRegions('d')), await outcome(fetchRegions('d'))];
			t.same(
				'15. a sheet whose frames could not be read is told from an empty one: the Characters read rejects with why and asks again the next time, the editor’s read is the empty set it always was',
				[strict, kept, refused, offline, editor, afterEditor],
				[
					['rejected HTTP 500', 'read bear_idle_ne'],
					['read bear_idle_ne', 2],
					['rejected HTTP 403', 'read bear_idle_ne'],
					['rejected network error', 'read bear_idle_ne'],
					['read ', 'read '],
					['read bear_idle_ne', 'read bear_idle_ne'],
				],
			);
		} finally {
			globalThis.fetch = realFetch;
		}
		t.same(
			'15. … and what the cards say of it',
			[sheetReadFailed(new Error('HTTP 500')), sheetReadFailed('x')],
			[
				'Could not read the images of this sheet (HTTP 500). Nothing was changed. Pick it again to try again.',
				'Could not read the images of this sheet (network error). Nothing was changed. Pick it again to try again.',
			],
		);
	}

	// ── the cards, as written ─────────────────────────────────────────────────────────────────
	const card = (name: string): string => code(`routes/(app)/characters/sheet/${name}.svelte`);
	const cards = readdirSync(
		fileURLToPath(new URL('../../src/routes/(app)/characters/sheet/', import.meta.url)),
	).filter((name) => name.endsWith('.svelte'));
	t.check(
		'15. the image picker is the Scene Editor’s own, in the cell editor and the stills body, and nothing else under /characters lists frames (source text)',
		['CellEditor', 'SourceStills'].every(
			(name) =>
				card(name).includes(
					`import RegionPicker from '${['..', '..', 'editor', 'RegionPicker.svelte'].join('/')}';`,
				) && /<RegionPicker\b[^>]*\bscoped\b/s.test(card(name)),
		) &&
			cards.every(
				(name) => !/RegionThumb|fetchRegions|api\/editor\/regions/.test(card(name.slice(0, -7))),
			),
	);
	t.check(
		'15. the rig grid is the clips grid’s table: one shell owns the markup and the styles, and neither grid has its own (source text)',
		/<FacingGrid\b/.test(code('lib/flipbook/CharacterClipsGrid.svelte')) &&
			/<FacingGrid\b/.test(code('lib/characters/RigActionsGrid.svelte')) &&
			!/<style|<table/.test(code('lib/flipbook/CharacterClipsGrid.svelte')) &&
			!/<style|<table/.test(code('lib/characters/RigActionsGrid.svelte')) &&
			/<table class="grid">/.test(code('lib/flipbook/FacingGrid.svelte')) &&
			/<RigActionsGrid grid=\{rig\}/.test(card('ActionsCard')),
	);
	t.check(
		'15. the rig preview, the runtime and Pixi are fetched only when a rig is shown: no card or page imports them statically (source text)',
		/import\('\$lib\/characters\/SheetRigPreview\.svelte'\)/.test(card('ActionsCard')) &&
			/import type SheetRigPreview from/.test(card('ActionsCard')) &&
			/import\('\$lib\/characters\/rigLoad\.client'\)/.test(
				code('routes/(app)/characters/rigRead.svelte.ts'),
			) &&
			[
				...cards.map((name) => card(name.slice(0, -7))),
				code('routes/(app)/characters/+page.svelte'),
				code('routes/(app)/characters/rigRead.svelte.ts'),
			].every(
				(text) =>
					!/^\s*import (?!type)[^;]*(rigLoad\.client|SheetRigPreview|from 'pixi\.js'|engine-rig)/m.test(
						text,
					),
			),
	);
	t.check(
		'15. the Characters cards read a sheet’s frames through the read that rejects, plan nothing from a failed one and start nothing on it (source text)',
		/regionsOf = \(sheetKey: string\): Promise<RegionSet> => readRegions\(sheetKey\);/.test(
			code('routes/(app)/characters/wholeRead.svelte.ts'),
		) &&
			!/fetchRegions/.test(code('routes/(app)/characters/wholeRead.svelte.ts')) &&
			/\} catch \(e\) \{\s*if \(key !== next\) return;\s*key = '';\s*refused = sheetReadFailed\(e\);/.test(
				card('FillFromNames'),
			) &&
			/\} catch \(e\) \{\s*fromKey = '';\s*refused = sheetReadFailed\(e\);\s*return;\s*\} finally \{\s*busy = false;\s*\}\s*if \(fromKey === key\) start\(\);/.test(
				card('SourceStills'),
			) &&
			(card('SourceStills').match(/sheetReadFailed\(e\)/g) ?? []).length === 2,
	);
	t.check(
		'15. a rig is read again on demand: the row’s Read again and the Whole view’s refresh drop what was read of it, and the preview loads again a rig read anew or one whose load failed (source text)',
		/again\(name\?: string\): void \{[\s\S]*?delete this\.#asked\[rig\][\s\S]*?loader\.forget\(rig\)[\s\S]*?this\.want\(names\);/.test(
			code('routes/(app)/characters/rigRead.svelte.ts'),
		) &&
			/forget\(rig\) \{\s*loaded\.delete\(rig\);/.test(code('lib/characters/rigLoad.client.ts')) &&
			/\{:else\}\s*\{#if rig\.state === 'failed'\}[\s\S]*?onclick=\{\(\) => rigs\.again\(rig\.name\)\}/.test(
				card('SourceRig'),
			) &&
			/onReread=\{\(\) => rigs\.again\(\)\}/.test(code('routes/(app)/characters/+page.svelte')) &&
			/onclick=\{\(\) => \{\s*onReread\(\);\s*void read\.load\(\);/.test(
				code('routes/(app)/characters/CharacterWhole.svelte'),
			) &&
			/asked\[rig\] === facts;\s*if \(askedUnder\(\)\) continue;/.test(
				code('lib/characters/SheetRigPreview.svelte'),
			) &&
			/if \(!askedUnder\(\)\) return;\s*delete asked\[rig\];/.test(
				code('lib/characters/SheetRigPreview.svelte'),
			) &&
			/\.catch\(\(e: unknown\) => \{[\s\S]*?startFailed = sheetRigStartFailed;/.test(
				code('lib/characters/SheetRigPreview.svelte'),
			) &&
			/if \(startFailed\) return \{ kind: 'failed', why: startFailed \};/.test(
				code('lib/characters/SheetRigPreview.svelte'),
			),
	);
	t.check(
		'15. a start tile pressed again asks again: each press is a new request, not the same kind (source text)',
		/startKind = \{ kind \};/.test(card('SheetCards')) &&
			/let startKind = \$state\.raw<\{ kind: SourceKind \} \| undefined>/.test(
				card('SheetCards'),
			) &&
			/if \(startKind\) pending = startKind\.kind;/.test(card('SourceCard')),
	);
	t.check(
		'15. what a message or a label says a control does is what it does: the last rig names the bin of the Animation source card, the Draw card’s bin names the bone ties it removes (source text)',
		/take the source away with the bin on the Animation source card\./.test(
			code('lib/characters/characterSheetSources.ts'),
		) &&
			SHEET_CARD_TITLES.source === 'Animation source' &&
			/<IconButton\s+icon="trash"\s+label="Take the source away, with what it names"/.test(
				card('SourceCard'),
			) &&
			/label="Take the draw box away, with its feet, its points and the bones they follow"/.test(
				card('DrawCard'),
			) &&
			/delete sheet\.draw;/.test(code('lib/characters/characterSheetEdit.ts')),
	);
	/** The opening tags of a card's controls (an arrow in a handler does not end one). */
	const controlsOf = (text: string): string[] =>
		[
			...text.matchAll(/<(select|input|button|RigSelect|RegionPicker|IconButton)\b(?:=>|[^>])*>/g),
		].map((m) => m[0]);
	/** A button that edits nothing: it drops a pending Replace, reads a rig again, or scrolls. */
	const editsNothing =
		/onclick=\{(\(\) => \(waiting = undefined\)|\(\) => rigs\.again\(rig\.name\)|onDraw)\}/;
	/** The image picker's stand-in while the page is read-only: it is the disabled branch. */
	const PICKER_STAND_IN = /^<button class="btn" type="button" disabled>$/;
	/** Whether a control is disabled BY the page's read-only: its `disabled` names `readOnly`.
	 *  The source tiles take it as their `disabled` prop, which each mount must hand them. */
	const lockedByReadOnly = (name: string, control: string): boolean =>
		/\bdisabled=\{[^}]*\breadOnly\b[^}]*\}/.test(control) ||
		PICKER_STAND_IN.test(control) ||
		(name === 'SourceChoice' && /\{disabled\}/.test(control));
	const NEW_CARDS = [
		'SourceChoice',
		'SourceRig',
		'SourceStills',
		'FillFromNames',
		'RigCellEditor',
		'CellEditor',
	];
	t.same(
		'15. every new control that edits is disabled while the page is read-only or saving; the image picker is not mounted then (source text)',
		NEW_CARDS.map((name) => [
			name,
			controlsOf(card(name)).length > 0,
			controlsOf(card(name))
				.filter((control) => !control.startsWith('<RegionPicker') && !editsNothing.test(control))
				.filter((control) => !/\bdisabled\b/.test(control))
				.map((control) => control.slice(0, 60)),
			controlsOf(card(name))
				.filter((control) => !control.startsWith('<RegionPicker') && !editsNothing.test(control))
				.filter((control) => !lockedByReadOnly(name, control))
				.map((control) => control.slice(0, 60)),
			(card(name).match(/<RegionPicker\b/g) ?? []).length ===
				(
					card(name).match(
						/\{#if readOnly(?: \|\| busy)?\}\s*<button class="btn" type="button" disabled>[^<]*<\/button>\s*\{:else\}\s*<div[^>]*>\s*<RegionPicker\b/g,
					) ?? []
				).length,
		]),
		NEW_CARDS.map((name) => [name, true, [], [], true]),
	);
	t.same(
		'15. … and each place that mounts the source tiles hands them the page’s read-only (source text)',
		['SheetHome', 'SourceCard'].map((name) =>
			(card(name).match(/<SourceChoice\b[^>]*>/g) ?? []).map((mount) =>
				/\bdisabled=\{readOnly\}/.test(mount),
			),
		),
		[[true], [true]],
	);
	t.check(
		'15. the page makes one adder, adds through it, and keeps the old way under Advanced (source text)',
		(code('routes/(app)/characters/+page.svelte').match(/characterAdder\(/g) ?? []).length === 1 &&
			/components = looksAfterAdd\(components, result\);/.test(
				code('routes/(app)/characters/+page.svelte'),
			) &&
			/refusal: \(\) => locked/.test(code('routes/(app)/characters/+page.svelte')) &&
			/data-advanced="add"[\s\S]*data-add-with-look[\s\S]*<\/details>/.test(
				code('routes/(app)/characters/+page.svelte'),
			),
	);
};
