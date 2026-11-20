/**
 * §16 of `check:characters-tool` — THE SHEETS THE SALMONS PLAYTEST PLAYS ARE THE TOOL'S (character
 * pipeline C6b). `scripts/playtest/salmons-play.mjs --rig` boots a salmon whose sheet names a rig
 * (with its `marked` skin variant and the bone its hand follows) and a bear whose sheet is still
 * images. Both are made here, on Salmons' own config, with nothing but Invisible Characters' edits
 * (`$lib/characters`), and `scripts/playtest/fixtures/salmons-tool-rig.json` is held equal to
 * them: the playtest cannot import the tool, so it reads the file.
 *
 * Re-record:  pnpm --filter launcher-api check:characters-tool --record-tool-rig
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeGameConfigDoc, validateCharacterSheets, type GameConfigDoc } from 'game-config';
import {
	addAction,
	addTrigger,
	setActionFallback,
} from '../../src/lib/characters/characterSheetActions.ts';
import {
	addVariant,
	findClass,
	linkClassSheet,
	makeClassSheet,
	setPointBone,
	sheetOf,
} from '../../src/lib/characters/characterSheetEdit.ts';
import { useOneStill } from '../../src/lib/characters/characterSheetFill.ts';
import { setCellValue } from '../../src/lib/characters/characterSheetPage.ts';
import { setSourceKind } from '../../src/lib/characters/characterSheetSources.ts';
import { salmonsConfig } from '../../../../packages/engine-mechanics/src/salmons.js';
import type { Section } from './harness';

const { SALMONS_CHARACTER_COMPONENTS } =
	await import('../../../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts');

const FIXTURE = fileURLToPath(
	new URL('../../../../scripts/playtest/fixtures/salmons-tool-rig.json', import.meta.url),
);

/** The art the playtest draws: its stub rig (a `gold` skin, a `hand` bone) and two frames of its
 *  stub sheet (`salmons-play.mjs` `CLIP_SHEET`), the bear drawn 60 wide. */
const RIG = 'salmonRig';
const STUB_SHEET = 'invisible_wall/salmons/manifests/atlas_manifest_S_SalmonStub.json';
const STILL = { assetKey: STUB_SHEET, region: 'stub2' };
const SWIPE = { kind: 'still', assetKey: STUB_SHEET, region: 'stub3' } as const;

export const run: Section = ({ check, same }) => {
	const doc = normalizeGameConfigDoc(salmonsConfig()) as GameConfigDoc;
	const blockOf = (classId: string) =>
		SALMONS_CHARACTER_COMPONENTS.find((look) => look.id === findClass(doc, classId)?.body)
			?.characterClips;

	// The salmon: *Make this a sheet* of the block it plays, the source changed to a rig (which
	// loses the block's prefix and variant, so it is confirmed), the skin worn while it is golden,
	// and the bone its hand follows.
	const salmonBlock = blockOf('salmon');
	const made = makeClassSheet(doc, 'salmon', salmonBlock ?? { prefixes: { base: '' } });
	const salmon = made.characterId ?? '';
	const unconfirmed = setSourceKind(doc, salmon, 'rig', { rig: RIG });
	const toRig = setSourceKind(doc, salmon, 'rig', { rig: RIG, confirmLoss: true });
	const salmonEdits = [
		made.refused,
		toRig.refused,
		addVariant(doc, salmon, 'marked', 'gold'),
		setPointBone(doc, salmon, 'hand', 'hand'),
	];
	check(
		'16. the salmon: every edit is accepted, on a new character for the class’s look',
		!!salmonBlock && made.created === true && salmonEdits.every((refused) => refused === null),
		JSON.stringify(salmonEdits),
	);
	check(
		'16. … the change to a rig is refused until the loss of the prefix and its variant is confirmed',
		!!unconfirmed.refused && toRig.lost !== '',
		JSON.stringify([unconfirmed.refused, toRig.lost]),
	);
	same('16. … and leaves no cell the rig does not read', toRig.unread, []);

	// The bear: its bot's character is the first of its look. One image for the whole character
	// (which makes `idle`), a walk that stands in from it, a swipe with an image of its own, and
	// the class told to draw from it.
	const bear = (doc.arcade?.characters ?? []).find(
		(c) => c.component === findClass(doc, 'bear')?.body,
	)?.id;
	const one = useOneStill(doc, bear ?? '', STILL, { width: 60 });
	const bearEdits = [
		one.refused,
		addAction(doc, bear ?? '', 'walk').refused,
		addTrigger(doc, bear ?? '', 'walk', { motion: 'moving' }),
		setActionFallback(doc, bear ?? '', 'walk', one.action ?? ''),
		addAction(doc, bear ?? '', 'swipe').refused,
		addTrigger(doc, bear ?? '', 'swipe', { ability: 'ability1' }),
		setCellValue(doc, bear ?? '', 'swipe', one.facing ?? 'se', SWIPE),
		setActionFallback(doc, bear ?? '', 'swipe', one.action ?? ''),
		linkClassSheet(doc, 'bear', bear ?? ''),
	];
	check(
		'16. the bear: every edit is accepted, on the character its bot already is',
		!!bear && one.created && bearEdits.every((refused) => refused === null),
		JSON.stringify(bearEdits),
	);
	same('16. … with nothing left for it to be drawn', one.missing, []);
	same(
		'16. the save’s validator has nothing to say of either sheet',
		validateCharacterSheets(doc).map((issue) => `${issue.path}: ${issue.message}`),
		[],
	);

	const fixture = {
		salmon: {
			class: 'salmon',
			character: (doc.arcade?.characters ?? []).find((c) => c.id === salmon),
		},
		bear: { class: 'bear', character: bear, sheet: sheetOf(doc, bear ?? '') },
	};
	if (process.argv.includes('--record-tool-rig'))
		writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, '\t')}\n`);
	same(
		'16. they are the sheets the Salmons playtest plays with --rig (re-record: --record-tool-rig)',
		JSON.parse(readFileSync(FIXTURE, 'utf8')),
		JSON.parse(JSON.stringify(fixture)),
	);
};
