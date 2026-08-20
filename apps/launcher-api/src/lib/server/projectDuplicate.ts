/**
 * Duplicate a project's R2 tree onto a new project key — the storage half of Game Maker's
 * "Duplicate / copy to another client" action (reskin a finished game for a second client, or fork
 * a variant inside the same one).
 *
 * ## Two roots, not one
 *
 * A project's data does NOT all live under `<client>/<project>/`. Its editor COMPONENTS (prefabs)
 * and their per-project param defaults live under `editor/<projectKey>/`, keyed by the project key
 * alone with no client segment. A copy that misses that root produces scenes referencing prefabs
 * that only exist for the source project — the failure is invisible until a scene renders blank. So
 * both roots are copied, and both are re-based.
 *
 * ## Why the JSON bodies are rewritten, not just copied
 *
 * Authored docs address assets by ABSOLUTE R2 key — a symbol cell pins its atlas as
 * `<client>/<project>/manifests/x.json::region`, scenes carry `projectKey`, the atlas config carries
 * `output_prefix`. A byte copy would leave the duplicate pointing at the SOURCE project's assets:
 * it would look correct in the editor (the art resolves — from the wrong project) and would keep
 * resolving even after the source is edited or deleted. So every `.json` object is re-based through
 * {@link rebaseJsonText} on the way across; non-JSON objects (atlas pages, spine binaries, fonts)
 * are server-side `CopyObject`s and never travel through this process.
 *
 * ## What `setup` vs `full` means
 *
 * `setup` copies the AUTHORING docs only — the game itself (scenes, flow, config, symbols, win text,
 * strings, components). It is small, fast, and the right default for a reskin: the duplicate keeps
 * the game and you point it at new art. `full` additionally copies the asset folders (`input/`,
 * `atlas/`, `sheets/`, `spines/`, `fonts/`, `deploy/`, `cinematics/`, `manifests/`), so the copy
 * plays immediately and you replace art in place. `full` can be thousands of objects, which is why
 * it is capped rather than silently truncated.
 */

import { SUB, projectPrefix, r2Slug } from './projectPaths';
import { copyObject, getObjectText, listAllKeys, putObjectText } from './r2';

/** How much of the source project travels. See the file header. */
export type DuplicateScope = 'setup' | 'full';

/**
 * Object-count ceiling for one duplicate. A `full` copy of a mature project is one R2 request per
 * object, so an unbounded copy can outlive the HTTP request that started it and leave a half-copied
 * project behind. Over the cap we refuse with a countable error instead of copying part of it.
 */
const MAX_OBJECTS = 4000;

/** Concurrent copies. R2 copies server-side, so this bounds request fan-out, not bandwidth. */
const COPY_CONCURRENCY = 8;

/**
 * The per-project subfolders a `setup` copy takes: the authored GAME, no art. `editor/` carries
 * `scenes.json` + both flow docs; `config`/`symbols`/`winText`/`localization` are the other four
 * authored docs. Everything absent from this list is asset output a reskin replaces.
 */
const SETUP_SUBFOLDERS: readonly ((c: string, p: string) => string)[] = [
	SUB.editor,
	SUB.config,
	SUB.symbols,
	SUB.winText,
	SUB.localization,
];

/** Per-project root config files a `setup` copy takes (they sit at the project root, not in SUB). */
const SETUP_ROOT_FILES = ['atlas_config.json', 'sheet_config.json'] as const;

export interface DuplicatePlanEntry {
	from: string;
	to: string;
}

export interface DuplicateResult {
	/** Objects actually written to the destination. */
	copied: number;
	/** Objects whose JSON body was re-based (a subset of `copied`). */
	rebased: number;
	/** Sources that vanished between listing and copying — reported, never swallowed. */
	skipped: number;
}

/** Raised when a `full` copy would exceed {@link MAX_OBJECTS}. Carries the count for the message. */
export class DuplicateTooLargeError extends Error {
	constructor(readonly objects: number) {
		super(
			`This project holds ${objects} files, over the ${MAX_OBJECTS}-file limit for one copy. ` +
				'Duplicate the game setup only, then move its assets across with the FTP Browser.',
		);
		this.name = 'DuplicateTooLargeError';
	}
}

/** The `editor/<projectKey>/` root — components + component defaults, keyed by project alone. */
const componentRoot = (projectKey: string) => `editor/${r2Slug(projectKey)}/`;

/**
 * Every source→destination key pair the copy will write.
 *
 * Built by LISTING the source rather than by enumerating known filenames, so a doc a tool adds
 * later travels automatically — the alternative (a hardcoded manifest of files) is exactly the
 * shape that leaves a new asset class stranded.
 */
export async function planDuplicate(
	source: { clientKey: string; projectKey: string },
	target: { clientKey: string; projectKey: string },
	scope: DuplicateScope,
): Promise<DuplicatePlanEntry[]> {
	const srcRoot = `${projectPrefix(source.clientKey, source.projectKey)}/`;
	const dstRoot = `${projectPrefix(target.clientKey, target.projectKey)}/`;

	const roots: { from: string; to: string }[] = [
		{ from: componentRoot(source.projectKey), to: componentRoot(target.projectKey) },
	];

	if (scope === 'full') {
		roots.push({ from: srcRoot, to: dstRoot });
	} else {
		for (const sub of SETUP_SUBFOLDERS) {
			roots.push({
				from: `${sub(source.clientKey, source.projectKey)}/`,
				to: `${sub(target.clientKey, target.projectKey)}/`,
			});
		}
	}

	const entries: DuplicatePlanEntry[] = [];
	const seen = new Set<string>();
	for (const root of roots) {
		for (const key of await listAllKeys(root.from)) {
			if (seen.has(key)) continue;
			seen.add(key);
			entries.push({ from: key, to: root.to + key.slice(root.from.length) });
		}
	}

	if (scope === 'setup') {
		for (const file of SETUP_ROOT_FILES) {
			const from = `${srcRoot}${file}`;
			if (seen.has(from)) continue;
			seen.add(from);
			entries.push({ from, to: `${dstRoot}${file}` });
		}
	}

	return entries;
}

/**
 * Re-base every absolute reference to the source project inside a JSON body.
 *
 * Three substitutions, all of which are real in stored docs:
 *  - the project's R2 prefix (`<client>/<project>/…`) — how symbol cells, flipbook clips, spine
 *    bundles and editor art pin their assets;
 *  - the `editor/<projectKey>/` component root;
 *  - the SELF-NAMING fields that hold the bare project key ({@link SELF_NAMING_FIELDS}).
 *
 * The last one is matched by FIELD NAME, not by searching for the key itself: a project key is an
 * ordinary slug that can equally be a symbol id, a component id or a word inside a localized
 * string, and a blind key-for-key swap would silently corrupt those.
 *
 * Returns the original text unchanged when nothing matched, so the caller can report how many docs
 * genuinely needed re-basing (and so an unchanged doc is not needlessly re-encoded).
 */
const SELF_NAMING_FIELDS = ['projectKey', 'output_prefix'] as const;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function rebaseJsonText(
	text: string,
	source: { clientKey: string; projectKey: string },
	target: { clientKey: string; projectKey: string },
): string {
	const prefixSwaps: [string, string][] = [
		[
			`${projectPrefix(source.clientKey, source.projectKey)}/`,
			`${projectPrefix(target.clientKey, target.projectKey)}/`,
		],
		[componentRoot(source.projectKey), componentRoot(target.projectKey)],
	];

	let out = text;
	for (const [from, to] of prefixSwaps) {
		if (from !== to) out = out.split(from).join(to);
	}
	if (source.projectKey !== target.projectKey) {
		for (const field of SELF_NAMING_FIELDS) {
			const re = new RegExp(`("${field}"\\s*:\\s*)"${escapeRe(source.projectKey)}"`, 'g');
			out = out.replace(re, `$1"${target.projectKey}"`);
		}
	}
	return out;
}

/** Copy one object, re-basing it first when it is a JSON doc. Returns what happened to it. */
async function copyOne(
	entry: DuplicatePlanEntry,
	source: { clientKey: string; projectKey: string },
	target: { clientKey: string; projectKey: string },
): Promise<'copied' | 'rebased' | 'skipped'> {
	if (!entry.from.toLowerCase().endsWith('.json')) {
		return (await copyObject(entry.from, entry.to)) ? 'copied' : 'skipped';
	}

	const text = await getObjectText(entry.from);
	if (text === null) return 'skipped';
	const rebased = rebaseJsonText(text, source, target);
	if (rebased === text) {
		// Nothing referenced the source project — a server-side copy preserves the original metadata.
		return (await copyObject(entry.from, entry.to)) ? 'copied' : 'skipped';
	}
	await putObjectText(entry.to, rebased, 'application/json');
	return 'rebased';
}

/** Run `tasks` with at most `limit` in flight, preserving nothing but completion. */
async function pooled<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
	const results: T[] = new Array(tasks.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
		for (let i = next++; i < tasks.length; i = next++) results[i] = await tasks[i]();
	});
	await Promise.all(workers);
	return results;
}

/**
 * Copy the source project's data onto the target project. The DB row must already exist — this is
 * storage only, so the caller owns project creation and can roll it back on failure.
 *
 * Throws {@link DuplicateTooLargeError} BEFORE writing anything when the plan is over the cap.
 */
export async function duplicateProjectData(
	source: { clientKey: string; projectKey: string },
	target: { clientKey: string; projectKey: string },
	scope: DuplicateScope,
): Promise<DuplicateResult> {
	const plan = await planDuplicate(source, target, scope);
	if (plan.length > MAX_OBJECTS) throw new DuplicateTooLargeError(plan.length);

	const outcomes = await pooled(
		plan.map((entry) => () => copyOne(entry, source, target)),
		COPY_CONCURRENCY,
	);

	return {
		copied: outcomes.filter((o) => o !== 'skipped').length,
		rebased: outcomes.filter((o) => o === 'rebased').length,
		skipped: outcomes.filter((o) => o === 'skipped').length,
	};
}
