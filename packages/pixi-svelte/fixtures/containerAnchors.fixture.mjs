// @ts-nocheck — a Node script inside a browser package; its tsconfig has no Node types, so checking it
// only adds noise to the package's svelte-check.
/**
 * Offline fixture: `<Container>` (`src/lib/components/Container.svelte`) puts its children's anchors
 * inside an element of its own, hidden, so the page holds the Pixi component tree as a tree.
 *
 *   pnpm check:all --only containerAnchors
 *
 * Why: Svelte leaves a comment or text node in the page for every block of the Pixi tree. With every
 * one of them a sibling of the canvas (~10k on a booted game), WebKit walked that whole run on each
 * node it inserted, removed or moved, to find the nearest element on either side: ~0.1 ms a node in
 * WebKitGTK, which was most of a keyed `{#each}`'s moves on the reel board, a `Symbol`'s teardown and
 * a `Container`'s (`docs/status/engine.md`, 2026-11-12). Nested, a parent holds a few dozen.
 *
 * Pins, from the component as Svelte compiles it for the client: its whole DOM is one `hidden`
 * element (it never draws, and nothing else of the component reaches the page), and the children
 * render at that element's own anchor.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';

let failures = 0;
const check = (label, ok, detail = '') => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};

const file = join(
	dirname(fileURLToPath(import.meta.url)),
	'../src/lib/components/Container.svelte',
);
const code = compile(readFileSync(file, 'utf8'), {
	generate: 'client',
	filename: 'Container.svelte',
}).js.code;
const component = code.slice(code.indexOf('function Container('));
const templates = [...code.matchAll(/\$\.from_html\(`([^`]*)`/g)].map((m) => m[1]);
const appended = [...component.matchAll(/\$\.append\(\$\$anchor, (\w+)\)/g)].map((m) => m[1]);

console.log("the container's DOM");
check(
	'one template: a hidden element holding one anchor',
	templates.length === 1 && templates[0] === '<div hidden=""><!></div>',
	JSON.stringify(templates),
);
const element = /var (\w+) = root\(\);/.exec(component)?.[1];
check(
	'the component puts that element in the page, and nothing else',
	element !== undefined && appended.length === 1 && appended[0] === element,
	JSON.stringify({ element, appended }),
);

console.log("the children's anchors");
const anchor =
	element && new RegExp(`var (\\w+) = \\$\\.child\\(${element}\\);`).exec(component)?.[1];
check(
	"the children render at the element's own anchor",
	anchor !== undefined &&
		new RegExp(`\\$\\.snippet\\(${anchor}, \\(\\) => \\$\\$props\\.children\\)`).test(component),
	component,
);

if (failures) throw new Error(`containerAnchors.fixture: ${failures} FAILED`);
console.log('\ncontainerAnchors.fixture: all ok');
