import { secretIn } from './bugFixRunsChange';

/**
 * "What Accept changes on this branch" (ADR-0015 §5, §10): a positional line diff, per file, of the
 * change's own version (`headSha:path`) against the resolved content Accept would push, computed
 * ONCE by the launcher at the result, from the head blob it fetched itself and the run's stored
 * content, never from anything the job says. Every line Accept adds, removes or moves is on it at
 * its real position, so a copy, a duplicate or a reorder shows as `-`/`+` lines and nothing depends
 * on where a hunk was placed. Pure: the GitHub reads are `pipelineMergeRuns.ts`'s.
 */

export type EditOp = { k: 'eq' | 'del' | 'add'; text: string };

/**
 * A shortest edit script from `a` to `b` (Myers' O(ND) greedy algorithm), or `null` when it needs
 * more than `maxD` insertions and deletions. `eq` ops are the longest common subsequence, so
 * applying the `eq` and `add` ops in order gives `b` and the `eq` and `del` ops give `a`.
 */
export function myers(a: string[], b: string[], maxD: number): EditOp[] | null {
	const n = a.length;
	const m = b.length;
	if (n + m === 0) return [];
	const limit = Math.min(n + m, maxD);
	const off = limit + 1;
	const v = new Int32Array(2 * limit + 3);
	const trace: Int32Array[] = [];
	let found = -1;
	for (let d = 0; d <= limit && found < 0; d++) {
		trace.push(v.slice());
		for (let k = -d; k <= d; k += 2) {
			let x: number;
			if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) x = v[off + k + 1];
			else x = v[off + k - 1] + 1;
			let y = x - k;
			while (x < n && y < m && a[x] === b[y]) {
				x++;
				y++;
			}
			v[off + k] = x;
			if (x >= n && y >= m) {
				found = d;
				break;
			}
		}
	}
	if (found < 0) return null;
	const out: EditOp[] = [];
	let x = n;
	let y = m;
	for (let d = found; d >= 0; d--) {
		const w = trace[d];
		const k = x - y;
		const prevK = k === -d || (k !== d && w[off + k - 1] < w[off + k + 1]) ? k + 1 : k - 1;
		const prevX = w[off + prevK];
		const prevY = prevX - prevK;
		while (x > prevX && y > prevY) {
			out.push({ k: 'eq', text: a[x - 1] });
			x--;
			y--;
		}
		if (d > 0) {
			if (x === prevX) out.push({ k: 'add', text: b[prevY] });
			else out.push({ k: 'del', text: a[prevX] });
		}
		x = prevX;
		y = prevY;
	}
	return out.reverse();
}

/** Applying an edit script to `a`: what Accept would write. Used to prove the diff exact. */
export const applyEdits = (ops: EditOp[]): { before: string[]; after: string[] } => ({
	before: ops.filter((o) => o.k !== 'add').map((o) => o.text),
	after: ops.filter((o) => o.k !== 'del').map((o) => o.text),
});

export interface DiffLine {
	/** A line both versions hold (context), one only the branch has (removed), or one only the merge has. */
	k: 'ctx' | 'del' | 'add';
	/** Its line number in the branch's version (null for an added line). */
	o: number | null;
	/** Its line number in the merged file (null for a removed line). */
	n: number | null;
	text: string;
}

export interface FileDiff {
	path: string;
	/**
	 * `run`: the merge writes the run's content, shown as a diff. `main`: the run's content IS main's
	 * own version of the file, which replaces the branch's (a build rule's file left pending): the
	 * change is main's whole file, not shown line by line.
	 */
	takes: 'run' | 'main';
	added: number;
	removed: number;
	hunks: DiffLine[][];
}

export const DIFF_CONTEXT = 3;
/** The most insertions and deletions one file's diff is looked for within. */
export const DIFF_MAX_D = 2_000;
/** Over a whole proposal: past either, nothing is proposed. */
export const DIFF_MAX_CHANGED_LINES = 2_000;
export const DIFF_MAX_CHANGED_CHARS = 80_000;
/** A line the diff shows only as context is cut here; a changed line is never cut. */
const CONTEXT_CHARS = 300;

/** The lines of a text, git's way: split on `\n` only (a CR stays in its line), the end of a file kept as a last empty line. */
export const linesOf = (text: string): string[] => text.split('\n');

/** The unified hunks of an edit script: every change at its real position, `DIFF_CONTEXT` lines around it. */
export function hunksOf(ops: EditOp[]): { hunks: DiffLine[][]; added: number; removed: number } {
	const numbered: DiffLine[] = [];
	let o = 0;
	let n = 0;
	for (const op of ops) {
		if (op.k === 'eq') numbered.push({ k: 'ctx', o: ++o, n: ++n, text: op.text });
		else if (op.k === 'del') numbered.push({ k: 'del', o: ++o, n: null, text: op.text });
		else numbered.push({ k: 'add', o: null, n: ++n, text: op.text });
	}
	const changed = numbered.flatMap((l, i) => (l.k === 'ctx' ? [] : [i]));
	const hunks: DiffLine[][] = [];
	let from = -1;
	let to = -1;
	for (const i of changed) {
		const lo = Math.max(0, i - DIFF_CONTEXT);
		const hi = Math.min(numbered.length - 1, i + DIFF_CONTEXT);
		if (from >= 0 && lo <= to + 1) to = hi;
		else {
			if (from >= 0) hunks.push(numbered.slice(from, to + 1));
			from = lo;
			to = hi;
		}
	}
	if (from >= 0) hunks.push(numbered.slice(from, to + 1));
	return {
		hunks,
		added: changed.filter((i) => numbered[i].k === 'add').length,
		removed: changed.filter((i) => numbered[i].k === 'del').length,
	};
}

/**
 * The diff of two texts (`null`: no file, no lines), or `null` when it needs more than
 * {@link DIFF_MAX_D} changes. A file that does not exist has no lines at all, not one empty line.
 */
export function diffText(
	before: string | null,
	after: string | null,
): ReturnType<typeof hunksOf> | null {
	const ops = myers(
		before === null ? [] : linesOf(before),
		after === null ? [] : linesOf(after),
		DIFF_MAX_D,
	);
	return ops && hunksOf(ops);
}

// ── What a line may be ────────────────────────────────────────────────────────

const FORMAT = /\p{Cf}/u;
/** U+2028, U+2029 and U+0085 end a line for JS, TS and Python (and a reader), though not for git. */
const LINE_BREAKS = new RegExp(`[${String.fromCharCode(0x2028, 0x2029, 0x85)}]`);

/**
 * Whether a line the merge ADDS (in neither side's version of the file) holds something that ends
 * or hides a line for a reader but not for a compiler: a lone CR (one that is not the CRLF before
 * the line break), U+2028, U+2029, U+0085, or any format character (a zero-width joiner, a bidi
 * mark). A CR at the very end is the CRLF of a CRLF file.
 */
export function hiddenInLine(line: string): boolean {
	const body = line.endsWith('\r') ? line.slice(0, -1) : line;
	return body.includes('\r') || LINE_BREAKS.test(body) || FORMAT.test(body);
}

/** A secret in a line, as it is and with every format character taken out (a zero-width split). */
export const secretInLine = (line: string): boolean =>
	secretIn(line) !== null || secretIn(line.replace(/\p{Cf}/gu, '')) !== null;

const VISIBLE = new RegExp(
	`[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}${String.fromCharCode(0x85, 0xfeff, 0xa0)}]`,
	'gu',
);

/**
 * A line as the card shows it (an excerpt of several lines keeps its line breaks): every control character but tab, every format character, the line and
 * paragraph separators, U+0085, U+FEFF and a no-break space rendered as what it is (`⟨CR⟩`,
 * `⟨U+200D⟩`), never dropped and never left to end the line on screen. The raw text is cut first.
 */
export const visibleText = (text: string): string =>
	text.replace(VISIBLE, (c) =>
		c === '\t' || c === '\n'
			? c
			: c === '\r'
				? '⟨CR⟩'
				: `⟨U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}⟩`,
	);

export const HIDDEN_SECRET_LINE = '[line hidden: it looks like a secret]';

/**
 * A diff as the card stores it: every line cut (context only) and then made visible, a line that
 * looks like a secret hidden (one the merge adds that neither side holds was refused before this).
 */
export function displayDiff(hunks: DiffLine[][]): DiffLine[][] {
	return hunks.map((hunk) =>
		hunk.map((l) => {
			const raw =
				l.k === 'ctx' && Array.from(l.text).length > CONTEXT_CHARS
					? `${Array.from(l.text)
							.slice(0, CONTEXT_CHARS - 1)
							.join('')}…`
					: l.text;
			return { ...l, text: secretInLine(l.text) ? HIDDEN_SECRET_LINE : visibleText(raw) };
		}),
	);
}

/** How many characters of changed lines a diff holds (raw, uncut): its share of the proposal's cap. */
export const changedChars = (hunks: DiffLine[][]): number =>
	hunks.flat().reduce((n, l) => n + (l.k === 'ctx' ? 0 : Array.from(l.text).length), 0);
