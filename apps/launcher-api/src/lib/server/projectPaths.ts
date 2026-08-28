/**
 * Canonical R2 layout for per-project storage. One source of truth for every
 * tool/area key, so the launcher, the tools, and the migration agree.
 *
 * Layout: one unified project repo `<client>/<project>/…` organized by asset
 * type (NOT by tool) — see `docs/design/unified-project-repo.md`. The reserved
 * client key `unassigned` covers projects with `client_key IS NULL`.
 *
 * The R2 prefix is built from `r2Slug(client)`/`r2Slug(project)`, the exact same
 * normalization the Python tools apply (`[^a-z0-9] → _`, lowercased, 60 chars).
 * The DB project/client KEYS stay as-is; only the R2 prefix is normalized. This
 * keeps the launcher and the Python tools byte-identical and fixes the historic
 * hyphen/underscore mismatch (`my-game` → `my_game`).
 */

import { isValidSoundFile } from 'engine-layout';

export const UNASSIGNED_CLIENT = 'unassigned';

/**
 * Normalize a client/project name into the R2 path segment both the launcher
 * and the Python tools use. MUST stay byte-identical to the Python side.
 */
export function r2Slug(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '_')
			.slice(0, 60) || 'default'
	);
}

/** Root of one project's R2 repository: `<client>/<project>` (no trailing slash). */
export function projectPrefix(client: string, project: string): string {
	return `${r2Slug(client)}/${r2Slug(project)}`;
}

/**
 * Asset-type subfolders — the one place each path lives. Producers write and
 * consumers read these; `manifests/` is shared by Atlas + Sheet.
 */
export const SUB = {
	manifests: (c: string, p: string) => `${projectPrefix(c, p)}/manifests`,
	// Atlas Maker inputs: reference images + `input/refs/atlas/<name>` geometry.
	input: (c: string, p: string) => `${projectPrefix(c, p)}/input`,
	atlas: (c: string, p: string) => `${projectPrefix(c, p)}/atlas`,
	sheets: (c: string, p: string) => `${projectPrefix(c, p)}/sheets`,
	deploy: (c: string, p: string) => `${projectPrefix(c, p)}/deploy`,
	spines: (c: string, p: string) => `${projectPrefix(c, p)}/spines`,
	localization: (c: string, p: string) => `${projectPrefix(c, p)}/localization`,
	editor: (c: string, p: string) => `${projectPrefix(c, p)}/editor`,
	fonts: (c: string, p: string) => `${projectPrefix(c, p)}/fonts`,
	symbols: (c: string, p: string) => `${projectPrefix(c, p)}/symbols`,
	winText: (c: string, p: string) => `${projectPrefix(c, p)}/win-text`,
	sounds: (c: string, p: string) => `${projectPrefix(c, p)}/sounds`,
	config: (c: string, p: string) => `${projectPrefix(c, p)}/config`,
	cinematics: (c: string, p: string) => `${projectPrefix(c, p)}/cinematics`,
	storybook: (c: string, p: string) => `${projectPrefix(c, p)}/storybook`,
} as const;

/** The engine reference Storybook (apps/lines), outside any single project. */
export const SHARED_ENGINE_STORYBOOK_PREFIX = '_shared/storybook/engine';

/** Cross-project shared spines, outside any single project: `_shared/spines/<bundle>`. */
export const sharedSpinesPrefix = (bundle: string) => `_shared/spines/${bundle}`;

/**
 * Cross-project shared SHEETS, outside any single project: `_shared/sheets/<folder>`.
 *
 * The library any project can bind art from without owning it — seeded with the engine's own
 * symbol set, so a new project has something to draw before it has commissioned anything.
 *
 * It needs no resolver of its own, and that is worth stating because it looks like it should: a
 * sheet is addressed by the FULL R2 key of its manifest (`isManifestAssetKey` = contains `/`,
 * ends `.json`), and every consumer — `loadRegionSet`, `resolvePageKey`, the editor-art export —
 * reads that key verbatim and looks for the page image in the manifest's OWN directory first. So
 * a shared sheet travels the export → deploy → bake → pull chain exactly like a project one.
 */
export const sharedSheetsPrefix = (folder: string) => `_shared/sheets/${folder}`;

/** Cross-project shared fonts, outside any single project: `_shared/fonts/<folder>`. */
export const sharedFontsPrefix = (folder: string) => `_shared/fonts/${folder}`;

/** Per-project font catalog manifest: `<client>/<project>/fonts/fonts.json`. */
export function fontCatalogKey(client: string, project: string): string {
	return `${SUB.fonts(client, project)}/fonts.json`;
}

/** Per-project font bundle prefix, e.g. `borut/bookofborut/fonts/goldFont`. */
export function fontBundlePath(client: string, project: string, folder: string): string {
	assertBundle(folder);
	return `${SUB.fonts(client, project)}/${folder}`;
}

/** Cross-project fallback for shared font folders: `_shared/fonts/<folder>`. */
export function fontBundleSharedPath(folder: string): string {
	assertBundle(folder);
	return sharedFontsPrefix(folder);
}

/**
 * Editor game-type templates are GLOBAL (per game type, not per project), so they
 * live under the shared `_shared/editor-templates/<gameType>.json` prefix (§7.5).
 * This is the R2 override that takes precedence over the built-in code fallback.
 */
export function editorTemplateKey(gameType: string): string {
	return `_shared/editor-templates/${r2Slug(gameType)}.json`;
}

/**
 * A custom game KIND authored in the editor (§21) is GLOBAL/shared, like a game
 * template — its engine-skeleton `LayoutDoc` lives at
 * `_shared/editor-kinds/<id>.json`. This is the source the "New game from kind"
 * picker reads alongside the built-in kinds. The id runs through `r2Slug` to match
 * the launcher/Python normalization everywhere else.
 */
export function editorKindKey(id: string): string {
	return `_shared/editor-kinds/${r2Slug(id)}.json`;
}

/** Prefix for listing the shared custom-kind library (§21). */
export const sharedKindsPrefix = '_shared/editor-kinds/';

/**
 * Editor components (the prefab tier — §8.3) come in two scopes, symmetric with
 * scenes/templates:
 *
 * - SHARED: `_shared/editor-components/<id>.json` — reusable across all
 *   clients/projects/game types (like `editorTemplateKey`'s `_shared/` home).
 * - PROJECT: `editor/<projectKey>/components/<id>.json` — project-local; shadows
 *   a shared component of the same id.
 *
 * The id + projectKey are run through `r2Slug` so the key matches the
 * launcher/Python normalization everywhere else (fixes the historic
 * hyphen/underscore mismatch).
 */
export function editorComponentKey(id: string): string {
	return `_shared/editor-components/${r2Slug(id)}.json`;
}

export function projectComponentKey(projectKey: string, id: string): string {
	return `editor/${r2Slug(projectKey)}/components/${r2Slug(id)}.json`;
}

/**
 * Versioned-history key for a component (§8.9 v2 multi-version store). Each save
 * writes the def to BOTH `<id>.json` (the "latest" pointer that pre-v2 single-doc
 * readers — `loadComponent` without a version, `listComponents` — keep loading
 * byte-identically) AND `<id>.v<N>.json` (this immutable historical snapshot). A
 * pinned instance resolves the EXACT def it was authored against by reading its
 * `.v<N>.json`. The `v<N>` suffix sits BEFORE `.json` so the listing globs that
 * match `*.json` still see them; they are filtered out of the latest-pointer
 * listing by the `.v<N>.json` shape (see `componentStorage.ts`).
 */
export function editorComponentVersionKey(id: string, version: number): string {
	return `_shared/editor-components/${r2Slug(id)}.v${version}.json`;
}

export function projectComponentVersionKey(
	projectKey: string,
	id: string,
	version: number,
): string {
	return `editor/${r2Slug(projectKey)}/components/${r2Slug(id)}.v${version}.json`;
}

/** Prefix for listing a project's components (delimited or recursive). */
export function projectComponentsPrefix(projectKey: string): string {
	return `editor/${r2Slug(projectKey)}/components/`;
}

/**
 * Per-project component-DEFAULTS sidecar (§13.3): author-set param defaults for a
 * component within a project, stored as `{ params: Record<string, unknown> }`.
 * Lives at `editor/<projectKey>/component-defaults/<id>.json` — a thin sidecar so a
 * shared def can carry per-project defaults without forking the def. The id +
 * projectKey run through `r2Slug` to match the launcher/Python normalization.
 */
export function projectComponentDefaultsKey(projectKey: string, id: string): string {
	return `editor/${r2Slug(projectKey)}/component-defaults/${r2Slug(id)}.json`;
}

/** Prefix for listing a project's component-defaults sidecars. */
export function projectComponentDefaultsPrefix(projectKey: string): string {
	return `editor/${r2Slug(projectKey)}/component-defaults/`;
}

/** Prefix for listing the shared component library. */
export const sharedComponentsPrefix = '_shared/editor-components/';

/**
 * Cross-project animation library (Rigger §5.6). A saved animation is GLOBAL —
 * project-agnostic — so authors can reuse a clip on any rig in any client/project.
 * It lives under `_shared/animations/`, alongside the other `_shared/` libraries.
 * The per-animation file is `_shared/animations/<id>.json`; the lightweight catalog
 * is `_shared/animations/index.json`. The id runs through `r2Slug` to match the
 * launcher/Python normalization everywhere else.
 * See `docs/design/invisible-rigger.md`.
 */
export const sharedAnimationsPrefix = '_shared/animations';
export const sharedAnimationsIndexKey = '_shared/animations/index.json';
export function sharedAnimationKey(id: string): string {
	return `${sharedAnimationsPrefix}/${r2Slug(id)}.json`;
}

/**
 * Cross-project RIG library (Rigger §5.8). A saved rig is the WHOLE skeleton doc —
 * bones + slots + skins + constraints + animations — so an author can reuse a rig
 * (and its animations) on any other object: apply it at creation of a new rig, or
 * import it into an already-open rig (namespaced merge). Like the animation library
 * it is GLOBAL/project-agnostic and lives under `_shared/rigs/`. The per-rig file is
 * `_shared/rigs/<id>.json`; the lightweight catalog is `_shared/rigs/index.json`. The
 * id runs through `r2Slug` to match the launcher/Python normalization everywhere else.
 * See `docs/design/invisible-rigger.md`.
 */
export const sharedRigsPrefix = '_shared/rigs';
export const sharedRigsIndexKey = '_shared/rigs/index.json';
export function sharedRigKey(id: string): string {
	return `${sharedRigsPrefix}/${r2Slug(id)}.json`;
}

export function localizationDocKey(client: string, project: string): string {
	return `${SUB.localization(client, project)}/strings.json`;
}

export function editorDocKey(client: string, project: string): string {
	return `${SUB.editor(client, project)}/scenes.json`;
}

/**
 * Rolling backups of a project's Scene Editor doc — `<client>/<project>/editor/backups/`.
 * The editor autosaves straight over `scenes.json`, so without these a bad edit, a bad
 * reference/scaffold load, or a restore of the wrong thing is UNRECOVERABLE (the documented
 * fallback was scavenging a `/api/editor/runtime` dump and un-rewriting its spine keys).
 *
 * Its OWN sub-prefix, not a sibling of `scenes.json`, so `editor/` keeps holding exactly the
 * three authored docs (`scenes.json`, `flow.json`, `flow-v2.json`) and a listing that expects
 * them can never trip over backup objects.
 */
export function editorDocBackupsPrefix(client: string, project: string): string {
	return `${SUB.editor(client, project)}/backups/`;
}

/**
 * The file stem of one backup: `scenes-<stamp>-<tag>`, where `<stamp>` is a compact UTC ISO
 * instant (`YYYYMMDDTHHMMSSmmmZ`) and `<tag>` is the first 8 hex chars of the ETag of the bytes
 * being preserved (`noetag` when R2 returned none).
 *
 * **This shape is the whole point, and it is deliberately NOT a version counter.** The
 * component library's `<id>.v<N>.json` snapshots carry a landmine recorded in
 * `docs/design/multi-user-concurrency.md`: because `N` is RECOMPUTED from the stored state on
 * every save, an orphan snapshot at `N+1` (left behind by a lost CAS on the latest pointer) is
 * re-derived by every later save, which then collides with it and 409s FOREVER, unforceably.
 *
 * A stamp+ETag key has no such mode, for two independent reasons:
 *  1. Nothing ever RECOMPUTES this key. It is derived from the clock and from the ETag of the
 *     object being copied — never from a scan of what backups already exist — so a later save
 *     cannot land on an earlier save's key by re-deriving it.
 *  2. Where it CAN repeat (the same prior ETag copied twice inside the same millisecond) the
 *     two copies are byte-identical by construction, so the second write is an idempotent
 *     no-op rather than a collision. Backup writes carry NO precondition, so a repeat cannot
 *     fail either.
 *
 * The stamp leads the tag so a plain lexicographic sort of the listing IS chronological order —
 * retention and the history UI need no per-object HEAD for `LastModified`.
 */
export function editorDocBackupId(at: Date, etag: string | null): string {
	const stamp = at.toISOString().replace(/[-:.]/g, '');
	const hex = (etag ?? '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
	return `scenes-${stamp}-${hex ? hex.slice(0, 8).padEnd(8, '0') : 'noetag'}`;
}

/**
 * The one shape a backup id may have. Ids arrive from the browser on RESTORE, so this is a
 * path-injection gate as much as a parser: the id is validated here and the R2 key is REBUILT
 * from the caller's own `(client, project)` — a client-supplied key is never trusted.
 */
export const EDITOR_DOC_BACKUP_ID_RE = /^scenes-(\d{8}T\d{9}Z)-(?:[0-9a-f]{8}|noetag)$/;

/** Full R2 key for a backup id under a project's backup prefix. */
export function editorDocBackupKey(client: string, project: string, id: string): string {
	return `${editorDocBackupsPrefix(client, project)}${id}.json`;
}

/**
 * Recover the instant encoded in a backup id as an ISO string, or `null` when the id is not a
 * backup id. Reads the KEY rather than the object's `LastModified` so a listing alone is enough
 * — and so a server-side copy (which stamps its own mtime) can never misreport when the bytes
 * it preserved were actually authored.
 */
export function editorDocBackupSavedAt(id: string): string | null {
	const m = EDITOR_DOC_BACKUP_ID_RE.exec(id);
	if (!m) return null;
	const s = m[1];
	const time = `${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}.${s.slice(15, 18)}`;
	return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${time}Z`;
}

/**
 * `<client>/<project>/win-text/win-text.json` — the Invisible Win Text doc: the
 * TEMPLATES the game says about a win (win-line message, amount format, win-level
 * tiers, toast). Pure config, no assets, so it travels verbatim like
 * `symbols.winLine` and needs no `deploy/` export step. Same client/project
 * slug-underscore convention as `editorDocKey`.
 * See `docs/design/invisible-win-text.md`.
 */
export function winTextDocKey(client: string, project: string): string {
	return `${SUB.winText(client, project)}/win-text.json`;
}

/**
 * `<client>/<project>/editor/art-bounds.json` — the per-REGION declared boxes: the sprite twin of
 * a rig's `skeleton.{x,y,width,height}` and of a flipbook clip's `bounds`.
 *
 * Lives beside the layout doc rather than in the sheet MANIFEST on purpose. A manifest is written
 * by the packers (Sheet Maker / Atlas Maker), so a box stored there is one re-pack away from being
 * lost — and altering a region's trim in the manifest re-bases the coordinate space every frozen
 * `.irig` mesh was authored against (`editorRegions.ts`'s RawRegion landmine). Kept separate, a box
 * is authored data that survives re-packing and cannot move a rig.
 *
 * It never ships as its own asset class: `editorArtExport` folds each box into the `sourceSize` /
 * `spriteSourceSize` of the TexturePacker JSON it already writes, which is where PIXI reads a
 * declared box from anyway. So there is nothing to strand in R2 (rule 8) and no runtime change.
 * See `docs/design/invisible-flipbook.md` §"Bounds".
 */
export function artBoundsDocKey(client: string, project: string): string {
	return `${SUB.editor(client, project)}/art-bounds.json`;
}

/**
 * `<client>/<project>/sounds/sounds.json` — the Invisible Sound library doc: which sounds the
 * project owns, their provenance, and whether they are approved to ship.
 * See `docs/design/invisible-sound.md` §4.
 */
export function soundsDocKey(client: string, project: string): string {
	return `${SUB.sounds(client, project)}/sounds.json`;
}

/**
 * `<client>/<project>/sounds/files/<file>` — one uploaded audio file.
 *
 * UNLIKE the docs above, this tool ships real assets, so these travel the full rule-8 chain into
 * `deploy/sounds/` at S4. The filename is validated by `isValidSoundFile` (bare, no directory part,
 * known audio extension) before it can reach the doc, so the caller cannot address an object
 * outside the project's own subtree; this asserts it again rather than trusting that, because a
 * path builder that only works when its input was already checked is a path builder that will
 * eventually be called with an unchecked one.
 */
export function soundFileKey(client: string, project: string, file: string): string {
	if (!isValidSoundFile(file)) throw new Error(`Invalid sound filename: ${file}`);
	return `${SUB.sounds(client, project)}/files/${file}`;
}

/**
 * `<client>/<project>/config/config.json` — the Invisible Game Config doc: the project's
 * GAME MATH CONTRACT (symbol dictionary + paytable, paylines, grid, bet modes, identity/RTP,
 * the cosmetic reel strips). It replaces the ONE `apps/lines/src/game/config.ts` compiled into
 * the shared `_runtime/lines` bundle, which every online project currently shares.
 *
 * Its OWN `config/` subfolder rather than sharing `editor/`: this is the math contract, not a
 * layout, and the Scene Editor's `scenes.json` neighbours would imply otherwise. Pure config, no
 * assets, so like `winTextDocKey` it travels verbatim and needs no `deploy/` export step. Same
 * client/project slug-underscore convention as `editorDocKey`.
 * See `docs/design/invisible-game-config.md`.
 */
export function gameConfigDocKey(client: string, project: string): string {
	return `${SUB.config(client, project)}/config.json`;
}

/**
 * Invisible FX effect storage (design doc `invisible-fx.md` §4 / §6 / §8). Unlike Flow's
 * single per-project `flow.json`, an FX project holds MANY named effects, so each is its
 * own file keyed by a slugged id:
 *
 *  - `<client>/<project>/<id>.fx.json`      — the PURE `EffectDoc` (nested `EmitterConfigV3`
 *    verbatim); the artifact the deploy→bake→pull→register chain ships.
 *  - `<client>/<project>/<id>.fx.meta.json` — the editor-only sidecar (camera/pan-zoom,
 *    last-selected layer); NEVER inside the EffectDoc (out-of-band discipline, §4).
 *
 * The id runs through `r2Slug` (same launcher/Python normalization everywhere), so the file
 * stem is path-safe and matches the runtime `loadedAssets`-key stability rule (§9). Listing
 * the project root for `*.fx.json` (not `*.fx.meta.json`) enumerates the openable effects.
 */
export function fxDocKey(client: string, project: string, id: string): string {
	return `${projectPrefix(client, project)}/${r2Slug(id)}.fx.json`;
}

export function fxMetaKey(client: string, project: string, id: string): string {
	return `${projectPrefix(client, project)}/${r2Slug(id)}.fx.meta.json`;
}

/** The `<id>.fx.json` suffix that marks an EffectDoc (excludes the `.fx.meta.json` sidecar). */
export const FX_DOC_SUFFIX = '.fx.json';
/** The `<id>.fx.meta.json` suffix that marks the editor-only sidecar. */
export const FX_META_SUFFIX = '.fx.meta.json';

/**
 * Per-CLIP Invisible Flipbook document — `<client>/<project>/clips/<id>.clip.json` (design doc
 * `invisible-flipbook.md`). One file per clip, mirroring `fxDocKey`'s multi-doc layout rather
 * than the single-doc `flowDocKey` shape: clips are independently authored, so a per-clip file
 * gives each its own compare-and-swap guard and two authors editing DIFFERENT clips never
 * collide. (The design doc's "one doc per project" line predates this; `FlipbookDoc` is the
 * ASSEMBLED collection the bake emits and `registerFlipbooks` consumes, not the storage unit.)
 *
 * Their own `clips/` subfolder rather than the project root — unlike effects, which sit loose —
 * so listing is a cheap prefix scan and the FTP browser shows them grouped.
 */
export function clipDocKey(client: string, project: string, id: string): string {
	return `${projectPrefix(client, project)}/clips/${r2Slug(id)}.clip.json`;
}

/** Prefix holding a project's clip docs — the listing root for the clip picker. */
export function clipsPrefix(client: string, project: string): string {
	return `${projectPrefix(client, project)}/clips`;
}

/** The `<id>.clip.json` suffix that marks a FlipbookClip doc. */
export const CLIP_DOC_SUFFIX = '.clip.json';

/**
 * Per-project Invisible Flow document — `<client>/<project>/editor/flow.json` — the
 * authored presentation graph (macro transition graph + per-screen choreography),
 * sibling to the Scene Editor's `scenes.json` (design doc `invisible-flow.md` §7/§12).
 * Same client/project slug-underscore convention as `editorDocKey`.
 */
export function flowDocKey(client: string, project: string): string {
	return `${SUB.editor(client, project)}/flow.json`;
}

/**
 * Per-project Invisible Flow **v2** document — `<client>/<project>/editor/flow-v2.json`.
 * A DISTINCT sibling of v1's `flow.json` (they never share a file): v2 is the node-graph
 * event flow (`engine-flow-v2`'s `FlowDoc`, `version: 2`), authored on the `/flow-v2` dev
 * canvas. Same client/project slug-underscore convention as `flowDocKey`.
 */
export function flowV2DocKey(client: string, project: string): string {
	return `${SUB.editor(client, project)}/flow-v2.json`;
}

/**
 * The Invisible Flow **v2** shared FUNCTION LIBRARY — GLOBAL, not project-scoped. Functions
 * authored via "Collapse to Function" on any project's `/flow-v2` canvas are reusable across
 * every client/project, so the library lives under the shared `_shared/` prefix (like the
 * Rigger's `_shared/rigs` / `_shared/animations` libraries), NOT inside a project tree. This
 * is a CONSTANT key: there is no user-supplied path component, so the save endpoint has no
 * path-injection surface — auth only gates that the caller may use Flow at all.
 */
export const FLOW_V2_LIBRARY_KEY = '_shared/flow-v2/functions.json';

/**
 * Per-project Invisible Symbols State Machine doc:
 * `<client>/<project>/symbols/symbols.json` — the authored symbol→state→asset
 * binding map (sparse overrides over the coded `SYMBOL_INFO_MAP`). Same
 * client/project slug-underscore convention as `editorDocKey`.
 * See `docs/design/invisible-symbols-state-machine.md`.
 */
export function symbolsDocKey(client: string, project: string): string {
	return `${SUB.symbols(client, project)}/symbols.json`;
}

/**
 * Per-project published symbol DEFAULTS:
 * `<client>/<project>/symbols/defaults.json` — the game's coded `SYMBOL_INFO_MAP`
 * published to R2 at build time so the tool grid is driven by each project's own
 * symbol set instead of the committed `lines.json` fallback. Sibling of the
 * authored `symbolsDocKey` overrides file; same client/project slug-underscore
 * convention. DENSE (every state present), unlike the sparse overrides doc.
 * See `docs/design/invisible-symbols-state-machine.md`.
 */
export function symbolDefaultsKey(client: string, project: string): string {
	return `${SUB.symbols(client, project)}/defaults.json`;
}

export function atlasConfigKey(client: string, project: string): string {
	return `${projectPrefix(client, project)}/atlas_config.json`;
}

export function atlasManifestsPrefix(client: string, project: string): string {
	return SUB.manifests(client, project);
}

export function sheetConfigKey(client: string, project: string): string {
	return `${projectPrefix(client, project)}/sheet_config.json`;
}

/** Bundles can be nested folders (e.g. `loader/sub`); reject parent escapes only.
 * Spine folder names are legitimately camelCase (`foregroundAnimation`, `fsIntro`),
 * so allow upper + lower case — the safety is the no-`..`/no-`/` checks, not case. */
const BUNDLE_SEG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
function assertBundle(value: string): void {
	if (!value || value.includes('..') || value.startsWith('/') || value.endsWith('/')) {
		throw new Error(`Invalid spine bundle: ${JSON.stringify(value)}`);
	}
	for (const seg of value.split('/')) {
		if (!BUNDLE_SEG_RE.test(seg)) {
			throw new Error(`Invalid spine bundle segment: ${JSON.stringify(seg)}`);
		}
	}
}

/** Per-project spine bundle prefix, e.g. `borut/bookofborut/spines/loader`. */
export function spineBundlePath(client: string, project: string, bundle: string): string {
	assertBundle(bundle);
	return `${SUB.spines(client, project)}/${bundle}`;
}

/** Cross-project fallback for shared bundles: `_shared/spines/<bundle>`. */
export function spineBundleSharedPath(bundle: string): string {
	assertBundle(bundle);
	return sharedSpinesPrefix(bundle);
}
