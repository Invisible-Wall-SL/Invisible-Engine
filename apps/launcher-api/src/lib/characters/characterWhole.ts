/**
 * A CHARACTER SEEN WHOLE (Invisible Characters' read-only view, `docs/design/character-pipeline.md`
 * step C1). A character lives in up to four homes today, none of which names the others:
 *
 *   - the config's characters (`arcade.characters`): the look, movement, controller, brain;
 *   - its online classes (`arcade.online.characters`): the room's body, speed, places, spawns,
 *     with the abilities `arcade.online.rules.abilities` gives them and the bots that play them;
 *   - Salmons' built-in clip table (`engine-layout` `SALMONS_CHARACTER_CLIPS`), by class id;
 *   - the 3D looks (`arcade.world3d.looks`, kept raw: `game-config` does not know them), by the
 *     room's character id.
 *
 * {@link wholeCharacters} joins them into one row per character: a class to a config character by
 * LOOK (the component one is and the other's body is drawn as; a component is the look of one
 * character at most), Salmons' table and a 3D look by ID (the class's, else the character's). The
 * clips each plays are Flipbook's own answer (`projectCharacters`), so this view and Flipbook's
 * Characters mode never disagree. {@link impliedView} and {@link impliedSource} say what
 * a character's fields say: its sheet's when it has one (step C2b), else what today's fields imply;
 * {@link characterGaps} says what is missing.
 *
 * Pure and read-only: it changes no doc. `scripts/check-characters-tool.ts` §7 runs it on the
 * Salmons reference config.
 */
import {
	SALMONS_CHARACTER_CLIPS,
	type CharacterClips,
	type ClipFacing,
	type ComponentDef,
	type SceneProjection,
} from 'engine-layout';
import {
	resolveArcade,
	usesSalmonsArt,
	type ArcadeAbility,
	type ArcadeBody,
	type ArcadeCharacter,
	type ArcadeOnlineAbility,
	type ArcadeOnlineCharacter,
	type GameConfigDoc,
} from 'game-config';
import { characterFacings, characterGrid, gridCounts } from '../flipbook/characterSet';
import {
	characterArt,
	projectCharacters,
	type ProjectCharacter,
} from '../flipbook/projectCharacters';
import { projectionOf } from './sheetCore';

export type WholeComponent = Pick<ComponentDef, 'id' | 'name' | 'scope' | 'characterClips'>;

/** A 3D look as `arcade.world3d.looks.<id>` stores it, read leniently (`engine-3d` `looksOf3d`
 *  is the game's strict read). */
export interface WholeLook3d {
	id: string;
	modelId?: string;
	modelIds: string[];
	attach: { socket: string; modelId: string }[];
	anim?: string;
	viewmodel: boolean;
}

/** How a part was joined to its character. */
export type JoinedBy = 'look' | 'id';

export interface WholeCharacter {
	/** Unique in the list: `look:<component>`, else `id:<id>`. */
	key: string;
	label: string;
	/** The component it is drawn as, and whether the project has it. */
	look?: { id: string; name?: string; inProject: boolean };
	/** Its `arcade.characters` entry. */
	character?: ArcadeCharacter;
	/** Its `arcade.online.characters` entry. */
	onlineClass?: ArcadeOnlineCharacter;
	/** The `arcade.characters` ids whose brains play this class's bots. */
	botBrains: string[];
	/** The room's abilities this class uses. */
	onlineAbilities: ArcadeOnlineAbility[];
	/** The offline abilities its config character uses. */
	abilities: ArcadeAbility[];
	/** Salmons' built-in clip table names it. */
	builtin?: CharacterClips;
	/** The clips it plays, as Flipbook's Characters mode lists it. */
	clips?: ProjectCharacter;
	/** Its character sheet when the game does not draw it from that sheet: its class plays a block
	 *  instead (`clips`), and the sheet's `sheetProblem` says why. */
	idleSheet?: ProjectCharacter;
	look3d?: WholeLook3d;
	/** Its look's body (`arcade.bodies`). */
	body?: ArcadeBody;
	/** How each part beyond the first was joined. */
	joinedBy: Partial<Record<'class' | 'builtin' | 'look3d' | 'clips', JoinedBy>>;
}

export interface WholeInput {
	components: readonly WholeComponent[];
	config: GameConfigDoc | null | undefined;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const titled = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);

const names = (v: unknown): string[] =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** The config's 3D looks, by character id. */
export function looks3dOf(config: GameConfigDoc | null | undefined): WholeLook3d[] {
	const arcade: unknown = (config as { arcade?: unknown } | null | undefined)?.arcade;
	const world3d = isObject(arcade) ? arcade.world3d : undefined;
	const looks = isObject(world3d) ? world3d.looks : undefined;
	if (!isObject(looks)) return [];
	return Object.entries(looks).flatMap(([id, raw]): WholeLook3d[] => {
		if (!isObject(raw)) return [];
		return [
			{
				id,
				...(typeof raw.modelId === 'string' ? { modelId: raw.modelId } : {}),
				modelIds: names(raw.modelIds),
				attach: (Array.isArray(raw.attach) ? raw.attach : []).flatMap((a) =>
					isObject(a) && typeof a.socket === 'string' && typeof a.modelId === 'string'
						? [{ socket: a.socket, modelId: a.modelId }]
						: [],
				),
				...(typeof raw.anim === 'string' ? { anim: raw.anim } : {}),
				viewmodel: raw.viewmodel !== undefined,
			},
		];
	});
}

/** Every character of a project, one row each, the config's own first. */
export function wholeCharacters({ components, config }: WholeInput): WholeCharacter[] {
	const defs = new Map(components.map((d) => [d.id, d]));
	const arcade = resolveArcade(config);
	const online = config?.arcade?.online;
	const out: WholeCharacter[] = [];

	const lookOf = (id: string): WholeCharacter['look'] => {
		const def = defs.get(id);
		return { id, ...(def ? { name: def.name } : {}), inProject: !!def };
	};
	const row = (key: string, label: string, look?: string): WholeCharacter => {
		const made: WholeCharacter = {
			key: out.some((c) => c.key === key) ? `${key}#${out.length}` : key,
			label,
			...(look ? { look: lookOf(look), ...bodyOf(look) } : {}),
			botBrains: [],
			onlineAbilities: [],
			abilities: [],
			joinedBy: {},
		};
		out.push(made);
		return made;
	};
	const bodyOf = (look: string): { body?: ArcadeBody } =>
		Object.hasOwn(arcade.bodies, look) ? { body: arcade.bodies[look] } : {};
	const byLook = (look: string) => out.find((c) => c.look?.id === look);
	const byId = (id: string) =>
		out.find((c) => c.onlineClass?.id === id) ??
		out.find((c) => c.character?.id === id) ??
		out.find((c) => c.key === `id:${id}`);

	for (const character of arcade.characters) {
		// A second character of one look (refused on save, but the page shows unsaved edits) is its
		// own row, so neither is lost.
		const seen = byLook(character.component);
		const at =
			seen && !seen.character
				? seen
				: row(`look:${character.component}`, character.name || character.id, character.component);
		at.character = character;
		at.abilities = arcade.abilities.filter((a) => a.character === character.id);
	}

	for (const cls of online?.characters ?? []) {
		// By look only: a config character of the same id drawn as another component is another one.
		const seen = byLook(cls.body);
		const at = seen && !seen.onlineClass ? seen : undefined;
		const target = at ?? row(`look:${cls.body}`, titled(cls.id), cls.body);
		if (at) target.joinedBy.class = 'look';
		target.onlineClass = cls;
		target.label = titled(cls.id);
		target.onlineAbilities = (online?.rules?.abilities ?? []).filter((a) => a.character === cls.id);
		target.botBrains = [
			...new Set(
				(online?.bots?.characters ?? []).filter((b) => b.character === cls.id).map((b) => b.brain),
			),
		];
	}

	if (usesSalmonsArt(config)) {
		for (const [id, clips] of Object.entries(SALMONS_CHARACTER_CLIPS)) {
			const at = byId(id);
			if (at) at.joinedBy.builtin = 'id';
			(at ?? row(`id:${id}`, titled(id))).builtin = clips;
		}
	}

	for (const look of looks3dOf(config)) {
		const at = byId(look.id);
		if (at) at.joinedBy.look3d = 'id';
		(
			at ?? row(`id:${look.id}`, look.id === 'default' ? 'Everyone (default)' : titled(look.id))
		).look3d = look;
	}

	for (const pc of projectCharacters(components, config)) {
		const component = pc.component?.id;
		// A sheet no class plays yet is its character's: joined by that character's id.
		const sheetRow =
			!pc.inConfig && pc.sheetId ? out.find((c) => c.character?.id === pc.sheetId) : undefined;
		if (sheetRow?.clips) {
			sheetRow.idleSheet = pc;
			continue;
		}
		const found = pc.inConfig
			? out.find((c) => c.onlineClass?.id === pc.key)
			: (sheetRow ?? (component ? byLook(component) : undefined) ?? byId(pc.key));
		const target =
			found ?? row(component ? `look:${component}` : `id:${pc.key}`, pc.label, component);
		if (sheetRow) target.joinedBy.clips = 'id';
		else if (found)
			target.joinedBy.clips =
				!pc.inConfig && !!component && found.look?.id === component ? 'look' : 'id';
		target.clips = pc;
	}
	return out;
}

export type ViewKind = 'side' | 'topDown' | 'isometric' | '3d' | 'none';

/** The view of a character: its sheet's, else the one today's fields imply (plan §1, gap 4). */
export interface ImpliedView {
	kind: ViewKind;
	/** The facings it is drawn in, and the ones the game mirrors from them. */
	drawn: ClipFacing[];
	mirrored: ClipFacing[];
	/** The fields it was read from. */
	from: string[];
}

/** What a character's fields imply about its view, with the fields they were read from. */
export function impliedView(
	c: WholeCharacter,
	config: GameConfigDoc | null | undefined,
	projections: readonly SceneProjection[],
): ImpliedView {
	if (c.look3d) {
		return {
			kind: '3d',
			drawn: [],
			mirrored: [],
			from: [`arcade.world3d.looks.${c.look3d.id}: the body's yaw turns the model`],
		};
	}
	const iso = projectionOf(projections) === 'isometric';
	if (c.clips?.sheet) {
		const { sheet, sheetId } = c.clips;
		const { drawn, mirrored } = characterFacings(sheet);
		return {
			kind: sheet.view?.kind ?? 'isometric',
			drawn,
			mirrored,
			from: [
				sheet.view
					? `its character sheet (arcade.characters "${sheetId}"): the view it names`
					: `its character sheet (arcade.characters "${sheetId}") names no view: the four diagonals, as before the sheet`,
				...(c.onlineClass ? [] : ['no online class plays the sheet yet']),
			],
		};
	}
	if (c.onlineClass && c.clips) {
		const look = c.clips.look;
		const { drawn, mirrored } = characterFacings(look);
		const eight = look.facings === 8;
		const from = [
			`its clip block: ${eight ? 'eight facings' : 'the four diagonals'} (${FACINGS_FROM[c.clips.facingsFrom]})`,
			iso ? 'a screen of the project is isometric' : 'no screen of the project is isometric',
		];
		if (config?.arcade?.online?.keys === 'screen') from.push("the room's keys are the screen's");
		return { kind: eight && !iso ? 'topDown' : 'isometric', drawn, mirrored, from };
	}
	const controller = c.character?.controller;
	if (c.character && !c.onlineClass) {
		const kind: ViewKind =
			controller?.kind === 'sideScroll' || controller?.kind === 'flap'
				? 'side'
				: controller?.kind === 'topDown'
					? 'topDown'
					: 'none';
		return {
			kind,
			drawn: ['e'],
			mirrored: ['w'],
			from: [
				"offline its look is told only left or right (the anim input 'facing' is 1 or -1)",
				controller ? `its controller: ${controller.kind}` : 'it has no controller',
			],
		};
	}
	return {
		kind: 'none',
		drawn: [],
		mirrored: [],
		from: [
			c.onlineClass
				? 'its look names no clip block, so it is drawn with no facing'
				: 'nothing in the game plays it yet',
		],
	};
}

const FACINGS_FROM: Record<ProjectCharacter['facingsFrom'], string> = {
	component: 'set on its component',
	game: 'the game’s own',
	default: 'the default',
};

export type SourceKind = 'clips' | 'component' | 'code' | 'model' | 'none';

/** What draws a character today, and why. */
export function impliedSource(
	c: WholeCharacter,
	config: GameConfigDoc | null | undefined,
): { kind: SourceKind; why: string } {
	if (c.look3d) return { kind: 'model', why: '3D model, from arcade.world3d.looks' };
	if (false as boolean)
		return {
			kind: 'clips',
			why: c.onlineClass
				? 'frame clips, from its character sheet'
				: 'frame clips, from a character sheet no online class plays yet',
		};
	if (c.onlineClass) {
		if (c.clips)
			return {
				kind: 'clips',
				why:
					c.clips.source === 'component'
						? `frame clips, from its component's clip block`
						: 'frame clips, from the game’s built-in table',
			};
		if (usesSalmonsArt(config))
			return { kind: 'code', why: 'drawn in code (Salmons’ look), then a placeholder' };
		return { kind: 'component', why: 'its component, as authored' };
	}
	if (c.character)
		return { kind: 'component', why: "its component's state machine, fed by its anim inputs" };
	return { kind: 'none', why: 'no character of the game plays it' };
}

/** What a character lacks today, in words the page shows as they are. */
export function characterGaps(
	c: WholeCharacter,
	config: GameConfigDoc | null | undefined,
	clipIds: Iterable<string>,
): string[] {
	const gaps: string[] = [];
	if (c.look && !c.look.inProject)
		gaps.push(`Its look ${c.look.id} is not a component of this project.`);
	if (c.onlineClass && !c.body)
		gaps.push(`Its body ${c.onlineClass.body} has no arcade.bodies entry.`);
	if (!c.character && !c.onlineClass && !c.look3d)
		gaps.push('No character of the config, online class or 3D look plays it.');
	if (c.onlineClass && !c.clips && !c.look3d)
		gaps.push(
			usesSalmonsArt(config)
				? 'No clip block: it is drawn in code until its component carries one.'
				: 'No clip block: it is drawn as its component, with no facing.',
		);
	if (c.clips) {
		const counts = gridCounts(characterGrid(characterArt(c.clips), clipIds));
		if (counts.made === 0) gaps.push(`None of its ${counts.needed} drawn clips is made.`);
		else if (counts.made < counts.needed)
			gaps.push(
				`${counts.needed - counts.made} of its ${counts.needed} drawn clips ${counts.needed - counts.made === 1 ? 'is' : 'are'} not made.`,
			);
		if (counts.empty)
			gaps.push(`${counts.empty} cell${counts.empty === 1 ? ' has' : 's have'} nothing to play.`);
		if (!c.onlineClass)
			gaps.push('Its clips play only online, and no online class is drawn as it.');
		if (c.clips.sheetProblem) gaps.push(c.clips.sheetProblem);
	}
	if (c.idleSheet?.sheetProblem && c.idleSheet.sheetProblem !== c.clips?.sheetProblem)
		gaps.push(c.idleSheet.sheetProblem);
	if (c.look3d && !c.look3d.anim) gaps.push('Its 3D look names no animation graph (anim).');
	if (c.look3d && !c.look3d.modelId) gaps.push('Its 3D look names no model.');
	return gaps;
}
