/**
 * §12 of `check:characters-tool` — SOURCES, RIGS AND STILL IMAGES ON THE SHEET (character pipeline
 * C6b): the pure edits of `characterSheetSources.ts`, `characterSheetFill.ts`,
 * `characterSheetRigGrid.ts` and what C6b changed in `characterSheetEdit.ts`,
 * `characterSheetActions.ts`, `characterSheetPage.ts` and `characterSheetCheck.ts`.
 *
 * Every edit stores what `normalizeCharacterSheet` makes of it; a change of the source's kind
 * loses nothing silently; the rig grid is the resolver's answer (`resolveSheetRig`) cell for cell;
 * *Fill from names* never guesses and never overwrites unasked; and a rig sheet and a stills
 * sheet made ONLY with these edits pass the save's validator with no issue and go through the
 * page's load and the real save and load byte for byte.
 */
import { readFileSync } from 'node:fs';
import {
	CHARACTER_FACINGS,
	normalizeCharacterSheet,
	normalizeGameConfigDoc,
	validateCharacterSheets,
	withCharacterSheets,
	type CharacterFacing,
	type CharacterSheet,
	type GameConfigDoc,
} from 'game-config';
import {
	resolveSheetClip,
	resolveSheetRig,
	sheetStillClipId,
	sheetStillClips,
} from 'engine-layout';
import * as sheet from '../../src/lib/characters/characterSheetEdit.ts';
import * as act from '../../src/lib/characters/characterSheetActions.ts';
import * as chk from '../../src/lib/characters/characterSheetCheck.ts';
import * as pg from '../../src/lib/characters/characterSheetPage.ts';
import * as src from '../../src/lib/characters/characterSheetSources.ts';
import * as fill from '../../src/lib/characters/characterSheetFill.ts';
import * as core from '../../src/lib/characters/sheetCore.ts';
import { rigCellText, rigGrid } from '../../src/lib/characters/characterSheetRigGrid.ts';
import {
	rigSourceOf,
	type RigFacts,
	type RigFactsByName,
} from '../../src/lib/characters/rigFacts.ts';
import { characterGrid } from '../../src/lib/flipbook/characterSet.ts';
import type { Section } from './harness';
import { roundTrip } from './roundTrip.ts';

const text = (v: unknown): string => JSON.stringify(v);

/** A config with one character `hero` that has no sheet (or `held`), and the class that it is. */
const docWith = (held: CharacterSheet = {}, linked = true): GameConfigDoc => {
	const raw = {
		family: 'arcade',
		outcome: 'rules',
		arcade: {
			field: { w: 2000, h: 1200 },
			bodies: { heroLook: { shape: 'circle', r: 20, tags: ['player'] } },
			characters: [
				{ id: 'hero', component: 'heroLook', ...(JSON.parse(text(held)) as CharacterSheet) },
			],
			online: {
				characters: [
					{ id: 'hero', body: 'heroLook', speed: 200, ...(linked ? { sheet: 'hero' } : {}) },
				],
			},
		},
	};
	return withCharacterSheets(normalizeGameConfigDoc(raw) as GameConfigDoc, raw);
};
const of = (doc: GameConfigDoc): CharacterSheet | undefined => sheet.sheetOf(doc, 'hero');
/** The doc holds exactly what the normalizer makes of each character's sheet, key for key. */
const fits = (doc: GameConfigDoc): boolean =>
	(doc.arcade?.characters ?? []).every(
		(c) => text(normalizeCharacterSheet(c)) === text(sheet.sheetFieldsOf(c)),
	);
/** The save's validator has nothing to say of the doc's sheets. */
const quiet = (doc: GameConfigDoc): string[] =>
	validateCharacterSheets(doc).map((i) => `${i.path}: ${i.message}`);

const KEY = 'acme/p/manifests/atlas_manifest_cast.json';
const STILL = { assetKey: KEY, region: 'crate' };
const NOT_A_KEY =
	'A still image names its sheet by its manifest key (…/manifests/atlas_manifest_<name>.json): this one cannot ship.';

const facts = (
	name: string,
	animations: string[],
	skins: string[] = [],
	bones: string[] = [],
): RigFacts => ({
	name,
	animations: animations.map((animation) => ({ name: animation, durationMs: 500 })),
	skins,
	bones,
	cost: { drawCalls: 1, blendSwitches: 0, darkTintSlots: 0, drawnSlots: 1, bones: bones.length },
});
const rigsOf = (...list: RigFacts[]): RigFactsByName =>
	Object.fromEntries(list.map((rig) => [rig.name, rig]));

/** A sheet with a cell of each kind: what a change of the source's kind must keep. */
const MIXED: CharacterSheet = {
	source: { kind: 'clips', prefix: 'bear', variants: { marked: 'gold' } },
	draw: { width: 60 },
	actions: [
		{
			id: 'idle',
			when: { motion: 'still' },
			anim: {
				ne: { clip: 'bear_sit_ne' },
				se: { still: STILL },
				sw: { anim: 'look', rig: 'tail' },
			},
		},
	],
};

export const run: Section = async (t) => {
	// ── the kinds ────────────────────────────────────────────────────────────────────────────────
	t.same(
		'12. the three kinds, in the order offered, each with its name and one line of what it is',
		[
			core.SOURCE_KINDS.map((k) => [k.value, k.label, k.description.length > 20]),
			core.SOURCE_KINDS.every((k) => k.label === core.SOURCE_KIND_LABELS[k.value]),
			core.SOURCE_KINDS.find((k) => k.value === 'clips')?.description.includes('Flipbook'),
		],
		[
			[
				['clips', 'Frame clips', true],
				['rig', 'Rig', true],
				['stills', 'Still images', true],
			],
			true,
			true,
		],
	);

	// ── choosing a kind on a character with no sheet ─────────────────────────────────────────────
	{
		const picks: [string, Parameters<typeof src.setSourceKind>[3], unknown][] = [
			['clips', { prefix: ' bear ' }, { kind: 'clips', prefix: 'bear' }],
			['rig', { rig: ' otterRig ' }, { kind: 'rig', rig: 'otterRig' }],
			['stills', {}, { kind: 'stills' }],
		];
		for (const [kind, options, stored] of picks) {
			const doc = docWith();
			const done = src.setSourceKind(doc, 'hero', kind as core.SourceKind, options);
			t.same(
				`12. ${kind} chosen on a character with no sheet: a sheet of that source alone, as the normalizer stores it`,
				[done, of(doc), fits(doc)],
				[{ refused: null, lost: '', unread: [] }, { source: stored }, true],
			);
		}
		const doc = docWith();
		const before = text(doc);
		t.same(
			'12. frame clips need a prefix and a rig source a rig: refused with the reason, nothing written',
			[
				src.setSourceKind(doc, 'hero', 'clips').refused,
				src.setSourceKind(doc, 'hero', 'clips', { prefix: '  ' }).refused,
				src.setSourceKind(doc, 'hero', 'rig').refused,
				src.setSourceKind(doc, 'ghost', 'stills').refused,
				text(doc) === before,
			],
			[
				'Frame clips need a prefix: their clips are named <prefix>_<action>_<facing>.',
				'Frame clips need a prefix: their clips are named <prefix>_<action>_<facing>.',
				'A rig source needs a rig: pick one of the project’s rigs.',
				'No such character.',
				true,
			],
		);
	}

	// ── changing the kind: what is lost is said first, and the cells are kept ────────────────────
	{
		const RIG: CharacterSheet = {
			...MIXED,
			source: {
				kind: 'rig',
				rig: 'otterRig',
				rigs: { ne: 'otterBack' },
				variants: { marked: 'gold' },
			},
		};
		const STILLS: CharacterSheet = { ...MIXED, source: { kind: 'stills' } };
		t.same(
			'12. what a change of kind would lose, in words: everything the old source names, and nothing of the cells',
			[
				src.sourceChangeLoss(MIXED, 'rig'),
				src.sourceChangeLoss(RIG, 'clips'),
				src.sourceChangeLoss(RIG, undefined).text,
				src.sourceChangeLoss(STILLS, 'rig').text,
				src.sourceChangeLoss(MIXED, 'clips').text,
				src.sourceChangeLoss(RIG, 'rig').text,
				src.sourceChangeLoss(undefined, 'rig').text,
				src.sourceChangeLoss({ source: { kind: 'clips', prefix: 'bear' } }, 'stills').text,
			],
			[
				{
					prefix: 'bear',
					rigs: [],
					variants: [['marked', 'gold']],
					text: 'the prefix "bear" and 1 variant',
				},
				{
					rig: 'otterRig',
					rigs: [['ne', 'otterBack']],
					variants: [['marked', 'gold']],
					text: 'the rig "otterRig", 1 rig of a facing and 1 skin variant',
				},
				'the rig "otterRig", 1 rig of a facing and 1 skin variant',
				'',
				'',
				'',
				'',
				'the prefix "bear"',
			],
		);
		const cell = (facing: CharacterFacing, kind: core.CellKind, said: string) => ({
			action: 'idle',
			facing,
			kind,
			text: said,
		});
		const CLIP = cell('ne', 'clip', 'bear_sit_ne');
		const IMAGE = cell('se', 'still', `crate (${KEY})`);
		const ANIM = cell('sw', 'rig', 'look (tail)');
		type Change = {
			from: CharacterSheet;
			to: core.SourceKind;
			named: { prefix?: string; rig?: string };
			lost: string;
			stored: unknown;
			unread: unknown[];
		};
		const changes: Change[] = [
			{
				from: MIXED,
				to: 'rig',
				named: { rig: 'otterRig' },
				lost: 'the prefix "bear" and 1 variant',
				stored: { kind: 'rig', rig: 'otterRig' },
				unread: [CLIP, IMAGE],
			},
			{
				from: MIXED,
				to: 'stills',
				named: {},
				lost: 'the prefix "bear" and 1 variant',
				stored: { kind: 'stills' },
				unread: [CLIP, ANIM],
			},
			{
				from: RIG,
				to: 'clips',
				named: { prefix: 'bear' },
				lost: 'the rig "otterRig", 1 rig of a facing and 1 skin variant',
				stored: { kind: 'clips', prefix: 'bear' },
				unread: [ANIM],
			},
			{
				from: RIG,
				to: 'stills',
				named: {},
				lost: 'the rig "otterRig", 1 rig of a facing and 1 skin variant',
				stored: { kind: 'stills' },
				unread: [CLIP, ANIM],
			},
			{
				from: STILLS,
				to: 'clips',
				named: { prefix: 'bear' },
				lost: '',
				stored: { kind: 'clips', prefix: 'bear' },
				unread: [ANIM],
			},
			{
				from: STILLS,
				to: 'rig',
				named: { rig: 'otterRig' },
				lost: '',
				stored: { kind: 'rig', rig: 'otterRig' },
				unread: [CLIP, IMAGE],
			},
		];
		for (const { from, to, named, lost, stored, unread } of changes) {
			const was = from.source!.kind;
			const doc = docWith(from);
			const before = text(doc);
			const cells = text(of(doc)?.actions);
			const first = src.setSourceKind(doc, 'hero', to, named);
			if (lost)
				t.same(
					`12. ${was} → ${to}: refused until confirmed, naming what the old source would lose, and nothing is written`,
					[first, text(doc) === before],
					[
						{
							refused: `Changing the source to ${core.SOURCE_KIND_WORDS[to]} loses ${lost}: confirm it first.`,
							lost: '',
							unread: [],
						},
						true,
					],
				);
			const done = lost
				? src.setSourceKind(doc, 'hero', to, { ...named, confirmLoss: true })
				: first;
			t.same(
				`12. ${was} → ${to}: the source is the new kind’s alone, what went is said, and the cells it does not read are reported`,
				[done, of(doc)?.source, sheet.unreadCells(of(doc))],
				[{ refused: null, lost, unread }, stored, unread],
			);
			t.check(
				`12. ${was} → ${to}: every cell is kept, the draw box too, and the doc is what the normalizer stores`,
				text(of(doc)?.actions) === cells && text(of(doc)?.draw) === text(from.draw) && fits(doc),
				text(of(doc)),
			);
			t.same(
				`12. ${was} → ${to}: the validator warns of exactly the cells reported, each at its path`,
				validateCharacterSheets(doc)
					.filter((i) => i.path.includes('.anim.'))
					.map((i) => i.path.split('.').pop()),
				(unread as { facing: string }[]).map((c) => c.facing),
			);
		}
		const same = docWith(RIG);
		t.same(
			'12. the kind it already is: the prefix or the one rig changes, and the rest of the source stays',
			[
				src.setSourceKind(same, 'hero', 'rig', { rig: 'otterTwo' }),
				text(of(same)?.source),
				src.setSourceKind(same, 'hero', 'rig').refused,
				text(of(same)?.source),
			],
			[
				{ refused: null, lost: '', unread: [sheetCell('ne'), sheetCell('se')] },
				'{"kind":"rig","rig":"otterTwo","rigs":{"ne":"otterBack"},"variants":{"marked":"gold"}}',
				null,
				'{"kind":"rig","rig":"otterTwo","rigs":{"ne":"otterBack"},"variants":{"marked":"gold"}}',
			],
		);
		function sheetCell(facing: 'ne' | 'se') {
			return facing === 'ne' ? CLIP : IMAGE;
		}
		const back = docWith(MIXED);
		src.setSourceKind(back, 'hero', 'stills', { confirmLoss: true });
		src.setSourceKind(back, 'hero', 'clips', { prefix: 'bear' });
		t.check(
			'12. there and back: the cells are as they were (only the variant, which was confirmed lost, is gone)',
			text(of(back)?.actions) === text(MIXED.actions) &&
				text(of(back)?.source) === '{"kind":"clips","prefix":"bear"}',
			text(of(back)),
		);
	}

	// ── the cells a source does not read ─────────────────────────────────────────────────────────
	{
		const none = docWith({ actions: MIXED.actions });
		t.same(
			'12. unread cells: none with no source; under clips a still IS read and a rig’s animation is not',
			[
				sheet.unreadCells(of(none)),
				sheet.unreadCells(undefined),
				sheet.unreadCells(MIXED).map((c) => `${c.facing} ${c.kind}`),
				core.cellKindsRead(undefined),
				core.cellKindsRead({ kind: 'clips', prefix: 'p' }),
				core.cellKindsRead({ kind: 'rig', rig: 'r' }),
				core.cellKindsRead({ kind: 'stills' }),
			],
			[[], [], ['sw rig'], ['clip', 'still', 'rig'], ['clip', 'still'], ['rig'], ['still']],
		);
		const doc = docWith({ ...MIXED, source: { kind: 'stills' } });
		t.same(
			'12. the one button removes the unread cells, and only those',
			[
				sheet.dropUnreadCells(doc, 'hero'),
				text(of(doc)?.actions?.[0].anim),
				sheet.unreadCells(of(doc)),
				sheet.dropUnreadCells(doc, 'hero'),
				fits(doc),
				quiet(doc),
			],
			[2, text({ se: { still: STILL } }), [], 0, true, []],
		);
	}

	// ── a rig source ─────────────────────────────────────────────────────────────────────────────
	{
		const doc = docWith();
		const notYet = src.setSourceRig(doc, 'hero', 'otterRig');
		src.setSourceKind(doc, 'hero', 'rig', { rig: 'otterRig' });
		t.same(
			'12. a rig per facing: set on a facing of the view, a mirrored one too, and refused where the view has none',
			[
				notYet,
				src.setFacingRig(doc, 'hero', 'ne', ' otterBack '),
				src.setFacingRig(doc, 'hero', 'sw', 'otterLeft'),
				src.setFacingRig(doc, 'hero', 'n', 'otterUp'),
				text(of(doc)?.source),
				fits(doc),
			],
			[
				'Choose Rig as the source first.',
				null,
				null,
				'The view has no facing "n", so a rig for it would never be drawn.',
				'{"kind":"rig","rig":"otterRig","rigs":{"ne":"otterBack","sw":"otterLeft"}}',
				true,
			],
		);
		t.same(
			'12. the facings of a rig source: the view’s, each with its own rig or the one rig, and which are mirrored',
			src.rigFacingsOf(of(doc)),
			[
				{ facing: 'ne', own: 'otterBack', rig: 'otterBack', mirrored: false, undrawn: false },
				{ facing: 'se', rig: 'otterRig', mirrored: false, undrawn: false },
				{ facing: 'sw', own: 'otterLeft', rig: 'otterLeft', mirrored: true, undrawn: false },
				{ facing: 'nw', rig: 'otterRig', mirrored: true, undrawn: false },
			],
		);
		// The engine reads a rig on a mirrored facing: it is drawn there as made.
		const own = rigsOf(
			facts('otterRig', ['idle']),
			facts('otterLeft', ['idle']),
			facts('otterBack', []),
		);
		const drawable: CharacterSheet = { ...of(doc), draw: { width: 60 }, actions: [{ id: 'idle' }] };
		t.same(
			'12. … as the game reads it: a rig on a mirrored facing is drawn there as made, and stands in for its twin, mirrored, before the one rig’s plain "idle" is tried',
			[
				resolveSheetRig(drawable, 'idle', 'sw', [], rigSourceOf(own)),
				resolveSheetRig(drawable, 'idle', 'se', [], rigSourceOf(own)),
				rigGrid(drawable, own).rows[0].cells.map((c) => `${c.facing} ${c.how}`),
			],
			[
				{ rig: 'otterLeft', animation: 'idle', action: 'idle', facing: 'sw', flipX: false },
				{ rig: 'otterLeft', animation: 'idle', action: 'idle', facing: 'se', flipX: true },
				['ne standIn', 'se standIn', 'sw byName', 'nw standIn'],
			],
		);
		t.same(
			'12. … a view that does not mirror makes every facing, and a rig of a facing the new view lacks is kept, listed and warned of',
			[
				sheet.setViewKind(doc, 'hero', 'topDown'),
				sheet.setViewMirror(doc, 'hero', false),
				src
					.rigFacingsOf(of(doc))
					.map((r) => `${r.facing}${r.mirrored ? ' mirrored' : ''}${r.undrawn ? ' undrawn' : ''}`),
				src.setFacingRig(doc, 'hero', 'w', 'otterWest'),
				src.setFacingRig(doc, 'hero', 'ne', 'again'),
				validateCharacterSheets(doc)
					.filter((i) => i.path.includes('.rigs.'))
					.map((i) => i.path.split('.').pop()),
			],
			[
				null,
				null,
				['n', 'e', 's', 'w', 'ne undrawn', 'sw undrawn'],
				null,
				'The view has no facing "ne", so a rig for it would never be drawn.',
				['ne', 'sw'],
			],
		);
		t.same(
			'12. the rigs a sheet names: the one rig, the rigs per facing and a cell’s, each once',
			[
				src.sheetRigNames({
					source: { kind: 'rig', rig: 'a', rigs: { ne: 'b', se: 'a' } },
					actions: [
						{ id: 'x', anim: { se: { anim: 'wag', rig: 'c' }, ne: { anim: 'wag', rig: 'b' } } },
					],
				}),
				src.sheetRigNames(MIXED),
				src.sheetRigNames(undefined),
			],
			[['a', 'b', 'c'], [], []],
		);
		const last = docWith({ source: { kind: 'rig', rig: 'otterRig' } });
		const before = text(last);
		const LAST =
			'A rig source needs a rig: this is its only one. Pick another, or take the source away (Clear source).';
		t.same(
			'12. the last rig is not removed (a rig source naming none is no source): refused, and Clear source takes it away',
			[
				src.setSourceRig(last, 'hero', ' '),
				text(last) === before,
				src.setFacingRig(last, 'hero', 'ne', 'otterBack'),
				src.setSourceRig(last, 'hero', ''),
				text(of(last)?.source),
				src.setFacingRig(last, 'hero', 'ne', ''),
				text(of(last)?.source),
				src.setFacingRig(last, 'hero', 'se', ''),
				sheet.clearSource(last, 'hero'),
				of(last),
				fits(last),
			],
			[
				LAST,
				true,
				null,
				null,
				'{"kind":"rig","rigs":{"ne":"otterBack"}}',
				LAST,
				'{"kind":"rig","rigs":{"ne":"otterBack"}}',
				null,
				null,
				undefined,
				true,
			],
		);
		const clips = docWith({ source: { kind: 'clips', prefix: 'bear' } });
		t.same(
			'12. a rig is not set on another kind of source: the kind is chosen first',
			[src.setSourceRig(clips, 'hero', 'otterRig'), src.setFacingRig(clips, 'hero', 'ne', 'x')],
			[
				'The source is frame clips, not a rig: choose Rig as the source first.',
				'The source is frame clips, not a rig: choose Rig as the source first.',
			],
		);
	}

	// ── a rig's references ───────────────────────────────────────────────────────────────────────
	{
		const held: CharacterSheet = {
			source: {
				kind: 'rig',
				rig: 'otterRig',
				rigs: { ne: 'otterBack' },
				variants: { marked: 'gold' },
			},
			draw: { width: 64, bones: { hand: 'hand_r', tip: 'nose' } },
			actions: [
				{ id: 'idle', when: { motion: 'still' } },
				{ id: 'wag', anim: { se: { anim: 'wag', rig: 'otterTail' }, ne: { anim: 'shake' } } },
			],
		};
		const known = rigsOf(
			facts('otterRig', ['idle'], ['gold'], ['hand_r']),
			facts('otterBack', ['idle'], [], []),
			facts('otterTail', ['flick'], ['gold'], ['hand_r']),
		);
		t.same(
			'12. the tool’s warnings: a rig the project lacks, and an animation, a skin and a bone a rig lacks, each on its card',
			[
				chk.sheetWarnings(held),
				chk
					.sheetWarnings(held, { rigNames: ['otterRig', 'otterTail'] })
					.map((w) => [w.on, w.message]),
				chk.sheetWarnings(held, { rigs: known }).map((w) => [w.on, w.action ?? '', w.message]),
			],
			[
				[
					{
						on: 'draw',
						message:
							'The game reads only the point "hand" from a bone today: "tip" is kept and not read.',
					},
				],
				[
					['source', 'The project has no rig "otterBack", so nothing is drawn where it is named.'],
					[
						'draw',
						'The game reads only the point "hand" from a bone today: "tip" is kept and not read.',
					],
				],
				[
					[
						'source',
						'',
						'The variant "marked" wears the skin "gold", which "otterBack" does not have: it is not worn there.',
					],
					[
						'draw',
						'',
						'The point "hand" follows the bone "hand_r", which "otterBack" does not have: there it is read off the draw box.',
					],
					[
						'draw',
						'',
						'The game reads only the point "hand" from a bone today: "tip" is kept and not read.',
					],
					[
						'actions',
						'wag',
						'"wag" facing ne names the animation "shake", which the rig "otterBack" does not have: that facing is stood in for.',
					],
					[
						'actions',
						'wag',
						'"wag" facing se names the animation "wag", which the rig "otterTail" does not have: that facing is stood in for.',
					],
				],
			],
		);
		const fine: CharacterSheet = {
			...held,
			draw: { width: 64, bones: { hand: 'hand_r' } },
			source: { kind: 'rig', rig: 'otterRig', variants: { marked: 'gold' } },
			actions: [{ id: 'idle', when: { motion: 'still' }, anim: { se: { anim: 'idle' } } }],
		};
		t.same(
			'12. … and none when every name is there, nor of a cell’s rig the project has',
			[
				chk.sheetWarnings(fine, { rigNames: ['otterRig'], rigs: known }),
				chk
					.sheetWarnings(
						{ ...fine, actions: [{ id: 'idle', anim: { se: { anim: 'x', rig: 'ghost' } } }] },
						{ rigNames: ['otterRig'] },
					)
					.map((w) => w.message),
			],
			[
				[],
				[
					'The project has no rig "ghost", which "idle" facing se names: that facing is stood in for.',
				],
			],
		);
	}

	// ── cells of the three kinds ─────────────────────────────────────────────────────────────────
	{
		const rig = docWith({ source: { kind: 'rig', rig: 'otterRig' }, actions: [{ id: 'wag' }] });
		t.same(
			'12. a rig’s cell: an animation, and another rig; a blank rig is not stored; stored as the normalizer has it',
			[
				pg.setCellValue(rig, 'hero', 'wag', 'se', { kind: 'rig', anim: ' wag ' }),
				text(of(rig)?.actions?.[0].anim),
				pg.setCellValue(rig, 'hero', 'wag', 'se', { kind: 'rig', anim: 'wag', rig: 'otterTail' }),
				pg.setCellValue(rig, 'hero', 'wag', 'ne', { kind: 'rig', anim: 'wag', rig: ' ' }),
				text(of(rig)?.actions?.[0].anim),
				pg.setCellValue(rig, 'hero', 'wag', 'ne', undefined),
				pg.cellValueOf(of(rig), 'wag', 'se'),
				fits(rig),
				quiet(rig).filter((line) => line.includes('.anim.')),
			],
			[
				null,
				'{"se":{"anim":"wag"}}',
				null,
				null,
				'{"ne":{"anim":"wag"},"se":{"anim":"wag","rig":"otterTail"}}',
				null,
				{ kind: 'rig', anim: 'wag', rig: 'otterTail' },
				true,
				[],
			],
		);
		const before = text(rig);
		t.same(
			'12. … under a rig a clip and a still image are refused in the validator’s words, and so is an animation with no name',
			[
				pg.setCellValue(rig, 'hero', 'wag', 'ne', { kind: 'clip', clip: 'bear_wag_ne' }),
				pg.setCellValue(rig, 'hero', 'wag', 'ne', { kind: 'still', ...STILL }),
				pg.setCellValue(rig, 'hero', 'wag', 'ne', { kind: 'rig', anim: ' ', rig: 'otterTail' }),
				pg.setCellValue(rig, 'hero', 'ghost', 'ne', { kind: 'rig', anim: 'wag' }),
				pg.setCellValue(rig, 'hero', 'wag', 'up' as CharacterFacing, { kind: 'rig', anim: 'wag' }),
				text(rig) === before,
			],
			[
				'The source is a rig, so a clip or a still image is not drawn: the animation is found by name.',
				'The source is a rig, so a clip or a still image is not drawn: the animation is found by name.',
				'The cell names a rig but no animation, so it is found by name.',
				'No such action.',
				'No such facing.',
				true,
			],
		);
		const stills = docWith({ source: { kind: 'stills' }, actions: [{ id: 'idle' }] });
		t.same(
			'12. a still image: its sheet by the full manifest key and its frame; an output prefix or a bare name cannot ship and is refused as the validator words it',
			[
				pg.setCellValue(stills, 'hero', 'idle', 'se', {
					kind: 'still',
					assetKey: ` ${KEY} `,
					region: ' crate ',
				}),
				text(of(stills)?.actions?.[0].anim),
				pg.setCellValue(stills, 'hero', 'idle', 'ne', {
					kind: 'still',
					assetKey: 'acme/p/sheets/cast',
					region: 'crate',
				}),
				pg.setCellValue(stills, 'hero', 'idle', 'ne', {
					kind: 'still',
					assetKey: 'cast',
					region: 'crate',
				}),
				pg.setCellValue(stills, 'hero', 'idle', 'ne', {
					kind: 'still',
					assetKey: 'cast.json',
					region: 'crate',
				}),
				pg.setCellValue(stills, 'hero', 'idle', 'ne', {
					kind: 'still',
					assetKey: KEY,
					region: ' ',
				}),
				pg.setCellValue(stills, 'hero', 'idle', 'ne', { kind: 'clip', clip: 'bear_idle_ne' }),
				pg.setCellValue(stills, 'hero', 'idle', 'ne', { kind: 'rig', anim: 'idle' }),
				text(of(stills)?.actions?.[0].anim),
				fits(stills),
			],
			[
				null,
				text({ se: { still: STILL } }),
				NOT_A_KEY,
				NOT_A_KEY,
				NOT_A_KEY,
				'A still image needs its sheet (assetKey) and its frame (region): this one is not drawn.',
				'The source is still images, so only a still image is drawn here.',
				'The source is still images, so only a still image is drawn here.',
				text({ se: { still: STILL } }),
				true,
			],
		);
		t.check(
			'12. … the refusal IS the validator’s warning for that cell, written by hand',
			validateCharacterSheets({
				arcade: {
					characters: [
						{
							id: 'c',
							component: 'c',
							source: { kind: 'stills' },
							actions: [
								{ id: 'idle', anim: { ne: { still: { assetKey: 'cast', region: 'crate' } } } },
							],
						},
					],
				},
			}).some((i) => i.message === NOT_A_KEY),
		);
		const clips = docWith({ source: { kind: 'clips', prefix: 'bear' }, actions: [{ id: 'idle' }] });
		t.same(
			'12. frame clips: a clip, then a still over it only as an explicit replace; the same kind is retyped freely',
			[
				pg.setCellValue(clips, 'hero', 'idle', 'se', { kind: 'clip', clip: 'bear_sit_se' }),
				pg.setCellValue(clips, 'hero', 'idle', 'se', { kind: 'clip', clip: 'bear_nap_se' }),
				pg.setCellValue(clips, 'hero', 'idle', 'se', { kind: 'still', ...STILL }),
				text(of(clips)?.actions?.[0].anim),
				pg.setCellValue(
					clips,
					'hero',
					'idle',
					'se',
					{ kind: 'still', ...STILL },
					{ replace: true },
				),
				pg.setCellValue(clips, 'hero', 'idle', 'se', { kind: 'still', ...STILL, region: 'barrel' }),
				text(of(clips)?.actions?.[0].anim),
				pg.setCellValue(
					clips,
					'hero',
					'idle',
					'se',
					{ kind: 'still', assetKey: 'cast', region: 'x' },
					{ replace: true },
				),
				fits(clips),
			],
			[
				null,
				null,
				'The cell holds a clip (bear_nap_se): replace it, or empty the cell first.',
				'{"se":{"clip":"bear_nap_se"}}',
				null,
				null,
				text({ se: { still: { assetKey: KEY, region: 'barrel' } } }),
				NOT_A_KEY,
				true,
			],
		);
		const bare = docWith({ actions: [{ id: 'idle' }] });
		t.same(
			'12. with no source yet a cell of any kind is kept for the one to come, and an image that cannot ship is still refused',
			[
				pg.setCellValue(bare, 'hero', 'idle', 'ne', { kind: 'clip', clip: 'bear_idle_ne' }),
				pg.setCellValue(bare, 'hero', 'idle', 'se', { kind: 'still', ...STILL }),
				pg.setCellValue(bare, 'hero', 'idle', 'sw', { kind: 'rig', anim: 'idle' }),
				pg.setCellValue(bare, 'hero', 'idle', 'nw', {
					kind: 'still',
					assetKey: 'cast',
					region: 'x',
				}),
				Object.keys(of(bare)?.actions?.[0].anim ?? {}),
				pg.cellReadOnly(of(bare), 'idle', 'nw'),
				act.cellRefusal(of(bare), 'idle', 'nw', { anim: 'idle' }),
				fits(bare),
			],
			[null, null, null, NOT_A_KEY, ['ne', 'se', 'sw'], null, null, true],
		);
	}

	// ── what the grid shows for a rig ────────────────────────────────────────────────────────────
	{
		/** Every cell of the grid is what `resolveSheetRig` answers for it. */
		const agrees = (
			held: CharacterSheet,
			rigs: RigFactsByName,
			statuses: string[] = [],
		): string[] => {
			const asked: CharacterSheet = held.draw ? held : { ...held, draw: { width: 1 } };
			const wrong: string[] = [];
			const grid = rigGrid(held, rigs, statuses);
			for (const row of grid.rows)
				for (const cell of row.cells) {
					const found = resolveSheetRig(
						asked,
						cell.state,
						cell.facing,
						statuses,
						rigSourceOf(rigs),
					);
					const drawn = found
						? [found.rig, found.animation, found.flipX, found.skin, found.action !== cell.state]
						: undefined;
					const shown =
						cell.how === 'none'
							? undefined
							: [cell.rig, cell.animation, cell.flipX, cell.skin, cell.how === 'fallback'];
					if (
						text(drawn) !== text(shown) ||
						(cell.how === 'fallback' && cell.action !== found?.action)
					)
						wrong.push(`${cell.state} ${cell.facing}: ${text(shown)} ≠ ${text(drawn)}`);
				}
			if (
				text(grid.rows.map((r) => r.cells.map((c) => c.facing))[0]) !==
				text([...grid.drawn, ...grid.mirrored])
			)
				wrong.push('the cells do not follow drawn then mirrored');
			return wrong;
		};
		const said = (
			held: CharacterSheet,
			rigs: RigFactsByName,
			statuses: string[] = [],
		): string[][] =>
			rigGrid(held, rigs, statuses).rows.map((row) =>
				row.cells.map((cell) => `${cell.facing}: ${rigCellText(cell)}`),
			);
		const walk: CharacterSheet['actions'] = [{ id: 'walk', when: { motion: 'moving' } }];
		const one: CharacterSheet = {
			source: { kind: 'rig', rig: 'otterRig' },
			draw: { width: 64 },
			actions: walk,
		};
		const mirroredOne = rigsOf(facts('otterRig', ['walk']));
		t.same(
			'12. the rig grid, one rig with "walk": found by name in every facing, mirrored where it looks west',
			[
				agrees(one, mirroredOne),
				said(one, mirroredOne),
				rigGrid(one, mirroredOne).drawn,
				rigGrid(one, mirroredOne).mirrored,
			],
			[
				[],
				[
					[
						'ne: walk (otterRig), by name',
						'se: walk (otterRig), by name',
						'sw: walk (otterRig), mirrored, by name',
						'nw: walk (otterRig), mirrored, by name',
					],
				],
				['ne', 'se'],
				['sw', 'nw'],
			],
		);
		const perFacing = rigsOf(facts('otterRig', ['walk_ne', 'walk_se']));
		t.same(
			'12. the rig grid, one rig with "walk_ne" and "walk_se": each as made, and the west facings stand in from their twins, mirrored',
			[agrees(one, perFacing), said(one, perFacing)],
			[
				[],
				[
					[
						'ne: walk_ne (otterRig), by name',
						'se: walk_se (otterRig), by name',
						'sw: walk_se (otterRig), mirrored, from se',
						'nw: walk_ne (otterRig), mirrored, from ne',
					],
				],
			],
		);
		const two: CharacterSheet = {
			source: { kind: 'rig', rigs: { ne: 'otterBack', se: 'otterFront' } },
			draw: { width: 64 },
			actions: walk,
		};
		const frontBack = rigsOf(facts('otterBack', ['walk']), facts('otterFront', ['walk']));
		t.same(
			'12. the rig grid, a rig per facing (ne, se) each with "walk": its own rig in each, and the twins mirrored',
			[
				agrees(two, frontBack),
				said(two, frontBack),
				rigGrid(two, frontBack).rows[0].cells.map((c) => [c.looksOn ?? '', c.looksFor]),
			],
			[
				[],
				[
					[
						'ne: walk (otterBack), by name',
						'se: walk (otterFront), by name',
						'sw: walk (otterFront), mirrored, from se',
						'nw: walk (otterBack), mirrored, from ne',
					],
				],
				[
					['otterBack', ['walk_ne', 'walk']],
					['otterFront', ['walk_se', 'walk']],
					['', ['walk_sw']],
					['', ['walk_nw']],
				],
			],
		);
		const rich: CharacterSheet = {
			view: { kind: 'isometric', facings: 8 },
			source: { kind: 'rig', rig: 'otterRig', variants: { marked: 'gold', stunned: 'dizzy' } },
			actions: [
				{ id: 'walk', when: { motion: 'moving' } },
				{ id: 'wag', anim: { se: { anim: 'tailwag', rig: 'otterTail' }, n: { clip: 'old_clip' } } },
				{ id: 'swim', fallback: 'walk' },
				{ id: 'nap' },
			],
		};
		const richRigs = rigsOf(
			facts('otterRig', ['walk', 'walk_n'], ['gold']),
			facts('otterTail', ['tailwag'], []),
		);
		const richGrid = rigGrid(rich, richRigs, ['marked']);
		const cellOf = (state: string, facing: CharacterFacing) =>
			richGrid.rows.find((r) => r.state === state)!.cells.find((c) => c.facing === facing)!;
		t.same(
			'12. the rig grid, a cell override, a skin, a fallback and nothing: each cell says how it was found',
			[
				agrees(rich, richRigs, ['marked']),
				agrees(rich, richRigs),
				agrees(rich, richRigs, ['stunned']),
				[cellOf('wag', 'se').how, cellOf('wag', 'se').holds, cellOf('wag', 'se').skin],
				[cellOf('wag', 'e').how, cellOf('wag', 'e').from, cellOf('wag', 'e').animation],
				[cellOf('wag', 'n').unread, cellOf('wag', 'n').how],
				[cellOf('walk', 'n').how, cellOf('walk', 'n').animation, cellOf('walk', 'n').skin],
				[cellOf('walk', 'w').how, cellOf('walk', 'w').flipX, cellOf('walk', 'w').looksFor],
				[cellOf('swim', 's').how, cellOf('swim', 's').action, rigCellText(cellOf('swim', 's'))],
				[cellOf('nap', 's').how, rigCellText(cellOf('nap', 's')), cellOf('nap', 's').flipX],
				rigGrid(rich, richRigs).rows[0].cells.every((c) => c.skin === undefined),
				richGrid.rows.map((r) => r.state),
			],
			[
				[],
				[],
				[],
				['cell', { anim: 'tailwag', rig: 'otterTail' }, undefined],
				['standIn', 'se', 'tailwag'],
				['Clip: old_clip', 'standIn'],
				['byName', 'walk_n', 'gold'],
				['standIn', false, ['walk_w', 'walk']],
				['fallback', 'walk', 'walk_n (otterRig), the action walk, skin gold'],
				['none', 'nothing', false],
				true,
				['walk', 'wag', 'swim', 'nap'],
			],
		);
		t.same(
			'12. the rig grid of a rig not read, and of a source that is not a rig: nothing, in every cell',
			[
				rigGrid(one, {}).rows[0].cells.map((c) => c.how),
				rigGrid(MIXED, mirroredOne).rows[0].cells.map((c) => c.how),
				rigGrid({ source: { kind: 'rig', rig: 'otterRig' } }, mirroredOne).rows,
			],
			[['none', 'none', 'none', 'none'], ['none', 'none', 'none', 'none'], []],
		);
		const noMirror: CharacterSheet = { ...one, view: { kind: 'isometric', mirror: false } };
		t.same(
			'12. the rig grid with mirror off: every facing is made, and the one rig’s "walk" is drawn unmirrored in each',
			[
				agrees(noMirror, mirroredOne),
				rigGrid(noMirror, mirroredOne).mirrored,
				rigGrid(noMirror, mirroredOne).rows[0].cells.map((c) => c.flipX),
			],
			[[], [], [false, false, false, false]],
		);
	}

	// ── what the grid shows for still images ─────────────────────────────────────────────────────
	{
		const held: CharacterSheet = {
			source: { kind: 'stills' },
			draw: { width: 48 },
			actions: [
				{ id: 'idle', when: { motion: 'still' }, anim: { se: { still: STILL } } },
				{ id: 'walk', when: { motion: 'moving' }, fallback: 'idle' },
			],
		};
		const id = sheetStillClipId(STILL);
		const grid = characterGrid(held, []);
		const row = (state: string) =>
			grid.rows.find((r) => r.state === state)!.cells.map((c) => [c.facing, c.name, c.status]);
		t.same(
			'12. the clips grid of a stills sheet: the cell with an image is made, its twin mirrored, the others stand in, and an empty cell has no name',
			[row('idle'), row('walk')],
			[
				[
					['ne', '', { kind: 'standIn', clipId: id, flipX: false, state: 'idle', marked: false }],
					['se', id, { kind: 'made' }],
					['sw', '', { kind: 'mirrored', clipId: id }],
					['nw', '', { kind: 'standIn', clipId: id, flipX: true, state: 'idle', marked: false }],
				],
				[
					['ne', '', { kind: 'standIn', clipId: id, flipX: false, state: 'idle', marked: false }],
					['se', '', { kind: 'standIn', clipId: id, flipX: false, state: 'idle', marked: false }],
					['sw', '', { kind: 'standIn', clipId: id, flipX: true, state: 'idle', marked: false }],
					['nw', '', { kind: 'standIn', clipId: id, flipX: true, state: 'idle', marked: false }],
				],
			],
		);
	}

	// ── Fill from names ──────────────────────────────────────────────────────────────────────────
	const DRAWN = ['n', 'ne', 'e', 'se', 's'] as const;
	const TEN = [...DRAWN.map((f) => `bear_idle_${f}`), ...DRAWN.map((f) => `fisherman_idle_${f}`)];
	const SIZES = Object.fromEntries(TEN.map((region, i) => [region, { w: 90 + i, h: 120 }]));
	{
		const doc = docWith({ view: { kind: 'isometric', facings: 8 }, source: { kind: 'stills' } });
		const before = text(doc);
		const asked = fill.fillFromNames(of(doc), { assetKey: KEY, regions: TEN });
		t.same(
			'12. Fill from names, ten images of two characters in one sheet: the plan does not guess, and names the two to ask about',
			[
				asked.ambiguous,
				asked.prefixes,
				asked.fills,
				asked.newActions,
				fill.fillPlanText(asked),
				fill.applyFill(doc, 'hero', asked, { overwrite: true, addActions: true }).refused,
				text(doc) === before,
			],
			[
				true,
				['bear', 'fisherman'],
				[],
				[],
				['The sheet holds images of 2 characters (bear, fisherman): pick which one this is.'],
				'The sheet holds images of 2 characters (bear, fisherman): pick which one this is.',
				true,
			],
		);
		const plan = fill.fillFromNames(of(doc), { assetKey: KEY, regions: TEN }, { prefix: ' Bear ' });
		t.same(
			'12. … asked for "bear": five fills, three facings mirrored, nothing missing for idle, a new action, and a width still to set',
			[
				plan.ambiguous,
				plan.prefix,
				plan.fills,
				plan.mirrored,
				plan.emptyCells,
				plan.overwrites,
				plan.unchanged,
				plan.unmatchedRegions,
				plan.offView,
				plan.newActions,
				plan.missing,
				fill.fillPlanText(plan),
				text(doc) === before,
			],
			[
				false,
				'bear',
				DRAWN.map((facing) => ({ action: 'idle', facing, region: `bear_idle_${facing}` })),
				['sw', 'w', 'nw'].map((facing) => ({ action: 'idle', facing })),
				[],
				[],
				[],
				[],
				[],
				['idle'],
				['Set a width for the draw box.'],
				[
					'idle (a new action): 5 images, 3 facings mirrored, nothing missing.',
					'Set a width for the draw box.',
				],
				true,
			],
		);
		const withheld = docWith(of(doc));
		t.same(
			'12. … applied without "add actions": nothing is made, the images are skipped and said so',
			[
				fill.applyFill(withheld, 'hero', plan, { overwrite: false, addActions: false }),
				of(withheld)?.actions,
			],
			[
				{
					refused: null,
					filled: 0,
					overwritten: 0,
					kept: 0,
					addedActions: [],
					skippedActions: ['idle'],
					missing: ['Set a width for the draw box.', 'Add an action.'],
				},
				undefined,
			],
		);
		const done = fill.applyFill(doc, 'hero', plan, { overwrite: false, addActions: true });
		t.same(
			'12. … applied: "idle" is made, starts when the character stands still, and holds the five images as the normalizer stores them',
			[done, of(doc)?.actions, fits(doc)],
			[
				{
					refused: null,
					filled: 5,
					overwritten: 0,
					kept: 0,
					addedActions: ['idle'],
					skippedActions: [],
					missing: ['Set a width for the draw box.'],
				},
				[
					{
						id: 'idle',
						when: { motion: 'still' },
						anim: Object.fromEntries(
							DRAWN.map((f) => [f, { still: { assetKey: KEY, region: `bear_idle_${f}` } }]),
						),
					},
				],
				true,
			],
		);
		sheet.setDrawWidth(doc, 'hero', '90');
		const stills = new Set(sheetStillClips(of(doc)).map((clip) => clip.id));
		t.same(
			'12. … as the game then draws it: an image in all eight facings, the three west ones their twins’ mirrored, and the validator has nothing to say',
			[
				CHARACTER_FACINGS.map((facing) => {
					const found = resolveSheetClip(of(doc)!, 'idle', facing, [], (clip) => stills.has(clip));
					return `${facing}: ${found?.clipId.split('::').pop()}${found?.flipX ? ' mirrored' : ''}`;
				}),
				quiet(doc),
				core.sheetDrawnAs(of(doc)),
			],
			[
				[
					'n: bear_idle_n',
					'ne: bear_idle_ne',
					'e: bear_idle_e',
					'se: bear_idle_se',
					's: bear_idle_s',
					'sw: bear_idle_se mirrored',
					'w: bear_idle_e mirrored',
					'nw: bear_idle_ne mirrored',
				],
				[],
				'stills',
			],
		);
		const filled = text(doc);
		const again = fill.fillFromNames(of(doc), { assetKey: KEY, regions: TEN }, { prefix: 'bear' });
		t.same(
			'12. … a second run fills nothing, overwrites nothing and says so; applying it, even with overwrite, changes no byte',
			[
				again.fills,
				again.overwrites,
				again.unchanged.length,
				again.newActions,
				again.missing,
				fill.fillPlanText(again),
				fill.applyFill(doc, 'hero', again, { overwrite: true, addActions: true }),
				text(doc) === filled,
			],
			[
				[],
				[],
				5,
				[],
				[],
				[
					'idle: 5 images, 3 facings mirrored, nothing missing.',
					'Nothing to do: every image is already in its cell.',
				],
				{
					refused: null,
					filled: 0,
					overwritten: 0,
					kept: 0,
					addedActions: [],
					skippedActions: [],
					missing: [],
				},
				true,
			],
		);
		const other = fill.fillFromNames(
			of(doc),
			{ assetKey: KEY, regions: TEN },
			{ prefix: 'fisherman' },
		);
		t.same(
			'12. … the other character’s images over these: every cell is an overwrite, named with what it holds, and kept unless told',
			[
				other.fills,
				other.overwrites.length,
				other.overwrites[0],
				fill.fillPlanText(other)[1],
				fill.applyFill(doc, 'hero', other, { overwrite: false, addActions: true }).kept,
				text(doc) === filled,
				fill.applyFill(doc, 'hero', other, { overwrite: true, addActions: true }).overwritten,
				pg.cellValueOf(of(doc), 'idle', 'n'),
				fits(doc),
			],
			[
				[],
				5,
				{
					action: 'idle',
					facing: 'n',
					was: { kind: 'still', assetKey: KEY, region: 'bear_idle_n' },
					region: 'fisherman_idle_n',
				},
				`idle, facing n holds Still image: bear_idle_n (${KEY}): "fisherman_idle_n" replaces it only if you say so.`,
				5,
				true,
				5,
				{ kind: 'still', assetKey: KEY, region: 'fisherman_idle_n' },
				true,
			],
		);
	}
	{
		const four = {
			source: { kind: 'stills' as const },
			actions: [{ id: 'idle' }, { id: 'big_swipe' }],
		};
		const plan = fill.fillFromNames(four, {
			assetKey: KEY,
			regions: [
				'Bear_Idle_NE.png',
				'bear_idle_n',
				'bear_big_swipe_se',
				'bear_idle_ne',
				'bear_logo',
				'bear_walk_SE',
				'n',
			],
		});
		t.same(
			'12. Fill from names reads a name whatever its case and extension, the sheet’s own actions first, and places only the view’s facings',
			[
				plan.prefixes,
				plan.fills,
				plan.offView,
				plan.unmatchedRegions,
				plan.newActions,
				plan.emptyCells.map((c) => `${c.action} ${c.facing}`),
				plan.mirrored.map((c) => `${c.action} ${c.facing}`),
				fill.fillPlanText(plan),
			],
			[
				['bear'],
				[
					{ action: 'idle', facing: 'ne', region: 'Bear_Idle_NE.png' },
					{ action: 'big_swipe', facing: 'se', region: 'bear_big_swipe_se' },
					{ action: 'walk', facing: 'se', region: 'bear_walk_SE' },
				],
				[{ action: 'idle', facing: 'n', region: 'bear_idle_n' }],
				['bear_logo', 'n', 'bear_idle_ne'],
				['walk'],
				['idle se', 'big_swipe ne', 'walk ne'],
				['idle nw', 'big_swipe sw', 'walk sw'],
				[
					'idle: 1 image, 1 facing mirrored, missing se.',
					'big_swipe: 1 image, 1 facing mirrored, missing ne.',
					'walk (a new action): 1 image, 1 facing mirrored, missing ne.',
					'The view has no facing n: 1 image not placed (bear_idle_n).',
					'Not placed, by their names: bear_logo, n, bear_idle_ne.',
					'Set a width for the draw box.',
					'Give one action the trigger "Standing still", or nothing is drawn while it stands.',
				],
			],
		);
		const bare = fill.fillFromNames(four, { assetKey: KEY, regions: ['idle_ne', 'bear_idle_ne'] });
		t.same(
			'12. … names with and without a character are two candidates, the bare one asked for as ""',
			[
				bare.ambiguous,
				bare.prefixes,
				fill.fillFromNames(
					four,
					{ assetKey: KEY, regions: ['idle_ne', 'bear_idle_ne'] },
					{ prefix: '' },
				).fills,
			],
			[true, ['', 'bear'], [{ action: 'idle', facing: 'ne', region: 'idle_ne' }]],
		);
		const rigDoc = docWith({ source: { kind: 'rig', rig: 'otterRig' }, actions: [{ id: 'idle' }] });
		const before = text(rigDoc);
		const onRig = fill.fillFromNames(of(rigDoc), { assetKey: KEY, regions: ['bear_idle_ne'] });
		const badKey = fill.fillFromNames(four, { assetKey: 'cast', regions: ['bear_idle_ne'] });
		t.same(
			'12. … a sheet that cannot ship, and a source that draws no still, are refused in the plan and when applied',
			[
				badKey.refused,
				badKey.fills,
				onRig.refused,
				fill.applyFill(rigDoc, 'hero', onRig, { overwrite: true, addActions: true }).refused,
				text(rigDoc) === before,
			],
			[
				NOT_A_KEY,
				[],
				'The source is a rig, so a clip or a still image is not drawn: the animation is found by name.',
				'The source is a rig, so a clip or a still image is not drawn: the animation is found by name.',
				true,
			],
		);
		t.same(
			'12. the smallest view that has every facing named',
			[
				fill.viewForFacings(['e']),
				fill.viewForFacings(['e', 'w']),
				fill.viewForFacings(['ne', 'se']),
				fill.viewForFacings(['n', 'e', 's']),
				fill.viewForFacings(['n', 'ne', 'e', 'se', 's']),
				fill.viewForFacings([]),
			],
			[
				{ kind: 'side' },
				{ kind: 'side' },
				{ kind: 'isometric' },
				{ kind: 'topDown' },
				{ kind: 'isometric', facings: 8 },
				undefined,
			],
		);
	}

	// ── ten PNGs → a character, in one step ──────────────────────────────────────────────────────
	const stillsDoc = docWith();
	{
		const empty = text(stillsDoc);
		const asked = fill.startStillsCharacter(stillsDoc, 'hero', {
			assetKey: KEY,
			regions: TEN,
			sizes: SIZES,
		});
		t.same(
			'12. a character from a sheet of images: with two characters in it nothing is written until one is picked',
			[asked.refused, asked.plan.prefixes, text(stillsDoc) === empty],
			[
				'The sheet holds images of 2 characters (bear, fisherman): pick which one this is.',
				['bear', 'fisherman'],
				true,
			],
		);
		const done = fill.startStillsCharacter(
			stillsDoc,
			'hero',
			{ assetKey: KEY, regions: TEN, sizes: SIZES },
			{ prefix: 'bear' },
		);
		t.same(
			'12. … picked: one step makes the view (eight facings), the source, "idle" with its five images and a width from the widest image',
			[
				done.refused,
				done.view,
				done.width,
				done.filled,
				done.addedActions,
				done.missing,
				of(stillsDoc),
				fits(stillsDoc),
				quiet(stillsDoc),
				core.sheetDrawnAs(of(stillsDoc)),
				chk.classSheetStatus(stillsDoc, 'hero'),
			],
			[
				null,
				{ kind: 'isometric', facings: 8 },
				94,
				5,
				['idle'],
				[],
				{
					view: { kind: 'isometric', facings: 8 },
					source: { kind: 'stills' },
					draw: { width: 94 },
					actions: [
						{
							id: 'idle',
							when: { motion: 'still' },
							anim: Object.fromEntries(
								DRAWN.map((f) => [f, { still: { assetKey: KEY, region: `bear_idle_${f}` } }]),
							),
						},
					],
				},
				true,
				[],
				'stills',
				{ sheet: 'hero', inForce: true },
			],
		);
		const kept = docWith({
			view: { kind: 'isometric' },
			source: { kind: 'clips', prefix: 'bear' },
			draw: { width: 70 },
		});
		const before = text(kept);
		const refused = fill.startStillsCharacter(
			kept,
			'hero',
			{ assetKey: KEY, regions: TEN },
			{ prefix: 'bear' },
		);
		const untouched = text(kept) === before;
		const confirmed = fill.startStillsCharacter(
			kept,
			'hero',
			{ assetKey: KEY, regions: TEN, sizes: SIZES },
			{ prefix: 'bear', confirmLoss: true },
		);
		t.same(
			'12. … on a character that has a view, a width and another source: the loss is confirmed first, the view and the width are kept, and the images its view lacks are said',
			[
				refused.refused,
				untouched,
				confirmed.refused,
				confirmed.view,
				confirmed.width,
				of(kept)?.view,
				of(kept)?.draw,
				confirmed.plan.offView.map((c) => c.facing),
				confirmed.filled,
				fits(kept),
			],
			[
				'Changing the source to still images loses the prefix "bear": confirm it first.',
				true,
				null,
				undefined,
				undefined,
				{ kind: 'isometric' },
				{ width: 70 },
				['n', 'e', 's'],
				2,
				true,
			],
		);
	}

	// ── one image for the whole character ────────────────────────────────────────────────────────
	{
		const doc = docWith({
			view: { kind: 'topDown' },
			source: { kind: 'clips', prefix: 'bear' },
			draw: { width: 60 },
			actions: [
				{
					id: 'stand',
					when: { motion: 'still' },
					anim: { s: { clip: 'bear_sit_s' }, e: { clip: 'bear_sit_e' } },
				},
				{ id: 'walk', when: { motion: 'moving' } },
				{ id: 'swipe', when: { ability: 'ability1' }, fallback: 'walk' },
				{ id: 'a', fallback: 'b' },
				{ id: 'b', fallback: 'a' },
			],
		});
		const before = text(doc);
		const refused = fill.useOneStill(doc, 'hero', STILL);
		t.same(
			'12. one image for a whole character: another source’s prefix is confirmed lost first, and nothing is written until then',
			[refused.refused, fill.oneStillText(refused), text(doc) === before],
			[
				'Changing the source to still images loses the prefix "bear": confirm it first.',
				'Changing the source to still images loses the prefix "bear": confirm it first.',
				true,
			],
		);
		const done = fill.useOneStill(doc, 'hero', STILL, { confirmLoss: true });
		t.same(
			'12. … confirmed: the action that stands still gets the image in the start facing, and every other action falls back to it; what it replaced is said',
			[
				done,
				of(doc)?.source,
				of(doc)?.actions?.map((a) => [a.id, a.fallback ?? '']),
				of(doc)?.actions?.[0].anim,
				fits(doc),
				quiet(doc).filter((line) => !line.includes('.anim.e')),
			],
			[
				{
					refused: null,
					action: 'stand',
					facing: 's',
					created: false,
					replaced: { kind: 'clip', clip: 'bear_sit_s' },
					fallbacks: ['walk', 'a'],
					replacedFallbacks: [{ action: 'a', was: 'b' }],
					lost: 'the prefix "bear"',
					missing: [],
				},
				{ kind: 'stills' },
				[
					['stand', ''],
					['walk', 'stand'],
					['swipe', 'walk'],
					['a', 'stand'],
					['b', 'a'],
				],
				{ e: { clip: 'bear_sit_e' }, s: { still: STILL } },
				true,
				[],
			],
		);
		t.same(
			'12. … the cell it did not touch is kept, reported as unread, and said in words',
			[
				sheet.unreadCells(of(doc)).map((c) => `${c.action} ${c.facing} ${c.kind}`),
				fill.oneStillText(done),
			],
			[
				['stand e clip'],
				`Still images: "stand" draws the image facing s, and every other facing from it. It replaced Clip: bear_sit_s. "walk", "a" fall back to it. "a" fell back to "b" before. The source lost the prefix "bear".`,
			],
		);
		const id = sheetStillClipId(STILL);
		t.same(
			'12. … as the game draws it: every action in every facing of the view is that one image',
			(of(doc)?.actions ?? []).flatMap((action) =>
				(['n', 'e', 's', 'w'] as const)
					.map((facing) => resolveSheetClip(of(doc)!, action.id, facing, [], (clip) => clip === id))
					.filter((found) => found?.clipId !== id)
					.map(() => action.id),
			),
			[],
		);
		const fresh = docWith();
		const first = fill.useOneStill(
			fresh,
			'hero',
			{ assetKey: ` ${KEY} `, region: ' crate ' },
			{ width: 48 },
		);
		t.same(
			'12. … on a character with no sheet: still images, "idle" made for it in the start facing, and the width given; it plays, and the validator has nothing to say',
			[first, of(fresh), fits(fresh), quiet(fresh), core.sheetDrawnAs(of(fresh))],
			[
				{
					refused: null,
					action: 'idle',
					facing: 'se',
					created: true,
					fallbacks: [],
					replacedFallbacks: [],
					lost: '',
					missing: [],
				},
				{
					source: { kind: 'stills' },
					draw: { width: 48 },
					actions: [{ id: 'idle', when: { motion: 'still' }, anim: { se: { still: STILL } } }],
				},
				true,
				[],
				'stills',
			],
		);
		const bad = docWith();
		const untouched = text(bad);
		t.same(
			'12. … an image that cannot ship is refused, with nothing written; with no width it says what is missing',
			[
				fill.useOneStill(bad, 'hero', { assetKey: 'cast', region: 'crate' }).refused,
				text(bad) === untouched,
				fill.useOneStill(bad, 'hero', STILL).missing,
				fill.stillMissing(undefined),
				fill.stillMissing({
					view: { kind: '3d' },
					source: { kind: 'stills' },
					draw: { width: 4 },
					actions: [{ id: 'x' }],
				}),
			],
			[
				NOT_A_KEY,
				true,
				['Set a width for the draw box.'],
				['Choose an animation source.', 'Set a width for the draw box.', 'Add an action.'],
				[
					'Pick a view with facings: a 3D view draws no image.',
					'Give one action the trigger "Standing still", or nothing is drawn while it stands.',
				],
			],
		);
	}

	// ── a point tied to a bone ───────────────────────────────────────────────────────────────────
	{
		const doc = docWith({ source: { kind: 'rig', rig: 'otterRig' } });
		const noBox = sheet.setPointBone(doc, 'hero', 'hand', 'hand_r');
		sheet.setDrawWidth(doc, 'hero', '64');
		t.same(
			'12. a point tied to a bone: stored by point name beside the box’s points, changed, and untied by a blank',
			[
				noBox,
				sheet.setPointBone(doc, 'hero', ' hand ', ' hand_r '),
				sheet.setPointBone(doc, 'hero', 'tip', 'nose'),
				sheet.setPointBone(doc, 'hero', 'hand', 'hand_l'),
				text(of(doc)?.draw),
				sheet.bonesOf(of(doc)),
				sheet.setPointBone(doc, 'hero', 'tip', ''),
				sheet.setPointBone(doc, 'hero', ' ', 'nose'),
				sheet.setPointBone(doc, 'hero', 'ghost', ''),
				text(of(doc)?.draw),
				sheet.setPointBone(doc, 'hero', 'hand', ' '),
				text(of(doc)?.draw),
				fits(doc),
			],
			[
				'Give the draw box a width first.',
				null,
				null,
				null,
				'{"width":64,"bones":{"hand":"hand_l","tip":"nose"}}',
				[
					['hand', 'hand_l'],
					['tip', 'nose'],
				],
				null,
				'A point needs a name.',
				null,
				'{"width":64,"bones":{"hand":"hand_l"}}',
				null,
				'{"width":64}',
				true,
			],
		);
		const clips = docWith({ source: { kind: 'clips', prefix: 'bear' }, draw: { width: 60 } });
		const bare = docWith({ draw: { width: 60 } });
		const before = text(clips);
		t.same(
			'12. … only on a rig, in the validator’s words; and no more than the sheet reads',
			[
				sheet.setPointBone(clips, 'hero', 'hand', 'hand_r'),
				sheet.setPointBone(bare, 'hero', 'hand', 'hand_r'),
				text(clips) === before,
				(() => {
					for (let i = 0; i < 16; i++) sheet.setPointBone(doc, 'hero', `p${i}`, 'bone');
					return [sheet.bonesOf(of(doc)).length, sheet.setPointBone(doc, 'hero', 'extra', 'bone')];
				})(),
			],
			[
				'A point follows a bone only on a rig: these are not read.',
				'A point follows a bone only on a rig: these are not read.',
				true,
				[16, 'A sheet reads at most 16 points.'],
			],
		);
	}

	// ── a rig sheet made only with these edits ───────────────────────────────────────────────────
	const rigDoc = docWith();
	{
		const steps: [string, string | null][] = [
			['the view', sheet.setViewKind(rigDoc, 'hero', 'isometric')],
			['the source', src.setSourceKind(rigDoc, 'hero', 'rig', { rig: 'otterRig' }).refused],
			['a rig of a facing', src.setFacingRig(rigDoc, 'hero', 'ne', 'otterBack')],
			['a skin', sheet.addVariant(rigDoc, 'hero', 'marked', 'gold')],
			['the width', sheet.setDrawWidth(rigDoc, 'hero', '64')],
			['a bone', sheet.setPointBone(rigDoc, 'hero', 'hand', 'hand_r')],
			['idle', act.addAction(rigDoc, 'hero', 'idle').refused],
			['idle’s trigger', act.addTrigger(rigDoc, 'hero', 'idle', { motion: 'still' })],
			['wag', act.addAction(rigDoc, 'hero', 'wag').refused],
			['wag’s trigger', act.addTrigger(rigDoc, 'hero', 'wag', { event: 'caught' })],
			[
				'wag’s cell',
				pg.setCellValue(rigDoc, 'hero', 'wag', 'se', {
					kind: 'rig',
					anim: 'wag',
					rig: 'otterTail',
				}),
			],
		];
		t.same(
			'12. a rig sheet made with the tool’s edits alone: each is done, and it is C6a’s fixture key for key',
			[steps.filter(([, refused]) => refused !== null), of(rigDoc)],
			[
				[],
				{
					view: { kind: 'isometric' },
					source: {
						kind: 'rig',
						rig: 'otterRig',
						rigs: { ne: 'otterBack' },
						variants: { marked: 'gold' },
					},
					draw: { width: 64, bones: { hand: 'hand_r' } },
					actions: [
						{ id: 'idle', when: { motion: 'still' } },
						{
							id: 'wag',
							when: { event: 'caught' },
							anim: { se: { anim: 'wag', rig: 'otterTail' } },
						},
					],
				},
			],
		);
		const rigs = rigsOf(
			facts('otterRig', ['idle', 'wag'], ['gold'], ['hand_r']),
			facts('otterBack', ['idle'], ['gold'], ['hand_r']),
			facts('otterTail', ['wag'], ['gold'], ['hand_r']),
		);
		t.same(
			'12. … the save’s validator and the tool have nothing to say of it, the game draws it as a rig, and its class plays it',
			[
				quiet(rigDoc),
				chk.pageIssues(rigDoc).issues,
				chk.sheetWarnings(of(rigDoc), { rigNames: Object.keys(rigs), rigs }),
				sheet.unreadCells(of(rigDoc)),
				core.sheetDrawnAs(of(rigDoc)),
				chk.classSheetStatus(rigDoc, 'hero'),
				src.sheetRigNames(of(rigDoc)),
				fits(rigDoc),
			],
			[
				[],
				[],
				[],
				[],
				'rig',
				{ sheet: 'hero', inForce: true },
				['otterRig', 'otterBack', 'otterTail'],
				true,
			],
		);
		const rigsOnly = docWith();
		src.setSourceKind(rigsOnly, 'hero', 'rig', { rig: 'tmp' });
		src.setFacingRig(rigsOnly, 'hero', 'ne', 'otterBack');
		src.setFacingRig(rigsOnly, 'hero', 'se', 'otterFront');
		src.setSourceRig(rigsOnly, 'hero', '');
		sheet.setDrawWidth(rigsOnly, 'hero', '64');
		act.addAction(rigsOnly, 'hero', 'idle');
		act.addTrigger(rigsOnly, 'hero', 'idle', { motion: 'still' });
		t.same(
			'12. … and a rig sheet of rigs per facing only: drawn as a rig, with nothing to say',
			[
				text(of(rigsOnly)?.source),
				core.sheetDrawnAs(of(rigsOnly)),
				quiet(rigsOnly),
				core.sourceText(of(rigsOnly)!.source!),
			],
			[
				'{"kind":"rig","rigs":{"ne":"otterBack","se":"otterFront"}}',
				'rig',
				[],
				'a rig (ne: otterBack; se: otterFront)',
			],
		);

		// Compare, with the rigs read: what two rig sheets DRAW.
		const live = docWith(of(rigDoc));
		pg.setCellValue(live, 'hero', 'wag', 'se', { kind: 'rig', anim: 'wag' });
		const blind = pg.compareClass(rigDoc, live, [], 'hero', []);
		const seen = pg.compareClass(rigDoc, live, [], 'hero', [], rigs);
		const seenCells = seen.cells.map(pg.cellDifferenceText);
		t.same(
			'12. Compare with the rigs read: a cell that now draws another rig’s animation is listed by what it draws, where without them only the sheets differ',
			[
				blind.cells,
				blind.sheets.length,
				seenCells.filter((line) => line.startsWith('wag, facing se')),
				seenCells.length === 8 && seenCells.every((line) => line.startsWith('wag, facing ')),
				pg.compareClass(rigDoc, docWith(of(rigDoc)), [], 'hero', [], rigs).safe,
			],
			[
				[],
				1,
				[
					'wag, facing se: wag (otterTail) → wag (otterRig).',
					'wag, facing se while marked: wag (otterTail) (marked) → wag (otterRig) (marked).',
				],
				true,
				true,
			],
		);
	}

	// ── both through the page's load and the real save and load ──────────────────────────────────
	for (const [name, doc] of [
		['a rig sheet made with the tool', rigDoc],
		['a stills sheet made by Fill from names', stillsDoc],
	] as const) {
		const made = text(of(doc));
		const bytes = await roundTrip(t, '12', name, doc);
		const kept = bytes ? (JSON.parse(bytes) as GameConfigDoc) : undefined;
		t.check(
			`12. round trip, ${name}: the stored sheet is the one the edits made, byte for byte, and its class still names it`,
			!!kept &&
				text(sheet.sheetFieldsOf(kept.arcade?.characters?.[0])) === made &&
				kept.arcade?.online?.characters?.[0].sheet === 'hero',
			bytes,
		);
	}

	// ── pure ─────────────────────────────────────────────────────────────────────────────────────
	for (const file of [
		'characterSheetSources.ts',
		'characterSheetFill.ts',
		'characterSheetRigGrid.ts',
		'characterSheetPage.ts',
		'sheetCore.ts',
	]) {
		const source = readFileSync(
			new URL(`../../src/lib/characters/${file}`, import.meta.url),
			'utf8',
		);
		t.check(
			`12. ${file} is pure: no Svelte, no server module, no structuredClone (it reads source text)`,
			!/from '(svelte|\$app|\$lib\/server|\$env)/.test(source) &&
				!source.includes('structuredClone('),
		);
	}
};
