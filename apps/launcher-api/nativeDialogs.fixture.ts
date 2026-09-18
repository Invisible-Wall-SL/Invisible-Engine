/**
 * Offline fixture: NO route may call the browser's own `confirm()` / `alert()` / `prompt()`.
 *
 * Run with `node` (Node >= 22.18 / 24 strips the types):
 *   node apps/launcher-api/nativeDialogs.fixture.ts
 *
 * Why a scan and not a type: these are globals on `window`, always in scope and always
 * correctly typed, so nothing a compiler does can object to one — and this app's `build` is a
 * bare `vite build` that doesn't type-check anyway (see `apps/launcher-api/CLAUDE.md`). The
 * only way a re-introduced native pop-up gets caught before a user meets it is by reading the
 * source, which is what this does.
 *
 * What it protects. A native pop-up is not a cosmetic wart:
 *   - it is not styled by us, so a destructive action looks the same as a save note;
 *   - it cannot render `requireText`, a busy state, or an error inside itself;
 *   - it BLOCKS the main thread, which is why `alert()` inside an editor's animation loop
 *     froze the canvas mid-frame;
 *   - Chrome suppresses it outright for a cross-origin iframe and after repeated use.
 * The replacement is `askConfirm()` / `askMessage()` / `askText()` in `src/lib/dialogs.svelte.ts`.
 *
 * Comments and the `.iw-*` HTML twins are not code, so the scan strips comments before
 * matching, and only looks at route sources.
 *
 * ALLOWLIST: `static/` only. Those files are vanilla JS served as-is and cannot import a
 * Svelte component (`static/rigger/cinematic.js` is the one real case) — they are out of this
 * scan's scope, and porting them needs a vanilla dialog of their own.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = join(HERE, 'src', 'routes');
const LIB = join(HERE, 'src', 'lib');

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL  ${label}\n        got      ${a}\n        expected ${e}`);
};

const SCANNED_EXT = ['.svelte', '.ts', '.js'];

function sourceFiles(root: string): string[] {
	const out: string[] = [];
	const walk = (dir: string): void => {
		for (const name of readdirSync(dir)) {
			const full = join(dir, name);
			if (statSync(full).isDirectory()) {
				walk(full);
				continue;
			}
			if (SCANNED_EXT.some((ext) => name.endsWith(ext))) out.push(full);
		}
	};
	walk(root);
	return out;
}

/**
 * Drop `//`, `/* *\/` and `<!-- -->` runs. Crude on purpose: it is allowed to mangle string
 * literals that happen to contain `//`, because a mangled string still cannot produce a false
 * NEGATIVE — a real `confirm(` sits outside any comment and survives.
 */
function stripComments(source: string): string {
	return source
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** A CALL to the global, not a method (`foo.confirm(`) or our own identifier (`onconfirm(`). */
const NATIVE_CALL = /(^|[^.\w$])(?:window\s*\.\s*)?(confirm|alert|prompt)\s*\(/g;

function nativeCalls(file: string): string[] {
	const text = stripComments(readFileSync(file, 'utf8'));
	const hits: string[] = [];
	for (const m of text.matchAll(NATIVE_CALL)) {
		const line = text.slice(0, m.index).split('\n').length;
		hits.push(`${relative(HERE, file).replace(/\\/g, '/')}:${line} ${m[2]}(`);
	}
	return hits;
}

function scan(root: string): string[] {
	return sourceFiles(root).flatMap(nativeCalls).sort();
}

console.log('no native confirm/alert/prompt survives in src/routes');
check('src/routes is clean', scan(ROUTES), []);

console.log('\nnor in src/lib — including the dialog that replaced them');
// This is why `ConfirmDialog`'s own confirm handler is called `accept()`: a local named
// `confirm` is indistinguishable from the global to any source scan, so the one file that
// would need an exception here simply does not shadow the name.
check('src/lib is clean', scan(LIB), []);

console.log('\nthe scan can actually see one (mutation test)');
// Verbatim shapes the migration removed, plus the two the regex must NOT claim.
const PROBE = [
	['bare confirm', 'if (!confirm(msg)) return;', 1],
	['window.confirm', 'if (!window.confirm(`Delete "${l}"?`)) return;', 1],
	['window . confirm, spaced', 'if (window . confirm(x)) return;', 1],
	['bare alert', "alert('Saved.');", 1],
	['bare prompt', "const n = prompt('Name:', s);", 1],
	['window.prompt', "const n = window.prompt('Name:', s);", 1],
	['two on one line', 'confirm(a); alert(b);', 2],
	['a method of something else', 'dialogApi.confirm(msg);', 0],
	['our own callback prop', 'onconfirm(typed);', 0],
	// Deliberately conservative: a source scan cannot tell a local `confirm` from the global,
	// so it flags both. Shadowing the name is the thing to fix, not the scan.
	['a local helper named confirm', 'function confirm() {}', 1],
	['our replacement', 'await askConfirm({ title });', 0],
	['inside a line comment', '// if (!confirm(msg)) return;', 0],
	['inside a block comment', '/* alert("x"); */', 0],
	['inside a markup comment', '<!-- window.confirm(x) -->', 0],
] as const;
for (const [label, snippet, expected] of PROBE) {
	check(label, [...stripComments(snippet).matchAll(NATIVE_CALL)].length, expected);
}

console.log('\nextending ConfirmDialog did not change what its existing callers pass');
// The two direct `<ConfirmDialog>` callers (admin's project delete + purge) predate the
// promise helpers and must keep working untouched. That holds only while every prop added
// for the helpers is OPTIONAL — a required one would break them silently, because `build`
// does not type-check. So read the props off the component itself.
const dialogSource = readFileSync(join(LIB, 'ConfirmDialog.svelte'), 'utf8');
const propsBlock = /interface Props \{([\s\S]*?)\n\t\}/.exec(dialogSource)?.[1] ?? '';
const props = new Map<string, boolean>(
	[...propsBlock.matchAll(/^\t\t(\w+)(\??):/gm)].map((m) => [m[1], m[2] === '?']),
);

const REQUIRED_BEFORE = ['open', 'title', 'onconfirm', 'oncancel'];
const OPTIONAL_BEFORE = [
	'confirmLabel',
	'cancelLabel',
	'danger',
	'requireText',
	'requireHint',
	'busy',
	'busyLabel',
	'blocked',
	'error',
	'body',
];
const ADDED = ['message', 'hideCancel', 'input'];

check(
	'every prop the old callers relied on still exists',
	[...REQUIRED_BEFORE, ...OPTIONAL_BEFORE].filter((p) => !props.has(p)),
	[],
);
check(
	'the props required before are still exactly the required ones',
	[...props].filter(([, optional]) => !optional).map(([name]) => name),
	REQUIRED_BEFORE,
);
check(
	'every prop added for the helpers is optional',
	ADDED.map((p) => props.get(p)),
	[true, true, true],
);

const adminSource = readFileSync(
	join(HERE, 'src', 'routes', '(app)', 'admin', '+page.svelte'),
	'utf8',
);
check(
	'admin still drives ConfirmDialog directly, twice',
	[...adminSource.matchAll(/<ConfirmDialog\b/g)].length,
	2,
);

console.log(`\n${failures === 0 ? 'ALL OK' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
