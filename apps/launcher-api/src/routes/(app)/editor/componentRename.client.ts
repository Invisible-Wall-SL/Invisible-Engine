import type { ComponentDef } from 'engine-layout';

/** Only the project's own components rename in place; a shared or built-in one is copied first. */
export const canRenameComponent = (def: Pick<ComponentDef, 'scope'>): boolean =>
	def.scope === 'project';

/**
 * Why `name` cannot be the new name of component `id`, or `null` when it can. Names compare
 * trimmed and case-blind against every other component the project lists (its own, shared and
 * built-in), since the list and **◇ Edit as component** tell components apart by name.
 */
export function componentRenameProblem(
	name: string,
	id: string,
	components: readonly Pick<ComponentDef, 'id' | 'name'>[],
): string | null {
	const next = name.trim();
	if (!next) return 'The name cannot be empty.';
	const taken = components.find(
		(c) => c.id !== id && c.name.trim().toLowerCase() === next.toLowerCase(),
	);
	return taken ? `Another component of this project is already called "${taken.name}".` : null;
}

export type RenameRead = { def: ComponentDef; etag: string | null } | { status: number };
export type RenameSave =
	{ version: number; etag: string | null } | { status: number; message: string };

export interface RenameWrites {
	/** The project's own def as stored, with its ETag (`GET /api/editor/component?stored=project`). */
	read: (id: string) => Promise<RenameRead>;
	/** A conditional save of `def` against `baseEtag` (`POST /api/editor/component`). */
	save: (def: ComponentDef, baseEtag: string) => Promise<RenameSave>;
}

export type RenameResult =
	| {
			def: ComponentDef;
			etag: string | null;
			/** The ETag the rename was read at: the stored object it renamed. */
			readEtag: string;
	  }
	| { problem: string };

/**
 * ✎ Rename: the stored project def, read fresh, saved back with only its `name` changed — a CAS
 * on the ETag it was read at, so a save landing in between is refused, never overwritten. The id
 * stays, so every placement, nested instance, repeater variant, timeline and the bake keep finding
 * it, and the server keeps the version (a rename is not a new version), so no pin is flagged.
 */
export async function writeComponentRename(
	id: string,
	name: string,
	writes: RenameWrites,
): Promise<RenameResult> {
	const read = await writes.read(id);
	if (!('def' in read)) return { problem: `Could not read the component (${read.status}).` };
	if (!canRenameComponent(read.def) || read.etag === null) {
		return { problem: 'It is no longer one of this project’s own components. Reload the list.' };
	}
	const def = { ...read.def, name: name.trim() };
	const saved = await writes.save(def, read.etag);
	if ('message' in saved) return { problem: saved.message };
	return { def: { ...def, version: saved.version }, etag: saved.etag, readEtag: read.etag };
}

/** `snapshot` (a def's JSON) with its `name` replaced in place, key order kept. */
export function renamedSnapshot(snapshot: string, name: string): string {
	const def = JSON.parse(snapshot) as ComponentDef;
	def.name = name;
	return JSON.stringify(def);
}
