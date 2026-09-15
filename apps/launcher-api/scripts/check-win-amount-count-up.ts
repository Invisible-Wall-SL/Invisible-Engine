/**
 * Contract check for the "Win amount text → Count up" fields (Invisible Symbols State Machine):
 * `countUp` / `countUpDuration` / `cueBigWin` / `fadeIn` / `fadeInDuration`.
 *
 * All five default OFF, so the whole contract is PARITY: an untouched project must persist no
 * `winLine` at all. The other half is the invariant this tool has burned itself on before — the
 * CLIENT prune and the SERVER prune must agree EXACTLY, or the page reads dirty the instant a clean
 * save comes back. Both halves are exercised over the REAL functions (`setWinLineText` →
 * `pruneWinLine`, and `normalizeSymbolsDoc`), never a re-typed copy of them.
 *
 * Run:  pnpm --filter launcher-api exec tsx --tsconfig tsconfig.scripts.json \
 *         scripts/check-win-amount-count-up.ts
 *
 * The `--tsconfig` maps SvelteKit's `$env/dynamic/private` to a stub (`scripts/lib/env-stub.ts`),
 * because `symbolsStorage.ts` reaches R2 → `env.ts` → that virtual module, which only exists
 * inside a SvelteKit build.
 */

import { normalizeSymbolsDoc } from '../src/lib/server/symbolsStorage.ts';
import {
	docSignature,
	setWinLineText,
	winLineTextCountUp,
	winLineTextCueBigWin,
	winLineTextFadeIn,
	type SymbolsDoc,
} from '../src/routes/(app)/symbols/symbols.client.ts';

let failures = 0;
let checks = 0;
const canon = (value: unknown): unknown =>
	Array.isArray(value)
		? value.map(canon)
		: value && typeof value === 'object'
			? Object.fromEntries(
					Object.keys(value as Record<string, unknown>)
						.sort()
						.map((k) => [k, canon((value as Record<string, unknown>)[k])]),
				)
			: value;
const json = (value: unknown): string => JSON.stringify(canon(value));
const check = (label: string, actual: unknown, expected: unknown): void => {
	checks += 1;
	if (json(actual) === json(expected)) return;
	failures += 1;
	console.log(
		`FAIL  ${label}\n        expected ${json(expected)}\n        actual   ${json(actual)}`,
	);
};

const empty = (): SymbolsDoc => ({ version: 1, symbols: {} });
/** The client setter's prune and the server's normalize must answer the SAME `winLine`. */
const bothWays = (label: string, doc: SymbolsDoc, expected: unknown): void => {
	check(`${label} — client`, doc.winLine, expected);
	check(`${label} — server`, normalizeSymbolsDoc(doc).winLine, expected);
};

console.log('\n1. every new field OFF ⇒ no winLine at all (byte-parity)');
bothWays('countUp false', setWinLineText(empty(), { countUp: false }), undefined);
bothWays('fadeIn false', setWinLineText(empty(), { fadeIn: false }), undefined);
bothWays('cueBigWin false', setWinLineText(empty(), { cueBigWin: false }), undefined);
bothWays(
	'all three off together',
	setWinLineText(empty(), { countUp: false, cueBigWin: false, fadeIn: false }),
	undefined,
);

console.log('\n2. countUp ON + a duration ⇒ both persist');
bothWays('countUp + duration', setWinLineText(empty(), { countUp: true, countUpDuration: 1.25 }), {
	text: { countUp: true, countUpDuration: 1.25 },
});

console.log('\n3. countUp OFF with a stale duration + cueBigWin ⇒ all three dropped');
bothWays(
	'stale count fields',
	setWinLineText(empty(), { countUp: false, countUpDuration: 1.25, cueBigWin: true }),
	undefined,
);
check(
	'…and the same shape written straight to the wire — server',
	normalizeSymbolsDoc({
		version: 1,
		symbols: {},
		winLine: { text: { countUp: false, countUpDuration: 1.25, cueBigWin: true } },
	}).winLine,
	undefined,
);

console.log('\n4. fadeIn OFF with a stale duration ⇒ both dropped');
bothWays(
	'fadeIn false + duration',
	setWinLineText(empty(), { fadeIn: false, fadeInDuration: 0.9 }),
	undefined,
);

console.log('\n5. cueBigWin ON with countUp ON ⇒ persists');
bothWays('cueBigWin rides countUp', setWinLineText(empty(), { countUp: true, cueBigWin: true }), {
	text: { countUp: true, cueBigWin: true },
});

console.log('\n6. the whole block ON round-trips verbatim, and beside the older text style');
const full = setWinLineText(empty(), {
	countUp: true,
	countUpDuration: 0.6,
	cueBigWin: true,
	fadeIn: true,
	fadeInDuration: 0.3,
});
bothWays('full block', full, {
	text: { countUp: true, countUpDuration: 0.6, cueBigWin: true, fadeIn: true, fadeInDuration: 0.3 },
});
bothWays(
	'…alongside a placement + colour the author already had',
	setWinLineText(full, { placement: 'boardCenter', color: '#ff0000' }),
	{
		text: {
			countUp: true,
			countUpDuration: 0.6,
			cueBigWin: true,
			fadeIn: true,
			fadeInDuration: 0.3,
			placement: 'boardCenter',
			color: '#ff0000',
		},
	},
);

console.log('\n7. effective accessors default OFF on an un-authored doc');
check('countUp', winLineTextCountUp(empty()), false);
check('cueBigWin', winLineTextCueBigWin(empty()), false);
check('fadeIn', winLineTextFadeIn(empty()), false);
check('countUp on', winLineTextCountUp(full), true);
check('cueBigWin on', winLineTextCueBigWin(full), true);
check('fadeIn on', winLineTextFadeIn(full), true);

console.log('\n8. dirty tracking sees each new field');
check('a count-up edit changes the signature', docSignature(empty()) !== docSignature(full), true);
check(
	'a clean save stays clean (server round-trip re-reads as the SAME signature)',
	docSignature(normalizeSymbolsDoc(full)),
	docSignature(full),
);
check(
	'a count length change alone is dirty',
	docSignature(full) !== docSignature(setWinLineText(full, { countUpDuration: 1.1 })),
	true,
);
check(
	'a fade length change alone is dirty',
	docSignature(full) !== docSignature(setWinLineText(full, { fadeInDuration: 1.1 })),
	true,
);

console.log('\n9. .strict() still rejects an unknown winLine.text key');
checks += 1;
try {
	normalizeSymbolsDoc({
		version: 1,
		symbols: {},
		winLine: { text: { countUp: true, countUpSpeed: 2 } },
	});
	failures += 1;
	console.log('FAIL  an unknown winLine.text key was ACCEPTED');
} catch {
	/* expected — the schema is `.strict()` */
}

console.log(
	failures === 0
		? `\nwin-amount count-up: OK (${checks} checks)`
		: `\nwin-amount count-up: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
