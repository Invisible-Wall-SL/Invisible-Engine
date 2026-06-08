import type { LayoutDoc, LayoutNode, LayoutType, Scene } from 'engine-layout';
import { editorDocKey } from './projectPaths';
import { getObjectText, putObjectText } from './r2';

/** Sensible base sizes per layoutType; mirrors `utils-layout`'s `mainSizesMap`. */
const DEFAULT_MAIN_SIZES: Record<LayoutType, { width: number; height: number }> = {
	desktop: { width: 1920, height: 1080 },
	tablet: { width: 1280, height: 800 },
	landscape: { width: 1024, height: 576 },
	portrait: { width: 576, height: 1024 },
};

const LAYOUT_TYPES: LayoutType[] = ['desktop', 'tablet', 'landscape', 'portrait'];

const NODE_KINDS = new Set<LayoutNode['kind']>([
	'container',
	'sprite',
	'spine',
	'text',
	'componentInstance',
	'reelGrid',
]);

/** Load a project's editor document, falling back to an empty valid `LayoutDoc`. */
export async function loadDoc(clientKey: string, projectKey: string): Promise<LayoutDoc> {
	const raw = await getObjectText(editorDocKey(clientKey, projectKey));
	if (!raw) return normalizeDoc(undefined, projectKey);
	try {
		return normalizeDoc(JSON.parse(raw), projectKey);
	} catch {
		return normalizeDoc(undefined, projectKey);
	}
}

/** Persist a project's editor document to R2 (stamps `updatedAt`). */
export async function saveDoc(
	clientKey: string,
	projectKey: string,
	doc: LayoutDoc,
): Promise<LayoutDoc> {
	const next = normalizeDoc(doc, projectKey);
	next.updatedAt = new Date().toISOString();
	await putObjectText(
		editorDocKey(clientKey, projectKey),
		JSON.stringify(next, null, 2),
		'application/json',
	);
	return next;
}

/** Coerce arbitrary parsed/posted data into a valid `LayoutDoc` shape. */
export function normalizeDoc(input: unknown, fallbackProjectKey = ''): LayoutDoc {
	const obj = isRecord(input) ? input : {};
	const projectKey =
		typeof obj.projectKey === 'string' && obj.projectKey ? obj.projectKey : fallbackProjectKey;
	const gameType =
		typeof obj.gameType === 'string' && obj.gameType.trim() ? obj.gameType.trim() : undefined;
	const mainSizesMap = normalizeMainSizesMap(obj.mainSizesMap);
	const scenes = Array.isArray(obj.scenes)
		? obj.scenes.map(normalizeScene).filter((s): s is Scene => s !== null)
		: [];
	const updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt : '';
	const doc: LayoutDoc = { version: 1, projectKey, mainSizesMap, scenes, updatedAt };
	if (gameType) doc.gameType = gameType;
	return doc;
}

function normalizeMainSizesMap(
	input: unknown,
): Record<LayoutType, { width: number; height: number }> {
	const src = isRecord(input) ? input : {};
	const out: Record<LayoutType, { width: number; height: number }> = { ...DEFAULT_MAIN_SIZES };
	for (const t of LAYOUT_TYPES) {
		const candidate = src[t];
		if (isRecord(candidate)) {
			const width = typeof candidate.width === 'number' ? candidate.width : out[t].width;
			const height = typeof candidate.height === 'number' ? candidate.height : out[t].height;
			out[t] = { width, height };
		}
	}
	return out;
}

function normalizeScene(input: unknown): Scene | null {
	if (!isRecord(input)) return null;
	const id = typeof input.id === 'string' && input.id ? input.id : null;
	const name = typeof input.name === 'string' ? input.name : '';
	if (!id) return null;
	const nodes = Array.isArray(input.nodes)
		? input.nodes.map(normalizeNode).filter((n): n is LayoutNode => n !== null)
		: [];
	const scene: Scene = { id, name, nodes };
	// Preserve the coordinate-space tag; 'game' is the default so it's omitted.
	// `standard` honours `align`; `background` cover-fits; `canvas` uses screenAnchor.
	if (input.space === 'standard' || input.space === 'canvas' || input.space === 'background') {
		scene.space = input.space;
	}
	const align = normalizeAlign(input.align);
	if (align) scene.align = align;
	return scene;
}

/** Preserve a `standard` scene's alignment, dropping unknown/empty values. */
function normalizeAlign(input: unknown): Scene['align'] | undefined {
	if (!isRecord(input)) return undefined;
	const out: NonNullable<Scene['align']> = {};
	if (input.vertical === 'center' || input.vertical === 'bottom') out.vertical = input.vertical;
	if (
		input.horizontal === 'center' ||
		input.horizontal === 'left' ||
		input.horizontal === 'right'
	) {
		out.horizontal = input.horizontal;
	}
	return out.vertical || out.horizontal ? out : undefined;
}

function normalizeNode(input: unknown): LayoutNode | null {
	if (!isRecord(input)) return null;
	const kind = input.kind;
	if (typeof kind !== 'string' || !NODE_KINDS.has(kind as LayoutNode['kind'])) return null;
	if (typeof input.id !== 'string' || !input.id) return null;
	// Preserve forward-compatible fields by trusting the validated kind+id; the
	// engine layer is the source of truth for per-kind field semantics.
	return input as unknown as LayoutNode;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
