import { compileModule } from 'svelte/compiler';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * A doc as a page holds it: a real Svelte 5 `$state` proxy (a rune module compiled for the client,
 * as the app compiles one), and `$state.snapshot` of it, which is what a save sends.
 *
 * A setter that mutates the value a `??=` evaluates to writes the RAW object behind the proxy. An
 * array's `length` is a signal the proxy makes when it wraps the array, so a push into the raw one is
 * never seen: the first zone, rule or force added to an empty list was lost. A plain object in a
 * fixture cannot show that; run the setter on one of these.
 */
export async function liveState(): Promise<{
	live: <T>(value: T) => T;
	saved: <T>(value: T) => T;
}> {
	const dir = mkdtempSync(join(tmpdir(), 'live-state-'));
	process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
	const source = `export const live = (value) => { const doc = $state(value); return doc; };
export const saved = (value) => $state.snapshot(value);`;
	const code = compileModule(source, {
		filename: 'liveState.svelte.js',
		generate: 'client',
	}).js.code.replaceAll(
		`'svelte/internal/client'`,
		`'${import.meta.resolve('svelte/internal/client')}'`,
	);
	const file = join(dir, 'liveState.mjs');
	writeFileSync(file, code);
	return (await import(pathToFileURL(file).href)) as {
		live: <T>(value: T) => T;
		saved: <T>(value: T) => T;
	};
}
