import {
	projectComponentDefaultsKey,
	projectComponentDefaultsPrefix,
	r2Slug,
} from './projectPaths';
import {
	ConflictError,
	getObjectText,
	getObjectTextWithEtag,
	listAllKeys,
	precondition,
	putObjectText,
} from './r2';

/**
 * Per-project component-DEFAULTS store (§13.3) — a thin sidecar to `ComponentDef`,
 * NOT a new `scope`, so a shared def can carry per-project author-set param
 * defaults without forking the def. The R2 doc at
 * `editor/<projectKey>/component-defaults/<componentId>.json` is `{ params: {…} }`.
 *
 * Mirrors `componentStorage`'s discipline: reads NEVER throw (swallow + fall back
 * to `{}`), writes validate the minimum contract first. Precedence is resolved
 * elsewhere by `resolveComponentParams` (instance ◁ project default ◁ def default).
 */

/** The defaults `params` for one component WITH the ETag its next save must match. */
export interface ComponentDefaultsWithEtag {
	params: Record<string, unknown>;
	/**
	 * ETag of the stored sidecar; `null` when it does not exist yet (⇒ first save creates via
	 * `ifNoneMatch:'*'`). A corrupt-but-present sidecar still carries its etag — reported from
	 * the READ, not from parse success — so it gets `ifMatch` (deliberate overwrite), never a
	 * create precondition that would 412 forever. See `docs/design/multi-user-concurrency.md`.
	 */
	etag: string | null;
}

/**
 * Read the project defaults for one component plus the ETag its next save must match — the
 * read half of the conditional-write contract (Phase 1). Unlike `readDefaults` / the
 * `listComponentDefaults` hydration path (which degrade to `{}`), this does NOT swallow a
 * transient R2 read error: on the
 * SAVE path a swallow would make a present sidecar look absent, so the save would assert
 * create and clobber it. `getObjectTextWithEtag` rethrows everything but a 404.
 */
export async function loadComponentDefaultsWithEtag(
	projectKey: string,
	componentId: string,
): Promise<ComponentDefaultsWithEtag> {
	const key = projectComponentDefaultsKey(projectKey, componentId);
	const obj = await getObjectTextWithEtag(key);
	if (!obj) return { params: {}, etag: null };
	try {
		const parsed: unknown = JSON.parse(obj.text);
		if (isRecord(parsed) && isRecord(parsed.params)) {
			return { params: parsed.params, etag: obj.etag };
		}
	} catch {
		// present but corrupt — fall through: it EXISTS, so it carries an etag and is overwritten
		// deliberately with `ifMatch`, never wedged behind a create precondition.
	}
	return { params: {}, etag: obj.etag };
}

/**
 * Persist the project defaults for one component. Validates `params` is a plain
 * object and throws a descriptive Error on a bad payload (surfaced as a 400 by the
 * route), so the write only ever happens for a well-formed map. Writes the canonical
 * `{ params }` envelope pretty-printed, like `saveComponent`.
 *
 * `baseEtag` guards the write (Phase 1 of `docs/design/multi-user-concurrency.md`): a
 * string ⇒ `ifMatch`, `null` ⇒ `ifNoneMatch:'*'` (create), `undefined` ⇒ unconditional
 * (server-side callers only). A stale one throws {@link ConflictError} — the route maps it
 * to a 409 — rather than silently erasing a concurrent author's per-project appearance
 * defaults. Returns the new ETag so the client can keep saving without a re-read.
 */
export async function saveComponentDefaults(
	projectKey: string,
	componentId: string,
	params: Record<string, unknown>,
	baseEtag?: string | null,
): Promise<{ etag: string | null }> {
	if (!isRecord(params)) {
		throw new Error('Component defaults `params` must be a plain object.');
	}
	const key = projectComponentDefaultsKey(projectKey, componentId);
	const etag = await putObjectText(
		key,
		JSON.stringify({ params }, null, 2),
		'application/json',
		precondition(baseEtag),
	);
	return { etag };
}

export { ConflictError };

/**
 * List every component-defaults sidecar under the project prefix as a
 * `componentId → params` map. Skips malformed entries (never throws), so one read
 * hydrates the Component Editor page. The componentId is the R2 key's basename
 * (already `r2Slug`-normalized when written).
 */
export async function listComponentDefaults(
	projectKey: string,
): Promise<Record<string, Record<string, unknown>>> {
	let keys: string[];
	try {
		keys = await listAllKeys(projectComponentDefaultsPrefix(projectKey));
	} catch {
		return {};
	}
	const out: Record<string, Record<string, unknown>> = {};
	for (const key of keys) {
		if (!key.endsWith('.json')) continue;
		const params = await readDefaults(key);
		const id = basename(key);
		if (id) out[id] = params;
	}
	return out;
}

/**
 * Alias every {@link listComponentDefaults} entry under the REAL `ComponentDef.id` it belongs to.
 *
 * The sidecar's filename is `r2Slug(componentId)`, so a camelCase id stores as
 * `hudreadout.json` and the listed map is keyed `hudreadout` — which `defaults[def.id]`
 * (`'hudReadout'`) never matches. The per-id GET/POST never hit this because they build the key
 * from the id; only the LIST path is slugged. Callers that hold the component list pass their ids
 * here so a lookup by def id resolves. Additive: the original basename keys are kept, so an orphan
 * sidecar (its component deleted) is never dropped from the map.
 */
export function keyComponentDefaultsById(
	defaults: Record<string, Record<string, unknown>>,
	ids: string[],
): Record<string, Record<string, unknown>> {
	const out = { ...defaults };
	for (const id of ids) {
		const params = defaults[r2Slug(id)];
		if (params) out[id] = params;
	}
	return out;
}

/** Read + unwrap one defaults key's `params`, swallowing any read/parse failure. */
async function readDefaults(key: string): Promise<Record<string, unknown>> {
	let raw: string | null;
	try {
		raw = await getObjectText(key);
	} catch {
		return {};
	}
	if (!raw) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		if (isRecord(parsed) && isRecord(parsed.params)) return parsed.params;
	} catch {
		return {};
	}
	return {};
}

/** The `<id>` of a `…/component-defaults/<id>.json` key (filename without suffix). */
function basename(key: string): string {
	const file = key.slice(key.lastIndexOf('/') + 1);
	return file.endsWith('.json') ? file.slice(0, -'.json'.length) : file;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
