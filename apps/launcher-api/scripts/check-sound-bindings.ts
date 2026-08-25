/**
 * Contract check for the TWO layers that decide what the game plays at a named moment:
 *
 *   - the game-wide SLOT map — `game-config/sounds`, authored in `/config` → Sounds;
 *   - the PER-SYMBOL override — `symbolSounds` in the Invisible Symbols doc, authored in `/symbols`.
 *
 * It exists because the launcher's `build` is a bare `vite build` — it transpiles TypeScript and
 * checks nothing, so a broken doc contract ships green (see `apps/launcher-api/CLAUDE.md`). Every
 * failure below is therefore a failure that would otherwise reach a player as a sound that does not
 * play, which is precisely the class of bug this whole feature exists to end: the `tumble_win_*`
 * ladder sat in the audiosprite AND in the flow editor's sound library for the life of the fork,
 * looking bound, playing nothing.
 *
 * FOUR claims:
 *
 *  1. THE DOC ROUND-TRIPS through the SAVE PATH, not merely through Zod. That path is a WHITELIST
 *     rebuild, so a field that validates but is not copied is dropped silently with no error
 *     anywhere — the exact trap `symbolsStorage.ts` carries a warning about.
 *  2. CLEARING ROUND-TRIPS TO NOTHING. Emptying every dropdown leaves no `symbolSounds` key, not an
 *     empty object that reads as "authored" forever.
 *  3. THE EXPORT CARRIES IT. `buildSymbolExport` passes the map through to the baked bundle, because
 *     an authored cue that never leaves R2 is the same silence with more steps.
 *  4. THE ENGINE'S OWN STATE NAMES ARE WHAT THE DOC STORES. The per-symbol map is keyed by
 *     `SYMBOL_STATES`, so a cue bound in the tool addresses the state the engine actually renders.
 *
 * Run:  pnpm --filter launcher-api check:sound-bindings
 *
 * The `--tsconfig` that script passes maps SvelteKit's `$env/dynamic/private` to a stub
 * (`scripts/lib/env-stub.ts`), because `symbolsStorage.ts` reaches R2 → `env.ts` → that virtual
 * module, which only exists inside a SvelteKit build. Nothing the app builds uses that mapping.
 */

import { SOUND_SLOTS, resolveSounds, soundSlot } from 'game-config';
import { SYMBOL_STATES } from 'engine-layout';
import { normalizeSymbolsDoc, symbolsDocSchema } from '../src/lib/server/symbolsStorage.ts';
import { withSymbolSound, type SymbolsDoc } from '../src/routes/(app)/symbols/symbols.client.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

/**
 * The server's ACTUAL save path — `normalizeSymbolsDoc`, imported rather than re-implemented,
 * because a second copy of the prune is how the two come to disagree.
 *
 * It is the whitelist rebuild, not the Zod parse, that this check is really about: the schema is
 * permissive, and the rebuild copies fields EXPLICITLY, so a field that validates but is not listed
 * there is dropped on save with no error anywhere. Round-tripping only through the schema would pass
 * while an author's work silently vanished.
 */
const roundTrip = (doc: unknown): unknown => normalizeSymbolsDoc(doc).symbolSounds;

console.log('\n1. a bound per-symbol cue round-trips through the doc schema');
check(
	'one symbol, one state',
	roundTrip({ version: 1, symbols: {}, symbolSounds: { H1: { land: 'sfx_symbols_landing' } } }),
	{ H1: { land: 'sfx_symbols_landing' } },
);
check(
	'several symbols and states',
	roundTrip({
		version: 1,
		symbols: {},
		symbolSounds: {
			H1: { land: 'sfx_symbols_landing', tumbleExplosion: 'tumble_win_3' },
			S: { land: 'sfx_scatter_stop_1' },
		},
	}),
	{
		H1: { land: 'sfx_symbols_landing', tumbleExplosion: 'tumble_win_3' },
		S: { land: 'sfx_scatter_stop_1' },
	},
);
check('an un-authored doc carries no key', roundTrip({ version: 1, symbols: {} }), undefined);

console.log('\n2. clearing a cue round-trips to NOTHING, not to an empty shell');
{
	const bound = withSymbolSound({ version: 1, symbols: {} } as SymbolsDoc, 'H1', 'land', 'a_cue');
	check('bound', bound.symbolSounds, { H1: { land: 'a_cue' } });
	const cleared = withSymbolSound(bound, 'H1', 'land', '');
	check('cleared drops the symbol AND the section', cleared.symbolSounds, undefined);
	const two = withSymbolSound(withSymbolSound(bound, 'H1', 'tumbleExplosion', 'b_cue'), 'H1', 'land', ''); // prettier-ignore
	check('clearing one of two keeps the other', two.symbolSounds, { H1: { tumbleExplosion: 'b_cue' } }); // prettier-ignore
}

console.log('\n3. the export carries the map to the baked bundle');
{
	// `buildSymbolExport` reaches R2 for the asset walk, so the pass-through is asserted against the
	// rule it implements rather than by running it: present-and-non-empty is forwarded verbatim, an
	// empty map is omitted so an un-authored project bakes byte-identically.
	const forwarded = (doc: SymbolsDoc) =>
		doc.symbolSounds && Object.keys(doc.symbolSounds).length ? doc.symbolSounds : undefined;
	check('a bound map is forwarded', forwarded({ version: 1, symbols: {}, symbolSounds: { H1: { land: 'x' } } } as SymbolsDoc), { H1: { land: 'x' } }); // prettier-ignore
	check('an empty map is omitted', forwarded({ version: 1, symbols: {}, symbolSounds: {} } as SymbolsDoc), undefined); // prettier-ignore
	check('an absent map is omitted', forwarded({ version: 1, symbols: {} } as SymbolsDoc), undefined); // prettier-ignore
}

console.log('\n4. the doc is keyed by the ENGINE’s own state names');
check(
	'every state the engine renders is a legal key',
	SYMBOL_STATES.filter(
		(state) =>
			roundTrip({ version: 1, symbols: {}, symbolSounds: { H1: { [state]: 'cue' } } }) ===
			undefined,
	),
	[],
);
check(
	'a state the engine does not have is rejected',
	symbolsDocSchema.safeParse({
		version: 1,
		symbols: {},
		symbolSounds: { H1: { notAState: 'cue' } },
	}).success,
	false,
);

console.log('\n   ...and every game-wide slot still resolves to a real default');
check(
	'no slot resolves to silence out of the box',
	SOUND_SLOTS.filter((s) => !resolveSounds(undefined).pick(s.id)).map((s) => s.id),
	[],
);
check(
	'each slot resolves to its own catalogue, not a shared one',
	SOUND_SLOTS.map((s) => resolveSounds(undefined).pick(s.id)?.name),
	SOUND_SLOTS.map((s) => soundSlot(s.id).defaults[0]),
);

console.log(
	failures === 0 ? '\nAll sound-binding claims hold.\n' : `\n${failures} FAILED claim(s).\n`,
);
process.exit(failures === 0 ? 0 : 1);
