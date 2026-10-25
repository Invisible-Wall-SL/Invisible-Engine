import type { CustomElementFx } from 'constants-shared/elementFx';
import {
	compileShaderEffect,
	customGlslSignature,
	hasCustomGlsl,
	normalizeShaderGraphDoc,
	type GraphIssue,
	type ShaderGraphDoc,
} from 'engine-shadergraph';
import { mapWithConcurrency } from './concurrency';
import { deleteDocWithBackup, putDocWithBackup, type BackupMode } from './docBackups';
import {
	SHARED_SHADERS_PREFIX,
	SUB,
	shaderDocBackupTarget,
	shaderDocKey,
	shaderSlug,
	sharedShaderDocBackupTarget,
	sharedShaderDocKey,
} from './projectPaths';
import { deleteObject, getObjectText, getObjectTextWithEtag, listAllKeys } from './r2';

/**
 * R2 load/save for Invisible Shader Graph docs (`docs/design/invisible-shader-graph.md` §8 step 4).
 * A project holds many graphs, one file each (`shaderDocKey`), beside the studio-shared library
 * (`sharedShaderDocKey`). A project's graph shadows a shared one of the same id, so the project's
 * SET is its own graphs plus the shared ones it does not override: that set is what its editors
 * register and what its game ships.
 *
 * `normalizeShaderGraphDoc` is the gatekeeper: a graph is saved while it is being built, so it
 * keeps broken wiring and bad values (the compiler reports those) and drops anything that is not
 * part of the doc.
 */

/** R2 reads in flight at once while a set loads (every editor page load, boot and Publish). */
const SHADER_IO_CONCURRENCY = 8;

/**
 * The largest graph a save takes, as stored. A graph compiles on every editor page load, authoring
 * boot and Publish; a real one is tens of KB, and this bounds what one save can cost them.
 */
export const SHADER_DOC_MAX_BYTES = 512 * 1024;

/** A save over {@link SHADER_DOC_MAX_BYTES}. */
export class ShaderTooLargeError extends Error {
	constructor(readonly bytes: number) {
		super(`A shader graph is at most ${SHADER_DOC_MAX_BYTES} bytes; this one is ${bytes}.`);
		this.name = 'ShaderTooLargeError';
	}
}

/** A save or publish that adds or changes Custom GLSL, by someone without `shaderCustomGlsl`. */
export class CustomGlslNotAllowedError extends Error {
	constructor() {
		super('Only an admin can add custom GLSL or change its code or ports.');
		this.name = 'CustomGlslNotAllowedError';
	}
}

export interface ShaderRow {
	id: string;
	name: string;
	description: string;
	/** From the studio-shared library rather than the project. */
	shared: boolean;
	/** The project's own graph, and the library has one of its id (it was published, or shadows one). */
	inLibrary?: boolean;
}

/** A graph that did not compile, so it is not part of what plays. */
export interface ShaderSkip {
	id: string;
	name: string;
	errors: string[];
}

export interface CompiledShaderSet {
	effects: CustomElementFx[];
	skipped: ShaderSkip[];
}

/**
 * The id of a graph's key (`<prefix>/<id>.json`), or '' for any other: a key in a sub-folder, or
 * whose name is not a slug, is not one (`/` is never part of a slug).
 */
function idOfKey(prefix: string, key: string): string {
	const rest = key.slice(prefix.length + 1);
	if (!rest.endsWith('.json')) return '';
	const id = rest.slice(0, -'.json'.length);
	return shaderSlug(id) === id ? id : '';
}

async function readDocs(prefix: string): Promise<ShaderGraphDoc[]> {
	const found = (await listAllKeys(`${prefix}/`))
		.map((key) => ({ key, id: idOfKey(prefix, key) }))
		.filter((f) => f.id);
	const docs = await mapWithConcurrency(found, SHADER_IO_CONCURRENCY, async ({ key, id }) => {
		const raw = await getObjectText(key);
		if (!raw) return undefined;
		try {
			return normalizeShaderGraphDoc(JSON.parse(raw), id);
		} catch {
			return undefined;
		}
	});
	return docs.filter((d): d is ShaderGraphDoc => !!d);
}

/** The project's set: its own graphs, then the shared graphs it does not override, by name. */
export async function loadShaderSet(
	clientKey: string,
	projectKey: string,
): Promise<{ doc: ShaderGraphDoc; shared: boolean; inLibrary: boolean }[]> {
	const [own, library] = await Promise.all([
		readDocs(SUB.shaders(clientKey, projectKey)),
		readDocs(SHARED_SHADERS_PREFIX),
	]);
	const ids = new Set(own.map((d) => d.id));
	const libraryIds = new Set(library.map((d) => d.id));
	const shared = library.filter((d) => !ids.has(d.id));
	return [
		...own.map((doc) => ({ doc, shared: false, inLibrary: libraryIds.has(doc.id) })),
		...shared.map((doc) => ({ doc, shared: true, inLibrary: true })),
	].sort((a, b) => a.doc.name.localeCompare(b.doc.name) || a.doc.id.localeCompare(b.doc.id));
}

export async function listShaders(clientKey: string, projectKey: string): Promise<ShaderRow[]> {
	return (await loadShaderSet(clientKey, projectKey)).map(({ doc, shared, inLibrary }) => ({
		id: doc.id,
		name: doc.name || doc.id,
		description: doc.description ?? '',
		shared,
		...(!shared && inLibrary ? { inLibrary } : {}),
	}));
}

const errorText = (issue: GraphIssue): string =>
	issue.node ? `${issue.node}: ${issue.message}` : issue.message;

/**
 * `compileShaderEffect`, its errors as text. A compile that throws is a compiler bug a stored doc
 * found: it answers as this doc's error, so one doc never fails a project's whole set.
 */
function compileStored(
	doc: ShaderGraphDoc,
): { ok: true; effect: CustomElementFx } | { ok: false; errors: string[] } {
	try {
		const result = compileShaderEffect(doc);
		return result.ok
			? result
			: { ok: false, errors: result.issues.filter((i) => i.level === 'error').map(errorText) };
	} catch (e) {
		console.error(`[shaders] compiling "${doc.id}" threw`, e);
		return { ok: false, errors: ['The compiler failed on this graph.'] };
	}
}

/** Compile every doc: what plays as `custom:<id>`, and what did not compile and why. */
export function compileShaderSet(docs: readonly ShaderGraphDoc[]): CompiledShaderSet {
	const effects: CustomElementFx[] = [];
	const skipped: ShaderSkip[] = [];
	for (const doc of docs) {
		const result = compileStored(doc);
		if (result.ok) effects.push(result.effect);
		else skipped.push({ id: doc.id, name: doc.name || doc.id, errors: result.errors });
	}
	return { effects, skipped };
}

/** The project's set, compiled: what its editors register with `setCustomElementFx`. */
export async function compileProjectShaders(
	clientKey: string,
	projectKey: string,
): Promise<CompiledShaderSet> {
	return compileShaderSet((await loadShaderSet(clientKey, projectKey)).map((s) => s.doc));
}

/**
 * The compiled effects a page registers with `setCustomElementFx`. A failed read lists none rather
 * than failing the page: an entry naming one then shows as unreadable and is kept as saved.
 */
export async function loadCustomElementFx(
	clientKey: string,
	projectKey: string,
): Promise<CustomElementFx[]> {
	try {
		return (await compileProjectShaders(clientKey, projectKey)).effects;
	} catch (e) {
		console.error(`[shaders] could not compile ${clientKey}/${projectKey}'s shader graphs`, e);
		return [];
	}
}

/**
 * One graph and the ETag of its stored doc, for the save's compare-and-swap (`null` when it does
 * not exist yet). The project's own graph wins; `shared` reads the library's instead.
 */
export async function loadShader(
	clientKey: string,
	projectKey: string,
	rawId: string,
	shared = false,
): Promise<{ doc: ShaderGraphDoc; etag: string | null; exists: boolean }> {
	const id = shaderSlug(rawId);
	const key = shared ? sharedShaderDocKey(id) : shaderDocKey(clientKey, projectKey, id);
	const obj = await getObjectTextWithEtag(key);
	let raw: unknown;
	try {
		raw = obj ? JSON.parse(obj.text) : undefined;
	} catch {
		raw = undefined;
	}
	return { doc: normalizeShaderGraphDoc(raw, id), etag: obj?.etag ?? null, exists: !!obj };
}

/**
 * Whether `doc` holds Custom GLSL the project does not already store for `id` (its own graph, else
 * the shared one it would shadow): a node added, or one's code or ports changed. Removing a node,
 * or editing around one, adds none.
 */
async function addsCustomGlsl(
	clientKey: string,
	projectKey: string,
	id: string,
	doc: ShaderGraphDoc,
): Promise<boolean> {
	if (!hasCustomGlsl(doc)) return false;
	const own = await loadShader(clientKey, projectKey, id);
	const stored = own.exists ? own.doc : (await loadShader(clientKey, projectKey, id, true)).doc;
	const known = new Set(customGlslSignature(stored));
	return customGlslSignature(doc).some((definition) => !known.has(definition));
}

/**
 * Save a project's graph under its slugged id. `baseEtag: null` asserts the id is free, which stops
 * a new graph replacing a colleague's of the same name; a stale ETag is refused the same way
 * (`ConflictError`). A graph over {@link SHADER_DOC_MAX_BYTES} is refused (`ShaderTooLargeError`).
 * The bytes it replaces are kept as a backup (`docBackups.ts`), `mode` as for every doc: `'auto'`
 * coalesces a run of saves, `'always'` (a restore, a wholesale swap) keeps one each time.
 *
 * Unless `mayWriteCustomGlsl` (the saver holds `shaderCustomGlsl`), a graph that adds Custom GLSL or
 * changes its code or ports is refused (`CustomGlslNotAllowedError`). The stored version it is
 * judged against is read before the write, which its `baseEtag` then pins.
 */
export async function saveShader(
	clientKey: string,
	projectKey: string,
	rawDoc: unknown,
	baseEtag?: string | null,
	mode: BackupMode = 'auto',
	mayWriteCustomGlsl = false,
): Promise<{ id: string; doc: ShaderGraphDoc; etag: string | null }> {
	const requested =
		typeof rawDoc === 'object' && rawDoc !== null && 'id' in rawDoc && typeof rawDoc.id === 'string'
			? rawDoc.id
			: 'shader';
	const id = shaderSlug(requested);
	const doc = normalizeShaderGraphDoc(rawDoc, id);
	const text = JSON.stringify(doc, null, '\t');
	const bytes = Buffer.byteLength(text);
	if (bytes > SHADER_DOC_MAX_BYTES) throw new ShaderTooLargeError(bytes);
	if (!mayWriteCustomGlsl && (await addsCustomGlsl(clientKey, projectKey, id, doc))) {
		throw new CustomGlslNotAllowedError();
	}
	const etag = await putDocWithBackup(
		shaderDocBackupTarget(clientKey, projectKey, id),
		text,
		baseEtag,
		mode,
	);
	return { id, doc, etag };
}

/** Delete a project's graph, its last version kept in History; the shared library is never touched. */
export async function deleteShader(
	clientKey: string,
	projectKey: string,
	rawId: string,
): Promise<{ id: string }> {
	const id = shaderSlug(rawId);
	await deleteDocWithBackup(shaderDocBackupTarget(clientKey, projectKey, id), deleteObject);
	return { id };
}

/** A publish of a graph the project does not have. */
export class ShaderNotFoundError extends Error {
	constructor(readonly id: string) {
		super(`This project has no shader effect "${id}".`);
		this.name = 'ShaderNotFoundError';
	}
}

/** A publish of a graph that does not compile: it would reach every project and play nothing. */
export class ShaderDoesNotCompileError extends Error {
	constructor(
		readonly id: string,
		readonly errors: string[],
	) {
		super(`"${id}" does not compile, so it cannot go to the studio library.`);
		this.name = 'ShaderDoesNotCompileError';
	}
}

/**
 * Publish a project's graph to the studio-shared library: its stored doc, as saved, copied to
 * `_shared/shaders/<id>.json`, which every project's set then takes in (a project with its own graph
 * of that id keeps its own). `replace: false` asserts the library has no graph of that id
 * (`ConflictError` when it has); `replace: true` is the publisher's explicit overwrite. Either way the
 * bytes a publish replaces are kept (`'always'`), so a publish can be undone. A graph that does not
 * compile is refused.
 */
export async function publishShader(
	clientKey: string,
	projectKey: string,
	rawId: string,
	replace: boolean,
	mayWriteCustomGlsl = false,
): Promise<{ id: string; etag: string | null }> {
	const id = shaderSlug(rawId);
	const { doc, exists } = await loadShader(clientKey, projectKey, id);
	if (!exists) throw new ShaderNotFoundError(id);
	// The library reaches every project: putting Custom GLSL there takes the capability too.
	if (!mayWriteCustomGlsl && hasCustomGlsl(doc)) throw new CustomGlslNotAllowedError();
	const compiled = compileStored(doc);
	if (!compiled.ok) throw new ShaderDoesNotCompileError(id, compiled.errors);
	const text = JSON.stringify(doc, null, '\t');
	const bytes = Buffer.byteLength(text);
	if (bytes > SHADER_DOC_MAX_BYTES) throw new ShaderTooLargeError(bytes);
	const etag = await putDocWithBackup(
		sharedShaderDocBackupTarget(id),
		text,
		replace ? undefined : null,
		'always',
	);
	return { id, etag };
}

/**
 * Remove a graph from the studio-shared library, its last version kept in the library's history.
 * Projects that place it and have no graph of their own of that id then ship nothing for it (Publish
 * names those entries). Idempotent.
 */
export async function unpublishShader(rawId: string): Promise<{ id: string }> {
	const id = shaderSlug(rawId);
	await deleteDocWithBackup(sharedShaderDocBackupTarget(id), deleteObject);
	return { id };
}
