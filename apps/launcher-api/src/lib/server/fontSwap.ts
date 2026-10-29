import { fontParamKeysOf, type FontCatalog } from 'engine-layout';
import { roleHasTool, type Role, type ToolOverrides } from '$lib/roles';
import {
	listComponentsWithEtags,
	loadStoredProjectComponent,
	saveComponent,
} from './componentStorage';
import {
	componentDefaultsFor,
	listComponentDefaults,
	loadComponentDefaultsWithEtag,
	saveComponentDefaults,
} from './componentDefaultsStorage';
import { loadDocWithEtag, saveDoc } from './editorStorage';
import { loadFlowV2DocWithEtag, saveFlowV2Doc } from './flowV2Storage';
import { loadRenderableFonts } from './fonts';
import { liveLeases } from './lease';
import { leaseBlocker } from './projectAddOn';
import { SUB } from './projectPaths';
import { ConflictError, getObjectText, listAllKeys } from './r2';
import {
	fontRewrite,
	swapComponentDefaultsFonts,
	swapComponentDefFonts,
	swapFlowDocFonts,
	swapLayoutDocFonts,
	swapSymbolsDocFonts,
	isRecord,
	type FontKeysOf,
	type FontRewrite,
} from './fontSwapRewrite';
import { loadSymbolsDocWithEtag, saveSymbolsDoc } from './symbolsStorage';

/**
 * Font Maker "Swap": point every reference to one catalog font at another, across the project's
 * docs, so a font made in the Font Maker can replace an existing one everywhere it is used.
 *
 * Which refs are the swapped font, and how each doc's fields are rewritten, is `fontSwapRewrite.ts`.
 *
 * Only the project's own docs are written. The shared library (`_shared/editor-components`, the
 * shared flow functions) belongs to every project, and a rig's text is pixels baked from the font,
 * so rigs that use the font are reported for a re-bake in the Rigger instead of rewritten.
 */

/** A doc the swap rewrites. */
export type FontSwapDocId = 'layout' | 'components' | 'componentDefaults' | 'flow' | 'symbols';

export type FontSwapStatus = 'none' | 'planned' | 'written' | 'skipped' | 'error';

export interface FontSwapPart {
	doc: FontSwapDocId;
	label: string;
	/** The `/route` that edits the doc. */
	path: '/editor' | '/components' | '/flow-v2' | '/symbols';
	/** Every reference found, as a readable location. */
	refs: string[];
	status: FontSwapStatus;
	note?: string;
}

export interface FontSwapReport {
	from: { id: string; name: string };
	to: { id: string; name: string };
	applied: boolean;
	parts: FontSwapPart[];
	/** Rigs whose text is baked in the swapped font: re-bake them in the Rigger. */
	rigText: { bundle: string; elements: string[] }[];
	/** Why nothing was written, when an apply was refused as a whole. */
	blocked?: string;
}

/** A request the swap refuses before reading any doc (the route answers 400). */
export class FontSwapError extends Error {}

/**
 * The docs a swap may write, with the tool whose grant their own save routes check: the Component
 * Editor's APIs gate on `editor` (`accessRules.ts`), not on its card's `componentEditor`.
 */
const PARTS: { doc: FontSwapDocId; label: string; tool: string; path: FontSwapPart['path'] }[] = [
	{ doc: 'layout', label: 'Scene Editor', tool: 'editor', path: '/editor' },
	{ doc: 'components', label: 'Project components', tool: 'editor', path: '/components' },
	{
		doc: 'componentDefaults',
		label: 'Component project defaults',
		tool: 'editor',
		path: '/components',
	},
	{ doc: 'flow', label: 'Flow', tool: 'flow', path: '/flow-v2' },
	{ doc: 'symbols', label: 'Symbols', tool: 'symbols', path: '/symbols' },
];

/** A lease an author's open page holds on a doc the swap writes (`LeaseState` on each page). */
type LeaseTarget = { toolId: string; docKey: string; path: string };

export interface FontSwapOptions {
	clientKey: string;
	projectKey: string;
	fromId: string;
	toId: string;
	/** `false` reports what would change and writes nothing. */
	apply: boolean;
	/**
	 * On an apply, the number of references the caller confirmed from its dry run. The apply
	 * re-reads every doc, so when the project changed in between it writes nothing and returns the
	 * new report to confirm instead.
	 */
	expect?: number;
	/** The caller's session: their own open tabs never block the swap. */
	sessionId: string;
	role: Role;
	roleOverrides?: ToolOverrides;
	userOverrides?: ToolOverrides;
}

/** One object a step writes, named for the report. */
interface Write {
	what: string;
	run: () => Promise<unknown>;
}

/** One doc's read-rewrite; its `writes` run only on an apply. */
interface Step {
	refs: string[];
	writes: Write[];
	leases: LeaseTarget[];
	note?: string;
}

const none = (note?: string): Step => ({ refs: [], writes: [], leases: [], note });

/** Why one write did not land, in the words the report shows. */
function failure(e: unknown): string {
	if (e instanceof ConflictError) return 'saved by someone else meanwhile';
	return e instanceof Error ? e.message : String(e);
}

/**
 * Find (and with `apply`, rewrite) every reference to `fromId` so it names `toId`. Each object is
 * read under its ETag and written back through its own tool's save with a full backup
 * (`'always'`: a bulk rewrite is a deliberate swap, restorable from each tool's backups), so a
 * save that lands in between loses nothing: that object reports an error and a re-run picks it
 * up. A doc an author has open elsewhere blocks the whole apply before anything is written.
 */
export async function runFontSwap(opts: FontSwapOptions): Promise<FontSwapReport> {
	const { clientKey, projectKey } = opts;
	const rooted = await loadRenderableFonts(clientKey, projectKey);
	const catalog: FontCatalog = { prefix: '', fonts: (rooted ?? []).map((r) => r.font) };
	const from = catalog.fonts.find((f) => f.id === opts.fromId);
	const to = catalog.fonts.find((f) => f.id === opts.toId);
	if (!from) throw new FontSwapError(`No font with id "${opts.fromId}" in this project.`);
	if (!to) throw new FontSwapError(`No font with id "${opts.toId}" in this project.`);
	if (from === to) throw new FontSwapError('Pick two different fonts.');
	const rw = fontRewrite(catalog, from, to);

	// The resolved defs (coded params merged in) say which params are fonts; only a project's
	// STORED def is ever rewritten, since `mergeBuiltinCodedParams` is resolve-time only.
	const allDefs = await listComponentsWithEtags({ projectKey });
	const keysById = new Map(allDefs.map((e) => [e.def.id, fontParamKeysOf(e.def)]));
	const fontKeysOf: FontKeysOf = (id) => keysById.get(id) ?? new Set();

	const steps: Record<FontSwapDocId, () => Promise<Step>> = {
		layout: async () => {
			const loaded = await loadDocWithEtag(clientKey, projectKey);
			if (loaded.etag === null) return none();
			if (loaded.corrupt) return none('The stored layout does not parse.');
			const doc = structuredClone(loaded.doc);
			return {
				refs: swapLayoutDocFonts(doc, rw, fontKeysOf),
				writes: [
					{
						what: 'the layout',
						run: () => saveDoc(clientKey, projectKey, doc, loaded.etag, 'always'),
					},
				],
				leases: [{ toolId: 'editor', docKey: 'editor', path: '/editor' }],
			};
		},
		components: async () => {
			const step = none();
			for (const e of await listComponentsWithEtags({ projectKey, scope: 'project' })) {
				const stored = await loadStoredProjectComponent(e.def.id, projectKey);
				if (!stored) continue;
				const def = structuredClone(stored.def);
				const found = swapComponentDefFonts(def, rw, fontKeysOf);
				if (!found.length) continue;
				step.refs.push(...found);
				step.writes.push({
					what: def.name || def.id,
					run: () => saveComponent(def, projectKey, stored.etag),
				});
				step.leases.push({ toolId: 'componentEditor', docKey: def.id, path: '/editor' });
			}
			return step;
		},
		componentDefaults: async () => {
			// Keyed by the real def ids: a sidecar written before the id stamp is listed by its slug.
			const all = await listComponentDefaults(projectKey);
			const step = none();
			for (const id of keysById.keys()) {
				const params = componentDefaultsFor(all, id);
				if (!params) continue;
				const found = swapComponentDefaultsFonts(structuredClone(params), fontKeysOf(id), rw, id);
				if (!found.length) continue;
				step.refs.push(...found);
				step.writes.push({
					what: id,
					run: async () => {
						const stored = await loadComponentDefaultsWithEtag(projectKey, id);
						const next = structuredClone(stored.params);
						if (!swapComponentDefaultsFonts(next, fontKeysOf(id), rw, id).length) return;
						await saveComponentDefaults(projectKey, id, next, stored.etag, 'always');
					},
				});
				step.leases.push({ toolId: 'componentEditor', docKey: id, path: '/editor' });
			}
			return step;
		},
		flow: async () => {
			const loaded = await loadFlowV2DocWithEtag(clientKey, projectKey);
			if (!loaded.doc) return none();
			const doc = structuredClone(loaded.doc);
			return {
				refs: swapFlowDocFonts(doc, rw),
				writes: [
					{
						what: 'the flow',
						run: () => saveFlowV2Doc(clientKey, projectKey, doc, loaded.etag, 'always'),
					},
				],
				leases: [{ toolId: 'flow', docKey: 'flow', path: '/flow-v2' }],
			};
		},
		symbols: async () => {
			const loaded = await loadSymbolsDocWithEtag(clientKey, projectKey);
			if (loaded.etag === null) return none();
			if (loaded.corrupt) return none('The stored symbols doc does not parse.');
			const doc = structuredClone(loaded.doc);
			return {
				refs: swapSymbolsDocFonts(doc, rw),
				writes: [
					{
						what: 'the symbols doc',
						run: () => saveSymbolsDoc(clientKey, projectKey, doc, loaded.etag, 'always'),
					},
				],
				leases: [{ toolId: 'symbols', docKey: 'symbols', path: '/symbols' }],
			};
		},
	};

	const canUse = (tool: string) =>
		roleHasTool(opts.role, tool, opts.roleOverrides, opts.userOverrides);
	const planned: { part: FontSwapPart; step: Step }[] = [];
	for (const p of PARTS) {
		const step = await steps[p.doc]();
		const part: FontSwapPart = {
			doc: p.doc,
			label: p.label,
			path: p.path,
			refs: step.refs,
			status: step.refs.length ? 'planned' : 'none',
			note: step.note,
		};
		if (step.note) part.status = 'error';
		else if (step.refs.length && !canUse(p.tool)) {
			part.status = 'skipped';
			part.note = `Your role cannot edit ${p.label}, so these stay as they are.`;
		}
		planned.push({ part, step });
	}

	const report: FontSwapReport = {
		from: { id: from.id, name: from.name },
		to: { id: to.id, name: to.name },
		applied: false,
		parts: planned.map((p) => p.part),
		rigText: await rigTextUsing(clientKey, projectKey, rw),
	};
	if (!opts.apply) return report;

	const writing = planned.filter((p) => p.part.status === 'planned');
	const total = writing.reduce((n, p) => n + p.part.refs.length, 0);
	if (opts.expect !== undefined && opts.expect !== total) {
		return {
			...report,
			blocked: `The project changed since you looked: ${total} references now, not ${opts.expect}. Check the list and swap again.`,
		};
	}
	const targets = writing.flatMap((p) => p.step.leases);
	const editing = leaseBlocker(
		await liveLeases(targets.map((t) => ({ ...t, clientKey, projectKey }))),
		opts.sessionId,
		targets,
	);
	if (editing) return { ...report, blocked: editing };

	for (const { part, step } of writing) {
		const landed: string[] = [];
		const failed: string[] = [];
		for (const w of step.writes) {
			try {
				await w.run();
				landed.push(w.what);
			} catch (e) {
				failed.push(`${w.what} (${failure(e)})`);
			}
		}
		if (!failed.length) {
			part.status = 'written';
			continue;
		}
		part.status = 'error';
		part.note =
			(landed.length ? `Swapped in ${landed.join(', ')}. ` : '') +
			`Not swapped in ${failed.join('; ')}. Swap again to pick these up.`;
	}
	return { ...report, applied: true };
}

/**
 * The project's rigs with text baked in the swapped font — `<bundle>/text.json`, one level down.
 * Matched like every other ref (`rw.matches`), though the Rigger stores the font's id.
 */
async function rigTextUsing(
	clientKey: string,
	projectKey: string,
	rw: FontRewrite,
): Promise<FontSwapReport['rigText']> {
	const root = `${SUB.spines(clientKey, projectKey)}/`;
	const out: FontSwapReport['rigText'] = [];
	for (const key of await listAllKeys(root)) {
		const bundle = /^([^/]+)\/text\.json$/.exec(key.slice(root.length))?.[1];
		if (!bundle) continue;
		const text = await getObjectText(key);
		let elements: unknown;
		try {
			elements = text ? (JSON.parse(text) as { elements?: unknown }).elements : undefined;
		} catch {
			continue;
		}
		if (!Array.isArray(elements)) continue;
		const ids = elements
			.filter(
				(e): e is { id: string; fontId: string } =>
					isRecord(e) && typeof e.fontId === 'string' && rw.matches(e.fontId),
			)
			.map((e) => e.id);
		if (ids.length) out.push({ bundle, elements: ids });
	}
	return out;
}
