import {
	getTemplate,
	type GameTemplate,
	type SlotKind,
	type TemplateScene,
	type TemplateSlot,
} from 'engine-layout';
import { editorTemplateKey } from './projectPaths';
import { getObjectTextWithEtag, precondition, putObjectText } from './r2';

const SLOT_KINDS = new Set<SlotKind>(['sprite', 'spine', 'text', 'mount']);

/**
 * Resolve a game type's template: R2 override first (`_shared/editor-templates/
 * <gameType>.json`), built-in code fallback second (§7.5). A malformed or
 * unreadable R2 doc never throws — it falls back to the built-in. Returns
 * `undefined` only when neither source has a template for `gameType`.
 */
export async function loadTemplate(gameType: string): Promise<GameTemplate | undefined> {
	return (await loadTemplateWithEtag(gameType)).template;
}

/**
 * {@link loadTemplate} plus the ETag its next save must match.
 *
 * `etag === null` means there is NO R2 override — the returned template is then the
 * built-in code fallback, and saving becomes a create (`ifNoneMatch: '*'`). Note the
 * asymmetry that makes this subtle: an R2 override that is present but MALFORMED also
 * returns the built-in fallback, yet it carries an etag, so its save correctly
 * overwrites the corruption instead of trying (and forever failing) to create.
 * See `docs/design/multi-user-concurrency.md` Phase 1.
 */
export async function loadTemplateWithEtag(
	gameType: string,
): Promise<{ template: GameTemplate | undefined; etag: string | null }> {
	const fallback = getTemplate(gameType);
	let obj: { text: string; etag: string | null } | null;
	try {
		obj = await getObjectTextWithEtag(editorTemplateKey(gameType));
	} catch {
		return { template: fallback, etag: null };
	}
	if (!obj) return { template: fallback, etag: null };
	try {
		const parsed = JSON.parse(obj.text);
		if (isTemplateShape(parsed)) return { template: normalizeTemplate(parsed), etag: obj.etag };
	} catch {
		return { template: fallback, etag: obj.etag };
	}
	return { template: fallback, etag: obj.etag };
}

/**
 * Persist an authored template to its shared R2 key (§7.5). Validates the
 * minimum contract first and throws a descriptive Error on a bad payload, so the
 * write only ever happens for a well-formed template.
 *
 * Guarded by `baseEtag` — the key is GLOBAL (one object per game type, shared by every
 * project), so a lease can't cover it and a stale etag throws `ConflictError` rather
 * than discarding another author's slot edits. Returns the new ETag.
 */
export async function saveTemplate(
	template: GameTemplate,
	baseEtag?: string | null,
): Promise<{ template: GameTemplate; etag: string | null }> {
	if (typeof template !== 'object' || template === null) {
		throw new Error('Template must be an object.');
	}
	if (typeof template.gameType !== 'string' || !template.gameType.trim()) {
		throw new Error('Template requires a non-empty gameType.');
	}
	if (template.version !== 1) {
		throw new Error('Template version must be 1.');
	}
	if (!Array.isArray(template.scenes)) {
		throw new Error('Template scenes must be an array.');
	}
	const normalized = normalizeTemplate(template);
	const etag = await putObjectText(
		editorTemplateKey(normalized.gameType),
		JSON.stringify(normalized, null, 2),
		'application/json',
		precondition(baseEtag),
	);
	return { template: normalized, etag };
}

/** Coerce parsed/posted data into a clean `GameTemplate`, dropping bad slots/scenes. */
export function normalizeTemplate(raw: GameTemplate): GameTemplate {
	const scenes = raw.scenes.map(normalizeScene).filter((s): s is TemplateScene => s !== null);
	return { gameType: raw.gameType.trim(), version: 1, scenes };
}

function normalizeScene(input: unknown): TemplateScene | null {
	if (!isRecord(input)) return null;
	const id = typeof input.id === 'string' && input.id ? input.id : null;
	if (!id) return null;
	const name = typeof input.name === 'string' ? input.name : '';
	const slots = Array.isArray(input.slots)
		? input.slots.map(normalizeSlot).filter((s): s is TemplateSlot => s !== null)
		: [];
	return { id, name, slots };
}

function normalizeSlot(input: unknown): TemplateSlot | null {
	if (!isRecord(input)) return null;
	const slotId = typeof input.slotId === 'string' && input.slotId ? input.slotId : null;
	if (!slotId) return null;
	const kind = input.kind;
	if (typeof kind !== 'string' || !SLOT_KINDS.has(kind as SlotKind)) return null;
	const slot: TemplateSlot = {
		slotId,
		name: typeof input.name === 'string' ? input.name : '',
		kind: kind as SlotKind,
	};
	if (input.required === true) slot.required = true;
	if (typeof input.mountComponent === 'string' && input.mountComponent) {
		slot.mountComponent = input.mountComponent;
	}
	if (Array.isArray(input.accepts)) {
		const accepts = input.accepts.filter(
			(a): a is 'sprite' | 'spine' | 'text' => a === 'sprite' || a === 'spine' || a === 'text',
		);
		if (accepts.length) slot.accepts = accepts;
	}
	return slot;
}

/** Light shape check used to decide whether an R2 doc is usable as a template. */
function isTemplateShape(input: unknown): input is GameTemplate {
	if (!isRecord(input)) return false;
	if (typeof input.gameType !== 'string' || !input.gameType) return false;
	if (input.version !== 1) return false;
	if (!Array.isArray(input.scenes)) return false;
	return input.scenes.every(
		(s) =>
			isRecord(s) &&
			typeof s.id === 'string' &&
			typeof s.name === 'string' &&
			Array.isArray(s.slots),
	);
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
