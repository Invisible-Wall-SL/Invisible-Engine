/**
 * The Game Maker's BONUS IMPORT (docs/design/pots-overlay.md §5 A, Phase 7): one feature of another
 * project of the same client copied into this one as a mode a pot can start, and RE-SYNC, which
 * copies it again from the source as it is now. The Game Config half (block, strips, symbols, the
 * `imports` record with its rename map) is `game-config`'s `importBonus` / `resyncBonus`; this copies
 * the rest under the same rename map:
 *
 *  - **Symbols:** each imported symbol's `/symbols` cells, display name and sound overrides, from the
 *    source symbol to its name here; an imported symbol the source never bound gets a placeholder.
 *    A symbol the import no longer brings loses its binding.
 *  - **Rigs:** a cell or a screen node that names a rig under the SOURCE project's prefix would
 *    export nothing from here, so on every run the bundle is promoted to
 *    `_shared/spines/imported/<project>/<source>/<bundle>` and the reference rewritten; a bundle that
 *    cannot be promoted keeps its source reference. A shared bundle travels export → deploy → bake →
 *    pull → register like any other (CLAUDE.md rule 8).
 *  - **Layout:** the mode's `role: 'mode'` screens. They replace this layout's screens for the mode,
 *    at the same place; every other screen is kept, so an id clash renames the imported screen. A
 *    HUD screen is the host's and never copied (the config keeps the host's `hud`).
 *  - **Flow:** the source's `modes[mode]` section replaces this flow's, on a stored flow only.
 *  - **Win Text:** imported as this project's PRIMARY respin mode, the Hold and Win families
 *    (jackpots, respins, wheel, the feature lines) replace this doc's, except the lines a pot speaks
 *    (`meterFull`, `potLabel`, `potNames`), which are the host's. Imported as another respin mode,
 *    the lines the source mode speaks are added under that mode (`modes[<mode>]`) and no family is
 *    replaced (`docs/design/bonus-games.md` §2.4).
 *
 * A REELS feature (an imported free spins, a mode of this project's own under a new id) takes the
 * same path with the source's mode id read and the new one written: its screens re-tagged, its Flow
 * section re-keyed, its symbols only those the import owns (a shared one keeps the host's art). Its
 * Win Text is the host's own free-spin lines, so nothing is copied there.
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
	WIN_TEXT_MODE_FEATURE_FIELDS,
	WIN_TEXT_POT_FIELDS,
	type LayoutDoc,
	type LayoutNode,
	type Scene,
	type WinTextDoc,
	type WinTextModeLines,
} from 'engine-layout';
import {
	bonusImportOf,
	importBonus,
	importableFeatures,
	respinModeBlocks,
	resyncBonus,
	type GameConfigDoc,
	type ImportResult,
} from 'game-config';
import { TOOLS } from '$lib/roles';
import type { BonusImportOutcome, BonusImportParts } from '$lib/bonusImport';
import type { AddOnPart, AddOnPartStatus } from '$lib/potsOverlayAddOn';
import { winTextRespinModes, type WinTextRespinMode } from '$lib/winTextModes';
import { loadDocWithEtag, saveDoc } from './editorStorage';
import { loadFlowV2DocWithEtag, saveFlowV2Doc } from './flowV2Storage';
import { resolveGameConfig } from './gameConfigDefaults';
import { InvalidGameConfigError, saveGameConfigDoc } from './gameConfigStorage';
import { liveLeases } from './lease';
import { leaseBlocker } from './projectAddOn';
import { SUB, r2Slug, sharedRigBundlePrefix, winTextDocKey } from './projectPaths';
import { projectGameType } from './projects';
import { ConflictError, getObjectTextWithEtag } from './r2';
import { invalidateRuntimeBundle } from './runtimeBundleCache';
import { promoteRigToShared } from './sharedRigPromote';
import { potsOverlaySymbolsSeed } from './symbolDefaults';
import { loadSymbolsDocWithEtag, saveSymbolsDoc, type SymbolsDoc } from './symbolsStorage';
import { normalizeWinTextDoc, saveWinTextDoc } from './winTextStorage';

export type { BonusImportOutcome, BonusImportParts };

/** The docs an import writes, by the tool that owns each and the lease its page takes on it. */
const IMPORT_LEASE_TARGETS = [
	{ toolId: 'gameConfig', docKey: 'gameConfig', path: '/config' },
	{ toolId: 'symbols', docKey: 'symbols', path: '/symbols' },
	{ toolId: 'editor', docKey: 'editor', path: '/editor' },
	{ toolId: 'flow', docKey: 'flow', path: '/flow-v2' },
	{ toolId: 'winText', docKey: 'winText', path: '/win-text' },
] as const;

/** The tools whose doc an import writes that `hasTool` does not grant, by name — the Game Maker
 *  grant alone must not reach a doc its own tool would refuse. */
export function importToolsMissing(hasTool: (tool: string) => boolean): string[] {
	return IMPORT_LEASE_TARGETS.map((t) => t.toolId)
		.filter((tool) => !hasTool(tool))
		.map((tool) => TOOLS[tool]?.name ?? tool);
}

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

// ─── rigs ───────────────────────────────────────────────────────────────────────────────────

/**
 * The shared bundle an imported rig is promoted to — namespaced by the importing project and its
 * source, so it never overwrites another project's shared bundle of the same name, and two projects
 * importing the same source bundle never share (or overwrite) one copy: each path has one writer
 * (project keys are lowercase slugs, so `r2Slug` maps distinct keys to distinct segments).
 */
export const importedRigBundle = (target: string, source: string, bundle: string): string =>
	`imported/${r2Slug(target)}/${r2Slug(source)}/${bundle}`;

/**
 * Every rig bundle a JSON value names under the SOURCE project's prefix, and the value with each
 * such reference rewritten to its promoted shared bundle — except a bundle in `keep` (one whose
 * promotion failed), which keeps its source reference rather than naming a copy that is not there.
 * Pure; `value` is not mutated.
 */
export function rewriteSourceRigs<T>(
	value: T,
	client: string,
	source: string,
	target: string,
	keep: ReadonlySet<string> = new Set(),
): { value: T; bundles: string[] } {
	const root = `${SUB.spines(client, source)}/`;
	const bundles = new Set<string>();
	const walk = (v: unknown): unknown => {
		if (typeof v === 'string' && v.startsWith(root)) {
			const slash = v.endsWith('/');
			const bundle = v.slice(root.length, slash ? -1 : undefined);
			if (!bundle) return v;
			bundles.add(bundle);
			if (keep.has(bundle)) return v;
			return `${sharedRigBundlePrefix(importedRigBundle(target, source, bundle))}${slash ? '/' : ''}`;
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
 * Promote each of `bundles` once per run — every run, so a re-sync picks up a rig the source
 * re-exported at the same path — BEFORE the doc naming it is written. A bundle that cannot be
 * promoted (not a loadable bundle in the source) is recorded with why, and {@link sourceRigs}
 * leaves its reference on the source.
 */
async function promoteRigs(ctx: ImportContext, bundles: readonly string[]): Promise<void> {
	for (const bundle of bundles) {
		if (ctx.spines.has(bundle)) continue;
		try {
			await promoteRigToShared(
				ctx.client,
				ctx.source,
				bundle,
				importedRigBundle(ctx.project, ctx.source, bundle),
			);
			ctx.spines.set(bundle, null);
		} catch (e) {
			ctx.spines.set(bundle, e instanceof Error ? e.message : String(e));
		}
	}
}

/** `value` with its source rigs promoted and rewritten; a failed one keeps its source key. */
async function sourceRigs<T>(ctx: ImportContext, value: T): Promise<T> {
	const { bundles } = rewriteSourceRigs(value, ctx.client, ctx.source, ctx.project);
	await promoteRigs(ctx, bundles);
	const failed = new Set(bundles.filter((b) => ctx.spines.get(b) !== null));
	return rewriteSourceRigs(value, ctx.client, ctx.source, ctx.project, failed).value;
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

/** The screens that ARE the mode in a layout: its `role: 'mode'` screens. A HUD screen is not one —
 *  it is the host's, and other modes may name it. */
const modeScreenIds = (scenes: readonly Scene[], mode: string): string[] =>
	scenes.filter((s) => s.role === 'mode' && s.modeId === mode).map((s) => s.id);

function* allNodes(nodes: readonly LayoutNode[]): Generator<LayoutNode> {
	for (const node of nodes) {
		yield node;
		if (node.kind === 'container') yield* allNodes(node.children);
	}
}

/** `wanted`, or the first `wanted-2`, `wanted-3`… not in `taken` (which it then joins). */
function freeIn(taken: Set<string>, wanted: string, renamed: string[]): string {
	let next = wanted;
	for (let n = 2; taken.has(next); n++) next = `${wanted}-${n}`;
	if (next !== wanted) renamed.push(`${wanted} → ${next}`);
	taken.add(next);
	return next;
}

/**
 * The source's screens for its mode `sourceMode` put in place of `current`'s for `mode` (the same id
 * for a Hold and Win; an imported reels mode's own id here), each re-tagged to `mode`. Only this
 * layout's screens for the mode are replaced, at the place the first of them stood; with none, the
 * imported ones go after the layout's own. Any other screen is kept: an imported screen whose id one
 * of them uses is suffixed, and so is a node id another screen of this layout uses. Pure.
 */
export function mergeImportedScreens(
	current: LayoutDoc,
	source: LayoutDoc,
	mode: string,
	sourceMode: string = mode,
): { doc: LayoutDoc; added: string[]; renamedScreens: string[]; renamedNodes: string[] } {
	const ids = modeScreenIds(source.scenes, sourceMode);
	if (!ids.length) return { doc: current, added: [], renamedScreens: [], renamedNodes: [] };
	const replaced = new Set(modeScreenIds(current.scenes, mode));
	const kept = current.scenes.filter((s) => !replaced.has(s.id));
	const screenIds = new Set(kept.map((s) => s.id));
	const nodeIds = new Set(kept.flatMap((s) => [...allNodes(s.nodes)].map((n) => n.id)));
	const renamedScreens: string[] = [];
	const renamedNodes: string[] = [];
	const renameNodes = (nodes: readonly LayoutNode[]): LayoutNode[] =>
		nodes.map((node) => {
			const id = freeIn(nodeIds, node.id, renamedNodes);
			return node.kind === 'container'
				? { ...node, id, children: renameNodes(node.children) }
				: { ...node, id };
		});
	const imported = source.scenes
		.filter((s) => ids.includes(s.id))
		.map((s) => ({
			...structuredClone(s),
			modeId: mode,
			id: freeIn(screenIds, s.id, renamedScreens),
			nodes: renameNodes(s.nodes),
		}));
	const at = current.scenes.findIndex((s) => replaced.has(s.id));
	const before =
		at >= 0 ? current.scenes.slice(0, at).filter((s) => !replaced.has(s.id)).length : kept.length;
	const scenes = [...kept.slice(0, before), ...imported, ...kept.slice(before)];
	const unchanged = JSON.stringify(scenes) === JSON.stringify(current.scenes);
	return {
		doc: unchanged ? current : { ...current, scenes },
		added: unchanged ? [] : imported.map((s) => s.id),
		renamedScreens,
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

/**
 * The lines respin mode `mode` of `doc` speaks as authored — its own over the primary's families,
 * field by field (`resolveWinTextForMode` without the coded defaults); `undefined` is the primary.
 * Only a mode's own families: never a pot line or a name. `tiers` (the receiving mode's jackpot
 * tiers) keeps only their captions, so a caption for a tier the mode does not deal is not copied.
 */
export function spokenModeLines(
	doc: WinTextDoc,
	mode: string | undefined,
	tiers?: readonly string[],
): WinTextModeLines {
	const own =
		mode !== undefined && doc.modes && Object.hasOwn(doc.modes, mode) ? doc.modes[mode] : {};
	const feature = Object.fromEntries(
		WIN_TEXT_MODE_FEATURE_FIELDS.flatMap((field) => {
			const line = own.feature?.[field] ?? doc.feature?.[field];
			return line === undefined ? [] : [[field, line]];
		}),
	);
	const lines: WinTextModeLines = {
		jackpots: {
			...doc.jackpots,
			...own.jackpots,
			captions: Object.fromEntries(
				Object.entries({ ...doc.jackpots?.captions, ...own.jackpots?.captions }).filter(
					([tier]) => !tiers || tiers.includes(tier),
				),
			),
		},
		respins: { ...doc.respins, ...own.respins },
		wheel: { ...doc.wheel, ...own.wheel },
		feature,
	};
	return normalizeWinTextDoc({ modes: { lines } }).modes?.lines ?? {};
}

/**
 * `lines` put in place of respin mode `mode`'s own in `current` — that mode's entry alone, so no
 * family and no other mode is touched. Pure.
 */
export function mergeImportedModeWinText(
	current: WinTextDoc,
	mode: string,
	lines: WinTextModeLines,
): { doc: WinTextDoc; added: string[] } {
	const had = current.modes && Object.hasOwn(current.modes, mode) ? current.modes[mode] : {};
	if (JSON.stringify(had) === JSON.stringify(lines)) return { doc: current, added: [] };
	const doc: WinTextDoc = structuredClone(current);
	const modes: Record<string, WinTextModeLines> = { ...doc.modes };
	if (Object.keys(lines).length) {
		Object.defineProperty(modes, mode, {
			value: structuredClone(lines),
			enumerable: true,
			writable: true,
			configurable: true,
		});
	} else delete modes[mode];
	if (Object.keys(modes).length) doc.modes = modes;
	else delete doc.modes;
	return { doc, added: [`modes.${mode}`] };
}

// ─── the parts ────────────────────────────────────────────────────────────────────────────────

type ImportContext = {
	client: string;
	project: string;
	source: string;
	/** Its mode id here. */
	mode: string;
	/** Its mode id in the source (a reels import's differs: `freeSpins` → `freeSpins_2`). */
	sourceMode: string;
	/** This project's respin modes after the import, the primary first. */
	respinModes: WinTextRespinMode[];
	/** The source's primary respin mode — the one whose lines are its Win Text families. */
	sourcePrimary: string | undefined;
	/** Source symbol → name here (the stored map). */
	names: Record<string, string>;
	/** Names the previous import brought that this one does not. */
	dropped: string[];
	/** Each rig bundle the copied pieces name under the source's prefix → `null` once promoted,
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
	// Only the imported symbols' bindings are read, so only their rigs are promoted.
	const imported: SymbolsDoc = { version: 1, symbols: {} };
	for (const block of SYMBOL_BLOCKS) {
		const entries = Object.keys(ctx.names)
			.filter((name) => source.doc[block]?.[name] !== undefined)
			.map((name) => [name, source.doc[block]![name]]);
		if (entries.length) (imported as Record<string, unknown>)[block] = Object.fromEntries(entries);
	}
	const merged = mergeImportedBindings(
		target.doc,
		await sourceRigs(ctx, imported),
		ctx.names,
		ctx.dropped,
	);
	// An imported symbol the source never bound gets the placeholder a Hold and Win bonus's roles
	// get. Only an imported one: the seed would also bind the host's own unbound tokens.
	const ours = new Set(Object.values(ctx.names));
	const seed = potsOverlaySymbolsSeed(config, merged.doc);
	const placeholders = seed.added.filter((n) => ours.has(n) && !merged.added.includes(n));
	const doc: SymbolsDoc = {
		...merged.doc,
		symbols: {
			...merged.doc.symbols,
			...Object.fromEntries(placeholders.map((n) => [n, seed.doc.symbols[n]])),
		},
	};
	const added = [...merged.added, ...placeholders];
	const unbound = merged.unbound.filter((n) => !placeholders.includes(n));
	const note = notes(
		unbound.length
			? `No art for ${unbound.join(', ')} in either project: bind it in /symbols.`
			: '',
	);
	if (JSON.stringify(doc) === JSON.stringify(target.doc)) return part('present', [], note);
	await saveSymbolsDoc(ctx.client, ctx.project, doc, target.etag, 'always');
	return part('added', added, note);
}

async function importLayout(ctx: ImportContext): Promise<AddOnPart> {
	const target = await loadDocWithEtag(ctx.client, ctx.project, await projectGameType(ctx.project));
	if (target.corrupt) {
		return part('skipped', [], 'The layout could not be read. Open it in /editor.');
	}
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
	const ids = modeScreenIds(source.doc.scenes, ctx.sourceMode);
	if (!ids.length) {
		return part(
			'present',
			[],
			`${ctx.source} has no screens for this mode: the ones here are kept.`,
		);
	}
	// Only the copied screens are read, so only their rigs are promoted.
	const copied = { ...source.doc, scenes: source.doc.scenes.filter((s) => ids.includes(s.id)) };
	const merged = mergeImportedScreens(
		target.doc,
		await sourceRigs(ctx, copied),
		ctx.mode,
		ctx.sourceMode,
	);
	const note = notes(
		merged.renamedScreens.length
			? `Screens renamed (this layout uses the id): ${merged.renamedScreens.join(', ')}.`
			: '',
		merged.renamedNodes.length ? `Node ids renamed: ${merged.renamedNodes.join(', ')}.` : '',
	);
	if (!merged.added.length) return part('present', [], note);
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
	const section = source.doc?.modes?.[ctx.sourceMode];
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
	// Only a respin mode has lines of its own: the ones a reels mode would speak (the free-spin lines)
	// are the host's, so an imported free spins speaks them as the host's own do.
	const into = ctx.respinModes.find((m) => m.mode === ctx.mode);
	if (!into) {
		return part('present', [], "A free-spins mode speaks this game's own free-spin lines.");
	}
	const target = await loadWinText(ctx.client, ctx.project);
	if (!target.doc) {
		return part('skipped', [], 'The Win Text doc could not be read. Open it in /win-text.');
	}
	const source = await loadWinText(ctx.client, ctx.source);
	if (!source.doc) {
		return part('skipped', [], `${ctx.source}'s Win Text doc could not be read.`);
	}
	const sourceMode = ctx.sourceMode === ctx.sourcePrimary ? undefined : ctx.sourceMode;
	let merged: { doc: WinTextDoc; added: string[] };
	if (into !== ctx.respinModes[0]) {
		merged = mergeImportedModeWinText(
			target.doc,
			ctx.mode,
			spokenModeLines(source.doc, sourceMode, into.jackpotTiers),
		);
	} else if (sourceMode === undefined) {
		merged = mergeImportedWinText(target.doc, source.doc);
	} else {
		// The source's other mode becomes this project's primary: what it speaks becomes the families.
		const { feature, ...families } = spokenModeLines(source.doc, sourceMode, into.jackpotTiers);
		merged = mergeImportedWinText(target.doc, {
			...source.doc,
			jackpots: undefined,
			respins: undefined,
			wheel: undefined,
			...families,
			feature: { ...source.doc.feature, ...feature },
		});
	}
	if (!merged.added.length) return part('present');
	await saveWinTextDoc(ctx.client, ctx.project, merged.doc, target.etag);
	return part('added', merged.added);
}

// ─── the action ───────────────────────────────────────────────────────────────────────────────

/** What a same-client source project offers to import. */
/**
 * A source project's own Game Config, never its kind's template: a stored config that does not
 * parse resolves to the template, and importing that would copy a feature the source does not have.
 */
async function sourceConfigOf(client: string, source: string): Promise<GameConfigDoc | string> {
	const resolved = await resolveGameConfig(client, source, await projectGameType(source));
	if (resolved.source === 'template' && resolved.etag !== null) {
		return `${source}'s Game Config could not be read. Open it in /config first.`;
	}
	return resolved.doc ?? `${source} has no Game Config to import from.`;
}

/** What a same-client source project offers to import, or why it cannot be read. */
export async function sourceFeatures(client: string, source: string) {
	const config = await sourceConfigOf(client, source);
	return typeof config === 'string' ? { error: config } : { features: importableFeatures(config) };
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

	const sourceConfig = await sourceConfigOf(client, source);
	if (typeof sourceConfig === 'string') {
		return { ok: false, status: 409, error: sourceConfig };
	}
	const at = opts.at ?? new Date().toISOString();
	const result: ImportResult = record
		? resyncBonus(resolved.doc, sourceConfig, opts.mode, at)
		: importBonus(resolved.doc, sourceConfig, {
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
		sourceMode: record?.importedFrom.mode ?? opts.mode,
		respinModes: winTextRespinModes(saved),
		sourcePrimary: respinModeBlocks(sourceConfig)[0]?.mode,
		names: result.symbols,
		dropped: Object.values(previous).filter(
			(n) => !Object.values(result.symbols).includes(n) && !saved.symbols[n],
		),
		spines: new Map(),
	};
	const symbols = await guarded(() => importSymbols(ctx, saved));
	const layout = await guarded(() => importLayout(ctx));
	const flow = await guarded(() => importFlow(ctx));
	const winText = await guarded(() => importWinText(ctx));
	const failed = [...ctx.spines].filter(([, why]) => why !== null);
	const promoted = [...ctx.spines]
		.filter(([, why]) => why === null)
		.map(([bundle]) => importedRigBundle(project, source, bundle));
	const rigs = !ctx.spines.size
		? part('present')
		: part(
				promoted.length ? 'added' : 'failed',
				promoted,
				failed.length
					? `Not promoted, so they ship nothing: ${failed.map(([b, why]) => `${b} (${why})`).join('; ')}.`
					: undefined,
			);
	const parts: BonusImportParts = { symbols, layout, flow, winText, spines: rigs };
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
