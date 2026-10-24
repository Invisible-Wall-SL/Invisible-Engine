import type { CustomElementFx } from 'constants-shared/elementFx';
import {
	compileShaderEffect,
	normalizeShaderGraphDoc,
	type GraphIssue,
	type ShaderGraphDoc,
} from 'engine-shadergraph';
import { mapWithConcurrency } from './concurrency';
import {
	SHARED_SHADERS_PREFIX,
	SUB,
	shaderDocKey,
	shaderSlug,
	sharedShaderDocKey,
} from './projectPaths';
import {
	deleteObject,
	getObjectText,
	getObjectTextWithEtag,
	listAllKeys,
	precondition,
	putObjectText,
} from './r2';

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

export interface ShaderRow {
	id: string;
	name: string;
	description: string;
	/** From the studio-shared library rather than the project. */
	shared: boolean;
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
): Promise<{ doc: ShaderGraphDoc; shared: boolean }[]> {
	const [own, library] = await Promise.all([
		readDocs(SUB.shaders(clientKey, projectKey)),
		readDocs(SHARED_SHADERS_PREFIX),
	]);
	const ids = new Set(own.map((d) => d.id));
	const shared = library.filter((d) => !ids.has(d.id));
	return [
		...own.map((doc) => ({ doc, shared: false })),
		...shared.map((doc) => ({ doc, shared: true })),
	].sort((a, b) => a.doc.name.localeCompare(b.doc.name) || a.doc.id.localeCompare(b.doc.id));
}

export async function listShaders(clientKey: string, projectKey: string): Promise<ShaderRow[]> {
	return (await loadShaderSet(clientKey, projectKey)).map(({ doc, shared }) => ({
		id: doc.id,
		name: doc.name || doc.id,
		description: doc.description ?? '',
		shared,
	}));
}

const errorText = (issue: GraphIssue): string =>
	issue.node ? `${issue.node}: ${issue.message}` : issue.message;

/** Compile every doc: what plays as `custom:<id>`, and what did not compile and why. */
export function compileShaderSet(docs: readonly ShaderGraphDoc[]): CompiledShaderSet {
	const effects: CustomElementFx[] = [];
	const skipped: ShaderSkip[] = [];
	for (const doc of docs) {
		const result = compileShaderEffect(doc);
		if (result.ok) effects.push(result.effect);
		else
			skipped.push({
				id: doc.id,
				name: doc.name || doc.id,
				errors: result.issues.filter((i) => i.level === 'error').map(errorText),
			});
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
 * Save a project's graph under its slugged id. `baseEtag: null` asserts the id is free, which stops
 * a new graph replacing a colleague's of the same name; a stale ETag is refused the same way
 * (`ConflictError`). A graph over {@link SHADER_DOC_MAX_BYTES} is refused (`ShaderTooLargeError`).
 */
export async function saveShader(
	clientKey: string,
	projectKey: string,
	rawDoc: unknown,
	baseEtag?: string | null,
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
	const etag = await putObjectText(
		shaderDocKey(clientKey, projectKey, id),
		text,
		'application/json',
		precondition(baseEtag),
	);
	return { id, doc, etag };
}

/** Delete a project's graph; the shared library is never touched. Idempotent. */
export async function deleteShader(
	clientKey: string,
	projectKey: string,
	rawId: string,
): Promise<{ id: string }> {
	const id = shaderSlug(rawId);
	await deleteObject(shaderDocKey(clientKey, projectKey, id));
	return { id };
}
