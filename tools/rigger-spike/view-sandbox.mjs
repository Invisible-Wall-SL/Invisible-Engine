// The shipped Rigger (apps/launcher-api/static/rigger/view.html) as a Node `vm` sandbox, for the
// spikes that run its functions. One place reads the page, so a view.html function that starts
// calling a new helper or reading a new top-level `let` does not turn every spike that pulls it red:
//
//   import { viewSandbox } from './view-sandbox.mjs';
//   const ui = viewSandbox({
//   	entry: ['duplicateSlotCore', 'moveSlot'], // pulled with everything they reference, transitively
//   	globals: { RIG, rawDoc: null, markDirty() {} }, // the spike's own values: never pulled over
//   	stubs: ['rebuildFromRawDoc'], // no-op functions, never pulled
//   	mutate: [['from', 'to']], // a planted mutant: text swapped in the pulled source
//   });
//   ui.duplicateSlotCore(…);
//
// What is pulled: each entry function and every top-level `function` / `const` of the page its source
// names (a bare identifier, not a `.property`), and theirs. Every top-level `let` / `var` / `const`
// that pulled code names and the spike does not give is defined on the sandbox: its own initialiser
// when that needs nothing from the page (a literal, `new Set()`), `undefined` when it has none, else
// `null`. A `const` is a property of the sandbox like the rest, so a spike reads and overrides it.
// `globals` is the context object itself, so a value in it that refers back to the sandbox works.
//
// A name that is still missing (a browser API, something the page declares inside a block) throws a
// ReferenceError that names it and the view.html function that reads it, with that function's line.
// Stack lines point at the page's own line numbers.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/** The page every spike reads: the shipped one, or RIGGER_VIEW_HTML=<path> (an older or patched copy). */
const VIEW_HTML =
	process.env.RIGGER_VIEW_HTML ||
	new URL('../../apps/launcher-api/static/rigger/view.html', import.meta.url);

const ID_START = /[A-Za-z_$]/;
const ID_PART = /[\w$]/;
const KEYWORDS_BEFORE_EXPR = new Set([
	'return',
	'typeof',
	'case',
	'in',
	'of',
	'new',
	'delete',
	'void',
	'throw',
	'else',
	'do',
	'instanceof',
	'yield',
	'await',
]);
const REGEX_AFTER = new Set([...'(,=:[!&|?{};+-*%<>~^']);
const NOT_REFS = new Set([
	'break',
	'case',
	'catch',
	'class',
	'const',
	'continue',
	'debugger',
	'default',
	'delete',
	'do',
	'else',
	'export',
	'extends',
	'finally',
	'for',
	'function',
	'if',
	'import',
	'in',
	'instanceof',
	'let',
	'new',
	'return',
	'super',
	'switch',
	'this',
	'throw',
	'try',
	'typeof',
	'var',
	'void',
	'while',
	'with',
	'yield',
	'async',
	'await',
	'of',
	'static',
	'get',
	'set',
	'true',
	'false',
	'null',
	'undefined',
	'arguments',
]);

/**
 * The tokens of `src` from `i`: identifiers, punctuation, and strings / templates / regexes /
 * comments skipped whole (a template's `${…}` is lexed as code). `stop(tok, depth)` ends the walk
 * when it returns true; `depth` counts open ( [ { and template expressions.
 */
function lex(src, i, stop) {
	const stack = [];
	let prev = '';
	const n = src.length;
	const emit = (tok) => {
		if (tok.type !== 'nl') prev = tok.type === 'id' ? `id:${tok.value}` : tok.value;
		return stop(tok, stack.length);
	};
	const template = () => {
		// at the char after ` (or after the } closing a ${…}); ends after ` or after ${
		while (i < n) {
			const c = src[i];
			if (c === '\\') i += 2;
			else if (c === '`') return void i++;
			else if (c === '$' && src[i + 1] === '{') {
				i += 2;
				stack.push('${');
				return;
			} else i++;
		}
	};
	while (i < n) {
		const c = src[i];
		const start = i;
		if (c === '\n') {
			i++;
			if (emit({ type: 'nl', value: '\n', start, end: i })) return i;
		} else if (c === ' ' || c === '\t' || c === '\r') i++;
		else if (c === '/' && src[i + 1] === '/') {
			while (i < n && src[i] !== '\n') i++;
		} else if (c === '/' && src[i + 1] === '*') {
			const e = src.indexOf('*/', i + 2);
			i = e < 0 ? n : e + 2;
		} else if (c === '"' || c === "'") {
			for (i++; i < n && src[i] !== c && src[i] !== '\n'; i++) if (src[i] === '\\') i++;
			i++;
			if (emit({ type: 'str', value: 'str', start, end: i })) return i;
		} else if (c === '`') {
			i++;
			template();
			if (emit({ type: 'str', value: 'str', start, end: i })) return i;
		} else if (
			c === '/' &&
			(prev === '' ||
				REGEX_AFTER.has(prev) ||
				(prev.startsWith('id:') && KEYWORDS_BEFORE_EXPR.has(prev.slice(3))))
		) {
			let cls = false;
			for (i++; i < n && src[i] !== '\n'; i++) {
				if (src[i] === '\\') i++;
				else if (src[i] === '[') cls = true;
				else if (src[i] === ']') cls = false;
				else if (src[i] === '/' && !cls) break;
			}
			for (i++; i < n && ID_PART.test(src[i]); i++);
			if (emit({ type: 'regex', value: 'regex', start, end: i })) return i;
		} else if (ID_START.test(c)) {
			while (i < n && ID_PART.test(src[i])) i++;
			if (emit({ type: 'id', value: src.slice(start, i), start, end: i })) return i;
		} else if (/\d/.test(c)) {
			while (i < n && /[\w.]/.test(src[i])) i++;
			if (emit({ type: 'num', value: 'num', start, end: i })) return i;
		} else {
			i++;
			if (c === '(' || c === '[' || c === '{') stack.push(c);
			else if (c === ')' || c === ']' || c === '}') {
				const open = stack.pop();
				if (open === '${') {
					template();
					if (emit({ type: 'str', value: 'str', start, end: i })) return i;
					continue;
				}
			}
			if (emit({ type: 'punct', value: c, start, end: i })) return i;
		}
	}
	return i;
}

/** Where the function declaration at `at` ends: after the `}` that closes its body. */
function functionEnd(src, at) {
	let end = -1;
	lex(src, at, (tok, depth) => {
		if (tok.type === 'punct' && tok.value === '}' && depth === 0) {
			end = tok.end;
			return true;
		}
		return false;
	});
	return end;
}

/**
 * The `let` / `const` / `var` statement at `at`: where it ends, and each binding's name and
 * initialiser range. A destructuring binding is left out (its names are not read off it).
 */
function declaration(src, at) {
	const bindings = [];
	let cur = null;
	let expectName = false;
	let end = -1;
	let started = false;
	const close = (to) => {
		if (cur?.init) cur.init[1] = to;
	};
	lex(src, at, (tok, depth) => {
		if (!started) {
			started = true;
			expectName = true;
			return false;
		}
		if (depth === 0) {
			if (tok.type === 'nl') {
				const next = src[tok.end];
				if (cur?.init && cur.init[0] < tok.start && next && ID_START.test(next)) {
					close(tok.start);
					end = tok.start;
					return true;
				}
				return false;
			}
			if (expectName) {
				expectName = false;
				cur = tok.type === 'id' ? { name: tok.value, init: null } : { name: null, init: null };
				bindings.push(cur);
				return false;
			}
			if (tok.value === '=' && cur && !cur.init) {
				cur.init = [tok.end, -1];
				return false;
			}
			if (tok.value === ',') {
				close(tok.start);
				expectName = true;
				return false;
			}
			if (tok.value === ';') {
				close(tok.start);
				end = tok.end;
				return true;
			}
			if (tok.value === '<' && src.startsWith('</script', tok.start)) {
				close(tok.start);
				end = tok.start;
				return true;
			}
		}
		return false;
	});
	return { end: end < 0 ? src.length : end, bindings: bindings.filter((b) => b.name) };
}

const views = new Map();

/**
 * View.html's top-level declarations (column 0 of each inline `<script>`): `top`, the functions and
 * consts a sandbox can pull, by name ({ kind, at, end, line, src }); `vars`, every let / var / const
 * binding with its initialiser text. Pass a path for another page (an older or patched copy).
 */
export function readView(path = VIEW_HTML) {
	const key = String(path);
	if (views.has(key)) return views.get(key);
	const html = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
	const lineAt = (() => {
		const starts = [0];
		for (let i = html.indexOf('\n'); i >= 0; i = html.indexOf('\n', i + 1)) starts.push(i + 1);
		return (pos) => {
			let lo = 0;
			let hi = starts.length - 1;
			while (lo < hi) {
				const mid = (lo + hi + 1) >> 1;
				if (starts[mid] <= pos) lo = mid;
				else hi = mid - 1;
			}
			return lo + 1;
		};
	})();
	const top = new Map();
	const vars = new Map();
	for (const s of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)) {
		const from = s.index + s[0].length;
		const to = html.indexOf('</script>', from);
		const body = html.slice(0, to);
		for (const m of body
			.slice(from)
			.matchAll(/(?<=\n)(async function\*?|function\*?|const|let|var) ([A-Za-z_$][\w$]*)/g)) {
			const at = from + m.index;
			const kind = m[1].includes('function') ? 'function' : m[1];
			if (kind === 'function') {
				if (top.has(m[2])) continue;
				const end = functionEnd(body, at);
				top.set(m[2], { kind, name: m[2], at, end, line: lineAt(at), src: html.slice(at, end) });
				continue;
			}
			const { end, bindings } = declaration(body, at);
			for (const b of bindings) {
				if (top.has(b.name) || vars.has(b.name)) continue;
				const init = b.init && html.slice(b.init[0], b.init[1]).trim();
				const decl = { kind, name: b.name, at, end, line: lineAt(at), init };
				if (kind === 'const') top.set(b.name, { ...decl, src: html.slice(at, end) });
				vars.set(b.name, decl);
			}
		}
	}
	const view = { path: key, html, top, vars, lineAt };
	views.set(key, view);
	return view;
}

/** The identifiers `src` reads: bare names, not `.property` (a spread `...x` is a read). */
function namesIn(src) {
	const names = new Set();
	let before = '';
	let before2 = '';
	lex(src, 0, (tok) => {
		if (tok.type === 'nl') return false;
		if (tok.type === 'id' && !NOT_REFS.has(tok.value) && (before !== '.' || before2 === '.'))
			names.add(tok.value);
		before2 = before;
		before = tok.value;
		return false;
	});
	return names;
}

/** A const statement as assignments onto the sandbox, each initialiser guarded. */
function constAsGlobals(decl, src) {
	const { bindings } = declaration(src, 0);
	return bindings
		.map((b) => {
			const init = b.init ? src.slice(b.init[0], b.init[1]) : 'undefined';
			const name = JSON.stringify(b.name);
			// an accessor works on a vm global only when defined from inside the context
			const unset = `Object.defineProperty(globalThis, ${name}, { configurable: true, get() { throw __viewSandboxUnset(${name}, ${decl.line}, e); }, set(v) { Object.defineProperty(globalThis, ${name}, { value: v, writable: true, configurable: true, enumerable: true }); } });`;
			return `try { globalThis.${b.name} = (${init}\n); } catch (e) { ${unset} }`;
		})
		.join(' ');
}

/** The value a `let` / `var` starts with in the sandbox; see the file comment. */
function inertDefault(decl, ctx) {
	if (decl.init == null) return undefined;
	try {
		vm.runInNewContext(`(${decl.init}\n)`, Object.create(null), { timeout: 50 });
	} catch {
		return null;
	}
	return vm.runInContext(`(${decl.init}\n)`, ctx);
}

/**
 * The view.html functions `entry` names, with everything they reach, run in a fresh `vm` context
 * made from `globals` (see the file comment). Throws, naming them, when an entry or a mutant's text
 * is not in the page.
 */
export function viewSandbox({
	entry,
	globals = {},
	stubs = [],
	mutate = [],
	label = 'spike',
	html = VIEW_HTML,
	before,
}) {
	const view = readView(html);
	const given = new Set([...Object.keys(globals), ...stubs]);
	const missing = entry.filter((n) => !view.top.has(n) && !given.has(n));
	if (missing.length)
		throw new Error(
			`view-sandbox: ${missing.join(', ')} not declared at the top level of view.html`,
		);
	const pulled = [];
	const reads = new Set();
	const seen = new Set();
	for (const q = [...entry]; q.length;) {
		const name = q.shift();
		if (seen.has(name) || given.has(name)) continue;
		seen.add(name);
		const decl = view.top.get(name);
		pulled.push(decl);
		for (const ref of namesIn(decl.src)) {
			reads.add(ref);
			if (view.top.has(ref) && !seen.has(ref)) q.push(ref);
		}
	}
	pulled.sort((a, b) => a.at - b.at);
	const chunks = [...new Map(pulled.map((d) => [d.at, { decl: d, src: d.src }])).values()];
	for (const [from, to] of mutate) {
		const c = chunks.find((ch) => ch.src.includes(from));
		if (!c) throw new Error(`mutant: "${from}" is not in the pulled source`);
		c.src = c.src.replace(from, to);
	}

	const ctx = vm.createContext(globals);
	for (const s of stubs) if (!(s in ctx)) ctx[s] = () => {};
	ctx.__viewSandboxUnset = (name, line, err) => {
		const e = new ReferenceError(
			`view-sandbox: view.html's const ${name} (line ${line}) could not be set up in the sandbox (${err?.message}) — give it in the spike's globals`,
		);
		e.viewSandbox = true;
		return e;
	};
	before?.(ctx);
	for (const name of reads) {
		const decl = view.vars.get(name);
		if (!decl || given.has(name) || seen.has(name) || name in ctx) continue;
		ctx[name] = inertDefault(decl, ctx);
	}

	let src = '';
	let line = 1;
	const owners = [];
	for (const { decl, src: chunk } of chunks) {
		if (decl.line > line) {
			src += '\n'.repeat(decl.line - line);
			line = decl.line;
		}
		const code = decl.kind === 'const' ? constAsGlobals(decl, chunk) : chunk;
		owners.push({ from: line, decl });
		src += code + '\n';
		line += code.split('\n').length;
	}
	vm.runInContext(src, ctx, { filename: `view.html#${label}` });

	const ownerAt = (ln) => {
		let o = null;
		for (const x of owners) if (x.from <= ln) o = x;
		return o?.decl;
	};
	const file = `view.html#${label}:`;
	const explain = (err) => {
		// the sandbox's errors are of its own realm: not `instanceof` this one's Error
		if (err?.name !== 'ReferenceError' || typeof err.message !== 'string' || err.viewSandbox)
			return err;
		const what = /^(\S+) is not defined/.exec(err.message)?.[1];
		const at = err.stack?.split('\n').find((l) => l.includes(file));
		const ln = at && Number(at.slice(at.indexOf(file) + file.length).split(':')[0]);
		const reader = ln && ownerAt(ln);
		if (!what || !reader) return err;
		const where = [
			...view.html.matchAll(new RegExp(`\\b(?:let|var|const|function|class) ${what}\\b`, 'g')),
		].map((m) => view.lineAt(m.index));
		const declared = where.length
			? `view.html declares it at line ${where.join(', ')}, but not at the top level the sandbox reads`
			: 'view.html does not declare it at the top level (a browser API?)';
		const e = new ReferenceError(
			`view-sandbox: ${what} is not defined — view.html's ${reader.name} (line ${reader.line}) reads it; ${declared}. Give it in the spike's globals or stubs.`,
		);
		e.stack = `${e.name}: ${e.message}\n${err.stack.split('\n').slice(1).join('\n')}`;
		e.viewSandbox = true;
		e.cause = err;
		return e;
	};
	for (const { decl } of chunks) {
		for (const name of decl.kind === 'const'
			? declaration(decl.src, 0).bindings.map((b) => b.name)
			: [decl.name]) {
			const d = Object.getOwnPropertyDescriptor(ctx, name);
			const fn = d && 'value' in d ? d.value : undefined;
			if (typeof fn !== 'function') continue;
			const wrapped = function (...args) {
				try {
					const out = new.target ? Reflect.construct(fn, args, new.target) : fn.apply(this, args);
					if (out && typeof out.then === 'function' && fn.constructor.name === 'AsyncFunction')
						return out.catch((err) => Promise.reject(explain(err)));
					return out;
				} catch (err) {
					throw explain(err);
				}
			};
			Object.defineProperty(wrapped, 'name', { value: fn.name });
			Object.defineProperty(wrapped, 'length', { value: fn.length });
			wrapped.prototype = fn.prototype;
			ctx[name] = wrapped;
		}
	}
	return ctx;
}
