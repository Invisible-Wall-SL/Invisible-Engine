/**
 * check:characters-tool — Invisible Characters (`/characters`, `docs/design/game-families.md` §4.3,
 * §5.1, P10.11): the page's pure helpers, run on real config docs.
 *
 *   pnpm --filter launcher-api check:characters-tool
 *
 *  1. THE EDITS MIRROR THE NORMALIZER. Every character, movement, controller, brain and anim-input
 *     edit (`$lib/characters/characterEdit.ts`, P10.13's gravity, jump and flap too) leaves the doc exactly as a save would store it, so
 *     the page never looks dirty for a value a save drops; refused values leave the doc alone.
 *  2. ADD / DUPLICATE / RENAME / DELETE, and the brain's renames and deletes reaching everything that
 *     names a state (transitions, the initial state, `state:<id>` anim inputs).
 *  3. THE GRAPH. Entry → initial, Any → the `*` transitions; what a wire between two cards means.
 *  4. THE SANDBOX drives the game's own characters stage (`engine-game` `createCharacterStage`), not
 *     a copy. Same seed and input ⇒ the same run; a step is exactly `behaviours.js` + `steer` +
 *     `stepSolid` driven by hand; walls stop the character (`hitSolid`); a controller follows the
 *     keys; a bot is the brain; `shootAt` fires; anim inputs are what the stage writes; `variable`
 *     conditions read the sandbox's stand-in variables.
 *     P10.13: gravity, a side-view jump (its height and time, a tap, `up`), a flap, a hop over a
 *     `ground` wall, a one-way platform, all as the stage steps them; a plain top-down run has no
 *     contact readout.
 *  6. ABILITIES AND ZONE FORCES (P11.5): each edit stores what a save stores; rename and removal
 *     follow them; the page has both sections.
 *  5. THE REGISTRY. The tool, its roles (Game Config's), its stage and its guide (rule 9).
 *  7. THE WHOLE VIEW (character pipeline C1): every character from its four homes joined into one
 *     row on the Salmons reference config (a class and its bot's brain share a look: one row), its
 *     clips exactly Flipbook's (`projectCharacters`), the view and source today's fields imply, what
 *     is missing, a 3D look joined by id, and a read that changes nothing.
 *  8. THE SHEET EDITOR (character pipeline C2b): every edit of a character sheet
 *     (`characterSheetEdit.ts`, `characterSheetActions.ts`) stores exactly what
 *     `normalizeCharacterSheet` makes of it, key for key, and refuses what cannot be stored; a
 *     rename, a removal and a look change keep each online class's `sheet` in step; *Make this a
 *     sheet* writes `sheetOfCharacterClips` of the block each Salmons character plays, and
 *     *Compare with the saved config* (`characterSheetCheck.ts`) then lists nothing, and lists
 *     every later change; the tool's warnings; the page's issues are the save's; and a config goes
 *     through the page's load and the real save and load (over an in-memory R2) byte for byte.
 *  9. THE SHEET ON THE PAGE (character pipeline C2b): what the page decides beyond one edit
 *     (`characterSheetPage.ts`): the link that opens a card, the classes with no character, what
 *     *Make this a sheet* is made from, *Compare* as the page wires it (the stored config against
 *     the live one), one cell's value, the words for what a rename, a removal and a look change
 *     did; the Whole view on Salmons given a sheet; one validation (`sheetCore.ts`: the page's,
 *     Game Config's and the save's issues are one list, and why a sheet is not played is decided
 *     once); and the page rendered on the server: a config with no sheet shows only the entry
 *     card and is not written to, a config with a sheet shows its five cards. The Online class
 *     card gives a class its touch scheme (`arcade.online.touch`) with Game Config's select and
 *     setter, says the scheme in one line and links to Game Config's card; it edits no scheme.
 * 10. THE PAGE'S EDITS AND ITS SAVE, AS WIRED (C2b review): a re-read asked for during a read is
 *     rerun once (`singleFlight.ts`), and *Make this a sheet* and *Compare* answer from a fresh
 *     read; the sheet lands on the character named; ＋ Add adds the next trigger of its kind; a
 *     rename's note and the cards' mount; and the page's own save wiring (`pageSave.ts`) with the
 *     REAL `SaveState` and `LeaseState`, compiled as the app compiles them, against the REAL
 *     `PUT /api/game-config` over an in-memory R2 whose ETags are of the stored bytes: a config
 *     with a sheet, a 3D world and `models` through the route byte for byte, a matching ETag
 *     saved, a stale one refused (409) with the stored config and Compare's baseline untouched,
 *     an edit during the flight refused, and a read-only lease making no request. Touch schemes
 *     go through the same route and the same load, and a config with none stores no `touch` key.
 *     Checks that only read source text say so in their label.
 * 11. A RIG, STILL IMAGES AND CELLS THAT ARE NOT CLIPS (C6a), under every other edit: each edit of
 *     the view, the box, the actions, the class and the character keeps the source, the bones and
 *     those cells key for key; the clip field never writes over one; a kind the source does not
 *     draw is refused in the validator's words; Compare, the warnings and the Whole view name
 *     each source by its kind.
 * 12. SOURCES, RIGS AND STILL IMAGES ON THE SHEET (character pipeline C6b,
 *     `./charactersTool/sources.ts`): choosing and changing the source's kind with nothing lost
 *     silently, a rig source and its rigs per facing, skins, the three kinds of cell, the cells a
 *     source does not read, the rig grid held equal to `resolveSheetRig`, *Fill from names*, one
 *     image for a whole character, a point tied to a bone, and a rig sheet and a stills sheet
 *     made only with those edits through the real save and load byte for byte.
 * 17. A SHEET'S SMOOTH TURN (`view.turn`, `./charactersTool/turn.ts`): the View card's three
 *     edits (sparse, refused out of range, dropped by a side view, held in range by a change of
 *     facings), the turn preview's driver over the game's own animator (off it snaps, on it leans
 *     and sweeps through the facings in between; clips, still images, a rig, a mirrored facing),
 *     the clip parts it shares with the directions preview, and the card and the preview as
 *     written.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isHttpError } from '@sveltejs/kit';
import { compileModule } from 'svelte/compiler';
import ts from 'typescript';
import {
	ARCADE_TOUCH_DEFAULTS,
	CHARACTER_FACINGS,
	CHARACTER_SHEET_LIMITS,
	characterTriggers,
	normalizeCharacterSheet,
	normalizeGameConfigDoc,
	validateGameConfigDoc,
	withCharacterSheets,
	type ArcadeCharacter,
	type CharacterSheet,
	type GameConfigDoc,
	type GameConfigIssue,
} from 'game-config';
import { resolveCharacterClip, sheetOfCharacterClips, type CharacterClips } from 'engine-layout';
import {
	BEHAVIOUR_DEFAULTS,
	DEFAULT_COYOTE_MS,
	brainVelocity,
	createBrain,
	createBrainWorld,
	createRng,
	steer,
	stepBrain,
	stepBody,
	stepSolid,
	type Body,
} from 'engine-mechanics';
import * as edit from '../src/lib/characters/characterEdit.ts';
import {
	ANY_NODE,
	ENTRY_NODE,
	INITIAL_EDGE,
	brainConnection,
	brainGraph,
} from '../src/lib/characters/brainGraph.ts';
import {
	FALLBACK_BODY,
	PLAYER_SIZE,
	PLAYER_TAG,
	SANDBOX_CHARACTER_BODY,
	createSandbox,
	parseVariables,
	replay,
	startOf,
	wallsFor,
	PLATFORM_WALLS,
	HOP_WALLS,
	DEFAULT_WALLS,
	type SandboxInput,
	type SandboxSetup,
} from '../src/lib/characters/sandbox.ts';
import { ROLE_TOOLS, TOOLS, TOOL_STAGES, toolDocPath } from '../src/lib/roles.ts';
import { moreR2, standIns } from './charactersTool/routeStandIns.ts';
import {
	characterGaps,
	impliedSource,
	impliedView,
	wholeCharacters,
	type WholeComponent,
} from '../src/lib/characters/characterWhole.ts';
import { projectCharacters, sheetProblemOf } from '../src/lib/flipbook/projectCharacters.ts';
import {
	characterClipNames,
	characterGrid,
	clipIdOf,
	isClipIdText,
	triggerText,
} from '../src/lib/flipbook/characterSet.ts';
import * as sheet from '../src/lib/characters/characterSheetEdit.ts';
import * as touchDoc from '../src/routes/(app)/config/touchDoc.ts';
import * as act from '../src/lib/characters/characterSheetActions.ts';
import * as chk from '../src/lib/characters/characterSheetCheck.ts';
import * as pg from '../src/lib/characters/characterSheetPage.ts';
import * as core from '../src/lib/characters/sheetCore.ts';
import { afterReread, singleFlight } from '../src/lib/characters/singleFlight.ts';
import { fakeStoredGrants } from './charactersTool/routes.ts';
import {
	editRefusal,
	pageEdits,
	pageSaveTransport,
} from '../src/routes/(app)/characters/pageSave.ts';
import type { SaveState as SaveStateClass } from '../src/lib/saveState.svelte.ts';
import type { LeaseState as LeaseStateClass } from '../src/lib/leaseState.svelte.ts';
import { bodyFor, openDoc } from '../src/routes/(app)/config/pageDoc.ts';
import * as configPage from '../src/routes/(app)/config/pageDoc.ts';
import { setOnlineCharacterField } from '../src/routes/(app)/config/onlineDoc.ts';
import { roundTrip, setRoundTrip } from './charactersTool/roundTrip.ts';
import { salmonsConfig } from '../../../packages/engine-mechanics/src/salmons.js';
import { salmonsBeforeItsBotSalmon } from './charactersTool/salmonsBefore.ts';
const { SALMONS_CHARACTER_COMPONENTS } =
	await import('../../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts');

let passes = 0;
let fails = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
	if (ok) passes++;
	else {
		fails++;
		console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
	}
};
/** JSON with sorted keys: what a doc holds, whatever order an edit wrote it in. */
const canon = (v: unknown): string =>
	JSON.stringify(v, (_k, value: unknown) =>
		value && typeof value === 'object' && !Array.isArray(value)
			? Object.fromEntries(
					Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
				)
			: value,
	);
const same = (name: string, actual: unknown, expected: unknown): void =>
	check(name, canon(actual) === canon(expected), `${canon(actual)} ≠ ${canon(expected)}`);

const base = (): GameConfigDoc =>
	normalizeGameConfigDoc({
		family: 'arcade',
		outcome: 'rules',
		arcade: {
			bodies: {
				goblin: { shape: 'box', w: 40, h: 40, tags: ['enemy'] },
				hero: { shape: 'circle', r: 20, tags: ['player'] },
			},
		},
	})!;
const chars = (doc: GameConfigDoc): ArcadeCharacter[] => doc.arcade?.characters ?? [];

/** Apply `run` and require the doc to be what a save would store. */
function mirrored(name: string, doc: GameConfigDoc, run: (d: GameConfigDoc) => void): void {
	run(doc);
	same(
		`1. ${name}: the doc is what a save stores`,
		normalizeGameConfigDoc(structuredClone(doc)),
		doc,
	);
}

// ── 1 + 2. Characters ─────────────────────────────────────────────────────────────────────────
{
	const doc = base();
	check(
		'2. no look, no character',
		edit.addCharacter(doc, '  ') === undefined && !doc.arcade?.characters,
	);
	let id: string | undefined;
	mirrored('add', doc, (d) => (id = edit.addCharacter(d, 'goblin')));
	same('2. add: id from the look', chars(doc), [{ id: 'goblin', component: 'goblin' }]);
	check('2. add twice: a fresh id', edit.addCharacter(doc, 'goblin') === 'goblin2');
	edit.removeCharacter(doc, 'goblin2');
	mirrored('name', doc, (d) => edit.setCharacterName(d, id!, ' Grunt '));
	same('2. name trimmed', chars(doc)[0].name, 'Grunt');
	mirrored('blank name', doc, (d) => edit.setCharacterName(d, id!, ' '));
	check('2. blank name deleted', !('name' in chars(doc)[0]));
	mirrored('rename', doc, (d) => edit.renameCharacter(d, 'goblin', 'guard'));
	check('2. renamed', chars(doc)[0].id === 'guard');
	edit.addCharacter(doc, 'hero');
	same(
		'2. rename onto a taken id is refused',
		edit.renameCharacter(doc, 'guard', 'hero'),
		'A character is already called "hero".',
	);
	same(
		'2. a blank id is refused',
		edit.renameCharacter(doc, 'guard', ' '),
		'An id cannot be blank.',
	);
	mirrored('duplicate', doc, (d) => edit.duplicateCharacter(d, 'guard'));
	same(
		'2. the copy lands after it with a fresh id',
		chars(doc).map((c) => c.id),
		['guard', 'guardCopy', 'hero'],
	);
	check(
		'2. the copy shares the look until changed, which the validator refuses',
		validateGameConfigDoc(doc).some(
			(i) => i.path === 'arcade.characters[1].component' && i.severity === 'error',
		),
	);
	mirrored('look', doc, (d) => edit.setLook(d, 'guardCopy', 'scout'));
	edit.setLook(doc, 'guardCopy', ' ');
	check('2. a blank look is refused', chars(doc)[1].component === 'scout');
	mirrored('delete', doc, (d) => {
		edit.removeCharacter(d, 'guardCopy');
		edit.removeCharacter(d, 'hero');
	});
	mirrored('delete the last', doc, (d) => edit.removeCharacter(d, 'guard'));
	check('2. the last delete drops the key', !('characters' in (doc.arcade ?? {})));
	same('2. the bodies stay', Object.keys(doc.arcade?.bodies ?? {}), ['goblin', 'hero']);
}

// ── 1. Movement and controller ────────────────────────────────────────────────────────────────
{
	const doc = base();
	edit.addCharacter(doc, 'hero');
	mirrored('movement', doc, (d) => {
		edit.setMovement(d, 'hero', 'accel', '800');
		edit.setMovement(d, 'hero', 'maxSpeed', '240');
	});
	same('1. movement stored', chars(doc)[0].movement, { accel: 800, maxSpeed: 240 });
	mirrored('movement cleared', doc, (d) => {
		edit.setMovement(d, 'hero', 'accel', '');
		edit.setMovement(d, 'hero', 'maxSpeed', '-1');
	});
	check('1. an empty movement is deleted', !('movement' in chars(doc)[0]));
	mirrored('controller', doc, (d) => edit.setController(d, 'hero', 'topDown'));
	same('1. a keyboard controller at the default speed', chars(doc)[0].controller, {
		kind: 'topDown',
		speed: edit.DEFAULT_CONTROLLER_SPEED,
	});
	edit.setControllerSpeed(doc, 'hero', '');
	same('1. a keyboard speed cannot be blank', chars(doc)[0].controller?.speed, 200);
	mirrored('controller kind keeps its speed', doc, (d) => {
		edit.setControllerSpeed(d, 'hero', '320');
		edit.setController(d, 'hero', 'sideScroll');
	});
	same('1. side-scroll at 320', chars(doc)[0].controller, { kind: 'sideScroll', speed: 320 });
	mirrored('pointer', doc, (d) => {
		edit.setController(d, 'hero', 'pointer');
		edit.setPointerAxes(d, 'hero', 'xy');
		edit.setControllerSpeed(d, 'hero', '500');
	});
	same('1. pointer', chars(doc)[0].controller, { kind: 'pointer', axes: 'xy', speed: 500 });
	mirrored('pointer speed cleared', doc, (d) => edit.setControllerSpeed(d, 'hero', ''));
	mirrored('no controller', doc, (d) => edit.setController(d, 'hero', 'none'));
	check('1. none deletes it', !('controller' in chars(doc)[0]));
}

// ── 1. Gravity, jumps and flaps (P10.13) ──────────────────────────────────────────────────────
{
	const doc = base();
	edit.addCharacter(doc, 'hero');
	const hero = () => chars(doc)[0];
	const jumpIssues = () =>
		validateGameConfigDoc(doc).filter((i) => i.path.startsWith('arcade.characters[0].controller'));
	check(
		'1. movement lists gravity and max fall, each labelled',
		edit.MOVEMENT_KEYS.includes('gravity') &&
			edit.MOVEMENT_KEYS.includes('maxFall') &&
			edit.MOVEMENT_KEYS.every((k) => !!edit.MOVEMENT_LABELS[k]),
	);
	mirrored('gravity', doc, (d) => {
		edit.setMovement(d, 'hero', 'gravity', '1800');
		edit.setMovement(d, 'hero', 'maxFall', '900');
	});
	same('1. gravity and max fall stored', hero().movement, { gravity: 1800, maxFall: 900 });
	mirrored('gravity cleared', doc, (d) => {
		edit.setMovement(d, 'hero', 'gravity', '');
		edit.setMovement(d, 'hero', 'maxFall', '-5');
	});
	check('1. no gravity, no movement', !('movement' in hero()));

	edit.setJump(doc, 'hero', true);
	check('1. no controller, no jump', !hero().controller);
	edit.setController(doc, 'hero', 'sideScroll');
	mirrored('jump on (side-scroll)', doc, (d) => edit.setJump(d, 'hero', true));
	same('1. a side-scroll takes a gravity jump at the defaults', edit.jumpOf(hero()), {
		kind: 'gravity',
		height: edit.DEFAULT_JUMP_HEIGHT,
		time: edit.DEFAULT_JUMP_TIME,
	});
	same('1. … which the validator accepts', jumpIssues(), []);
	mirrored('jump fields', doc, (d) => {
		edit.setJumpField(d, 'hero', 'height', '150');
		edit.setJumpField(d, 'hero', 'time', '0.5');
		edit.setJumpField(d, 'hero', 'minHeight', '40');
		edit.setJumpField(d, 'hero', 'coyoteMs', '80');
		edit.setJumpField(d, 'hero', 'bufferMs', '120');
		edit.setJumpField(d, 'hero', 'airControl', '0.5');
	});
	same('1. jump fields stored', edit.jumpOf(hero()), {
		kind: 'gravity',
		height: 150,
		time: 0.5,
		minHeight: 40,
		coyoteMs: 80,
		bufferMs: 120,
		airControl: 0.5,
	});
	mirrored('refused jump fields', doc, (d) => {
		edit.setJumpField(d, 'hero', 'height', '');
		edit.setJumpField(d, 'hero', 'time', '0');
		edit.setJumpField(d, 'hero', 'coyoteMs', '-1');
		edit.setJumpField(d, 'hero', 'airControl', '-0.2');
	});
	same(
		'1. height and time cannot be blank or 0; negatives are ignored',
		[edit.jumpOf(hero())?.height, edit.jumpOf(hero())?.time, edit.jumpOf(hero())?.coyoteMs],
		[150, 0.5, 80],
	);
	same('1. … nor a negative air control', edit.jumpOf(hero())?.airControl, 0.5);
	mirrored('jump fields at their defaults', doc, (d) => {
		edit.setJumpField(d, 'hero', 'minHeight', '');
		edit.setJumpField(d, 'hero', 'coyoteMs', String(DEFAULT_COYOTE_MS));
		edit.setJumpField(d, 'hero', 'bufferMs', '');
		edit.setJumpField(d, 'hero', 'airControl', '1');
	});
	same('1. a field at its default is not stored', edit.jumpOf(hero()), {
		kind: 'gravity',
		height: 150,
		time: 0.5,
	});
	same(
		'1. the hint: launch 2h/t, pull 2h/t², a tap cut from minHeight',
		edit.jumpHint({ kind: 'gravity', height: 150, time: 0.5, minHeight: 40 }),
		{ launch: 600, gravity: 1200, cut: Math.sqrt(2 * 1200 * 40) },
	);
	mirrored('to top-down', doc, (d) => edit.setController(d, 'hero', 'topDown'));
	same('1. the kind follows the controller: a top-down hop', edit.jumpOf(hero()), {
		kind: 'hop',
		height: 150,
		time: 0.5,
	});
	same('1. … which the validator accepts', jumpIssues(), []);
	mirrored('back to side-scroll', doc, (d) => edit.setController(d, 'hero', 'sideScroll'));
	same('1. … and back to a gravity jump', edit.jumpOf(hero())?.kind, 'gravity');
	mirrored('jump off', doc, (d) => edit.setJump(d, 'hero', false));
	same('1. jump off deletes it', hero().controller, { kind: 'sideScroll', speed: 200 });
	edit.setJump(doc, 'hero', true);
	mirrored('pointer drops the jump', doc, (d) => edit.setController(d, 'hero', 'pointer'));
	check('1. a pointer has no jump', edit.jumpOf(hero()) === undefined);
	edit.setJump(doc, 'hero', true);
	check('1. … and takes none', edit.jumpOf(hero()) === undefined);
	same('1. only top-down and side-scroll take a jump', edit.JUMP_KIND_FOR, {
		sideScroll: 'gravity',
		topDown: 'hop',
	});

	edit.setController(doc, 'hero', 'sideScroll');
	edit.setControllerSpeed(doc, 'hero', '260');
	mirrored('flap', doc, (d) => edit.setController(d, 'hero', 'flap'));
	same('1. a flap at the default kick keeps the speed', hero().controller, {
		kind: 'flap',
		kick: edit.DEFAULT_FLAP_KICK,
		speed: 260,
	});
	mirrored('flap kick and speed', doc, (d) => {
		edit.setFlapKick(d, 'hero', '420');
		edit.setFlapKick(d, 'hero', '0');
		edit.setFlapKick(d, 'hero', '');
		edit.setControllerSpeed(d, 'hero', '');
	});
	same('1. a kick above 0; a blank flap speed deletes it', hero().controller, {
		kind: 'flap',
		kick: 420,
	});
	check(
		'1. a flap with no gravity is warned about',
		validateGameConfigDoc(doc).some((i) => i.path === 'arcade.characters[0].movement.gravity'),
	);
	edit.setJump(doc, 'hero', true);
	check('1. a flap takes no jump', !('jump' in hero().controller!));
	mirrored('flap → side-scroll', doc, (d) => edit.setController(d, 'hero', 'sideScroll'));
	same('1. off a speedless flap: the default speed', hero().controller, {
		kind: 'sideScroll',
		speed: edit.DEFAULT_CONTROLLER_SPEED,
	});
	mirrored('flap → none', doc, (d) => edit.setController(d, 'hero', 'none'));

	same(
		'1. the true / false sources fit a bool input, the rest a number',
		['moving', 'grounded', 'onWall', 'airborne', 'state:x', 'speed', 'vy', 'height', 'facing'].map(
			(source) => edit.animSourceIsBool(source as Parameters<typeof edit.animSourceIsBool>[0]),
		),
		[true, true, true, true, true, false, false, false, false],
	);
	check(
		'1. the source picker lists every P10.13 source',
		['grounded', 'onWall', 'airborne', 'height'].every((s) =>
			edit.animSourcesFor(hero()).includes(s as never),
		),
	);
}

// ── 1 + 2. Brain ──────────────────────────────────────────────────────────────────────────────
{
	const doc = base();
	edit.addCharacter(doc, 'goblin');
	let patrol: string | undefined;
	mirrored('first state', doc, (d) => (patrol = edit.addState(d, 'goblin', 'patrol')));
	same('2. the first state is the brain and its start', chars(doc)[0].brain?.initial, 'patrol');
	mirrored('more states', doc, (d) => {
		edit.addState(d, 'goblin', 'chase', { x: 400.4, y: 99.6 });
		edit.addState(d, 'goblin', 'chase');
	});
	same(
		'2. ids from the behaviour, made unique; places whole px',
		chars(doc)[0].brain?.states.map((s) => [s.id, s.pos]),
		[
			['patrol', { x: 240, y: 40 }],
			['chase', { x: 400, y: 100 }],
			['chase2', { x: 680, y: 40 }],
		],
	);
	let t1: string | undefined;
	let t2: string | undefined;
	mirrored('transitions', doc, (d) => {
		t1 = edit.addTransition(d, 'goblin', patrol!, 'chase');
		t2 = edit.addTransition(d, 'goblin', '*', 'chase2');
		edit.addCondition(d, 'goblin', t1!, 'targetWithin');
		edit.addCondition(d, 'goblin', t2!, 'random');
		edit.addCondition(d, 'goblin', t2!, 'variable');
	});
	check(
		'2. a transition to no state is refused',
		!edit.addTransition(doc, 'goblin', 'chase', 'nope'),
	);
	mirrored('condition fields', doc, (d) => {
		edit.setConditionField(d, 'goblin', t1!, 0, 'px', '150');
		edit.setConditionField(d, 'goblin', t1!, 0, 'px', '-5');
		edit.setConditionField(d, 'goblin', t1!, 0, 'tag', ' ');
		edit.setConditionField(d, 'goblin', t2!, 0, 'chance', '1.5');
		edit.setConditionField(d, 'goblin', t2!, 0, 'every', '1000');
		edit.setConditionField(d, 'goblin', t2!, 0, 'every', '250');
		edit.setConditionField(d, 'goblin', t2!, 1, 'value', '3');
		edit.setConditionField(d, 'goblin', t2!, 1, 'op', '=>');
		edit.setConditionField(d, 'goblin', t2!, 1, 'id', '');
	});
	same(
		'2. refused values leave the condition; a 1000 ms `every` is the default',
		chars(doc)[0].brain?.transitions.map((t) => t.when),
		[
			[{ kind: 'targetWithin', tag: 'player', px: 150 }],
			[
				{ kind: 'random', chance: 0.5, every: 250 },
				{ kind: 'variable', id: 'flag', op: '==', value: 3 },
			],
		],
	);
	same(
		'3. the label',
		edit.transitionText(chars(doc)[0].brain!.transitions[0]),
		'player within 150 px',
	);
	mirrored('params', doc, (d) => {
		edit.setParam(d, 'goblin', 'chase', 'speed', '220');
		edit.setParam(d, 'goblin', 'chase', 'range', String(BEHAVIOUR_DEFAULTS.chase.range));
		edit.setParam(d, 'goblin', 'chase', 'tag', 'hero');
		edit.setParam(d, 'goblin', 'patrol', 'pingPong', false);
		edit.setParam(d, 'goblin', 'patrol', 'path', 'route');
		edit.setParam(d, 'goblin', 'patrol', 'nonsense', '3');
	});
	same(
		'2. a default param is not stored; an unknown one is refused',
		chars(doc)[0].brain?.states.map((s) => s.params),
		[{ pingPong: false, path: 'route' }, { speed: 220, tag: 'hero' }, undefined],
	);
	mirrored('behaviour switch', doc, (d) => edit.setBehaviour(d, 'goblin', 'chase', 'flee'));
	same('2. the switch keeps the params flee reads', chars(doc)[0].brain?.states[1].params, {
		speed: 220,
		tag: 'hero',
	});
	mirrored('anim inputs', doc, (d) => {
		edit.setAnimInput(d, 'goblin', 'speed', 'speed');
		edit.setAnimInput(d, 'goblin', 'angry', 'state:chase');
	});
	mirrored('rename a state', doc, (d) => edit.renameState(d, 'goblin', 'chase', 'hunt'));
	const brain = chars(doc)[0].brain!;
	same(
		'2. a state rename reaches its transitions and anim inputs',
		[brain.transitions[0].to, chars(doc)[0].animInputs?.angry],
		['hunt', 'state:hunt'],
	);
	same(
		'2. "*" cannot be a state',
		edit.renameState(doc, 'goblin', 'hunt', '*'),
		'"*" means any state; pick another id.',
	);
	mirrored('rename the initial state', doc, (d) => edit.renameState(d, 'goblin', 'patrol', 'walk'));
	same('2. … and the start', [brain.initial, brain.transitions[0].from], ['walk', 'walk']);
	mirrored('move a transition', doc, (d) => edit.moveTransition(d, 'goblin', t2!, -1));
	same(
		'2. transitions reorder',
		brain.transitions.map((t) => t.id),
		[t2, t1],
	);
	mirrored('drop a state', doc, (d) => edit.removeState(d, 'goblin', 'hunt'));
	same(
		'2. dropping a state drops its transitions and the inputs that followed it',
		[brain.transitions.map((t) => t.id), chars(doc)[0].animInputs],
		[[t2], { speed: 'speed' }],
	);
	mirrored('drop the initial state', doc, (d) => edit.removeState(d, 'goblin', 'walk'));
	same('2. the start moves to the first state left', brain.initial, 'chase2');
	mirrored('drop the last state', doc, (d) => edit.removeState(d, 'goblin', 'chase2'));
	check('2. the last state drops the brain', !('brain' in chars(doc)[0]));
	same(
		'2. the issues of one character, by path',
		edit
			.characterIssues(
				[
					{ severity: 'error', path: 'arcade.characters[1].component', message: 'a' },
					{ severity: 'error', path: 'arcade.characters[10]', message: 'b' },
					{ severity: 'error', path: 'arcade.characters[1]', message: 'c' },
				],
				1,
			)
			.map((i) => i.message),
		['a', 'c'],
	);
	same(
		'1. param fallbacks are behaviours.js defaults',
		edit.behaviourParams('wander').map((p) => [p.key, p.fallback]),
		Object.entries(BEHAVIOUR_DEFAULTS.wander),
	);
	same(
		'1. anim sources: the plain ones and one per state',
		edit.animSourcesFor({
			id: 'x',
			component: 'x',
			brain: { initial: 'a', states: [{ id: 'a', behaviour: 'idle' }], transitions: [] },
		}),
		[
			'speed',
			'vx',
			'vy',
			'facing',
			'moving',
			'grounded',
			'onWall',
			'airborne',
			'height',
			'state:a',
		],
	);
}

// ── 3. The graph ──────────────────────────────────────────────────────────────────────────────
{
	const g = brainGraph({
		initial: 'b',
		states: [
			{ id: 'a', behaviour: 'idle', pos: { x: 5, y: 6 } },
			{ id: 'b', behaviour: 'chase' },
		],
		transitions: [
			{ id: 't1', from: '*', to: 'a', when: [{ kind: 'timer', ms: 500 }] },
			{ id: 't2', from: 'a', to: 'b', when: [] },
		],
	});
	same(
		'3. nodes',
		g.nodes.map((n) => [n.id, n.kind, n.pos]),
		[
			[ENTRY_NODE, 'entry', { x: 0, y: 40 }],
			[ANY_NODE, 'any', { x: 0, y: 200 }],
			['a', 'state', { x: 5, y: 6 }],
			['b', 'state', { x: 460, y: 160 }],
		],
	);
	same(
		'3. edges',
		g.edges.map((e) => [e.id, e.from, e.to, e.label]),
		[
			[INITIAL_EDGE, ENTRY_NODE, 'b', ''],
			['t1', ANY_NODE, 'a', 'after 500 ms'],
			['t2', 'a', 'b', 'at once'],
		],
	);
	same('3. no brain: only Entry and Any', brainGraph(undefined).nodes.length, 2);
	same('3. Entry → a state picks the start', brainConnection(ENTRY_NODE, 'a'), {
		kind: 'initial',
		state: 'a',
	});
	same('3. Any → a state is a `*` transition', brainConnection(ANY_NODE, 'a'), {
		kind: 'transition',
		from: '*',
		to: 'a',
	});
	same(
		'3. nothing enters Entry or Any',
		[brainConnection('a', ENTRY_NODE), brainConnection('a', ANY_NODE)],
		[undefined, undefined],
	);
}

// ── 4. The sandbox ────────────────────────────────────────────────────────────────────────────
const field = { w: 1280, h: 720 };
const still: SandboxInput = { held: [] };
const run = (n: number, input: SandboxInput = still): SandboxInput[] => Array(n).fill(input);
const guard: ArcadeCharacter = {
	id: 'guard',
	component: 'goblin',
	movement: { accel: 600, maxSpeed: 150 },
	brain: {
		initial: 'wander',
		states: [
			{ id: 'wander', behaviour: 'wander' },
			{ id: 'chase', behaviour: 'chase', params: { range: 2000 } },
		],
		transitions: [
			{
				id: 't1',
				from: 'wander',
				to: 'chase',
				when: [{ kind: 'random', chance: 0.5, every: 300 }],
			},
			{ id: 't2', from: 'chase', to: 'wander', when: [{ kind: 'timer', ms: 700 }] },
		],
	},
	animInputs: { run: 'moving', chasing: 'state:chase', speed: 'speed' },
};
const setup = (over: Partial<SandboxSetup> = {}): SandboxSetup => ({
	character: guard,
	body: { shape: 'box', w: 40, h: 40, tags: ['enemy'] },
	field,
	seed: '7',
	walls: [],
	...over,
});
{
	const inputs = [...run(60, { held: ['up'] }), ...run(120)];
	const a = replay(setup(), inputs);
	const b = replay(setup(), inputs);
	same('4. same seed, same input ⇒ the same run', a, b);
	check(
		'4. another seed ⇒ another run (wander and random draw from the seed)',
		canon(replay(setup({ seed: '8' }), inputs)) !== canon(a),
	);
	check('4. the brain changed state in the run', new Set(a.map((s) => s.state)).size === 2);

	// The same steps by hand, straight from engine-mechanics, as the arcade loop takes them.
	const start = startOf(field);
	const self: Body = {
		id: SANDBOX_CHARACTER_BODY,
		shape: 'box',
		w: 40,
		h: 40,
		x: start.character.x,
		y: start.character.y,
		vx: 0,
		vy: 0,
		tags: ['enemy'],
		edges: 'clamp',
	};
	const player: Body = {
		id: 'player',
		shape: 'box',
		w: PLAYER_SIZE,
		h: PLAYER_SIZE,
		x: start.player.x,
		y: start.player.y,
		vx: 0,
		vy: 0,
		tags: [PLAYER_TAG],
	};
	const brain = createBrain(guard.brain!, {
		rng: createRng(`7:character:${SANDBOX_CHARACTER_BODY}`),
		at: { x: self.x, y: self.y },
	});
	const dt = 1 / 60;
	let hit = false;
	let drift = 0;
	inputs.forEach((input, i) => {
		const world = createBrainWorld({ self, bodies: [player, self], hitSolid: hit });
		stepBrain(brain, world, dt);
		steer(self, brainVelocity(brain, self, world, dt), guard.movement, dt);
		player.vy = input.held.includes('up') ? -220 : 0;
		const r = stepSolid(self, dt, [], field);
		hit = r.hitX || r.hitY;
		stepBody(player, dt, field);
		const s = a[i];
		drift = Math.max(
			drift,
			Math.abs(s.character.x - self.x),
			Math.abs(s.character.y - self.y),
			Math.abs(s.player.y - player.y),
			s.state === brain.state ? 0 : Infinity,
		);
	});
	same('4. every step is behaviours.js + steer + stepSolid, exactly', drift, 0);
	const source = readFileSync(
		fileURLToPath(new URL('../src/lib/characters/sandbox.ts', import.meta.url)),
		'utf8',
	);
	check(
		"4. the sandbox drives the game's own characters stage (createCharacterStage), not a copy",
		source.includes("from 'engine-game/src/game/arcadeCharacters'") &&
			source.includes('createCharacterStage(') &&
			!/import\s*\{[^}]*\b(brainVelocity|controllerVelocity|stepBrain|steer|stepSolid)\b[^}]*\}\s*from 'engine-mechanics'/.test(
				source,
			),
	);
	const last = a[a.length - 1];
	same('4. anim inputs read as the loop writes them', last.animInputs, {
		run: last.speed > 1,
		chasing: last.state === 'chase',
		speed: last.speed,
	});
}
{
	// A chaser behind a wall: the wall stops it and the brain sees `hitSolid`.
	const chaser: ArcadeCharacter = {
		id: 'c',
		component: 'c',
		brain: {
			initial: 'chase',
			states: [
				{ id: 'chase', behaviour: 'chase', params: { range: 5000 } },
				{ id: 'stuck', behaviour: 'idle' },
			],
			transitions: [{ id: 't', from: 'chase', to: 'stuck', when: [{ kind: 'hitSolid' }] }],
		},
	};
	const wall = { id: 'w', x: 640, y: 360, w: 40, h: 700 };
	const s = replay(setup({ character: chaser, body: undefined, walls: [wall] }), run(240));
	const end = s[s.length - 1];
	check('4. no body ⇒ the fallback box', end.character.shape === FALLBACK_BODY.shape);
	check('4. the wall stops the chaser', end.character.x >= wall.x + wall.w / 2 + 24 - 1e-6);
	same('4. … and the brain saw it', end.state, 'stuck');
}
{
	// A played character: the keys drive it, the dummy player stands still.
	const hero: ArcadeCharacter = {
		id: 'h',
		component: 'h',
		controller: { kind: 'topDown', speed: 300 },
	};
	const s = replay(setup({ character: hero }), run(30, { held: ['left', 'up'] }));
	const end = s[s.length - 1];
	const start = startOf(field);
	check(
		'4. a controller drives the character',
		end.driver === 'controller' && end.character.x < start.character.x,
	);
	same('4. a diagonal at the controller speed', Math.round(end.speed), 300);
	same(
		'4. the dummy player stays put',
		[end.player.x, end.player.y],
		[start.player.x, start.player.y],
	);
	const bot = replay(
		setup({
			character: {
				...hero,
				brain: { initial: 'i', states: [{ id: 'i', behaviour: 'idle' }], transitions: [] },
			},
			drive: 'brain',
		}),
		run(10, { held: ['left'] }),
	);
	check(
		'4. a bot: the brain drives, the keys move the dummy player',
		bot[9].driver === 'brain' && bot[9].player.x < start.player.x,
	);
}
{
	const shooter: ArcadeCharacter = {
		id: 's',
		component: 's',
		brain: {
			initial: 'shoot',
			states: [
				{
					id: 'shoot',
					behaviour: 'shootAt',
					params: { component: 'bolt', layer: 'shots', every: 500, range: 5000, speed: 900 },
				},
			],
			transitions: [],
		},
	};
	const s = replay(setup({ character: shooter }), run(90));
	check(
		'4. shootAt fires shots',
		s.some((x) => x.shots.length > 0),
	);
	check('4. a shot that reaches the player hits it', s[s.length - 1].hits >= 1);
	const sandbox = createSandbox(setup({ character: shooter }));
	for (let f = 0; f < 30; f++) sandbox.advance(34, still);
	same('4. frames run whole fixed steps: 1020 ms is 61 of them', sandbox.snapshot().steps, 61);
}

{
	// `variable` conditions read the sandbox's stand-in variables.
	same(
		'4. variables parse as condition values',
		parseVariables('flag = true, score=3\nname = bob, bad'),
		{
			flag: true,
			score: 3,
			name: 'bob',
		},
	);
	const gated: ArcadeCharacter = {
		id: 'v',
		component: 'v',
		brain: {
			initial: 'a',
			states: [
				{ id: 'a', behaviour: 'idle' },
				{ id: 'b', behaviour: 'idle' },
			],
			transitions: [
				{
					id: 't',
					from: 'a',
					to: 'b',
					when: [{ kind: 'variable', id: 'flag', op: '==', value: true }],
				},
			],
		},
	};
	same(
		'4. a variable condition holds only with the variable set',
		[
			replay(setup({ character: gated }), run(2))[1].state,
			replay(setup({ character: gated, variables: { flag: true } }), run(2))[1].state,
		],
		['a', 'b'],
	);
}

// ── 4. The sandbox under gravity (P10.13) ─────────────────────────────────────────────────────
{
	const box = { shape: 'box' as const, w: 40, h: 40 };
	const floorY = field.h - 20;
	const jumper: ArcadeCharacter = {
		id: 'j',
		component: 'j',
		controller: {
			kind: 'sideScroll',
			speed: 200,
			jump: { kind: 'gravity', height: 120, time: 0.4 },
		},
	};
	const near = (a: number, b: number, eps = 0.5) => Math.abs(a - b) <= eps;
	const fall = replay(setup({ character: jumper, body: box }), run(90));
	const landed = fall[fall.length - 1];
	check(
		'4. a gravity jumper falls to the floor and stands on it',
		near(landed.character.y, floorY) && landed.contact?.grounded === true,
		JSON.stringify(landed.contact),
	);
	for (const key of ['jump', 'up']) {
		const s = replay(setup({ character: jumper, body: box }), [
			...run(90),
			...run(40, { held: [key] }),
		]);
		const top = Math.min(...s.slice(90).map((x) => x.character.y));
		check(
			`4. ${key} jumps exactly the jump's height`,
			near(floorY - top, 120),
			String(floorY - top),
		);
	}
	const tap = replay(
		setup({
			character: {
				...jumper,
				controller: {
					kind: 'sideScroll',
					speed: 200,
					jump: { kind: 'gravity', height: 120, time: 0.4, minHeight: 30 },
				},
			},
			body: box,
		}),
		[...run(90), { held: ['jump'] }, ...run(40)],
	);
	const tapTop = floorY - Math.min(...tap.slice(90).map((x) => x.character.y));
	check('4. a tap jumps lower than a held press', tapTop > 30 && tapTop < 80, String(tapTop));

	// One-way: a fall lands on it from above; a jump from below passes up through it.
	const plank = { id: 'p', x: 960, y: field.h - 80, w: 200, h: 16, kind: 'oneWay' as const };
	const onPlank = replay(setup({ character: jumper, body: box, walls: [plank] }), run(90));
	check(
		'4. a fall lands on a one-way platform',
		near(onPlank[89].character.y, plank.y - plank.h / 2 - 20) &&
			onPlank[89].contact?.grounded === true,
		String(onPlank[89].character.y),
	);
	const under = createSandbox(setup({ character: jumper, body: box, walls: [plank] }));
	under.place('character', { x: 960, y: floorY });
	for (let i = 0; i < 10; i++) under.step(still);
	for (let i = 0; i < 60; i++) under.step({ held: ['jump'] });
	check(
		'4. a jump from below passes up through it and lands on top',
		near(under.snapshot().character.y, plank.y - plank.h / 2 - 20),
		String(under.snapshot().character.y),
	);

	// A flap: each press kicks it up; holding does not kick again.
	const flapper: ArcadeCharacter = {
		id: 'f',
		component: 'f',
		movement: { gravity: 900 },
		controller: { kind: 'flap', kick: 300 },
	};
	const flaps = replay(setup({ character: flapper, body: box }), [
		...run(90),
		...run(20, { held: ['jump'] }),
		...run(60),
	]);
	const peak = Math.min(...flaps.slice(90).map((x) => x.character.y));
	same(
		'4. one held press is one flap: kick²/2g up',
		Math.round(floorY - peak),
		Math.round((300 * 300) / (2 * 900)),
	);
	check('4. … then it falls back', near(flaps[flaps.length - 1].character.y, floorY));

	// A hop: a height above the plane, over a ground wall, not over a solid one.
	const hopper: ArcadeCharacter = {
		id: 'h',
		component: 'h',
		controller: { kind: 'topDown', speed: 300, jump: { kind: 'hop', height: 60, time: 0.3 } },
	};
	const low = { id: 'g', x: 860, y: field.h / 2, w: 24, h: 300, kind: 'ground' as const };
	const leftHop = (walls: SandboxSetup['walls'], held: string[]) =>
		replay(setup({ character: hopper, body: box, walls }), run(40, { held }));
	const hop = leftHop([low], ['left', 'jump']);
	const zs = hop.map((x) => x.contact?.z ?? 0);
	check(
		'4. a hop rises its height over the plane',
		near(Math.max(...zs), 60),
		String(Math.max(...zs)),
	);
	check(
		'4. … and stays on its row',
		hop.every((x) => x.character.y === startOf(field).character.y),
	);
	check('4. a hop passes over a ground wall', hop[39].character.x < low.x - 12 - 20);
	check(
		'4. walking into it stops',
		near(leftHop([low], ['left'])[39].character.x, low.x + 12 + 20),
	);
	check(
		'4. a hop does not pass over a solid wall',
		near(leftHop([{ ...low, kind: 'solid' }], ['left', 'jump'])[39].character.x, low.x + 12 + 20),
	);
	check(
		'4. a plain top-down character has no contact readout',
		!(
			'contact' in
			replay(
				setup({
					character: { id: 'p', component: 'p', controller: { kind: 'topDown', speed: 200 } },
				}),
				run(5),
			)[4]
		),
	);
	same(
		'4. the walls a run starts with follow how it moves',
		[wallsFor(field, jumper), wallsFor(field, hopper), wallsFor(field, guard)],
		[PLATFORM_WALLS(field), HOP_WALLS(field), DEFAULT_WALLS(field)],
	);
}

// ── 6. Abilities and zone forces (P11.5) ──────────────────────────────────────────────────────
{
	const doc = base();
	doc.arcade!.zones = [{ id: 'river', x: 0, y: 0, w: 100, h: 100 }];
	edit.addCharacter(doc, 'goblin');
	check('6. no other character, no ability', edit.addAbility(doc, 'goblin') === undefined);
	edit.addCharacter(doc, 'hero');
	let at: number | undefined;
	mirrored('add ability', doc, (d) => (at = edit.addAbility(d, 'goblin')));
	same('6. a stun on every other character', doc.arcade?.abilities, [
		{ character: 'goblin', button: 'ability1', reach: 100, targets: ['hero'], effect: 'stun' },
	]);
	mirrored('second ability', doc, (d) => edit.addAbility(d, 'goblin'));
	same('6. a free button', doc.arcade?.abilities?.[1].button, 'ability2');
	mirrored('effect', doc, (d) => edit.setAbilityEffect(d, at!, 'catch'));
	mirrored('button', doc, (d) => edit.setAbilityButton(d, at!, 'ability2'));
	mirrored('reach', doc, (d) => edit.setAbilityNumber(d, at!, 'reach', '150'));
	mirrored('bad reach kept', doc, (d) => edit.setAbilityNumber(d, at!, 'reach', '-3'));
	mirrored('ms', doc, (d) => edit.setAbilityNumber(d, at!, 'ms', '750.4'));
	mirrored('cooldown', doc, (d) => edit.setAbilityNumber(d, at!, 'cooldownMs', '2000'));
	mirrored('score', doc, (d) => edit.setAbilityNumber(d, at!, 'score', '5'));
	mirrored('score 0', doc, (d) => edit.setAbilityNumber(d, at!, 'score', '0'));
	mirrored('blank ms', doc, (d) => edit.setAbilityNumber(d, at!, 'ms', ''));
	same('6. the edits, as stored', doc.arcade?.abilities?.[0], {
		character: 'goblin',
		button: 'ability2',
		reach: 150,
		targets: ['hero'],
		effect: 'catch',
		cooldownMs: 2000,
	});
	check(
		'6. the last target cannot be taken away',
		!edit.setAbilityTarget(doc, at!, 'hero', false) &&
			doc.arcade!.abilities![0].targets.length === 1,
	);
	same(
		'6. abilitiesOf lists its own with their indexes',
		edit.abilitiesOf(doc, 'goblin').map((a) => a.index),
		[0, 1],
	);
	check(
		'6. the abilities validate clean',
		!validateGameConfigDoc(doc).some((i) => i.path.startsWith('arcade.abilities')),
	);
	mirrored('zone force', doc, (d) => edit.setZoneForce(d, 'river', 'x', '-80'));
	mirrored('force character', doc, (d) => edit.setZoneForceCharacter(d, 'river', 'hero', true));
	same('6. a zone force, as stored', doc.arcade?.forces, [
		{ zone: 'river', force: { x: -80, y: 0 }, characters: ['hero'] },
	]);
	mirrored('rename follows abilities and forces', doc, (d) =>
		edit.renameCharacter(d, 'hero', 'fish'),
	);
	same(
		'6. renamed in targets and forces',
		[doc.arcade?.abilities?.[0].targets, doc.arcade?.forces?.[0].characters],
		[['fish'], ['fish']],
	);
	mirrored('remove the target', doc, (d) => edit.removeCharacter(d, 'fish'));
	check(
		'6. removing the only target drops its abilities, and a force naming only it',
		!doc.arcade?.abilities && !doc.arcade?.forces,
		JSON.stringify(doc.arcade?.forces),
	);
	edit.addCharacter(doc, 'hero');
	mirrored('force for two', doc, (d) => {
		edit.setZoneForce(d, 'river', 'x', '-80');
		edit.setZoneForceCharacter(d, 'river', 'hero', true);
		edit.setZoneForceCharacter(d, 'river', 'goblin', true);
	});
	mirrored('remove one of two', doc, (d) => edit.removeCharacter(d, 'hero'));
	same('6. a force keeps the characters it still names', doc.arcade?.forces?.[0].characters, [
		'goblin',
	]);
	mirrored('force for all', doc, (d) => edit.setZoneForceCharacter(d, 'river', 'goblin', false));
	check(
		'6. unticking the last character pushes every body',
		!!doc.arcade?.forces?.[0] && !doc.arcade.forces[0].characters,
	);
	mirrored('zone force off', doc, (d) => edit.setZoneForce(d, 'river', 'x', '0'));
	check('6. a force of 0 is not stored', !doc.arcade?.forces);
	const page = readFileSync(
		new URL('../src/routes/(app)/characters/+page.svelte', import.meta.url),
		'utf8',
	);
	check(
		'6. the page has the Abilities and Zone forces sections',
		page.includes('<h2>Abilities</h2>') && page.includes('<h2>Zone forces</h2>'),
	);
}

// ── 7. The whole view (character pipeline C1) ─────────────────────────────────────────────────
{
	const config = salmonsConfig() as GameConfigDoc;
	const components: WholeComponent[] = SALMONS_CHARACTER_COMPONENTS.map(
		({ id, name, scope, characterClips }) => ({ id, name, scope, characterClips }),
	);
	const before = canon(config);
	const cast = wholeCharacters({ components, config });
	same(
		'7. Salmons is three characters, not five (a class and its bot’s brain share a look)',
		cast.map((c) => [c.key, c.label]),
		[
			['look:salmonsBear', 'Bear'],
			['look:salmonsFisherman', 'Fisherman'],
			['look:salmonsSalmon', 'Salmon'],
		],
	);
	same(
		'7. each row’s homes: config character, online class, bots, built-in table',
		cast.map((c) => [c.character?.id, c.onlineClass?.id, c.botBrains, !!c.builtin, c.joinedBy]),
		[
			['bearBot', 'bear', ['bearBot'], true, { class: 'look', builtin: 'id', clips: 'id' }],
			[
				'fishermanBot',
				'fisherman',
				['fishermanBot'],
				true,
				{ class: 'look', builtin: 'id', clips: 'id' },
			],
			// Since its bot salmon, the salmon's look has a config character too: the bot's.
			['salmonBot', 'salmon', ['salmonBot'], true, { class: 'look', builtin: 'id', clips: 'id' }],
		],
	);
	const bear = cast[0];
	same(
		'7. the bear’s speed and its swipe',
		[
			bear.onlineClass?.speed,
			bear.onlineAbilities.map((a) => [a.button, a.effect, a.reach, a.ahead, a.cooldownMs]),
		],
		[190, [['ability1', 'catch', 72, 48, 100]]],
	);
	same(
		'7. the fisherman’s cast is a hook',
		cast[1].onlineAbilities.map((a) => a.effect),
		['hook'],
	);
	same('7. the salmon has no ability', cast[2].onlineAbilities, []);
	check(
		'7. every row has its body',
		cast.every((c) => !!c.body),
	);
	const flipbook = projectCharacters(components, config);
	check(
		'7. the clips each row plays are Flipbook’s own, each listed once',
		flipbook.every((pc) => cast.filter((c) => canon(c.clips) === canon(pc)).length === 1) &&
			cast.filter((c) => c.clips).length === flipbook.length,
	);
	same(
		'7. the view on an isometric screen',
		cast.map((c) => {
			const v = impliedView(c, config, ['isometric']);
			return [v.kind, v.drawn, v.mirrored];
		}),
		[
			['isometric', ['n', 'ne', 'e', 'se', 's'], ['sw', 'w', 'nw']],
			['isometric', ['n', 'ne', 'e', 'se', 's'], ['sw', 'w', 'nw']],
			['isometric', ['ne', 'se'], ['sw', 'nw']],
		],
	);
	same(
		'7. eight facings on flat screens are top-down; the diagonals stay isometric',
		cast.map((c) => impliedView(c, config, []).kind),
		['topDown', 'topDown', 'isometric'],
	);
	check(
		"7. the room's screen keys are named",
		impliedView(bear, config, ['isometric']).from.includes("the room's keys are the screen's"),
	);
	same(
		'7. the source: the game’s own clips',
		cast.map((c) => impliedSource(c, config).kind),
		['clips', 'clips', 'clips'],
	);
	same('7. with no clip made, every drawn clip is missing', characterGaps(cast[2], config, []), [
		'None of its 6 drawn clips is made.',
		'12 cells have nothing to play.',
	]);
	const all = characterClipNames(cast[2].clips!.look).map((n) => n.id);
	same('7. with every clip made, nothing is missing', characterGaps(cast[2], config, all), []);
	same(
		'7. one walk clip short',
		characterGaps(
			bear,
			config,
			characterClipNames(bear.clips!.look)
				.map((n) => n.id)
				.filter((n) => n !== 'bear_walk_e'),
		),
		['1 of its 15 drawn clips is not made.'],
	);
	same('7. reading changes nothing', canon(config), before);

	const with3d = salmonsBeforeItsBotSalmon() as GameConfigDoc & { arcade: { world3d?: unknown } };
	with3d.arcade.world3d = {
		looks: {
			bear: {
				modelId: 'bear3d',
				modelIds: ['anim_bear'],
				anim: 'humanoid',
				attach: [{ socket: 'hand_r', modelId: 'paw' }],
			},
			default: { modelId: 'hero' },
		},
	};
	const cast3d = wholeCharacters({ components, config: with3d });
	same(
		'7. a 3D look joins its class by id; `default` is its own row',
		cast3d.map((c) => [c.key, c.look3d?.modelId, c.joinedBy.look3d]),
		[
			['look:salmonsBear', 'bear3d', 'id'],
			['look:salmonsFisherman', undefined, undefined],
			['look:salmonsSalmon', undefined, undefined],
			['id:default', 'hero', undefined],
		],
	);
	same(
		'7. a 3D look implies a 3D view and a model source',
		[impliedView(cast3d[0], with3d, []).kind, impliedSource(cast3d[0], with3d).kind],
		['3d', 'model'],
	);
	same('7. a 3D look with no graph says so', characterGaps(cast3d[3], with3d, []), [
		'Its 3D look names no animation graph (anim).',
	]);

	const plain = normalizeGameConfigDoc({
		family: 'arcade',
		outcome: 'rules',
		arcade: {
			bodies: {
				hero: { shape: 'circle', r: 20, tags: ['player'] },
				ghost: { shape: 'circle', r: 10, tags: [] },
			},
			characters: [
				{ id: 'hero', component: 'hero', controller: { kind: 'sideScroll', speed: 200 } },
				{
					id: 'ghost',
					component: 'ghost',
					brain: {
						initial: 'idle',
						states: [{ id: 'idle', behaviour: { kind: 'idle' } }],
						transitions: [],
					},
				},
			],
			abilities: [
				{ character: 'hero', button: 'ability1', reach: 40, targets: ['ghost'], effect: 'stun' },
			],
		},
	})!;
	const looks: WholeComponent[] = [{ id: 'hero', name: 'Hero', scope: 'project' }];
	const offline = wholeCharacters({ components: looks, config: plain });
	same(
		'7. offline characters: one row each, with their abilities',
		offline.map((c) => [c.key, c.character?.id, c.abilities.map((a) => a.effect)]),
		[
			['look:hero', 'hero', ['stun']],
			['look:ghost', 'ghost', []],
		],
	);
	const side = impliedView(offline[0], plain, []);
	same(
		'7. a side-scroller offline: side, drawn e, mirrored w',
		[side.kind, side.drawn, side.mirrored],
		['side', ['e'], ['w']],
	);
	same(
		'7. offline the source is the component’s state machine',
		impliedSource(offline[0], plain).kind,
		'component',
	);
	same('7. a look the project lacks is missing', characterGaps(offline[1], plain, []), [
		'Its look ghost is not a component of this project.',
	]);
	check(
		'7. no Salmons built-ins outside a Salmons config',
		offline.every((c) => !c.builtin),
	);

	// The join's collision branches: a pair of one look stays two rows, keys stay unique.
	const twins = wholeCharacters({
		components: looks,
		config: {
			...plain,
			arcade: {
				...plain.arcade,
				characters: [
					{ id: 'hero', component: 'hero' },
					{ id: 'hero2', component: 'hero' },
				],
				abilities: [
					{ character: 'hero', button: 'ability1', reach: 40, targets: [], effect: 'stun' },
					{ character: 'hero2', button: 'ability2', reach: 40, targets: [], effect: 'catch' },
				],
			},
		},
	});
	same(
		'7. two characters of one look (unsaved): two rows, each with its abilities',
		twins.map((c) => [c.key, c.character?.id, c.abilities.map((a) => a.effect)]),
		[
			['look:hero', 'hero', ['stun']],
			['look:hero#1', 'hero2', ['catch']],
		],
	);
	const classes = wholeCharacters({
		components: looks,
		config: {
			...plain,
			arcade: {
				...plain.arcade,
				characters: [],
				online: {
					characters: [
						{ id: 'red', body: 'hero', speed: 100 },
						{ id: 'blue', body: 'hero', speed: 120 },
					],
					bots: {
						characters: [
							{ character: 'red', brain: 'b' },
							{ character: 'red', brain: 'b' },
						],
					},
				},
			},
		},
	});
	same(
		'7. two classes of one body: two rows; a brain named twice is listed once',
		classes.map((c) => [c.key, c.onlineClass?.id, c.botBrains]),
		[
			['look:hero', 'red', ['b']],
			['look:hero#1', 'blue', []],
		],
	);
	const offlineBlock = wholeCharacters({
		components: [
			{
				id: 'hero',
				name: 'Hero',
				scope: 'project',
				characterClips: { prefixes: { base: 'hero' }, displayWidth: 40, idle: 'idle' },
			},
		],
		config: plain,
	});
	same(
		'7. a component’s block no class plays joins its character by look',
		[
			offlineBlock.length,
			offlineBlock[0].joinedBy.clips,
			characterGaps(offlineBlock[0], plain, ['hero_idle_ne', 'hero_idle_se']),
		],
		[2, 'look', ['Its clips play only online, and no online class is drawn as it.']],
	);
	const noClasses = salmonsBeforeItsBotSalmon() as GameConfigDoc;
	noClasses.arcade!.online!.characters = [];
	noClasses.arcade!.characters = [{ id: 'bear', component: 'nobody' }];
	const builtins = wholeCharacters({ components: [], config: noClasses });
	same(
		'7. with no classes, Salmons’ built-ins are rows of their own; a same-id character joins',
		builtins.map((c) => [
			c.key,
			c.character?.id,
			!!c.builtin,
			c.joinedBy.builtin,
			c.joinedBy.clips,
		]),
		[
			['look:nobody', 'bear', true, 'id', 'id'],
			['id:salmon', undefined, true, undefined, 'id'],
			['id:fisherman', undefined, true, undefined, 'id'],
		],
	);
	check(
		'7. every key is unique',
		[cast, cast3d, offline, twins, classes, offlineBlock, builtins].every(
			(list) => new Set(list.map((c) => c.key)).size === list.length,
		),
	);

	const page = readFileSync(
		new URL('../src/routes/(app)/characters/CharacterWhole.svelte', import.meta.url),
		'utf8',
	);
	check(
		'7. the view draws with Flipbook’s own grid and Directions preview',
		page.includes("from '$lib/flipbook/CharacterClipsGrid.svelte'") &&
			page.includes("from '$lib/flipbook/CharacterDirections.svelte'"),
	);
	check(
		'7. the grid is read-only there (no onOpen)',
		/<CharacterClipsGrid(?![^>]*onOpen)[^>]*\/>/s.test(page),
	);
	const endpoint = readFileSync(
		new URL('../src/routes/api/characters/whole/+server.ts', import.meta.url),
		'utf8',
	);
	check(
		'7. its endpoint is a read, behind the tool’s gate',
		endpoint.includes('export const GET') &&
			!/export const (POST|PUT|PATCH|DELETE)/.test(endpoint) &&
			endpoint.includes("tool: 'characters'"),
	);
}

/** The in-memory R2 of §8's round trip and §10's save: an object's ETag is of its bytes, as
 *  R2's is, so a conditional write is refused exactly when the stored bytes changed. */
const R2 = new Map<string, { body: string; etag: string }>();
// Before any route module is loaded: the routes' own tool gates then decide on `ROLE_TOOLS`.
fakeStoredGrants();
const etagOfBytes = (body: string): string => `"${createHash('md5').update(body).digest('hex')}"`;

/**
 * C6a's sheets: a rig (`otter`), still images (`crate`), and frame clips with one still cell and
 * one rig-animation cell (`fox`). §11 holds that an edit of anything else keeps them key for key;
 * the edits of them (C6b) are §12's (`./charactersTool/sources.ts`).
 * Each as a config stores it, in the normalizer's own key order.
 */
const C6_STILL = { assetKey: 'acme/p/manifests/atlas_manifest_crate.json', region: 'crate' };
const C6_SHEETS = {
	otter: {
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
			{ id: 'wag', when: { event: 'caught' }, anim: { se: { anim: 'wag', rig: 'otterTail' } } },
		],
	},
	crate: {
		source: { kind: 'stills' },
		draw: { width: 48 },
		actions: [{ id: 'idle', when: { motion: 'still' }, anim: { se: { still: C6_STILL } } }],
	},
	fox: {
		source: { kind: 'clips', prefix: 'fox' },
		draw: { width: 50 },
		actions: [
			{
				id: 'idle',
				when: { motion: 'still' },
				anim: { ne: { anim: 'look', rig: 'foxRig' }, se: { still: C6_STILL } },
			},
			{ id: 'walk', when: { motion: 'moving' } },
		],
	},
} as const;
type C6Id = keyof typeof C6_SHEETS;
const C6_IDS = Object.keys(C6_SHEETS) as C6Id[];
const C6_NAMES: Record<C6Id, string> = {
	otter: 'a rig',
	crate: 'still images',
	fox: 'clips with a still and a rig cell',
};
/** A config with those characters (all three unless told), each the sheet of a class of its id,
 *  as a load gives it. */
const c6Doc = (ids: readonly C6Id[] = C6_IDS): GameConfigDoc => {
	const raw = {
		family: 'arcade',
		outcome: 'rules',
		arcade: {
			field: { w: 2000, h: 1200 },
			bodies: Object.fromEntries(
				[...ids.map((id) => `${id}Look`), 'spareLook'].map((look) => [
					look,
					{ shape: 'circle', r: 20, tags: ['player'] },
				]),
			),
			characters: ids.map((id) => ({
				id,
				component: `${id}Look`,
				...(JSON.parse(JSON.stringify(C6_SHEETS[id])) as CharacterSheet),
			})),
			online: {
				characters: ids.map((id) => ({ id, body: `${id}Look`, speed: 200, sheet: id })),
			},
		},
	};
	return withCharacterSheets(normalizeGameConfigDoc(raw) as GameConfigDoc, raw);
};
/** What an edit of something else may not change on such a sheet: its source, its bone points and
 *  every cell that is not a clip (by facing: an action may be renamed). */
const c6Kept = (doc: GameConfigDoc, id: string): string => {
	const held = sheet.sheetOf(doc, id);
	return JSON.stringify([
		held?.source,
		held?.draw?.bones,
		(held?.actions ?? []).flatMap((action) =>
			Object.entries(action.anim ?? {}).filter(([, cell]) => !cell.clip),
		),
	]);
};

// ── 8. The sheet editor (character pipeline C2b) ──────────────────────────────────────────────
{
	const text = (v: unknown): string => JSON.stringify(v);
	/** What a load makes of stored bytes: the normalizer, then the carry. */
	const load = (raw: unknown): GameConfigDoc =>
		withCharacterSheets(normalizeGameConfigDoc(raw) as GameConfigDoc, raw);
	const sheetDoc = (): GameConfigDoc =>
		load({
			family: 'arcade',
			outcome: 'rules',
			arcade: {
				field: { w: 2000, h: 1200 },
				bodies: {
					goblin: { shape: 'box', w: 40, h: 40, tags: ['enemy'] },
					hero: { shape: 'circle', r: 20, tags: ['player'] },
				},
				characters: [
					{ id: 'hero', component: 'hero' },
					{ id: 'goblin', component: 'goblin' },
				],
				online: {
					characters: [
						{ id: 'knight', body: 'hero', speed: 200 },
						{ id: 'orc', body: 'goblin', speed: 150 },
					],
				},
			},
		});
	const sheetDocWith = (): GameConfigDoc => {
		const doc = sheetDoc();
		act.addAction(doc, 'hero', 'a');
		return doc;
	};
	/** A 3D block the save accepts (`gameConfig3d.ts`), beside the sheets. */
	const WORLD_3D = {
		level: {
			colliders: [{ kind: 'box', minX: -20, minY: -1, minZ: -20, maxX: 20, maxY: 0, maxZ: 20 }],
		},
		looks: { bear: { modelId: 'bear3d' } },
	};
	const entry = (doc: GameConfigDoc, id: string): ArcadeCharacter => edit.findCharacter(doc, id)!;
	const cls = (doc: GameConfigDoc, id: string) => sheet.findClass(doc, id)!;
	/** Apply `run`: every character's four fields are what the normalizer makes of them, key for
	 *  key and in its order, and the doc is what a load of its own bytes gives. */
	function sheeted<T>(name: string, doc: GameConfigDoc, run: (d: GameConfigDoc) => T): T {
		const out = run(doc);
		for (const c of doc.arcade?.characters ?? [])
			check(
				`8. ${name}: "${c.id}" holds what the normalizer stores, key for key`,
				text(normalizeCharacterSheet(c)) === text(sheet.sheetFieldsOf(c)),
				`${text(sheet.sheetFieldsOf(c))} ≠ ${text(normalizeCharacterSheet(c))}`,
			);
		same(`8. ${name}: the doc is what a load of it gives`, load(JSON.parse(text(doc))), doc);
		return out;
	}

	// The view.
	{
		const doc = sheetDoc();
		check('8. a character starts with no sheet', !sheet.hasSheet(doc, 'hero'));
		same(
			'8. the views offered: side, top-down, isometric (not 3D)',
			sheet.VIEW_KIND_OPTIONS.map((o) => o.value),
			['side', 'topDown', 'isometric'],
		);
		same(
			'8. no view yet: facings need one',
			sheet.setViewFacings(doc, 'hero', 8),
			'Pick a view first.',
		);
		same(
			'8. … and so does the mirror',
			sheet.setViewMirror(doc, 'hero', false),
			'Pick a view first.',
		);
		same('8. no such character', sheet.setViewKind(doc, 'nobody', 'side'), 'No such character.');
		check(
			'8. a 3D view is not one the tool sets',
			sheet.setViewKind(doc, 'hero', '3d' as never) !== null && !sheet.hasSheet(doc, 'hero'),
		);
		sheeted('side', doc, (d) => sheet.setViewKind(d, 'hero', 'side'));
		same('8. a side view', entry(doc, 'hero').view, { kind: 'side' });
		same(
			'8. a side view has two facings',
			sheet.setViewFacings(doc, 'hero', 8),
			'A side view has two facings.',
		);
		sheeted('mirror off', doc, (d) => sheet.setViewMirror(d, 'hero', false));
		same('8. only "no mirror" is stored', entry(doc, 'hero').view, { kind: 'side', mirror: false });
		sheeted('top-down', doc, (d) => sheet.setViewKind(d, 'hero', 'topDown'));
		sheeted('eight', doc, (d) => sheet.setViewFacings(d, 'hero', 8));
		check(
			'8. the kind keeps the mirror; 8 facings are stored, in the normalizer’s order',
			text(entry(doc, 'hero').view) === text({ kind: 'topDown', facings: 8, mirror: false }),
			text(entry(doc, 'hero').view),
		);
		sheeted('isometric', doc, (d) => sheet.setViewKind(d, 'hero', 'isometric'));
		same('8. the kind keeps the facings', entry(doc, 'hero').view, {
			kind: 'isometric',
			facings: 8,
			mirror: false,
		});
		sheeted('four, mirrored', doc, (d) => {
			sheet.setViewFacings(d, 'hero', 4);
			sheet.setViewMirror(d, 'hero', true);
		});
		same('8. 4 facings and a mirror are the defaults: not stored', entry(doc, 'hero').view, {
			kind: 'isometric',
		});
		sheet.setViewFacings(doc, 'hero', 8);
		sheeted('eight to side', doc, (d) => sheet.setViewKind(d, 'hero', 'side'));
		same('8. a side view drops the facings', entry(doc, 'hero').view, { kind: 'side' });
		sheeted('clear', doc, (d) => sheet.clearView(d, 'hero'));
		check(
			'8. clearing the view leaves no key',
			!('view' in entry(doc, 'hero')) && !sheet.hasSheet(doc, 'hero'),
		);

		const stored3d = sheetDoc();
		entry(stored3d, 'hero').view = { kind: '3d' };
		check(
			'8. a stored 3D view takes no facings and no mirror',
			sheet.setViewFacings(stored3d, 'hero', 8) !== null &&
				sheet.setViewMirror(stored3d, 'hero', false) !== null &&
				text(entry(stored3d, 'hero').view) === text({ kind: '3d' }),
		);
		sheeted('3D to isometric', stored3d, (d) => sheet.setViewKind(d, 'hero', 'isometric'));
		same('8. … and can be changed', entry(stored3d, 'hero').view, { kind: 'isometric' });

		same(
			'8. what each view draws and mirrors (plan §12.3)',
			(
				[
					undefined,
					{ kind: 'side' },
					{ kind: 'topDown' },
					{ kind: 'topDown', facings: 8 },
					{ kind: 'isometric' },
					{ kind: 'isometric', facings: 8 },
					{ kind: 'isometric', mirror: false },
					{ kind: '3d' },
				] as const
			).map((view) => {
				const { facings, made, mirrored } = sheet.viewDrawing(view);
				return [facings.length, made.join(' '), mirrored.join(' ')];
			}),
			[
				[4, 'ne se', 'sw nw'],
				[2, 'e', 'w'],
				[4, 'n e s', 'w'],
				[8, 'n ne e se s', 'sw w nw'],
				[4, 'ne se', 'sw nw'],
				[8, 'n ne e se s', 'sw w nw'],
				[4, 'ne se sw nw', ''],
				[0, '', ''],
			],
		);

		// Cells of facings the new view does not draw are kept, and reported.
		const cells = sheetDoc();
		sheet.setViewKind(cells, 'hero', 'isometric');
		sheet.setViewFacings(cells, 'hero', 8);
		act.addAction(cells, 'hero', 'idle');
		act.setActionAnim(cells, 'hero', 'idle', 'n', 'hero_up');
		act.setActionAnim(cells, 'hero', 'idle', 'ne', 'hero_up_right');
		same(
			'8. with eight facings every cell is drawn',
			sheet.undrawnAnimCells(sheet.sheetOf(cells, 'hero')),
			[],
		);
		sheeted('eight to four', cells, (d) => sheet.setViewFacings(d, 'hero', 4));
		same(
			'8. a change of view keeps the cells it no longer draws, and lists them',
			[
				entry(cells, 'hero').actions?.[0].anim,
				sheet.undrawnAnimCells(sheet.sheetOf(cells, 'hero')),
			],
			[
				{ n: { clip: 'hero_up' }, ne: { clip: 'hero_up_right' } },
				[{ action: 'idle', facing: 'n', kind: 'clip', text: 'hero_up' }],
			],
		);
		same(
			'8. … which the tool warns of',
			chk.sheetWarnings(sheet.sheetOf(cells, 'hero')).map((w) => [w.on, w.action]),
			[['actions', 'idle']],
		);
		same(
			'8. dropping them removes exactly those',
			[
				sheeted('drop undrawn', cells, (d) => sheet.dropUndrawnAnimCells(d, 'hero')),
				entry(cells, 'hero').actions?.[0].anim,
				sheet.dropUndrawnAnimCells(cells, 'hero'),
			],
			[1, { ne: { clip: 'hero_up_right' } }, 0],
		);
	}

	// The animation source.
	{
		const doc = sheetDoc();
		same(
			'8. a blank prefix is refused',
			sheet.setSourcePrefix(doc, 'hero', '  '),
			'A prefix cannot be blank.',
		);
		check('8. … and stores nothing', !sheet.hasSheet(doc, 'hero'));
		check(
			'8. a variant needs a source',
			sheet.addVariant(doc, 'hero', 'marked', 'gold') !== null && !sheet.hasSheet(doc, 'hero'),
		);
		sheeted('prefix', doc, (d) => sheet.setSourcePrefix(d, 'hero', ' hero '));
		same('8. frame clips with a trimmed prefix', entry(doc, 'hero').source, {
			kind: 'clips',
			prefix: 'hero',
		});
		sheeted('variants', doc, (d) => {
			sheet.addVariant(d, 'hero', ' marked ', ' hero_gold ');
			sheet.addVariant(d, 'hero', 'stunned', 'hero_dizzy');
		});
		same('8. variants by status, trimmed, in order', sheet.variantsOf(sheet.sheetOf(doc, 'hero')), [
			['marked', 'hero_gold'],
			['stunned', 'hero_dizzy'],
		]);
		same(
			'8. variant refusals: taken, blank status, blank prefix, __proto__',
			[
				sheet.addVariant(doc, 'hero', 'marked', 'x'),
				sheet.addVariant(doc, 'hero', ' ', 'x'),
				sheet.addVariant(doc, 'hero', 'out', ' '),
				sheet.addVariant(doc, 'hero', '__proto__', 'x'),
				sheet.renameVariant(doc, 'hero', 'marked', 'stunned'),
				sheet.renameVariant(doc, 'hero', 'nope', 'x'),
				sheet.setVariantPrefix(doc, 'hero', 'marked', ''),
			].map((r) => r !== null),
			[true, true, true, true, true, true, true],
		);
		same('8. … which change nothing', sheet.variantsOf(sheet.sheetOf(doc, 'hero')).length, 2);
		sheeted('rename a variant', doc, (d) => sheet.renameVariant(d, 'hero', 'marked', 'golden'));
		sheeted('variant prefix', doc, (d) =>
			sheet.setVariantPrefix(d, 'hero', 'stunned', 'hero_stun'),
		);
		same('8. a renamed variant keeps its place', sheet.variantsOf(sheet.sheetOf(doc, 'hero')), [
			['golden', 'hero_gold'],
			['stunned', 'hero_stun'],
		]);
		sheeted('a new prefix', doc, (d) => sheet.setSourcePrefix(d, 'hero', 'knight'));
		same(
			'8. a new prefix keeps the variants',
			[entry(doc, 'hero').source?.prefix, sheet.variantsOf(sheet.sheetOf(doc, 'hero')).length],
			['knight', 2],
		);
		for (let n = 3; n <= CHARACTER_SHEET_LIMITS.variants; n++)
			sheet.addVariant(doc, 'hero', `s${n}`, `p${n}`);
		check(
			`8. a ${CHARACTER_SHEET_LIMITS.variants + 1}th variant is refused`,
			sheeted('variant limit', doc, (d) => sheet.addVariant(d, 'hero', 'more', 'p')) !== null &&
				sheet.variantsOf(sheet.sheetOf(doc, 'hero')).length === CHARACTER_SHEET_LIMITS.variants,
		);
		sheeted('remove variants', doc, (d) => {
			for (const [status] of sheet.variantsOf(sheet.sheetOf(d, 'hero')))
				sheet.removeVariant(d, 'hero', status);
		});
		check('8. the last variant removed leaves no key', !('variants' in entry(doc, 'hero').source!));
		sheeted('clear the source', doc, (d) => sheet.clearSource(d, 'hero'));
		check('8. clearing the source leaves no key', !('source' in entry(doc, 'hero')));
	}

	// The draw box.
	{
		const doc = sheetDoc();
		same(
			'8. a width is a number above 0; feet and points need the box',
			[
				sheet.setDrawWidth(doc, 'hero', '0'),
				sheet.setDrawWidth(doc, 'hero', ''),
				sheet.setDrawWidth(doc, 'hero', 'wide'),
				sheet.setDrawWidth(doc, 'hero', '-4'),
				sheet.setDrawFeet(doc, 'hero', '0.5'),
				sheet.addPoint(doc, 'hero', 'hand'),
			].map((r) => r !== null),
			[true, true, true, true, true, true],
		);
		check('8. … and nothing is stored', !sheet.hasSheet(doc, 'hero'));
		sheeted('width', doc, (d) => sheet.setDrawWidth(d, 'hero', '92'));
		same('8. the width alone', entry(doc, 'hero').draw, { width: 92 });
		sheeted('feet', doc, (d) => sheet.setDrawFeet(d, 'hero', '0.9'));
		same('8. feet stored unless 1', entry(doc, 'hero').draw, { width: 92, feet: 0.9 });
		same(
			'8. feet outside 0 to 1 are refused',
			[
				sheet.setDrawFeet(doc, 'hero', '1.5'),
				sheet.setDrawFeet(doc, 'hero', '-0.1'),
				sheet.setDrawFeet(doc, 'hero', 'x'),
			].map((r) => r !== null),
			[true, true, true],
		);
		same('8. … and kept', entry(doc, 'hero').draw?.feet, 0.9);
		sheeted('feet 0', doc, (d) => sheet.setDrawFeet(d, 'hero', '0'));
		same('8. feet at the top is stored', entry(doc, 'hero').draw?.feet, 0);
		sheeted('feet 1', doc, (d) => sheet.setDrawFeet(d, 'hero', '1'));
		check('8. feet of 1 is the default: not stored', !('feet' in entry(doc, 'hero').draw!));
		sheet.setDrawFeet(doc, 'hero', '0.8');
		sheeted('blank feet', doc, (d) => sheet.setDrawFeet(d, 'hero', ' '));
		check('8. blank feet too', !('feet' in entry(doc, 'hero').draw!));
		sheeted('points', doc, (d) => {
			sheet.addPoint(d, 'hero', ' hand ');
			sheet.addPoint(d, 'hero', 'head', { x: 0.5, y: 0.1 });
		});
		same('8. points, the first in the middle', sheet.pointsOf(sheet.sheetOf(doc, 'hero')), [
			{ name: 'hand', x: 0.5, y: 0.5 },
			{ name: 'head', x: 0.5, y: 0.1 },
		]);
		same(
			'8. point refusals: taken, blank, __proto__, no number',
			[
				sheet.addPoint(doc, 'hero', 'hand'),
				sheet.addPoint(doc, 'hero', ' '),
				sheet.addPoint(doc, 'hero', '__proto__'),
				sheet.addPoint(doc, 'hero', 'tail', { x: NaN, y: 0 }),
				sheet.renamePoint(doc, 'hero', 'hand', 'head'),
				sheet.renamePoint(doc, 'hero', 'hand', '__proto__'),
				sheet.setPoint(doc, 'hero', 'hand', 'x', 'left'),
				sheet.setPoint(doc, 'hero', 'tail', 'x', '0.2'),
			].map((r) => r !== null),
			[true, true, true, true, true, true, true, true],
		);
		sheeted('edit points', doc, (d) => {
			sheet.setPoint(d, 'hero', 'hand', 'x', '0.75');
			sheet.setPoint(d, 'hero', 'hand', 'y', '0.4');
			sheet.renamePoint(d, 'hero', 'hand', 'grip');
		});
		same(
			'8. a point moved and renamed keeps its place',
			sheet.pointsOf(sheet.sheetOf(doc, 'hero')),
			[
				{ name: 'grip', x: 0.75, y: 0.4 },
				{ name: 'head', x: 0.5, y: 0.1 },
			],
		);
		for (let n = 3; n <= CHARACTER_SHEET_LIMITS.points; n++) sheet.addPoint(doc, 'hero', `p${n}`);
		check(
			`8. a ${CHARACTER_SHEET_LIMITS.points + 1}th point is refused`,
			sheeted('point limit', doc, (d) => sheet.addPoint(d, 'hero', 'more')) !== null &&
				sheet.pointsOf(sheet.sheetOf(doc, 'hero')).length === CHARACTER_SHEET_LIMITS.points,
		);
		sheeted('remove points', doc, (d) => {
			for (const { name } of sheet.pointsOf(sheet.sheetOf(d, 'hero')))
				sheet.removePoint(d, 'hero', name);
		});
		check('8. the last point removed leaves no key', !('points' in entry(doc, 'hero').draw!));
		sheeted('new width', doc, (d) => {
			sheet.setDrawFeet(d, 'hero', '0.5');
			sheet.setDrawWidth(d, 'hero', '120');
		});
		same('8. a new width keeps the feet', entry(doc, 'hero').draw, { width: 120, feet: 0.5 });
		sheeted('clear the box', doc, (d) => sheet.clearDraw(d, 'hero'));
		check('8. clearing the box leaves no key', !('draw' in entry(doc, 'hero')));
	}

	// The actions.
	{
		const doc = sheetDoc();
		const actions = () => entry(doc, 'hero').actions ?? [];
		const action = (id: string) => actions().find((a) => a.id === id)!;
		same(
			'8. add: fresh ids, last in the sheet',
			[
				sheeted('add', doc, (d) => act.addAction(d, 'hero')),
				act.addAction(doc, 'hero'),
				act.addAction(doc, 'hero', ' idle '),
				actions(),
			],
			[
				{ refused: null, id: 'action' },
				{ refused: null, id: 'action2' },
				{ refused: null, id: 'idle' },
				[{ id: 'action' }, { id: 'action2' }, { id: 'idle' }],
			],
		);
		same('8. no such action', act.setActionName(doc, 'hero', 'nope', 'x'), 'No such action.');
		sheeted('rename', doc, (d) => {
			act.renameAction(d, 'hero', 'action', 'walk');
			act.renameAction(d, 'hero', 'action2', 'swipe');
		});
		sheeted('names', doc, (d) => act.setActionName(d, 'hero', 'walk', ' Walk '));
		same('8. a name, trimmed', action('walk').name, 'Walk');
		sheeted('blank name', doc, (d) => act.setActionName(d, 'hero', 'walk', ' '));
		check('8. a blank name is not stored', !('name' in action('walk')));

		// Triggers.
		sheeted('one trigger', doc, (d) => act.addTrigger(d, 'hero', 'idle', { motion: 'still' }));
		check(
			'8. one trigger is stored bare',
			text(action('idle').when) === text({ motion: 'still' }),
			text(action('idle').when),
		);
		sheeted('two triggers', doc, (d) => act.addTrigger(d, 'hero', 'idle', { status: ' holding ' }));
		same('8. two are a list, trimmed', action('idle').when, [
			{ motion: 'still' },
			{ status: 'holding' },
		]);
		same(
			'8. trigger refusals: a duplicate, an unknown movement or button, a blank name',
			[
				act.addTrigger(doc, 'hero', 'idle', { motion: 'still' }),
				act.addTrigger(doc, 'hero', 'idle', { status: 'holding' }),
				act.addTrigger(doc, 'hero', 'idle', { motion: 'flying' } as never),
				act.addTrigger(doc, 'hero', 'idle', { ability: 'ability3' } as never),
				act.addTrigger(doc, 'hero', 'idle', { event: ' ' }),
				act.addTrigger(doc, 'hero', 'idle', { status: '' }),
				act.addTrigger(doc, 'hero', 'idle', {} as never),
				act.setTrigger(doc, 'hero', 'idle', 1, { motion: 'still' }),
				act.setTrigger(doc, 'hero', 'idle', 5, { motion: 'moving' }),
				act.removeTrigger(doc, 'hero', 'idle', 5),
			].map((r) => r !== null),
			Array(10).fill(true),
		);
		same('8. … which change nothing', characterTriggers(action('idle')).length, 2);
		sheeted('set a trigger', doc, (d) =>
			act.setTrigger(d, 'hero', 'idle', 1, { motion: 'moving' }),
		);
		same('8. a trigger replaced', action('idle').when, [{ motion: 'still' }, { motion: 'moving' }]);
		sheeted('remove a trigger', doc, (d) => act.removeTrigger(d, 'hero', 'idle', 1));
		check('8. back to one: bare again', text(action('idle').when) === text({ motion: 'still' }));
		sheeted('events', doc, (d) => {
			act.addTrigger(d, 'hero', 'swipe', { ability: 'ability1' });
			act.addTrigger(d, 'hero', 'swipe', { event: 'caught', as: 'target' });
			act.addTrigger(d, 'hero', 'swipe', { event: 'caught', as: 'user' } as never);
		});
		same(
			'8. an ability, an event to it, an event by it (`as` only for a target)',
			action('swipe').when,
			[{ ability: 'ability1' }, { event: 'caught', as: 'target' }, { event: 'caught' }],
		);
		for (const status of ['a', 'b', 'c', 'd', 'e'])
			act.addTrigger(doc, 'hero', 'swipe', { status });
		check(
			`8. a ${CHARACTER_SHEET_LIMITS.triggers + 1}th trigger is refused`,
			characterTriggers(action('swipe')).length === CHARACTER_SHEET_LIMITS.triggers &&
				sheeted('trigger limit', doc, (d) =>
					act.addTrigger(d, 'hero', 'swipe', { status: 'f' }),
				) !== null &&
				characterTriggers(action('swipe')).length === CHARACTER_SHEET_LIMITS.triggers,
		);
		for (let i = CHARACTER_SHEET_LIMITS.triggers - 1; i >= 1; i--)
			act.removeTrigger(doc, 'hero', 'swipe', i);
		same(
			'8. every kind has a trigger that already works, and words',
			act.TRIGGER_KINDS.map((kind) => {
				const made = act.newTrigger(kind)!;
				return [act.triggerKindOf(made), act.addTrigger(sheetDocWith(), 'hero', 'a', made)];
			}),
			act.TRIGGER_KINDS.map((kind) => [kind, null]),
		);
		same(
			'8. triggers in words',
			[
				{ motion: 'moving' } as const,
				{ ability: 'ability2' } as const,
				{ event: 'caught' },
				{ event: 'caught', as: 'target' } as const,
				{ status: 'holding' },
			].map(triggerText),
			['moving', 'ability 2', 'caught', 'caught (to it)', 'while holding'],
		);

		// Play, priority, interrupt, again.
		sheeted('play at its default', doc, (d) => act.setActionPlay(d, 'hero', 'idle', 'loop'));
		check('8. a movement loops by default: `loop` is not stored', !('play' in action('idle')));
		sheeted('once', doc, (d) => act.setActionPlay(d, 'hero', 'idle', 'once'));
		same(
			'8. `once` on a movement is stored',
			[action('idle').play, act.playChoiceOf(action('idle'))],
			['once', 'once'],
		);
		sheeted('hold', doc, (d) => act.setActionPlay(d, 'hero', 'idle', 'hold'));
		sheeted('an ability held', doc, (d) => act.setActionPlay(d, 'hero', 'swipe', 'hold'));
		same(
			'8. `hold` is stored on a movement and on an ability alike: it is never a default',
			[
				action('idle').play,
				act.playChoiceOf(action('idle')),
				action('swipe').play,
				act.PLAY_OPTIONS.includes('hold'),
				act.PLAY_LABELS.hold,
			],
			['hold', 'hold', 'hold', true, 'Hold'],
		);
		sheeted('an ability once again', doc, (d) => act.setActionPlay(d, 'hero', 'swipe', 'default'));
		sheeted('default play', doc, (d) => act.setActionPlay(d, 'hero', 'idle', 'default'));
		same(
			'8. the default deletes it',
			[action('idle').play, act.playChoiceOf(action('idle'))],
			[undefined, 'default'],
		);
		sheeted('an ability once', doc, (d) => act.setActionPlay(d, 'hero', 'swipe', 'once'));
		check(
			'8. an ability plays once by default: `once` is not stored',
			!('play' in action('swipe')),
		);
		sheeted('an ability looped', doc, (d) => {
			act.setActionPlay(d, 'hero', 'swipe', 'loop');
			act.setActionPriority(d, 'hero', 'swipe', '1');
		});
		same(
			'8. `loop` and a priority off the default are stored',
			[action('swipe').play, action('swipe').priority],
			['loop', 1],
		);
		sheeted('the trigger changes under them', doc, (d) =>
			act.setTrigger(d, 'hero', 'swipe', 0, { motion: 'moving' }),
		);
		check(
			'8. a new trigger makes them the defaults: neither is stored any more',
			!('play' in action('swipe')) && !('priority' in action('swipe')),
			text(action('swipe')),
		);
		act.setTrigger(doc, 'hero', 'swipe', 0, { ability: 'ability1' });
		sheeted('priority', doc, (d) => act.setActionPriority(d, 'hero', 'idle', '5'));
		same('8. a priority', action('idle').priority, 5);
		same(
			'8. a priority is a number',
			act.setActionPriority(doc, 'hero', 'idle', 'high'),
			'A priority is a number.',
		);
		sheeted('priority at its default', doc, (d) => act.setActionPriority(d, 'hero', 'idle', '1'));
		check('8. a movement’s default priority, 1, is not stored', !('priority' in action('idle')));
		act.setActionPriority(doc, 'hero', 'idle', '4');
		sheeted('blank priority', doc, (d) => act.setActionPriority(d, 'hero', 'idle', ''));
		check('8. blank is the default', !('priority' in action('idle')));
		sheeted('interrupt, again', doc, (d) => {
			act.setActionInterrupt(d, 'hero', 'swipe', 'none');
			act.setActionAgain(d, 'hero', 'swipe', 'ignore');
		});
		same(
			'8. interrupt and again',
			[action('swipe').interrupt, action('swipe').again],
			['none', 'ignore'],
		);
		sheeted('interrupt by priority', doc, (d) =>
			act.setActionInterrupt(d, 'hero', 'swipe', 'priority'),
		);
		same('8. interrupt: priority', action('swipe').interrupt, 'priority');
		sheeted('their defaults', doc, (d) => {
			act.setActionInterrupt(d, 'hero', 'swipe', 'default');
			act.setActionAgain(d, 'hero', 'swipe', 'default');
		});
		check(
			'8. their defaults are not stored',
			!('interrupt' in action('swipe')) && !('again' in action('swipe')),
		);

		// The clip per facing.
		sheeted('anim', doc, (d) => {
			act.setActionAnim(d, 'hero', 'swipe', 's', 'hero_swing_s');
			act.setActionAnim(d, 'hero', 'swipe', 'e', ' hero_swing_side ');
		});
		check(
			'8. cells per facing, trimmed, clockwise from north',
			text(action('swipe').anim) ===
				text({ e: { clip: 'hero_swing_side' }, s: { clip: 'hero_swing_s' } }),
			text(action('swipe').anim),
		);
		check(
			'8. no such facing',
			act.setActionAnim(doc, 'hero', 'swipe', 'up' as never, 'x') !== null,
		);
		sheeted('empty cells', doc, (d) => {
			act.setActionAnim(d, 'hero', 'swipe', 's', '');
			act.setActionAnim(d, 'hero', 'swipe', 'e', ' ');
		});
		check('8. an empty cell is by name; the last leaves no key', !('anim' in action('swipe')));

		// The fallback.
		same(
			'8. a fallback is another action of the sheet',
			[
				act.setActionFallback(doc, 'hero', 'swipe', 'swipe'),
				act.setActionFallback(doc, 'hero', 'swipe', 'nope'),
			].map((r) => r !== null),
			[true, true],
		);
		sheeted('fallbacks', doc, (d) => {
			act.setActionFallback(d, 'hero', 'swipe', 'walk');
			act.setActionFallback(d, 'hero', 'idle', ' walk ');
		});
		same('8. fallbacks', [action('swipe').fallback, action('idle').fallback], ['walk', 'walk']);

		// Order.
		sheeted('move', doc, (d) => act.moveAction(d, 'hero', 'idle', -1));
		same(
			'8. an action moved up',
			actions().map((a) => a.id),
			['walk', 'idle', 'swipe'],
		);
		sheeted('move at the edge', doc, (d) => {
			act.moveAction(d, 'hero', 'walk', -1);
			act.moveAction(d, 'hero', 'swipe', 1);
		});
		same(
			'8. the ends stay',
			actions().map((a) => a.id),
			['walk', 'idle', 'swipe'],
		);

		// A rename reaches the fallbacks, and says which clips the old name found.
		sheet.setSourcePrefix(doc, 'hero', 'hero');
		sheet.addVariant(doc, 'hero', 'marked', 'gold');
		act.setActionAnim(doc, 'hero', 'walk', 's', 'hero_stroll_s');
		const project = [
			'hero_walk_e',
			'hero_walk_w',
			'hero_walk_s',
			'gold_walk_s',
			'hero_run_ne',
			'hero_idle_e',
			'hero_walkabout_e',
		];
		same(
			'8. the clips an action finds by name: both prefixes, but not a facing its cell names',
			act.actionClipsByName(sheet.sheetOf(doc, 'hero'), 'walk', project),
			['hero_walk_e', 'hero_walk_w', 'gold_walk_s'],
		);
		same(
			'8. rename refusals: blank, taken, no such action',
			[
				act.renameAction(doc, 'hero', 'walk', ' ', project).refused,
				act.renameAction(doc, 'hero', 'walk', 'idle', project).refused,
				act.renameAction(doc, 'hero', 'nope', 'x', project).refused,
			].map((r) => r !== null),
			[true, true, true],
		);
		same(
			'8. … which rename nothing',
			actions().map((a) => a.id),
			['walk', 'idle', 'swipe'],
		);
		same(
			'8. a rename to itself touches nothing',
			act.renameAction(doc, 'hero', 'walk', 'walk', project),
			{ refused: null, fallbacks: [], lostClips: [], foundClips: [] },
		);
		same(
			'8. a rename: the fallbacks follow, and the clips the old name found are listed',
			sheeted('rename an action', doc, (d) =>
				act.renameAction(d, 'hero', 'walk', ' run ', project),
			),
			{
				refused: null,
				fallbacks: ['idle', 'swipe'],
				lostClips: ['hero_walk_e', 'hero_walk_w', 'gold_walk_s'],
				foundClips: ['hero_run_ne'],
			},
		);
		same(
			'8. … in the doc',
			actions().map((a) => [a.id, a.fallback]),
			[
				['run', undefined],
				['idle', 'run'],
				['swipe', 'run'],
			],
		);

		// A removal clears the fallbacks that named it.
		same(
			'8. a removal clears the fallbacks naming it, and says so',
			sheeted('remove an action', doc, (d) => act.removeAction(d, 'hero', 'run')),
			{ refused: null, clearedFallbacks: ['idle', 'swipe'] },
		);
		check('8. … in the doc', actions().every((a) => !('fallback' in a)) && actions().length === 2);
		same('8. removing no action is refused', act.removeAction(doc, 'hero', 'run'), {
			refused: 'No such action.',
			clearedFallbacks: [],
		});
		sheeted('remove the rest', doc, (d) => {
			act.removeAction(d, 'hero', 'idle');
			act.removeAction(d, 'hero', 'swipe');
		});
		check('8. the last action removed leaves no key', !('actions' in entry(doc, 'hero')));

		const full = sheetDoc();
		for (let n = 0; n < CHARACTER_SHEET_LIMITS.actions; n++) act.addAction(full, 'hero', 'a');
		check(
			`8. a ${CHARACTER_SHEET_LIMITS.actions + 1}th action is refused`,
			sheeted('action limit', full, (d) => act.addAction(d, 'hero', 'a')).refused !== null &&
				entry(full, 'hero').actions?.length === CHARACTER_SHEET_LIMITS.actions,
		);

		// The four fields are laid down in the normalizer's order, whatever order they were made in.
		const order = sheetDoc();
		act.addAction(order, 'hero', 'idle');
		sheet.setDrawWidth(order, 'hero', '40');
		sheet.setSourcePrefix(order, 'hero', 'hero');
		sheet.setViewKind(order, 'hero', 'side');
		same(
			'8. the four fields keep the normalizer’s order, whatever order they were made in',
			Object.keys(entry(order, 'hero')),
			['id', 'component', 'view', 'source', 'draw', 'actions'],
		);
		const kept = entry(order, 'hero').actions;
		sheet.setDrawWidth(order, 'hero', '50');
		check(
			'8. an edit of one field keeps the others’ objects',
			entry(order, 'hero').actions === kept,
		);
		sheeted('clear the sheet', order, (d) => sheet.clearSheet(d, 'hero'));
		same('8. clearing the sheet leaves the character', entry(order, 'hero'), {
			id: 'hero',
			component: 'hero',
		});
	}

	// The online class, and the references kept in step.
	{
		const doc = sheetDoc();
		sheet.setViewKind(doc, 'hero', 'side');
		same('8. no class names a sheet yet', edit.classesNamingSheet(doc, 'hero'), []);
		same('8. the classes a character can be the sheet of', sheet.classesOfComponent(doc, 'hero'), [
			'knight',
		]);
		same(
			'8. a class of another body is refused, with the reason',
			sheet.linkClassSheet(doc, 'orc', 'hero'),
			'"orc" is the body "goblin", but "hero" is drawn as "hero": a class and its sheet use the same component.',
		);
		same(
			'8. link refusals: no class, no character',
			[
				sheet.linkClassSheet(doc, 'nope', 'hero'),
				sheet.linkClassSheet(doc, 'knight', 'nope'),
				sheet.unlinkClassSheet(doc, 'nope'),
			].map((r) => r !== null),
			[true, true, true],
		);
		check(
			'8. … which link nothing',
			!('sheet' in cls(doc, 'orc')) && !('sheet' in cls(doc, 'knight')),
		);
		sheeted('link', doc, (d) => sheet.linkClassSheet(d, 'knight', 'hero'));
		same(
			'8. a class names its sheet',
			[cls(doc, 'knight'), edit.classesNamingSheet(doc, 'hero')],
			[{ id: 'knight', body: 'hero', speed: 200, sheet: 'hero' }, ['knight']],
		);
		sheeted('unlink', doc, (d) => sheet.unlinkClassSheet(d, 'knight'));
		check('8. unlinking leaves no key', !('sheet' in cls(doc, 'knight')));
		sheet.linkClassSheet(doc, 'knight', 'hero');

		// The class's numbers: Game Config's own setters, on the same entry.
		same(
			'8. a class’s index, for Game Config’s setters',
			[sheet.classIndex(doc, 'orc'), sheet.classIndex(doc, 'nope')],
			[1, -1],
		);
		sheeted('the class’s numbers', doc, (d) => {
			setOnlineCharacterField(d, sheet.classIndex(d, 'knight'), 'speed', '260');
			setOnlineCharacterField(d, sheet.classIndex(d, 'knight'), 'max', '3');
		});
		same('8. Game Config’s setters edit the class and keep its sheet', cls(doc, 'knight'), {
			id: 'knight',
			body: 'hero',
			speed: 260,
			max: 3,
			sheet: 'hero',
		});
		check(
			'8. a random spawn needs spawns',
			sheet.setClassRandomSpawn(doc, 'knight', true) !== null &&
				!('randomSpawn' in cls(doc, 'knight')),
		);
		sheeted('random spawn', doc, (d) => {
			setOnlineCharacterField(d, sheet.classIndex(d, 'knight'), 'spawns', '100, 200; 300, 400');
			sheet.setClassRandomSpawn(d, 'knight', true);
		});
		same('8. a random spawn', cls(doc, 'knight').randomSpawn, true);
		sheeted('random spawn off', doc, (d) => sheet.setClassRandomSpawn(d, 'knight', false));
		check('8. off is not stored', !('randomSpawn' in cls(doc, 'knight')));

		// Rename.
		{
			const salmons = JSON.parse(JSON.stringify(salmonsBeforeItsBotSalmon())) as GameConfigDoc;
			const refused = edit.renameCharacter(salmons, 'bearBot', 'grizzly');
			same(
				'8. a rename: the bots that play its brain follow',
				[refused, (salmons.arcade?.online?.bots?.characters ?? []).map((bot) => bot.brain).sort()],
				[null, ['fishermanBot', 'grizzly']],
			);
		}
		same(
			'8. a refused rename touches no class',
			[sheet.renameSheetCharacter(doc, 'hero', 'goblin').followed, cls(doc, 'knight').sheet],
			[[], 'hero'],
		);
		same(
			'8. a rename: the classes that named it follow',
			sheeted('rename a sheet’s character', doc, (d) =>
				sheet.renameSheetCharacter(d, 'hero', ' paladin '),
			),
			{ refused: null, followed: ['knight'], adopted: [], mismatched: [] },
		);
		same(
			'8. … in the doc',
			[cls(doc, 'knight').sheet, edit.classesNamingSheet(doc, 'paladin')],
			['paladin', ['knight']],
		);
		same(
			'8. a rename to itself touches none',
			sheet.renameSheetCharacter(doc, 'paladin', 'paladin'),
			{
				refused: null,
				followed: [],
				adopted: [],
				mismatched: [],
			},
		);
		cls(doc, 'orc').sheet = 'ghost';
		same(
			'8. a rename onto an id a class already names says the class is adopted',
			sheet.renameSheetCharacter(doc, 'goblin', 'ghost'),
			{ refused: null, followed: [], adopted: ['orc'], mismatched: [] },
		);
		edit.renameCharacter(doc, 'ghost', 'goblin');
		same('8. the page’s own rename keeps the class in step too', cls(doc, 'orc').sheet, 'goblin');

		// A look change.
		same(
			'8. the same look keeps the link',
			[edit.setLook(doc, 'paladin', 'hero'), cls(doc, 'knight').sheet],
			[[], 'paladin'],
		);
		same(
			'8. another look: a class of the old body loses its sheet',
			sheeted('look change', doc, (d) => edit.setLook(d, 'paladin', 'wizard')),
			['knight'],
		);
		check(
			'8. … and keeps its body (the room’s rules are not changed)',
			!('sheet' in cls(doc, 'knight')) &&
				cls(doc, 'knight').body === 'hero' &&
				cls(doc, 'orc').sheet === 'goblin',
		);
		same(
			'8. a blank look changes nothing',
			[edit.setLook(doc, 'paladin', ' '), entry(doc, 'paladin').component],
			[[], 'wizard'],
		);

		// A removal.
		edit.setLook(doc, 'paladin', 'hero');
		sheet.linkClassSheet(doc, 'knight', 'paladin');
		same(
			'8. a removal: the classes that named it lose their sheet',
			sheeted('remove a sheet’s character', doc, (d) => edit.removeCharacter(d, 'paladin')),
			['knight'],
		);
		check(
			'8. … in the doc, and no other class is touched',
			!('sheet' in cls(doc, 'knight')) &&
				cls(doc, 'orc').sheet === 'goblin' &&
				!edit.findCharacter(doc, 'paladin'),
		);
		same('8. removing no character touches none', edit.removeCharacter(doc, 'paladin'), []);

		// A duplicate keeps the sheet, and no class names it.
		sheet.setSourcePrefix(doc, 'goblin', 'goblin');
		act.addAction(doc, 'goblin', 'idle');
		const copyId = sheeted('duplicate', doc, (d) => edit.duplicateCharacter(d, 'goblin'))!;
		same(
			'8. a duplicate keeps the sheet; no class names the copy',
			[sheet.sheetOf(doc, copyId), edit.classesNamingSheet(doc, copyId), cls(doc, 'orc').sheet],
			[sheet.sheetOf(doc, 'goblin'), [], 'goblin'],
		);
	}

	// Make this a sheet, and Compare with the saved config, on Salmons.
	/** The stored config: Salmons' reference one, as a save makes it. */
	const published = normalizeGameConfigDoc(salmonsBeforeItsBotSalmon()) as GameConfigDoc;
	const components: WholeComponent[] = SALMONS_CHARACTER_COMPONENTS.map(
		({ id, name, scope, characterClips }) => ({ id, name, scope, characterClips }),
	);
	const blocks = new Map(
		projectCharacters(components, published)
			.filter((pc) => pc.inConfig)
			.map((pc) => [pc.key, pc.look]),
	);
	/** Every name a block's states and facings give, under each of its prefixes. */
	const namesOf = (look: CharacterClips): string[] =>
		[look.prefixes.base, ...(look.prefixes.marked ? [look.prefixes.marked] : [])].flatMap(
			(prefix) =>
				(sheetOfCharacterClips(look).actions ?? []).flatMap((a) =>
					CHARACTER_FACINGS.map((facing) => `${prefix}_${a.id}_${facing}`),
				),
		);
	const made = openDoc(structuredClone(published));
	{
		same(
			'8. Salmons’ three classes each play a block',
			[...blocks.keys()],
			['salmon', 'bear', 'fisherman'],
		);
		const publishedText = text(published);
		const results: Record<string, unknown> = {};
		for (const [classId, look] of blocks) {
			const before = chk.classDrawing(published, classId, look);
			check(`8. ${classId}: the saved config draws it from its block`, before.kind === 'block');
			const result = sheeted(`make ${classId} a sheet`, made, (d) =>
				sheet.makeClassSheet(d, classId, look),
			);
			results[classId] = result;
			const characterId = result.characterId!;
			same(
				`8. ${classId}: its rows are exactly sheetOfCharacterClips of the block it plays`,
				sheet.sheetOf(made, characterId),
				sheetOfCharacterClips(look),
			);
			check(
				`8. ${classId}: … as makeSheetFrom gives them, byte for byte`,
				text(sheet.sheetOf(made, characterId)) === text(sheet.makeSheetFrom(look)),
			);
			same(`8. ${classId}: the class names it`, cls(made, classId).sheet, characterId);
			const after = chk.classDrawing(made, classId, look);
			same(
				`8. ${classId}: the edited game draws it from the sheet`,
				[after.kind, chk.classSheetStatus(made, classId)],
				['sheet', { sheet: characterId, inForce: true }],
			);
			const all = namesOf(look);
			const sets: [string, string[]][] = [
				['no clip made', []],
				['every clip made', all],
				['only the east facings made', all.filter((id) => /_(ne|e|se)$/.test(id))],
				['only one facing made', all.filter((id) => id.endsWith('_se'))],
				['every third clip made', all.filter((_, i) => i % 3 === 0)],
				['only the base prefix made', all.slice(0, all.length / (look.prefixes.marked ? 2 : 1))],
			];
			for (const [name, clipIds] of sets) {
				same(
					`8. ${classId}, ${name}: Compare lists nothing`,
					chk.compareCells(before, after, clipIds),
					[],
				);
			}
			same(
				`8. ${classId}: … and the two say the same as sheets`,
				chk.compareSheets(before, after),
				[],
			);
			check(
				`8. ${classId}: the comparison is not empty-handed (the block resolves a clip)`,
				resolveCharacterClip(look, look.idle, 'se', false, (id) => all.includes(id)) !== undefined,
			);
		}
		same(
			'8. the bear and the fisherman keep their config character; the salmon gets a new one',
			results,
			{
				salmon: { refused: null, characterId: 'salmonsSalmon', created: true },
				bear: { refused: null, characterId: 'bearBot', created: false },
				fisherman: { refused: null, characterId: 'fishermanBot', created: false },
			},
		);
		same(
			'8. the new entry: its id, its component, its sheet',
			Object.keys(entry(made, 'salmonsSalmon')),
			['id', 'component', 'view', 'source', 'draw', 'actions'],
		);
		same(
			'8. … drawn as the class’s body',
			entry(made, 'salmonsSalmon').component,
			cls(made, 'salmon').body,
		);
		same(
			'8. the bots’ brains are untouched',
			(made.arcade?.characters ?? []).slice(0, 2).map((c) => text(c.brain)),
			(published.arcade?.characters ?? []).map((c) => text(c.brain)),
		);
		check(
			'8. making a sheet changes nothing else of the config',
			(() => {
				const stripped = JSON.parse(text(made)) as GameConfigDoc;
				stripped.arcade!.characters = stripped.arcade!.characters!.filter(
					(c) => c.id !== 'salmonsSalmon',
				);
				for (const c of stripped.arcade!.characters) sheet.clearSheet(stripped, c.id);
				for (const c of stripped.arcade!.online!.characters) delete c.sheet;
				return canon(stripped) === canon(openDoc(structuredClone(published)));
			})(),
		);
		same('8. the published config was only read', text(published), publishedText);
		check(
			'8. a character with a sheet is not made one again',
			sheet.makeClassSheet(made, 'bear', blocks.get('bear')!).refused !== null &&
				sheet.makeCharacterSheet(made, 'bearBot', blocks.get('bear')!) !== null,
		);
		same(
			'8. Make refusals: no class, no character',
			[
				sheet.makeClassSheet(made, 'nope', blocks.get('bear')!).refused,
				sheet.makeCharacterSheet(made, 'nope', blocks.get('bear')!),
			].map((r) => r !== null),
			[true, true],
		);
		const other = sheetDoc();
		cls(other, 'knight').sheet = 'goblin';
		check(
			'8. a class that names another character is not re-pointed',
			sheet.makeClassSheet(other, 'knight', blocks.get('bear')!).refused !== null &&
				cls(other, 'knight').sheet === 'goblin',
		);
		const plainCharacter = sheetDoc();
		same(
			'8. a character with no class takes a block as its sheet too',
			[
				sheeted('make a character a sheet', plainCharacter, (d) =>
					sheet.makeCharacterSheet(d, 'hero', blocks.get('bear')!),
				),
				sheet.sheetOf(plainCharacter, 'hero'),
			],
			[null, sheet.makeSheetFrom(blocks.get('bear')!)],
		);
	}

	// Compare lists every change.
	{
		const look = blocks.get('bear')!;
		const salmonLook = blocks.get('salmon')!;
		const clipIds = [...namesOf(look), ...namesOf(salmonLook), 'bear_special'];
		const before = (classId: string) => chk.classDrawing(published, classId, blocks.get(classId));
		/** The differences an edit of the made doc makes, against the block and against the made
		 *  doc as stored. */
		const changed = (classId: string, run: (d: GameConfigDoc) => unknown, ids = clipIds) => {
			const edited = JSON.parse(text(made)) as GameConfigDoc;
			run(edited);
			const after = chk.classDrawing(edited, classId, blocks.get(classId));
			const cells = chk.compareCells(before(classId), after, ids);
			const stored = chk.classDrawing(made, classId, blocks.get(classId));
			check(
				`8. Compare against the stored sheet lists what Compare against the block does (${classId})`,
				text(chk.compareCells(stored, after, ids)) === text(cells),
			);
			return { cells, sheets: chk.compareSheets(before(classId), after), after };
		};
		const cell = (d: chk.CellDifference) => (d.kind === 'cell' ? d : undefined);

		const renamed = changed('bear', (d) => act.renameAction(d, 'bearBot', 'walk', 'stroll'));
		check(
			'8. Compare: a renamed action is on one side only, each way',
			renamed.cells.some((d) => d.kind === 'action' && d.id === 'walk' && d.only === 'before') &&
				renamed.cells.some((d) => d.kind === 'action' && d.id === 'stroll' && d.only === 'after'),
			text(renamed.cells.slice(0, 4)),
		);
		check(
			'8. … with no clip made as well',
			changed('bear', (d) => act.renameAction(d, 'bearBot', 'walk', 'stroll'), []).cells.length >=
				2,
		);
		check(
			'8. … and as sheets',
			renamed.sheets.some((d) => d.where === 'action:walk' && d.after === '—') &&
				renamed.sheets.some((d) => d.where === 'action:stroll' && d.before === '—'),
		);

		const prefixed = changed('bear', (d) => sheet.setSourcePrefix(d, 'bearBot', 'grizzly'));
		const bearCells = (sheetOfCharacterClips(look).actions ?? []).length * 8;
		check(
			'8. Compare: another prefix changes every cell that drew a clip',
			prefixed.cells.length === bearCells &&
				prefixed.cells.every(
					(d) => cell(d)?.differs === 'clip' && cell(d)?.after === undefined && !!cell(d)?.before,
				),
			`${prefixed.cells.length} of ${bearCells}`,
		);
		same('8. … and as sheets', prefixed.sheets, [
			{ where: 'source', field: 'prefix', before: 'bear', after: 'grizzly' },
		]);
		const unmade = changed('bear', (d) => sheet.setSourcePrefix(d, 'bearBot', 'grizzly'), []);
		same(
			'8. with no clip made no cell draws differently, and the sheets still differ',
			[unmade.cells, unmade.sheets.length],
			[[], 1],
		);

		const four = changed('bear', (d) => sheet.setViewFacings(d, 'bearBot', 4));
		same(
			'8. Compare: eight facings to four: the straight ones are only before',
			four.cells.filter((d) => d.kind === 'facing'),
			['n', 'e', 's', 'w'].map((id) => ({ kind: 'facing', id, only: 'before' })),
		);
		const eight = changed('salmon', (d) => sheet.setViewFacings(d, 'salmonsSalmon', 8));
		same(
			'8. Compare: four facings to eight: the straight ones are only after',
			eight.cells.filter((d) => d.kind === 'facing'),
			['n', 'e', 's', 'w'].map((id) => ({ kind: 'facing', id, only: 'after' })),
		);
		check(
			'8. … and as sheets',
			eight.sheets.some((d) => d.where === 'view' && d.field === 'facings'),
		);
		const topDown = changed('bear', (d) => sheet.setViewKind(d, 'bearBot', 'topDown'));
		same(
			'8. a top-down view of eight draws the same cells, and is another sheet',
			[topDown.cells, topDown.sheets],
			[[], [{ where: 'view', field: 'kind', before: 'isometric', after: 'topDown' }]],
		);

		const celled = changed('bear', (d) =>
			act.setActionAnim(d, 'bearBot', 'idle', 'e', 'bear_special'),
		);
		check(
			'8. Compare: a cell that names a clip draws it',
			celled.cells.some(
				(d) =>
					cell(d)?.action === 'idle' &&
					cell(d)?.facing === 'e' &&
					cell(d)?.before?.clipId === 'bear_idle_e' &&
					cell(d)?.after?.clipId === 'bear_special',
			),
			text(celled.cells.slice(0, 3)),
		);
		check(
			'8. … and as sheets',
			celled.sheets.some((d) => d.where === 'action:idle' && d.field === 'anim'),
		);

		const eastOnly = clipIds.filter((id) => /_(n|ne|e|se|s)$/.test(id));
		const unmirrored = changed('bear', (d) => sheet.setViewMirror(d, 'bearBot', false), eastOnly);
		check(
			'8. Compare: with the mirror off the west facings are no longer drawn mirrored',
			unmirrored.cells.length > 0 &&
				unmirrored.cells.every(
					(d) => cell(d)?.before?.flipX === true && cell(d)?.after?.flipX === false,
				) &&
				unmirrored.cells.every((d) => ['sw', 'w', 'nw'].includes(cell(d)?.facing ?? '')),
			text(unmirrored.cells.slice(0, 3)),
		);
		same('8. … and as sheets', unmirrored.sheets, [
			{ where: 'view', field: 'mirror', before: 'on', after: 'off' },
		]);

		const standsIn = (sheet.sheetOf(made, 'bearBot')?.actions ?? []).find((a) => a.fallback)!;
		const without = clipIds.filter((id) => !id.startsWith(`bear_${standsIn.id}_`));
		const bare = changed(
			'bear',
			(d) => act.setActionFallback(d, 'bearBot', standsIn.id, ''),
			without,
		);
		check(
			'8. Compare: without its fallback an action with no clip draws nothing',
			bare.cells.length === 8 &&
				bare.cells.every(
					(d) =>
						cell(d)?.action === standsIn.id && !!cell(d)?.before && cell(d)?.after === undefined,
				),
			text(bare.cells.slice(0, 3)),
		);
		check(
			'8. … and as sheets',
			bare.sheets.length === 1 &&
				bare.sheets[0].where === `action:${standsIn.id}` &&
				bare.sheets[0].field === 'fallback',
		);

		const marked = changed('salmon', (d) =>
			sheet.setVariantPrefix(d, 'salmonsSalmon', 'marked', 'salmon_shiny'),
		);
		check(
			'8. Compare covers the marked art: another variant prefix changes only the marked cells',
			marked.cells.length > 0 &&
				marked.cells.every((d) => text(cell(d)?.statuses) === text(['marked'])),
			text(marked.cells.slice(0, 3)),
		);
		const unmarked = changed('salmon', (d) => sheet.removeVariant(d, 'salmonsSalmon', 'marked'));
		check(
			'8. … and so does taking the variant away (the base clip is drawn, and tinted)',
			unmarked.cells.length > 0 &&
				unmarked.cells.every(
					(d) => cell(d)?.before?.variant === 'marked' && cell(d)?.after?.variant === undefined,
				),
		);

		const width = changed('bear', (d) => sheet.setDrawWidth(d, 'bearBot', '120'));
		same(
			'8. a width, a trigger, an order: no cell, but another sheet',
			[
				width.cells,
				width.sheets.map((d) => [d.where, d.field]),
				changed('bear', (d) => act.setActionPlay(d, 'bearBot', 'idle', 'once')).sheets.map((d) => [
					d.where,
					d.field,
				]),
				changed('bear', (d) => act.moveAction(d, 'bearBot', 'idle', 1)).sheets.map((d) => [
					d.where,
					d.field,
				]),
			],
			[[], [['draw', 'width']], [['action:idle', 'play']], [['actions', 'order']]],
		);

		// The drawn clip alone: the same clip mirrored the other way, and under another variant.
		const drawing = (s: CharacterSheet): chk.ClassDrawing => ({
			kind: 'sheet',
			sheet: s,
			character: 'x',
		});
		const side = (mirror: boolean): CharacterSheet => ({
			view: mirror ? { kind: 'side' } : { kind: 'side', mirror: false },
			source: { kind: 'clips', prefix: 'x' },
			draw: { width: 10 },
			actions: [{ id: 'idle', when: { motion: 'still' } }],
		});
		same(
			'8. Compare: the same clip mirrored the other way',
			chk.compareCells(drawing(side(true)), drawing(side(false)), ['x_idle_e']),
			[
				{
					kind: 'cell',
					action: 'idle',
					facing: 'w',
					statuses: [],
					differs: 'mirror',
					before: { clipId: 'x_idle_e', flipX: true },
					after: { clipId: 'x_idle_e', flipX: false },
				},
			],
		);
		const gold = (variant: boolean): CharacterSheet => ({
			view: { kind: 'side' },
			source: variant
				? { kind: 'clips', prefix: 'g', variants: { marked: 'g' } }
				: { kind: 'clips', prefix: 'g' },
			draw: { width: 10 },
			actions: [{ id: 'idle', when: { motion: 'still' } }],
		});
		same(
			'8. Compare: the same clip under a variant or not (drawn as made, or tinted)',
			chk
				.compareCells(drawing(gold(true)), drawing(gold(false)), ['g_idle_e'])
				.map((d) => [cell(d)?.facing, cell(d)?.statuses, cell(d)?.differs]),
			[
				['e', ['marked'], 'variant'],
				['w', ['marked'], 'variant'],
			],
		);
		same(
			'8. Compare: nothing drawn before lists every action and facing',
			chk.compareCells({ kind: 'none' }, drawing(side(true)), []),
			[
				{ kind: 'action', id: 'idle', only: 'after' },
				{ kind: 'facing', id: 'e', only: 'after' },
				{ kind: 'facing', id: 'w', only: 'after' },
			],
		);
		same(
			'8. how a class is drawn: its sheet in force, else its block, else neither',
			[
				chk.classDrawing(made, 'bear', look).kind,
				chk.classDrawing(published, 'bear', look).kind,
				chk.classDrawing(published, 'bear', undefined).kind,
				chk.classDrawing(null, 'bear', undefined).kind,
			],
			['sheet', 'block', 'none', 'none'],
		);
	}

	// The tool's warnings.
	{
		const warned: CharacterSheet = {
			view: { kind: 'side' },
			source: { kind: 'clips', prefix: 'Bear', variants: { marked: 'Gold Bear', out: 'bear_out' } },
			draw: { width: 10 },
			actions: [
				{ id: 'idle', when: { motion: 'still' } },
				{ id: 'pickUp', anim: { e: { clip: 'Bear_Grab' } } },
			],
		};
		const messages = chk.sheetWarnings(warned).map((w) => [w.on, w.action, w.message]);
		same(
			'8. a capital can never match a stored clip: the prefix, a variant’s, an action found by name, a cell',
			messages.map(([on, action]) => [on, action]),
			[
				['source', undefined],
				['source', undefined],
				['actions', 'pickUp'],
				['actions', 'pickUp'],
			],
		);
		check(
			'8. … each saying what Flipbook stores the name as',
			['"bear"', '"gold_bear"', '"pickup"', '"bear_grab"'].every((stored, i) =>
				String(messages[i][2]).includes(`stores that name as ${stored}`),
			),
			text(messages),
		);
		check(
			'8. the rule is Flipbook’s own (clipIdOf)',
			['bear', 'Bear', 'gold bear', 'bear_gold', 'b2', 'bär', 'a-b', 'pickUp'].every(
				(name) => isClipIdText(name) === (clipIdOf(name) === name),
			),
		);
		const named: CharacterSheet = {
			view: { kind: 'side' },
			source: { kind: 'clips', prefix: 'bear' },
			draw: { width: 10 },
			actions: [{ id: 'pickUp', anim: { e: { clip: 'bear_grab' }, w: { clip: 'bear_grab_w' } } }],
		};
		same(
			'8. an action whose every facing names its clip is not found by name: no warning',
			chk.sheetWarnings(named),
			[],
		);
		same(
			'8. a name longer than a clip id',
			chk
				.sheetWarnings({
					...named,
					actions: [{ id: 'a'.repeat(60) }, { id: 'ok', anim: { e: { clip: 'b'.repeat(61) } } }],
				})
				.map((w) => [w.action, w.message.includes('holds 60 characters')]),
			[
				['a'.repeat(60), true],
				['ok', true],
			],
		);
		same(
			'8. a clean sheet, and no sheet, have no warning',
			[chk.sheetWarnings(sheet.makeSheetFrom(blocks.get('bear')!)), chk.sheetWarnings(undefined)],
			[[], []],
		);

		// A class whose sheet is not in force, and why.
		const doc = sheetDoc();
		const status = () => chk.classSheetStatus(doc, 'knight');
		const whys: (string | undefined)[] = [chk.classSheetStatus(doc, 'nope').why, status().why];
		cls(doc, 'knight').sheet = 'ghost';
		whys.push(status().why);
		cls(doc, 'knight').sheet = 'goblin';
		whys.push(status().why);
		cls(doc, 'knight').sheet = 'hero';
		whys.push(status().why);
		sheet.setViewKind(doc, 'hero', 'side');
		whys.push(status().why);
		sheet.setSourcePrefix(doc, 'hero', 'hero');
		whys.push(status().why);
		sheet.setDrawWidth(doc, 'hero', '40');
		whys.push(status().why);
		act.addAction(doc, 'hero', 'idle');
		same('8. why a class’s sheet is not in force, step by step', whys, [
			'No such online class.',
			'It names no sheet.',
			'No character is "ghost".',
			'"goblin" is drawn as "goblin", but the class is the body "hero": a class and its sheet use the same component.',
			'"hero" has no view, animation source, draw box or actions.',
			'The sheet has no animation source.',
			'The draw box has no width.',
			'The sheet has no action.',
		]);
		same(
			'8. … and then it is',
			[status(), chk.classDrawing(doc, 'knight', undefined).kind],
			[{ sheet: 'hero', inForce: true }, 'sheet'],
		);
		entry(doc, 'hero').view = { kind: '3d' };
		same(
			'8. a 3D view draws no clip',
			[status().inForce, status().why, chk.classDrawing(doc, 'knight', undefined).kind],
			[false, 'A 3D view has no facings, so no clip is drawn.', 'none'],
		);
	}

	// The page's issues are the save's, and the round trip through the real save and load.
	{
		const src = (rel: string): string => new URL(`../src/${rel}`, import.meta.url).href;
		class ConflictError extends Error {}
		type Cond = { ifMatch?: string; ifNoneMatch?: string };
		const put = (key: string, body: string, cond?: Cond): string => {
			const current = R2.get(key);
			if (cond?.ifNoneMatch && current) throw new ConflictError(key);
			if (cond?.ifMatch && current?.etag !== cond.ifMatch) throw new ConflictError(key);
			const etag = etagOfBytes(body);
			R2.set(key, { body, etag });
			return etag;
		};
		const r2: Record<string, unknown> = {
			ConflictError,
			// The route's own reading of a request's `baseEtag` (§10), not a copy of it.
			jsonBaseEtag: ((await import(src('lib/server/r2.ts'))) as { jsonBaseEtag: unknown })
				.jsonBaseEtag,
			precondition: (base: string | null | undefined) =>
				base === undefined ? undefined : base === null ? { ifNoneMatch: '*' } : { ifMatch: base },
			getObjectText: async (key: string) => R2.get(key)?.body ?? null,
			getObjectTextWithEtag: async (key: string) => {
				const o = R2.get(key);
				return o ? { text: o.body, etag: o.etag } : null;
			},
			putObjectText: async (key: string, body: string, _type: string, cond?: Cond) =>
				put(key, body, cond),
			headObject: async (key: string) =>
				R2.has(key)
					? { etag: R2.get(key)!.etag, size: R2.get(key)!.body.length, lastModified: 1 }
					: null,
			copyObject: async (from: string, to: string, _type?: string, sourceEtag?: string) => {
				const o = R2.get(from);
				if (!o || (sourceEtag && o.etag !== sourceEtag)) return false;
				R2.set(to, { ...o });
				return true;
			},
			deleteObjects: async (keys: string[]) => keys.forEach((key) => R2.delete(key)),
			listAllObjects: async (prefix: string) =>
				[...R2.keys()]
					.filter((key) => key.startsWith(prefix))
					.map((key) => ({ key, size: R2.get(key)!.body.length, lastModified: 1 })),
		};
		const namedExports: Record<string, unknown> = {};
		for (const m of readFileSync(fileURLToPath(src('lib/server/r2.ts')), 'utf8').matchAll(
			/^export (?:async )?(?:function\*?|class|const|let) (\w+)/gm,
		))
			namedExports[m[1]] =
				r2[m[1]] ??
				moreR2(R2)[m[1]] ??
				(() => {
					throw new Error(`fixture: r2.ts ${m[1]} is not faked`);
				});
		mock.module(src('lib/server/r2.ts'), { namedExports });
		const storage = await import('../src/lib/server/gameConfigStorage.ts');
		const { gameConfigDocKey } = await import('../src/lib/server/projectPaths.ts');
		const CLIENT = 'acme';

		const errorsOf = (issues: GameConfigIssue[]) => issues.filter((i) => i.severity === 'error');
		/** What the save says of a doc: its warnings, or the errors it refuses it for. */
		const saveSays = (doc: GameConfigDoc): GameConfigIssue[] => {
			try {
				return storage.prepareGameConfigDoc(bodyFor(doc)).warnings;
			} catch (e) {
				if (e instanceof storage.InvalidGameConfigError) return e.issues;
				throw e;
			}
		};
		const pageSays = (doc: GameConfigDoc): GameConfigIssue[] => {
			const { issues } = chk.pageIssues(doc);
			return errorsOf(issues).length ? errorsOf(issues) : issues;
		};

		const dangling = sheetDoc();
		cls(dangling, 'knight').sheet = 'ghost';
		const undrawable = sheetDoc();
		sheet.setSourcePrefix(undrawable, 'hero', 'hero');
		sheet.linkClassSheet(undrawable, 'knight', 'hero');
		const looping = sheetDoc();
		sheet.makeCharacterSheet(looping, 'hero', blocks.get('bear')!);
		act.addAction(looping, 'hero', 'idle2');
		act.addTrigger(looping, 'hero', 'idle2', { motion: 'still' });
		act.setActionFallback(looping, 'hero', 'idle2', 'idle');
		const cases: [string, GameConfigDoc][] = [
			['Salmons as published', openDoc(structuredClone(published))],
			['Salmons with its three sheets', made],
			['a plain config', sheetDoc()],
			['a class naming no character', dangling],
			['frame clips with no width and no action', undrawable],
			['two loops on one trigger', looping],
			['a rig, still images, and clips with a still and a rig cell', c6Doc()],
		];
		for (const [name, doc] of cases)
			same(`8. the page’s issues are the save’s: ${name}`, pageSays(doc), saveSays(doc));
		check(
			'8. … and they are not all empty: the save refuses clips with no width, and warns of the rest',
			errorsOf(saveSays(undrawable)).length === 2 &&
				saveSays(dangling).some((i) => i.path === 'arcade.online.characters[0].sheet') &&
				saveSays(looping).some((i) => i.path === 'arcade.characters[0].actions[3]'),
			text([saveSays(undrawable), saveSays(dangling), saveSays(looping).map((i) => i.path)]),
		);
		const unplayed = (issues: GameConfigIssue[]) =>
			issues.filter((i) => i.message.includes('no bot plays'));
		const unlinkedSalmon = JSON.parse(text(made)) as GameConfigDoc;
		sheet.unlinkClassSheet(unlinkedSalmon, 'salmon');
		same(
			'8. a character that is a class’s sheet is not told "no bot plays it"; unlinked, it is',
			[
				unplayed(chk.pageIssues(made).issues).length,
				unplayed(validateGameConfigDoc(made)).length,
				unplayed(chk.pageIssues(unlinkedSalmon).issues).length,
			],
			[0, 1, 1],
		);

		// The screen's projection: known to the page, not to the save.
		same(
			'8. the one projection, from the screens’: isometric when one is, else flat, else not known',
			[chk.sheetProjection(['isometric']), chk.sheetProjection([]), chk.sheetProjection(undefined)],
			['isometric', 'flat', undefined],
		);
		const flat = chk.pageIssues(made, 'flat');
		same(
			'8. an isometric view on flat screens: a warning per sheet, kept apart from the save’s issues',
			[flat.screen.map((i) => i.path), text(flat.issues) === text(chk.pageIssues(made).issues)],
			[
				['arcade.characters[0].view', 'arcade.characters[1].view', 'arcade.characters[2].view'],
				true,
			],
		);
		same(
			'8. … none on an isometric screen, and none with no screen known',
			[chk.pageIssues(made, 'isometric').screen, chk.pageIssues(made).screen],
			[[], []],
		);
		same(
			'8. … and only those: a warning the save makes too stays in its list',
			[
				chk.pageIssues(looping, 'flat').screen.map((x) => x.path),
				chk
					.pageIssues(looping, 'flat')
					.issues.some((x) => x.path === 'arcade.characters[0].actions[3]'),
			],
			[['arcade.characters[0].view'], true],
		);
		const topDown = JSON.parse(text(made)) as GameConfigDoc;
		sheet.setViewKind(topDown, 'bearBot', 'topDown');
		same(
			'8. a top-down view on an isometric screen',
			chk.pageIssues(topDown, 'isometric').screen.map((i) => i.path),
			['arcade.characters[0].view'],
		);
		same(
			'8. the issues of one card, and of one class',
			[
				chk.sheetCardIssues(flat.screen, 1, 'view').length,
				chk.sheetCardIssues(saveSays(undrawable), 0, 'draw').length,
				chk.sheetCardIssues(saveSays(looping), 0, 'actions').map((i) => i.path),
				chk.sheetCardIssues(saveSays(looping), 1, 'actions').length,
				chk.classIssues(saveSays(dangling), 0).length,
				chk.classIssues(saveSays(dangling), 1).length,
			],
			[1, 1, ['arcade.characters[0].actions[3]'], 0, 1, 0],
		);

		// The round trip: the page opens, saves, and opens what was stored.
		const stored = (project: string): string => R2.get(gameConfigDocKey(CLIENT, project))!.body;
		const unstamped = (bytes: string): string => {
			const doc = JSON.parse(bytes) as Record<string, unknown>;
			delete doc.updatedAt;
			return JSON.stringify(doc, null, 2);
		};
		setRoundTrip({
			client: CLIENT,
			save: storage.saveGameConfigDoc,
			load: storage.loadGameConfigDocWithEtag,
			stored,
		});
		const with3d = JSON.parse(text(made)) as GameConfigDoc & { arcade: { world3d?: unknown } };
		with3d.arcade.world3d = WORLD_3D;
		const held = JSON.parse(text(made)) as GameConfigDoc;
		check(
			'8. the salmon’s catch can be made to hold',
			act.setActionPlay(held, 'salmonsSalmon', 'caught', 'hold') === null &&
				text(
					(held.arcade?.characters ?? [])
						.find((c) => c.id === 'salmonsSalmon')
						?.actions?.find((a) => a.id === 'caught'),
				) === text({ id: 'caught', when: { event: 'caught', as: 'target' }, play: 'hold' }),
		);
		const trips: [string, GameConfigDoc][] = [
			['no sheet', openDoc(structuredClone(published))],
			['three sheets', made],
			['three sheets, the salmon’s catch held', held],
			['three sheets and a 3D world', with3d],
			...C6_IDS.map((id): [string, GameConfigDoc] => [`${C6_NAMES[id]}`, c6Doc([id])]),
		];
		const tripped = new Map<string, string>();
		for (const [name, config] of trips) {
			const bytes = await roundTrip({ check, same }, '8', name, config);
			if (bytes === undefined) continue;
			tripped.set(name, bytes);
			const c6 = C6_IDS.find((id) => C6_NAMES[id] === name);
			if (c6)
				check(
					`8. round trip, ${name}: the stored sheet is the fixture's, byte for byte`,
					text(sheet.sheetFieldsOf(JSON.parse(bytes).arcade.characters[0])) === text(C6_SHEETS[c6]),
					text(JSON.parse(bytes).arcade.characters[0]),
				);
		}
		const plainBytes = tripped.get('no sheet')!;
		check(
			'8. a config with no sheet saves today’s bytes: the normalizer’s doc and a stamp',
			unstamped(plainBytes) ===
				JSON.stringify(normalizeGameConfigDoc(structuredClone(published)), null, 2),
		);
		check(
			'8. … with no sheet key anywhere',
			!/"(sheet|view|source|draw|actions)":/.test(text(JSON.parse(plainBytes).arcade.characters)) &&
				!/"sheet":/.test(text(JSON.parse(plainBytes).arcade.online.characters)),
		);
		check(
			'8. the 3D world is stored beside the sheets',
			text(JSON.parse(tripped.get('three sheets and a 3D world')!).arcade.world3d) ===
				text(WORLD_3D) &&
				JSON.parse(tripped.get('three sheets and a 3D world')!).arcade.online.characters[0]
					.sheet === 'salmonsSalmon',
		);
	}

	// Pure: no Svelte, no server, and no `structuredClone` of the page's doc.
	for (const file of [
		'characterSheetEdit.ts',
		'characterSheetActions.ts',
		'characterSheetCheck.ts',
	]) {
		const source = readFileSync(new URL(`../src/lib/characters/${file}`, import.meta.url), 'utf8');
		check(
			`8. ${file} is pure: no Svelte, no server module, no structuredClone`,
			!/from '(svelte|\$app|\$lib\/server|\$env)/.test(source) &&
				!source.includes('structuredClone('),
		);
	}
}

// ── 9. The sheet on the page (character pipeline C2b) ─────────────────────────────────────────
{
	const text = (v: unknown): string => JSON.stringify(v);
	const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
	const salmons = (): GameConfigDoc => {
		const raw = salmonsBeforeItsBotSalmon();
		return withCharacterSheets(normalizeGameConfigDoc(raw) as GameConfigDoc, raw);
	};
	const components: WholeComponent[] = SALMONS_CHARACTER_COMPONENTS.map(
		({ id, name, scope, characterClips }) => ({ id, name, scope, characterClips }),
	);
	const castOf = (doc: GameConfigDoc) => pg.castOf(components, doc);
	const bearClips = characterClipNames(
		components.find((c) => c.id === 'salmonsBear')!.characterClips!,
	)
		.filter((n) => n.drawn)
		.map((n) => n.id);
	const query = (q: string) => pg.parseSheetQuery(new URLSearchParams(q), salmons());

	// The link that opens a card.
	same(
		'9. ?character=&card= opens that character on that card',
		[query('character=fishermanBot&card=view'), query('character=fishermanBot&card=online')],
		[
			{ characterId: 'fishermanBot', card: 'view' },
			{ characterId: 'fishermanBot', card: 'online' },
		],
	);
	same(
		'9. an unknown character is today’s page (the first one), and its card is dropped',
		[query('character=nobody&card=view'), query('card=view'), query('')],
		[{ characterId: 'bearBot' }, { characterId: 'bearBot' }, { characterId: 'bearBot' }],
	);
	same(
		'9. an unknown card opens the character only; a config with no character selects none',
		[
			query('character=fishermanBot&card=timing'),
			pg.parseSheetQuery(new URLSearchParams('character=a&card=view'), base()),
		],
		[{ characterId: 'fishermanBot' }, { characterId: null }],
	);
	same(
		'9. the cards a link can name, each with a title and an element id',
		pg.SHEET_CARDS.map((card) => [card, pg.SHEET_CARD_TITLES[card], pg.sheetCardId(card)]),
		[
			['sheet', 'Character sheet', 'sheet-sheet'],
			['view', 'View', 'sheet-view'],
			['source', 'Animation source', 'sheet-source'],
			['draw', 'Draw box and points', 'sheet-draw'],
			['actions', 'Actions', 'sheet-actions'],
			['online', 'Online class', 'sheet-online'],
		],
	);

	// The classes with no character, and what Make this a sheet is made from.
	{
		const doc = salmons();
		same('9. Salmons: the salmon is the class with no character', pg.classesWithoutCharacter(doc), [
			'salmon',
		]);
		same('9. a config with no room has none', pg.classesWithoutCharacter(base()), []);
		const cast = castOf(doc);
		const from = pg.sheetSourceFor(cast, doc, 'bearBot');
		same(
			'9. the bear’s sheet is made from the block its class plays',
			[from?.classId, text(from?.look) === text(cast.find((c) => c.key === 'bear')?.look)],
			['bear', true],
		);
		same(
			'9. the block a class plays is Flipbook’s answer for it; a class that plays a sheet has none',
			[
				text(pg.classBlock(cast, 'salmon')) === text(cast.find((c) => c.key === 'salmon')?.look),
				pg.classBlock(cast, 'nobody'),
			],
			[true, undefined],
		);
		const before = text(doc);
		const made = sheet.makeClassSheet(doc, 'salmon', pg.classBlock(cast, 'salmon')!);
		same(
			'9. making the salmon a sheet adds its character, and no class is left without one',
			[made.refused, made.created, pg.classesWithoutCharacter(doc), before === text(doc)],
			[null, true, [], false],
		);
		sheet.makeClassSheet(doc, 'bear', from!.look);
		const after = castOf(doc);
		same(
			'9. a character with a sheet is offered no Make, and its class plays no block',
			[pg.sheetSourceFor(after, doc, 'bearBot'), pg.classBlock(after, 'bear')],
			[undefined, undefined],
		);
		same(
			'9. Flipbook lists each under its class, before and after the sheet',
			[
				pg.flipbookKeyFor(cast, salmons(), 'bearBot'),
				pg.flipbookKeyFor(after, doc, 'bearBot'),
				pg.flipbookKeyFor(after, doc, made.characterId!),
				pg.flipbookKeyFor(after, doc, 'nobody'),
			],
			['bear', 'bear', 'salmon', undefined],
		);
		// A class that already names another character's sheet is not made from.
		const other = salmons();
		sheet.findClass(other, 'bear')!.sheet = 'fishermanBot';
		same(
			'9. a class that names another sheet is not what Make reads',
			pg.sheetSourceFor(castOf(other), other, 'bearBot'),
			undefined,
		);
		// A character no class is drawn as, whose component carries a block.
		const lone = salmons();
		lone.arcade!.online!.characters = lone.arcade!.online!.characters.filter(
			(c) => c.id !== 'bear',
		);
		const loneFrom = pg.sheetSourceFor(castOf(lone), lone, 'bearBot');
		same(
			'9. with no class drawn as it, a sheet is made from its component’s own block',
			[loneFrom?.classId, loneFrom?.look.prefixes.base],
			[undefined, 'bear'],
		);
		sheet.makeCharacterSheet(lone, 'bearBot', loneFrom!.look);
		same(
			'9. … once, and Flipbook then lists it under its own id',
			[
				pg.sheetSourceFor(castOf(lone), lone, 'bearBot'),
				castOf(lone).find((c) => c.sheetId === 'bearBot')?.inConfig,
				pg.flipbookKeyFor(castOf(lone), lone, 'bearBot'),
				pg.flipbookKeyFor(
					castOf(lone).filter((c) => c.sheetId === 'bearBot'),
					lone,
					'bearBot',
				),
			],
			[undefined, false, castOf(lone).find((c) => c.sheetId === 'bearBot')?.key, 'bearBot'],
		);
	}

	// Compare, as the page wires it: before = the stored config, after = the live one.
	{
		const stored = salmons();
		const live = salmons();
		const compare = () => pg.compareClass(stored, live, components, 'bear', bearClips);
		same(
			'9. a character with no sheet is compared through the class drawn as it',
			pg.comparedClasses(stored, live, 'bearBot'),
			['bear'],
		);
		same(
			'9. compare with nothing edited: the same block, safe',
			[compare().before.kind, compare().after.kind, compare().safe],
			['block', 'block', true],
		);
		sheet.makeClassSheet(live, 'bear', pg.classBlock(castOf(live), 'bear')!);
		same(
			'9. compare after Make: the stored block against the live sheet, and nothing differs',
			[
				compare().before.kind,
				compare().after.kind,
				compare().cells,
				compare().sheets,
				compare().safe,
			],
			['block', 'sheet', [], [], true],
		);
		same('9. the classes compared for the bear', pg.comparedClasses(stored, live, 'bearBot'), [
			'bear',
		]);
		act.addAction(live, 'bearBot', 'roar');
		same(
			'9. a cell’s value is read and written in one place',
			[
				pg.cellValueOf(sheet.sheetOf(live, 'bearBot'), 'walk', 'e'),
				pg.setCellValue(live, 'bearBot', 'walk', 'e', { kind: 'clip', clip: 'bear_idle_e' }),
				pg.cellValueOf(sheet.sheetOf(live, 'bearBot'), 'walk', 'e'),
				edit.findCharacter(live, 'bearBot')?.actions?.find((a) => a.id === 'walk')?.anim,
			],
			[undefined, null, { kind: 'clip', clip: 'bear_idle_e' }, { e: { clip: 'bear_idle_e' } }],
		);
		const changed = compare();
		same(
			'9. compare after edits lists the new action and the cell that draws another clip',
			[
				changed.safe,
				changed.cells.map(pg.cellDifferenceText),
				changed.sheets.map(pg.sheetDifferenceText),
			],
			[
				false,
				[
					'The action "roar" is only in this sheet.',
					'walk, facing e: bear_walk_e → bear_idle_e.',
					'walk, facing w: bear_walk_e, mirrored → bear_idle_e, mirrored.',
				],
				[
					'action roar: only in this sheet.',
					'action walk, anim: — → {"e":{"clip":"bear_idle_e"}}.',
				],
			],
		);
		same(
			'9. a cell left to the name rule stores nothing',
			[
				pg.setCellValue(live, 'bearBot', 'walk', 'e', undefined),
				pg.cellValueOf(sheet.sheetOf(live, 'bearBot'), 'walk', 'e'),
				'anim' in
					(edit.findCharacter(live, 'bearBot')?.actions?.find((a) => a.id === 'walk') ?? {}),
			],
			[null, undefined, false],
		);
		// A save: the stored config becomes the live one, and nothing differs again.
		const saved = copy(live);
		const again = pg.compareClass(saved, live, components, 'bear', bearClips);
		same(
			'9. after a save the stored config is the live one: safe again, sheet against sheet',
			[again.before.kind, again.after.kind, again.safe],
			['sheet', 'sheet', true],
		);
		sheet.unlinkClassSheet(live, 'bear');
		const unlinked = pg.compareClass(saved, live, components, 'bear', bearClips);
		same(
			'9. unlinking is compared too: the saved sheet against the block, which lacks its roar',
			[
				unlinked.before.kind,
				unlinked.after.kind,
				unlinked.safe,
				pg.comparedClasses(saved, live, 'bearBot'),
				unlinked.cells.map(pg.cellDifferenceText),
			],
			['sheet', 'block', false, ['bear'], ['The action "roar" is only in the saved config.']],
		);
		// Only what the sheet says differs: no cell draws another clip, and the move is still not safe.
		const wider = copy(saved);
		sheet.setDrawWidth(wider, 'bearBot', '120');
		const widened = pg.compareClass(saved, wider, components, 'bear', bearClips);
		same(
			'9. a wider draw box draws the same clips and is still a difference',
			[widened.cells, widened.sheets.map(pg.sheetDifferenceText), widened.safe],
			[[], ['draw, width: 92 → 120.'], false],
		);
		// The look changed: the class lost its link and is no longer drawn as the character, but the
		// saved config still draws it from this sheet, so it is compared.
		const relooked = copy(saved);
		edit.setLook(relooked, 'bearBot', 'salmonsOtter');
		same(
			'9. a class that named the sheet in the saved config is still compared',
			pg.comparedClasses(saved, relooked, 'bearBot'),
			['bear'],
		);
		same(
			'9. a drawing in words',
			[
				pg.drawingText(unlinked.before),
				pg.drawingText(unlinked.after),
				pg.drawingText({ kind: 'none' }),
			],
			['the sheet of "bearBot"', 'a clip block', 'no clips'],
		);
	}

	// What an edit of the character did to the classes.
	{
		const doc = salmons();
		sheet.makeClassSheet(doc, 'bear', pg.classBlock(castOf(doc), 'bear')!);
		same(
			'9. the removal’s confirmation names the classes that lose their link',
			[pg.removalNote(doc, 'bearBot'), pg.removalNote(doc, 'fishermanBot')],
			[
				' Its character sheet goes with it, and the class "bear" loses its link to it: it is drawn as before the sheet.',
				'',
			],
		);
		sheet.unlinkClassSheet(doc, 'bear');
		same(
			'9. … and a sheet no class names goes alone',
			pg.removalNote(doc, 'bearBot'),
			' Its character sheet goes with it.',
		);
		sheet.linkClassSheet(doc, 'bear', 'bearBot');
		sheet.findClass(doc, 'fisherman')!.sheet = 'grizzly';
		const renamed = sheet.renameSheetCharacter(doc, 'bearBot', 'grizzly');
		same(
			'9. a rename says which classes followed, and that a class of another body that named the new id is not drawn from it',
			[renamed.refused, pg.renamedNote('grizzly', renamed)],
			[
				null,
				'The class "bear" names "grizzly" as its sheet now. The class "fisherman" already named "grizzly", but is another body than this character\'s component, so it is not drawn from this sheet: a class and its sheet use the same component.',
			],
		);
		same(
			'9. a rename that touched no class says nothing',
			pg.renamedNote('x', { followed: [], adopted: [] }),
			'',
		);
		const unlinked = edit.setLook(doc, 'grizzly', 'salmonsSalmon');
		same(
			'9. a look change says which classes lost their link',
			[unlinked, pg.lookChangedNote(unlinked), pg.lookChangedNote([])],
			[
				['bear', 'fisherman'],
				'The classes "bear", "fisherman" are another body, so they no longer name this sheet: a class and its sheet use the same component.',
				'',
			],
		);
	}

	// The Whole view on Salmons given a sheet.
	{
		const doc = salmons();
		sheet.makeClassSheet(doc, 'bear', pg.classBlock(castOf(doc), 'bear')!);
		const bear = () => wholeCharacters({ components, config: doc })[0];
		same(
			'9. whole: still three rows, and the bear’s clips are its sheet',
			[
				wholeCharacters({ components, config: doc }).map((c) => c.key),
				bear().clips?.source,
				bear().clips?.sheetId,
				bear().idleSheet,
			],
			[
				['look:salmonsBear', 'look:salmonsFisherman', 'look:salmonsSalmon'],
				'sheet',
				'bearBot',
				undefined,
			],
		);
		const view = impliedView(bear(), doc, []);
		same(
			'9. whole: the view is the sheet’s, whatever the screens are',
			[
				view.kind,
				view.drawn,
				view.mirrored,
				view.from,
				impliedView(bear(), doc, ['isometric']).kind,
			],
			[
				'isometric',
				['n', 'ne', 'e', 'se', 's'],
				['sw', 'w', 'nw'],
				['its character sheet (arcade.characters "bearBot"): the view it names'],
				'isometric',
			],
		);
		sheet.setViewKind(doc, 'bearBot', 'side');
		const side = impliedView(bear(), doc, ['isometric']);
		same(
			'9. whole: a side view is read off the sheet',
			[side.kind, side.drawn, side.mirrored],
			['side', ['e'], ['w']],
		);
		sheet.clearView(doc, 'bearBot');
		same(
			'9. whole: a sheet with no view is the four diagonals, and says so',
			[impliedView(bear(), doc, []).kind, impliedView(bear(), doc, []).from[0]],
			[
				'isometric',
				'its character sheet (arcade.characters "bearBot") names no view: the four diagonals, as before the sheet',
			],
		);
		sheet.setViewKind(doc, 'bearBot', 'isometric');
		sheet.setViewFacings(doc, 'bearBot', 8);
		same('9. whole: the source is the sheet', impliedSource(bear(), doc), {
			kind: 'clips',
			why: 'frame clips, from its character sheet',
		});
		const gapsWith = (ids: string[]) => characterGaps(bear(), doc, ids);
		same('9. whole: every drawn clip made, nothing missing', gapsWith(bearClips), []);
		act.addAction(doc, 'bearBot', 'roar');
		same('9. whole: the gaps count the sheet’s actions, not a block’s slots', gapsWith(bearClips), [
			'5 of its 20 drawn clips are not made.',
			'8 cells have nothing to play.',
		]);
		// Unlinked: the class plays its block again and the sheet is idle on the same row.
		sheet.unlinkClassSheet(doc, 'bear');
		same(
			'9. whole: a sheet its class does not name stays on the character’s row, beside the block',
			[
				wholeCharacters({ components, config: doc }).length,
				bear().clips?.source,
				bear().idleSheet?.sheetId,
				impliedSource(bear(), doc).why,
				characterGaps(bear(), doc, bearClips),
			],
			[3, 'component', 'bearBot', "frame clips, from its component's clip block", []],
		);
		// A sheet whose class does not play it: the reason is a gap.
		sheet.linkClassSheet(doc, 'bear', 'bearBot');
		sheet.clearDraw(doc, 'bearBot');
		same(
			'9. whole: a sheet that is not played is a gap, in Flipbook’s words',
			characterGaps(bear(), doc, bearClips),
			[
				'The class "bear" names the sheet of "bearBot", which is not played: its draw box has no width.',
			],
		);
		// A sheet on a character no class is drawn as joins that character's row, by id.
		const lone = salmons();
		lone.arcade!.characters!.push({ id: 'otter', component: 'salmonsOtter' });
		sheet.makeCharacterSheet(lone, 'otter', pg.classBlock(castOf(lone), 'bear')!);
		const otter = wholeCharacters({ components, config: lone }).find(
			(c) => c.character?.id === 'otter',
		)!;
		same(
			'9. whole: a sheet no class plays joins the row of its character, by id',
			[
				wholeCharacters({ components, config: lone }).length,
				otter.clips?.sheetId,
				otter.clips?.inConfig,
				otter.joinedBy.clips,
				impliedSource(otter, lone).why,
				impliedView(otter, lone, []).from[1],
			],
			[
				4,
				'otter',
				false,
				'id',
				'frame clips, from a character sheet no online class plays yet',
				'no online class plays the sheet yet',
			],
		);
	}

	// One validation: the page's issues, Game Config's and the save's are one list.
	{
		const storage = await import('../src/lib/server/gameConfigStorage.ts');
		const saveSays = (doc: GameConfigDoc): GameConfigIssue[] => {
			try {
				return storage.prepareGameConfigDoc(bodyFor(doc)).warnings;
			} catch (e) {
				if (e instanceof storage.InvalidGameConfigError) return e.issues;
				throw e;
			}
		};
		const errorsElse = (issues: GameConfigIssue[]) => {
			const errors = issues.filter((i) => i.severity === 'error');
			return errors.length ? errors : issues;
		};
		const made = salmons();
		sheet.makeClassSheet(made, 'bear', pg.classBlock(castOf(made), 'bear')!);
		const warned = copy(made);
		act.addAction(warned, 'bearBot', 'idle2');
		act.addTrigger(warned, 'bearBot', 'idle2', { motion: 'still' });
		const broken = copy(made);
		sheet.findClass(broken, 'fisherman')!.sheet = 'ghost';
		const side = copy(made);
		sheet.setViewKind(side, 'bearBot', 'topDown');
		for (const [name, doc] of [
			['Salmons', salmons()],
			['a sheet', made],
			['a sheet with a warning', warned],
			['a dangling link', broken],
		] as const) {
			same(
				`9. ${name}: the core's issues are the save's`,
				errorsElse(core.savedIssues(doc)),
				saveSays(doc),
			);
			check(
				`9. ${name}: Characters and Game Config list the core's issues`,
				text(chk.pageIssues(doc).issues) === text(core.savedIssues(doc)) &&
					text(configPage.pageIssues(doc, 'arcade')) === text(core.savedIssues(doc)),
			);
		}
		const screen = chk.pageIssues(side, 'isometric').screen;
		same(
			'9. with the screens’ projection both pages warn of the same view, the save of none',
			[
				screen.map((i) => i.path),
				text(configPage.pageIssues(side, 'arcade', { projection: 'isometric' })) ===
					text(core.savedIssues(side, 'isometric')),
				core.savedIssues(side, 'isometric').length - core.savedIssues(side).length,
				saveSays(side).some((i) => screen.some((s) => s.message === i.message)),
			],
			[['arcade.characters[0].view'], true, 1, false],
		);
		same(
			'9. one projection: isometric when a screen is',
			[
				core.projectionOf(['isometric']),
				core.projectionOf([undefined, 'isometric']),
				core.projectionOf([]),
				configPage.screensProjection([{}, { projection: 'isometric' }]),
				chk.sheetProjection(['isometric']),
				chk.sheetProjection(undefined),
			],
			['isometric', 'isometric', 'flat', 'isometric', 'isometric', undefined],
		);
		// Why a sheet is not played: one answer, each tool's order and words.
		const noSource3d: CharacterSheet = { view: { kind: '3d' }, draw: { width: 40 } };
		same(
			'9. why a sheet is not played: every reason, once',
			[
				core.sheetUnplayed(undefined),
				core.sheetUnplayed(noSource3d),
				core.sheetUnplayed(sheet.sheetOf(made, 'bearBot')),
				core.firstUnplayed(core.sheetUnplayed(noSource3d), ['facings', 'source']),
				core.firstUnplayed(core.sheetUnplayed(noSource3d), ['source', 'facings']),
				core.firstUnplayed([], ['source']),
			],
			[['empty'], ['source', 'facings', 'actions'], [], 'facings', 'source', undefined],
		);
		const threeD = salmons();
		Object.assign(edit.findCharacter(threeD, 'bearBot')!, noSource3d);
		sheet.findClass(threeD, 'bear')!.sheet = 'bearBot';
		same(
			'9. Flipbook names the missing source first, Characters the view',
			[
				sheetProblemOf(noSource3d),
				chk.classSheetStatus(threeD, 'bear').why,
				castOf(threeD).find((c) => c.key === 'bear')?.sheetProblem,
			],
			[
				'it has no animation source',
				'A 3D view has no facings, so no clip is drawn.',
				'The class "bear" names the sheet of "bearBot", which is not played: it has no animation source.',
			],
		);
		same(
			'9. why a class does not play the sheet it names',
			[
				core.classSheetRefusal({ body: 'a' }, undefined, undefined),
				core.classSheetRefusal({ body: 'a' }, { component: 'b' }, undefined),
				core.classSheetRefusal({ body: 'a' }, { component: 'a' }, undefined),
				core.classSheetRefusal({ body: 'a' }, { component: 'a' }, sheet.sheetOf(made, 'bearBot')),
			],
			[
				{ kind: 'noCharacter' },
				{ kind: 'component', component: 'b' },
				{ kind: 'sheet', why: ['empty'] },
				undefined,
			],
		);
		const source = (name: string): string =>
			readFileSync(
				fileURLToPath(new URL(`../src/routes/(app)/characters/${name}`, import.meta.url)),
				'utf8',
			);
		same(
			'9. the load and the page both list `pageIssues` with the screens’ projection, and neither validates on its own',
			['+page.server.ts', '+page.svelte'].map((name) => [
				/pageIssues\([^;]*projection/.test(source(name)),
				/validate(GameConfigDoc|CharacterSheets)\(/.test(source(name)),
			]),
			[
				[true, false],
				[true, false],
			],
		);
		const lib = (name: string): string =>
			readFileSync(fileURLToPath(new URL(`../src/${name}`, import.meta.url)), 'utf8');
		check(
			'9. only the core validates a config or asks whether a sheet plays, for all three tools',
			['lib/characters/characterSheetCheck.ts', 'routes/(app)/config/pageDoc.ts'].every(
				(name) => !/validate(GameConfigDoc|CharacterSheets)\(|sheetAwareIssues\(/.test(lib(name)),
			) &&
				/classSheetRefusal\(/.test(lib('lib/characters/characterSheetCheck.ts')) &&
				/classSheetRefusal\(/.test(lib('lib/flipbook/projectCharacters.ts')) &&
				/sheetUnplayed\(/.test(lib('lib/flipbook/projectCharacters.ts')),
		);
		check(
			'9. source text: the one request that writes is `pageSave.ts`’s PUT through `bodyFor`; no card writes or fetches',
			(source('pageSave.ts').match(/method: '(PUT|POST|PATCH|DELETE)'/g) ?? []).join() ===
				"method: 'PUT'" &&
				/doc: bodyFor\(options\.doc\(\)\)/.test(source('pageSave.ts')) &&
				!/method:\s*'(PUT|POST|PATCH|DELETE)'/.test(source('+page.svelte')) &&
				readdirSync(
					fileURLToPath(new URL('../src/routes/(app)/characters/sheet/', import.meta.url)),
				)
					.concat(['../wholeRead.svelte.ts'])
					.every((name) => {
						const code = source(`sheet/${name}`);
						return (
							!/method:\s*'(PUT|POST|PATCH|DELETE)'/.test(code) &&
							(!/fetch\(/.test(code) || name.includes('wholeRead'))
						);
					}),
		);
		for (const file of ['characterSheetPage.ts', 'sheetCore.ts']) {
			const code = lib(`lib/characters/${file}`);
			check(
				`9. ${file} is pure: no Svelte, no server module, no structuredClone`,
				!/from '(svelte|\$app|\$lib\/server|\$env)/.test(code) &&
					!code.includes('structuredClone('),
			);
		}
	}

	// The page, rendered on the server.
	{
		const { createServer } = await import('vite');
		const root = fileURLToPath(new URL('..', import.meta.url));
		const server = await createServer({
			configFile: `${root}vite.config.js`,
			server: { middlewareMode: true, hmr: false },
			appType: 'custom',
			logLevel: 'error',
			ssr: {
				noExternal: [
					/^(game-config|engine-|constants-|rgs-|utils-|components-|pixi-svelte|state-shared|config-)/,
				],
			},
		});
		try {
			const { render } = (await server.ssrLoadModule(
				'svelte/server',
			)) as typeof import('svelte/server');
			const page = (await server.ssrLoadModule('/src/routes/(app)/characters/+page.svelte')) as {
				default: never;
			};
			const renderPage = (doc: GameConfigDoc, query = ''): string => {
				const data = {
					clientKey: 'c',
					projectKey: 'p',
					projectName: 'P',
					gameType: 'arcade',
					tools: [],
					doc,
					source: 'authored',
					etag: 'e',
					templateDefault: doc,
					components: components.map((c) => ({ id: c.id, name: c.name, inputs: [] })),
					projection: 'isometric',
					issues: [],
				};
				// `$app/state`'s `page` is read off the request's context.
				const context = new Map<string, unknown>([
					['__request__', { page: { url: new URL(`http://launcher.test/characters${query}`) } }],
				]);
				return render(page.default, { props: { data }, context } as never).body;
			};
			const cards = (body: string): string[] =>
				[...body.matchAll(/data-sheet-card="([a-z]+)"/g)].map((m) => m[1]);
			const plain = salmons();
			const plainBefore = text(plain);
			const plainBody = renderPage(plain);
			same(
				'9. no sheet: the page shows only the Character sheet card, with Make this a sheet',
				[
					cards(plainBody),
					plainBody.includes('data-make-sheet'),
					plainBody.includes('data-start-sheet'),
					plainBody.includes('data-orphan-class="salmon"'),
					/data-sheet-state="none"/.test(plainBody),
				],
				[['sheet'], true, true, true, true],
			);
			check(
				'9. no sheet: rendering writes nothing into the doc',
				text(plain) === plainBefore &&
					!/"(view|source|draw|actions|sheet)":/.test(text(plain.arcade?.characters)),
			);
			for (const heading of [
				'Character',
				'Body',
				'Movement',
				'Controller',
				'Brain',
				'Abilities',
				'Zone forces',
				'Anim inputs',
				'Sandbox',
			])
				check(
					`9. no sheet: today’s "${heading}" section is still there`,
					plainBody.includes(`>${heading}</h2>`),
				);
			const linked = renderPage(plain, '?character=fishermanBot&card=draw');
			same(
				'9. no sheet: a link to a card opens the empty cards of that character, and writes nothing',
				[
					/data-sheet-cards="fishermanBot"/.test(linked),
					cards(linked),
					text(plain) === plainBefore,
					/data-sheet-cards="bearBot"/.test(renderPage(plain, '?character=nobody&card=draw')),
					cards(renderPage(plain, '?character=nobody&card=draw')),
				],
				[true, ['sheet', 'view', 'source', 'draw', 'actions', 'online'], true, true, ['sheet']],
			);
			const sheeted = salmons();
			sheet.makeClassSheet(sheeted, 'bear', pg.classBlock(castOf(sheeted), 'bear')!);
			const sheetedBefore = text(sheeted);
			const sheetedBody = renderPage(sheeted);
			same(
				'9. a sheet: its five cards render after the Character sheet card, each under its title',
				[
					cards(sheetedBody),
					pg.SHEET_CARDS.every((card) =>
						sheetedBody.includes(`>${pg.SHEET_CARD_TITLES[card]}</button>`),
					),
					/data-sheet-state="sheet"/.test(sheetedBody),
					/data-class="bear"/.test(sheetedBody) && /data-sheet-status="inForce"/.test(sheetedBody),
					['idle', 'walk', 'swipe'].every((id) => sheetedBody.includes(`data-action="${id}"`)),
					text(sheeted) === sheetedBefore,
				],
				[['sheet', 'view', 'source', 'draw', 'actions', 'online'], true, true, true, true, true],
			);
			const touched = structuredClone(sheeted);
			touched.arcade!.online!.pointer = { taps: { bear: 'ability1' } };
			const noSchemeBody = renderPage(touched);
			touched.arcade!.online!.touch = {
				schemes: { Paw: { ability: 'target' }, Swim: { gestures: 'both' } },
				characters: { bear: 'Paw' },
			};
			const touchedBefore = text(touched);
			const touchBody = renderPage(touched);
			const touchSelect = (body: string): string =>
				/<select[^>]*data-class-touch="bear"[^>]*>[\s\S]*?<\/select>/.exec(body)?.[0] ?? '';
			same(
				'9. the Online class card: the class’s touch scheme among the project’s, the scheme in one line, and a link to Game Config’s card',
				[
					[...touchSelect(touchBody).matchAll(/<option value="([^"]*)"([^>]*)>/g)].map(
						(m) => `${m[1]}${m[2].includes('selected') ? '*' : ''}`,
					),
					/^<select[^>]*disabled/.test(touchSelect(touchBody)),
					new RegExp(
						`data-touch-summary="bear"[^>]*>[\\s\\S]*?<code>Paw</code>: Hold to steer · towards the finger · lifting stops · the ability by a tap on a target \\(within ${ARCADE_TOUCH_DEFAULTS.targetRadius} px\\), aimed where tapped · dead zone 24 px · a tap within 12 px and ${ARCADE_TOUCH_DEFAULTS.tapMs} ms\\.`,
					).test(touchBody),
					/<a[^>]*data-touch-link[^>]*href="[^"]*\/config\?project=p#touch-schemes"/.test(
						touchBody,
					),
					text(touched) === touchedBefore,
				],
				[['', 'Paw*', 'Swim'], false, true, true, true],
			);
			same(
				'9. … with no scheme in the project: the select is disabled and the card says where to make one',
				[
					/^<select[^>]*disabled/.test(touchSelect(noSchemeBody)),
					noSchemeBody.includes('This game has no touch scheme yet.'),
					/data-touch-link[^>]*>Make one in Game Config, Mouse and touch/.test(noSchemeBody),
				],
				[true, true, true],
			);
			const onlineCardCode = readFileSync(
				fileURLToPath(
					new URL('../src/routes/(app)/characters/sheet/OnlineCard.svelte', import.meta.url),
				),
				'utf8',
			);
			check(
				'9. source text: the card gives a class its scheme with Game Config’s select and setter, and edits no scheme',
				/<TouchSchemeSelect[\s\S]*?onpick=\{\(name\) => run\(\(d\) => void setClassTouchScheme\(d, classId, name\)\)\}/.test(
					onlineCardCode,
				) &&
					!/setTouchSchemeField|addTouchScheme|renameTouchScheme|removeTouchScheme|duplicateTouchScheme/.test(
						onlineCardCode,
					),
			);
			check(
				'9. a sheet: each action’s play choice offers Hold, told in the Plays column’s tip',
				(sheetedBody.match(/<option value="hold"[^>]*>Hold<\/option>/g) ?? []).length === 3 &&
					/Hold plays it once and then stays on its last frame/.test(sheetedBody),
			);
			check(
				'9. a sheet: the grid and the preview are Flipbook’s components, fed the sheet',
				sheetedBody.includes('data-row="idle"') && sheetedBody.includes('data-cell="bear_idle_e"'),
			);
			const cardCode = (name: string): string =>
				readFileSync(
					fileURLToPath(new URL(`../src/routes/(app)/characters/sheet/${name}`, import.meta.url)),
					'utf8',
				);
			check(
				'9. the cards resolve no cell and read no `anim` themselves: the grid and one helper do',
				readdirSync(
					fileURLToPath(new URL('../src/routes/(app)/characters/sheet/', import.meta.url)),
				).every(
					(name) => !/resolve(Sheet|Character)Clip|\.anim\b|setActionAnim/.test(cardCode(name)),
				) &&
					/<CharacterClipsGrid\s+\{sheet\}/.test(cardCode('ActionsCard.svelte')) &&
					/<CharacterDirections \{sheet\}/.test(cardCode('ActionsCard.svelte')),
			);
			check(
				'9. every card is a SectionCard with its description in the tooltip',
				[
					'SheetHome',
					'ViewCard',
					'SourceCard',
					'DrawCard',
					'ActionsCard',
					'OnlineCard',
					'ClassSheet',
				].every((name) =>
					/<SectionCard\b[^>]*>\s*\{#snippet info\(\)\}/.test(cardCode(`${name}.svelte`)),
				),
			);

			// A rig, still images, and cells that are not clips: each card opens on the three-way
			// choice and edits its kind (C6b).
			const c6 = c6Doc();
			const c6Before = text(c6);
			const cardOf = (body: string, card: string): string =>
				body.slice(
					body.indexOf(`data-sheet-card="${card}"`),
					body.indexOf('data-sheet-card="', body.indexOf(`data-sheet-card="${card}"`) + 1),
				);
			// The smooth turn on the View card (§17 holds the edits and the preview's driver).
			{
				const turning = salmons();
				sheet.makeClassSheet(turning, 'bear', pg.classBlock(castOf(turning), 'bear')!);
				sheet.setViewKind(turning, 'bearBot', 'topDown');
				sheet.setViewFacings(turning, 'bearBot', 4);
				/** What the View card shows of the turn: the checkbox (and whether it is ticked), the
				 *  lean's value and placeholder, the speed's, the note, and the preview's mode. */
				const turnOf = (doc: GameConfigDoc): unknown => {
					const card = cardOf(renderPage(doc), 'view');
					const input = (mark: string): string =>
						new RegExp(`<input[^>]*\\b${mark}(?![-\\w])[^>]*>`).exec(card)?.[0] ?? '';
					const attr = (tag: string, name: string): string | undefined =>
						new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
					return [
						input('data-view-turn') ? /\bchecked\b/.test(input('data-view-turn')) : undefined,
						['data-view-turn-lean', 'data-view-turn-speed'].map((mark) =>
							input(mark) ? [attr(input(mark), 'value'), attr(input(mark), 'placeholder')] : null,
						),
						/data-view-turn-note[^>]*>([^<]*)</.exec(card)?.[1],
						/data-turn-preview="(\w+)"/.exec(card)?.[1],
					];
				};
				const off = turnOf(turning);
				sheet.setViewTurn(turning, 'bearBot', true);
				const on = turnOf(turning);
				sheet.setViewTurnLean(turning, 'bearBot', '10');
				sheet.setViewTurnSpeed(turning, 'bearBot', '720');
				sheet.setViewFacings(turning, 'bearBot', 8);
				const tuned = turnOf(turning);
				sheet.setViewKind(turning, 'bearBot', 'side');
				const side = turnOf(turning);
				sheet.clearView(turning, 'bearBot');
				same(
					'9. the View card: Smooth turn off shows the checkbox and the character snapping; on, the lean and the speed with their defaults as placeholders and the character turning; a side view and no view say why in one line, with no control and no preview',
					[off, on, tuned, side, turnOf(turning)],
					[
						[false, [null, null], undefined, 'snap'],
						[
							true,
							[
								['', '45'],
								['', '360'],
							],
							undefined,
							'smooth',
						],
						[
							true,
							[
								['10', '22.5'],
								['720', '360'],
							],
							undefined,
							'smooth',
						],
						[
							undefined,
							[null, null],
							'A side view has two facings: there is nothing to turn through.',
							undefined,
						],
						[undefined, [null, null], 'Choose Top-down or Isometric to turn smoothly.', undefined],
					],
				);
			}
			/** The kinds the choice offers, and the one shown as chosen and as stored. */
			const choiceOf = (body: string): unknown => {
				const card = cardOf(body, 'source');
				const tiles = [...card.matchAll(/<button[^>]*data-source-kind="(\w+)"[^>]*>/g)];
				return [
					/data-source-choice/.test(card),
					tiles.map((m) => m[1]),
					tiles.filter((m) => /aria-checked="true"/.test(m[0])).map((m) => m[1]),
					tiles.filter((m) => /data-stored="true"/.test(m[0])).map((m) => m[1]),
				];
			};
			const ALL_KINDS = ['clips', 'rig', 'stills'];
			const otterBody = renderPage(c6, '?character=otter');
			same(
				'9. a rig source: the card opens on the three-way choice with Rig chosen, and edits the rig, the rigs per facing and the skins',
				[
					cards(otterBody),
					choiceOf(otterBody),
					['otterRig', 'otterBack', 'gold'].every((word) =>
						cardOf(otterBody, 'source').includes(word),
					),
					[
						/data-source-rig/,
						/data-rig-select/,
						/data-rig-facings/,
						/data-rig-facing="ne"/,
						/data-variants/,
						/aria-label="Skin of the variant &quot;marked&quot;"/,
						/data-new-variant-skin/,
						/Take the source away/,
					].map((re) => re.test(cardOf(otterBody, 'source'))),
					/data-source-prefix|data-new-variant-prefix|data-flipbook-link|data-source-readonly/.test(
						cardOf(otterBody, 'source'),
					),
				],
				[
					['sheet', 'view', 'source', 'draw', 'actions', 'online'],
					[true, ALL_KINDS, ['rig'], ['rig']],
					true,
					[true, true, true, true, true, true, true, true],
					false,
				],
			);
			same(
				'9. a rig source: each rig the sheet names is listed with its Rigger link, and reads as "reading…" until its facts are in',
				[
					[
						...cardOf(otterBody, 'source').matchAll(
							/data-rig-facts="(\w+)" data-rig-state="(\w+)"/g,
						),
					]
						.map((m) => `${m[1]}:${m[2]}`)
						.sort(),
					cardOf(otterBody, 'source').includes('/rigger?project=p&amp;rig=otterRig'),
					/data-rig-cost/.test(cardOf(otterBody, 'source')),
				],
				[['otterBack:reading', 'otterRig:reading', 'otterTail:reading'], true, false],
			);
			same(
				'9. a rig source: the Actions card shows the rig grid in the clips grid’s table, says the rig is being read, and has no clip input',
				[
					/data-grid-counts="rig"[^>]*>\s*Reading the rig…/.test(cardOf(otterBody, 'actions')),
					['idle|ne', 'idle|se', 'wag|se', 'wag|nw'].every((cell) =>
						cardOf(otterBody, 'actions').includes(`data-cell="${cell}"`),
					),
					cardOf(otterBody, 'actions').includes('data-row="wag"') &&
						cardOf(otterBody, 'actions').includes('You draw'),
					/data-cell-clip|data-fill\b|data-grid-readonly|data-stored-cell/.test(
						cardOf(otterBody, 'actions'),
					),
					['idle', 'wag'].every((a) => cardOf(otterBody, 'actions').includes(`data-action="${a}"`)),
				],
				[true, true, true, false, true],
			);
			same(
				'9. a rig source: the Draw card has a bone picker per point, the stored bone picked, and its bin',
				[
					/data-bones/.test(cardOf(otterBody, 'draw')),
					/data-bone-point="hand"/.test(cardOf(otterBody, 'draw')),
					/<option value="hand_r" selected[^>]*>hand_r \(not read in the rig\)/.test(
						cardOf(otterBody, 'draw'),
					),
					/Take the draw box away/.test(cardOf(otterBody, 'draw')),
					/data-bones|data-draw-bones/.test(cardOf(renderPage(c6, '?character=fox'), 'draw')),
					/Take the draw box away/.test(cardOf(renderPage(c6, '?character=fox'), 'draw')),
				],
				[true, true, true, true, false, true],
			);
			const crateBody = renderPage(c6, '?character=crate');
			same(
				'9. still images: the card opens on the choice with Still images chosen, offers a sheet’s images and one image, and the Actions card has Fill from names',
				[
					choiceOf(crateBody),
					[/data-source-stills/, /data-stills-sheet/, /data-one-still/, /Take the source away/].map(
						(re) => re.test(cardOf(crateBody, 'source')),
					),
					/data-source-prefix|data-add-variant|data-source-rig/.test(cardOf(crateBody, 'source')),
					/data-cell-holds="still"[^>]*>still · crate</.test(cardOf(crateBody, 'actions')),
					/data-fill-sheet/.test(cardOf(crateBody, 'actions')),
					/clips made/.test(cardOf(crateBody, 'actions')),
				],
				[
					[true, ALL_KINDS, ['stills'], ['stills']],
					[true, true, true, true],
					false,
					true,
					true,
					false,
				],
			);
			const foxBody = renderPage(c6, '?character=fox');
			same(
				'9. clips with a still and a rig cell: Frame clips is chosen, the prefix is edited as ever, and the two cells are shown as what they hold',
				[
					choiceOf(foxBody),
					/data-source-prefix/.test(cardOf(foxBody, 'source')),
					/data-source-rig|data-source-stills/.test(cardOf(foxBody, 'source')),
					/data-cell-holds="still"[^>]*>still · crate</.test(cardOf(foxBody, 'actions')),
					/data-cell-holds="rig"[^>]*>rig · look \(foxRig\)</.test(cardOf(foxBody, 'actions')),
					/>\s*0 of 2 clips made/.test(cardOf(foxBody, 'actions')),
					/data-unread[^>]*>\s*1 cell/.test(cardOf(foxBody, 'source')),
				],
				[[true, ALL_KINDS, ['clips'], ['clips']], true, false, true, true, true, true],
			);
			const emptyBody = renderPage(salmons(), '?character=fishermanBot&card=source');
			same(
				'9. no source: the choice is offered with none chosen, and the Character sheet card offers the same three as ways to start',
				[
					choiceOf(emptyBody),
					/data-source-none/.test(cardOf(emptyBody, 'source')),
					/data-start-source/.test(cardOf(plainBody, 'sheet')) &&
						ALL_KINDS.every((kind) =>
							cardOf(plainBody, 'sheet').includes(`data-source-kind="${kind}"`),
						),
					/data-start-source/.test(cardOf(sheetedBody, 'sheet')),
				],
				[[true, ALL_KINDS, [], []], true, true, false],
			);
			same(
				'9. no card says a source, a cell or a bone is "not edited"; adding asks for a name, and the look is under Advanced',
				[
					[otterBody, crateBody, foxBody, plainBody].map((body) => /not edited/i.test(body)),
					/data-new-character-name/.test(plainBody) && /data-add-character/.test(plainBody),
					/<details[^>]*data-advanced="add"[^>]*>(?:(?!<\/details>)[\s\S])*data-add-with-look/.test(
						plainBody,
					),
					/<details[^>]*data-advanced="look"[^>]*>(?:(?!<\/details>)[\s\S])*Look \(component\)/.test(
						plainBody,
					),
					/Look \(component\)/.test(plainBody.replace(/<details[\s\S]*?<\/details>/g, '')),
				],
				[[false, false, false, false], true, true, true, false],
			);
			check('9. rendering those writes nothing into the doc', text(c6) === c6Before);
			const editor = (await server.ssrLoadModule(
				'/src/routes/(app)/characters/sheet/CellEditor.svelte',
			)) as { default: never };
			const foxSheet = sheet.sheetOf(c6, 'fox');
			const editorOf = (actionId: string, facing: 'ne' | 'se' | 'sw', of = foxSheet): string =>
				render(editor.default, {
					props: {
						cell: characterGrid(of!, [])
							.rows.find((row) => row.state === actionId)!
							.cells.find((cell) => cell.facing === facing)!,
						value: pg.cellValueOf(of, actionId, facing),
						kinds: core.cellKindsRead(of?.source),
						clipIds: [],
						sheets: [],
						loaded: () => false,
						readOnly: false,
						locked: pg.cellReadOnly(of, actionId, facing),
						replaces: () => false,
						onSet: () => null,
					},
				} as never).body;
			same(
				'9. the cell editor under frame clips: what the cell holds is named with its kind; a still image or a rig’s animation locks the clip field and not the image picker',
				[
					[editorOf('idle', 'se'), editorOf('idle', 'ne'), editorOf('idle', 'sw')].map((body) => [
						/data-cell-holds="(\w+)"/.exec(body)?.[1],
						/data-cell-clip/.test(body),
						/data-cell-locked/.test(body),
						/data-cell-still/.test(body),
					]),
					editorOf('idle', 'se').includes(`Still image: crate (${C6_STILL.assetKey})`),
					editorOf('idle', 'ne').includes('Rig animation: look (foxRig)'),
				],
				[
					[
						['still', false, true, true],
						['rig', false, true, true],
						['empty', true, false, true],
					],
					true,
					true,
				],
			);
			same(
				'9. the cell editor of a still-images sheet: an image picker and no clip field; the empty-cell button empties',
				[
					/data-cell-holds="empty"/.test(editorOf('idle', 'sw', sheet.sheetOf(c6, 'crate'))),
					/data-cell-clip/.test(editorOf('idle', 'sw', sheet.sheetOf(c6, 'crate'))),
					/data-cell-still/.test(editorOf('idle', 'sw', sheet.sheetOf(c6, 'crate'))),
					/data-cell-by-name[^>]*>Empty the cell</.test(
						editorOf('idle', 'sw', sheet.sheetOf(c6, 'crate')),
					),
				],
				[true, false, true, true],
			);
		} finally {
			await server.close();
		}
	}
}

// ── 10. The page's edits and its save, as wired (C2b review) ──────────────────────────────────
{
	const text = (v: unknown): string => JSON.stringify(v);
	const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
	const src = (rel: string): string => new URL(`../src/${rel}`, import.meta.url).href;
	const code = (rel: string): string =>
		readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8');
	const salmons = (): GameConfigDoc => {
		const raw = salmonsBeforeItsBotSalmon();
		return withCharacterSheets(normalizeGameConfigDoc(raw) as GameConfigDoc, raw);
	};
	const components: WholeComponent[] = SALMONS_CHARACTER_COMPONENTS.map(
		({ id, name, scope, characterClips }) => ({ id, name, scope, characterClips }),
	);
	const bearLook = (doc: GameConfigDoc) => pg.classBlock(pg.castOf(components, doc), 'bear')!;
	const plain = (): GameConfigDoc =>
		withCharacterSheets(
			normalizeGameConfigDoc({
				family: 'arcade',
				outcome: 'rules',
				arcade: {
					field: { w: 2000, h: 1200 },
					bodies: {
						goblin: { shape: 'box', w: 40, h: 40, tags: ['enemy'] },
						hero: { shape: 'circle', r: 20, tags: ['player'] },
					},
					characters: [
						{ id: 'hero', component: 'hero' },
						{ id: 'goblin', component: 'goblin' },
					],
					online: {
						characters: [
							{ id: 'knight', body: 'hero', speed: 200 },
							{ id: 'orc', body: 'goblin', speed: 150 },
						],
					},
				},
			}) as GameConfigDoc,
			{},
		);

	// A re-read asked for during a read is not dropped.
	{
		const gates: (() => void)[] = [];
		let runs = 0;
		const load = singleFlight(async () => {
			runs += 1;
			await new Promise<void>((done) => gates.push(done));
		});
		const land = async (): Promise<void> => {
			gates.shift()?.();
			await new Promise((done) => setTimeout(done, 0));
		};
		const settled: string[] = [];
		void load().then(() => settled.push('first'));
		void load().then(() => settled.push('second'));
		void load().then(() => settled.push('third'));
		same('10. one read at a time: three calls during a read start one', runs, 1);
		await land();
		same(
			'10. a call during a read reruns it ONCE when it lands, and nobody is answered before the rerun',
			[runs, settled],
			[2, []],
		);
		await land();
		same(
			'10. … then every caller is answered, and no third read runs',
			[runs, settled.sort(), gates.length],
			[2, ['first', 'second', 'third'], 0],
		);
		void load();
		same('10. a call after the flight is a new read', runs, 3);
		await land();
		let failing = 0;
		const broken = singleFlight(async () => {
			failing += 1;
			throw new Error('fixture');
		});
		const outcomes = await Promise.allSettled([broken(), broken()]);
		same(
			'10. a read that throws ends the flight for its callers, and the next call reads again',
			[
				outcomes.map((o) => o.status),
				failing,
				await broken().then(
					() => 'read',
					() => 'threw',
				),
				failing,
			],
			[['rejected', 'rejected'], 1, 'threw', 2],
		);
		check(
			'10. the page’s read is that single flight (`wholeRead.svelte.ts`), with no early return',
			/readonly load = singleFlight\(/.test(code('routes/(app)/characters/wholeRead.svelte.ts')) &&
				!/if \(this\.loading\) return/.test(code('routes/(app)/characters/wholeRead.svelte.ts')),
		);
	}

	// Make this a sheet and Compare decide on a fresh read.
	{
		const read = { components: ['old'], error: '', loads: 0, fail: '' };
		const reread = {
			get error() {
				return read.error;
			},
			async load() {
				await Promise.resolve();
				read.loads += 1;
				read.error = read.fail;
				if (!read.fail) read.components = ['new'];
			},
		};
		same(
			'10. after a re-read, the answer is made from what was read, never from before it',
			[await afterReread(reread, () => read.components[0]), read.loads],
			[{ refused: null, value: 'new' }, 1],
		);
		read.fail = 'Could not read the characters (HTTP 502).';
		let asked = false;
		const failed = await afterReread(reread, () => (asked = true));
		same(
			'10. a re-read that failed refuses, and the answer is not made at all',
			[failed.refused?.startsWith(read.fail), asked],
			[true, false],
		);
		const cards = ['ClassSheet', 'SheetHome'].map((name) =>
			code(`routes/(app)/characters/sheet/${name}.svelte`),
		);
		check(
			'10. Make this a sheet (both cards) and Compare read again first (source text)',
			/await afterReread\(read, \(\) =>\s*classBlock\(castOf\(read\.components, config\)/.test(
				cards[0],
			) &&
				/await afterReread\(read, \(\) =>\s*sheetSourceFor\(castOf\(read\.components, config\)/.test(
					cards[1],
				) &&
				/async function toggleCompare[\s\S]*?await afterReread\(read,[\s\S]*?comparing = fresh\.refused === null/.test(
					cards[1],
				) &&
				!/comparing = !comparing/.test(cards[1]),
		);
	}

	// Make this a sheet lands on the character it was pressed for.
	{
		const doc = plain();
		const look = bearLook(salmons());
		const twin = edit.duplicateCharacter(doc, 'hero')!;
		const made = sheet.makeClassSheet(doc, 'knight', look, twin);
		same(
			'10. of two characters of one look, the sheet is made on the one named, not the first',
			[
				made,
				sheet.hasSheet(doc, twin),
				sheet.hasSheet(doc, 'hero'),
				sheet.findClass(doc, 'knight')?.sheet,
			],
			[{ refused: null, characterId: twin, created: false }, true, false, twin],
		);
		const other = plain();
		const before = text(other);
		same(
			'10. a named character of another look is refused, and one that is not there, and nothing is written',
			[
				sheet.makeClassSheet(other, 'knight', look, 'goblin').refused,
				sheet.makeClassSheet(other, 'knight', look, 'nobody').refused,
				text(other) === before,
			],
			[
				'"knight" is the body "hero", but "goblin" is drawn as "goblin": a class and its sheet use the same component.',
				'No such character.',
				true,
			],
		);
		const first = plain();
		edit.duplicateCharacter(first, 'hero');
		same(
			'10. with no character named, the first of the look gets it, as before',
			sheet.makeClassSheet(first, 'knight', look).characterId,
			'hero',
		);
		check(
			'10. the Character sheet card names its own character (source text)',
			/makeClassSheet\(d, from\.classId, from\.look, id\)/.test(
				code('routes/(app)/characters/sheet/SheetHome.svelte'),
			),
		);
	}

	// ＋ Add of a kind adds the next choice of that kind.
	{
		const doc = plain();
		act.addAction(doc, 'hero', 'a');
		const triggers = () => characterTriggers(sheet.sheetOf(doc, 'hero')!.actions![0]);
		const add = (kind: act.TriggerKind) => act.addTriggerOfKind(doc, 'hero', 'a', kind);
		same(
			'10. ＋ Add → Ability twice: ability 1, then ability 2, then refused with the reason',
			[add('ability'), add('ability'), add('ability'), triggers()],
			[
				null,
				null,
				'The action already starts on both ability buttons.',
				[{ ability: 'ability1' }, { ability: 'ability2' }],
			],
		);
		same(
			'10. ＋ Add → Movement: standing still, then moving, then refused',
			[add('motion'), add('motion'), add('motion'), triggers().slice(2)],
			[
				null,
				null,
				'The action already starts on both movements.',
				[{ motion: 'still' }, { motion: 'moving' }],
			],
		);
		const events = plain();
		act.addAction(events, 'hero', 'a');
		act.addTrigger(events, 'hero', 'a', { event: act.EVENT_SUGGESTIONS[0], as: 'target' });
		act.addTriggerOfKind(events, 'hero', 'a', 'event');
		act.addTriggerOfKind(events, 'hero', 'a', 'event');
		act.addTriggerOfKind(events, 'hero', 'a', 'status');
		act.addTriggerOfKind(events, 'hero', 'a', 'status');
		same(
			'10. ＋ Add → Event and Status: the next suggestion the action does not start on',
			characterTriggers(sheet.sheetOf(events, 'hero')!.actions![0]),
			[
				{ event: act.EVENT_SUGGESTIONS[0], as: 'target' },
				{ event: act.EVENT_SUGGESTIONS[0] },
				{ event: act.EVENT_SUGGESTIONS[1] },
				{ status: act.STATUS_SUGGESTIONS[0] },
				{ status: act.STATUS_SUGGESTIONS[1] },
			],
		);
		same(
			'10. every suggestion used: none is left, and the refusal says what to do',
			[
				act.newTrigger(
					'event',
					act.EVENT_SUGGESTIONS.map((event) => ({ event })),
				),
				act.addTriggerOfKind(doc, 'hero', 'nope', 'event'),
			],
			[undefined, 'No such action.'],
		);
	}

	// A rename's note: adopted classes by whether they are the character's component.
	{
		const doc = plain();
		sheet.findClass(doc, 'knight')!.sheet = 'ghost';
		sheet.findClass(doc, 'orc')!.sheet = 'ghost';
		const renamed = sheet.renameSheetCharacter(doc, 'hero', 'ghost');
		same(
			'10. a rename onto an id two classes named: the one of its component is adopted, the other is not',
			renamed,
			{ refused: null, followed: [], adopted: ['knight'], mismatched: ['orc'] },
		);
		same(
			'10. … and the note says each truthfully',
			pg.renamedNote('ghost', renamed),
			'The class "knight" already named "ghost", a character the config did not have: it names this character now and, being its component, is drawn from its sheet whenever that sheet is in force (the Online class card says). The class "orc" already named "ghost", but is another body than this character\'s component, so it is not drawn from this sheet: a class and its sheet use the same component.',
		);
		same(
			'10. … as the runtime has it: neither is in force (no sheet yet), and "orc" never can be',
			[chk.classSheetStatus(doc, 'knight').inForce, chk.classSheetStatus(doc, 'orc').why],
			[
				false,
				'"ghost" is drawn as "hero", but the class is the body "goblin": a class and its sheet use the same component.',
			],
		);
	}

	// A rename keeps the cards mounted; picking another character does not.
	{
		const first = pg.pickCharacter(undefined, 'hero', 'draw');
		const renamed = pg.followRename(first, 'paladin');
		const other = pg.pickCharacter(renamed, 'goblin');
		same(
			'10. a rename: the same mount (the cards keep their notes), the new id, no card opened again',
			[renamed, 'card' in renamed, renamed.mount === first.mount],
			[{ id: 'paladin', mount: first.mount }, false, true],
		);
		same(
			'10. picking a character is a fresh mount, on the card asked for',
			[first.card, other.mount !== renamed.mount, other.id, 'card' in other],
			['draw', true, 'goblin', false],
		);
		const pageCode = code('routes/(app)/characters/+page.svelte');
		check(
			'10. the page mounts the cards by that mount, not by the id (source text)',
			/\{#key picked\.mount\}\s*<SheetCards/.test(pageCode) &&
				!/\{#key character\.id\}\s*<SheetCards/.test(pageCode) &&
				/picked = followRename\(picked, next\)/.test(pageCode) &&
				/openCard=\{picked\.card\}/.test(pageCode),
		);
		check(
			'10. the cell editor is mounted per cell (source text)',
			/\{#key selected\}\s*<CellEditor/.test(
				code('routes/(app)/characters/sheet/ActionsCard.svelte'),
			),
		);
	}

	// No false text, no dead branch, and every table control is named.
	{
		const card = (name: string): string => code(`routes/(app)/characters/sheet/${name}.svelte`);
		check(
			'10. the Source card changes kind in one place, which asks with what is lost before it confirms it; the cell editors replace only from their Replace button (source text)',
			(card('SourceCard').match(/setSourceKind\(/g) ?? []).length === 1 &&
				/const loss = sourceChangeLoss\(sheet, next\)\.text;\s*if \(loss\) \{\s*const ok = await askConfirm\(/.test(
					card('SourceCard'),
				) &&
				/setSourceKind\(d, id, next, \{ \.\.\.named, confirmLoss: !!loss \}\)/.test(
					card('SourceCard'),
				) &&
				['CellEditor', 'RigCellEditor'].every(
					(name) =>
						[...card(name).matchAll(/onSet\(([^)]*)\)/g)]
							.map((m) => m[1])
							.sort()
							.join('|') === 'next|waiting, true' &&
						/if \(next && replaces\(next\)\) \{\s*waiting = next;/.test(card(name)) &&
						(card(name).match(/onclick=\{replace\}/g) ?? []).length === 1 &&
						/data-cell-replace-yes[^>]*onclick=\{replace\}/.test(card(name)),
				),
		);
		const unnamed = (markup: string): string[] =>
			[...markup.matchAll(/<(input|select)\b[^>]*>/g)]
				.map((m) => m[0])
				.filter((tag) => !/aria-label=/.test(tag));
		same(
			'10. every input and select of the actions, variants and points tables has an aria-label',
			[
				unnamed(card('ActionsCard').split('<table')[1].split('</table>')[0]),
				unnamed(card('SourceCard').split('<table')[1].split('</table>')[0]),
				unnamed(card('DrawCard').split('<table')[1].split('</table>')[0]),
				unnamed(card('CellEditor')),
			],
			[[], [], [], []],
		);
	}

	// What may edit the doc, and the save, as the page wires them.
	{
		same(
			'10. nothing is edited while a save is in flight, nor read-only; else it is',
			[
				editRefusal({ readOnly: false, saving: false }),
				editRefusal({ readOnly: true, saving: false }),
				editRefusal({ readOnly: false, saving: true }),
			],
			[
				null,
				'This page is read-only: nothing was changed.',
				'A save is in flight: nothing can be edited until it lands. Try again then.',
			],
		);
		const pageCode = code('routes/(app)/characters/+page.svelte');
		check(
			'10. the page is locked by that refusal, its controls with it, and saves through the factory (source text)',
			/const locked = \$derived\(\s*editRefusal\(\{ readOnly: lease\.readOnly \|\| !arcade, saving: saveState\.busy \}\),?\s*\)/.test(
				pageCode,
			) &&
				/const readOnly = \$derived\(locked !== null\)/.test(pageCode) &&
				/pageEdits\(\{\s*refusal: \(\) => locked,\s*doc: \(\) => doc,/.test(pageCode) &&
				/save: pageSaveTransport\(\{/.test(pageCode) &&
				!/fetch\(/.test(pageCode),
		);

		// The real rune modules, compiled for the client as the app compiles them.
		const dir = mkdtempSync(join(tmpdir(), 'characters-save-'));
		process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
		const runeModule = (rel: string, name: string): string => {
			const js = ts.transpileModule(code(rel), {
				compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
			}).outputText;
			const out = compileModule(js, {
				filename: `${name}.svelte.js`,
				generate: 'client',
			}).js.code.replaceAll(
				`'svelte/internal/client'`,
				`'${import.meta.resolve('svelte/internal/client')}'`,
			);
			const file = join(dir, `${name}.mjs`);
			writeFileSync(file, out);
			return pathToFileURL(file).href;
		};
		const { SaveState } = (await import(runeModule('lib/saveState.svelte.ts', 'saveState'))) as {
			SaveState: typeof SaveStateClass;
		};
		const { LeaseState } = (await import(runeModule('lib/leaseState.svelte.ts', 'leaseState'))) as {
			LeaseState: typeof LeaseStateClass;
		};

		// The real PUT handler over the in-memory R2; only who is asking is stood in for.
		const CLIENT = 'acme';
		mock.module(src('lib/server/gameConfigAccess.ts'), {
			namedExports: { requireGameConfigAccess: async () => ({ id: 'u1', role: 'developer' }) },
		});
		mock.module(src('lib/server/toolScope.ts'), {
			namedExports: {
				// §13 drives routes that ask the gate: it hands the real one back (`routeStandIns.ts`).
				gate: (...args: unknown[]) => standIns.gate(...args),
				requireProjectScope: async (_user: unknown, project: string | null) => ({
					clientKey: CLIENT,
					projectKey: project ?? '',
				}),
				// §14's component route asks for its project this way.
				requireOptionalProjectKey: async (_user: unknown, project: string | null | undefined) =>
					project?.trim() ? project : undefined,
			},
		});
		let busted = 0;
		mock.module(src('lib/server/runtimeBundleCache.ts'), {
			namedExports: { invalidateRuntimeBundle: () => void (busted += 1) },
		});
		const { PUT } = (await import('../src/routes/api/game-config/+server.ts')) as {
			PUT: (event: never) => Promise<Response>;
		};
		const storage = await import('../src/lib/server/gameConfigStorage.ts');
		const { gameConfigDocKey } = await import('../src/lib/server/projectPaths.ts');
		const bytesOf = (project: string): string => R2.get(gameConfigDocKey(CLIENT, project))!.body;
		const etagOf = (project: string): string => R2.get(gameConfigDocKey(CLIENT, project))!.etag;
		const unstamped = (bytes: string): string => {
			const doc = JSON.parse(bytes) as Record<string, unknown>;
			delete doc.updatedAt;
			return JSON.stringify(doc, null, 2);
		};

		/** Every request the page made: `PUT 200`, `lease acquire`… */
		const requests: string[] = [];
		let holder: 'me' | 'other' | null = null;
		/** While set, a PUT waits on it before it reaches the route: a save in flight. */
		let hold: Promise<void> | null = null;
		const answer = (status: number, body: unknown) =>
			new Response(JSON.stringify(body), {
				status,
				headers: { 'content-type': 'application/json' },
			});
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(String(input), 'https://launcher.test');
			if (url.pathname === '/api/lease') {
				const action = String((JSON.parse(String(init?.body)) as { action?: unknown }).action);
				requests.push(`lease ${action}`);
				if (action === 'release') {
					if (holder === 'me') holder = null;
					return answer(200, { released: true });
				}
				if (action === 'acquire' && holder === 'other') {
					const at = new Date().toISOString();
					return answer(200, {
						held: false,
						heldBy: {
							userId: 'u2',
							name: 'Bo',
							email: 'bo@example.com',
							mine: false,
							acquiredAt: at,
							heartbeatAt: at,
							expiresAt: at,
						},
						activeAgoMs: 1000,
					});
				}
				holder = 'me';
				return answer(200, { held: true, heartbeatMs: 10_000, ttlMs: 30_000 });
			}
			if (url.pathname === '/api/game-config' && init?.method === 'PUT') {
				if (hold) await hold;
				let res: Response;
				try {
					res = await PUT({ request: new Request(url, init), url, locals: {} } as never);
				} catch (e) {
					if (!isHttpError(e)) throw e;
					res = answer(e.status, e.body);
				}
				requests.push(`PUT ${res.status}`);
				return res;
			}
			throw new Error(`fixture: unexpected request ${init?.method ?? 'GET'} ${url.pathname}`);
		}) as typeof fetch;

		/** The page's own wiring (`+page.svelte`): its doc, its Compare baseline, its lease, its
		 *  SaveState over `pageSaveTransport`, and its edits behind `editRefusal`. */
		const openPage = async (project: string) => {
			const loaded = await storage.loadGameConfigDocWithEtag(CLIENT, project);
			const initial = openDoc(loaded.doc!);
			const page = { doc: copy(initial), stored: copy(initial), landed: 0 };
			const lease = new LeaseState({
				toolId: 'gameConfig',
				clientKey: CLIENT,
				projectKey: project,
				docKey: 'gameConfig',
				enabled: true,
			});
			const saveState = new SaveState({
				initialEtag: loaded.etag,
				conflictMessage: 'Someone else saved this game config while you were editing.',
				blockWhen: () => lease.readOnly,
				save: pageSaveTransport({
					projectKey: project,
					doc: () => page.doc,
					onSaved: (saved) => {
						page.doc = saved.doc;
						page.stored = saved.stored;
						page.landed += 1;
					},
				}),
			});
			const edits = pageEdits({
				refusal: () => editRefusal({ readOnly: lease.readOnly, saving: saveState.busy }),
				doc: () => page.doc,
			});
			await lease.start();
			return { page, lease, saveState, ...edits };
		};

		try {
			// A config with a sheet, a 3D world and a models block, stored through the route.
			const WORLD_3D = {
				level: {
					colliders: [{ kind: 'box', minX: -20, minY: -1, minZ: -20, maxX: 20, maxY: 0, maxZ: 20 }],
				},
				looks: { bear: { modelId: 'bear3d' } },
			};
			const MODELS = {
				profiles: { hero: { quarter: { lods: [1, 3], maps: { baseColor: 256, normal: 'drop' } } } },
				lodScreenSize: { prop: { levels: [0.5, 0.2], cullBelow: 0.01 } },
			};
			const authored = salmons() as GameConfigDoc & { models?: unknown };
			sheet.makeClassSheet(authored, 'bear', bearLook(authored));
			(authored.arcade as { world3d?: unknown }).world3d = WORLD_3D;
			authored.models = MODELS;
			const P = 'wired';
			const created = await fetch(`/api/game-config?project=${P}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ doc: bodyFor(authored), baseEtag: null }),
			});
			const createdBody = (await created.json()) as { doc: GameConfigDoc; etag: string };
			const firstBytes = bytesOf(P);
			const firstDoc = JSON.parse(firstBytes) as GameConfigDoc & { models?: unknown };
			same(
				'10. the route stores a config with a sheet, a 3D world and models: each block byte for byte as sent',
				[
					created.status,
					text(firstDoc.arcade?.characters) === text(authored.arcade?.characters),
					text(firstDoc.arcade?.online?.characters) === text(authored.arcade?.online?.characters),
					text((firstDoc.arcade as { world3d?: unknown }).world3d) === text(WORLD_3D),
					text(firstDoc.models) === text(MODELS),
					sheet.findClass(firstDoc, 'bear')?.sheet,
					createdBody.etag === etagOf(P),
				],
				[200, true, true, true, true, 'bearBot', true],
			);
			same(
				'10. … and nothing else changed on the way but the stamp',
				JSON.parse(unstamped(firstBytes)),
				JSON.parse(text(authored)),
			);

			// The page opens it and saves it untouched: the same bytes.
			const session = await openPage(P);
			requests.length = 0;
			same(
				'10. the page’s Save with the ETag it loaded: one PUT, answered 200, and it lands',
				[await session.saveState.save({ force: false }), requests, session.saveState.status],
				[true, ['PUT 200'], 'saved'],
			);
			check(
				'10. … opened and saved untouched through the route, the stored bytes are the same',
				unstamped(bytesOf(P)) === unstamped(firstBytes),
			);
			same(
				'10. … the page holds what was stored, Compare’s baseline with it, and the new ETag',
				[
					text(session.page.doc) === text(JSON.parse(bytesOf(P))),
					text(session.page.stored) === text(JSON.parse(bytesOf(P))),
					session.page.doc !== session.page.stored,
					session.saveState.etag === etagOf(P),
					session.page.landed,
				],
				[true, true, true, true, 1],
			);

			// An edit, then a save in flight: nothing can be edited until it lands.
			same(
				'10. an edit through the page’s `sheetEdit` runs, and answers the edit’s own refusal',
				[
					session.sheetEdit((d) => act.addAction(d, 'bearBot', 'roar').refused),
					session.sheetEdit((d) => sheet.setDrawWidth(d, 'bearBot', '0')),
				],
				[null, 'A width is a number above 0.'],
			);
			let release = (): void => {};
			hold = new Promise<void>((done) => (release = done));
			const flight = session.saveState.save({ force: false });
			const during = text(session.page.doc);
			same(
				'10. while the save is in flight an edit is refused, not answered "done", and changes nothing',
				[
					session.saveState.busy,
					session.sheetEdit((d) => act.addAction(d, 'bearBot', 'late').refused),
					session.change((d) => edit.setCharacterName(d, 'bearBot', 'Late')),
					text(session.page.doc) === during,
				],
				[
					true,
					'A save is in flight: nothing can be edited until it lands. Try again then.',
					false,
					true,
				],
			);
			hold = null;
			release();
			same(
				'10. … so the save that lands holds every edit made: the stored config is the page’s',
				[
					await flight,
					sheet
						.sheetOf(JSON.parse(bytesOf(P)) as GameConfigDoc, 'bearBot')
						?.actions?.map((a) => a.id),
					text(session.page.doc) === text(JSON.parse(bytesOf(P))),
					session.change((d) => edit.setCharacterName(d, 'bearBot', 'Bear')),
				],
				[true, ['idle', 'walk', 'swipe', 'roar'], true, true],
			);

			// Another author saves; the page's ETag is stale.
			const theirs = openDoc((await storage.loadGameConfigDocWithEtag(CLIENT, P)).doc!);
			sheet.setDrawWidth(theirs, 'bearBot', '333');
			await storage.saveGameConfigDoc(CLIENT, P, bodyFor(theirs), etagOf(P));
			const theirBytes = bytesOf(P);
			const baseline = text(session.page.stored);
			const mine = text(session.page.doc);
			requests.length = 0;
			same(
				'10. a stale ETag: the route answers 409 and the save is a conflict',
				[
					await session.saveState.save({ force: false }),
					requests,
					session.saveState.status,
					session.saveState.message.startsWith('Someone else saved this config'),
				],
				[false, ['PUT 409'], 'conflict', true],
			);
			same(
				'10. … the stored config is theirs to the byte, its sheet, 3D world and models intact',
				[
					bytesOf(P) === theirBytes,
					sheet.sheetOf(JSON.parse(bytesOf(P)) as GameConfigDoc, 'bearBot')?.draw?.width,
					text((JSON.parse(bytesOf(P)) as { arcade: { world3d: unknown } }).arcade.world3d) ===
						text(WORLD_3D),
					text((JSON.parse(bytesOf(P)) as { models: unknown }).models) === text(MODELS),
				],
				[true, 333, true, true],
			);
			same(
				'10. … Compare’s baseline did not move, the page keeps its edits, and nothing landed',
				[
					text(session.page.stored) === baseline,
					text(session.page.doc) === mine,
					session.page.landed,
				],
				[true, true, 2],
			);
			requests.length = 0;
			same(
				'10. "Overwrite with mine" is one forced PUT, which lands',
				[
					await session.saveState.save({ force: true }),
					requests,
					edit.findCharacter(JSON.parse(bytesOf(P)) as GameConfigDoc, 'bearBot')?.name,
					text(session.page.stored) === text(JSON.parse(bytesOf(P))),
				],
				[true, ['PUT 200'], 'Bear', true],
			);
			session.lease.release();

			// Another author holds the lease: read-only, and Save asks for nothing.
			holder = 'other';
			const watcher = await openPage(P);
			const watched = bytesOf(P);
			requests.length = 0;
			same(
				'10. a read-only lease: Save makes no request, an edit is refused, nothing is stored',
				[
					watcher.lease.readOnly,
					await watcher.saveState.save({ force: false }),
					await watcher.saveState.save({ force: true }),
					requests,
					watcher.sheetEdit((d) => act.addAction(d, 'bearBot', 'nope').refused),
					text(watcher.page.doc) === text(JSON.parse(watched)),
					bytesOf(P) === watched,
				],
				[true, false, false, [], 'This page is read-only: nothing was changed.', true, true],
			);
			watcher.lease.release();
			check('10. each save that landed busted the runtime bundle, as the route does', busted === 4);

			// A rig, still images, and cells that are not clips: through the route and the page's save.
			holder = null;
			for (const id of C6_IDS) {
				const project = `c6-${id}`;
				const sent = c6Doc([id]);
				const put = await fetch(`/api/game-config?project=${project}`, {
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ doc: bodyFor(sent), baseEtag: null }),
				});
				const putBytes = bytesOf(project);
				const c6 = await openPage(project);
				const opened = text(c6.page.doc);
				same(
					`10. ${C6_NAMES[id]}: the route stores the sheet as sent, the page opens it, and a Save untouched stores the same bytes`,
					[
						put.status,
						text(sheet.sheetOf(JSON.parse(putBytes) as GameConfigDoc, id)) === text(C6_SHEETS[id]),
						opened === text(JSON.parse(putBytes)),
						await c6.saveState.save({ force: false }),
						unstamped(bytesOf(project)) === unstamped(putBytes),
					],
					[200, true, true, true, true],
				);
				const kept = c6Kept(c6.page.doc, id);
				same(
					`10. ${C6_NAMES[id]}: the draw width is edited and saved; the source and the cells that are not clips are stored unchanged`,
					[
						c6.sheetEdit((d) => sheet.setDrawWidth(d, id, '99')),
						await c6.saveState.save({ force: false }),
						sheet.sheetOf(JSON.parse(bytesOf(project)) as GameConfigDoc, id)?.draw?.width,
						text(sheet.sheetOf(JSON.parse(bytesOf(project)) as GameConfigDoc, id)?.source) ===
							text(C6_SHEETS[id].source),
						c6Kept(JSON.parse(bytesOf(project)) as GameConfigDoc, id) === kept,
						text({
							...sheet.sheetOf(JSON.parse(bytesOf(project)) as GameConfigDoc, id),
							draw: 0,
						}) === text({ ...C6_SHEETS[id], draw: 0 }),
					],
					[null, true, 99, true, true, true],
				);
				c6.lease.release();
			}

			// The touch schemes ride in the same doc, through the same route and the same load.
			const TOUCH = {
				schemes: { Paw: { ability: 'target' }, Swim: { gestures: 'both' } },
				characters: { bear: 'Paw' },
			};
			const withTouch = salmons();
			withTouch.arcade!.online!.pointer = { taps: { bear: 'ability1', salmon: 'ability1' } };
			withTouch.arcade!.online!.touch = TOUCH;
			const T = 'touch';
			const putTouch = await fetch(`/api/game-config?project=${T}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ doc: bodyFor(withTouch), baseEtag: null }),
			});
			const touchSession = await openPage(T);
			same(
				'10. touch schemes: the route stores them as sent, and the load brings them back to the page',
				[
					putTouch.status,
					(JSON.parse(bytesOf(T)) as GameConfigDoc).arcade?.online?.touch,
					touchSession.page.doc.arcade?.online?.touch,
				],
				[200, TOUCH, TOUCH],
			);
			same(
				'10. … a class is given a scheme another class has, saved with the page’s one PUT: they share it',
				[
					touchSession.sheetEdit((d) => void touchDoc.setClassTouchScheme(d, 'salmon', 'Paw')),
					await touchSession.saveState.save({ force: false }),
					(JSON.parse(bytesOf(T)) as GameConfigDoc).arcade?.online?.touch,
					touchSession.page.doc.arcade?.online?.touch,
				],
				[
					null,
					true,
					{ ...TOUCH, characters: { bear: 'Paw', salmon: 'Paw' } },
					{ ...TOUCH, characters: { bear: 'Paw', salmon: 'Paw' } },
				],
			);
			touchSession.lease.release();
			check(
				'10. … and a config with no scheme is stored with no touch key',
				!bytesOf(P).includes('"touch"'),
			);
		} finally {
			globalThis.fetch = realFetch;
		}
	}
}

// ── 11. A rig, still images, and cells that are not clips (C6a): kept by every other edit ─────
{
	const text = (v: unknown): string => JSON.stringify(v);
	const fits = (doc: GameConfigDoc): boolean =>
		(doc.arcade?.characters ?? []).every(
			(c) => text(normalizeCharacterSheet(c)) === text(sheet.sheetFieldsOf(c)),
		);
	for (const id of C6_IDS)
		check(
			`11. ${C6_NAMES[id]}: the fixture is what the normalizer stores, and a load keeps it key for key`,
			text(normalizeCharacterSheet(C6_SHEETS[id])) === text(C6_SHEETS[id]) &&
				text(sheet.sheetOf(c6Doc(), id)) === text(C6_SHEETS[id]),
			text(sheet.sheetOf(c6Doc(), id)),
		);

	// Every edit that is not of the source, of a bone or of such a cell keeps them.
	/** The action that holds the cells that are not clips. */
	const HOLDER: Record<C6Id, string> = { otter: 'wag', crate: 'idle', fox: 'idle' };
	type Edit = [string, (d: GameConfigDoc, id: C6Id) => string | null | undefined];
	const quiet = (run: () => unknown): null => (run(), null);
	const EDITS: Edit[] = [
		['the view', (d, id) => sheet.setViewKind(d, id, 'topDown')],
		['the view’s facings', (d, id) => sheet.setViewFacings(d, id, 8)],
		['the view’s mirror', (d, id) => sheet.setViewMirror(d, id, false)],
		['the view, back', (d, id) => sheet.setViewKind(d, id, 'isometric')],
		['the draw width', (d, id) => sheet.setDrawWidth(d, id, '72')],
		['the feet', (d, id) => sheet.setDrawFeet(d, id, '0.9')],
		['a new point', (d, id) => sheet.addPoint(d, id, 'tip')],
		['a point moved', (d, id) => sheet.setPoint(d, id, 'tip', 'x', '0.25')],
		['a point renamed', (d, id) => sheet.renamePoint(d, id, 'tip', 'nose')],
		['an action’s name', (d, id) => act.setActionName(d, id, HOLDER[id], 'Shown')],
		['a new trigger', (d, id) => act.addTrigger(d, id, HOLDER[id], { status: 'holding' })],
		['a trigger removed', (d, id) => act.removeTrigger(d, id, HOLDER[id], 1)],
		[
			'how it plays',
			(d, id) => act.setActionPlay(d, id, HOLDER[id], id === 'otter' ? 'loop' : 'once'),
		],
		['its priority', (d, id) => act.setActionPriority(d, id, HOLDER[id], '5')],
		['what cuts it', (d, id) => act.setActionInterrupt(d, id, HOLDER[id], 'none')],
		['started again', (d, id) => act.setActionAgain(d, id, HOLDER[id], 'ignore')],
		['a new action', (d, id) => act.addAction(d, id, 'roar').refused],
		['its fallback', (d, id) => act.setActionFallback(d, id, HOLDER[id], 'roar')],
		['the order', (d, id) => act.moveAction(d, id, 'roar', -1)],
		['the holder renamed', (d, id) => act.renameAction(d, id, HOLDER[id], 'held').refused],
		['another action removed', (d, id) => act.removeAction(d, id, 'roar').refused],
		[
			'the class’s speed',
			(d, id) => quiet(() => setOnlineCharacterField(d, sheet.classIndex(d, id), 'speed', '321')),
		],
		['the class unlinked', (d, id) => sheet.unlinkClassSheet(d, id)],
		['the class linked', (d, id) => sheet.linkClassSheet(d, id, id)],
		['the character’s name', (d, id) => quiet(() => edit.setCharacterName(d, id, 'Named'))],
		['a duplicate made', (d, id) => quiet(() => edit.duplicateCharacter(d, id))],
		[
			'another character removed',
			(d, id) =>
				quiet(() => {
					for (const c of [...edit.charactersOf(d)]) if (c.id !== id) edit.removeCharacter(d, c.id);
				}),
		],
		['the look changed', (d, id) => quiet(() => edit.setLook(d, id, 'spareLook'))],
	];
	for (const id of C6_IDS) {
		const doc = c6Doc();
		const kept = c6Kept(doc, id);
		for (const [name, run] of EDITS) {
			const before = text(doc);
			const refused = run(doc, id);
			check(
				`11. ${C6_NAMES[id]}, ${name}: done, and the source and the cells that are not clips are as they were`,
				!refused && text(doc) !== before && c6Kept(doc, id) === kept && fits(doc),
				`${String(refused)} ${c6Kept(doc, id)}`,
			);
		}
		const renamed = sheet.renameSheetCharacter(doc, id, `${id}Two`);
		check(
			`11. ${C6_NAMES[id]}, the character renamed: the sheet goes with it, unchanged`,
			!renamed.refused && c6Kept(doc, `${id}Two`) === kept && fits(doc),
		);
	}

	// The source's kind is changed in one gated place; its variants and its cells are edited.
	const NOT_CLIPS: Record<'otter' | 'crate', string> = {
		otter: 'The source is a rig, not frame clips: choose Frame clips as the source first.',
		crate: 'The source is still images, not frame clips: choose Frame clips as the source first.',
	};
	const CLIP_UNREAD: Record<'otter' | 'crate', string> = {
		otter:
			'The source is a rig, so a clip or a still image is not drawn: the animation is found by name.',
		crate: 'The source is still images, so only a still image is drawn here.',
	};
	for (const id of ['otter', 'crate'] as const) {
		const doc = c6Doc();
		const before = text(doc);
		same(
			`11. ${C6_NAMES[id]}: a prefix is not typed over another kind of source, and nothing is written`,
			[
				sheet.setSourcePrefix(doc, id, 'bear'),
				sheet.clipSourceOf(sheet.sheetOf(doc, id)),
				text(doc) === before,
			],
			[NOT_CLIPS[id], undefined, true],
		);
		same(
			`11. ${C6_NAMES[id]}: a clip is not stored where the source draws none, in the validator’s words`,
			[
				act.setActionAnim(doc, id, 'idle', 'sw', 'bear_idle_sw'),
				pg.setCellValue(doc, id, 'idle', 'sw', { kind: 'clip', clip: 'bear_idle_sw' }),
				pg.setCellValue(doc, id, 'idle', 'sw', { kind: 'clip', clip: 'x' }, { replace: true }),
				pg.cellReadOnly(sheet.sheetOf(doc, id), 'idle', 'sw'),
				text(doc) === before,
			],
			[CLIP_UNREAD[id], CLIP_UNREAD[id], CLIP_UNREAD[id], CLIP_UNREAD[id], true],
		);
		const cleared = c6Doc();
		const cells = text(sheet.sheetOf(cleared, id)?.actions);
		same(
			`11. ${C6_NAMES[id]}: the source is taken away whole, and the view, the box and every cell stay`,
			[
				sheet.clearSource(cleared, id),
				sheet.sheetOf(cleared, id)?.source,
				text(sheet.sheetOf(cleared, id)?.actions) === cells,
				text(sheet.sheetOf(cleared, id)?.draw) === text(C6_SHEETS[id].draw),
				fits(cleared),
			],
			[null, undefined, true, true, true],
		);
	}
	{
		const doc = c6Doc();
		same(
			'11. a rig’s variants are skins: added, renamed, set and removed as a clip’s prefixes are',
			[
				sheet.variantsOf(sheet.sheetOf(doc, 'otter')),
				sheet.addVariant(doc, 'otter', 'stunned', ' dizzy '),
				sheet.addVariant(doc, 'otter', 'stunned', 'again'),
				sheet.addVariant(doc, 'otter', 'out', ' '),
				sheet.renameVariant(doc, 'otter', 'marked', 'golden'),
				sheet.setVariantPrefix(doc, 'otter', 'golden', 'silver'),
				sheet.setVariantPrefix(doc, 'otter', 'golden', ''),
				text(sheet.sheetOf(doc, 'otter')?.source),
				sheet.removeVariant(doc, 'otter', 'stunned'),
				sheet.variantsOf(sheet.sheetOf(doc, 'otter')),
				fits(doc),
			],
			[
				[['marked', 'gold']],
				null,
				'There is already a variant "stunned".',
				'A variant needs a skin.',
				null,
				null,
				'A variant needs a skin.',
				'{"kind":"rig","rig":"otterRig","rigs":{"ne":"otterBack"},"variants":{"golden":"silver","stunned":"dizzy"}}',
				null,
				[['golden', 'silver']],
				true,
			],
		);
		const before = text(doc);
		same(
			'11. still images have no variants, and say so',
			[
				sheet.addVariant(doc, 'crate', 'stunned', 'dizzy'),
				sheet.renameVariant(doc, 'crate', 'marked', 'golden'),
				sheet.setVariantPrefix(doc, 'crate', 'marked', 'silver'),
				sheet.removeVariant(doc, 'crate', 'marked'),
				sheet.variantsOf(sheet.sheetOf(doc, 'crate')),
				text(doc) === before,
			],
			[
				'Still images have no variants: every cell names its image.',
				'No such variant.',
				'No such variant.',
				null,
				[],
				true,
			],
		);
		const boxed = c6Doc();
		same(
			'11. a rig: the draw box is taken away with the bones its points follow, and the source stays',
			[
				sheet.bonesOf(sheet.sheetOf(boxed, 'otter')),
				sheet.clearDraw(boxed, 'otter'),
				sheet.sheetOf(boxed, 'otter')?.draw,
				text(sheet.sheetOf(boxed, 'otter')?.source) === text(C6_SHEETS.otter.source),
				fits(boxed),
			],
			[[['hand', 'hand_r']], null, undefined, true, true],
		);
	}
	{
		const doc = c6Doc();
		const before = text(doc);
		const held = (kind: string, value: string): string =>
			`The cell holds a ${kind} (${value}): replace it, or empty the cell first.`;
		const STILL_TEXT = `crate (${C6_STILL.assetKey})`;
		same(
			'11. nothing is written over silently: the clip field leaves a still image or a rig’s animation alone, blank or not, and a value of another kind needs a replace',
			[
				act.setActionAnim(doc, 'fox', 'idle', 'se', 'fox_sit_se'),
				act.setActionAnim(doc, 'fox', 'idle', 'se', ''),
				pg.setCellValue(doc, 'fox', 'idle', 'ne', { kind: 'clip', clip: 'fox_sit_ne' }),
				pg.setCellValue(doc, 'fox', 'idle', 'se', { kind: 'clip', clip: 'fox_sit_se' }),
				act.setActionAnim(doc, 'otter', 'wag', 'se', ''),
				act.setActionAnim(doc, 'crate', 'idle', 'se', ''),
				pg.cellReadOnly(sheet.sheetOf(doc, 'fox'), 'idle', 'se'),
				text(doc) === before,
			],
			[
				held('still image', STILL_TEXT),
				held('still image', STILL_TEXT),
				held('rig animation', 'look (foxRig)'),
				held('still image', STILL_TEXT),
				held('rig animation', 'wag (otterTail)'),
				held('still image', STILL_TEXT),
				'The cell holds a still image, not a clip.',
				true,
			],
		);
		same(
			'11. the cell’s value is read with its kind, and said in words',
			[
				pg.cellValueOf(sheet.sheetOf(doc, 'fox'), 'idle', 'se'),
				pg.cellValueOf(sheet.sheetOf(doc, 'fox'), 'idle', 'ne'),
				pg.cellValueOf(sheet.sheetOf(doc, 'fox'), 'idle', 'sw'),
				pg.storedCellsOf(sheet.sheetOf(doc, 'otter')).map((c) => pg.cellValueText(c.value)),
				pg
					.storedCellsOf(sheet.sheetOf(doc, 'fox'))
					.map((c) => `${c.action} ${c.facing}: ${pg.cellValueText(c.value)}`),
			],
			[
				{ kind: 'still', ...C6_STILL },
				{ kind: 'rig', anim: 'look', rig: 'foxRig' },
				undefined,
				['Rig animation: wag (otterTail)'],
				[
					'idle ne: Rig animation: look (foxRig)',
					`idle se: Still image: crate (${C6_STILL.assetKey})`,
				],
			],
		);
		same(
			'11. an explicit replace writes over another kind, and emptying a cell is its own step',
			[
				pg.setCellValue(
					doc,
					'fox',
					'idle',
					'se',
					{ kind: 'clip', clip: 'fox_sit_se' },
					{ replace: true },
				),
				pg.setCellValue(doc, 'fox', 'idle', 'ne', undefined),
				text(sheet.sheetOf(doc, 'fox')?.actions?.[0].anim),
				fits(doc),
			],
			[null, null, '{"se":{"clip":"fox_sit_se"}}', true],
		);
	}
	{
		const doc = c6Doc();
		const before = text(doc);
		same(
			'11. frame clips take a still image in a cell; a rig’s animation is refused, as the validator words it',
			[
				pg.setCellValue(doc, 'fox', 'walk', 'sw', { kind: 'rig', anim: 'trot' }),
				text(doc) === before,
				pg.setCellValue(doc, 'fox', 'walk', 'sw', { kind: 'still', ...C6_STILL }),
				text(sheet.sheetOf(doc, 'fox')?.actions?.[1].anim),
				fits(doc),
			],
			[
				'The source is frame clips, so a rig animation is not drawn: the clip is found by name.',
				true,
				null,
				text({ sw: { still: C6_STILL } }),
				true,
			],
		);
	}
	{
		const doc = c6Doc();
		// On the clips sheet the prefix, a variant and an empty cell are edited beside such cells.
		const kept = c6Kept(doc, 'fox');
		same(
			'11. clips with such cells: the prefix, a variant and an empty cell are edited, and those cells kept',
			[
				sheet.setSourcePrefix(doc, 'fox', 'vixen'),
				sheet.addVariant(doc, 'fox', 'marked', 'gold'),
				act.setActionAnim(doc, 'fox', 'idle', 'sw', 'vixen_sit_sw'),
				pg.cellReadOnly(sheet.sheetOf(doc, 'fox'), 'idle', 'sw'),
				text(sheet.sheetOf(doc, 'fox')?.source),
				text(sheet.sheetOf(doc, 'fox')?.actions?.[0].anim),
				fits(doc),
			],
			[
				null,
				null,
				null,
				null,
				'{"kind":"clips","prefix":"vixen","variants":{"marked":"gold"}}',
				text({
					ne: { anim: 'look', rig: 'foxRig' },
					se: { still: C6_STILL },
					sw: { clip: 'vixen_sit_sw' },
				}),
				true,
			],
		);
		check(
			'11. … the cells that are not clips exactly as they were',
			text((JSON.parse(c6Kept(doc, 'fox')) as unknown[])[2]) ===
				text((JSON.parse(kept) as unknown[])[2]),
			c6Kept(doc, 'fox'),
		);
		// A view that draws neither facing: the cells are listed with their kind and kept.
		sheet.setViewKind(doc, 'fox', 'side');
		same(
			'11. cells of facings the view does not draw: kept and listed with their kind, until the one button removes them, whatever they hold',
			[
				sheet.undrawnAnimCells(sheet.sheetOf(doc, 'fox')),
				chk
					.sheetWarnings(sheet.sheetOf(doc, 'fox'))
					.filter((w) => w.message.includes('does not draw'))
					.map((w) => w.message),
				sheet.dropUndrawnAnimCells(doc, 'fox'),
				sheet.sheetOf(doc, 'fox')?.actions?.[0].anim,
				sheet.undrawnAnimCells(sheet.sheetOf(doc, 'fox')),
				fits(doc),
			],
			[
				[
					{ action: 'idle', facing: 'ne', kind: 'rig', text: 'look (foxRig)' },
					{ action: 'idle', facing: 'se', kind: 'still', text: `crate (${C6_STILL.assetKey})` },
					{ action: 'idle', facing: 'sw', kind: 'clip', text: 'vixen_sit_sw' },
				],
				[
					'"idle" names art for ne, se, sw, which the view does not draw: they are kept and never played.',
				],
				3,
				undefined,
				[],
				true,
			],
		);
	}

	// Compare, the warnings and the status say what such a sheet is.
	{
		const doc = c6Doc();
		same(
			'11. what the game draws each as, and nothing keeps it from drawing them',
			C6_IDS.map((id) => [
				core.sheetDrawnAs(sheet.sheetOf(doc, id)),
				core.sheetUnplayed(sheet.sheetOf(doc, id)),
				chk.classSheetStatus(doc, id),
				chk.classDrawing(doc, id, undefined).kind,
				pg.drawingText(chk.classDrawing(doc, id, undefined)),
			]),
			[
				['rig', [], { sheet: 'otter', inForce: true }, 'rig', 'the sheet of "otter", a rig'],
				['stills', [], { sheet: 'crate', inForce: true }, 'sheet', 'the sheet of "crate"'],
				['clips', [], { sheet: 'fox', inForce: true }, 'sheet', 'the sheet of "fox"'],
			],
		);
		const noWidth = c6Doc();
		delete edit.findCharacter(noWidth, 'otter')!.draw;
		same(
			'11. a rig with no draw width is not drawn, and the status says why',
			[
				core.sheetDrawnAs(sheet.sheetOf(noWidth, 'otter')),
				core.sheetUnplayed(sheet.sheetOf(noWidth, 'otter')),
				chk.classSheetStatus(noWidth, 'otter'),
				chk.classDrawing(noWidth, 'otter', undefined).kind,
				sheetProblemOf(sheet.sheetOf(noWidth, 'otter')),
			],
			[
				undefined,
				['draw'],
				{ sheet: 'otter', inForce: false, why: 'The draw box has no width.' },
				'none',
				'its draw box has no width',
			],
		);
		same(
			'11. the tool’s warnings: none of a clip name for a rig or still images, and none thrown',
			C6_IDS.map((id) => chk.sheetWarnings(sheet.sheetOf(doc, id))),
			[[], [], []],
		);
		const capital = c6Doc();
		act.addAction(capital, 'otter', 'Roar');
		act.addAction(capital, 'fox', 'Roar');
		same(
			'11. … an action a rig finds by name may have a capital; a clip’s may not',
			[
				chk.sheetWarnings(sheet.sheetOf(capital, 'otter')).length,
				chk.sheetWarnings(sheet.sheetOf(capital, 'fox')).map((w) => w.action),
			],
			[0, ['Roar']],
		);
		const live = c6Doc();
		for (const id of C6_IDS) sheet.setDrawWidth(live, id, '77');
		const compared = C6_IDS.map((id) => pg.compareClass(doc, live, [], id, ['fox_walk_se']));
		same(
			'11. Compare after a draw-width edit: no cell differs, and the one difference is the width',
			compared.map((c) => [c.before.kind, c.cells, c.sheets.map(pg.sheetDifferenceText), c.safe]),
			[
				['rig', [], ['draw, width: 64 → 77.'], false],
				['sheet', [], ['draw, width: 48 → 77.'], false],
				['sheet', [], ['draw, width: 50 → 77.'], false],
			],
		);
		same(
			'11. Compare with nothing edited: no difference, for each',
			C6_IDS.map((id) => pg.compareClass(doc, c6Doc(), [], id, []).safe),
			[true, true, true],
		);
		// By hand, as no edit of the tool makes them: another rig, and another image.
		const other = c6Doc();
		(sheet.sheetOf(other, 'otter')!.source as { rig: string }).rig = 'otterTwo';
		(
			sheet.sheetOf(other, 'crate')!.actions![0].anim!.se as { still: { region: string } }
		).still.region = 'barrel';
		same(
			'11. Compare names what two rig sources say differently, and a still as the image it is',
			[
				pg.compareClass(doc, other, [], 'otter', []).sheets.map(pg.sheetDifferenceText),
				pg
					.compareClass(doc, other, [], 'crate', [])
					.cells.map(pg.cellDifferenceText)
					.filter((line) => line.includes('facing se')),
			],
			[
				['source, rig: otterRig → otterTwo.'],
				[
					`idle, facing se: still::${C6_STILL.assetKey}::crate → still::${C6_STILL.assetKey}::barrel.`,
				],
			],
		);
		const salmonsDoc = normalizeGameConfigDoc(salmonsBeforeItsBotSalmon()) as GameConfigDoc;
		const block = projectCharacters(
			SALMONS_CHARACTER_COMPONENTS.map(({ id, name, scope, characterClips }) => ({
				id,
				name,
				scope,
				characterClips,
			})),
			salmonsDoc,
		).find((pc) => pc.key === 'bear')!.look;
		const fromBlock = chk.compareCells(
			{ kind: 'block', look: block },
			chk.classDrawing(doc, 'otter', undefined),
			['bear_idle_se'],
		);
		check(
			'11. a clip block against a rig: every clip the block drew is listed as no longer drawn',
			fromBlock.some(
				(d) => d.kind === 'cell' && d.before?.clipId === 'bear_idle_se' && d.after === undefined,
			) && fromBlock.every((d) => d.kind !== 'cell' || d.after === undefined),
			text(fromBlock.slice(0, 3)),
		);
		same(
			'11. Game Config counts them as sheets, and the page’s issues are the save’s validator’s',
			[
				configPage.sheetsHeld(doc),
				chk.pageIssues(doc).issues.filter((i) => i.severity === 'error'),
			],
			[{ sheets: 3, links: 3 }, []],
		);

		// The Whole view names the source.
		const whole = wholeCharacters({ components: [], config: doc });
		const rowOf = (id: string) => whole.find((c) => c.character?.id === id)!;
		same(
			'11. the Whole view names each source by its kind, with what it names',
			C6_IDS.map((id) => [
				impliedSource(rowOf(id), doc),
				impliedView(rowOf(id), doc, []).kind,
				!!rowOf(id).clips,
				characterGaps(rowOf(id), doc, []).filter((gap) => /clip block|not drawn/.test(gap)),
			]),
			[
				[
					{ kind: 'rig', why: 'a rig (otterRig; ne: otterBack), from its character sheet' },
					'isometric',
					false,
					[],
				],
				[{ kind: 'stills', why: 'still images, from its character sheet' }, 'isometric', false, []],
				[{ kind: 'clips', why: 'frame clips, from its character sheet' }, 'isometric', true, []],
			],
		);
		const unplayed = c6Doc();
		sheet.unlinkClassSheet(unplayed, 'otter');
		const lone = wholeCharacters({ components: [], config: unplayed }).find(
			(c) => c.character?.id === 'otter',
		)!;
		same(
			'11. … and a rig sheet no class plays is a gap, said with its rig',
			[
				impliedSource(lone, unplayed).kind,
				characterGaps(lone, unplayed, []).filter((g) => g.includes('rig')),
			],
			[
				'component',
				[
					'Its character sheet names a rig (otterRig; ne: otterBack), which is not drawn: no online class plays the sheet.',
				],
			],
		);
	}
}

// ── 12–17. Sources, rigs, adding a character, the cards, the playtest's sheets (C6b) and the
// smooth turn ──────────────────────────────────────────────────────────────────────────────────
for (const section of ['sources', 'rig', 'addCharacter', 'page', 'fixtures', 'turn'] as const) {
	const { run } = (await import(`./charactersTool/${section}.ts`)) as {
		run: (t: { check: typeof check; same: typeof same }) => void | Promise<void>;
	};
	await run({ check, same });
}

// ── 5. The registry ───────────────────────────────────────────────────────────────────────────
{
	const tool = TOOLS.characters;
	same(
		'5. the tool',
		[tool?.name, tool?.url, tool?.kind],
		['Invisible Characters', '/characters', 'online'],
	);
	for (const [role, ids] of Object.entries(ROLE_TOOLS)) {
		if (role === 'admin') continue;
		check(
			`5. ${role}: Characters with Game Config`,
			ids.includes('characters') === ids.includes('gameConfig'),
		);
	}
	check(
		'5. placed in a stage',
		TOOL_STAGES.some((s) => s.tools.includes('characters')),
	);
	same('5. the guide slug', toolDocPath('characters'), 'docs/invisible-characters');
	const docs = fileURLToPath(new URL('../../../docs/tools/', import.meta.url));
	check(
		'5. docs/tools/invisible-characters.md exists',
		existsSync(`${docs}invisible-characters.md`),
	);
	check(
		'5. its row in docs/tools/README.md',
		readFileSync(`${docs}README.md`, 'utf8').includes('(invisible-characters.md)'),
	);
}

console.log(`check:characters-tool — ${passes}/${passes + fails} passed`);
if (fails) process.exit(1);
