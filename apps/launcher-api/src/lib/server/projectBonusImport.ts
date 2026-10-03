/**
 * The Game Maker's BONUS IMPORT (docs/design/pots-overlay.md §5 A, Phase 7): one feature of another
 * project of the same client copied into this one as a mode a pot can start, and RE-SYNC, which
 * copies it again from the source as it is now. The Game Config half (block, strips, symbols, the
 * `imports` record with its rename map) is `game-config`'s `importBonus` / `resyncBonus`; this copies
 * the rest under the same rename map:
 *
 *  - **Symbols:** each imported symbol's `/symbols` cells, display name and sound overrides, from the
 *    source symbol to its name here. A symbol the import no longer brings loses its binding.
 *  - **Spines:** a cell or a screen node that names a spine under the SOURCE project's prefix would
 *    export nothing from here, so the bundle is promoted to `_shared/spines/imported/<project>/<source>/<bundle>`
 *    and the reference rewritten. A shared bundle travels export → deploy → bake → pull → register
 *    like any other (CLAUDE.md rule 8).
 *  - **Layout:** the mode's `role: 'mode'` screens (and the screen its mode override names as HUD).
 *    They replace this layout's screens for the mode, at the same place.
 *  - **Flow:** the source's `modes[mode]` section replaces this flow's, on a stored flow only.
 *  - **Win Text:** the Hold and Win families (jackpots, respins, wheel, the feature lines) replace
 *    this doc's, except the lines a pot speaks (`meterFull`, `potLabel`, `potNames`), which are the
 *    host's.
 *
 * WHAT COUNTS AS THE FEATURE'S (decided here, conservatively): exactly the pieces above. A source
 * piece that does not exist leaves the host's as it is (and says so) rather than deleting it.
 * Nothing else of either project is read or written, and the SOURCE is only ever read.
 *
 * Writes follow the pots overlay add-on (`projectAddOn.ts`): nothing while another session holds an
 * edit lease on a doc it writes; the config first (`If-Match`, a backup of the bytes before), then
 * each doc as its own conditional write, reporting `added` / `present` / `conflict` / `skipped` /
 * `failed`; never over a doc that does not parse. A part that lost a race is filled in by running
 * re-sync.
 */
import type { FlowDoc as FlowDocV2 } from 'engine-flow-v2';
import {
	WIN_TEXT_POT_FIELDS,
	mergeMissingScreens,
	type LayoutDoc,
	type LayoutNode,
	type Scene,
	type WinTextDoc,
} from 'engine-layout';
import {
	bonusImportOf,
	importBonus,
	importableFeatures,
	resyncBonus,
	type GameConfigDoc,
	type ImportResult,
} from 'game-config';
import { TOOLS } from '$lib/roles';
import type { BonusImportOutcome, BonusImportParts } from '$lib/bonusImport';
import type { AddOnPart, AddOnPartStatus } from '$lib/potsOverlayAddOn';
import { loadDocWithEtag, saveDoc } from './editorStorage';
import { loadFlowV2DocWithEtag, saveFlowV2Doc } from './flowV2Storage';
import { resolveGameConfig } from './gameConfigDefaults';
import { InvalidGameConfigError, saveGameConfigDoc } from './gameConfigStorage';
import { liveLeases } from './lease';
import { leaseBlocker } from './projectAddOn';
import { SUB, r2Slug, sharedSpinesPrefix, winTextDocKey } from './projectPaths';
import { projectGameType } from './projects';
import { ConflictError, getObjectTextWithEtag } from './r2';
import { invalidateRuntimeBundle } from './runtimeBundleCache';
import { promoteSpineToShared } from './sharedSpinePromote';
import { potsOverlaySymbolsSeed } from './symbolDefaults';
import { loadSymbolsDocWithEtag, saveSymbolsDoc, type SymbolsDoc } from './symbolsStorage';
import { normalizeWinTextDoc, saveWinTextDoc } from './winTextStorage';

export type { BonusImportOutcome, BonusImportParts };

/** The docs an import writes, by the tool that owns each — the Game Maker grant alone must not reach
 *  a doc its own tool would refuse. */
const IMPORT_TOOLS = ['gameConfig', 'symbols', 'editor', 'flow', 'winText'] as const;

/** The tools {@link IMPORT_TOOLS} names that `hasTool` does not grant, by name. */
export function importToolsMissing(hasTool: (tool: string) => boolean): string[] {
	return IMPORT_TOOLS.filter((tool) => !hasTool(tool)).map((tool) => TOOLS[tool]?.name ?? tool);
}

const IMPORT_LEASE_TARGETS = [
	{ toolId: 'gameConfig', docKey: 'gameConfig', path: '/config' },
	{ toolId: 'symbols', docKey: 'symbols', path: '/symbols' },
	{ toolId: 'editor', docKey: 'editor', path: '/editor' },
	{ toolId: 'flow', docKey: 'flow', path: '/flow-v2' },
	{ toolId: 'winText', docKey: 'winText', path: '/win-text' },
] as const;

const part = (status: AddOnPartStatus, added: string[] = [], note?: string): AddOnPart => ({
	status,
	added,
	...(note ? { note } : {}),
});

const notes = (...lines: (string | undefined)[]): string | undefined =>
	lines.filter(Boolean).join(' ') || undefined;

/** A part's write, with a lost race and any other failure reported rather than thrown. */
async function guarded(write: () => Promise<AddOnPart>): Promise<AddOnPart> {
	try {
		return await write();
	} catch (e) {
		if (e instanceof ConflictError) {
			return part('conflict', [], 'Someone saved it meanwhile. Re-sync to fill it in.');
		}
		console.error('bonus import part failed:', e);
		return part('failed', [], e instanceof Error ? e.message : String(e));
	}
}

// ─── spines ───────────────────────────────────────────────────────────────────────────────────

/**
 * The shared bundle an imported spine is promoted to — namespaced by the importing project and its
 * source, so it never overwrites another project's shared bundle of the same name, and two projects
 * importing the same source bundle never share (or overwrite) one copy: each path has one writer.
 */
export const importedSpineBundle = (target: string, source: string, bundle: string): string =>
	`imported/${r2Slug(target)}/${r2Slug(source)}/${bundle}`;

/**
 * Every spine bundle a JSON value names under the SOURCE project's prefix, and the value with each
 * such reference rewritten to its promoted shared bundle. Pure; `value` is not mutated.
 */
export function rewriteSourceSpines<T>(
	value: T,
	client: string,
	source: string,
	target: string,
): { value: T; bundles: string[] } {
	const root = `${SUB.spines(client, source)}/`;
	const bundles = new Set<string>();
	const walk = (v: unknown): unknown => {
		if (typeof v === 'string' && v.startsWith(root)) {
			const slash = v.endsWith('/');
			const bundle = v.slice(root.length, slash ? -1 : undefined);
			if (!bundle) return v;
			bundles.add(bundle);
			return `${sharedSpinesPrefix(importedSpineBundle(target, source, bundle))}${slash ? '/' : ''}`;
		}
		if (Array.isArray(v)) return v.map(walk);
		if (v && typeof v === 'object') {
			return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
		}
		return v;
	};
	return { value: walk(value) as T, bundles: [...bundles].sort() };
}

/**
 * Promote each of `bundles` once per import, BEFORE the doc naming it is written, so a written
 * reference always has its shared copy. A bundle that cannot be promoted (not a loadable bundle in
 * the source) is recorded with why; its reference then ships nothing, and the export says so.
 */
async function promoteSpines(ctx: ImportContext, bundles: readonly string[]): Promise<void> {
	for (const bundle of bundles) {
		if (ctx.spines.has(bundle)) continue;
		try {
			await promoteSpineToShared(
				ctx.client,
				ctx.source,
				bundle,
				importedSpineBundle(ctx.project, ctx.source, bundle),
			);
			ctx.spines.set(bundle, null);
		} catch (e) {
			ctx.spines.set(bundle, e instanceof Error ? e.message : String(e));
		}
	}
}

// ─── symbols ──────────────────────────────────────────────────────────────────────────────────

/** Per-symbol blocks of the symbols doc an import carries. */
const SYMBOL_BLOCKS = ['symbols', 'names', 'symbolSounds'] as const;

/**
 * The source's per-symbol bindings copied onto `current` under the rename map `names` (source →
 * here), each replacing what `current` had for that symbol; a symbol in `dropped` (brought by the
 * previous import, not by this one) loses its binding. Pure.
 */
export function mergeImportedBindings(
	current: SymbolsDoc,
	source: SymbolsDoc,
	names: Record<string, string>,
	dropped: readonly string[],
): { doc: SymbolsDoc; added: string[]; unbound: string[] } {
	const doc = structuredClone(current);
	const added: string[] = [];
	const unbound: string[] = [];
	for (const block of SYMBOL_BLOCKS) {
		const into: Record<string, unknown> = { ...(doc[block] ?? {}) };
		for (const name of dropped) delete into[name];
		for (const [from, to] of Object.entries(names)) {
			const value = source[block]?.[from];
			if (value === undefined) {
				if (block === 'symbols') unbound.push(to);
				continue;
			}
			if (JSON.stringify(into[to]) !== JSON.stringify(value)) {
				into[to] = structuredClone(value);
				if (!added.includes(to)) added.push(to);
			}
		}
		if (Object.keys(into).length) (doc as Record<string, unknown>)[block] = into;
		else delete doc[block];
	}
	return { doc, added, unbound };
}

// ─── layout ───────────────────────────────────────────────────────────────────────────────────

/** The screens that ARE the mode in a layout: its `role: 'mode'` screens, plus its HUD screen. */
const modeScreenIds = (scenes: readonly Scene[], mode: string, hud: string | undefined): string[] =>
	scenes
		.filter((s) => (s.role === 'mode' && s.modeId === mode) || (hud !== undefined && s.id === hud))
		.map((s) => s.id);

function* allNodes(nodes: readonly LayoutNode[]): Generator<LayoutNode> {
	for (const node of nodes) {
		yield node;
		if (node.kind === 'container') yield* allNodes(node.children);
	}
}

/**
 * The source's screens for `mode` put in place of `current`'s: each one replaces the screen the
 * layout had for the mode, at the place the first of those stood, and a layout with none gets them
 * where the source has them ({@link mergeMissingScreens}). A node id another screen of this layout
 * already uses is suffixed. Pure.
 */
export function mergeImportedScreens(
	current: LayoutDoc,
	source: LayoutDoc,
	mode: string,
	hud: { current?: string; source?: string },
): { doc: LayoutDoc; added: string[]; renamedNodes: string[] } {
	const ids = modeScreenIds(source.scenes, mode, hud.source);
	if (!ids.length) return { doc: current, added: [], renamedNodes: [] };
	const replaced = new Set([...modeScreenIds(current.scenes, mode, hud.current), ...ids]);
	const kept = current.scenes.filter((s) => !replaced.has(s.id));
	const taken = new Set(kept.flatMap((s) => [...allNodes(s.nodes)].map((n) => n.id)));
	const renamedNodes: string[] = [];
	const freeId = (id: string): string => {
		let next = id;
		for (let n = 2; taken.has(next); n++) next = `${id}-${n}`;
		if (next !== id) renamedNodes.push(`${id} → ${next}`);
		taken.add(next);
		return next;
	};
	const renameNodes = (nodes: readonly LayoutNode[]): LayoutNode[] =>
		nodes.map((node) => {
			const id = freeId(node.id);
			return node.kind === 'container'
				? { ...node, id, children: renameNodes(node.children) }
				: { ...node, id };
		});
	const imported = source.scenes
		.filter((s) => ids.includes(s.id))
		.map((s) => ({ ...structuredClone(s), nodes: renameNodes(s.nodes) }));
	const at = current.scenes.findIndex((s) => replaced.has(s.id));
	let scenes: Scene[];
	if (at >= 0) {
		const before = current.scenes.slice(0, at).filter((s) => !replaced.has(s.id)).length;
		scenes = [...kept.slice(0, before), ...imported, ...kept.slice(before)];
	} else {
		scenes = mergeMissingScreens(kept, imported, ids);
		// `mergeMissingScreens` places by the reference's order; with only the imported screens as
		// reference they go after nothing, so keep them together after the layout's own.
		if (scenes.length !== kept.length + imported.length) scenes = [...kept, ...imported];
	}
	const unchanged = JSON.stringify(scenes) === JSON.stringify(current.scenes);
	return {
		doc: unchanged ? current : { ...current, scenes },
		added: unchanged ? [] : ids,
		renamedNodes,
	};
}

// ─── win text ─────────────────────────────────────────────────────────────────────────────────

/** The lines a pot speaks: the host's own, never the import's. */
const POT_LINES = new Set<string>([...WIN_TEXT_POT_FIELDS, 'potNames']);

/**
 * The source's Hold and Win copy put in place of `current`'s — the `jackpots`, `respins` and `wheel`
 * families whole, and every `feature` line but a pot's. A family the source lacks leaves this doc's
 * as it is: Win Text keeps no backups, and its families are not per mode. Pure.
 */
export function mergeImportedWinText(
	current: WinTextDoc,
	source: WinTextDoc,
): { doc: WinTextDoc; added: string[] } {
	const doc: WinTextDoc = structuredClone(current);
	const added: string[] = [];
	for (const family of ['jackpots', 'respins', 'wheel'] as const) {
		if (!source[family] || JSON.stringify(doc[family]) === JSON.stringify(source[family])) continue;
		(doc as Record<string, unknown>)[family] = structuredClone(source[family]);
		added.push(family);
	}
	if (source.feature) {
		const pots = Object.fromEntries(
			Object.entries(current.feature ?? {}).filter(([key]) => POT_LINES.has(key)),
		);
		const lines = Object.fromEntries(
			Object.entries(source.feature).filter(([key]) => !POT_LINES.has(key)),
		);
		const feature = { ...lines, ...pots } as NonNullable<WinTextDoc['feature']>;
		if (JSON.stringify(feature) !== JSON.stringify(current.feature ?? {})) {
			doc.feature = feature;
			added.push('feature');
		}
	}
	return { doc, added };
}

// ─── the parts ────────────────────────────────────────────────────────────────────────────────

type ImportContext = {
	client: string;
	project: string;
	source: string;
	mode: string;
	/** Source symbol → name here (the stored map). */
	names: Record<string, string>;
	/** Names the previous import brought that this one does not. */
	dropped: string[];
	/** Each spine bundle the copied pieces name under the source's prefix → `null` once promoted,
	 *  else why it could not be. */
	spines: Map<string, string | null>;
};

async function importSymbols(ctx: ImportContext, config: GameConfigDoc): Promise<AddOnPart> {
	const target = await loadSymbolsDocWithEtag(ctx.client, ctx.project);
	if (target.corrupt) {
		return part('skipped', [], 'The Symbols doc could not be read. Open it in /symbols.');
	}
	const source = await loadSymbolsDocWithEtag(ctx.client, ctx.source);
	if (source.corrupt) {
		return part('skipped', [], `${ctx.source}'s Symbols doc could not be read.`);
	}
	// Only the imported symbols' bindings are read, so only their spines are promoted.
	const imported: SymbolsDoc = { version: 1, symbols: {} };
	for (const block of SYMBOL_BLOCKS) {
		const entries = Object.keys(ctx.names)
			.filter((name) => source.doc[block]?.[name] !== undefined)
			.map((name) => [name, source.doc[block]![name]]);
		if (entries.length) (imported as Record<string, unknown>)[block] = Object.fromEntries(entries);
	}
	const rewritten = rewriteSourceSpines(imported, ctx.client, ctx.source, ctx.project);
	const merged = mergeImportedBindings(target.doc, rewritten.value, ctx.names, ctx.dropped);
	// A symbol the source never bound gets the placeholder a Hold and Win bonus's roles get.
	const seeded = potsOverlaySymbolsSeed(config, merged.doc);
	const added = [...merged.added, ...seeded.added.filter((n) => !merged.added.includes(n))];
	const unbound = merged.unbound.filter((n) => !seeded.added.includes(n));
	const note = notes(
		unbound.length
			? `No art for ${unbound.join(', ')} in either project: bind it in /symbols.`
			: '',
	);
	if (JSON.stringify(seeded.doc) === JSON.stringify(target.doc)) return part('present', [], note);
	await promoteSpines(ctx, rewritten.bundles);
	await saveSymbolsDoc(ctx.client, ctx.project, seeded.doc, target.etag, 'always');
	return part('added', added, note);
}

async function importLayout(
	ctx: ImportContext,
	hud: { current?: string; source?: string },
): Promise<AddOnPart> {
	const target = await loadDocWithEtag(ctx.client, ctx.project, await projectGameType(ctx.project));
	if (target.corrupt)
		return part('skipped', [], 'The layout could not be read. Open it in /editor.');
	if (target.etag === null) {
		return part('skipped', [], 'This project has no layout yet: open /editor once, then re-sync.');
	}
	const source = await loadDocWithEtag(ctx.client, ctx.source, await projectGameType(ctx.source));
	if (source.corrupt || source.etag === null) {
		return part(
			'skipped',
			[],
			`${ctx.source} has no readable layout, so its screens stay as they are here.`,
		);
	}
	const ids = modeScreenIds(source.doc.scenes, ctx.mode, hud.source);
	if (!ids.length) {
		return part(
			'present',
			[],
			`${ctx.source} has no screens for this mode: the ones here are kept.`,
		);
	}
	// Only the copied screens are read, so only their spines are promoted.
	const copied = { ...source.doc, scenes: source.doc.scenes.filter((s) => ids.includes(s.id)) };
	const rewritten = rewriteSourceSpines(copied, ctx.client, ctx.source, ctx.project);
	const merged = mergeImportedScreens(target.doc, rewritten.value, ctx.mode, hud);
	const note = notes(
		merged.renamedNodes.length ? `Node ids renamed: ${merged.renamedNodes.join(', ')}.` : '',
	);
	if (!merged.added.length) return part('present', [], note);
	await promoteSpines(ctx, rewritten.bundles);
	await saveDoc(ctx.client, ctx.project, merged.doc, target.etag, 'always');
	return part('added', merged.added, note);
}

async function importFlow(ctx: ImportContext): Promise<AddOnPart> {
	const target = await loadFlowV2DocWithEtag(ctx.client, ctx.project);
	if (!target.doc) {
		return part(
			'skipped',
			[],
			target.etag === null
				? 'This project has no stored flow, so the coded defaults play the bonus.'
				: 'The stored flow could not be read. Open it in /flow-v2.',
		);
	}
	const source = await loadFlowV2DocWithEtag(ctx.client, ctx.source);
	if (!source.doc && source.etag !== null) {
		return part(
			'skipped',
			[],
			`${ctx.source}'s flow could not be read, so the section here is kept.`,
		);
	}
	const section = source.doc?.modes?.[ctx.mode];
	if (!section) {
		return part(
			'present',
			[],
			`${ctx.source} has no Flow section for this mode: the one here is kept.`,
		);
	}
	if (JSON.stringify(target.doc.modes?.[ctx.mode]) === JSON.stringify(section)) {
		return part('present');
	}
	const doc: FlowDocV2 = {
		...target.doc,
		modes: { ...target.doc.modes, [ctx.mode]: structuredClone(section) },
	};
	await saveFlowV2Doc(ctx.client, ctx.project, doc, target.etag, 'always');
	return part('added', [`modes.${ctx.mode}`]);
}

/** A Win Text doc with its ETag, or `corrupt` when the stored object does not parse. */
async function loadWinText(client: string, project: string) {
	const obj = await getObjectTextWithEtag(winTextDocKey(client, project));
	if (!obj) return { doc: normalizeWinTextDoc({}), etag: null, corrupt: false };
	try {
		return { doc: normalizeWinTextDoc(JSON.parse(obj.text)), etag: obj.etag, corrupt: false };
	} catch {
		return { doc: null, etag: obj.etag, corrupt: true };
	}
}

async function importWinText(ctx: ImportContext): Promise<AddOnPart> {
	const target = await loadWinText(ctx.client, ctx.project);
	if (!target.doc)
		return part('skipped', [], 'The Win Text doc could not be read. Open it in /win-text.');
	const source = await loadWinText(ctx.client, ctx.source);
	if (!source.doc) return part('skipped', [], `${ctx.source}'s Win Text doc could not be read.`);
	const merged = mergeImportedWinText(target.doc, source.doc);
	if (!merged.added.length) return part('present');
	await saveWinTextDoc(ctx.client, ctx.project, merged.doc, target.etag);
	return part('added', merged.added);
}

// ─── the action ───────────────────────────────────────────────────────────────────────────────

/** What a same-client source project offers to import. */
export async function sourceFeatures(client: string, source: string) {
	const resolved = await resolveGameConfig(client, source, await projectGameType(source));
	return resolved.doc ? importableFeatures(resolved.doc) : [];
}

/**
 * Import the feature `mode` of `source` into `project` (both of client `client`), or with `resync`
 * copy the project's imported bonus `mode` again from the source it records. See the file header.
 */
export async function applyBonusImport(
	client: string,
	project: string,
	opts: {
		source?: string;
		mode: string;
		resync?: boolean;
		replace?: boolean;
		pots?: string[];
		sessionId: string;
		/** May the caller read `source` (accessible, same client)? Asked of a re-sync's recorded
		 *  source, which the caller cannot check before the config is read. */
		mayRead?: (source: string) => Promise<boolean>;
		/** The time to record (tests pin it). */
		at?: string;
	},
): Promise<BonusImportOutcome> {
	const resolved = await resolveGameConfig(client, project, await projectGameType(project));
	if (!resolved.doc) return { ok: false, status: 400, error: 'This project has no Game Config.' };
	if (resolved.source === 'template' && resolved.etag !== null) {
		return {
			ok: false,
			status: 409,
			error: 'The stored Game Config could not be read. Open it in /config first.',
		};
	}
	const record = opts.resync ? bonusImportOf(resolved.doc, opts.mode) : undefined;
	if (opts.resync && !record) {
		return {
			ok: false,
			status: 400,
			error: `"${opts.mode}" was not imported from another project.`,
		};
	}
	const source = record?.importedFrom.project ?? opts.source;
	if (!source) return { ok: false, status: 400, error: 'Missing source project.' };
	if (source === project) {
		return { ok: false, status: 400, error: 'A project cannot import from itself.' };
	}
	if (record && opts.mayRead && !(await opts.mayRead(source))) {
		return {
			ok: false,
			status: 404,
			error: `${source}, which this bonus was imported from, cannot be read from here.`,
		};
	}

	const editing = leaseBlocker(
		await liveLeases(
			IMPORT_LEASE_TARGETS.map(({ toolId, docKey }) => ({
				toolId,
				docKey,
				clientKey: client,
				projectKey: project,
			})),
		),
		opts.sessionId,
		IMPORT_LEASE_TARGETS,
	);
	if (editing) return { ok: false, status: 409, error: editing };

	const sourceConfig = await resolveGameConfig(client, source, await projectGameType(source));
	if (!sourceConfig.doc) {
		return { ok: false, status: 404, error: `${source} has no Game Config to import from.` };
	}
	const at = opts.at ?? new Date().toISOString();
	const result: ImportResult = record
		? resyncBonus(resolved.doc, sourceConfig.doc, opts.mode, at)
		: importBonus(resolved.doc, sourceConfig.doc, {
				project: source,
				mode: opts.mode,
				at,
				replace: opts.replace === true,
				pots: opts.pots,
			});
	if (!result.ok) return { ok: false, status: 409, error: result.reason };

	let saved: GameConfigDoc;
	try {
		// `always`: the bytes before the import are a restore point in /config's backups.
		saved = (await saveGameConfigDoc(client, project, result.doc, resolved.etag, 'always')).doc;
	} catch (e) {
		if (e instanceof ConflictError) {
			return {
				ok: false,
				status: 409,
				error: 'The Game Config was saved by someone else meanwhile. Run it again.',
			};
		}
		if (e instanceof InvalidGameConfigError) {
			const first = e.issues.find((i) => i.severity === 'error') ?? e.issues[0];
			return {
				ok: false,
				status: 409,
				error: `This bonus doesn't fit this game${first ? `: ${first.message}` : '.'}`,
			};
		}
		throw e;
	}

	const previous = record?.symbols ?? bonusImportOf(resolved.doc, result.mode)?.symbols ?? {};
	const ctx: ImportContext = {
		client,
		project,
		source,
		mode: result.mode,
		names: result.symbols,
		dropped: Object.values(previous).filter(
			(n) => !Object.values(result.symbols).includes(n) && !saved.symbols[n],
		),
		spines: new Map(),
	};
	const hud = {
		current: resolved.doc.modes?.find((m) => m.id === result.mode)?.hud,
		source: sourceConfig.doc.modes?.find((m) => m.id === result.mode)?.hud,
	};
	const symbols = await guarded(() => importSymbols(ctx, saved));
	const layout = await guarded(() => importLayout(ctx, hud));
	const flow = await guarded(() => importFlow(ctx));
	const winText = await guarded(() => importWinText(ctx));
	const failed = [...ctx.spines].filter(([, why]) => why !== null);
	const promoted = [...ctx.spines]
		.filter(([, why]) => why === null)
		.map(([bundle]) => importedSpineBundle(project, source, bundle));
	const spines = !ctx.spines.size
		? part('present')
		: part(
				promoted.length ? 'added' : 'failed',
				promoted,
				failed.length
					? `Not promoted, so they ship nothing: ${failed.map(([b, why]) => `${b} (${why})`).join('; ')}.`
					: undefined,
			);
	const parts: BonusImportParts = { symbols, layout, flow, winText, spines };
	// The config is an input to the runtime bundle, so a live game picks the bonus up at once.
	invalidateRuntimeBundle(project);
	return {
		ok: true,
		mode: result.mode,
		resynced: Boolean(record),
		replaced: result.replaced && !record,
		renamed: result.renamed,
		leftOut: result.leftOut,
		droppedActivates: result.droppedActivates,
		parts,
	};
}
