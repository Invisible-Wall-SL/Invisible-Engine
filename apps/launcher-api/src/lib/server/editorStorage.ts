import {
	getFullSceneSet,
	type GameJurisdiction,
	type GameSettings,
	type LayoutDoc,
	type LayoutNode,
	type LayoutType,
	type Scene,
} from 'engine-layout';
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
	'rect',
	'componentInstance',
	'reelGrid',
	'effect',
]);

/**
 * Load a project's editor document, falling back to an empty valid `LayoutDoc`.
 *
 * When the project has NEVER been saved (no object in R2) and a `gameType` is
 * known, the fresh doc's canvas box (`mainSizesMap`) + `gameType` are seeded from
 * that game type's reference layout — so a new project author works against the
 * game's REAL main box (e.g. `bookOf` → 1422×800) instead of the generic
 * `DEFAULT_MAIN_SIZES` (1920×1080), which the runtime never reads. Already-saved
 * docs round-trip byte-identical; only the never-saved default path changes.
 */
export async function loadDoc(
	clientKey: string,
	projectKey: string,
	gameType?: string,
): Promise<LayoutDoc> {
	const raw = await getObjectText(editorDocKey(clientKey, projectKey));
	if (!raw) return seedFreshDoc(projectKey, gameType);
	try {
		return normalizeDoc(JSON.parse(raw), projectKey);
	} catch {
		return normalizeDoc(undefined, projectKey);
	}
}

/**
 * Build the default doc for a never-saved project, seeding the canvas box from the
 * game-type reference layout when one exists, else the generic defaults.
 */
function seedFreshDoc(projectKey: string, gameType?: string): LayoutDoc {
	const referenceMainSizes = gameType ? getFullSceneSet(gameType)?.mainSizesMap : undefined;
	if (referenceMainSizes) {
		const doc = normalizeDoc({ mainSizesMap: referenceMainSizes }, projectKey);
		doc.gameType = gameType;
		return doc;
	}
	return normalizeDoc(undefined, projectKey);
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

/**
 * Current `LayoutDoc.version`.
 * - `1` — no `Scene.alwaysOnTop`; the engine pinned EVERY flow-active "takeover" screen at a
 *   hard-coded top band, so a doc could not express "this screen is pinned".
 * - `2` — `alwaysOnTop` is authored per screen and drives the z. A v1 doc is backfilled on
 *   read (see {@link backfillAlwaysOnTop}) so its transient screens keep the old stacking.
 */
const DOC_VERSION = 2;

/**
 * The screens the engine used to mount at the fixed top band via the active-screen takeover:
 * the boot splash and the round-celebration overlays. Under v1 they had no way to say so — the
 * takeover pinned them implicitly — so a v1 doc read under v2 rules would drop them to their
 * list position and bury them (the splash lands under the HUD). Matched by engine ROLE where
 * one exists (`loading`, id-independent), else by the legacy engine id.
 *
 * An author's OWN screens are deliberately NOT here: a persistent authored screen that merely
 * happened to be flow-active (a progress bar) is exactly what the takeover wrongly pinned, and
 * it SHOULD now layer from the Screens list. That is the bug this whole change fixes.
 */
const LEGACY_PINNED_SCENE_IDS = ['loading', 'freeSpinIntro', 'freeSpinOutro', 'bigWin'];

/**
 * One-time, idempotent parity backfill for a pre-`alwaysOnTop` (v1) doc: tick the screens the
 * engine used to pin implicitly, so an existing game's splash/celebrations keep today's
 * stacking once the z is authored. Runs on READ, so it applies before the doc is served and
 * persists on the next save (which writes {@link DOC_VERSION}). A v2+ doc is left alone — by
 * then a missing `alwaysOnTop` is a real author choice, not an absent field.
 */
function backfillAlwaysOnTop(scenes: Scene[], version: number): void {
	if (version >= DOC_VERSION) return;
	for (const scene of scenes) {
		// Match on role OR id — NOT "id when role is absent". Real docs carry `role: 'basegame'`
		// on nearly every scene as noise, which an `!scene.role` guard would read as "not the
		// legacy splash/celebration" and leave the free-spin outro to be buried.
		if (scene.role === 'loading' || LEGACY_PINNED_SCENE_IDS.includes(scene.id)) {
			scene.alwaysOnTop = true;
		}
	}
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
	const settings = normalizeGameSettings(obj.settings);
	const updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt : '';
	backfillAlwaysOnTop(scenes, typeof obj.version === 'number' ? obj.version : 1);
	const doc: LayoutDoc = { version: DOC_VERSION, projectKey, mainSizesMap, scenes, updatedAt };
	if (gameType) doc.gameType = gameType;
	if (settings) doc.settings = settings;
	return doc;
}

/**
 * Coerce the optional game-level settings (speed-feature toggles / jurisdiction)
 * into a valid {@link GameSettings}, dropping unknown values. Returns `undefined`
 * when nothing meaningful is present so older docs (no `settings`) round-trip as
 * absent rather than gaining an empty object.
 */
function normalizeGameSettings(input: unknown): GameSettings | undefined {
	if (!isRecord(input)) return undefined;
	const out: GameSettings = {};
	if (input.jurisdiction === 'default' || input.jurisdiction === 'UK') {
		out.jurisdiction = input.jurisdiction as GameJurisdiction;
	}
	if (isRecord(input.features)) {
		const f = input.features;
		const features: NonNullable<GameSettings['features']> = {};
		if (typeof f.turbo === 'boolean') features.turbo = f.turbo;
		if (typeof f.autoplay === 'boolean') features.autoplay = f.autoplay;
		if (typeof f.spaceHold === 'boolean') features.spaceHold = f.spaceHold;
		if (Object.keys(features).length > 0) out.features = features;
	}
	return Object.keys(out).length > 0 ? out : undefined;
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
	// Preserve the engine ROLE tag (`Scene.role`) — the id-independent identity the game
	// resolves the loading splash / persistent base scene by, so scene ids stay renameable.
	// Without this whitelist entry the field is silently dropped on save (the reported bug).
	if (input.role === 'loading' || input.role === 'basegame') {
		scene.role = input.role;
	}
	const align = normalizeAlign(input.align);
	if (align) scene.align = align;
	// Preserve the screen's game-lifecycle gate (`Scene.visibleSource`) — a key into the
	// game's registered visibility feeds, so the screen shows only during that phase
	// in-game. Free-text (a game may register custom keys); empty/missing = ungated.
	if (typeof input.visibleSource === 'string' && input.visibleSource) {
		scene.visibleSource = input.visibleSource;
	}
	// Preserve the author overrides for the engine-owned press-to-continue gate
	// (`Scene.gate`) on a blocking-lifecycle screen: full-window dim colour/opacity
	// and whether to hide the default prompt. Omit the object entirely if none set.
	const gate = normalizeGate(input.gate);
	if (gate) scene.gate = gate;
	// Preserve the "Always on top" tick (`Scene.alwaysOnTop`) — the author's opt-OUT of
	// screen-list layering, pinning the screen at the fixed top band instead. Without this
	// whitelist entry the field is silently dropped on save (see `role` above — same bug).
	// Sparse: stored only when true, so an untouched screen serializes exactly as before.
	if (input.alwaysOnTop === true) scene.alwaysOnTop = true;
	return scene;
}

/** Preserve a blocking screen's gate-style overrides, dropping unknown/empty values. */
function normalizeGate(input: unknown): Scene['gate'] | undefined {
	if (!isRecord(input)) return undefined;
	const out: NonNullable<Scene['gate']> = {};
	if (typeof input.dimColor === 'number' && Number.isFinite(input.dimColor)) {
		out.dimColor = input.dimColor;
	}
	if (typeof input.dimAlpha === 'number' && Number.isFinite(input.dimAlpha)) {
		out.dimAlpha = input.dimAlpha;
	}
	if (typeof input.hidePrompt === 'boolean') out.hidePrompt = input.hidePrompt;
	return Object.keys(out).length > 0 ? out : undefined;
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
