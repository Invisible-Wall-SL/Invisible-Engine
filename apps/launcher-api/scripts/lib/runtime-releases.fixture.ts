/**
 * The runtime rollback floor for irig rigs (docs/design/irig-format.md §7). Run:
 * pnpm exec tsx apps/launcher-api/scripts/lib/runtime-releases.fixture.ts
 *
 * A release records the irig schema revision it reads (`rigReader`); the "Runtime rollback"
 * workflow refuses a release that reads less than the launcher on `main` writes.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IRIG_SCHEMA_REVISION } from '../../../../packages/engine-rig/src/irig/schema.ts';
import { rigReaderProblem, rigReaderRevision } from './runtime-releases.mjs';

let failures = 0;
let checks = 0;
function check(ok: boolean, what: string): void {
	checks++;
	if (!ok) {
		failures++;
		console.error(`  ✗ ${what}`);
	}
}

const floor = await rigReaderRevision();
check(
	floor === IRIG_SCHEMA_REVISION,
	`the scripts read revision ${floor}, the schema says ${IRIG_SCHEMA_REVISION}`,
);

const release = (rigReader?: number) => ({
	version: 'v',
	...(rigReader === undefined ? {} : { rigReader }),
});
check(
	/predates the record/.test(rigReaderProblem(release(), floor) ?? ''),
	'a release from before the record is refused',
);
check(
	rigReaderProblem(release(floor - 1), floor) !== null,
	'a release reading an older revision is refused',
);
check(
	rigReaderProblem(release(floor), floor) === null,
	'a release reading this revision may serve',
);
check(rigReaderProblem(release(floor + 1), floor) === null, 'a newer release may serve');

const dir = mkdtempSync(join(tmpdir(), 'rig-floor-'));
const renamed = join(dir, 'schema.ts');
writeFileSync(renamed, 'export const IRIG_SCHEMA_REV = 3;\n');
let threw = false;
try {
	await rigReaderRevision(renamed);
} catch {
	threw = true;
}
check(threw, 'a schema whose revision cannot be found stops the scripts, not a silent floor of 0');

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
