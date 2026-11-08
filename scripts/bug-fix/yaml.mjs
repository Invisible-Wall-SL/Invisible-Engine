// The YAML the fix-run workflows are written in, read strictly: block mappings and sequences,
// plain and quoted scalars, `|` / `>` block scalars, comments. Every scalar stays a string (no
// `true` → boolean, no `75` → number), and anything outside that subset — flow collections,
// anchors, aliases, tags, a plain scalar continued on the next line, a duplicate key — throws, so a
// workflow written another way fails its fixture loudly instead of being half read.

const KEY = /^([A-Za-z_][\w.-]*|'[^']*'|"[^"]*")\s*:(?:\s+(.*)|\s*)$/;

function unquote(raw, lineNo) {
	if (raw.startsWith("'")) {
		const m = /^'((?:[^']|'')*)'\s*(?:#.*)?$/.exec(raw);
		if (!m) throw new Error(`line ${lineNo}: an unclosed single-quoted scalar`);
		return m[1].replace(/''/g, "'");
	}
	if (raw.startsWith('"')) {
		const m = /^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/.exec(raw);
		if (!m) throw new Error(`line ${lineNo}: an unclosed double-quoted scalar`);
		return JSON.parse(m[1]);
	}
	if (/^[[{&*!%@`]/.test(raw))
		throw new Error(`line ${lineNo}: "${raw[0]}" starts a form this reader refuses`);
	return raw.replace(/\s+#.*$/, '').trim();
}

export function parseYaml(text) {
	const lines = text
		.replace(/\r\n/g, '\n')
		.split('\n')
		.map((raw, i) => ({ raw, no: i + 1, indent: raw.length - raw.trimStart().length }));
	if (lines.some((l) => /^\t/.test(l.raw))) throw new Error('a tab in indentation');
	let at = 0;
	const significant = (l) => l.raw.trim() !== '' && !l.raw.trimStart().startsWith('#');
	const peek = () => {
		while (at < lines.length && !significant(lines[at])) at++;
		return lines[at];
	};

	function blockScalar(header, parentIndent, lineNo) {
		const m = /^([|>])([+-]?)\s*(?:#.*)?$/.exec(header);
		if (!m) throw new Error(`line ${lineNo}: a block scalar header this reader refuses`);
		const body = [];
		let indent = null;
		while (at < lines.length) {
			const l = lines[at];
			if (l.raw.trim() === '') {
				body.push('');
				at++;
				continue;
			}
			if (l.indent <= parentIndent) break;
			indent ??= l.indent;
			if (l.indent < indent)
				throw new Error(`line ${l.no}: a block scalar line indented less than its first`);
			body.push(l.raw.slice(indent));
			at++;
		}
		while (body.length && body.at(-1) === '') body.pop();
		let out;
		if (m[1] === '|') out = body.join('\n');
		else {
			out = body
				.join('\n')
				.replace(/([^\n])\n(?=[^\n])/g, '$1 ')
				.replace(/\n\n/g, '\n');
		}
		return m[2] === '-' ? out : `${out}\n`;
	}

	function value(rest, indent, lineNo) {
		if (rest === undefined || rest === '' || rest.startsWith('#')) {
			const next = peek();
			if (!next) return null;
			if (next.indent > indent) return block(next.indent);
			if (next.indent === indent && /^-(\s|$)/.test(next.raw.trimStart())) return block(indent);
			return null;
		}
		if (/^[|>]/.test(rest)) return blockScalar(rest, indent, lineNo);
		const scalar = unquote(rest, lineNo);
		const next = peek();
		if (next && next.indent > indent) {
			throw new Error(`line ${next.no}: a plain scalar continued on the next line`);
		}
		return scalar;
	}

	function mapping(indent, first) {
		const out = {};
		let line = first;
		for (;;) {
			const m = KEY.exec(line.text);
			if (!m) throw new Error(`line ${line.no}: not a "key: value" line`);
			const key = unquote(m[1], line.no);
			if (Object.hasOwn(out, key)) throw new Error(`line ${line.no}: the key "${key}" twice`);
			out[key] = value(m[2], indent, line.no);
			const next = peek();
			if (!next || next.indent !== indent || /^-(\s|$)/.test(next.raw.trimStart())) {
				if (next && next.indent > indent)
					throw new Error(`line ${next.no}: unexpected indentation`);
				return out;
			}
			at++;
			line = { text: next.raw.trim(), no: next.no };
		}
	}

	function sequence(indent) {
		const out = [];
		for (;;) {
			const l = peek();
			if (!l || l.indent !== indent || !/^-(\s|$)/.test(l.raw.trimStart())) return out;
			at++;
			const rest = l.raw.trimStart().slice(1).trimStart();
			if (rest === '' || rest.startsWith('#')) out.push(value(undefined, indent, l.no));
			else if (KEY.test(rest)) out.push(mapping(indent + 2, { text: rest, no: l.no }));
			else out.push(value(rest, indent, l.no));
		}
	}

	function block(indent) {
		const l = peek();
		if (/^-(\s|$)/.test(l.raw.trimStart())) return sequence(indent);
		at++;
		return mapping(indent, { text: l.raw.trim(), no: l.no });
	}

	const first = peek();
	if (!first) return null;
	if (first.indent !== 0)
		throw new Error(`line ${first.no}: the document does not start at column 0`);
	const doc = block(0);
	if (peek()) throw new Error(`line ${peek().no}: text after the document`);
	return doc;
}
