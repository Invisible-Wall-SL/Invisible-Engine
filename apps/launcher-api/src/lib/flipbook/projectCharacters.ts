/**
 * WHICH CHARACTERS OF A PROJECT PLAY CLIPS, and the block each plays, for Invisible Flipbook's
 * Characters mode. Decided as the online runtime decides it (`apps/lines` `online.ts`
 * `clipLookOf`): a character of the game's config is drawn as its `body` component, whose
 * `characterClips` it plays; in a game drawn in Salmons' art a character whose component names
 * none plays the game's own block, and a block that names no `facings` takes the game's
 * (`engine-layout` `characterClipsIn`).
 *
 * Wider than the runtime in two ways, both so that a character can be given clips before the
 * rest of the game is wired: the game's built-in characters are listed for a Salmons config that
 * does not list them (their clips ship either way, `clipReachability` `builtinClipPrefixes`), and
 * so is a component that carries a block no character of the config is drawn as.
 *
 * Pure: the endpoint and `scripts/check-flipbook-characters.ts` both run it.
 */
import {
	SALMONS_CHARACTER_CLIPS,
	characterClipsIn,
	type CharacterClips,
	type ComponentDef,
} from 'engine-layout';
import { usesSalmonsArt, type GameConfigDoc } from 'game-config';

export interface ProjectCharacter {
	/** Unique in the project's list: the character's id in the config, else its component's. */
	key: string;
	label: string;
	/** The block it plays. */
	look: CharacterClips;
	/** The game's config lists it as a character a player can be. */
	inConfig: boolean;
	/** Where the block is written: the component's own, or the game's built-in one. */
	source: 'component' | 'game';
	/** Where its `facings` come from: the component's block, the game's, or neither (four). */
	facingsFrom: 'component' | 'game' | 'default';
	/** The component it is drawn as, when the project has it. */
	component?: { id: string; name: string; scope: ComponentDef['scope']; hasBlock: boolean };
}

type CharacterComponent = Pick<ComponentDef, 'id' | 'name' | 'scope' | 'characterClips'>;

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** The config's online characters as `{ id, body }`, read off a doc that may be unrepaired. */
function onlineCharacters(
	config: GameConfigDoc | null | undefined,
): { id: string; body: string }[] {
	const arcade: unknown = (config as { arcade?: unknown } | null | undefined)?.arcade;
	const online = isObject(arcade) ? arcade.online : undefined;
	const characters = isObject(online) ? online.characters : undefined;
	if (!Array.isArray(characters)) return [];
	return characters.flatMap((c) =>
		isObject(c) && typeof c.id === 'string' && typeof c.body === 'string'
			? [{ id: c.id, body: c.body }]
			: [],
	);
}

const titled = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);

/** The project's characters that play clips, the config's own first. */
export function projectCharacters(
	components: readonly CharacterComponent[],
	config: GameConfigDoc | null | undefined,
): ProjectCharacter[] {
	const defs = new Map(components.map((def) => [def.id, def]));
	const builtin: Readonly<Record<string, CharacterClips>> = usesSalmonsArt(config)
		? SALMONS_CHARACTER_CLIPS
		: {};
	const out: ProjectCharacter[] = [];
	const drawnAs = new Set<string>();
	const add = (
		key: string,
		inConfig: boolean,
		def: CharacterComponent | undefined,
		game: CharacterClips | undefined,
	): void => {
		const own = def?.characterClips;
		const look = characterClipsIn(own, game);
		if (!look || out.some((c) => c.key === key)) return;
		out.push({
			key,
			label: def?.name ?? titled(key),
			look,
			inConfig,
			source: own ? 'component' : 'game',
			facingsFrom: own?.facings ? 'component' : look.facings ? 'game' : 'default',
			...(def
				? { component: { id: def.id, name: def.name, scope: def.scope, hasBlock: !!own } }
				: {}),
		});
		if (def) drawnAs.add(def.id);
	};
	for (const { id, body } of onlineCharacters(config))
		add(id, true, defs.get(body), Object.hasOwn(builtin, id) ? builtin[id] : undefined);
	for (const [id, game] of Object.entries(builtin)) add(id, false, undefined, game);
	for (const def of components) {
		if (!def.characterClips || drawnAs.has(def.id)) continue;
		// A component may share its id with a character of the config that is drawn as another one.
		const taken = out.some((c) => c.key === def.id);
		add(taken ? `component:${def.id}` : def.id, false, def, undefined);
	}
	return out;
}
