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
 * {@link rebaseJsonText} on the way across; non-JSON objects (atlas pages, rig binaries, fonts)
 * are server-side `CopyObject`s and never travel through this process.
 *
 * ## What `setup` vs `full` means
 *
 * `setup` copies the AUTHORING docs only — the game itself (scenes, flow, config, symbols, win text,
 * strings, components) and NO art, sounds or fonts. Every asset reference is still re-based onto the
 * copy's prefix, where nothing exists yet, so the copy plays on the engine's placeholder art and its
 * placed art draws blank until the reskin's own art lands. It is small and fast, and right only when
 * new art is coming.
 *
 * `full` copies the whole project prefix, so the copy plays as the source does, MINUS what describes
 * the source's own history and would make the copy lie about its own:
 *  - `published/` — the source's frozen snapshots and the live pointer. Copied, a player boot of the
 *    copy would serve the SOURCE's snapshot before its own first Publish, and Game Maker would list
 *    the source's versions as the copy's. The copy starts unpublished.
 *  - the rolling doc backups (below).
 *
 * `deploy/` travels: it is not only exporter output. The Atlas Maker's Deploy writes its packed pages
 * and TexturePacker JSON there, `findDeployedPage` (`editorRegions.ts`) prefers them over the source
 * page, and neither Publish nor the live assemble writes them — dropped, every deployed atlas would
 * fall back to a source page that may carry another packing. `storybook/` travels too: only
 * `publish-storybook.mjs` writes it, so nothing would rebuild it for the copy.
 *
 * `full` can be thousands of objects, which is why it is capped rather than silently truncated; the
 * cap counts only what is copied.
 */

import {
	SUB,
	componentDefaultsBackupsPrefix,
	editorDocBackupTarget,
	flowV2DocBackupTarget,
	gameConfigDocBackupTarget,
	projectPrefix,
	r2Slug,
	symbolsDocBackupTarget,
} from './projectPaths';
import { copyObject, getObjectText, listAllKeys, putObjectText } from './r2';

/** How much of the source project travels. See the file header. */
export type DuplicateScope = 'setup' | 'full';

/**
 * Object-count ceiling for one duplicate. A `full` copy of a mature project is one R2 request per
 * object, so an unbounded copy can outlive the HTTP request that started it and leave a half-copied
 * project behind. Over the cap we refuse with a countable error instead of copying part of it.
 */
export const MAX_OBJECTS = 4000;

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

/** Raised when a copy would write more than {@link MAX_OBJECTS}. Carries the count for the message. */
export class DuplicateTooLargeError extends Error {
	constructor(readonly objects: number) {
		super(
			`This copy would write ${objects} files, over the ${MAX_OBJECTS}-file limit for one copy. ` +
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

	// A copy starts its own history: the source's rolling doc backups and its published snapshots
	// describe the SOURCE. Carrying the backups would re-base and write every one of them (20 per
	// doc); carrying `published/` would hand the copy the source's live version (see the header).
	// Director's `director/` subtree (mockups, their ownership check, a run's crops) describes the
	// source's own Director runs and is not an asset the game ships (ADR-0005).
	const excluded = [
		editorDocBackupTarget,
		flowV2DocBackupTarget,
		symbolsDocBackupTarget,
		gameConfigDocBackupTarget,
	]
		.map((target) => target(source.clientKey, source.projectKey).prefix)
		.concat(
			componentDefaultsBackupsPrefix(source.projectKey),
			`${SUB.published(source.clientKey, source.projectKey)}/`,
			`${SUB.director(source.clientKey, source.projectKey)}/`,
		);

	const entries: DuplicatePlanEntry[] = [];
	const seen = new Set<string>();
	for (const root of roots) {
		for (const key of await listAllKeys(root.from)) {
			if (seen.has(key) || excluded.some((prefix) => key.startsWith(prefix))) continue;
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
 *  - the project's R2 prefix (`<client>/<project>/…`) — how symbol cells, flipbook clips, rig
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
 *
 * `deploy/` is copied in a second pass. R2 stamps each copy with the time it is written, and
 * `findDeployedPage` drops a deployed page older than its manifest when the source page is newer
 * still. In listing order `deploy/` lands before `manifests/` and `sheets/`, so an atlas whose
 * manifest was re-saved after its deploy, with its page under `sheets/`, showed the deployed page
 * in the source and a page of another packing in the copy. Copied last, every deployed page stands
 * — so an atlas re-packed in the source but not yet deployed shows its last deploy in the copy.
 */
export async function duplicateProjectData(
	source: { clientKey: string; projectKey: string },
	target: { clientKey: string; projectKey: string },
	scope: DuplicateScope,
): Promise<DuplicateResult> {
	const plan = await planDuplicate(source, target, scope);
	if (plan.length > MAX_OBJECTS) throw new DuplicateTooLargeError(plan.length);

	const deployRoot = `${SUB.deploy(source.clientKey, source.projectKey)}/`;
	const copyAll = (entries: DuplicatePlanEntry[]) =>
		pooled(
			entries.map((entry) => () => copyOne(entry, source, target)),
			COPY_CONCURRENCY,
		);
	const outcomes = [
		...(await copyAll(plan.filter((entry) => !entry.from.startsWith(deployRoot)))),
		...(await copyAll(plan.filter((entry) => entry.from.startsWith(deployRoot)))),
	];

	return {
		copied: outcomes.filter((o) => o !== 'skipped').length,
		rebased: outcomes.filter((o) => o === 'rebased').length,
		skipped: outcomes.filter((o) => o === 'skipped').length,
	};
}
