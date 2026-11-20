/**
 * Invisible Flipbook's Characters mode decides everything it shows in pure functions
 * (`$lib/flipbook/characterSet.ts`, `projectCharacters.ts`, `characterWrites.ts`); this holds them
 * to the game's own rule (`engine-layout` `characterClips.ts`) and to the clip save's contract:
 *
 *  1. which characters a project has, and the block each plays: as the online runtime resolves it
 *     (`characterClipsIn`), for a Salmons config and for any other;
 *  2. the facings a character is drawn in and the ones the game mirrors, its states, and its
 *     names: the 35 of the owner's guide, read off `resolveCharacterClip`, not rebuilt;
 *  3. the grid: every cell, over many sets of clips, draws exactly what `resolveCharacterClip`
 *     returns, and is classed made / mirrored / stood in / nothing by it;
 *  4. misnamed clips: a typo'd state or facing, another case, a stray suffix, each with the
 *     nearest valid name; a clip of another character is not a stray;
 *  5. what breaks a character: mixed Bounds boxes, a clip with none, a saved Mirror X on a facing
 *     the game mirrors, a one-shot saved as a loop and a loop saved to play once;
 *  6. the runs of a sheet and the plan they make: one- and two-frame runs and a single still
 *     count, a clip that exists is left alone, a gap's second half is not made;
 *  7. the writes: a new clip is saved with `baseEtag: null` and never `force`, a clip that exists
 *     is reported and untouched, a Bounds box goes on under the lease against the ETag read;
 *  8. the clips the mode makes ship with no new step: each name is one `clipReachability` counts
 *     as played, and each made clip is a clip as the save stores it;
 *  9. the directions preview stands a clip as the game does: its box the look's width wide
 *     (`clipBox`), its feet on the place, art outside the box kept in view;
 * 10. a character's facings are saved into its component the way a rename is: the stored def
 *     with one field changed, against the ETag read, under its lease, and only where that is the
 *     whole story;
 * 11. a character with a SHEET (`docs/design/character-pipeline.md` §5, step C2b): the list is the
 *     runtime's order (the sheet, the component's block, the game's table) and a config with no
 *     sheet lists exactly as it did before the sheet; a sheet's grid has its actions down and its
 *     view's facings across, each cell what `resolveSheetClip` returns; an action added on the
 *     sheet is a row of empty cells whose clips are made by name; a block read as a sheet
 *     (`sheetOfCharacterClips`) gives the block's own cells; a name no saved clip can have is
 *     flagged; and the component's block is never written for a character that plays a sheet.
 *     Apply of the one Bounds box writes only the character's own clips (never a clip a cell
 *     borrows from another character), and a clip name is valid by the one rule Invisible
 *     Characters answers by too.
 *
 * Run: pnpm --filter launcher-api check:flipbook-characters
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FlipbookBounds, FlipbookClip } from 'engine-flipbook';
import type { CharacterClips, ClipFacing, ComponentDef } from 'engine-layout';
import type { CharacterSheet, GameConfigDoc } from 'game-config';

const { SALMONS_CHARACTER_CLIPS, SALMONS_CHARACTER_COMPONENTS } =
	await import('../../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts');
const { CLIP_FACINGS, characterClipsIn, clipMirrorOf, resolveCharacterClip } =
	await import('../../../packages/engine-layout/src/lib/characterClips.ts');
const { resolveSheetClip, sheetFacings, sheetOfCharacterClips, sheetPlaysClips } =
	await import('../../../packages/engine-layout/src/lib/characterSheet.ts');
const { characterSheetOf, characterViewFacings, onlineClassSheetOf } =
	await import('../../../packages/game-config/src/characterSheet.ts');
const { usesSalmonsArt } = await import('game-config');
const { salmonsConfig } = await import('../../../packages/engine-mechanics/src/salmons.js');
const { detectSequencesAcross, normalizeFlipbookClip } = await import('engine-flipbook');
const set = await import('../src/lib/flipbook/characterSet.ts');
const { characterArt, notClipCharacters, projectCharacters, sheetProblemOf } =
	await import('../src/lib/flipbook/projectCharacters.ts');
const writes = await import('../src/lib/flipbook/characterWrites.ts');
const stage = await import('../src/lib/flipbook/characterStage.ts');
const facingsOf = await import('../src/lib/flipbook/characterFacings.ts');
const { normalizeComponent } = await import('../src/lib/server/componentStorage.ts');
const { builtinClipPrefixes, clipIdsOfPrefixes, collectClipPrefixes } =
	await import('../src/lib/server/clipReachability.ts');
const { r2Slug } = await import('../src/lib/server/projectPaths.ts');

let failures = 0;
let passes = 0;
function eq(name: string, actual: unknown, expected: unknown): void {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		passes += 1;
		return;
	}
	failures += 1;
	console.error(`✗ ${name}\n    expected ${e}\n    actual   ${a}`);
}

const { salmon, bear, fisherman } = SALMONS_CHARACTER_CLIPS as Record<string, CharacterClips>;
const defs: readonly ComponentDef[] = SALMONS_CHARACTER_COMPONENTS;
const online = [
	{ id: 'salmon', body: 'salmonsSalmon', speed: 240 },
	{ id: 'bear', body: 'salmonsBear', speed: 190 },
	{ id: 'fisherman', body: 'salmonsFisherman', speed: 140 },
];
const config = (generator?: string, characters: unknown[] = online): GameConfigDoc =>
	({
		arcade: { online: { ...(generator ? { generator } : {}), characters } },
	}) as unknown as GameConfigDoc;
/** A component with its `characterClips` replaced (or taken away). */
const withBlock = (def: ComponentDef, characterClips?: CharacterClips): ComponentDef => {
	const { characterClips: _, ...rest } = def;
	return characterClips ? { ...rest, characterClips } : rest;
};

// 1. Which characters, and the block each plays.
const salmons = projectCharacters(defs, config('salmonsMap'));
eq(
	'a Salmons project lists its three characters, in the config’s order',
	salmons.map((c) => [c.key, c.inConfig, c.source, c.component?.id]),
	[
		['salmon', true, 'component', 'salmonsSalmon'],
		['bear', true, 'component', 'salmonsBear'],
		['fisherman', true, 'component', 'salmonsFisherman'],
	],
);
for (const character of salmons) {
	const def = defs.find((d) => d.id === character.component?.id);
	eq(
		`${character.key}: the block is the runtime’s (characterClipsIn of its component’s and the game’s)`,
		character.look,
		characterClipsIn(def?.characterClips, SALMONS_CHARACTER_CLIPS[character.key as 'bear']),
	);
}
eq(
	'the bear and the fisherman have eight facings, the salmon the default four',
	salmons.map((c) => [c.look.facings, c.facingsFrom]),
	[
		[undefined, 'default'],
		[8, 'component'],
		[8, 'component'],
	],
);
const bare = projectCharacters(
	defs.map((def) => withBlock(def)),
	config('salmonsRiver'),
);
eq(
	'components that carry no block play the game’s own (a project that only published clips)',
	bare.map((c) => [c.key, c.source, c.look]),
	[
		['salmon', 'game', salmon],
		['bear', 'game', bear],
		['fisherman', 'game', fisherman],
	],
);
const { facings: _eight, ...bearBefore8 } = bear;
const stored = projectCharacters(
	defs.map((def) => (def.id === 'salmonsBear' ? withBlock(def, bearBefore8) : def)),
	config('salmonsMap'),
);
eq(
	'a stored block that names no facings takes the game’s eight',
	[stored[1].look.facings, stored[1].facingsFrom, stored[1].source],
	[8, 'game', 'component'],
);
const four = projectCharacters(
	defs.map((def) => (def.id === 'salmonsBear' ? withBlock(def, { ...bear, facings: 4 }) : def)),
	config('salmonsMap'),
);
eq('a block that names four is played as written', four[1].look.facings, 4);
eq(
	'a Salmons config that lists no character still has the game’s three (their clips ship)',
	projectCharacters([], config('salmonsMap', [])).map((c) => [c.key, c.inConfig, c.source]),
	[
		['salmon', false, 'game'],
		['bear', false, 'game'],
		['fisherman', false, 'game'],
	],
);
eq(
	'another game’s project has only the characters its components name',
	projectCharacters(defs, config('crashArena')).map((c) => [c.key, c.source]),
	[
		['salmon', 'component'],
		['bear', 'component'],
		['fisherman', 'component'],
	],
);
eq(
	'…and none when its components name none',
	projectCharacters(
		defs.map((def) => withBlock(def)),
		config('crashArena'),
	),
	[],
);
const knight: CharacterClips = {
	prefixes: { base: 'knight' },
	displayWidth: 64,
	idle: 'idle',
	walk: 'run',
	on: { ability: 'slash' },
};
const knightDef = {
	...withBlock(defs[1], knight),
	id: 'knightBody',
	name: 'Knight',
} as ComponentDef;
eq(
	'a component with a block no character of the config is drawn as is listed, after them',
	projectCharacters([...defs, knightDef], config('salmonsMap')).map((c) => [c.key, c.inConfig]),
	[
		['salmon', true],
		['bear', true],
		['fisherman', true],
		['knightBody', false],
	],
);
eq(
	'with no config at all, the components’ blocks',
	projectCharacters([knightDef], null).map((c) => [c.key, c.label, c.look.facings]),
	[['knightBody', 'Knight', undefined]],
);
eq(
	'a config character drawn as a component with a block plays it under its own id',
	projectCharacters([knightDef], config(undefined, [{ id: 'hero', body: 'knightBody' }])).map(
		(c) => [c.key, c.inConfig, c.look.prefixes.base],
	),
	[['hero', true, 'knight']],
);
eq(
	'a malformed character list is read as none',
	projectCharacters([], config('crashArena', [null, 7, { id: 'x' }, { body: 'y' }])),
	[],
);

// 2. Facings, states and names.
eq('eight facings: five drawn, three mirrored', set.characterFacings(bear), {
	drawn: ['n', 'ne', 'e', 'se', 's'],
	mirrored: ['sw', 'w', 'nw'],
});
eq('four facings: two drawn, two mirrored', set.characterFacings(salmon), {
	drawn: ['ne', 'se'],
	mirrored: ['sw', 'nw'],
});
for (const look of [bear, salmon])
	for (const facing of set.characterFacings(look).mirrored)
		eq(
			`${look.prefixes.base} ${facing}: a mirrored facing’s twin is a drawn one`,
			set.characterFacings(look).drawn.includes(clipMirrorOf(facing) as ClipFacing),
			true,
		);
eq(
	'the bear’s states: two loops and a one-shot',
	set.characterStates(bear).map((s) => [s.state, s.loop, s.once, s.plays]),
	[
		['idle', true, false, ['idle']],
		['walk', true, false, ['walk']],
		['swipe', false, true, ['ability']],
	],
);
eq(
	'the fisherman’s: three loops (reel while his line holds a player) and the cast',
	set.characterStates(fisherman).map((s) => [s.state, s.loop]),
	[
		['idle', true],
		['walk', true],
		['reel', true],
		['cast', false],
	],
);
eq(
	'the salmon’s: one state played on two events is listed once',
	set.characterStates(salmon).map((s) => [s.state, s.loop, s.plays]),
	[
		['swim', true, ['idle']],
		['hop', false, ['jumped', 'climbed']],
		['caught', false, ['caught']],
	],
);
eq(
	'a state both looped and played once is neither a mistake as a loop nor as a one-shot',
	set.characterStates({ ...bear, on: { ability: 'idle' } }).map((s) => [s.state, s.loop, s.once]),
	[
		['idle', true, true],
		['walk', true, false],
	],
);
/** The owner's guide, `docs/guides/salmons-character-sprites.md` "The full list". */
const GUIDE = {
	bear: ['idle', 'walk', 'swipe'],
	fisherman: ['idle', 'walk', 'cast', 'reel'],
};
const guideNames = (prefix: 'bear' | 'fisherman'): string[] =>
	GUIDE[prefix].flatMap((state) =>
		['n', 'ne', 'e', 'se', 's'].map((f) => `${prefix}_${state}_${f}`),
	);
const drawnNames = (look: CharacterClips): string[] =>
	set
		.characterClipNames(look)
		.filter((n) => n.drawn)
		.map((n) => n.id);
eq('the bear’s 15 drawn names are the guide’s', drawnNames(bear).sort(), guideNames('bear').sort());
eq(
	'the fisherman’s 20 drawn names are the guide’s',
	drawnNames(fisherman).sort(),
	guideNames('fisherman').sort(),
);
eq(
	'with the mirrored facings: 24 and 32 names',
	[set.characterClipNames(bear).length, set.characterClipNames(fisherman).length],
	[24, 32],
);
eq(
	'the salmon’s names come under both prefixes, the base one first',
	set.characterClipNames(salmon).map((n) => [n.id, n.marked])[0],
	['salmon_pink_swim_ne', false],
);
eq(
	'…12 of each',
	[false, true].map(
		(marked) => set.characterClipNames(salmon).filter((n) => n.marked === marked).length,
	),
	[12, 12],
);
eq(
	'a marked player of a look with no marked prefix is asked for the base name',
	set.characterClipName(bear, 'walk', 'e', true),
	'bear_walk_e',
);
eq(
	'the game asks for the clip’s own name first, then its mirror twin’s',
	set.characterClipCandidates(bear, 'walk', 'w').slice(0, 2),
	['bear_walk_w', 'bear_walk_e'],
);
eq(
	'what the game can ask for includes the states it falls back to',
	['salmon_pink_idle_se', 'salmon_pink_walk_nw', 'salmon_pink_swim_e'].map((id) =>
		set.lookedForClipIds(salmon).has(id),
	),
	[true, true, false],
);

// 3. The grid is `resolveCharacterClip`'s.
/** A small seeded generator, so the sets of clips are the same on every run. */
function seeded(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const looks: [string, CharacterClips][] = [
	['bear', bear],
	['fisherman', fisherman],
	['salmon', salmon],
	['knight', knight],
	[
		'knight ×8 with a marked prefix',
		{ ...knight, facings: 8, prefixes: { base: 'knight', marked: 'knight_gold' } },
	],
];
let cells = 0;
let disagreements = 0;
const kinds = new Set<string>();
for (const [, look] of looks) {
	const pool = [...set.lookedForClipIds(look)];
	const random = seeded(pool.length);
	const sets: string[][] = [[], pool, ...pool.map((id) => [id])];
	for (let n = 0; n < 60; n++) {
		const share = random();
		sets.push(pool.filter(() => random() < share));
	}
	for (const marked of set.hasMarkedClips(look) ? [false, true] : [false])
		for (const ids of sets) {
			const have = new Set(ids);
			const grid = set.characterGrid(look, ids, marked);
			for (const row of grid.rows)
				for (const cell of row.cells) {
					cells += 1;
					kinds.add(cell.status.kind);
					const game = resolveCharacterClip(look, cell.state, cell.facing, marked, (id) =>
						have.has(id),
					);
					const drawn = set.cellPlays(cell);
					const same =
						JSON.stringify(drawn) ===
						JSON.stringify(game && { clipId: game.clipId, flipX: game.flipX });
					const twin = clipMirrorOf(cell.facing);
					const { status } = cell;
					const classed =
						status.kind === 'none'
							? game === undefined
							: status.kind === 'made'
								? game?.clipId === cell.name && game.flipX === false
								: status.kind === 'mirrored'
									? game?.flipX === true &&
										game.state === cell.state &&
										twin !== undefined &&
										game.clipId === set.characterClipName(look, cell.state, twin, marked)
									: game !== undefined &&
										game.clipId !== cell.name &&
										status.state === game.state &&
										status.marked === game.marked;
					if (!same || !classed) disagreements += 1;
				}
		}
}
eq('every cell of every grid draws what resolveCharacterClip returns', disagreements, 0);
eq('…with every kind of cell met', [...kinds].sort(), ['made', 'mirrored', 'none', 'standIn']);
console.log(`  (${cells} grid cells compared with resolveCharacterClip)`);
const fiveIdle = ['n', 'ne', 'e', 'se', 's'].map((f) => `bear_idle_${f}`);
const idleGrid = set.characterGrid(bear, fiveIdle);
eq(
	'five drawn idle clips: made where drawn, the twin mirrored for the other three',
	idleGrid.rows[0].cells.map((c) => [c.facing, c.status.kind, set.cellPlays(c)?.clipId]),
	[
		['n', 'made', 'bear_idle_n'],
		['ne', 'made', 'bear_idle_ne'],
		['e', 'made', 'bear_idle_e'],
		['se', 'made', 'bear_idle_se'],
		['s', 'made', 'bear_idle_s'],
		['sw', 'mirrored', 'bear_idle_se'],
		['w', 'mirrored', 'bear_idle_e'],
		['nw', 'mirrored', 'bear_idle_ne'],
	],
);
eq(
	'…and walk and swipe are stood in for by idle, facing for facing',
	idleGrid.rows
		.slice(1)
		.map((row) => row.cells.map((c) => c.status.kind === 'standIn' && c.status.state)),
	[Array(8).fill('idle'), Array(8).fill('idle')],
);
eq('…15 needed, 5 made, nothing empty', set.gridCounts(idleGrid), {
	made: 5,
	needed: 15,
	empty: 0,
});
eq('no clip: every cell draws nothing', set.gridCounts(set.characterGrid(bear, [])), {
	made: 0,
	needed: 15,
	empty: 24,
});
eq(
	'a west clip the author did make is drawn as made, not mirrored',
	set
		.characterGrid(bear, ['bear_idle_e', 'bear_idle_w'])
		.rows[0].cells.filter((c) => c.facing === 'w')
		.map((c) => c.status.kind),
	['made'],
);
eq(
	'a marked salmon with only pink clips is drawn with them (the base prefix stands in)',
	set
		.characterGrid(salmon, ['salmon_pink_swim_se'], true)
		.rows[0].cells.filter((c) => c.facing === 'se')
		.map((c) => [c.name, c.status]),
	[
		[
			'salmon_golden_swim_se',
			{
				kind: 'standIn',
				clipId: 'salmon_pink_swim_se',
				flipX: false,
				state: 'swim',
				marked: false,
			},
		],
	],
);
eq(
	'the salmon’s caught has no stand-in: nothing plays',
	set.characterGrid(salmon, ['salmon_pink_swim_se']).rows[2].cells.map((c) => c.status.kind),
	['none', 'none', 'none', 'none'],
);

// 4. Misnamed clips.
const project = [
	'bear_idle_se',
	'bear_idle_w',
	'bear_walk_east',
	'bear_wlak_e',
	'Bear_Walk_E',
	'bear_walk_e_copy',
	'bear__swipe_n',
	'bear_walk_south_west',
	'bear_run_e',
	'bearded_idle_se',
	'fisherman_idle_se',
	'f_ocean',
];
eq(
	'a typo’d facing or state, another case, a stray suffix: each with the nearest valid name',
	Object.fromEntries(set.strayClips(bear, project).map((s) => [s.id, [s.kind, s.nearest, s.why]])),
	{
		bear__swipe_n: ['misnamed', 'bear_swipe_n', 'spelling'],
		bear_run_e: ['misnamed', 'bear_idle_e', 'guess'],
		Bear_Walk_E: ['misnamed', 'bear_walk_e', 'spelling'],
		bear_walk_e_copy: ['misnamed', 'bear_walk_e', 'suffix'],
		bear_walk_east: ['misnamed', 'bear_walk_e', 'facing'],
		bear_walk_south_west: ['misnamed', 'bear_walk_sw', 'facing'],
		bear_wlak_e: ['misnamed', 'bear_walk_e', 'typo'],
	},
);
eq(
	'a facing the character does not have is a misname; a fall-back state’s clip is not',
	set
		.strayClips(salmon, ['salmon_pink_swim_e', 'salmon_pink_idle_se', 'salmon_golden_hop_nw'])
		.map((s) => [s.id, s.kind, s.nearest]),
	[
		['salmon_pink_idle_se', 'standInOnly', undefined],
		['salmon_pink_swim_e', 'misnamed', 'salmon_pink_swim_ne'],
	],
);
const cub: CharacterClips = { prefixes: { base: 'bear_cub' }, displayWidth: 40, idle: 'idle' };
eq(
	'a clip another character plays is not this one’s stray',
	[
		set.strayClips(bear, ['bear_cub_idle_se']).map((s) => s.id),
		set.strayClips(bear, ['bear_cub_idle_se'], [cub]).map((s) => s.id),
	],
	[['bear_cub_idle_se'], []],
);
eq('nothing is nearest when there are no names', set.nearestClipName('x', []), undefined);

// 5. What breaks a character.
const box: FlipbookBounds = { x: -140, y: -200, w: 280, h: 240 };
const clip = (id: string, extra: Partial<FlipbookClip> = {}): FlipbookClip => ({
	id,
	name: id,
	assetKey: 'c/p/manifests/atlas_manifest_bear.json',
	frames: [`${id}_00`, `${id}_01`, `${id}_02`],
	bounds: box,
	...extra,
});
const mixed = [
	clip('bear_idle_n'),
	clip('bear_idle_ne'),
	clip('bear_idle_e'),
	clip('bear_idle_se', { bounds: { ...box, w: 120 } }),
	clip('bear_idle_s', { bounds: { ...box, y: -180, h: 220 } }),
	clip('bear_walk_e', { bounds: undefined }),
	clip('bear_walk_east', { bounds: undefined }),
];
eq(
	'the box most clips carry is the character’s; the rest are listed',
	set.characterBounds(mixed.slice(0, 6)),
	{
		reference: box,
		boxes: [
			{ bounds: box, clipIds: ['bear_idle_n', 'bear_idle_ne', 'bear_idle_e'] },
			{ bounds: { ...box, w: 120 }, clipIds: ['bear_idle_se'] },
			{ bounds: { ...box, y: -180, h: 220 }, clipIds: ['bear_idle_s'] },
		],
		missing: ['bear_walk_e'],
	},
);
eq(
	'mixed boxes: each odd one is named with what differs, a clip with none too; a stray is not read',
	set.characterProblems(bear, mixed),
	[
		{ kind: 'boundsDiffer', clipId: 'bear_idle_se', differs: ['w'] },
		{ kind: 'boundsDiffer', clipId: 'bear_idle_s', differs: ['y', 'h'] },
		{ kind: 'noBounds', clipId: 'bear_walk_e' },
	],
);
eq(
	'against a box the author picked, the others differ instead',
	set.characterProblems(bear, mixed.slice(0, 4), { ...box, w: 120 }).map((p) => [p.kind, p.clipId]),
	[
		['boundsDiffer', 'bear_idle_n'],
		['boundsDiffer', 'bear_idle_ne'],
		['boundsDiffer', 'bear_idle_e'],
	],
);
eq('one box on every clip: nothing to report', set.characterProblems(bear, mixed.slice(0, 3)), []);
eq(
	'a saved Mirror X is reported on a facing the game mirrors, not on n or s',
	set.characterProblems(bear, [
		clip('bear_walk_e', { flipX: true }),
		clip('bear_walk_w', { flipX: true }),
		clip('bear_walk_n', { flipX: true }),
		clip('bear_walk_s', { flipX: true }),
	]),
	[
		{ kind: 'mirrorX', clipId: 'bear_walk_e', facing: 'e' },
		{ kind: 'mirrorX', clipId: 'bear_walk_w', facing: 'w' },
	],
);
eq(
	'a one-shot saved as a loop (an absent loop is a loop), and a loop saved to play once',
	set.characterProblems(fisherman, [
		clip('fisherman_cast_se'),
		clip('fisherman_cast_e', { loop: true }),
		clip('fisherman_cast_n', { loop: false }),
		clip('fisherman_idle_se', { loop: false }),
		clip('fisherman_reel_se', { loop: false }),
		clip('fisherman_walk_se', { loop: true }),
	]),
	[
		{ kind: 'savedAsLoop', clipId: 'fisherman_cast_se', state: 'cast' },
		{ kind: 'savedAsLoop', clipId: 'fisherman_cast_e', state: 'cast' },
		{ kind: 'savedAsOnce', clipId: 'fisherman_idle_se', state: 'idle' },
		{ kind: 'savedAsOnce', clipId: 'fisherman_reel_se', state: 'reel' },
	],
);
eq(
	'a state the game both loops and plays once is right either way',
	set.characterProblems({ ...bear, on: { ability: 'idle' } }, [
		clip('bear_idle_se', { loop: false }),
		clip('bear_idle_e', { loop: true }),
	]),
	[],
);
eq(
	'the character’s box is the one most clips carry, wherever the odd one comes',
	set.characterBounds([mixed[3], mixed[0], mixed[1]]).reference,
	box,
);
eq('the feet are the middle of the box’s bottom edge', set.feetOf(bear, box), { x: 0, y: 40 });
eq('…or the line the look names', set.feetOf({ ...bear, anchorY: 0.9 }, box), { x: 0, y: 16 });

// 6. Runs and the plan.
const numbered = (stem: string, count: number, from = 0): string[] =>
	Array.from({ length: count }, (_, i) => `${stem}_${String(from + i).padStart(2, '0')}`);
const SHEET = 'c/p/manifests/atlas_manifest_bear.json';
const PAGE2 = 'c/p/manifests/atlas_manifest_bear_2.json';
const sheets = [
	{
		assetKey: SHEET,
		regions: [
			...numbered('bear_walk_e', 8),
			...numbered('bear_idle_ne', 2),
			...numbered('bear_idle_n', 1),
			'bear_idle_s',
			'bear_se',
			...numbered('bear_swipe_se', 3),
			...numbered('bear_swipe_se', 2, 4),
			...numbered('bear_wlak_s', 4),
			...numbered('bear_walk_ne_v2', 4),
			...numbered('Bear-Walk-N', 4),
			...numbered('bear_shadow', 3),
			...numbered('bear_walk_se', 5),
			...numbered('fisherman_idle_se', 4),
			'logo',
		],
	},
	{ assetKey: PAGE2, regions: numbered('bear_walk_se', 3, 5) },
];
const runs = set.detectClipRuns(sheets);
const runOf = (stem: string) => runs.filter((r) => r.stem === stem).map((r) => r.frames.length);
eq(
	'a one-frame run, a two-frame run and an unnumbered still each count',
	[
		runOf('bear_idle_n'),
		runOf('bear_idle_ne'),
		runOf('bear_idle_s'),
		runOf('bear_se'),
		runOf('logo'),
	],
	[[1], [2], [1], [1], [1]],
);
eq('a gap still splits a run in two', runOf('bear_swipe_se'), [3, 2]);
eq(
	'an animation packed over two pages is still one run, its other page’s frames scoped',
	runs
		.filter((r) => r.stem === 'bear_walk_se')
		.map((r) => [r.primary, r.frames.length, r.frames[5], r.sheets]),
	[[SHEET, 8, `${PAGE2}::bear_walk_se_05`, [SHEET, PAGE2]]],
);
const offers = detectSequencesAcross(sheets);
eq(
	'the runs Clips mode offers (three frames and up) are all among them, unchanged',
	offers.every((o) => runs.some((r) => JSON.stringify(r) === JSON.stringify(o))),
	true,
);
eq(
	'sheets that reuse one numbering stay apart, as in Clips mode',
	set
		.detectClipRuns([
			{ assetKey: 'a', regions: numbered('frame', 2) },
			{ assetKey: 'b', regions: numbered('frame', 2) },
		])
		.map((r) => [r.primary, r.frames]),
	[
		['a', ['frame_00', 'frame_01']],
		['b', ['frame_00', 'frame_01']],
	],
);
const plan = set.planCharacterClips(bear, runs, ['bear_idle_ne']);
eq(
	'the plan: each run under its name, a clip that exists left alone, a gap’s short half not made',
	plan.rows.map((r) => [r.name, r.match, r.action, r.run.frames.length, r.why]),
	[
		['bear_idle_n', 'exact', 'create', 1, undefined],
		['bear_idle_ne', 'exact', 'exists', 2, undefined],
		['bear_idle_se', 'still', 'create', 1, undefined],
		['bear_idle_s', 'exact', 'create', 1, undefined],
		['bear_walk_n', 'exact', 'create', 4, undefined],
		['bear_walk_ne', 'near', 'create', 4, 'suffix'],
		['bear_walk_e', 'exact', 'create', 8, undefined],
		['bear_walk_se', 'exact', 'create', 8, undefined],
		['bear_walk_s', 'near', 'create', 4, 'typo'],
		['bear_swipe_se', 'exact', 'create', 3, undefined],
		['bear_swipe_se', 'exact', 'duplicate', 2, undefined],
	],
);
eq(
	'a run under the prefix that gives no name is listed apart; another character’s is not here',
	plan.unmatched.map((r) => r.stem),
	['bear_shadow'],
);
eq(
	'a run named exactly beats a still and a misspelling of the same name',
	set
		.planCharacterClips(
			bear,
			set.detectClipRuns([
				{
					assetKey: SHEET,
					regions: ['bear_se', ...numbered('bear_idle_se', 2), ...numbered('bear_idle_se_old', 6)],
				},
			]),
			[],
		)
		.rows.map((r) => [r.name, r.match, r.action]),
	[
		['bear_idle_se', 'exact', 'create'],
		['bear_idle_se', 'still', 'duplicate'],
		['bear_idle_se', 'near', 'duplicate'],
	],
);
eq(
	'`<prefix>_<facing>` with more than one frame is an animation with no state: no name',
	set.planCharacterClips(
		bear,
		set.detectClipRuns([{ assetKey: SHEET, regions: numbered('bear_e', 4) }]),
		[],
	).unmatched.length,
	1,
);
eq(
	'a marked prefix’s runs make its clips',
	set
		.planCharacterClips(
			salmon,
			set.detectClipRuns([
				{ assetKey: SHEET, regions: [...numbered('salmon_golden_swim_se', 6), 'salmon_golden_ne'] },
			]),
			[],
		)
		.rows.map((r) => [r.name, r.marked, r.match]),
	[
		['salmon_golden_swim_ne', true, 'still'],
		['salmon_golden_swim_se', true, 'exact'],
	],
);
eq(
	'each state’s settings: the tool’s rate, a loop unless the game plays it once',
	set.defaultStateSettings(fisherman),
	{
		idle: { fps: 24, loop: true },
		walk: { fps: 24, loop: true },
		reel: { fps: 24, loop: true },
		cast: { fps: 24, loop: false },
	},
);
const walkSe = plan.rows.find((r) => r.name === 'bear_walk_se');
const made = walkSe && set.plannedClip(walkSe, { fps: 12, loop: true }, box);
eq(
	'a made clip is named as the game looks for it, with the character’s box',
	made && [made.id, made.name, made.assetKey, made.fps, made.loop, made.bounds, made.frames.length],
	['bear_walk_se', 'bear_walk_se', SHEET, 12, true, box, 8],
);
eq(
	'…and is a clip exactly as the save stores it',
	made && normalizeFlipbookClip(structuredClone(made)),
	made,
);
eq(
	'a one-shot is made to play once, and with no box when the character has none',
	plan.rows
		.filter((r) => r.name === 'bear_swipe_se' && r.action === 'create')
		.map((r) => set.plannedClip(r, set.defaultStateSettings(bear)[r.state]))
		.map((c) => [c.loop, c.fps, 'bounds' in c]),
	[[false, 24, false]],
);

// 7. The writes.
eq(
	'a clip id here is the save’s own slug',
	['bear_walk_e', 'Bear Walk-E', 'ÉTÉ_01', '', 'x'.repeat(80), 'bear__idle.se'].map(set.clipIdOf),
	['bear_walk_e', 'Bear Walk-E', 'ÉTÉ_01', '', 'x'.repeat(80), 'bear__idle.se'].map(r2Slug),
);
type Sent = { url: string; body?: Record<string, unknown> };
/** The clip endpoints over an in-memory store: a create asserts the id is free, a save its ETag. */
function fakeProject(initial: FlipbookClip[] = []) {
	const store = new Map(initial.map((c) => [c.id, { clip: c, etag: `"${c.id}-1"` }]));
	const sent: Sent[] = [];
	let fail: { status: number; body: unknown } | undefined;
	let beforeSave: (() => void) | undefined;
	const answer = (status: number, body: unknown): Response =>
		new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
	const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
		const body = init?.body
			? (JSON.parse(String(init.body)) as Record<string, unknown>)
			: undefined;
		sent.push({ url, ...(body ? { body } : {}) });
		if (url.startsWith('/api/flipbook/clip?')) {
			const id = new URL(url, 'http://x').searchParams.get('id') ?? '';
			const hit = store.get(id);
			return hit
				? answer(200, { ok: true, ...structuredClone(hit) })
				: answer(404, { ok: false, error: 'not-found', message: 'That clip could not be read.' });
		}
		if (fail) return answer(fail.status, fail.body);
		beforeSave?.();
		const incoming = body?.clip as FlipbookClip;
		const hit = store.get(incoming.id);
		const base = body?.baseEtag;
		if (body && 'force' in body) throw new Error('a write sent force');
		if (base === null ? hit : !hit || hit.etag !== base)
			return answer(409, { ok: false, error: 'conflict', message: 'taken or changed' });
		const etag = `"${incoming.id}-${Number(hit?.etag.match(/(\d+)"$/)?.[1] ?? 0) + 1}"`;
		store.set(incoming.id, { clip: incoming, etag });
		return answer(200, {
			ok: true,
			id: incoming.id,
			name: incoming.name,
			frames: incoming.frames.length,
			etag,
		});
	};
	const leases: string[] = [];
	const released: string[] = [];
	const heldByOther = new Set<string>();
	const io = {
		...writes.fetchClipWrites(fetchFn, 'p'),
		lease: async (id: string) => {
			if (heldByOther.has(id)) return { held: false as const, by: 'Ana' };
			leases.push(id);
			return { held: true as const, release: () => void released.push(id) };
		},
	};
	return {
		store,
		sent,
		io,
		leases,
		released,
		heldByOther,
		saves: () => sent.filter((s) => s.url === '/api/flipbook/save'),
		failWith: (status: number, body: unknown) => void (fail = { status, body }),
		beforeSave: (fn: () => void) => void (beforeSave = fn),
	};
}
const theirs = clip('bear_idle_ne', { fps: 7 });
{
	const p = fakeProject([theirs]);
	const steps: number[] = [];
	const results = await writes.createClips(
		[clip('bear_idle_n'), clip('bear_idle_ne'), clip('Bear_Idle_E'), clip('x'.repeat(61))],
		p.io,
		(done) => steps.push(done),
	);
	eq(
		'a bulk create reports each clip: made, there already, refused',
		results.map((r) => r.outcome),
		['created', 'exists', 'refused', 'refused'],
	);
	eq('…a clip that exists is not written over', p.store.get('bear_idle_ne')?.clip, theirs);
	eq(
		'…every create asserts the id is free, for the tab’s project, and none forces',
		p.saves().map((s) => [s.body?.baseEtag, s.body?.projectKey, 'force' in (s.body ?? {})]),
		[
			[null, 'p', false],
			[null, 'p', false],
		],
	);
	eq('…a name the save would change is refused before any request', p.saves().length, 2);
	eq('…and progress is told after each', steps, [1, 2, 3, 4]);
}
{
	const p = fakeProject();
	p.failWith(409, { ok: false, error: 'scope-mismatch', message: 'This tab is editing "p" but…' });
	eq(
		'a tab left on another project is refused, never read as “exists”',
		await writes.createClips([clip('bear_idle_n')], p.io),
		[{ id: 'bear_idle_n', outcome: 'refused', note: 'This tab is editing "p" but…' }],
	);
	p.failWith(500, 'boom');
	eq(
		'a failed save is refused with its status',
		(await writes.createClips([clip('bear_idle_n')], p.io)).map((r) => [r.outcome, r.note]),
		[['refused', 'Save failed (HTTP 500).']],
	);
}
{
	const wrong = clip('bear_walk_east', { fps: 9, loop: false });
	const p = fakeProject([wrong, theirs]);
	eq(
		'a misnamed clip is copied under the right name',
		await writes.copyClipAs('bear_walk_east', 'bear_walk_e', p.io),
		{
			id: 'bear_walk_e',
			outcome: 'created',
		},
	);
	eq('…the copy is the clip, renamed', p.store.get('bear_walk_e')?.clip, {
		...wrong,
		id: 'bear_walk_e',
		name: 'bear_walk_e',
	});
	eq('…and the misnamed one is left as it was', p.store.get('bear_walk_east'), {
		clip: wrong,
		etag: '"bear_walk_east-1"',
	});
	eq(
		'a copy onto a name that is taken is not made',
		(await writes.copyClipAs('bear_walk_east', 'bear_idle_ne', p.io)).outcome,
		'exists',
	);
	eq(
		'a clip that cannot be read is not copied',
		(await writes.copyClipAs('bear_gone', 'bear_walk_s', p.io)).outcome,
		'refused',
	);
}
{
	const other = { ...box, w: 300 };
	const p = fakeProject([
		clip('bear_idle_n', { bounds: other }),
		clip('bear_idle_ne', { bounds: undefined, fps: 7 }),
		clip('bear_idle_e'),
		clip('bear_idle_se', { bounds: other }),
		clip('bear_idle_s', { bounds: other }),
		clip('bear_walk_e', { bounds: other }),
	]);
	p.heldByOther.add('bear_idle_se');
	// Someone saves `bear_idle_s` between this tab's read of it and its save.
	p.beforeSave(() => {
		const hit = p.store.get('bear_idle_s');
		if (
			hit &&
			p.sent.at(-1)?.body &&
			(p.sent.at(-1)?.body?.clip as FlipbookClip).id === 'bear_idle_s'
		)
			p.store.set('bear_idle_s', { clip: { ...hit.clip, fps: 30 }, etag: '"bear_idle_s-9"' });
	});
	const results = await writes.applyBoundsToClips(
		[
			'bear_idle_n',
			'bear_idle_ne',
			'bear_idle_e',
			'bear_idle_se',
			'bear_idle_s',
			'bear_walk_e',
			'bear_gone',
		],
		box,
		p.io,
		{
			leaveAlone: (id) =>
				id === 'bear_walk_e' ? 'Open in Clips with unsaved changes.' : undefined,
		},
	);
	eq(
		'one box on every clip reports each: updated, already so, refused',
		results.map((r) => [r.id, r.outcome]),
		[
			['bear_idle_n', 'updated'],
			['bear_idle_ne', 'updated'],
			['bear_idle_e', 'unchanged'],
			['bear_idle_se', 'refused'],
			['bear_idle_s', 'refused'],
			['bear_walk_e', 'refused'],
			['bear_gone', 'refused'],
		],
	);
	const { bounds: _none, ...unboxed } = clip('bear_idle_ne', { fps: 7 });
	eq('…only the box changed on a clip it wrote', p.store.get('bear_idle_ne')?.clip, {
		...unboxed,
		bounds: box,
	});
	eq(
		'…each save went against the ETag it read',
		p.saves().map((s) => [(s.body?.clip as FlipbookClip).id, s.body?.baseEtag]),
		[
			['bear_idle_n', '"bear_idle_n-1"'],
			['bear_idle_ne', '"bear_idle_ne-1"'],
			['bear_idle_s', '"bear_idle_s-1"'],
		],
	);
	eq(
		'…a clip someone else has open is not read or written, and says who',
		[results[3].note, p.store.get('bear_idle_se')?.clip.bounds],
		['Ana has it open.', other],
	);
	eq(
		'…a clip saved in between keeps their save',
		[p.store.get('bear_idle_s')?.clip.fps, p.store.get('bear_idle_s')?.clip.bounds],
		[30, other],
	);
	eq(
		'…a clip open with unsaved edits is left alone before any lease',
		[results[5].note, p.leases.includes('bear_walk_e')],
		['Open in Clips with unsaved changes.', false],
	);
	eq('…and every lease taken is given back, a failed write’s too', p.released, p.leases);
}

// 8. The clips it makes ship with no new step.
const salmonsPrefixes = builtinClipPrefixes(config('salmonsMap'));
for (const [key, look] of [
	['bear', bear],
	['fisherman', fisherman],
	['salmon', salmon],
] as const) {
	const names = set.characterClipNames(look).map((n) => n.id);
	eq(
		`${key}: every name the mode can make is one a Salmons project ships`,
		clipIdsOfPrefixes(salmonsPrefixes, names).length,
		names.length,
	);
}
const named = new Set<string>();
collectClipPrefixes({ knightBody: knightDef }, named);
eq(
	'a component’s character: every name is under the prefix its block ships',
	clipIdsOfPrefixes(
		named,
		set.characterClipNames(knight).map((n) => n.id),
	).length,
	set.characterClipNames(knight).length,
);
eq(
	'a misnamed clip in another case is not one the ship path counts, which is why it is flagged',
	clipIdsOfPrefixes(salmonsPrefixes, ['Bear_Walk_E']),
	[],
);
eq(
	'the eight facings the grid lays out are the runtime’s',
	[...CLIP_FACINGS].sort(),
	[...set.characterFacings(bear).drawn, ...set.characterFacings(bear).mirrored].sort(),
);

// 9. The directions preview stands a clip as the game does.
const canvas = { origW: 280, origH: 240, offX: 0, offY: 0, artW: 280, artH: 240 };
/** A frame trimmed to its art, with a paw reaching 30 px past the canvas' right edge. */
const reaching = { origW: 280, origH: 240, offX: 60, offY: 40, artW: 250, artH: 170 };
const walkE = clip('bear_walk_e');
const boxedStage = stage.clipStage(bear, walkE, [canvas, reaching]);
eq('a clip with a box is drawn the look’s width over the box’s', boxedStage?.scale, 92 / 280);
// The box reaches 80 px above the canvas; the paw 30 px past its right edge; the art 80 px below.
eq('…and its window holds the box and the art that reaches outside it', boxedStage?.view, {
	x: -140,
	y: -200,
	w: 310,
	h: 320,
});
eq(
	'…its feet on the middle of the box’s bottom edge, whichever frame shows',
	[
		boxedStage && stage.stageFeet(bear, boxedStage, canvas),
		boxedStage && stage.stageFeet(bear, boxedStage, reaching),
	],
	[
		{ x: 0, y: 40 },
		{ x: 0, y: 40 },
	],
);
const narrow = stage.clipStage(bear, clip('bear_idle_s', { bounds: { ...box, x: -100, w: 200 } }), [
	canvas,
]);
eq(
	'a narrower box draws the same art bigger: why mixed boxes change size',
	narrow?.scale,
	92 / 200,
);
const unboxed = stage.clipStage(bear, clip('bear_idle_n', { bounds: undefined }), [
	canvas,
	reaching,
]);
eq(
	'a clip with no box is sized by its first frame’s canvas, each frame on its own',
	[unboxed?.boxed, unboxed?.scale, unboxed && stage.stageFeet(bear, unboxed, canvas)],
	[false, 92 / 280, { x: 0, y: 120 }],
);
const tall = { origW: 200, origH: 300, offX: 0, offY: 0, artW: 200, artH: 300 };
eq(
	'…a later frame of another canvas stands on its own bottom edge',
	unboxed && stage.stageFeet(bear, unboxed, tall),
	{ x: 0, y: 150 },
);
eq(
	'a box the author is about to apply stands in for the clip’s own, and zoom scales it',
	stage.clipStage(bear, walkE, [canvas], 2, { x: -70, y: -100, w: 140, h: 140 })?.scale,
	(92 * 2) / 140,
);
eq('no frame loaded yet: nothing to stand', stage.clipStage(bear, walkE, []), undefined);

// 10. A character's facings, saved into its component.
const salmonCharacter = salmons[0];
eq(
	'a project component with its own block can be given facings',
	facingsOf.facingsProblem(salmonCharacter, true),
	null,
);
eq(
	'…not without the Scene Editor, not a shared component, not a block that is the game’s own',
	[
		facingsOf.facingsProblem(salmonCharacter, false),
		facingsOf.facingsProblem(
			{ ...salmonCharacter, component: { id: 'x', name: 'X', scope: 'shared', hasBlock: true } },
			true,
		),
		facingsOf.facingsProblem(bare[0], true),
		facingsOf.facingsProblem(projectCharacters([], config('salmonsMap', []))[0], true),
	].map((problem) => problem !== null),
	[true, true, true, true],
);
function fakeComponents(def: ComponentDef | undefined, etag: string | null = '"c-1"') {
	const saved: { def: ComponentDef; baseEtag: string }[] = [];
	const leases: string[] = [];
	let heldBy: string | undefined;
	let refuse: string | undefined;
	return {
		saved,
		leases,
		holdFor: (name: string) => void (heldBy = name),
		refuseWith: (message: string) => void (refuse = message),
		io: {
			read: async () => (def ? { def: structuredClone(def), etag } : { status: 404 }),
			save: async (next: ComponentDef, baseEtag: string) => {
				if (refuse) return { status: 409, message: refuse };
				saved.push({ def: next, baseEtag });
				return { version: next.version + 1, etag: '"c-2"' };
			},
			lease: async (id: string) => {
				if (heldBy) return { held: false as const, by: heldBy };
				leases.push(`take ${id}`);
				return { held: true as const, release: () => void leases.push(`give ${id}`) };
			},
		},
	};
}
const salmonDef = { ...structuredClone(defs[0]), scope: 'project' } as ComponentDef;
{
	const c = fakeComponents(salmonDef);
	eq(
		'eight facings are saved into the block, as a new version',
		await facingsOf.writeCharacterFacings('salmonsSalmon', 8, c.io),
		{
			facings: 8,
			version: salmonDef.version + 1,
		},
	);
	eq('…the stored def with that one field changed, against the ETag read', c.saved, [
		{ def: { ...salmonDef, characterClips: { ...salmon, facings: 8 } }, baseEtag: '"c-1"' },
	]);
	eq('…under the component’s lease, given back after', c.leases, [
		'take salmonsSalmon',
		'give salmonsSalmon',
	]);
	const saved = normalizeComponent(structuredClone(c.saved[0].def));
	eq('…which the component save keeps', saved.characterClips?.facings, 8);
	eq(
		'…and the mode then lays the character out in eight',
		set.characterFacings(projectCharacters([saved], config('salmonsMap'))[0].look).drawn,
		['n', 'ne', 'e', 'se', 's'],
	);
}
{
	const c = fakeComponents({ ...salmonDef, characterClips: { ...salmon, facings: 8 } });
	eq(
		'a block that already says so is not saved again',
		[await facingsOf.writeCharacterFacings('salmonsSalmon', 8, c.io), c.saved.length],
		[{ facings: 8, version: null }, 0],
	);
	eq(
		'an explicit four is written (a Salmons block with none takes the game’s)',
		[
			await facingsOf.writeCharacterFacings('salmonsSalmon', 4, c.io),
			c.saved[0]?.def.characterClips?.facings,
		],
		[{ facings: 4, version: salmonDef.version + 1 }, 4],
	);
}
{
	const held = fakeComponents(salmonDef);
	held.holdFor('Ana');
	eq(
		'a component someone has open is not read or written',
		[await facingsOf.writeCharacterFacings('salmonsSalmon', 8, held.io), held.saved.length],
		[{ problem: 'Ana has the component open.' }, 0],
	);
	const lost = fakeComponents(salmonDef);
	lost.refuseWith('Someone else saved this component while you were editing it.');
	eq(
		'a save that lost its race says so, and the lease is given back',
		[await facingsOf.writeCharacterFacings('salmonsSalmon', 8, lost.io), lost.leases],
		[
			{ problem: 'Someone else saved this component while you were editing it.' },
			['take salmonsSalmon', 'give salmonsSalmon'],
		],
	);
	for (const [why, def, etag] of [
		['gone', undefined, '"c-1"'],
		['shared now', { ...salmonDef, scope: 'shared' }, '"c-1"'],
		['a built-in with no stored copy', salmonDef, null],
		['its block removed', withBlock(salmonDef), '"c-1"'],
	] as const) {
		const c = fakeComponents(def as ComponentDef | undefined, etag);
		const result = await facingsOf.writeCharacterFacings('salmonsSalmon', 8, c.io);
		eq(
			`a component that is ${why} is not written`,
			['problem' in result, c.saved.length],
			[true, 0],
		);
	}
}

// 11. A character with a sheet.
type Listed = ReturnType<typeof projectCharacters>;
/**
 * `projectCharacters` as it was before a character could have a sheet, kept here word for word: a
 * config with no sheet must list exactly as this does.
 */
function listedBeforeSheets(
	components: readonly ComponentDef[],
	cfg: GameConfigDoc | null | undefined,
): unknown[] {
	const isObject = (v: unknown): v is Record<string, unknown> =>
		typeof v === 'object' && v !== null && !Array.isArray(v);
	const arcade: unknown = (cfg as { arcade?: unknown } | null | undefined)?.arcade;
	const onlineOf = isObject(arcade) ? arcade.online : undefined;
	const listed = isObject(onlineOf) ? onlineOf.characters : undefined;
	const classes = (Array.isArray(listed) ? listed : []).flatMap((c: unknown) =>
		isObject(c) && typeof c.id === 'string' && typeof c.body === 'string'
			? [{ id: c.id, body: c.body }]
			: [],
	);
	const byId = new Map(components.map((def) => [def.id, def]));
	const builtin: Readonly<Record<string, CharacterClips>> = usesSalmonsArt(cfg)
		? SALMONS_CHARACTER_CLIPS
		: {};
	const out: { key: string }[] = [];
	const drawnAs = new Set<string>();
	const add = (
		key: string,
		inConfig: boolean,
		def: ComponentDef | undefined,
		game: CharacterClips | undefined,
	): void => {
		const own = def?.characterClips;
		const look = characterClipsIn(own, game);
		if (!look || out.some((c) => c.key === key)) return;
		out.push({
			key,
			label: def?.name ?? key.charAt(0).toUpperCase() + key.slice(1),
			look,
			inConfig,
			source: own ? 'component' : 'game',
			facingsFrom: own?.facings ? 'component' : look.facings ? 'game' : 'default',
			...(def
				? { component: { id: def.id, name: def.name, scope: def.scope, hasBlock: !!own } }
				: {}),
		} as { key: string });
		if (def) drawnAs.add(def.id);
	};
	for (const { id, body } of classes)
		add(id, true, byId.get(body), Object.hasOwn(builtin, id) ? builtin[id] : undefined);
	for (const [id, game] of Object.entries(builtin)) add(id, false, undefined, game);
	for (const def of components) {
		if (!def.characterClips || drawnAs.has(def.id)) continue;
		const taken = out.some((c) => c.key === def.id);
		add(taken ? `component:${def.id}` : def.id, false, def, undefined);
	}
	return out;
}

const reference = salmonsConfig() as GameConfigDoc;
eq(
	'the Salmons reference config has no sheet',
	[
		(reference.arcade?.characters ?? []).map((c) => characterSheetOf(reference, c.id)),
		(reference.arcade?.online?.characters ?? []).map((c) => onlineClassSheetOf(reference, c.id)),
	],
	[
		(reference.arcade?.characters ?? []).map(() => undefined),
		(reference.arcade?.online?.characters ?? []).map(() => undefined),
	],
);
const blockless = defs.map((def) => withBlock(def));
const sheetless: [string, readonly ComponentDef[], GameConfigDoc | null][] = [
	['the Salmons reference config', defs, reference],
	['the Salmons reference config, its components without a block', blockless, reference],
	['the Salmons reference config with a knight component', [...defs, knightDef], reference],
	['a Salmons config that lists no character', [], config('salmonsMap', [])],
	['another game’s config', defs, config('crashArena')],
	['no config', [knightDef], null],
];
for (const [name, components, cfg] of sheetless) {
	const now = projectCharacters(components, cfg);
	eq(
		`${name}, with no sheet, lists byte for byte as before the sheet`,
		JSON.stringify(now),
		JSON.stringify(listedBeforeSheets(components, cfg)),
	);
	eq(
		`…and what each plays is its block`,
		now.map(characterArt),
		now.map((c) => c.look),
	);
}
eq(
	'the reference config lists its three classes',
	projectCharacters(defs, reference).map((c) => [c.key, c.source]),
	[
		['salmon', 'component'],
		['bear', 'component'],
		['fisherman', 'component'],
	],
);

type RawConfig = {
	arcade: {
		characters: Record<string, unknown>[];
		online: { characters: Record<string, unknown>[] };
	};
};
/** The reference config with `edit` made on a copy. */
const edited = (edit: (cfg: RawConfig) => void): GameConfigDoc => {
	const cfg = structuredClone(reference) as unknown as RawConfig;
	edit(cfg);
	return cfg as unknown as GameConfigDoc;
};
const characterOf = (cfg: RawConfig, id: string) => cfg.arcade.characters.find((c) => c.id === id);
const classOf = (cfg: RawConfig, id: string) =>
	cfg.arcade.online.characters.find((c) => c.id === id);
const bearSheet = sheetOfCharacterClips(bear);
/** The bear's class names `bearBot`, which carries `sheet` (the plan's own example, §12.10). */
const bearOnSheet = (sheet: CharacterSheet | Record<string, unknown> = bearSheet): GameConfigDoc =>
	edited((cfg) => {
		Object.assign(characterOf(cfg, 'bearBot') ?? {}, sheet);
		Object.assign(classOf(cfg, 'bear') ?? {}, { sheet: 'bearBot' });
	});
const byKey = (list: Listed, key: string) => list.find((c) => c.key === key);

/** A value with every object's keys in one order, so two are compared whatever theirs. */
const sortedKeys = (value: unknown): unknown =>
	Array.isArray(value)
		? value.map(sortedKeys)
		: typeof value === 'object' && value !== null
			? Object.fromEntries(
					Object.entries(value)
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([key, v]) => [key, sortedKeys(v)]),
				)
			: value;

const wired = projectCharacters(defs, bearOnSheet());
eq(
	'a class whose sheet is in force lists from the sheet, though its component has a block',
	[
		defs.find((d) => d.id === 'salmonsBear')?.characterClips !== undefined,
		wired.map((c) => [c.key, c.inConfig, c.source, c.sheetId, c.component?.id]),
	],
	[
		true,
		[
			['salmon', true, 'component', undefined, 'salmonsSalmon'],
			['bear', true, 'sheet', 'bearBot', 'salmonsBear'],
			['fisherman', true, 'component', undefined, 'salmonsFisherman'],
		],
	],
);
eq(
	'…it carries the sheet the runtime reads (onlineClassSheetOf), and plays it',
	[byKey(wired, 'bear')?.sheet, byKey(wired, 'bear')?.sheetProblem],
	[onlineClassSheetOf(bearOnSheet(), 'bear')?.sheet, undefined],
);
eq(
	'…what it plays is the sheet, and its look is the sheet in a block’s shape',
	[
		characterArt(byKey(wired, 'bear') as Listed[number]) === byKey(wired, 'bear')?.sheet,
		sortedKeys(byKey(wired, 'bear')?.look),
	],
	[true, sortedKeys(bear)],
);
eq(
	'…the same with no component block at all: the sheet, not the game’s table',
	projectCharacters(blockless, bearOnSheet()).map((c) => [c.key, c.source]),
	[
		['salmon', 'game'],
		['bear', 'sheet'],
		['fisherman', 'game'],
	],
);
eq(
	'…and the block of a component a sheet is played for is not listed a second time',
	projectCharacters(defs, bearOnSheet()).filter((c) => c.component?.id === 'salmonsBear').length,
	1,
);
const { draw: _noDraw, ...widthless } = bearSheet;
const { actions: _noActions, ...actionless } = bearSheet;
const notInForce: [string, GameConfigDoc, string][] = [
	[
		'on another component',
		edited((cfg) => {
			Object.assign(characterOf(cfg, 'fishermanBot') ?? {}, bearSheet);
			Object.assign(classOf(cfg, 'bear') ?? {}, { sheet: 'fishermanBot' });
		}),
		'The class "bear" names the sheet of "fishermanBot", which is drawn as "salmonsFisherman" while the class is the body "salmonsBear": a class and its sheet use the same component.',
	],
	[
		'with no draw width',
		bearOnSheet(widthless),
		'The class "bear" names the sheet of "bearBot", which is not played: its draw box has no width.',
	],
	[
		'with no action',
		bearOnSheet(actionless),
		'The class "bear" names the sheet of "bearBot", which is not played: it has no action.',
	],
	[
		'with a 3D view',
		bearOnSheet({ ...bearSheet, view: { kind: '3d' } }),
		'The class "bear" names the sheet of "bearBot", which is not played: a 3D view has no facings, so no frame clip is drawn.',
	],
	[
		'that no character holds',
		edited((cfg) => Object.assign(classOf(cfg, 'bear') ?? {}, { sheet: 'nobody' })),
		'The class "bear" names the sheet of "nobody", but the config has no such character.',
	],
	[
		'of a character with no sheet',
		edited((cfg) => Object.assign(classOf(cfg, 'bear') ?? {}, { sheet: 'bearBot' })),
		'The class "bear" names the sheet of "bearBot", which is not played: it has no view, animation source, draw box or actions.',
	],
];
for (const [name, cfg, why] of notInForce) {
	const listed = byKey(projectCharacters(defs, cfg), 'bear');
	eq(
		`a sheet ${name} is not in force: the class falls to its component’s block, and says why`,
		[
			sheetPlaysClips(onlineClassSheetOf(cfg, 'bear')?.sheet),
			listed?.source,
			listed?.look,
			listed?.sheet,
			listed?.sheetProblem,
		],
		[false, 'component', byKey(salmons, 'bear')?.look, undefined, why],
	);
	const table = byKey(projectCharacters(blockless, cfg), 'bear');
	eq(
		`…and with no block, to the game’s table`,
		[table?.source, table?.look, table?.sheetProblem],
		['game', bear, why],
	);
}
eq(
	'a class that names no sheet says nothing of one',
	salmons.map((c) => c.sheetProblem),
	[undefined, undefined, undefined],
);
const unwired = projectCharacters(
	defs,
	edited((cfg) => Object.assign(characterOf(cfg, 'bearBot') ?? {}, bearSheet)),
);
eq(
	'a character with a clips sheet no class names yet is listed after the rest, marked not played by a class',
	unwired.map((c) => [c.key, c.inConfig, c.source, c.sheetId, c.sheetProblem]),
	[
		['salmon', true, 'component', undefined, undefined],
		['bear', true, 'component', undefined, undefined],
		['fisherman', true, 'component', undefined, undefined],
		['bearBot', false, 'sheet', 'bearBot', undefined],
	],
);
eq(
	'…one a class names in vain is listed too, with the class’s reason',
	projectCharacters(defs, bearOnSheet(widthless))
		.filter((c) => c.source === 'sheet')
		.map((c) => [c.key, c.inConfig, c.sheetProblem]),
	[['bearBot', false, notInForce[1][2]]],
);
eq(
	'…a sheet with no frame clips, or with a 3D view, is not a character of this mode',
	[
		projectCharacters(
			defs,
			edited((cfg) => Object.assign(characterOf(cfg, 'bearBot') ?? {}, { view: { kind: 'side' } })),
		).length,
		projectCharacters(
			defs,
			edited((cfg) =>
				Object.assign(characterOf(cfg, 'bearBot') ?? {}, { ...bearSheet, view: { kind: '3d' } }),
			),
		).length,
	],
	[3, 3],
);
eq(
	'…a sheet character whose id a class already has keeps both, under another key',
	projectCharacters(
		defs,
		edited((cfg) => {
			cfg.arcade.characters.push({ id: 'bear', component: 'salmonsFisherman', ...bearSheet });
		}),
	).map((c) => c.key),
	['salmon', 'bear', 'fisherman', 'sheet:bear'],
);
eq(
	'why a sheet is not played, in the order the game refuses one',
	[
		sheetProblemOf(bearSheet),
		sheetProblemOf(undefined),
		sheetProblemOf({ view: { kind: 'side' } }),
		sheetProblemOf(widthless),
	],
	[
		undefined,
		'it has no view, animation source, draw box or actions',
		'it has no animation source',
		'its draw box has no width',
	],
);

// The grid of a sheet: its actions down, its view's facings across, each cell the game's.
const knightSheet: CharacterSheet = {
	source: {
		kind: 'clips',
		prefix: 'knight',
		variants: { marked: 'knight_gold', stunned: 'knight_dizzy' },
	},
	draw: { width: 64, feet: 0.9 },
	actions: [
		{ id: 'idle', name: 'Stand', when: { motion: 'still' }, fallback: 'run' },
		{ id: 'run', when: { motion: 'moving' }, fallback: 'idle' },
		{ id: 'slash', when: { ability: 'ability1' }, fallback: 'idle' },
		{ id: 'grab', when: { event: 'caught' }, anim: { e: { clip: 'knight_grab_side' } } },
		{ id: 'rest', fallback: 'idle' },
	],
};
const views: [string, CharacterSheet['view']][] = [
	['no view', undefined],
	['side', { kind: 'side' }],
	['side, not mirrored', { kind: 'side', mirror: false }],
	['top-down 4', { kind: 'topDown' }],
	['top-down 8', { kind: 'topDown', facings: 8 }],
	['isometric 4, not mirrored', { kind: 'isometric', mirror: false }],
	['isometric 8', { kind: 'isometric', facings: 8 }],
];
const artSheets: [string, CharacterSheet][] = [
	...looks.map(([name, look]): [string, CharacterSheet] => [
		`${name} as a sheet`,
		sheetOfCharacterClips(look),
	]),
	...views.map(([name, view]): [string, CharacterSheet] => [
		`knight sheet, ${name}`,
		view ? { ...knightSheet, view } : knightSheet,
	]),
];
for (const [name, sheet] of artSheets) {
	const facings = set.characterFacings(sheet);
	eq(
		`${name}: its columns are its view’s facings (characterViewFacings), each once`,
		[[...facings.drawn, ...facings.mirrored].sort(), sheetFacings(sheet).length],
		[[...characterViewFacings(sheet.view)].sort(), characterViewFacings(sheet.view).length],
	);
}
eq(
	'the drawn and the mirrored facings of each view (plan §12.3)',
	views.map(([, view]) => {
		const { drawn, mirrored } = set.characterFacings(view ? { ...knightSheet, view } : knightSheet);
		return [drawn.join(' '), mirrored.join(' ')];
	}),
	[
		['ne se', 'sw nw'],
		['e', 'w'],
		['e w', ''],
		['n e s', 'w'],
		['n ne e se s', 'sw w nw'],
		['ne se sw nw', ''],
		['n ne e se s', 'sw w nw'],
	],
);
let sheetCells = 0;
let sheetDisagreements = 0;
let flippedUnmirrored = 0;
const sheetKinds = new Set<string>();
for (const [, sheet] of artSheets) {
	const pool = [...set.lookedForClipIds(sheet)];
	const random = seeded(pool.length + 7);
	const sets: string[][] = [[], pool, ...pool.map((id) => [id])];
	for (let n = 0; n < 40; n++) {
		const share = random();
		sets.push(pool.filter(() => random() < share));
	}
	const mirrors = set.characterFacings(sheet).mirrored.length > 0;
	for (const variant of ['', ...set.characterVariants(sheet).map((v) => v.status)])
		for (const ids of sets) {
			const have = new Set(ids);
			const grid = set.characterGrid(sheet, ids, variant);
			for (const row of grid.rows)
				for (const cell of row.cells) {
					sheetCells += 1;
					sheetKinds.add(cell.status.kind);
					const game = resolveSheetClip(
						sheet,
						cell.state,
						cell.facing,
						variant ? [variant] : [],
						(id) => have.has(id),
					);
					const drawn = set.cellPlays(cell);
					const same =
						JSON.stringify(drawn) ===
						JSON.stringify(game && { clipId: game.clipId, flipX: game.flipX });
					const twin = clipMirrorOf(cell.facing);
					const { status } = cell;
					const classed =
						status.kind === 'none'
							? game === undefined
							: status.kind === 'made'
								? game?.clipId === cell.name && game.flipX === false
								: status.kind === 'mirrored'
									? game?.flipX === true &&
										twin !== undefined &&
										game.clipId === set.characterClipName(sheet, cell.state, twin, variant)
									: game !== undefined &&
										(game.clipId !== cell.name || game.flipX) &&
										status.state === game.action &&
										status.marked === (game.variant !== undefined);
					if (!same || !classed) sheetDisagreements += 1;
					if (!mirrors && drawn?.flipX) flippedUnmirrored += 1;
				}
		}
}
eq('every cell of every sheet’s grid draws what resolveSheetClip returns', sheetDisagreements, 0);
eq('…with every kind of cell met', [...sheetKinds].sort(), ['made', 'mirrored', 'none', 'standIn']);
eq('…and a view that does not mirror never draws a clip mirrored', flippedUnmirrored, 0);
console.log(`  (${sheetCells} sheet grid cells compared with resolveSheetClip)`);

// A block read as a sheet gives the block's own cells.
let converted = 0;
let convertedDiffer = 0;
for (const [, look] of looks) {
	const sheet = sheetOfCharacterClips(look);
	const pool = [...set.lookedForClipIds(look)];
	const random = seeded(pool.length + 3);
	const sets: string[][] = [[], pool, ...pool.map((id) => [id])];
	for (let n = 0; n < 40; n++) {
		const share = random();
		sets.push(pool.filter(() => random() < share));
	}
	for (const marked of set.hasMarkedClips(look) ? [false, true] : [false])
		for (const ids of sets) {
			const block = set.characterGrid(look, ids, marked);
			const asSheet = set.characterGrid(sheet, ids, marked);
			const picked = (grid: typeof block, states: string[]) => ({
				drawn: grid.drawn,
				mirrored: grid.mirrored,
				rows: states.map((state) => {
					const row = grid.rows.find((r) => r.state === state);
					return row && { state, loop: row.loop, once: row.once, cells: row.cells };
				}),
			});
			const states = block.rows.map((r) => r.state);
			converted += block.rows.length * (block.drawn.length + block.mirrored.length);
			if (JSON.stringify(picked(block, states)) !== JSON.stringify(picked(asSheet, states)))
				convertedDiffer += 1;
		}
	eq(
		`a block read as a sheet names the same clips and looks for the same ones (${look.prefixes.base})`,
		[
			set
				.characterClipNames(sheet)
				.filter((n) => set.characterStates(look).some((s) => s.state === n.state)),
			[...set.lookedForClipIds(sheet)].sort(),
		],
		[set.characterClipNames(look), [...set.lookedForClipIds(look)].sort()],
	);
	eq(
		`…and the rows the sheet adds are only the states that stand in (${look.prefixes.base})`,
		set
			.characterStates(sheet)
			.filter((s) => !set.characterStates(look).some((b) => b.state === s.state))
			.map((s) => [s.loop, s.once, s.plays]),
		set
			.characterStates(sheet)
			.filter((s) => !set.characterStates(look).some((b) => b.state === s.state))
			.map(() => [false, false, []]),
	);
}
eq(
	'a block read as a sheet (sheetOfCharacterClips) gives the block’s own grid, cell for cell',
	convertedDiffer,
	0,
);
console.log(`  (${converted} cells of a block compared with the same block read as a sheet)`);

// The rows are the sheet's actions, in its order; an added action is a row of empty cells.
const knightSide: CharacterSheet = { ...knightSheet, view: { kind: 'side' } };
eq(
	'a sheet’s rows are its actions in its order, each with its name and what starts it',
	set.characterStates(knightSide),
	[
		{ state: 'idle', name: 'Stand', loop: true, once: false, plays: ['still'] },
		{ state: 'run', loop: true, once: false, plays: ['moving'] },
		{ state: 'slash', loop: false, once: true, plays: ['ability 1'] },
		{ state: 'grab', loop: false, once: true, plays: ['caught'] },
		{ state: 'rest', loop: false, once: false, plays: [] },
	],
);
const knightHeld: CharacterSheet = {
	...knightSide,
	actions: [
		...(knightSide.actions ?? []).slice(0, 2),
		{ id: 'grab', when: { event: 'caught', as: 'target' }, play: 'hold' },
		{ id: 'dazed', when: { status: 'stunned' }, play: 'hold' },
	],
};
eq(
	'a held action is a row that holds: an event’s plays once first, a status’s does not loop',
	set.characterStates(knightHeld).slice(2),
	[
		{ state: 'grab', loop: false, once: true, hold: true, plays: ['caught (to it)'] },
		{ state: 'dazed', loop: false, once: false, hold: true, plays: ['while stunned'] },
	],
);
eq(
	'a held action’s clip saved as a loop is flagged, as a one-shot’s is',
	set.characterProblems(knightHeld, [
		clip('knight_dazed_e', { loop: true }),
		clip('knight_grab_e', { loop: false }),
	]),
	[{ kind: 'savedAsLoop', clipId: 'knight_dazed_e', state: 'dazed' }],
);
const bearClips = set.characterClipNames(bear).map((n) => n.id);
const roaring: CharacterSheet = {
	...bearSheet,
	actions: [...(bearSheet.actions ?? []), { id: 'roar', when: { ability: 'ability2' } }],
};
const roarGrid = set.characterGrid(roaring, bearClips);
const roarRow = roarGrid.rows[roarGrid.rows.length - 1];
eq(
	'an action added on the sheet is a row of empty cells, each with the name its clip is made under',
	[
		roarGrid.rows.length - set.characterGrid(bearSheet, bearClips).rows.length,
		roarRow.state,
		roarRow.once,
		roarRow.cells.map((c) => [c.name, c.status.kind]),
	],
	[
		1,
		'roar',
		true,
		['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].map((f) => [`bear_roar_${f}`, 'none']),
	],
);
eq(
	'…the rest of the grid is as it was',
	roarGrid.rows.slice(0, -1),
	set.characterGrid(bearSheet, bearClips).rows,
);
eq(
	'…its names are names of the character: five to draw, three the game mirrors',
	set
		.characterClipNames(roaring)
		.filter((n) => n.state === 'roar')
		.map((n) => [n.id, n.drawn]),
	[
		['bear_roar_n', true],
		['bear_roar_ne', true],
		['bear_roar_e', true],
		['bear_roar_se', true],
		['bear_roar_s', true],
		['bear_roar_sw', false],
		['bear_roar_w', false],
		['bear_roar_nw', false],
	],
);
const roarRun = {
	stem: 'bear_roar_e',
	primary: 'k/bear.json',
	frames: ['bear_roar_e_00', 'bear_roar_e_01'],
	sheets: ['k/bear.json'],
};
const roarPlan = set.planCharacterClips(roaring, [roarRun], bearClips);
eq(
	'…a run named after it makes its clip (Make clips from a sheet), played once',
	[
		roarPlan.rows.map((r) => [r.name, r.state, r.facing, r.match, r.action]),
		set.defaultStateSettings(roaring).roar,
		set.planCharacterClips(bearSheet, [roarRun], bearClips).rows.length,
	],
	[[['bear_roar_e', 'roar', 'e', 'exact', 'create']], { fps: 24, loop: false }, 0],
);
eq(
	'…a misnamed clip can be copied under its name (the nearest valid name)',
	set
		.strayClips(roaring, [...bearClips, 'bear_roar_east'])
		.map((s) => [s.id, s.kind, s.nearest, s.why]),
	[['bear_roar_east', 'misnamed', 'bear_roar_e', 'facing']],
);
const roarMade = set.characterGrid(roaring, [...bearClips, 'bear_roar_e']);
eq(
	'…and once its clip is saved the cell is made, its twin mirrored and the rest stood in for',
	roarMade.rows[roarMade.rows.length - 1].cells.map((c) => [c.facing, c.status.kind]),
	[
		['n', 'standIn'],
		['ne', 'standIn'],
		['e', 'made'],
		['se', 'standIn'],
		['s', 'standIn'],
		['sw', 'standIn'],
		['w', 'mirrored'],
		['nw', 'standIn'],
	],
);

// A cell the sheet names, and the variants.
const sideGrid = set.characterGrid(knightSide, ['knight_grab_side']);
eq(
	'a cell whose clip the sheet names shows the named clip, and its twin mirrors it',
	sideGrid.rows[3].cells.map((c) => [c.facing, c.name, c.named, c.status]),
	[
		['e', 'knight_grab_side', true, { kind: 'made' }],
		['w', 'knight_grab_w', undefined, { kind: 'mirrored', clipId: 'knight_grab_side' }],
	],
);
eq(
	'…a named clip is a name of the character, looked for and never a stray',
	[
		set.characterClipNames(knightSide).some((n) => n.id === 'knight_grab_side'),
		set.lookedForClipIds(knightSide).has('knight_grab_side'),
		set.lookedForClipIds(knightSide).has('knight_grab_e'),
		set.strayClips(knightSide, ['knight_grab_side', 'knight_grab_e']).map((s) => s.id),
	],
	[true, true, false, ['knight_grab_e']],
);
eq(
	'a sheet’s variants are each a set of its own, by status',
	[
		set.characterVariants(knightSide),
		set.characterPrefixes(knightSide),
		set.hasMarkedClips(knightSide),
		set.characterGrid(knightSide, [], 'stunned').rows[0].cells.map((c) => c.name),
		set.characterGrid(knightSide, ['knight_idle_e'], 'stunned').rows[0].cells.map((c) => c.status),
		set.characterGrid(knightSide, [], true).rows[0].cells[0].name,
	],
	[
		[
			{ status: 'marked', prefix: 'knight_gold' },
			{ status: 'stunned', prefix: 'knight_dizzy' },
		],
		['knight', 'knight_gold', 'knight_dizzy'],
		true,
		['knight_dizzy_idle_e', 'knight_dizzy_idle_w'],
		[
			{ kind: 'standIn', clipId: 'knight_idle_e', flipX: false, state: 'idle', marked: false },
			{ kind: 'standIn', clipId: 'knight_idle_e', flipX: true, state: 'idle', marked: false },
		],
		'knight_gold_idle_e',
	],
);
eq(
	'…a variant’s clips are the character’s (under its prefix), with their own tails',
	[
		set.underCharacterPrefix(knightSide, 'knight_dizzy_idle_e'),
		set.clipTail(knightSide, 'knight_dizzy_idle_e'),
		set.clipTail(knightSide, 'knight_idle_e'),
		set.clipTail(bear, 'bear_walk_e'),
	],
	[true, 'idle_e', 'idle_e', 'walk_e'],
);
eq(
	'a sheet is drawn its own width, its feet where it says',
	[set.characterDraw(knightSide), set.feetOf(knightSide, { x: -50, y: -100, w: 100, h: 200 })],
	[
		{ width: 64, anchorY: 0.9 },
		{ x: 0, y: 80 },
	],
);
{
	const { draw: _d, ...draft } = knightSide;
	eq(
		'a sheet still without a draw width reads as it will play (the page that edits it)',
		[
			sheetPlaysClips(draft),
			set.characterGrid(draft, ['knight_idle_e']).rows[0].cells.map((c) => [c.name, c.status.kind]),
			set.characterGrid({ ...draft, actions: [] }, []).rows,
		],
		[
			false,
			[
				['knight_idle_e', 'made'],
				['knight_idle_w', 'mirrored'],
			],
			[],
		],
	);
}
eq(
	'a saved Mirror X is a problem only where the view mirrors',
	[
		set
			.characterProblems(knightSide, [{ id: 'knight_idle_e', flipX: true, loop: true }])
			.map((p) => p.kind),
		set
			.characterProblems({ ...knightSide, view: { kind: 'side', mirror: false } }, [
				{ id: 'knight_idle_e', flipX: true, loop: true },
			])
			.map((p) => p.kind),
	],
	[['noBounds', 'mirrorX'], ['noBounds']],
);
eq(
	'the compass holds only the rows and columns a view has facings in',
	[
		set.compassAreas(['ne', 'se', 'sw', 'nw']),
		set.compassAreas([...CLIP_FACINGS]),
		set.compassAreas(['e', 'w']),
		set.compassAreas(['n', 'e', 's', 'w']),
	],
	[
		'"f-nw f-ne" "f-sw f-se"',
		'"f-nw f-n f-ne" "f-w mid f-e" "f-sw f-s f-se"',
		'"f-w f-e"',
		'". f-n ." "f-w mid f-e" ". f-s ."',
	],
);
eq('a cell’s key is its state and its facing', set.cellKey(sideGrid.rows[3].cells[1]), 'grab|w');

// A name no saved clip can have.
const shouting: CharacterSheet = {
	...knightSide,
	source: {
		kind: 'clips',
		prefix: 'Knight',
		variants: { marked: 'knight_Gold', stunned: 'knight_dizzy' },
	},
	actions: [
		{ id: 'idle', when: { motion: 'still' } },
		{ id: 'Roar', when: { ability: 'ability2' } },
		{
			id: 'grab',
			when: { event: 'caught' },
			anim: { e: { clip: 'Knight_Grab' }, w: { clip: 'knight-grab' } },
		},
	],
};
eq(
	'a prefix, a variant prefix, an action or a named clip with a capital letter is flagged',
	set.nameProblems(shouting),
	[
		{ what: 'prefix', value: 'Knight', capital: true, stored: 'knight' },
		{ what: 'variant', value: 'knight_Gold', capital: true, stored: 'knight_gold' },
		{ what: 'action', value: 'Roar', capital: true, stored: 'roar' },
		{ what: 'clip', value: 'Knight_Grab', capital: true, stored: 'knight_grab' },
		{ what: 'clip', value: 'knight-grab', capital: false, stored: 'knight_grab' },
	],
);
eq(
	'…because the name the game asks for is then one the save never stores (r2Slug)',
	set
		.characterClipNames(shouting)
		.filter((n) => r2Slug(n.id) !== n.id)
		.map((n) => n.id)
		.sort(),
	[
		'Knight_Grab',
		'Knight_Roar_e',
		'Knight_Roar_w',
		'Knight_idle_e',
		'Knight_idle_w',
		'knight-grab',
		'knight_Gold_Roar_e',
		'knight_Gold_Roar_w',
		'knight_Gold_grab_e',
		'knight_Gold_grab_w',
		'knight_Gold_idle_e',
		'knight_Gold_idle_w',
		'knight_dizzy_Roar_e',
		'knight_dizzy_Roar_w',
	],
);
eq(
	'…said in words that name the part and what to write',
	set.nameProblemText(set.nameProblems(shouting)[0]),
	'The prefix "Knight" has a capital letter. A clip is saved under a lower-case id (a-z, 0-9 and _), so no clip can match it and the game finds none. Write it "knight".',
);
eq(
	'a sheet and a block written as a clip’s id is have none; a block’s prefix is checked too',
	[
		set.nameProblems(knightSide),
		set.nameProblems(bear),
		set.nameProblems({ ...knight, prefixes: { base: 'Knight' } }).map((p) => [p.what, p.value]),
	],
	[[], [], [['prefix', 'Knight']]],
);
for (const [name, look] of artSheets)
	eq(`${name}: every name it gives is one a clip can be saved under`, set.nameProblems(look), []);

// The component's block is never written for a character that plays a sheet.
{
	const onSheet = byKey(wired, 'bear') as Listed[number];
	eq(
		'a character that plays a sheet cannot have its facings saved into its component',
		[
			onSheet.component?.hasBlock,
			onSheet.component?.scope,
			facingsOf.facingsProblem(onSheet, true),
			facingsOf.facingsProblem(byKey(salmons, 'bear') as Listed[number], true),
		],
		[
			true,
			'project',
			'It plays a character sheet, whose View sets its facings in Invisible Characters. Its component’s clip block is not read.',
			null,
		],
	);
}

// Apply of the one Bounds box writes this character's own clips only (C2b review).
{
	const box: FlipbookBounds = { x: 0, y: 0, w: 100, h: 120 };
	// A knight whose `grab` cell borrows the bear's clip, and whose `slash` borrows a clip under
	// no character's prefix; the bear is another character of the project.
	const borrowing: CharacterSheet = {
		view: { kind: 'side' },
		source: { kind: 'clips', prefix: 'knight', variants: { marked: 'knight_gold' } },
		draw: { width: 64 },
		actions: [
			{ id: 'idle', when: { motion: 'still' } },
			{ id: 'grab', when: { event: 'caught' }, anim: { e: { clip: 'bear_swipe_se' } } },
			{ id: 'slash', when: { ability: 'ability1' }, anim: { e: { clip: 'fx_slash' } } },
		],
	};
	const clips = [
		{ id: 'knight_idle_e' },
		{ id: 'knight_gold_idle_e', bounds: { ...box, w: 90 } },
		{ id: 'knight_grab_e', bounds: box },
		{ id: 'bear_swipe_se', bounds: { ...box, w: 300 } },
		{ id: 'fx_slash' },
		{ id: 'bear_idle_se' },
	];
	const plan = set.boundsPlan(borrowing, clips, [bear], box);
	eq(
		'the game plays a clip a cell borrows, so it is read with the character’s clips…',
		plan.played.map((c) => c.id),
		['knight_idle_e', 'knight_gold_idle_e', 'bear_swipe_se', 'fx_slash'],
	);
	eq(
		'…but Apply writes only clips under its own prefixes (base and variants) that need the box',
		plan.toBox.map((c) => c.id),
		['knight_idle_e', 'knight_gold_idle_e'],
	);
	eq(
		'…and leaves out another character’s clip and one under no prefix of its own',
		plan.leftOut.map((c) => c.id),
		['bear_swipe_se', 'fx_slash'],
	);
	eq(
		'…saying how many were left out and why',
		[set.leftOutText(plan.leftOut), set.leftOutText(plan.leftOut.slice(0, 1)), set.leftOutText([])],
		[
			"2 clips this character plays are left out (bear_swipe_se, fx_slash): a cell of its sheet names them, and they are not under this character's prefix, so they may be another character's. Set their box in Clips or on the character they belong to.",
			"1 clip this character plays is left out (bear_swipe_se): a cell of its sheet names it, and it is not under this character's prefix, so it may be another character's. Set its box in Clips or on the character it belongs to.",
			'',
		],
	);
	// A character whose prefix starts with this one's: its clip is its own, even named in a cell.
	const cub: CharacterSheet = {
		...borrowing,
		source: { kind: 'clips', prefix: 'knight_squire' },
		actions: [{ id: 'idle', when: { motion: 'still' } }],
	};
	const sharing: CharacterSheet = {
		...borrowing,
		actions: [
			{ id: 'idle', when: { motion: 'still' } },
			{ id: 'grab', anim: { e: { clip: 'knight_squire_idle_e' } } },
		],
	};
	eq(
		'a clip under a longer prefix of another character is that character’s, not this one’s',
		[
			set
				.boundsPlan(sharing, [{ id: 'knight_idle_e' }, { id: 'knight_squire_idle_e' }], [cub], box)
				.toBox.map((c) => c.id),
			set
				.boundsPlan(cub, [{ id: 'knight_idle_e' }, { id: 'knight_squire_idle_e' }], [sharing], box)
				.toBox.map((c) => c.id),
		],
		[['knight_idle_e'], ['knight_squire_idle_e']],
	);
	eq(
		'a block names no cell: every clip it plays is its own, and none is left out',
		[
			set.boundsPlan(bear, [{ id: 'bear_idle_se' }, { id: 'knight_idle_e' }], [borrowing], box)
				.toBox.length,
			set.boundsPlan(bear, [{ id: 'bear_idle_se' }], [borrowing], box).leftOut,
			set.boundsPlan(bear, [{ id: 'bear_idle_se' }], [], undefined).toBox,
		],
		[1, [], []],
	);
	const panel = readFileSync(
		fileURLToPath(new URL('../src/routes/(app)/flipbook/CharacterPanel.svelte', import.meta.url)),
		'utf8',
	);
	eq(
		'the panel applies that plan’s clips and shows what was left out (source text)',
		[
			/const boxPlan = \$derived\(boundsPlan\(look, clips, others, box\)\)/.test(panel),
			/const toBox = \$derived\(boxPlan\.toBox\)/.test(panel),
			/data-bounds-left-out>\{leftOut\}/.test(panel),
			/played\.filter\(/.test(panel),
		],
		[true, true, true, false],
	);
}

// One answer for a clip name, with Invisible Characters (C2b review).
{
	const sheetCheck = await import('../src/lib/characters/characterSheetCheck.ts');
	const long = (prefix: string, action: string): CharacterSheet => ({
		view: { kind: 'side' },
		source: { kind: 'clips', prefix },
		draw: { width: 10 },
		actions: [{ id: action, when: { motion: 'still' } }],
	});
	const fits = long('p'.repeat(30), 'a'.repeat(26));
	const over = long('p'.repeat(30), 'a'.repeat(27));
	eq(
		'a composed <prefix>_<action>_<facing> of 60 fits, of 61 is flagged, by one rule',
		[
			set.clipNameTooLong(['p'.repeat(30)], 'a'.repeat(26)),
			set.clipNameTooLong(['p'.repeat(30)], 'a'.repeat(27)),
			set.clipNameTooLong(['p', 'p'.repeat(30)], 'a'.repeat(27)),
			set.CLIP_ID_MAX,
		],
		[false, true, true, 60],
	);
	eq(
		'Flipbook flags the composed name too long, in words',
		[set.nameProblems(fits), set.nameProblems(over).map(set.nameProblemText)],
		[
			[],
			[
				`A clip id holds 60 characters, and "${'p'.repeat(30)}_${'a'.repeat(27)}_<facing>" is longer, so no clip matches it. Shorten the prefix or the action.`,
			],
		],
	);
	eq(
		'…exactly where Invisible Characters warns of it',
		[fits, over].map((sheet) => [
			set.nameProblems(sheet).filter((p) => p.what === 'name').length,
			sheetCheck.sheetWarnings(sheet).filter((w) => w.message.startsWith('A clip id holds')).length,
		]),
		[
			[0, 0],
			[1, 1],
		],
	);
	const named: CharacterSheet = {
		...over,
		actions: [{ id: 'a'.repeat(27), anim: { e: { clip: 'x_e' }, w: { clip: 'x_w' } } }],
	};
	eq(
		'an action whose every facing names its clip is not found by name: neither tool flags its length',
		[set.nameProblems(named), sheetCheck.sheetWarnings(named)],
		[[], []],
	);
	eq(
		'a part is valid for both tools by the same test (isClipId), 60 characters at most',
		['bear', 'Bear', 'a-b', 'x'.repeat(60), 'x'.repeat(61)].map((name) => [
			set.isClipId(name),
			set.clipIdOf(name) === name,
		]),
		[
			[true, true],
			[false, false],
			[false, false],
			[true, true],
			[false, false],
		],
	);
	eq(
		'one wording for a trigger, in Flipbook’s rows and Invisible Characters’ triggers',
		[
			{ motion: 'moving' } as const,
			{ ability: 'ability2' } as const,
			{ event: 'caught', as: 'target' } as const,
			{ status: 'holding' },
		].map(set.triggerText),
		['moving', 'ability 2', 'caught (to it)', 'while holding'],
	);
}

// A rig, still images, and cells that are not clips (character pipeline C6a).
{
	const STILL = { assetKey: 'c/p/manifests/atlas_manifest_crate.json', region: 'crate' };
	const STILL_ID = `still::${STILL.assetKey}::crate`;
	const rigSheet = {
		source: { kind: 'rig', rig: 'bearRig', rigs: { ne: 'bearBack' } },
		draw: { width: 64 },
		actions: [
			{ id: 'idle', when: { motion: 'still' } },
			{ id: 'swipe', when: { ability: 'ability1' }, anim: { se: { anim: 'claw' } } },
		],
	};
	const stillsSheet = {
		source: { kind: 'stills' },
		draw: { width: 48 },
		actions: [{ id: 'idle', when: { motion: 'still' }, anim: { se: { still: STILL } } }],
	};
	const cellsSheet: CharacterSheet = {
		source: { kind: 'clips', prefix: 'bear' },
		draw: { width: 50 },
		actions: [
			{
				id: 'idle',
				when: { motion: 'still' },
				anim: { ne: { anim: 'look', rig: 'bearRig' }, se: { still: STILL } },
			},
			{ id: 'walk', when: { motion: 'moving' } },
		],
	};
	for (const [name, held, kind] of [
		['a rig', rigSheet, 'rig'],
		['still images', stillsSheet, 'stills'],
	] as const) {
		const cfg = bearOnSheet(held);
		eq(
			`a class whose sheet is ${name} is not listed: not from the sheet, its component’s block or the game’s table`,
			[
				projectCharacters(defs, cfg).map((c) => c.key),
				projectCharacters(blockless, cfg).map((c) => c.key),
				projectCharacters(defs, cfg).some((c) => c.sheetProblem),
			],
			[['salmon', 'fisherman'], ['salmon', 'fisherman'], false],
		);
		eq(
			`…it is named as left out, with its kind`,
			notClipCharacters(cfg).map(({ key, sheetId, kind: as, played }) => [
				key,
				sheetId,
				as,
				played,
			]),
			[['bear', 'bearBot', kind, true]],
		);
		const unwired = edited((cfg) => void Object.assign(characterOf(cfg, 'bearBot') ?? {}, held));
		eq(
			`a character with a sheet of ${name} no class names is not listed as one missing its clips`,
			[
				projectCharacters(defs, unwired).map((c) => [c.key, c.source]),
				notClipCharacters(unwired).map(({ key, kind: as, played }) => [key, as, played]),
			],
			[
				[
					['salmon', 'component'],
					['bear', 'component'],
					['fisherman', 'component'],
				],
				[['bearBot', kind, false]],
			],
		);
	}
	const { draw: _draw, ...rigNoWidth } = rigSheet;
	eq(
		'a rig sheet with no draw width is not in force: the class is listed from its block, with the reason, and the sheet is not',
		projectCharacters(defs, bearOnSheet(rigNoWidth)).map((c) => [c.key, c.source, c.sheetProblem]),
		[
			['salmon', 'component', undefined],
			[
				'bear',
				'component',
				'The class "bear" names the sheet of "bearBot", which is not played: its draw box has no width.',
			],
			['fisherman', 'component', undefined],
		],
	);
	eq(
		'no config with clips sheets alone leaves a character out',
		[notClipCharacters(bearOnSheet()), notClipCharacters(reference), notClipCharacters(null)],
		[[], [], []],
	);

	// Frame clips with a still image in one cell and a rig's animation in another.
	const listed = byKey(projectCharacters(defs, bearOnSheet(cellsSheet)), 'bear');
	eq(
		'clips with such cells are listed, from the sheet',
		[listed?.source, listed?.sheetId],
		['sheet', 'bearBot'],
	);
	const have = ['bear_walk_se', 'bear_idle_ne'];
	const grid = set.characterGrid(cellsSheet, have);
	const idle = grid.rows[0].cells;
	eq(
		'the still cell is the image it holds, drawn; its twin mirrors it; neither is a missing clip',
		[idle[1], idle[2]],
		[
			{
				name: STILL_ID,
				state: 'idle',
				facing: 'se',
				drawn: true,
				holds: { kind: 'still', text: `crate (${STILL.assetKey})`, clipId: STILL_ID },
				status: { kind: 'made' },
			},
			{
				name: 'bear_idle_sw',
				state: 'idle',
				facing: 'sw',
				drawn: false,
				status: { kind: 'mirrored', clipId: STILL_ID },
			},
		],
	);
	eq(
		'the rig cell says what it holds, and draws what the game finds there by name',
		[idle[0], set.characterGrid(cellsSheet, ['bear_walk_se']).rows[0].cells[0].status],
		[
			{
				name: 'bear_idle_ne',
				state: 'idle',
				facing: 'ne',
				drawn: true,
				holds: { kind: 'rig', text: 'look (bearRig)' },
				status: { kind: 'made' },
			},
			{ kind: 'standIn', clipId: STILL_ID, flipX: false, state: 'idle', marked: false },
		],
	);
	eq(
		'neither cell is a clip to make: not counted as needed, and not a name of the character',
		[
			set.gridCounts(set.characterGrid(cellsSheet, [])),
			set.characterClipNames(cellsSheet).map((n) => n.id),
			set.clipTail(cellsSheet, STILL_ID),
		],
		[
			{ made: 0, needed: 2, empty: 4 },
			[
				'bear_idle_sw',
				'bear_idle_nw',
				'bear_walk_ne',
				'bear_walk_se',
				'bear_walk_sw',
				'bear_walk_nw',
			],
			'crate',
		],
	);
	const run = (stem: string) => ({
		stem,
		primary: 'k/bear.json',
		frames: [`${stem}_00`, `${stem}_01`],
		sheets: ['k/bear.json'],
	});
	const cellsPlan = set.planCharacterClips(
		cellsSheet,
		[run('bear_idle_ne'), run('bear_idle_se'), run('bear_walk_ne')],
		[],
	);
	eq(
		'Make clips skips them: a run named for either cell makes no clip, one named for another cell does',
		[
			cellsPlan.rows.map((r) => [r.name, r.match, r.action]),
			cellsPlan.unmatched.map((r) => r.stem),
		],
		[[['bear_walk_ne', 'exact', 'create']], ['bear_idle_ne', 'bear_idle_se']],
	);
	const bounds = set.boundsPlan(
		cellsSheet,
		[{ id: 'bear_walk_se' }, { id: STILL_ID }, { id: 'bear_idle_se' }],
		[],
		box,
	);
	eq(
		'Apply writes the box to the clips it plays only: a still image is no clip, and its cell’s name is not played',
		[
			bounds.toBox.map((c) => c.id),
			bounds.leftOut,
			[...set.lookedForClipIds(cellsSheet)].some(set.isStillId),
			set.lookedForClipIds(cellsSheet).has('bear_idle_se'),
		],
		[['bear_walk_se'], [], false, false],
	);
	eq(
		'such cells are no name problem, and a still-images sheet has no grid of missing clips',
		[
			set.nameProblems(cellsSheet),
			set.gridCounts(set.characterGrid(stillsSheet as CharacterSheet, [])),
			set.characterClipNames(stillsSheet as CharacterSheet),
			set.characterClipNames(rigSheet as CharacterSheet),
		],
		[[], { made: 0, needed: 1, empty: 0 }, [], []],
	);
}

console.log(
	`\n${failures === 0 ? '✅' : '❌'} flipbook characters: ${passes} passed, ${failures} failed`,
);
process.exit(failures ? 1 : 0);
