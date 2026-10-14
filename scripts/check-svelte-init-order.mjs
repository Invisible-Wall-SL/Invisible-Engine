// Fail the build on a component that reads a `let` / `const` / `class` of its own script BEFORE that
// binding is initialized — a `ReferenceError: Cannot access 'x' before initialization` at mount.
//
//   node scripts/check-svelte-init-order.mjs            # every tracked .svelte file
//   node scripts/check-svelte-init-order.mjs a.svelte   # just these
//
// WHY THIS EXISTS: #1190 added `let wasReadOnly = untrack(() => lease.readOnly)` ~1500 lines above
// `const lease = new LeaseState(…)` in the Scene Editor's `+page.svelte`. The initializer runs while
// the component script runs, so every load of `/editor` (and the component editor, the same page)
// threw — and every gate was green: `vite build` and `svelte-check` do not model declaration order,
// `check:undefined-names` only sees names that do not exist, and nothing mounts the page.
//
// HOW: each component is compiled for the client (the shape that actually runs) and the component
// function's top-level statements are walked in order. A statement's IMMEDIATE reads are collected —
// its initializer or expression, the body of an arrow or function it calls right away (`untrack(…)`,
// an IIFE, a top-level function or arrow the statement calls by name, followed through further such
// calls), never the body of a callback handed to anything else (`$.derived`, `$.user_effect`,
// `onMount`, event handlers, snippets): those run after the script finishes. A read of a binding
// declared by a LATER top-level statement is a hit. `<style>` blocks are dropped first (a
// preprocessor language such as SCSS is not CSS the compiler parses, and styles cannot read script
// bindings).
//
// The self-test below compiles a known-bad and a known-good component first, so a change that makes
// the walk blind fails here rather than passing every file.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { compile } = require('svelte/compiler');
const acorn = require(require.resolve('acorn', { paths: [require.resolve('svelte/compiler')] }));

/** Calls that run the callback they are handed before returning. */
const IMMEDIATE_CALLEES = new Set(['untrack']);

const isFunction = (node) =>
	node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression';

function calleeName(node) {
	if (node.type === 'Identifier') return node.name;
	if (node.type === 'MemberExpression' && !node.computed) return node.property.name;
	return null;
}

/** Names a pattern (a parameter or a declaration's left side) binds. */
function boundNames(pattern, into) {
	if (!pattern) return;
	if (pattern.type === 'Identifier') into.add(pattern.name);
	else if (pattern.type === 'AssignmentPattern') boundNames(pattern.left, into);
	else if (pattern.type === 'RestElement') boundNames(pattern.argument, into);
	else if (pattern.type === 'ArrayPattern') pattern.elements.forEach((e) => boundNames(e, into));
	else if (pattern.type === 'ObjectPattern')
		for (const p of pattern.properties) boundNames(p.type === 'RestElement' ? p : p.value, into);
}

/** Names a function binds for itself: its parameters and the declarations directly in its body. */
function localNames(fn) {
	const names = new Set();
	fn.params.forEach((p) => boundNames(p, names));
	if (fn.body.type === 'BlockStatement')
		for (const stmt of fn.body.body) {
			if (stmt.type === 'VariableDeclaration')
				stmt.declarations.forEach((d) => boundNames(d.id, names));
			if ((stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') && stmt.id)
				names.add(stmt.id.name);
		}
	return names;
}

/**
 * The names `node` reads while it is evaluated, into `out`. `fns` maps a top-level function name to
 * its node, so a by-name call is followed into the body it runs; `seen` stops recursion. A
 * function's own parameters and locals shadow the component's bindings, so they are not reads.
 */
function immediateReads(node, out, fns, seen, immediate = true) {
	if (!node || typeof node.type !== 'string') return;
	switch (node.type) {
		case 'FunctionExpression':
		case 'ArrowFunctionExpression':
		case 'FunctionDeclaration': {
			if (!immediate) return;
			const inner = new Set();
			immediateReads(node.body, inner, fns, seen);
			const locals = localNames(node);
			for (const name of inner) if (!locals.has(name)) out.add(name);
			return;
		}
		case 'CallExpression':
		case 'NewExpression': {
			immediateReads(node.callee, out, fns, seen);
			const name = calleeName(node.callee);
			if (node.callee.type === 'Identifier' && fns.has(name) && !seen.has(name)) {
				seen.add(name);
				immediateReads(fns.get(name), out, fns, seen);
			}
			for (const arg of node.arguments)
				immediateReads(arg, out, fns, seen, !isFunction(arg) || IMMEDIATE_CALLEES.has(name));
			return;
		}
		case 'MemberExpression':
			immediateReads(node.object, out, fns, seen);
			if (node.computed) immediateReads(node.property, out, fns, seen);
			return;
		case 'Property':
			if (node.computed) immediateReads(node.key, out, fns, seen);
			immediateReads(node.value, out, fns, seen, !isFunction(node.value));
			return;
		case 'MethodDefinition':
		case 'PropertyDefinition':
		case 'ClassBody':
			return;
		case 'Identifier':
			out.add(node.name);
			return;
	}
	for (const [key, value] of Object.entries(node)) {
		if (key === 'type' || key === 'start' || key === 'end') continue;
		if (Array.isArray(value)) for (const child of value) immediateReads(child, out, fns, seen);
		else if (value && typeof value.type === 'string') immediateReads(value, out, fns, seen);
	}
}

/** Every read-before-initialization in one component's source, as human-readable lines. */
export function readsBeforeInit(source, filename) {
	const stripped = source.replace(/<style[\s\S]*?<\/style>/g, '');
	const { js } = compile(stripped, { filename, generate: 'client' });
	const ast = acorn.parse(js.code, { ecmaVersion: 'latest', sourceType: 'module' });
	const component = ast.body.find((s) => s.type === 'ExportDefaultDeclaration');
	if (!component?.declaration?.body) return [];
	const body = component.declaration.body.body;

	const declaredAt = new Map();
	const fns = new Map();
	body.forEach((stmt, i) => {
		if (stmt.type === 'FunctionDeclaration') fns.set(stmt.id.name, stmt);
		if (stmt.type === 'ClassDeclaration') declaredAt.set(stmt.id.name, i);
		if (stmt.type !== 'VariableDeclaration' || stmt.kind === 'var') return;
		for (const d of stmt.declarations) {
			if (d.id.type !== 'Identifier') continue;
			declaredAt.set(d.id.name, i);
			if (isFunction(d.init)) fns.set(d.id.name, d.init);
		}
	});

	const hits = [];
	body.forEach((stmt, i) => {
		if (stmt.type === 'FunctionDeclaration') return;
		const reads = new Set();
		if (stmt.type === 'VariableDeclaration')
			for (const d of stmt.declarations)
				immediateReads(d.init, reads, fns, new Set(), !isFunction(d.init));
		else immediateReads(stmt, reads, fns, new Set());
		for (const name of reads) {
			const at = declaredAt.get(name);
			if (at === undefined || at <= i) continue;
			const text = js.code.slice(stmt.start, Math.min(stmt.end, stmt.start + 100));
			hits.push(`'${name}' is read before it is initialized: ${text.replace(/\s+/g, ' ')}`);
		}
	});
	return hits;
}

function selfTest() {
	const bad = `<script>
	import { untrack } from 'svelte';
	let early = untrack(() => lease.readOnly);
	const lease = { readOnly: false };
</script>`;
	const badViaFn = `<script>
	function readLease() { return lease.readOnly; }
	let early = readLease();
	const lease = { readOnly: false };
</script>`;
	const good = `<script>
	import { onMount } from 'svelte';
	let later = $derived(lease.readOnly);
	$effect(() => { void lease.readOnly; });
	onMount(() => lease.readOnly);
	const lease = { readOnly: false };
	const after = lease.readOnly;
</script>
<p>{later}{after}</p>`;
	const failures = [];
	if (readsBeforeInit(bad, 'Bad.svelte').length === 0) failures.push('missed a read in untrack()');
	if (readsBeforeInit(badViaFn, 'BadFn.svelte').length === 0)
		failures.push('missed a read through a called function');
	const goodHits = readsBeforeInit(good, 'Good.svelte');
	if (goodHits.length > 0) failures.push(`flagged deferred reads: ${goodHits.join('; ')}`);
	if (failures.length > 0) {
		console.error(`✗ self-test: ${failures.join(' · ')}`);
		process.exit(1);
	}
}

selfTest();

const files =
	process.argv.length > 2
		? process.argv.slice(2)
		: execFileSync('git', ['ls-files', '*.svelte'], { cwd: ROOT, encoding: 'utf8' })
				.trim()
				.split('\n');

let bad = 0;
for (const file of files) {
	let hits;
	try {
		hits = readsBeforeInit(readFileSync(resolve(ROOT, file), 'utf8'), file);
	} catch (error) {
		console.error(`✗ ${file}: could not compile — ${error.message.split('\n')[0]}`);
		bad += 1;
		continue;
	}
	if (hits.length === 0) continue;
	bad += 1;
	console.error(`✗ ${file}`);
	for (const hit of hits) console.error(`    ${hit}`);
}

if (bad > 0) {
	console.error(
		`\n${bad} of ${files.length} components read a binding before it is initialized (or did not compile).` +
			'\nMove the reading statement below the declaration it reads.',
	);
	process.exit(1);
}
console.log(`✓ no read before initialization in ${files.length} Svelte components`);
