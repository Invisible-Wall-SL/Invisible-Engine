#!/usr/bin/env node
// Guard against the exact bug that shipped once already: the four HTML "twin"
// tool bars (rigger/spine static view.html + the atlas/sheet Python-served HTML)
// each hand-maintain a COPY of roles.ts `TOOL_ICONS`, keyed by tool id. When a new
// online tool is added to roles.ts but not to a twin, that tool renders with a
// blank icon in those bars. This asserts every online tool in the switcher order
// has an icon entry in each twin. Run: `node scripts/check-toolbar-icons.mjs`.
//
// The launcher's own $lib/ToolTopBar.svelte is NOT checked here — it imports the
// icons directly from roles.ts, so it can't drift.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readLF } from './lib/read-lf.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The bar only ever shows the online tools listed in TOOL_STAGES (TOOL_BAR_ORDER
// is derived from it), so that list is the set of ids each twin must cover.
const roles = readLF(join(root, 'apps/launcher-api/src/lib/roles.ts'));
const stagesBlock = roles.slice(roles.indexOf('TOOL_STAGES'), roles.indexOf('stageOfTool'));
const required = [...stagesBlock.matchAll(/tools:\s*\[([^\]]*)\]/g)].flatMap((m) =>
	[...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]),
);

const TWINS = [
	'apps/launcher-api/static/rigger/view.html',
	'apps/launcher-api/static/spine/view.html',
	'services/atlas-tool/ui_server.py',
	'services/sheet-tool/ui.html',
];

let failed = false;
for (const rel of TWINS) {
	const src = readLF(join(root, rel));
	const start = src.indexOf('var ICON = {');
	const body = src.slice(start, src.indexOf('};', start));
	const have = new Set([...body.matchAll(/(\w+):\s*'/g)].map((m) => m[1]));
	const missing = required.filter((id) => !have.has(id));
	if (missing.length) {
		failed = true;
		console.error(`✗ ${rel} is missing icons: ${missing.join(', ')}`);
	} else {
		console.log(`✓ ${rel}`);
	}
}

if (failed) {
	console.error('\nAdd the missing icon body (copy from roles.ts TOOL_ICONS) to each twin above.');
	process.exit(1);
}
console.log(`\nAll ${TWINS.length} tool-bar twins cover every online tool (${required.length}).`);
