// Where a desktop build's steps leave their notes for the build breakdown (`scripts/build-breakdown.mjs`).
//
// The Invisible Launcher sets `IE_BUILD_REPORT_DIR` to a folder OUTSIDE the game repo before it runs
// the build, the way it sets `IE_BUILD_REFUSAL_JSON`. Each step that decides what ships writes one
// JSON file there: what `pull:assets` pulled, left out, removed and trimmed (`pull.json`), and where
// `bake:doc` wrote the bundle (`bake.json`). Unset — a dev build, CI — nothing is written.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Write `name` into the build report folder, if the launcher asked for one. Never throws. */
export function writeBuildReport(name, data) {
	const dir = process.env.IE_BUILD_REPORT_DIR;
	if (!dir) return;
	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, name), `${JSON.stringify(data, null, '\t')}\n`, 'utf8');
	} catch (e) {
		console.warn(`⚠ build report: could not write ${name}: ${e instanceof Error ? e.message : e}`);
	}
}
