// The TypeScript half of `builtins.mjs`: what a republish would bake, computed from a snapshot and a
// side's built-in defs. Imports engine-layout's sources, so it runs under the TS loader — as a child
// of the plain-node runner (`builtins.mjs` spawns it), or directly:
//
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs scripts/current-games/lib/republish.mjs \
//     extract --source <checkout>/packages/engine-layout/src/lib/builtinComponents.ts --out <builtins.json>
//   … variants --bundle <snapshot runtime.json> --base-builtins <json> --head-builtins <json> --out <dir>
//
// WHICH BAKED DEFS ARE REPLACED. A snapshot carries no provenance: `runtimeBundle.ts` resolves each
// referenced id through project ◁ shared ◁ built-in and writes the def it found. The bake leaves a
// built-in's copy byte-equal to the built-in (its spine keys and atlas refs are bare names, which
// the post-resolve fixups leave alone), while a saved def goes through `normalizeComponent`, which
// drops a built-in's `capability`/`defaultInstanceParams` and reorders its fields, and an edit
// changes its content. So a baked def equal (by content) to MAIN's built-in of the same id is a copy
// of the built-in, and is replaced by each side's built-in; every other def is the author's and is
// kept as baked. Main's built-ins decide on both sides, so the two variants replace the same ids.
// Two cases this cannot tell apart are recorded in docs/playtest/current-games.md: a shared-library
// save of an unchanged built-in (replaced, though a republish would keep it) and a copy of a
// built-in that main changed since the publish (kept, though a republish would replace it).
//
// WHAT A REPUBLISH DOES NEXT. The bake re-resolves the component CLOSURE — the instances the doc
// places, the defs those nest and the components their `component`-kind params name — so a built-in
// that newly nests another def ships it. The same `resolveComponentClosure` runs here, loading an
// authored id from the snapshot and any other from the side's built-ins, seeded with every id the
// snapshot shipped (the bake's config-assigned card ids among them). Pinned non-latest versions
// (`componentVersions`) follow the same copy rule. Per-project param defaults stay as baked: they
// are project data, which the harness does not read.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveComponentClosure } from '../../../packages/engine-layout/src/lib/collectComponentIds.ts';
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

/** The baked defs of `bundle` that are copies of `baseBuiltins`, and the ones that are the author's. */
export function classifyBaked(bundle, baseBuiltins) {
	const copies = [];
	const authored = [];
	for (const [id, def] of Object.entries(bundle.componentDefs ?? {}))
		(isCopyOf(def, baseBuiltins) ? copies : authored).push(id);
	return { copies, authored };
}

/**
 * `bundle` as a republish on the side whose built-ins are `sideBuiltins` would bake it, the copies
 * of main's built-ins (`baseBuiltins`) replaced and the closure re-resolved.
 */
export async function republishWith(bundle, baseBuiltins, sideBuiltins) {
	const { copies, authored } = classifyBaked(bundle, baseBuiltins);
	const kept = Object.fromEntries(authored.map((id) => [id, bundle.componentDefs[id]]));
	const load = (id) => kept[id] ?? sideBuiltins[id];
	const nodes = (bundle.doc?.scenes ?? []).flatMap((scene) => scene.nodes ?? []);
	const componentDefs = await resolveComponentClosure(nodes, load, {
		extraSeedIds: Object.keys(bundle.componentDefs ?? {}),
		defaultsFor: (id) => bundle.componentDefaults?.[id],
	});
	// A pinned copy of a built-in resolves the side's single coded def, as `loadComponent` does for
	// a built-in at any version; the bake then drops a pin the latest def already satisfies.
	const componentVersions = (bundle.componentVersions ?? [])
		.map((def) => (isCopyOf(def, baseBuiltins) ? sideBuiltins[def.id] : def))
		.filter((def) => def && componentDefs[def.id]?.version !== def.version);
	const variant = { ...bundle, componentDefs };
	delete variant.componentVersions;
	if (componentVersions.length) variant.componentVersions = componentVersions;
	return { variant, copies, authored };
}

/**
 * Both sides' republished variants of `bundle`, and what separates them: `changed` is every id whose
 * def the two variants disagree on (one side lacking it included); `affected` says whether rendering
 * the republished variant can show anything the as-published render cannot.
 */
export async function republish(bundle, baseBuiltins, headBuiltins) {
	const base = await republishWith(bundle, baseBuiltins, baseBuiltins);
	const head = await republishWith(bundle, baseBuiltins, headBuiltins);
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
	const versionsChanged =
		canonical(base.variant.componentVersions ?? []) !==
		canonical(head.variant.componentVersions ?? []);
	return {
		base: base.variant,
		head: head.variant,
		meta: {
			copies: base.copies,
			authored: base.authored,
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
		writeFileSync(opt('--out'), JSON.stringify({ version: 1, defs }));
		console.log(`${Object.keys(defs).length} built-in component def(s)`);
	} else if (command === 'variants') {
		const bundle = readJson(opt('--bundle'));
		const base = readJson(opt('--base-builtins')).defs;
		const head = readJson(opt('--head-builtins')).defs;
		const out = opt('--out');
		const made = await republish(bundle, base, head);
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
			'usage: republish.mjs extract --source <ts> --out <json> | variants --bundle <json> --base-builtins <json> --head-builtins <json> --out <dir>',
		);
		process.exit(2);
	}
}
