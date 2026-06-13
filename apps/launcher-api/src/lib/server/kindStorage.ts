import type { LayoutDoc } from 'engine-layout';
import { GAME_KINDS } from '$lib/roles';
import { normalizeDoc } from './editorStorage';
import { editorKindKey, sharedKindsPrefix } from './projectPaths';
import { getObjectText, listAllObjects, putObjectText } from './r2';

/**
 * Custom game KINDS authored in the editor (§21). A custom kind is an
 * engine-skeleton `LayoutDoc` the author composed on the canvas, stored shared at
 * `_shared/editor-kinds/<id>.json`. It appears in the "New game from kind" picker
 * alongside the built-ins; the scaffold runs `engineOwnedOnly(doc)` over it
 * exactly like a built-in kind — so a new kind needs no code change.
 *
 * Mirrors `templateStorage.ts`: R2 get/put + validate/normalize + a list that
 * reuses the existing object-listing helper. A custom kind is a `LayoutDoc`, NOT a
 * `GameTemplate` slot-skeleton (§21.1).
 */

export interface CustomKind {
	id: string;
	name: string;
	doc: LayoutDoc;
}

/** Slug rule for a kind id (§21.2) — matches the design doc verbatim. */
const KIND_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Built-in kind ids a custom kind must NOT collide with (§21.2). Canonical set. */
const BUILTIN_KIND_IDS = new Set<string>(GAME_KINDS);

/**
 * List every custom kind's `{ id, name }`. Reads each small JSON (the library is
 * tiny + the file carries the authored `name`); a malformed/unreadable entry is
 * skipped rather than failing the whole list. Sorted by `name` for a stable picker.
 */
export async function listKinds(): Promise<{ id: string; name: string }[]> {
	const objects = await listAllObjects(sharedKindsPrefix);
	const out: { id: string; name: string }[] = [];
	for (const obj of objects) {
		if (!obj.key.endsWith('.json')) continue;
		let raw: string | null;
		try {
			raw = await getObjectText(obj.key);
		} catch {
			continue;
		}
		if (!raw) continue;
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (isRecord(parsed) && typeof parsed.id === 'string' && parsed.id) {
				const name = typeof parsed.name === 'string' && parsed.name ? parsed.name : parsed.id;
				out.push({ id: parsed.id, name });
			}
		} catch {
			continue;
		}
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}

/**
 * Resolve one custom kind's `{ id, name, doc }`, normalizing the stored `doc` into
 * a clean `LayoutDoc`. Returns `undefined` when the key is missing or unreadable.
 */
export async function loadKind(id: string): Promise<CustomKind | undefined> {
	if (!KIND_ID_RE.test(id)) return undefined;
	let raw: string | null;
	try {
		raw = await getObjectText(editorKindKey(id));
	} catch {
		return undefined;
	}
	if (!raw) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed) || typeof parsed.id !== 'string' || !parsed.id) return undefined;
	const name = typeof parsed.name === 'string' && parsed.name ? parsed.name : parsed.id;
	return { id: parsed.id, name, doc: normalizeDoc(parsed.doc, parsed.id) };
}

/**
 * Persist an authored custom kind to its shared R2 key (§21.3). Validates the
 * contract first and throws a descriptive Error on a bad payload (the endpoint
 * maps it to 400), so a malformed kind can never be stored:
 * - `id` matches the slug rule;
 * - `id` does NOT collide with a built-in kind (`lines|ways|cluster|scatter|bookOf`);
 * - `name` is non-empty;
 * - `doc` normalizes to a valid `LayoutDoc` with at least one scene.
 */
export async function saveKind(input: CustomKind): Promise<CustomKind> {
	if (!isRecord(input)) throw new Error('Kind must be an object.');
	const id = typeof input.id === 'string' ? input.id.trim() : '';
	if (!KIND_ID_RE.test(id)) {
		throw new Error(
			'Kind id must be a slug: lowercase letters/digits, then letters/digits/_/- (1–64 chars).',
		);
	}
	if (BUILTIN_KIND_IDS.has(id)) {
		throw new Error(`"${id}" is a built-in game kind — choose a different id.`);
	}
	const name = typeof input.name === 'string' ? input.name.trim() : '';
	if (!name) throw new Error('Kind requires a non-empty name.');
	const doc = normalizeDoc(input.doc, id);
	if (doc.scenes.length === 0) {
		throw new Error('Kind doc must have at least one scene.');
	}
	const kind: CustomKind = { id, name, doc };
	await putObjectText(editorKindKey(id), JSON.stringify(kind, null, 2), 'application/json');
	return kind;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
