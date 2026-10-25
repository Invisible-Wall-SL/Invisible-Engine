// The TypeScript half of `builtins.mjs`: what a republish would bake, computed from a snapshot and a
// side's built-in defs. Imports engine-layout's sources, so it runs under the TS loader — as a child
// of the plain-node runner (`builtins.mjs` spawns it), or directly:
//
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs scripts/current-games/lib/republish.mjs \
//     extract --source <checkout>/packages/engine-layout/src/lib/builtinComponents.ts --out <builtins.json>
//   … variants --bundle <snapshot runtime.json> --base-builtins <json> --head-builtins <json> \
//     --published-builtins <json> --out <dir>
//
// WHICH BAKED DEFS ARE REPLACED. A snapshot carries no provenance: `runtimeBundle.ts` resolves each
// referenced id through project ◁ shared ◁ built-in and writes the def it found. The bake leaves a
// built-in's copy byte-equal to the built-in (its rig keys and atlas refs are bare names, which
// the post-resolve fixups leave alone), while a saved def goes through `normalizeComponent`, which
// drops a built-in's `capability`/`defaultInstanceParams` and reorders its fields, and an edit
// changes its content. So a baked def equal (by content) to the built-in of the same id AS IT WAS
// WHEN THE GAME WAS PUBLISHED is a copy of the built-in, and is replaced by each side's built-in;
// every other def is the author's. The published engine's built-ins come from the engine commit
// the snapshot's pointer records (`builtins.mjs` extracts them from that commit) and are REQUIRED:
// without them a copy main has changed since the publish would read as the author's, so the plan
// fails closed on a game whose engine it cannot tell (an error row, never a quiet pass). One set
// decides on both sides, so the two variants replace the same ids. The cases this cannot tell
// apart are recorded in docs/playtest/current-games.md § "As republished".
//
// WHAT A REPUBLISH DOES NEXT. An authored def under a built-in's id is loaded through
// `mergeBuiltinCodedParams` (`componentStorage.ts#loadComponent`): the side's built-in lends it the
// coded params, node `paramBindings` and `standsFor` the author's frozen copy lacks. The same merge
// (`mergeCodedParams`, against the side's built-ins) runs here, so a PR that adds a coded param to a
// built-in changes what a republish bakes for every game that ships an edited copy of it, and the
// row sees it. The bake then re-resolves the component CLOSURE — the instances the doc places, the
// defs those nest and the components their `component`-kind params name — so a built-in that newly
// nests another def ships it. The same `resolveComponentClosure` runs here, loading an authored id
// from the snapshot and any other from the side's built-ins, seeded with every id the snapshot
// shipped (the bake's config-assigned card ids among them). Pins follow `resolveReferencedDefs`: a
// pin the latest def's version satisfies ships nothing; any other ships the exact pinned def — the
// snapshot's authored one (merged like a latest load), else the side's built-in, which
// `loadComponent` returns for a built-in at any version. Per-project param defaults stay as baked:
// they are project data, which the harness does not read.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { mergeCodedParams } from '../../../packages/engine-layout/src/lib/builtinComponents.ts';
import {
	collectComponentPins,
	resolveComponentClosure,
} from '../../../packages/engine-layout/src/lib/collectComponentIds.ts';
import { canonical } from './builtins.mjs';

/** `BUILTIN_COMPONENTS` of `source` (a `builtinComponents.ts`), keyed by id. */
export async function extractBuiltinDefs(source) {
	const mod = await import(pathToFileURL(source).href);
	if (!Array.isArray(mod.BUILTIN_COMPONENTS))
		throw new Error(`${source} does not export BUILTIN_COMPONENTS`);
	return Object.fromEntries(mod.BUILTIN_COMPONENTS.map((def) => [def.id, def]));
}

const isCopyOf = (def, builtins) =>
	Boolean(def && builtins[def.id]) && canonical(def) === canonical(builtins[def.id]);

/**
 * The baked defs of `bundle` that are copies of `publishedBuiltins` (the built-ins of the engine the
 * game was published with), and the ones that are the author's.
 */
export function classifyBaked(bundle, publishedBuiltins) {
	const copies = [];
	const authored = [];
	for (const [id, def] of Object.entries(bundle.componentDefs ?? {}))
		(isCopyOf(def, publishedBuiltins) ? copies : authored).push(id);
	return { copies, authored };
}

/**
 * An authored def as a republish on the side whose built-ins are `sideBuiltins` loads it: under a
 * built-in's id, with that built-in's coded params, bindings and `standsFor` merged in, as
 * `loadComponent` does through `mergeBuiltinCodedParams`; otherwise as it is.
 */
const bakeAuthored = (def, sideBuiltins) =>
	sideBuiltins[def.id] ? mergeCodedParams(def, sideBuiltins[def.id]) : def;

/**
 * `bundle` as a republish on the side whose built-ins are `sideBuiltins` would bake it: the copies
 * of the published engine's built-ins (`publishedBuiltins`) replaced, the authored defs merged with
 * the side's coded params, the closure and the pins re-resolved.
 */
export async function republishWith(bundle, publishedBuiltins, sideBuiltins) {
	const { copies, authored } = classifyBaked(bundle, publishedBuiltins);
	const kept = Object.fromEntries(
		authored.map((id) => [id, bakeAuthored(bundle.componentDefs[id], sideBuiltins)]),
	);
	const load = (id) => kept[id] ?? sideBuiltins[id];
	const nodes = (bundle.doc?.scenes ?? []).flatMap((scene) => scene.nodes ?? []);
	const componentDefs = await resolveComponentClosure(nodes, load, {
		extraSeedIds: Object.keys(bundle.componentDefs ?? {}),
		defaultsFor: (id) => bundle.componentDefaults?.[id],
	});
	// `resolveReferencedDefs`: a pin the resolved def's version satisfies ships nothing; any other
	// ships the exact pinned def — the snapshot's authored one at that version, else the built-in.
	const componentVersions = [];
	for (const pin of collectComponentPins(nodes)) {
		if (componentDefs[pin.id]?.version === pin.version) continue;
		const shipped = (bundle.componentVersions ?? []).find(
			(def) => def.id === pin.id && def.version === pin.version,
		);
		const pinned =
			shipped && !isCopyOf(shipped, publishedBuiltins)
				? bakeAuthored(shipped, sideBuiltins)
				: sideBuiltins[pin.id];
		if (pinned) componentVersions.push(pinned);
	}
	const variant = { ...bundle, componentDefs };
	delete variant.componentVersions;
	if (componentVersions.length) variant.componentVersions = componentVersions;
	return { variant, copies, authored };
}

/**
 * Both sides' republished variants of `bundle`, and what separates them: `changed` is every id whose
 * def the two variants disagree on (one side lacking it included); `merged` the authored ids a
 * side's coded-params merge altered; `affected` says whether rendering the republished variant can
 * show anything the as-published render cannot. `publishedBuiltins` (the engine the game was
 * published with) classifies the baked defs and is required.
 */
export async function republish(bundle, baseBuiltins, headBuiltins, publishedBuiltins) {
	if (!publishedBuiltins)
		throw new Error(
			"the built-ins of the engine the game was published with are required: without them a baked def cannot be told a copy from the author's",
		);
	const base = await republishWith(bundle, publishedBuiltins, baseBuiltins);
	const head = await republishWith(bundle, publishedBuiltins, headBuiltins);
	const ids = new Set([
		...Object.keys(base.variant.componentDefs),
		...Object.keys(head.variant.componentDefs),
	]);
	const changed = [...ids]
		.filter(
			(id) =>
				canonical(base.variant.componentDefs[id]) !== canonical(head.variant.componentDefs[id]),
		)
		.sort();
	const merged = base.authored
		.filter((id) =>
			[base, head].some(
				(side) => canonical(side.variant.componentDefs[id]) !== canonical(bundle.componentDefs[id]),
			),
		)
		.sort();
	const versionsChanged =
		canonical(base.variant.componentVersions ?? []) !==
		canonical(head.variant.componentVersions ?? []);
	return {
		base: base.variant,
		head: head.variant,
		meta: {
			copies: base.copies,
			authored: base.authored,
			merged,
			changed,
			versionsChanged,
			affected: changed.length > 0 || versionsChanged,
		},
	};
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const [command, ...rest] = process.argv.slice(2);
	const opt = (name) => {
		const i = rest.indexOf(name);
		if (i < 0 || rest[i + 1] === undefined)
			throw new Error(`${command}: ${name} <value> is required`);
		return rest[i + 1];
	};
	const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
	if (command === 'extract') {
		const defs = await extractBuiltinDefs(opt('--source'));
		mkdirSync(dirname(opt('--out')), { recursive: true });
		writeFileSync(opt('--out'), JSON.stringify({ version: 1, defs }));
		console.log(`${Object.keys(defs).length} built-in component def(s)`);
	} else if (command === 'variants') {
		const bundle = readJson(opt('--bundle'));
		const out = opt('--out');
		const made = await republish(
			bundle,
			readJson(opt('--base-builtins')).defs,
			readJson(opt('--head-builtins')).defs,
			readJson(opt('--published-builtins')).defs,
		);
		for (const side of ['base', 'head']) {
			mkdirSync(join(out, side), { recursive: true });
			writeFileSync(join(out, side, 'runtime.json'), JSON.stringify(made[side]));
		}
		writeFileSync(join(out, 'republish.json'), JSON.stringify(made.meta, null, '\t'));
		console.log(
			`${made.meta.copies.length} built-in cop${made.meta.copies.length === 1 ? 'y' : 'ies'}, ` +
				`${made.meta.authored.length} authored, ${made.meta.changed.length} changed`,
		);
	} else {
		console.error(
			'usage: republish.mjs extract --source <ts> --out <json> | variants --bundle <json> --base-builtins <json> --head-builtins <json> --published-builtins <json> --out <dir>',
		);
		process.exit(2);
	}
}
