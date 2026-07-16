import type {
	ComponentCategory,
	ComponentDef,
	ComponentParam,
	ComponentSignal,
	ContainerNode,
	SlotKind,
	TemplateSlot,
} from 'engine-layout';
import {
	BUILTIN_COMPONENTS,
	mergeBuiltinCodedParams,
	pruneOrphanParamBindings,
} from 'engine-layout';
import {
	editorComponentKey,
	editorComponentVersionKey,
	projectComponentKey,
	projectComponentVersionKey,
	projectComponentsPrefix,
	sharedComponentsPrefix,
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
 * A bad component PAYLOAD — distinct from a storage failure so the route can map the
 * two differently (400 vs 5xx). Without the distinction an R2 blip renders in the
 * editor as "Invalid component", pointing the author at the wrong problem.
 */
export class ComponentValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ComponentValidationError';
	}
}

const CATEGORIES = new Set<ComponentCategory>(['ui', 'overlay', 'scenery']);
const SLOT_KINDS = new Set<SlotKind>(['sprite', 'spine', 'text', 'mount']);
/**
 * The full `ComponentParam.kind` set (`engine-layout` `types.ts`). MUST stay in sync
 * with that union: the built-in FS-intro/outro defs declare `spine`/`spineAnimation`/
 * `spineSlot` params, so an earlier 5-kind allowlist silently stripped them (and the
 * `spineParam` link) on any save of a forked copy — latent data loss.
 */
const PARAM_KINDS = new Set<ComponentParam['kind']>([
	'number',
	'string',
	'color',
	'boolean',
	'image',
	'spine',
	'spineAnimation',
	'spineSlot',
]);

/**
 * Resolve a component def (§8.3 / §14.2 B4.1). Precedence high → low: PROJECT R2
 * (`editor/<projectKey>/components/<id>.json`) ◁ SHARED R2
 * (`_shared/editor-components/<id>.json`) ◁ BUILT-IN code (`BUILTIN_COMPONENTS`) —
 * exactly like `loadTemplate`'s R2-over-built-in fallback, with the built-in as
 * the lowest layer. A malformed/unreadable R2 object never throws; it just falls
 * through to the next source. Returns `undefined` only when no scope (and no
 * built-in) has a usable def for `id`.
 *
 * Versioning (§8.9 v2 multi-version store): when `version` is given, resolve the
 * EXACT historical snapshot a pinned instance was authored against. At each scope
 * the versioned snapshot `<id>.v<N>.json` is preferred; if it is missing (the def
 * was authored before v2 history existed, or the requested version is the current
 * latest) the scope's `<id>.json` latest pointer is used — but ONLY when its
 * version actually matches the request, so a pin never silently resolves a
 * different-version def. Without `version` the latest pointer is returned exactly
 * as before (back-compat, byte-identical).
 */
export async function loadComponent(
	id: string,
	projectKey?: string,
	version?: number,
): Promise<ComponentDef | undefined> {
	if (projectKey) {
		const project = await readComponentAtScope(
			projectComponentKey(projectKey, id),
			version !== undefined ? projectComponentVersionKey(projectKey, id, version) : undefined,
			version,
		);
		if (project) return mergeBuiltinCodedParams(project);
	}
	const shared = await readComponentAtScope(
		editorComponentKey(id),
		version !== undefined ? editorComponentVersionKey(id, version) : undefined,
		version,
	);
	if (shared) return mergeBuiltinCodedParams(shared);
	const builtin = BUILTIN_COMPONENTS.find((def) => def.id === id);
	if (!builtin) return undefined;
	// A built-in has no historical store (it is engine code): an unmatched pin still
	// resolves the single coded def, exactly like a latest load — the engine's
	// `resolveComponent` flags the mismatch separately.
	return builtin;
}

/**
 * Read one scope's def, honouring a pinned `version` (§8.9 v2). With no version
 * (or `versionKey` undefined) this is the plain latest-pointer read. With a
 * version: try the immutable `<id>.v<N>.json` snapshot first; on a miss fall back
 * to the latest `<id>.json` pointer ONLY when its version equals the request (a
 * pre-v2 doc whose single stored version IS the pinned one, or a pin at latest).
 * Returns `undefined` when this scope has no def matching the pin, so the caller
 * falls through to the next (lower-precedence) scope.
 */
async function readComponentAtScope(
	latestKey: string,
	versionKey: string | undefined,
	version: number | undefined,
): Promise<ComponentDef | undefined> {
	if (version === undefined || !versionKey) return readComponent(latestKey);
	const snapshot = await readComponent(versionKey);
	if (snapshot) return snapshot;
	const latest = await readComponent(latestKey);
	if (latest && latest.version === version) return latest;
	return undefined;
}

/** Read + normalize one component key, swallowing any read/parse failure. */
async function readComponent(key: string): Promise<ComponentDef | undefined> {
	let raw: string | null;
	try {
		raw = await getObjectText(key);
	} catch {
		return undefined;
	}
	if (!raw) return undefined;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (isComponentShape(parsed)) return normalizeComponent(parsed);
	} catch {
		return undefined;
	}
	return undefined;
}

/**
 * Read + normalize one component key for the SAVE path, with its ETag.
 *
 * Deliberately does NOT swallow a read error, unlike {@link readComponent} (whose
 * swallow is right for a read path that should degrade rather than fail). On the save
 * path that swallow is a data-loss bug: a transient R2 blip makes the stored def look
 * ABSENT, so `reconcileVersion` treats the save as brand-new, keeps the posted
 * version, and overwrites both the stored def and its "immutable" `.v<N>.json`
 * snapshot at the same version. Fail loud instead — the caller can retry.
 *
 * `etag === null` means the object is absent (a create). A present-but-malformed
 * object yields `def: undefined` WITH an etag, so it is deliberately overwritten
 * rather than mistaken for a create that can never succeed.
 */
async function readComponentForWrite(
	key: string,
): Promise<{ def: ComponentDef | undefined; etag: string | null }> {
	const obj = await getObjectTextWithEtag(key);
	if (!obj) return { def: undefined, etag: null };
	try {
		const parsed: unknown = JSON.parse(obj.text);
		if (isComponentShape(parsed)) return { def: normalizeComponent(parsed), etag: obj.etag };
	} catch {
		return { def: undefined, etag: obj.etag };
	}
	return { def: undefined, etag: obj.etag };
}

/**
 * Persist an authored component to its scope's R2 key (§8.3). Validates the
 * minimum contract first and throws a descriptive Error on a bad payload, so the
 * write only ever happens for a well-formed def. A `scope: 'shared'` def (or one
 * saved with no `projectKey`) goes to the shared key; a `scope: 'project'` def
 * with a `projectKey` goes to that project's key.
 *
 * Versioning (§8.9, pin-by-default): a CHANGED def's `version` is bumped past the
 * stored version so instances that pinned the old version stay distinguishable and
 * are never silently mutated/auto-upgraded (the engine resolves the pin SAFELY —
 * see `resolveComponent`). A no-op re-save keeps the stored version (no spurious
 * bump), and a brand-new component keeps the posted version (default 1). See
 * {@link reconcileVersion}.
 *
 * v2 multi-version store (§8.9): the save writes the def to BOTH the `<id>.json`
 * latest pointer (read by `loadComponent` without a version, `listComponents` —
 * back-compat preserved) AND the immutable `<id>.v<N>.json` snapshot, so a pinned
 * instance can later resolve the EXACT version it was authored against. The latest
 * write is LAST: if the snapshot write fails, the latest pointer is unchanged.
 *
 * CONCURRENCY (Phase 1 of `docs/design/multi-user-concurrency.md`). `version` looks
 * like optimistic concurrency but is NOT: it is a *pin* mechanism, and two concurrent
 * saves both read N, both compute N+1, and both write `<id>.v<N+1>.json` — one edit
 * lost, and the "immutable" snapshot silently rewritten. Two guards:
 *
 * - The SNAPSHOT is written with `ifNoneMatch: '*'` whenever the version is new, so
 *   "immutable history" is enforced by R2 rather than asserted in a comment.
 * - The LATEST pointer is a compare-and-swap on `baseEtag`.
 *
 * ⚠ BE PRECISE ABOUT WHAT IS AND IS NOT PROTECTED TODAY. **No caller passes
 * `baseEtag` yet** — `loadComponent`/`listComponents` return no ETag, so the Component
 * Editor has none to send. With `baseEtag: undefined` we fall back to the ETag of the
 * read THIS function just did, which closes only the in-request read→write window
 * (tens of ms). The window Phase 1 is actually about — A and B both open the def, A
 * saves, B saves five minutes later — is NOT closed for components: B's save re-reads,
 * bumps to N+2, and succeeds. Nothing 409s. What limits the damage is the version
 * bump: A's work survives as `<id>.v<N+1>.json` rather than being destroyed. That is
 * recoverable-by-hand, NOT unlost.
 *
 * To make the prose above true, `listComponents`/`loadComponent` must carry the ETag
 * to the client and the editor must send it back. Until then, treat components as
 * "last-writer-wins on the latest pointer, with history".
 *
 * `scope: 'shared'` defs live on a GLOBAL key, so no project lease could ever cover
 * them — a real CAS is the only possible protection there, which makes the threading
 * above the priority for that scope.
 */
export async function saveComponent(
	component: ComponentDef,
	projectKey?: string,
	baseEtag?: string | null,
): Promise<{ version: number; etag: string | null }> {
	let normalized: ComponentDef;
	try {
		normalized = validateComponent(component);
	} catch (e) {
		// Typed, so the route can answer 400 for a bad PAYLOAD without also answering 400
		// for an R2 outage — which would tell the author to go fix a component that was
		// never broken, and leak the SDK's message into the UI.
		throw new ComponentValidationError(e instanceof Error ? e.message : 'Invalid component.');
	}
	// A `scope:'project'` def MUST be saved with a projectKey — never silently
	// downgrade it to the shared library (that would publish a project-local
	// component repo-wide).
	if (normalized.scope === 'project' && !projectKey) {
		throw new ComponentValidationError('A project-scoped component requires a projectKey.');
	}
	const isProject = normalized.scope === 'project';
	const key = isProject
		? projectComponentKey(projectKey as string, normalized.id)
		: editorComponentKey(normalized.id);
	const { def: existing, etag: existingEtag } = await readComponentForWrite(key);
	// CHECK BEFORE WRITING ANYTHING. The snapshot is written first and is immutable, so
	// discovering a lost CAS at the LATEST pointer (the second write) would already have
	// left an orphan `<id>.v<N+1>.json` behind — and every later save would then compute
	// that same N+1, collide with the orphan, and 409 FOREVER with no way out of the UI.
	// An in-process compare makes the ordinary conflict path write nothing at all.
	if (baseEtag !== undefined && baseEtag !== existingEtag) throw new ConflictError(key);

	const toWrite = reconcileVersion(normalized, existing);
	const body = JSON.stringify(toWrite, null, 2);
	// Snapshot first (immutable history), latest pointer last — so a failed snapshot
	// write never advances the latest pointer past a version that has no snapshot.
	const versionKey = isProject
		? projectComponentVersionKey(projectKey as string, normalized.id, toWrite.version)
		: editorComponentVersionKey(normalized.id, toWrite.version);
	// A NEW version must not already exist. `etag === null` (absent) rather than
	// `!existing` (which is ALSO true for a present-but-malformed latest) — conflating
	// those is the trap `getObjectTextWithEtag` exists to avoid.
	const isNewVersion = existingEtag === null || !existing || toWrite.version !== existing.version;
	await writeSnapshot(versionKey, body, isNewVersion);
	const etag = await putObjectText(
		key,
		body,
		'application/json',
		precondition(baseEtag === undefined ? existingEtag : baseEtag),
	);
	return { version: toWrite.version, etag };
}

/**
 * Write the immutable `<id>.v<N>.json` snapshot.
 *
 * `guard` asks R2 to enforce the immutability the comments have always claimed. A 412
 * means the version already exists — which is NOT automatically a conflict: the same
 * save retried after a transient failure of the latest-pointer write would land here
 * with byte-identical content, and rejecting that would strand the component. So
 * compare: identical bytes = an idempotent retry, carry on; different bytes = someone
 * else genuinely authored this version, and overwriting it would rewrite history a
 * pinned instance may already resolve.
 */
async function writeSnapshot(versionKey: string, body: string, guard: boolean): Promise<void> {
	if (!guard) {
		// Same version, same content — rewriting identical bytes, which also heals a
		// snapshot missing from a pre-v2 def.
		await putObjectText(versionKey, body, 'application/json');
		return;
	}
	try {
		await putObjectText(versionKey, body, 'application/json', { ifNoneMatch: '*' });
	} catch (e) {
		if (!(e instanceof ConflictError)) throw e;
		const existingSnapshot = await getObjectText(versionKey);
		if (existingSnapshot !== body) throw e;
	}
}

/**
 * Decide the `version` a save persists (§8.9, owner decision 2026-06-05: version
 * components, pin-by-default — a breaking edit bumps; instances keep their pin):
 * - **No stored def** (new component) → keep the posted version as-is.
 * - **Stored def, content UNCHANGED** (ignoring `version`) → keep the stored
 *   version. A no-op re-save (or a metadata-only round-trip) must NOT bump, or
 *   every open/save would orphan every pin.
 * - **Stored def, content CHANGED** → bump to `max(stored, posted) + 1` UNLESS the
 *   client already bumped past the stored version (posted > stored), in which case
 *   honour the client's explicit version. This guarantees a changed def's version
 *   STRICTLY increases and never silently overwrites the def an instance pinned.
 *
 * Comparison ignores `version` itself so a pure version field difference is not
 * mistaken for a content change.
 */
function reconcileVersion(next: ComponentDef, existing: ComponentDef | undefined): ComponentDef {
	if (!existing) return next;
	if (componentContentEqual(next, existing)) {
		return next.version === existing.version ? next : { ...next, version: existing.version };
	}
	if (next.version > existing.version) return next;
	return { ...next, version: existing.version + 1 };
}

/** Structural equality of two defs IGNORING `version` (the bump decision input). */
function componentContentEqual(a: ComponentDef, b: ComponentDef): boolean {
	const strip = ({ version: _version, ...rest }: ComponentDef): Omit<ComponentDef, 'version'> =>
		rest;
	return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

/**
 * Delete a component from its scope's R2 key — the inverse of {@link saveComponent},
 * resolving the key identically (project → `projectComponentKey`, shared →
 * `editorComponentKey`). A `scope: 'project'` delete MUST carry a `projectKey`.
 *
 * v2 (§8.9): also removes every retained `<id>.v<N>.json` snapshot so a delete
 * leaves no orphaned history behind. The latest pointer is removed too; both lists
 * are enumerated from the scope prefix so the cleanup needs no version registry.
 */
export async function deleteComponent(
	id: string,
	scope: 'shared' | 'project',
	projectKey?: string,
): Promise<void> {
	if (scope === 'project' && !projectKey) {
		throw new Error('A project-scoped component requires a projectKey.');
	}
	const key =
		scope === 'project' ? projectComponentKey(projectKey as string, id) : editorComponentKey(id);
	const prefix =
		scope === 'project' ? projectComponentsPrefix(projectKey as string) : sharedComponentsPrefix;
	const snapshotPrefix = key.replace(/\.json$/, '.v');
	let snapshotKeys: string[];
	try {
		snapshotKeys = (await listAllKeys(prefix)).filter(
			(k) => k.startsWith(snapshotPrefix) && VERSION_SNAPSHOT_KEY.test(k),
		);
	} catch {
		snapshotKeys = [];
	}
	for (const snapshotKey of snapshotKeys) await deleteObject(snapshotKey);
	await deleteObject(key);
}

/** The version history of one component at one scope (§8.9 v2 version browser). */
export interface ComponentVersionList {
	/** Every retained `<id>.v<N>.json` snapshot version, ascending. May be empty for a
	 * pre-v2 def that only has a `<id>.json` latest pointer (no snapshots written yet). */
	versions: number[];
	/** The `version` of the `<id>.json` latest pointer — the one the editor opens by
	 * default — or `undefined` when no def exists at this scope. */
	latest: number | undefined;
}

/**
 * Enumerate the retained versions of one component at one scope (§8.9 v2 version
 * browser). The library listings deliberately exclude `<id>.v<N>.json` snapshots, so
 * this is the only way the editor sees a def's history. R2-lists the scope prefix,
 * keeps just THIS id's `<id>.v<N>.json` siblings, and parses their version numbers; it
 * also reads the `<id>.json` latest pointer to report which version is current.
 *
 * Read-only — it never mutates R2. A pre-v2 def (no snapshots) returns `{ versions: [],
 * latest: <its single version> }`, so the UI can still show the current version and note
 * that no older history was retained. A `scope:'project'` query MUST carry a `projectKey`.
 */
export async function listComponentVersions(
	id: string,
	scope: 'shared' | 'project',
	projectKey?: string,
): Promise<ComponentVersionList> {
	if (scope === 'project' && !projectKey) {
		throw new Error('A project-scoped component requires a projectKey.');
	}
	const latestKey =
		scope === 'project' ? projectComponentKey(projectKey as string, id) : editorComponentKey(id);
	const prefix =
		scope === 'project' ? projectComponentsPrefix(projectKey as string) : sharedComponentsPrefix;
	// `<id>.v<N>.json` where `<id>` is THIS component's slugged key — escape the prefix
	// (r2Slug yields `[a-z0-9_]`, but stay safe) and capture the integer version.
	const base = latestKey.replace(/\.json$/, '');
	const versionRe = new RegExp(`^${escapeRegExp(base)}\\.v(\\d+)\\.json$`);
	let keys: string[];
	try {
		keys = await listAllKeys(prefix);
	} catch {
		keys = [];
	}
	const versions: number[] = [];
	for (const key of keys) {
		const match = versionRe.exec(key);
		if (match) versions.push(Number(match[1]));
	}
	versions.sort((a, b) => a - b);
	const latestDef = await readComponent(latestKey);
	return { versions, latest: latestDef?.version };
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ListComponentsOptions {
	projectKey?: string;
	scope?: 'shared' | 'project';
	category?: ComponentCategory;
}

/**
 * List components, lowest → highest precedence so a later layer shadows an
 * earlier one of the same id: BUILT-IN code (`BUILTIN_COMPONENTS`) ◁ SHARED R2 ◁
 * PROJECT R2. Built-ins are `scope:'shared'`, so they slot under the shared
 * layer and are correctly excluded by a `scope:'project'` filter and kept by a
 * `scope:'shared'` filter. Filters by `scope`/`category` when given. Malformed
 * entries are skipped, never thrown.
 */
export async function listComponents(opts: ListComponentsOptions): Promise<ComponentDef[]> {
	const byId = new Map<string, ComponentDef>();

	if (opts.scope !== 'project') {
		for (const def of BUILTIN_COMPONENTS) {
			byId.set(def.id, def);
		}
		for (const def of await listFromPrefix(sharedComponentsPrefix)) {
			byId.set(def.id, def);
		}
	}
	if (opts.scope !== 'shared' && opts.projectKey) {
		for (const def of await listFromPrefix(projectComponentsPrefix(opts.projectKey))) {
			byId.set(def.id, def);
		}
	}

	let defs = [...byId.values()].map(mergeBuiltinCodedParams);
	if (opts.category) defs = defs.filter((d) => d.category === opts.category);
	if (opts.scope) defs = defs.filter((d) => d.scope === opts.scope);
	return defs;
}

/** One authored component plus the project it lives under (`null` = shared library). */
export interface AuthoredComponentEntry {
	/** The R2 project key the component is scoped to, or `null` for the shared library. */
	projectKey: string | null;
	def: ComponentDef;
}

/**
 * `editor/<projectKey>/components/<id>.json` — the project-component LATEST-pointer
 * key shape. The `(?<!\.v\d+)` lookbehind excludes the v2 historical snapshots
 * (`<id>.v<N>.json`) so only latest pointers are enumerated as distinct components.
 */
const PROJECT_COMPONENT_KEY = /^editor\/([^/]+)\/components\/[^/]+(?<!\.v\d+)\.json$/;

/** A v2 historical-snapshot key (`<id>.v<N>.json`) — excluded from latest listings. */
const VERSION_SNAPSHOT_KEY = /\.v\d+\.json$/;

/**
 * List every AUTHORED component across ALL projects + the shared library, each
 * annotated with the project it belongs to. Built-ins are excluded (they are
 * engine code, not authored content). Used by the Storybook "Authored Components"
 * gallery so a single fetch surfaces everything saved in the Component Editor.
 *
 * Cross-project enumeration walks the `editor/` prefix and matches the
 * `editor/<projectKey>/components/<id>.json` shape — no project registry needed.
 * Malformed entries are skipped, never thrown.
 */
export async function listAllComponents(): Promise<AuthoredComponentEntry[]> {
	const out: AuthoredComponentEntry[] = [];
	for (const def of await listFromPrefix(sharedComponentsPrefix)) {
		out.push({ projectKey: null, def });
	}
	let keys: string[];
	try {
		keys = await listAllKeys('editor/');
	} catch {
		keys = [];
	}
	for (const key of keys) {
		const match = PROJECT_COMPONENT_KEY.exec(key);
		if (!match) continue;
		const def = await readComponent(key);
		if (def) out.push({ projectKey: match[1], def });
	}
	return out;
}

/** List + parse every `*.json` directly under a component prefix, skipping bad ones. */
async function listFromPrefix(prefix: string): Promise<ComponentDef[]> {
	let keys: string[];
	try {
		keys = await listAllKeys(prefix);
	} catch {
		return [];
	}
	const out: ComponentDef[] = [];
	for (const key of keys) {
		if (!key.endsWith('.json')) continue;
		// Skip v2 historical snapshots (`<id>.v<N>.json`): the library lists one entry
		// per component (its latest pointer), not every retained version.
		if (VERSION_SNAPSHOT_KEY.test(key)) continue;
		const def = await readComponent(key);
		if (def) out.push(def);
	}
	return out;
}

/**
 * Validate the minimum component contract and return the normalized def. Throws a
 * descriptive Error on a bad payload (surfaced as a 400 by the route). Mirrors
 * `saveTemplate`'s guard-then-normalize discipline.
 */
function validateComponent(component: ComponentDef): ComponentDef {
	if (typeof component !== 'object' || component === null) {
		throw new Error('Component must be an object.');
	}
	if (typeof component.id !== 'string' || !component.id.trim()) {
		throw new Error('Component requires a non-empty id.');
	}
	if (typeof component.name !== 'string' || !component.name.trim()) {
		throw new Error('Component requires a non-empty name.');
	}
	if (!Number.isInteger(component.version) || component.version < 1) {
		throw new Error('Component version must be a positive integer.');
	}
	if (component.scope !== 'shared' && component.scope !== 'project') {
		throw new Error("Component scope must be 'shared' or 'project'.");
	}
	if (!CATEGORIES.has(component.category)) {
		throw new Error("Component category must be one of 'ui', 'overlay', 'scenery'.");
	}
	if (!isContainerNode(component.root)) {
		throw new Error("Component root must be a node with kind 'container'.");
	}
	return normalizeComponent(component);
}

/**
 * Coerce parsed/posted data into a clean `ComponentDef`, dropping malformed
 * params/signals/slots (mirrors `normalizeTemplate`). The `root` node tree is NOT
 * deep-normalized — node coercion is the editor doc normalizer's job (§8.3); here
 * we only verify `root` is a container and pass it through.
 */
export function normalizeComponent(raw: ComponentDef): ComponentDef {
	const def: ComponentDef = {
		id: raw.id.trim(),
		name: raw.name.trim(),
		version: raw.version,
		scope: raw.scope,
		category: raw.category,
		root: identityComponentRoot(raw.root),
	};
	// Authoring/preview space (default 'game' = omitted). Only persist a non-default
	// value the editor understands; an unknown/absent value falls back to game space.
	if (raw.space === 'canvas' || raw.space === 'standard' || raw.space === 'background') {
		def.space = raw.space;
	}
	const params = normalizeParams(raw.params);
	if (params.length) def.params = params;
	const signals = normalizeSignals(raw.signals);
	if (signals.length) def.signals = signals;
	const slots = normalizeSlots(raw.slots);
	if (slots.length) def.slots = slots;
	// Enforce "no binding without its param": drop node bindings that point at a param
	// dropped above (or deleted in the editor), so a corrupt def can't be saved and an
	// already-orphaned one self-heals on its next load/save.
	pruneOrphanParamBindings(def);
	return def;
}

function normalizeParams(input: unknown): ComponentParam[] {
	if (!Array.isArray(input)) return [];
	const out: ComponentParam[] = [];
	for (const item of input) {
		if (!isRecord(item)) continue;
		if (typeof item.key !== 'string' || !item.key) continue;
		if (!PARAM_KINDS.has(item.kind as ComponentParam['kind'])) continue;
		const param: ComponentParam = { key: item.key, kind: item.kind as ComponentParam['kind'] };
		if ('default' in item) param.default = item.default;
		if (item.engineProvided === true) param.engineProvided = true;
		if (item.author === true) param.author = true;
		// `spineParam` links a `spineAnimation`/`spineSlot` dropdown to its sibling
		// `spine`-kind param — drop it on save and those dropdowns lose their source.
		if (typeof item.spineParam === 'string' && item.spineParam) param.spineParam = item.spineParam;
		if (typeof item.group === 'string' && item.group) param.group = item.group;
		if (typeof item.label === 'string' && item.label) param.label = item.label;
		if (Array.isArray(item.options)) {
			const options = item.options.filter((o): o is string => typeof o === 'string');
			if (options.length) param.options = options;
		}
		out.push(param);
	}
	return out;
}

function normalizeSignals(input: unknown): ComponentSignal[] {
	if (!Array.isArray(input)) return [];
	const out: ComponentSignal[] = [];
	for (const item of input) {
		if (!isRecord(item)) continue;
		if (typeof item.key !== 'string' || !item.key) continue;
		const signal: ComponentSignal = { key: item.key };
		if (typeof item.note === 'string' && item.note) signal.note = item.note;
		out.push(signal);
	}
	return out;
}

function normalizeSlots(input: unknown): TemplateSlot[] {
	if (!Array.isArray(input)) return [];
	const out: TemplateSlot[] = [];
	for (const item of input) {
		if (!isRecord(item)) continue;
		if (typeof item.slotId !== 'string' || !item.slotId) continue;
		if (typeof item.kind !== 'string' || !SLOT_KINDS.has(item.kind as SlotKind)) continue;
		const slot: TemplateSlot = {
			slotId: item.slotId,
			name: typeof item.name === 'string' ? item.name : '',
			kind: item.kind as SlotKind,
		};
		if (item.required === true) slot.required = true;
		if (typeof item.mountComponent === 'string' && item.mountComponent) {
			slot.mountComponent = item.mountComponent;
		}
		if (Array.isArray(item.accepts)) {
			const accepts = item.accepts.filter(
				(a): a is 'sprite' | 'spine' | 'text' => a === 'sprite' || a === 'spine' || a === 'text',
			);
			if (accepts.length) slot.accepts = accepts;
		}
		out.push(slot);
	}
	return out;
}

/** Light shape check used to decide whether an R2 doc is usable as a component. */
function isComponentShape(input: unknown): input is ComponentDef {
	if (!isRecord(input)) return false;
	if (typeof input.id !== 'string' || !input.id) return false;
	if (typeof input.name !== 'string' || !input.name) return false;
	if (typeof input.version !== 'number') return false;
	if (input.scope !== 'shared' && input.scope !== 'project') return false;
	if (!CATEGORIES.has(input.category as ComponentCategory)) return false;
	return isContainerNode(input.root);
}

function isContainerNode(input: unknown): input is ContainerNode {
	return isRecord(input) && input.kind === 'container';
}

/**
 * A component `root` is authored in LOCAL space — the `componentInstance` node
 * positions it — so the root carries NO transform of its own. Stripping it here is
 * the authoritative invariant that keeps the engine path (which applies root's
 * transform via `LayoutNodeView`) and the editor canvas (which skips it) in
 * agreement, and stops a dropped instance from being offset by a baked-in scene
 * transform. Keeps only id/kind/children + optional box (width/height) + label.
 */
function identityComponentRoot(root: ContainerNode): ContainerNode {
	const next: ContainerNode = {
		id: root.id,
		kind: 'container',
		x: 0,
		y: 0,
		children: Array.isArray(root.children) ? root.children : [],
	};
	if (typeof root.width === 'number') next.width = root.width;
	if (typeof root.height === 'number') next.height = root.height;
	if (typeof root.label === 'string') next.label = root.label;
	return next;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
