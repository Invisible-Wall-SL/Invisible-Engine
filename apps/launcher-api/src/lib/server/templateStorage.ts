import {
	getTemplate,
	type GameTemplate,
	type SlotKind,
	type TemplateScene,
	type TemplateSlot,
} from 'engine-layout';
import { editorTemplateKey } from './projectPaths';
import { getObjectText, putObjectText } from './r2';

// Re-exported so server callers (projectScaffold) keep importing it from here.
export { seedScenesFromTemplate } from 'engine-layout';

const SLOT_KINDS = new Set<SlotKind>(['sprite', 'spine', 'text', 'mount']);

/**
 * Resolve a game type's template: R2 override first (`_shared/editor-templates/
 * <gameType>.json`), built-in code fallback second (§7.5). A malformed or
 * unreadable R2 doc never throws — it falls back to the built-in. Returns
 * `undefined` only when neither source has a template for `gameType`.
 */
export async function loadTemplate(gameType: string): Promise<GameTemplate | undefined> {
	const fallback = getTemplate(gameType);
	let raw: string | null;
	try {
		raw = await getObjectText(editorTemplateKey(gameType));
	} catch {
		return fallback;
	}
	if (!raw) return fallback;
	try {
		const parsed = JSON.parse(raw);
		if (isTemplateShape(parsed)) return normalizeTemplate(parsed);
	} catch {
		return fallback;
	}
	return fallback;
}

/**
 * Persist an authored template to its shared R2 key (§7.5). Validates the
 * minimum contract first and throws a descriptive Error on a bad payload, so the
 * write only ever happens for a well-formed template.
 */
export async function saveTemplate(template: GameTemplate): Promise<void> {
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
	await putObjectText(
		editorTemplateKey(normalized.gameType),
		JSON.stringify(normalized, null, 2),
		'application/json',
	);
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
