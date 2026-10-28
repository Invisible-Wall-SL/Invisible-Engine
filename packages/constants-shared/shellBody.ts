/**
 * A compiled Shader Graph body made ready for a shell other than the element's pass (Invisible
 * Shader Graph steps 8d and 8e): the particle shell (`particleShell.ts`) and the screen shell
 * (`screenShell.ts`) run the body `ElementFxFilter` runs, through this one conversion. It checks the
 * body is one it can convert surely, turns the shell's per-pixel sources from uniforms into
 * varyings where the shell hands them that way, and renames the body's `main`, which the shell's
 * own `main` then calls.
 *
 * Dependency-free, like `glslLibrary.ts`.
 */

import type { CustomElementFx } from './elementFx';

/** Each per-pixel source a body reads, as the compiler declares it. */
const SOURCES = {
	time: { name: 'uFx', type: 'vec4' },
	seed: { name: 'uSeed', type: 'float' },
} as const;

/** The element pass's own names: a body a shell converts reads none, whatever the shell declares. */
export const ELEMENT_PASS_NAMES = [
	'vTextureCoord',
	'uInputSize',
	'uInputClamp',
	'uOutputFrame',
	'uOutputTexture',
	'uElement',
	'uPad',
] as const;

/** The globals of one storage qualifier `source` declares, in order, each with its type. */
export const shellDeclarations = (source: string, qualifier: 'in' | 'out' | 'uniform') =>
	[...source.matchAll(new RegExp(`^${qualifier}\\s+(\\w+)\\s+(\\w+)\\s*;`, 'gm'))].map(
		([, type, name]) => ({ type, name }),
	);

/**
 * `code` with its comments taken out (a line comment up to its line's end, which a lone carriage
 * return also is), or undefined when a block comment never ends.
 */
function withoutComments(code: string): string | undefined {
	let out = '';
	for (let at = 0; at < code.length;) {
		if (code.startsWith('//', at)) {
			at += 2;
			while (at < code.length && code[at] !== '\n' && code[at] !== '\r') at++;
		} else if (code.startsWith('/*', at)) {
			const end = code.indexOf('*/', at + 2);
			if (end < 0) return undefined;
			out += ' ';
			at = end + 2;
		} else {
			out += code[at++];
		}
	}
	return out;
}

const count = (code: string, pattern: RegExp): number => code.match(pattern)?.length ?? 0;

export interface ShellBodyRules {
	/** Whether the shell hands the time and seed as varyings (`in`) rather than uniforms. */
	varyings: boolean;
	/** The names a body may not read: the shell's own (`finalColor` and the sources aside). */
	reserved: readonly string[];
	/** What the body's `main` is renamed to. */
	main: string;
}

/**
 * A compiled effect's pass body converted for a shell: its comments out, its time and seed made
 * varyings when the shell says so, its `main` renamed (`code`); and the body with its comments out
 * as it was (`live`), for what the shell reads off it. Undefined for a body it cannot convert surely:
 * a preprocessor line or a backslash, an unended comment, two uniforms of one name, a time or seed
 * source not under the name and type the compiler gives it, or a param under either name; either
 * not declared once in the compiler's form (`uniform vec4 uFx;` on its own line), or named in a body
 * that reports no such source; a reserved name in the body; no single `void main(void)`; no
 * `finalColor`.
 */
export function shellBody(
	shader: Pick<CustomElementFx['shader'], 'body' | 'uniforms'>,
	rules: ShellBodyRules,
): { code: string; live: string } | undefined {
	const { body, uniforms } = shader;
	if (/[#\\]/.test(body)) return undefined;
	const live = withoutComments(body);
	if (live === undefined) return undefined;
	const names = uniforms.map((u) => u.name);
	if (new Set(names).size !== names.length) return undefined;
	const sourceNames: readonly string[] = Object.values(SOURCES).map((v) => v.name);
	for (const { name, type, source } of uniforms) {
		if (source.kind === 'param') {
			if (sourceNames.includes(name)) return undefined;
			continue;
		}
		const expected = Object.hasOwn(SOURCES, source.kind) ? SOURCES[source.kind] : undefined;
		if (!expected || name !== expected.name || type !== expected.type) return undefined;
	}
	let code = live;
	for (const { name, type } of Object.values(SOURCES)) {
		if (!names.includes(name)) {
			if (count(code, new RegExp(`\\b${name}\\b`, 'g'))) return undefined;
			continue;
		}
		const line = new RegExp(`^uniform ${type} ${name};$`, 'm');
		const declared = new RegExp(`\\b(?:float|int|bool|vec[234]|mat[234])\\s+${name}\\b`, 'g');
		if (!line.test(code) || count(code, declared) !== 1) return undefined;
		if (rules.varyings) code = code.replace(line, `in ${type} ${name};`);
	}
	const reads = [...sourceNames, 'finalColor'];
	if (
		rules.reserved.some(
			(name) => !reads.includes(name) && count(live, new RegExp(`\\b${name}\\b`, 'g')),
		) ||
		count(live, /\bmain\b/g) !== 1 ||
		!/^void main\(void\)$/m.test(live) ||
		!/\bfinalColor\b/.test(live)
	) {
		return undefined;
	}
	return { code: code.replace(/^void main\(void\)$/m, `void ${rules.main}(void)`), live };
}
