/**
 * A CHARACTER'S CLIP SET, as Invisible Flipbook's Characters mode shows it: which clips an arcade
 * character needs, which are there, what the game would draw for a missing one, which clips are
 * misnamed, what breaks the character in game, and which clips a sheet's runs would make.
 *
 * The game's rule is `engine-layout` `characterClips.ts`, and nothing of it is restated here. A
 * name is whatever {@link resolveCharacterClip} ASKS for: its first question for a state and a
 * facing is the clip's own name, and the questions that follow are its stand-ins in the game's
 * order. So the grid, the list of valid names and the stand-in of a missing cell are read off the
 * resolver itself, and a change to the naming or to the stand-in order there moves this panel
 * with it.
 *
 * Pure and Svelte-free: `scripts/check-flipbook-characters.ts` runs it in Node.
 */
import {
	DEFAULT_FLIPBOOK_FPS,
	detectSequencesAcross,
	type DetectedSequenceAcross,
	type FlipbookBounds,
	type FlipbookClip,
	type SheetRegions,
} from 'engine-flipbook';
import {
	CHARACTER_CLIP_EVENTS,
	CLIP_FACINGS,
	CLIP_MIRROR,
	characterClipPrefixes,
	clipMirrorOf,
	resolveCharacterClip,
	type CharacterClips,
	type ClipFacing,
} from 'engine-layout';

/**
 * A clip's id as the save makes it from a name (`$lib/server/projectPaths` `r2Slug`, which a
 * client module cannot import; the gate holds the two equal).
 */
export const clipIdOf = (name: string): string =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '_')
		.slice(0, 60) || 'default';

/** {@link clipIdOf} with runs of `_` folded and the ends trimmed: what two spellings of one name
 *  share. */
const folded = (name: string): string => clipIdOf(name).replace(/_+/g, '_').replace(/^_|_$/g, '');

const at = (facing: ClipFacing): number => CLIP_FACINGS.indexOf(facing);

/**
 * The facings a look plays, apart: the ones it is `drawn` in and the ones the game `mirrored`s
 * from a drawn twin. Of a mirror pair the eastern one is drawn, as the game's own tie-break has
 * it; `n` and `s` have no twin. Eight for a look with `facings: 8`, else the four diagonals.
 */
export function characterFacings(look: CharacterClips): {
	drawn: ClipFacing[];
	mirrored: ClipFacing[];
} {
	const all = look.facings === 8 ? [...CLIP_FACINGS] : CLIP_FACINGS.filter((f) => f in CLIP_MIRROR);
	const isMirrored = (facing: ClipFacing): boolean => {
		const twin = clipMirrorOf(facing);
		return twin !== undefined && at(twin) < at(facing);
	};
	return { drawn: all.filter((f) => !isMirrored(f)), mirrored: all.filter(isMirrored) };
}

/** A state a look names, and what plays it. */
export interface CharacterState {
	state: string;
	/** Played as a loop (the look's `idle`, `walk` or `holding`). */
	loop: boolean;
	/** Played once, on a room event (the look's `on`). */
	once: boolean;
	/** `idle` / `walk` / `holding`, or the room events. */
	plays: string[];
}

/** The states a look names, loops first, each once. */
export function characterStates(look: CharacterClips): CharacterState[] {
	const out = new Map<string, CharacterState>();
	const add = (state: string | undefined, role: string, loop: boolean): void => {
		if (!state) return;
		const known = out.get(state);
		if (!known) {
			out.set(state, { state, loop, once: !loop, plays: [role] });
			return;
		}
		known.plays.push(role);
		if (loop) known.loop = true;
		else known.once = true;
	};
	add(look.idle, 'idle', true);
	add(look.walk, 'walk', true);
	add(look.holding, 'holding', true);
	for (const event of CHARACTER_CLIP_EVENTS) add(look.on?.[event], event, false);
	return [...out.values()];
}

/** Every clip id the game asks for while it resolves `state` facing `facing`, in its order. */
export function characterClipCandidates(
	look: CharacterClips,
	state: string,
	facing: ClipFacing,
	marked = false,
): string[] {
	const asked: string[] = [];
	resolveCharacterClip(look, state, facing, marked, (clipId) => {
		asked.push(clipId);
		return false;
	});
	return asked;
}

/** The name the game looks for first for a state and a facing: the clip's own. */
export const characterClipName = (
	look: CharacterClips,
	state: string,
	facing: ClipFacing,
	marked = false,
): string => characterClipCandidates(look, state, facing, marked)[0];

/** Whether a look has clips of its own for a marked player (the golden salmon). */
export const hasMarkedClips = (look: CharacterClips): boolean => !!look.prefixes.marked;

/** A name a character's clip can have, and what it is the clip of. */
export interface CharacterClipName {
	id: string;
	state: string;
	facing: ClipFacing;
	/** Under the marked prefix. */
	marked: boolean;
	/** In a drawn facing: one the author makes, not one the game mirrors. */
	drawn: boolean;
}

/** Every name a look's states and facings give, the base prefix's first. */
export function characterClipNames(look: CharacterClips): CharacterClipName[] {
	const { drawn, mirrored } = characterFacings(look);
	const out = new Map<string, CharacterClipName>();
	for (const marked of hasMarkedClips(look) ? [false, true] : [false])
		for (const { state } of characterStates(look))
			for (const facing of [...drawn, ...mirrored]) {
				const id = characterClipName(look, state, facing, marked);
				if (!out.has(id)) out.set(id, { id, state, facing, marked, drawn: drawn.includes(facing) });
			}
	return [...out.values()];
}

/**
 * Every clip id the game can ask for on this character's behalf: its names, and the names of the
 * states it falls back to (a salmon with no `swim` clip is asked for `idle`). A clip under the
 * character's prefix that is not one of these is never played.
 */
export function lookedForClipIds(look: CharacterClips): Set<string> {
	const { drawn, mirrored } = characterFacings(look);
	const out = new Set<string>();
	for (const marked of hasMarkedClips(look) ? [false, true] : [false])
		for (const { state } of characterStates(look))
			for (const facing of [...drawn, ...mirrored])
				for (const id of characterClipCandidates(look, state, facing, marked)) out.add(id);
	return out;
}

/** Whether a clip id sits under one of a look's prefixes, whatever its case or separators. */
export function underCharacterPrefix(look: CharacterClips, clipId: string): boolean {
	const id = clipIdOf(clipId);
	return characterClipPrefixes(look).some((prefix) => id.startsWith(`${clipIdOf(prefix)}_`));
}

/** What the game draws for one state and facing. */
export type CellStatus =
	/** Its own clip, as made. */
	| { kind: 'made' }
	/** No clip of its own: its mirror twin's, drawn mirrored. */
	| { kind: 'mirrored'; clipId: string }
	/** Another facing's, another state's or (for a marked player) the base prefix's clip. */
	| { kind: 'standIn'; clipId: string; flipX: boolean; state: string; marked: boolean }
	/** Nothing: the component's own tree is drawn. */
	| { kind: 'none' };

export interface GridCell {
	/** The name the game looks for first. */
	name: string;
	state: string;
	facing: ClipFacing;
	drawn: boolean;
	status: CellStatus;
}

export interface CharacterGrid {
	drawn: ClipFacing[];
	mirrored: ClipFacing[];
	/** States down; each row's cells follow `drawn` then `mirrored`. */
	rows: (CharacterState & { cells: GridCell[] })[];
}

/**
 * The grid of a character: per state and facing, the clip the game draws out of `clipIds` (the
 * project's), by {@link resolveCharacterClip}. `marked` is the grid of a marked player. A
 * character of eight facings breaks a tie between two stand-ins as near by the facing it was last
 * seen in; the grid shows the game's choice with no facing seen yet.
 */
export function characterGrid(
	look: CharacterClips,
	clipIds: Iterable<string>,
	marked = false,
): CharacterGrid {
	const have = new Set(clipIds);
	const has = (clipId: string): boolean => have.has(clipId);
	const { drawn, mirrored } = characterFacings(look);
	const cell = (state: string, facing: ClipFacing): GridCell => {
		const name = characterClipName(look, state, facing, marked);
		const base = { name, state, facing, drawn: drawn.includes(facing) };
		const found = resolveCharacterClip(look, state, facing, marked, has);
		if (!found) return { ...base, status: { kind: 'none' } };
		if (found.clipId === name) return { ...base, status: { kind: 'made' } };
		const twin = clipMirrorOf(facing);
		if (twin && found.flipX && found.clipId === characterClipName(look, state, twin, marked))
			return { ...base, status: { kind: 'mirrored', clipId: found.clipId } };
		const { clipId, flipX, state: plays, marked: own } = found;
		return { ...base, status: { kind: 'standIn', clipId, flipX, state: plays, marked: own } };
	};
	return {
		drawn,
		mirrored,
		rows: characterStates(look).map((row) => ({
			...row,
			cells: [...drawn, ...mirrored].map((facing) => cell(row.state, facing)),
		})),
	};
}

/** The clip a cell draws and whether the game mirrors it, or `undefined` when nothing plays. */
export function cellPlays({
	name,
	status,
}: GridCell): { clipId: string; flipX: boolean } | undefined {
	if (status.kind === 'none') return undefined;
	if (status.kind === 'made') return { clipId: name, flipX: false };
	if (status.kind === 'mirrored') return { clipId: status.clipId, flipX: true };
	return { clipId: status.clipId, flipX: status.flipX };
}

/** How many of a grid's drawn cells have their own clip, and how many cells draw nothing. */
export function gridCounts(grid: CharacterGrid): { made: number; needed: number; empty: number } {
	const cells = grid.rows.flatMap((row) => row.cells);
	const needed = cells.filter((c) => c.drawn);
	return {
		made: needed.filter((c) => c.status.kind === 'made').length,
		needed: needed.length,
		empty: cells.filter((c) => c.status.kind === 'none').length,
	};
}

/** How a misspelt name differs from the valid one nearest it. */
export type NearWhy =
	/** Only its case or its separators differ. */
	| 'spelling'
	/** The valid name, with something after it. */
	| 'suffix'
	/** Its facing is a compass word (`east` for `e`). */
	| 'facing'
	/** One or two letters off. */
	| 'typo'
	/** Nothing close: only the least far. */
	| 'guess';

const COMPASS: readonly [string, ClipFacing][] = [
	['north_east', 'ne'],
	['north_west', 'nw'],
	['south_east', 'se'],
	['south_west', 'sw'],
	['northeast', 'ne'],
	['northwest', 'nw'],
	['southeast', 'se'],
	['southwest', 'sw'],
	['north', 'n'],
	['east', 'e'],
	['south', 's'],
	['west', 'w'],
];

function editDistance(a: string, b: string): number {
	let row = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const next = [i];
		for (let j = 1; j <= b.length; j++)
			next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		row = next;
	}
	return row[b.length];
}

/** The most letters a name may be off by and still be read as a typo of a valid one. */
const TYPO_LETTERS = 2;

/** The valid name nearest `name`, and how `name` differs from it; `undefined` with no names. */
export function nearestClipName(
	name: string,
	names: readonly string[],
): { name: string; why: NearWhy } | undefined {
	if (!names.length) return undefined;
	const id = folded(name);
	if (names.includes(id)) return { name: id, why: 'spelling' };
	for (const [word, facing] of COMPASS) {
		if (!id.endsWith(`_${word}`)) continue;
		const spelt = `${id.slice(0, -word.length)}${facing}`;
		if (names.includes(spelt)) return { name: spelt, why: 'facing' };
	}
	const stem = names
		.filter((valid) => id.startsWith(`${valid}_`))
		.sort((a, b) => b.length - a.length)[0];
	if (stem) return { name: stem, why: 'suffix' };
	let best = names[0];
	let least = Infinity;
	for (const valid of names) {
		const distance = editDistance(id, valid);
		if (distance < least) {
			least = distance;
			best = valid;
		}
	}
	return { name: best, why: least <= TYPO_LETTERS ? 'typo' : 'guess' };
}

/** A project clip under a character's prefix that is not one of its names. */
export interface StrayClip {
	id: string;
	/** `misnamed`: the game never asks for it. `standInOnly`: asked for only when another state has
	 *  no clip (a state the look does not name). */
	kind: 'misnamed' | 'standInOnly';
	/** The valid name nearest it (`misnamed` only). */
	nearest?: string;
	why?: NearWhy;
}

/**
 * The project's clips under a character's prefixes that are not its names. A clip another
 * character of the project plays (`others`: one whose prefix starts with this one's) is not this
 * character's stray.
 */
export function strayClips(
	look: CharacterClips,
	clipIds: Iterable<string>,
	others: readonly CharacterClips[] = [],
): StrayClip[] {
	const names = characterClipNames(look).map((n) => n.id);
	const valid = new Set(names);
	const lookedFor = lookedForClipIds(look);
	const theirs = new Set(others.flatMap((other) => [...lookedForClipIds(other)]));
	const out: StrayClip[] = [];
	for (const id of clipIds) {
		if (valid.has(id) || theirs.has(id) || !underCharacterPrefix(look, id)) continue;
		if (lookedFor.has(id)) {
			out.push({ id, kind: 'standInOnly' });
			continue;
		}
		const near = nearestClipName(id, names);
		out.push({ id, kind: 'misnamed', nearest: near?.name, why: near?.why });
	}
	return out.sort((a, b) => a.id.localeCompare(b.id));
}

const BOUNDS_FIELDS = ['x', 'y', 'w', 'h'] as const;
export type BoundsField = (typeof BOUNDS_FIELDS)[number];

/** The fields two boxes differ in. */
export const boundsDiffer = (a: FlipbookBounds, b: FlipbookBounds): BoundsField[] =>
	BOUNDS_FIELDS.filter((field) => a[field] !== b[field]);

/** What the panel reads of a clip. */
export type CharacterClipInfo = Pick<FlipbookClip, 'id' | 'bounds' | 'flipX' | 'loop'>;

export interface CharacterBounds {
	/** The box most of the character's clips carry; `undefined` when none carries one. */
	reference: FlipbookBounds | undefined;
	/** Each distinct box and the clips carrying it, the most used first. */
	boxes: { bounds: FlipbookBounds; clipIds: string[] }[];
	/** The clips with no box. */
	missing: string[];
}

/** The boxes a character's clips carry. `clips` are the ones the game can play for it. */
export function characterBounds(clips: readonly CharacterClipInfo[]): CharacterBounds {
	const boxes: CharacterBounds['boxes'] = [];
	const missing: string[] = [];
	for (const { id, bounds } of clips) {
		if (!bounds) {
			missing.push(id);
			continue;
		}
		const same = boxes.find((box) => boundsDiffer(box.bounds, bounds).length === 0);
		if (same) same.clipIds.push(id);
		else boxes.push({ bounds, clipIds: [id] });
	}
	boxes.sort((a, b) => b.clipIds.length - a.clipIds.length);
	return { reference: boxes[0]?.bounds, boxes, missing };
}

/** Something about a saved clip that draws the character wrongly, or not as the author set it. */
export type ClipProblem =
	/** No Bounds box: the game sizes it by its first frame, so its scale is its own. */
	| { kind: 'noBounds'; clipId: string }
	/** Its box is not the character's: a `w` apart changes its size, an `h` or `y` its feet, an
	 *  `x` its centre. */
	| { kind: 'boundsDiffer'; clipId: string; differs: BoundsField[] }
	/** Saved with Mirror X on a facing the game mirrors: the game's mirroring is turned over. */
	| { kind: 'mirrorX'; clipId: string; facing: ClipFacing }
	/** A state the game plays once, saved as a loop. */
	| { kind: 'savedAsLoop'; clipId: string; state: string }
	/** A state the game loops, saved to play once. */
	| { kind: 'savedAsOnce'; clipId: string; state: string };

/**
 * What is wrong with a character's saved clips. `clips` are the project's; only the ones the game
 * can play for this character are read. `reference` is the character's box ({@link
 * characterBounds}'s unless the author picked another).
 */
export function characterProblems(
	look: CharacterClips,
	clips: readonly CharacterClipInfo[],
	reference?: FlipbookBounds,
): ClipProblem[] {
	const lookedFor = lookedForClipIds(look);
	const played = clips.filter((clip) => lookedFor.has(clip.id));
	const box = reference ?? characterBounds(played).reference;
	const names = new Map(characterClipNames(look).map((n) => [n.id, n]));
	const states = new Map(characterStates(look).map((s) => [s.state, s]));
	const out: ClipProblem[] = [];
	for (const clip of played) {
		if (!clip.bounds) out.push({ kind: 'noBounds', clipId: clip.id });
		else if (box) {
			const differs = boundsDiffer(clip.bounds, box);
			if (differs.length) out.push({ kind: 'boundsDiffer', clipId: clip.id, differs });
		}
		const name = names.get(clip.id);
		if (!name) continue;
		if (clip.flipX === true && clipMirrorOf(name.facing))
			out.push({ kind: 'mirrorX', clipId: clip.id, facing: name.facing });
		const state = states.get(name.state);
		const loops = clip.loop !== false;
		if (state?.once && !state.loop && loops)
			out.push({ kind: 'savedAsLoop', clipId: clip.id, state: name.state });
		if (state?.loop && !state.once && !loops)
			out.push({ kind: 'savedAsOnce', clipId: clip.id, state: name.state });
	}
	return out;
}

/**
 * The runs a sheet's regions make, for clip-making: every consecutively-numbered run whatever
 * its length (`detectSequencesAcross` with no minimum, so a multipacked animation still merges
 * across its pages), and each region with no number as a run of one, since a single still is a
 * one-frame clip. A region is unnumbered exactly when no numbered run took it.
 */
export function detectClipRuns(sheets: readonly SheetRegions[]): DetectedSequenceAcross[] {
	const runs = detectSequencesAcross([...sheets], 1);
	const taken = new Set<string>();
	for (const run of runs)
		for (const frame of run.frames)
			taken.add(frame.includes('::') ? frame : `${run.primary}::${frame}`);
	for (const { assetKey, regions } of sheets)
		for (const region of regions ?? []) {
			if (typeof region !== 'string' || !region || taken.has(`${assetKey}::${region}`)) continue;
			runs.push({ stem: region, primary: assetKey, frames: [region], sheets: [assetKey] });
		}
	return runs;
}

/** How a run's name gave the clip's. */
export type RunMatch =
	/** The run's name is the clip's, as the save would slug it. */
	| 'exact'
	/** `<prefix>_<facing>`, one frame: that facing's still, the idle state's one-frame clip. */
	| 'still'
	/** A misspelt name: offered, never made unasked. */
	| 'near';

export interface PlanRow {
	run: DetectedSequenceAcross;
	/** The clip it would make. */
	name: string;
	state: string;
	facing: ClipFacing;
	marked: boolean;
	match: RunMatch;
	/** How the run's name differs (`near` only). */
	why?: NearWhy;
	/** `create`: no such clip yet. `exists`: there is one, and it is left alone. `duplicate`:
	 *  another run of this plan already makes that clip. */
	action: 'create' | 'exists' | 'duplicate';
}

export interface ClipPlan {
	rows: PlanRow[];
	/** Runs under the character's prefix that give no name. */
	unmatched: DetectedSequenceAcross[];
}

const MATCH_RANK: Record<RunMatch, number> = { exact: 0, still: 1, near: 2 };

/**
 * Which clips a sheet's `runs` would make for a character: each run matched to one of its names,
 * a clip already in `existingIds` left alone, and of several runs with one name the longest
 * taken (a gap in the numbering splits an animation in two). `others` are the project's other
 * characters, whose runs are not this one's misspellings.
 */
export function planCharacterClips(
	look: CharacterClips,
	runs: readonly DetectedSequenceAcross[],
	existingIds: Iterable<string>,
	others: readonly CharacterClips[] = [],
): ClipPlan {
	const names = characterClipNames(look);
	const byId = new Map(names.map((n) => [n.id, n]));
	const ids = names.map((n) => n.id);
	const lookedFor = lookedForClipIds(look);
	const theirs = new Set(others.flatMap((other) => [...lookedForClipIds(other)]));
	const existing = new Set(existingIds);
	const stills = new Map<string, CharacterClipName>();
	for (const name of names)
		if (name.state === look.idle) {
			const prefix = name.marked ? look.prefixes.marked : look.prefixes.base;
			stills.set(folded(`${prefix}_${name.facing}`), name);
		}

	const matched: Omit<PlanRow, 'action'>[] = [];
	const unmatched: DetectedSequenceAcross[] = [];
	const row = (
		run: DetectedSequenceAcross,
		{ id, state, facing, marked }: CharacterClipName,
		match: RunMatch,
		why?: NearWhy,
	): Omit<PlanRow, 'action'> => ({
		run,
		name: id,
		state,
		facing,
		marked,
		match,
		...(why ? { why } : {}),
	});
	for (const run of runs) {
		const id = clipIdOf(run.stem);
		const exact = byId.get(id);
		if (exact) {
			matched.push(row(run, exact, 'exact'));
			continue;
		}
		if (theirs.has(id) || !underCharacterPrefix(look, run.stem)) continue;
		const still = run.frames.length === 1 ? stills.get(folded(run.stem)) : undefined;
		if (still) {
			matched.push(row(run, still, 'still'));
			continue;
		}
		const near = lookedFor.has(id) ? undefined : nearestClipName(run.stem, ids);
		const name = near && near.why !== 'guess' ? byId.get(near.name) : undefined;
		if (near && name) matched.push(row(run, name, 'near', near.why));
		else unmatched.push(run);
	}

	const order = new Map(ids.map((id, index) => [id, index]));
	matched.sort(
		(a, b) =>
			(order.get(a.name) ?? 0) - (order.get(b.name) ?? 0) ||
			MATCH_RANK[a.match] - MATCH_RANK[b.match] ||
			b.run.frames.length - a.run.frames.length ||
			a.run.frames[0].localeCompare(b.run.frames[0]),
	);
	const claimed = new Set<string>();
	const rows = matched.map((made): PlanRow => {
		if (existing.has(made.name)) return { ...made, action: 'exists' };
		if (claimed.has(made.name)) return { ...made, action: 'duplicate' };
		claimed.add(made.name);
		return { ...made, action: 'create' };
	});
	return { rows, unmatched };
}

/** How a state's new clips play. */
export interface StateSettings {
	fps: number;
	loop: boolean;
}

/** Each state's settings for a new clip: the tool's frame rate, a loop unless the game plays the
 *  state once. */
export function defaultStateSettings(look: CharacterClips): Record<string, StateSettings> {
	return Object.fromEntries(
		characterStates(look).map(({ state, loop }) => [state, { fps: DEFAULT_FLIPBOOK_FPS, loop }]),
	);
}

/** The clip a plan row makes: named as the game looks for it, with the character's box if it has
 *  one. */
export function plannedClip(
	row: Pick<PlanRow, 'name' | 'run'>,
	settings: StateSettings,
	bounds?: FlipbookBounds,
): FlipbookClip {
	return {
		id: row.name,
		name: row.name,
		assetKey: row.run.primary,
		frames: [...row.run.frames],
		fps: settings.fps,
		loop: settings.loop,
		...(bounds ? { bounds: { ...bounds } } : {}),
	};
}

/** Where a character's feet are on a box, in the box's own art px: the middle of the line
 *  `anchorY` down it (its bottom edge unless the look says otherwise). */
export function feetOf(look: CharacterClips, box: FlipbookBounds): { x: number; y: number } {
	return { x: box.x + box.w / 2, y: box.y + box.h * (look.anchorY ?? 1) };
}
