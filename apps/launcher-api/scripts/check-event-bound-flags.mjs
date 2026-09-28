/**
 * Guard that no function whose FIRST parameter is a boolean flag is bound straight to an event.
 *
 * Run: `pnpm --filter launcher-api run check:event-bound-flags`
 *
 * WHY. `onclick={save}` calls `save(event)`, and a `MouseEvent` is truthy — so `save(force = false)`
 * ran as `save(true)` on every click. The Symbols, FX and Localization Save buttons were each bound
 * that way: the transport sent `force` instead of the base ETag, the write guard skipped its conflict
 * check, and every manual Save silently overwrote a colleague's newer save. Bind such a function
 * through an arrow (`onclick={() => save()}`) so the flag keeps its default.
 *
 * Scans every `.svelte` / `.svelte.ts` / `.ts` file under `src`: collects the functions declared
 * there whose first parameter is `name = true|false` or `name: boolean`, then fails on any
 * `on…={fn}` attribute or `addEventListener(…, fn)` in the same file that names one of them.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const srcRoot = join(appRoot, 'src');

const FLAG_PARAM = String.raw`\(\s*\w+\s*(?::\s*boolean\s*)?(?:=\s*(?:true|false)\s*)?[,)]`;
const DECLARATIONS = [
	new RegExp(String.raw`\bfunction\s+(\w+)\s*` + FLAG_PARAM, 'g'),
	new RegExp(String.raw`\b(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?` + FLAG_PARAM, 'g'),
];
const IS_FLAG = /:\s*boolean|=\s*(?:true|false)/;

/** Names of the functions in `source` whose first parameter is a boolean flag. */
function flagFunctions(source) {
	const names = new Set();
	for (const re of DECLARATIONS) {
		for (const m of source.matchAll(re)) if (IS_FLAG.test(m[0])) names.add(m[1]);
	}
	return names;
}

/** `{ line, name, text }` for each direct event binding of a flag function in `source`. */
function directBindings(source) {
	const names = flagFunctions(source);
	if (names.size === 0) return [];
	const hits = [];
	const lines = source.split(/\r?\n/);
	const patterns = [/\bon[A-Za-z]\w*=\{\s*(\w+)\s*\}/g, /addEventListener\([^,]+,\s*(\w+)\s*[,)]/g];
	lines.forEach((text, i) => {
		for (const re of patterns) {
			for (const m of text.matchAll(re)) {
				if (names.has(m[1])) hits.push({ line: i + 1, name: m[1], text: text.trim() });
			}
		}
	});
	return hits;
}

function selfTest() {
	const bad = [
		'async function save(force = false) {}',
		'const saveDoc = async (force: boolean) => {};',
		'function toggle(on: boolean) {}',
		'<button onclick={save}>Save</button>',
		'<Child onSave={saveDoc} />',
		"window.addEventListener('keydown', toggle);",
	].join('\n');
	const good = [
		'async function save(force = false) {}',
		'function open(): void {}',
		'<button onclick={() => save()}>Save</button>',
		'<button onclick={open}>Open</button>',
	].join('\n');
	const badHits = directBindings(bad).map((h) => h.name);
	const goodHits = directBindings(good);
	if (badHits.join() !== 'save,saveDoc,toggle' || goodHits.length > 0) {
		console.error('FAIL self-test: the scanner no longer recognises the shapes it guards');
		console.error(`  bad sample hits:  ${JSON.stringify(badHits)} (want save,saveDoc,toggle)`);
		console.error(`  good sample hits: ${JSON.stringify(goodHits)} (want none)`);
		process.exit(1);
	}
}

function* sourceFiles(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) yield* sourceFiles(path);
		else if (/\.(svelte|ts)$/.test(entry.name)) yield path;
	}
}

selfTest();

let fails = 0;
let scanned = 0;
for (const file of sourceFiles(srcRoot)) {
	scanned++;
	for (const hit of directBindings(readFileSync(file, 'utf8'))) {
		console.error(
			`FAIL ${relative(appRoot, file)}:${hit.line} — \`${hit.name}\` takes a boolean first ` +
				`parameter but is bound directly, so the event arrives as that flag. ` +
				`Wrap it: \`() => ${hit.name}()\`\n    ${hit.text}`,
		);
		fails++;
	}
}

if (fails > 0) {
	console.error(`\n${fails} direct binding(s) of a boolean-flag function.`);
	process.exit(1);
}
console.log(`ok — no boolean-flag function bound directly to an event (${scanned} files)`);
