/**
 * Every surface that hands a game its layout doc must stamp the SAME effective layout profile
 * (`stampEffectiveLayoutProfile`: project override → admin global default → none).
 *
 * The online runtime bundle (`runtimeBundle.ts`) stamped the admin global default; the doc endpoint
 * the standalone/desktop build bakes (`/api/editor/doc` → `bake-editor-doc.mjs`) did not. A project
 * with no override therefore shipped the global buckets online and the coded default buckets on
 * desktop, and its landscape screen looked unlike both the editor and the live game.
 *
 *   1. Each surface calls the shared helper on the doc it returns.
 *   2. No surface re-types the rule (a second `getGlobalLayoutProfile()` stamp is how they drifted).
 *   3. The bake ships the endpoint's `doc` as is, so the stamp reaches the baked bundle.
 *   4. Each assertion fails on a planted mutant — a guard that can't fail proves nothing.
 *
 * Run:  pnpm --filter launcher-api check:layout-profile-surfaces
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lfReaderFrom } from '../../../scripts/lib/read-lf.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = lfReaderFrom(ROOT);

const HELPER = 'stampEffectiveLayoutProfile';
const SURFACES = [
	{ path: 'apps/launcher-api/src/lib/server/runtimeBundle.ts', call: `await ${HELPER}(loaded)` },
	{
		path: 'apps/launcher-api/src/routes/api/editor/doc/+server.ts',
		call: `await ${HELPER}(doc as LayoutDoc)`,
	},
];
const BAKE = 'apps/launcher-api/scripts/bake-editor-doc.mjs';

let failures = 0;
let checks = 0;
const check = (ok: boolean, label: string) => {
	checks++;
	if (ok) return;
	failures++;
	console.error(`✖ ${label}`);
};

const surfaceProblems = (source: string, call: string): string[] => {
	const problems: string[] = [];
	if (!source.includes(call)) problems.push(`does not call \`${call}\``);
	if (source.includes('getGlobalLayoutProfile(')) {
		problems.push('re-types the stamp with getGlobalLayoutProfile() instead of the helper');
	}
	return problems;
};

const bakeProblems = (source: string): string[] =>
	source.includes('const doc = data?.doc;') && source.includes('const bundle = {\n\t\tdoc,\n')
		? []
		: ['no longer writes the endpoint `doc` into the bundle as is'];

for (const { path, call } of SURFACES) {
	const source = read(path);
	for (const problem of surfaceProblems(source, call)) check(false, `${path} ${problem}`);
	check(true, `${path} stamps the effective profile`);

	const dropped = source.replace(call, '');
	check(surfaceProblems(dropped, call).length > 0, `${path}: mutant (call removed) not caught`);
	const retyped = `${source}\nconst g = await getGlobalLayoutProfile();`;
	check(surfaceProblems(retyped, call).length > 0, `${path}: mutant (rule re-typed) not caught`);
}

const bake = read(BAKE);
for (const problem of bakeProblems(bake)) check(false, `${BAKE} ${problem}`);
check(
	bakeProblems(bake.replace('const doc = data?.doc;', 'const doc = strip(data?.doc);')).length > 0,
	`${BAKE}: mutant (doc rewritten) not caught`,
);

if (failures) {
	console.error(`\n${failures} of ${checks} layout-profile surface checks failed.`);
	process.exit(1);
}
console.info(`✓ layout-profile surfaces — ${checks} checks`);
