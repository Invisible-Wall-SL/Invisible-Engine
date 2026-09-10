/**
 * Contract check for the two 2026-09-10 symbol-state changes, both over the REAL implementations
 * rather than a re-typed copy of them:
 *
 *   1. THE RENAME — `tumbleExplosion` → `clearReel`. The behaviour did not move; only the key and
 *      the label did. What is asserted here is the MIGRATION, because getting it wrong is silent and
 *      total: the state records are keyed by `z.enum(SYMBOL_STATES)`, which Zod REJECTS an unlisted
 *      key on, and `loadSymbolsDocWithEtag` answers a parse failure with `emptySymbolsDoc()`. An
 *      un-folded legacy doc would therefore have read as a project that had never authored anything
 *      — every binding and every per-symbol cue gone, with no error anywhere. So: a legacy key is
 *      accepted, lands under the new name, on BOTH state-keyed maps (`symbols` + `symbolSounds`);
 *      the new key wins when a doc somehow holds both; and the old name never survives downstream.
 *
 *   2. THE END-OF-WIN POP — `winExplode`. Sparse and default OFF, so the whole contract is that an
 *      untouched project persists NOTHING (byte-parity on the beat every paying spin runs), that the
 *      ON state round-trips, and that it reaches BOTH bundle paths — the export result and the
 *      bake whitelist, which are two hand-written lists nothing else forces to agree.
 *
 * Run:  pnpm --filter launcher-api check:clear-reel
 *
 * The `--tsconfig` that script passes maps SvelteKit's `$env/dynamic/private` to a stub
 * (`scripts/lib/env-stub.ts`), because `symbolsStorage.ts` reaches R2 → `env.ts` → that virtual
 * module, which only exists inside a SvelteKit build.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { SYMBOL_STATE_LABELS, SYMBOL_STATES } from 'engine-layout';
import {
	migrateLegacySymbolStates,
	normalizeSymbolsDoc,
	symbolsDocSchema,
} from '../src/lib/server/symbolsStorage.ts';
import {
	docSignature,
	setWinExplodeEnabled,
	winExplodeEnabled,
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
	const a = json(actual);
	const e = json(expected);
	if (a === e) return;
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};
const rejects = (label: string, input: unknown): void => {
	checks += 1;
	try {
		normalizeSymbolsDoc(input);
	} catch (e) {
		if (e instanceof ZodError) return;
		failures += 1;
		console.log(`FAIL  ${label}\n        threw a non-Zod error: ${String(e)}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        accepted`);
};

const BOOM = { type: 'spine', assetKey: 'acme/game/spines/boom/', animationName: 'boom' } as const;
const MORPH = {
	type: 'spine',
	assetKey: 'acme/game/spines/morph/',
	animationName: 'morph',
} as const;

console.log('\n1. the state set carries the new name and not the old one');
check('`clearReel` is a state', SYMBOL_STATES.includes('clearReel'), true);
check(
	'`tumbleExplosion` is gone',
	(SYMBOL_STATES as readonly string[]).includes('tumbleExplosion'),
	false,
);
check(
	'the label is sentence-case, matching `Post-win`',
	SYMBOL_STATE_LABELS.clearReel,
	'Clear reel',
);

console.log('\n2. a saved doc holding the legacy key is folded, not lost');
const legacy = normalizeSymbolsDoc({
	version: 1,
	symbols: { H1: { win: MORPH, tumbleExplosion: BOOM } },
	symbolSounds: { H1: { land: 'sfx_land', tumbleExplosion: 'tumble_win_3' } },
});
check('the binding lands under `clearReel`', legacy.symbols.H1?.clearReel, BOOM);
check('…and the old key is gone', 'tumbleExplosion' in (legacy.symbols.H1 ?? {}), false);
check('…and the symbol keeps its other states', legacy.symbols.H1?.win, MORPH);
check('the per-symbol CUE lands under `clearReel` too', legacy.symbolSounds?.H1?.clearReel, 'tumble_win_3'); // prettier-ignore
check('…and its other cue survives', legacy.symbolSounds?.H1?.land, 'sfx_land');
check(
	'the legacy key never survives anywhere in the normalized doc',
	JSON.stringify(legacy).includes('tumbleExplosion'),
	false,
);

console.log('\n   …and the fold is what stands between a legacy doc and an EMPTY one');
checks += 1;
try {
	// The SCHEMA, un-folded — the shape `loadSymbolsDocWithEtag` would have caught and answered with
	// `emptySymbolsDoc()`, silently reporting a fully authored project as a never-authored one. If
	// Zod ever starts STRIPPING an unlisted state key instead of rejecting it, this check is how we
	// find out the migration's stakes changed.
	symbolsDocSchema.parse({ version: 1, symbols: { H1: { tumbleExplosion: BOOM } } });
	failures += 1;
	console.log('FAIL  the raw schema now ACCEPTS the legacy key — re-read the migration comment');
} catch (e) {
	if (!(e instanceof ZodError)) {
		failures += 1;
		console.log(`FAIL  the raw schema threw a non-Zod error: ${String(e)}`);
	}
}

console.log('\n3. the newer key wins when a doc somehow holds both');
const both = normalizeSymbolsDoc({
	version: 1,
	symbols: { H1: { tumbleExplosion: MORPH, clearReel: BOOM } },
	symbolSounds: { H1: { tumbleExplosion: 'old_cue', clearReel: 'new_cue' } },
});
check('the binding keeps the new one', both.symbols.H1?.clearReel, BOOM);
check('the cue keeps the new one', both.symbolSounds?.H1?.clearReel, 'new_cue');

console.log('\n4. a current doc is untouched, and a bad state is still refused');
const current = normalizeSymbolsDoc({ version: 1, symbols: { H1: { clearReel: BOOM } } });
check('a `clearReel` binding round-trips verbatim', current.symbols.H1?.clearReel, BOOM);
check(
	'the migration returns the SAME object when there is nothing to fold',
	migrateLegacySymbolStates(current) === current,
	true,
);
rejects('a state name nothing renders is still rejected', {
	symbols: { H1: { madeUpState: BOOM } },
});

console.log('\n5. the end-of-win pop is sparse and OFF by default');
const untouched = normalizeSymbolsDoc({ version: 1, symbols: { H1: { win: MORPH } } });
check('an untouched doc persists no `winExplode`', 'winExplode' in untouched, false);
check('…and reads as OFF', winExplodeEnabled(untouched as SymbolsDoc), false);
check(
	'OFF written explicitly still persists nothing (byte-parity)',
	'winExplode' in normalizeSymbolsDoc({ winExplode: { enabled: false } }),
	false,
);
check('ON round-trips', normalizeSymbolsDoc({ winExplode: { enabled: true } }).winExplode, {
	enabled: true,
});
rejects('an unknown key inside it is refused (`.strict`)', {
	winExplode: { enabled: true, mode: 'loud' },
});
rejects('a non-boolean is refused', { winExplode: { enabled: 'yes' } });

console.log('\n   …and the client half agrees with the server');
const base: SymbolsDoc = { version: 1, symbols: {} };
check('the setter turns it on', winExplodeEnabled(setWinExplodeEnabled(base, true)), true);
check(
	'…and off again, deleting the key',
	'winExplode' in setWinExplodeEnabled(setWinExplodeEnabled(base, true), false),
	false,
);
check(
	'turning it on marks the page DIRTY',
	docSignature(setWinExplodeEnabled(base, true)) !== docSignature(base),
	true,
);
check(
	'…and the saved doc the server hands back signs the same as the draft',
	docSignature(setWinExplodeEnabled(base, true)),
	docSignature({
		...base,
		winExplode: normalizeSymbolsDoc({ winExplode: { enabled: true } }).winExplode,
	}),
);

console.log('\n6. it reaches BOTH bundle paths');
const here = fileURLToPath(new URL('.', import.meta.url));
const bake = readFileSync(`${here}bake-editor-doc.mjs`, 'utf8');
const exportEndpoint = readFileSync(
	`${here}../src/routes/api/editor/export-symbols/+server.ts`,
	'utf8',
);
const exporter = readFileSync(`${here}../src/lib/server/symbolExport.ts`, 'utf8');
check('the exporter emits it', exporter.includes('...(winExplode ? { winExplode } : {})'), true);
check(
	'the export ENDPOINT forwards it (the bake reads this response)',
	(exportEndpoint.match(/\bwinExplode\b/g) ?? []).length >= 2,
	true,
);
check('the bake whitelist rebuilds it', bake.includes('s?.winExplode?.enabled === true'), true);
check('…and puts it on the bundle', /\n\t{4,}winExplode,\n/.test(bake), true);

console.log('\n7. the per-symbol sound cues reach both bundle paths too');
// `bakedSymbolSounds` consults `catalog.bindings.symbols` FIRST and only falls back to
// `symbols.symbolSounds`. The runtime path has always carried that fallback and the bake path
// never wrote it, so the two answered differently whenever a project shipped no bindings block.
check('the exporter emits it', exporter.includes('...(symbolSounds ? { symbolSounds } : {})'), true); // prettier-ignore
check(
	'the export ENDPOINT forwards it (the bake reads this response)',
	(exportEndpoint.match(/\bsymbolSounds\b/g) ?? []).length >= 2,
	true,
);
check('the bake whitelist rebuilds it', bake.includes('s?.symbolSounds && typeof s.symbolSounds'), true); // prettier-ignore
check('…and puts it on the bundle', /\n\t{4,}symbolSounds,\n/.test(bake), true);

console.log(
	failures === 0
		? `\nclear-reel + win-explode: OK (${checks} checks)`
		: `\nclear-reel + win-explode: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
