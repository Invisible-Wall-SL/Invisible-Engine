import { componentInputs, type ComponentDef } from 'engine-layout';
import type { GameConfigDoc } from 'game-config';
import { addBody } from '../../routes/(app)/config/familyDoc';
import { componentSaveError, componentSaveRequest } from '../componentSave.client';
import { clipIdOf } from '../flipbook/characterSet';
import { addCharacter, charactersOf, findCharacter, renameCharacter } from './characterEdit';

/**
 * Add a character by NAME (`docs/design/character-pipeline.md` step C6b). The person types a name;
 * the tool makes the character's look for them and adds the character and its body to the page's
 * doc (unsaved, like every other edit until Save).
 *
 * The look is a project component, created through the Component Editor's own save
 * (`POST /api/editor/component`, create-if-absent). A component is never deleted here: one whose
 * character was never saved is in no game (a config ships the looks its characters name) and is
 * taken up again by adding the same name.
 *
 * Pure but for the one request. `check:characters-tool` §14 runs it against the real route.
 */

/** What the look is, for the page to say where it asks for the name. */
export const LOOK_EXPLAINED =
	'The look is the component the game spawns for this character: it keeps the body and the placeholder shape.';

/** What stands in for a look that could not be created. */
export const NO_EDITOR_GRANT =
	'Creating a look needs the Invisible Scene Editor grant; ask an admin, or pick an existing look under Advanced.';

/** The longest id a name makes. A clip is found under `<id>_<action>_<facing>`, a name of 60 at
 *  most, so this leaves an action 16 letters. */
export const LOOK_ID_MAX = 40;

/** The side of the placeholder square, the side of the body `addBody` gives it. */
const PLACEHOLDER_SIZE = 100;

/** The placeholder's fill, picked by the id so two new characters are told apart on a stage. */
const PLACEHOLDER_COLORS = [0xfa8072, 0x6b9bd1, 0xe0b04a, 0x7bbf6a, 0xb07cc6, 0x4fb3a5] as const;

/** A component as the page lists it: a look a character can take. */
export interface ListedLook {
	id: string;
	name: string;
	/** `project` for the project's own component; a shared or built-in one is `shared`. */
	scope?: ComponentDef['scope'];
	/** The inputs its state machine reads that an anim input can follow. */
	inputs?: { id: string; kind: 'bool' | 'number' }[];
}

/** The page's list entry of a component. */
export const listedLook = (
	def: Pick<ComponentDef, 'id' | 'name' | 'scope' | 'inputs' | 'signals'>,
): Required<ListedLook> => ({
	id: def.id,
	name: def.name,
	scope: def.scope,
	inputs: componentInputs(def)
		.filter((i) => i.kind === 'bool' || i.kind === 'number')
		.map((i) => ({ id: i.id, kind: i.kind as 'bool' | 'number' })),
});

const spaced = (name: string): string => name.trim().replace(/\s+/g, ' ');

/**
 * The id a name gives both the character and its look: lower-case letters and digits, every run
 * of anything else one `_`, none at either end (`Polar Bear!` is `polar_bear`). It is its own
 * storage key and a clip prefix as it stands. Empty when the name has no letter or digit.
 */
export const lookIdFor = (name: string): string =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_|_$/g, '');

/** What adding `name` would do. */
export type CharacterNamePlan =
	| { kind: 'create'; id: string; name: string }
	/** `component` is a project component no character uses: it becomes the look, as it is. */
	| { kind: 'adopt'; id: string; name: string; component: string }
	/** `existing` is the component the name runs into, when it is one. */
	| { kind: 'refused'; reason: string; existing?: string };

/**
 * What adding a character called `name` would do, given the components the page lists and its
 * doc. Two component ids are one stored component when their storage keys match (`Bear`, `bear`
 * and `be-ar!` against `be_ar`), so a name is checked against every listed id by that key: a
 * shared or built-in component would be shadowed, and a look is one character's.
 */
export function characterNamePlan(
	name: string,
	components: readonly ListedLook[],
	doc: GameConfigDoc,
): CharacterNamePlan {
	const label = spaced(name);
	if (!label) return { kind: 'refused', reason: 'Type a name for the character.' };
	const id = lookIdFor(label);
	if (!id)
		return {
			kind: 'refused',
			reason: 'A name needs a letter or a digit: its id is made of a to z and 0 to 9.',
		};
	if (id.length > LOOK_ID_MAX)
		return {
			kind: 'refused',
			reason: `That name is too long: its id "${id}" has ${id.length} characters, and an id holds ${LOOK_ID_MAX}.`,
		};
	if (findCharacter(doc, id))
		return { kind: 'refused', reason: `A character is already called "${id}".` };
	const same = components.filter((c) => clipIdOf(c.id) === id);
	const shared = same.find((c) => c.scope !== 'project');
	if (shared)
		return {
			kind: 'refused',
			reason: `"${shared.name || shared.id}" is a component every game has, and a look called "${id}" would replace it in this game. Pick another name.`,
			existing: shared.id,
		};
	for (const component of same) {
		const user = charactersOf(doc).find((c) => c.component === component.id);
		if (user)
			return {
				kind: 'refused',
				reason: `"${component.name || component.id}" is already the look of the character "${user.id}". Pick another name.`,
				existing: component.id,
			};
	}
	return same.length
		? { kind: 'adopt', id, name: label, component: same[0].id }
		: { kind: 'create', id, name: label };
}

/** What adding the name would do, in a line shown while it is typed. */
export function characterNamePlanText(plan: CharacterNamePlan): string {
	if (plan.kind === 'refused') return plan.reason;
	return plan.kind === 'adopt'
		? `Adds the character "${plan.id}", using the existing component "${plan.component}" as its look.`
		: `Adds the character "${plan.id}" and creates its look "${plan.id}".`;
}

/** Why a character called `name` cannot be added, or `null`. */
export function characterNameRefusal(
	name: string,
	components: readonly ListedLook[],
	doc: GameConfigDoc,
): string | null {
	const plan = characterNamePlan(name, components, doc);
	return plan.kind === 'refused' ? plan.reason : null;
}

/**
 * The look a new character starts with: a square standing on its place (a `rect` is drawn about
 * its centre, so it is raised by half its height), the size of the body it is given. The same id
 * and name always give the same def, key for key as the save stores it, so a create sent twice
 * is one component.
 */
export function newLookComponent(id: string, name: string): ComponentDef {
	let hash = 0;
	for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
	return {
		id,
		name: spaced(name) || id,
		version: 1,
		scope: 'project',
		category: 'ui',
		root: {
			id: `${id}-root`,
			kind: 'container',
			x: 0,
			y: 0,
			children: [
				{
					id: `${id}-shape`,
					kind: 'rect',
					x: 0,
					y: -PLACEHOLDER_SIZE / 2,
					width: PLACEHOLDER_SIZE,
					height: PLACEHOLDER_SIZE,
					color: PLACEHOLDER_COLORS[hash % PLACEHOLDER_COLORS.length],
				},
			],
		},
	};
}

/** Whether a stored component is still the look {@link newLookComponent} made (whatever its
 *  name): nobody has edited it, so taking it up changes nobody's work. */
const untouchedLook = (def: ComponentDef): boolean =>
	JSON.stringify({ ...def, name: '' }) ===
	JSON.stringify({ ...newLookComponent(def.id, ''), name: '' });

export type AddCharacterResult =
	| {
			ok: true;
			characterId: string;
			/** The character's look, for the page's list when `listed` is false. */
			component: Required<ListedLook>;
			/** `created`: the look was made now. `adopted`: an existing project component no
			 *  character used became the look, as it is. */
			how: 'created' | 'adopted';
			/** The page's list already had the look. */
			listed: boolean;
	  }
	| {
			ok: false;
			/** Why nothing was added, in words for the person. */
			refused: string;
			/** The component the name ran into. */
			existing?: string;
			/** A project component the page does not list yet (made now, or found by the create):
			 *  adding the same name again takes it up. */
			component?: Required<ListedLook>;
	  };

export interface CharacterAdderOptions {
	projectKey: string;
	/** The page's live doc, as it is now. */
	doc: () => GameConfigDoc;
	/** The components the page lists, as they are now. */
	components: () => readonly ListedLook[];
	/** Why the page's doc cannot be edited now (`pageSave.ts` `editRefusal`), or `null`. */
	refusal: () => string | null;
	/** The page's one edit (`pageEdits().change`): whether it ran. */
	change: (run: (doc: GameConfigDoc) => void) => boolean;
	fetch?: typeof fetch;
}

const COMPONENT_API = '/api/editor/component';

/**
 * The page's *add a character by name*. One adder a page: a second call for a name already in
 * the air (a double click) gets the first call's answer, and no second request.
 *
 * The order is what keeps a failure harmless: the name is checked, the look is created only if
 * no component is stored under its key (never over one), and the character and its body are
 * added in ONE edit only once the look exists. A look the create finds already there is taken up
 * when it is still the untouched placeholder, and reported otherwise: adding the name again then
 * uses it as it is.
 */
export function characterAdder(
	options: CharacterAdderOptions,
): (name: string) => Promise<AddCharacterResult> {
	const send = options.fetch ?? fetch;
	/** The project components learned of here that the page may not list yet. */
	const found = new Map<string, Required<ListedLook>>();
	const flights = new Map<string, Promise<AddCharacterResult>>();

	const listed = (): ListedLook[] => {
		const page = options.components();
		const ids = new Set(page.map((c) => c.id));
		return [...page, ...[...found.values()].filter((c) => !ids.has(c.id))];
	};

	/** The character and its body, in one edit, with `component` as the look. */
	const place = (name: string, how: 'created' | 'adopted'): AddCharacterResult => {
		const plan = characterNamePlan(name, listed(), options.doc());
		if (plan.kind === 'refused')
			return { ok: false, refused: plan.reason, existing: plan.existing };
		const look = plan.kind === 'adopt' ? plan.component : plan.id;
		const page = options.components().find((c) => c.id === look);
		const component: Required<ListedLook> = found.get(look) ?? {
			id: look,
			name: page?.name || plan.name,
			scope: 'project',
			inputs: page?.inputs ?? [],
		};
		const unlisted = page ? {} : { component };
		const ran = options.change((doc) => {
			const added = addCharacter(doc, look);
			if (added && added !== plan.id) renameCharacter(doc, added, plan.id);
			addBody(doc, look);
		});
		if (!ran)
			return {
				ok: false,
				refused: `${options.refusal() ?? 'The page cannot be edited now.'} The look "${component.name}" exists: add "${plan.name}" again to use it.`,
				existing: look,
				...unlisted,
			};
		return { ok: true, characterId: plan.id, component, how, listed: !!page };
	};

	/** The project's stored component under `id`'s key, or `null` when it cannot be read. */
	const stored = async (id: string): Promise<ComponentDef | null> => {
		try {
			const res = await send(
				`${COMPONENT_API}?id=${encodeURIComponent(id)}&project=${encodeURIComponent(options.projectKey)}&stored=project`,
			);
			if (!res.ok) return null;
			return ((await res.json()) as { def: ComponentDef }).def;
		} catch {
			return null;
		}
	};

	const add = async (name: string): Promise<AddCharacterResult> => {
		const blocked = options.refusal();
		if (blocked) return { ok: false, refused: blocked };
		const plan = characterNamePlan(name, listed(), options.doc());
		if (plan.kind === 'refused')
			return { ok: false, refused: plan.reason, existing: plan.existing };
		if (plan.kind === 'adopt') return place(name, 'adopted');

		const def = newLookComponent(plan.id, plan.name);
		const { body } = componentSaveRequest(def, options.projectKey, {
			baseEtag: null,
			force: false,
		});
		let res: Response;
		try {
			res = await send(COMPONENT_API, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
		} catch {
			return {
				ok: false,
				refused:
					'The look could not be created: the launcher did not answer. Nothing was changed. Try again.',
			};
		}
		if (res.ok) {
			found.set(def.id, listedLook(def));
			return place(name, 'created');
		}
		if (res.status === 409) {
			const theirs = await stored(plan.id);
			if (!theirs)
				return {
					ok: false,
					refused: `A component is already stored as "${plan.id}" in this project, and it could not be read. Nothing was changed. Try again.`,
					existing: plan.id,
				};
			found.set(theirs.id, listedLook(theirs));
			if (theirs.id === plan.id && untouchedLook(theirs)) return place(name, 'adopted');
			return {
				ok: false,
				refused: `This project already has a component "${theirs.name || theirs.id}" stored as "${plan.id}". Nothing was changed. Add "${plan.name}" again to use it as the look, or pick another name.`,
				existing: theirs.id,
				component: listedLook(theirs),
			};
		}
		if (res.status === 403) return { ok: false, refused: NO_EDITOR_GRANT };
		if (res.status === 400)
			return {
				ok: false,
				refused: `The look could not be created: ${await componentSaveError(res)} Nothing was changed.`,
			};
		return {
			ok: false,
			refused:
				res.status >= 500
					? 'The look could not be created: storage did not answer. Nothing was changed. Try again.'
					: `The look could not be created (${res.status}). Nothing was changed.`,
		};
	};

	return (name) => {
		const key = lookIdFor(name);
		const flying = flights.get(key);
		if (flying) return flying;
		const flight = add(name).finally(() => flights.delete(key));
		flights.set(key, flight);
		return flight;
	};
}

/** What an add did, for the page to say under the name: a refusal as it is; an adopted look is
 *  named, since the person did not make it now. */
export function addedNote(result: AddCharacterResult): string {
	if (!result.ok) return result.refused;
	return result.how === 'adopted'
		? `Added "${result.characterId}". It uses the existing component "${result.component.name || result.component.id}" as its look, as it is. The character is saved when you press Save.`
		: `Added "${result.characterId}" and created its look. The character is saved when you press Save.`;
}

/** The page's component list after an add: a look the add learned of that the page does not list
 *  yet is appended (after a failure too, so adding the name again finds it). */
export function looksAfterAdd<T extends ListedLook>(
	components: readonly T[],
	result: AddCharacterResult,
): (T | Required<ListedLook>)[] {
	const learned = result.component;
	if (!learned || (result.ok && result.listed) || components.some((c) => c.id === learned.id))
		return [...components];
	return [...components, learned];
}
