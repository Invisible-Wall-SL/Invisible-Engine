// Fail the build on a component that reads a `let` / `const` / `class` of its own script BEFORE
// that binding is initialized: a `ReferenceError: Cannot access 'x' before initialization` at
// mount.
//
//   node scripts/check-svelte-init-order.mjs            # every .svelte file git knows, not ignored
//   node scripts/check-svelte-init-order.mjs a.svelte   # just these (paths relative to the cwd)
//
// WHY THIS EXISTS: #1190 added `let wasReadOnly = untrack(() => lease.readOnly)` ~1500 lines above
// `const lease = new LeaseState(…)` in the Scene Editor's `+page.svelte`. The initializer runs
// while the component script runs, so every load of `/editor` (and the component editor, the same
// page) threw — and every gate was green: `vite build` and `svelte-check` do not model declaration
// order, `check:undefined-names` only sees names that do not exist, and nothing mounts the page.
//
// HOW: each component is compiled for the client (the shape that actually runs) and the component
// function's top-level statements are walked in order, collecting the reads each one makes WHILE
// the script runs. A function body counts only where it is run on the spot:
//   - an IIFE, or a top-level function or arrow the statement calls by name (followed through
//     further such calls, and into a function passed by name to a callee below);
//   - a callback handed to `untrack` (under any import alias), `$effect.pre` (a render effect runs
//     when created), a `$bindable` fallback, `new Promise(…)` or an array method (`map`, `forEach`,
//     `reduce`, `sort`, …);
//   - a `$derived` thunk whose value the statement reads (`$.get`).
// Every other function value — `$effect`, `onMount`, handlers, snippets, a function stored in an
// array, object, ternary or variable — is deferred. An async body stops at its first `await`. A
// function's parameters and every declaration inside it (blocks, `catch`, loop heads) shadow the
// component's bindings. A read of a binding declared by a LATER top-level statement is a hit.
// `<style>` blocks are blanked first (a preprocessor language such as SCSS is not CSS the compiler
// parses, and styles cannot read script bindings); line numbers survive, so a hit names its line.
//
// Not modelled: class static initializers, `<script module>` order, and a callback passed to a
// function the walk does not know runs it. The self-test below compiles known-bad and known-good
// components first, so a change that makes the walk blind (or noisy) fails here rather than
// passing (or failing) every file.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const compilerPath = require.resolve('svelte/compiler');
const { compile } = require(compilerPath);
const acorn = require(require.resolve('acorn', { paths: [compilerPath] }));
const { decode } = require(
	require.resolve('@jridgewell/sourcemap-codec', { paths: [compilerPath] }),
);

/** Methods (any receiver) that call the function they are handed before returning. */
const ARRAY_CALLBACKS = new Set([
	'every',
	'filter',
	'find',
	'findIndex',
	'findLast',
	'findLastIndex',
	'flatMap',
	'forEach',
	'map',
	'reduce',
	'reduceRight',
	'some',
	'sort',
	'toSorted',
]);
/** Svelte runtime calls (`$.x(…)`) that run a function argument on the spot. */
const SVELTE_IMMEDIATE = new Set(['untrack', 'user_pre_effect', 'prop']);
const SVELTE_DERIVED = new Set(['derived', 'user_derived']);
const SVELTE_GET = new Set(['get']);

const isFunction = (node) =>
	node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression';

const isSvelteCall = (node, names) =>
	node?.type === 'CallExpression' &&
	node.callee.type === 'MemberExpression' &&
	!node.callee.computed &&
	node.callee.object.type === 'Identifier' &&
	node.callee.object.name === '$' &&
	names.has(node.callee.property.name);

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

/** Names a function binds for itself: its parameters and every declaration in its own body. */
function localNames(fn) {
	const names = new Set();
	fn.params.forEach((p) => boundNames(p, names));
	const walk = (node) => {
		if (!node || typeof node.type !== 'string') return;
		if (node.type === 'VariableDeclarator') boundNames(node.id, names);
		if (node.type === 'CatchClause') boundNames(node.param, names);
		if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id)
			names.add(node.id.name);
		if (isFunction(node) || node.type === 'FunctionDeclaration') return;
		for (const value of Object.values(node))
			if (Array.isArray(value)) value.forEach(walk);
			else if (value && typeof value.type === 'string') walk(value);
	};
	walk(fn.body);
	return names;
}

/** Whether `call` runs a function it is handed before returning. */
function runsItsArguments(call, ctx) {
	const { callee } = call;
	if (callee.type === 'Identifier')
		return (
			ctx.untrack.has(callee.name) || (call.type === 'NewExpression' && callee.name === 'Promise')
		);
	if (isSvelteCall(call, SVELTE_IMMEDIATE)) return true;
	return callee.type === 'MemberExpression' && !callee.computed
		? ARRAY_CALLBACKS.has(callee.property.name)
		: false;
}

/** The reads `fn`'s body makes when it is called now, minus its own locals, into `out`. */
function runs(fn, out, ctx) {
	if (ctx.seen.has(fn)) return;
	ctx.seen.add(fn);
	const inner = new Set();
	const frame = { ...ctx, async: fn.async, halted: false };
	fn.params.forEach((p) => patternReads(p, inner, frame));
	reads(fn.body, inner, frame);
	const locals = localNames(fn);
	for (const name of inner) if (!locals.has(name)) out.add(name);
}

function follow(name, out, ctx) {
	const fn = ctx.fns.get(name);
	if (fn) runs(fn, out, ctx);
}

/** Reads made by a binding pattern: default values and computed keys, never the bound names. */
function patternReads(pattern, out, ctx) {
	if (!pattern) return;
	if (pattern.type === 'AssignmentPattern') {
		patternReads(pattern.left, out, ctx);
		reads(pattern.right, out, ctx);
	} else if (pattern.type === 'RestElement') patternReads(pattern.argument, out, ctx);
	else if (pattern.type === 'ArrayPattern')
		pattern.elements.forEach((e) => patternReads(e, out, ctx));
	else if (pattern.type === 'ObjectPattern')
		for (const p of pattern.properties) {
			if (p.type === 'RestElement') patternReads(p.argument, out, ctx);
			else {
				if (p.computed) reads(p.key, out, ctx);
				patternReads(p.value, out, ctx);
			}
		}
}

/** The names `node` reads while it is evaluated, into `out`. */
function reads(node, out, ctx) {
	if (!node || typeof node.type !== 'string' || ctx.halted) return;
	switch (node.type) {
		case 'FunctionExpression':
		case 'ArrowFunctionExpression':
		case 'FunctionDeclaration':
		case 'MethodDefinition':
		case 'PropertyDefinition':
		case 'BreakStatement':
		case 'ContinueStatement':
			return;
		case 'ClassDeclaration':
		case 'ClassExpression':
			reads(node.superClass, out, ctx);
			return;
		case 'VariableDeclarator':
			patternReads(node.id, out, ctx);
			reads(node.init, out, ctx);
			return;
		case 'CatchClause':
			patternReads(node.param, out, ctx);
			reads(node.body, out, ctx);
			return;
		case 'LabeledStatement':
			reads(node.body, out, ctx);
			return;
		case 'AwaitExpression':
			reads(node.argument, out, ctx);
			if (ctx.async) ctx.halted = true;
			return;
		case 'CallExpression':
		case 'NewExpression': {
			const { callee } = node;
			if (isFunction(callee)) runs(callee, out, ctx);
			else reads(callee, out, ctx);
			if (callee.type === 'Identifier') follow(callee.name, out, ctx);
			const [first] = node.arguments;
			if (isSvelteCall(node, SVELTE_GET) && first?.type === 'Identifier') {
				const thunk = ctx.derived.get(first.name);
				if (thunk) runs(thunk, out, ctx);
			}
			const immediate = runsItsArguments(node, ctx);
			for (const arg of node.arguments) {
				if (immediate && isFunction(arg)) runs(arg, out, ctx);
				else reads(arg, out, ctx);
				if (immediate && arg.type === 'Identifier') follow(arg.name, out, ctx);
			}
			return;
		}
		case 'MemberExpression':
			reads(node.object, out, ctx);
			if (node.computed) reads(node.property, out, ctx);
			return;
		case 'Property':
			if (node.computed) reads(node.key, out, ctx);
			reads(node.value, out, ctx);
			return;
		case 'Identifier':
			out.add(node.name);
			return;
	}
	for (const [key, value] of Object.entries(node)) {
		if (key === 'type' || key === 'start' || key === 'end') continue;
		if (Array.isArray(value)) for (const child of value) reads(child, out, ctx);
		else if (value && typeof value.type === 'string') reads(value, out, ctx);
	}
}

/** The source line (1-based) a generated offset maps back to, or null. */
function sourceLine(code, lines, offset) {
	const line = code.slice(0, offset).split('\n').length - 1;
	const segment = lines[line]?.find((s) => s.length >= 4);
	return segment ? segment[2] + 1 : null;
}

/** Every read-before-initialization in one component's source, as human-readable lines. */
function readsBeforeInit(source, filename) {
	const blanked = source.replace(/^[ \t]*<style\b[\s\S]*?<\/style>/gm, (block) =>
		block.replace(/[^\n]/g, ''),
	);
	const { js } = compile(blanked, { filename, generate: 'client' });
	const ast = acorn.parse(js.code, { ecmaVersion: 'latest', sourceType: 'module' });
	const component = ast.body.find((s) => s.type === 'ExportDefaultDeclaration');
	if (!component?.declaration?.body) return [];
	const body = component.declaration.body.body;

	const untrack = new Set();
	for (const stmt of ast.body)
		if (stmt.type === 'ImportDeclaration' && stmt.source.value === 'svelte')
			for (const s of stmt.specifiers)
				if (s.type === 'ImportSpecifier' && s.imported.name === 'untrack')
					untrack.add(s.local.name);

	const declaredAt = new Map();
	const fns = new Map();
	const derived = new Map();
	body.forEach((stmt, i) => {
		if (stmt.type === 'FunctionDeclaration') fns.set(stmt.id.name, stmt);
		if (stmt.type === 'ClassDeclaration') declaredAt.set(stmt.id.name, i);
		if (stmt.type !== 'VariableDeclaration' || stmt.kind === 'var') return;
		for (const d of stmt.declarations) {
			const names = new Set();
			boundNames(d.id, names);
			for (const name of names) declaredAt.set(name, i);
			if (d.id.type !== 'Identifier') continue;
			if (isFunction(d.init)) fns.set(d.id.name, d.init);
			if (isSvelteCall(d.init, SVELTE_DERIVED) && isFunction(d.init.arguments[0]))
				derived.set(d.id.name, d.init.arguments[0]);
		}
	});

	const lines = decode(js.map.mappings);
	const hits = [];
	body.forEach((stmt, i) => {
		const found = new Set();
		reads(stmt, found, { fns, derived, untrack, seen: new Set(), async: false, halted: false });
		for (const name of found) {
			const at = declaredAt.get(name);
			if (at === undefined || at <= i) continue;
			const line = sourceLine(js.code, lines, stmt.start);
			const text = js.code.slice(stmt.start, Math.min(stmt.end, stmt.start + 100));
			hits.push(
				`${line === null ? '' : `line ${line}: `}'${name}' is read before it is initialized: ` +
					text.replace(/\s+/g, ' '),
			);
		}
	});
	return hits;
}

function selfTest() {
	const late = 'const lease = { on: true };';
	const bad = {
		'a read inside untrack()': `import { untrack } from 'svelte'; let x = untrack(() => lease.on);`,
		'a read inside an aliased untrack()': `import { untrack as peek } from 'svelte';
			let x = peek(() => lease.on);`,
		'a read through a called function': `function read() { return lease.on; } let x = read();`,
		'a read inside $effect.pre': `$effect.pre(() => { void lease.on; });`,
		'a read inside an array callback': `const x = [1].map(() => lease.on);`,
		'a read of a $derived that reads late': `let a = $derived(lease.on); let x = !a;`,
	};
	const good = `<script>
	import { onMount } from 'svelte';
	let later = $derived(lease.on);
	$effect(() => { void lease.on; });
	onMount(() => lease.on);
	const handlers = [() => close(), Math.random() > 0.5 ? () => close() : null];
	async function load() { await Promise.resolve(); items = parse(); }
	load();
	function safe() { try { return 1; } catch (error) { for (const items of [error]) return items; } }
	const parsed = safe();
	${late}
	const after = lease.on;
	const close = () => {};
	const parse = () => [];
	let items = $state([]);
	let error = $state(null);
</script>
<p>{later}{after}{handlers.length}{parsed}{items.length}{error}</p>`;
	const failures = [];
	for (const [label, code] of Object.entries(bad))
		if (readsBeforeInit(`<script>${code} ${late}</script>`, 'Bad.svelte').length === 0)
			failures.push(`missed ${label}`);
	const destructured = '<script>let x = on; const { on } = { on: true };</script>';
	if (readsBeforeInit(destructured, 'Bad.svelte').length === 0)
		failures.push('missed a read of a destructured binding');
	const goodHits = readsBeforeInit(good, 'Good.svelte');
	if (goodHits.length > 0) failures.push(`flagged deferred or local reads: ${goodHits.join('; ')}`);
	if (failures.length > 0) {
		console.error(`✗ self-test: ${failures.join(' · ')}`);
		process.exit(1);
	}
}

selfTest();

const files =
	process.argv.length > 2
		? process.argv.slice(2).map((file) => resolve(process.cwd(), file))
		: execFileSync('git', ['ls-files', '-z', '-co', '--exclude-standard', '--', '*.svelte'], {
				cwd: ROOT,
				encoding: 'utf8',
			})
				.split('\0')
				.filter(Boolean)
				.map((file) => resolve(ROOT, file))
				.filter((file) => existsSync(file));

let bad = 0;
for (const file of files) {
	const shown = relative(ROOT, file);
	if (!existsSync(file)) {
		console.error(`✗ ${shown}: not found`);
		bad += 1;
		continue;
	}
	let hits;
	try {
		hits = readsBeforeInit(readFileSync(file, 'utf8'), shown);
	} catch (error) {
		console.error(`✗ ${shown}: could not compile — ${error.message.split('\n')[0]}`);
		bad += 1;
		continue;
	}
	if (hits.length === 0) continue;
	bad += 1;
	console.error(`✗ ${shown}`);
	for (const hit of hits) console.error(`    ${hit}`);
}

if (bad > 0) {
	console.error(
		`\n${bad} of ${files.length} components read a binding before it is initialized ` +
			'(or did not compile).\nMove the reading statement below the declaration it reads.',
	);
	process.exit(1);
}
console.log(`✓ no read before initialization in ${files.length} Svelte components`);
