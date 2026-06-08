import {
	projectComponentDefaultsKey,
	projectComponentDefaultsPrefix,
} from './projectPaths';
import { getObjectText, listAllKeys, putObjectText } from './r2';

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

/**
 * Read the project defaults for one component, returning the bare `params` map.
 * Returns `{}` on a missing / unreadable / malformed / non-`params` doc — never
 * throws (mirrors `readComponent`'s swallow-and-fallback).
 */
export async function loadComponentDefaults(
	projectKey: string,
	componentId: string,
): Promise<Record<string, unknown>> {
	return readDefaults(projectComponentDefaultsKey(projectKey, componentId));
}

/**
 * Persist the project defaults for one component. Validates `params` is a plain
 * object and throws a descriptive Error on a bad payload (surfaced as a 400 by the
 * route), so the write only ever happens for a well-formed map. Writes the canonical
 * `{ params }` envelope pretty-printed, like `saveComponent`.
 */
export async function saveComponentDefaults(
	projectKey: string,
	componentId: string,
	params: Record<string, unknown>,
): Promise<void> {
	if (!isRecord(params)) {
		throw new Error('Component defaults `params` must be a plain object.');
	}
	const key = projectComponentDefaultsKey(projectKey, componentId);
	await putObjectText(key, JSON.stringify({ params }, null, 2), 'application/json');
}

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
