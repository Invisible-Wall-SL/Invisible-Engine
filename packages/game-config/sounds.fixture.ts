/**
 * Offline fixture for the SOUND SLOT block — which cue the engine plays at each named presentation
 * moment. This package's internal imports are extensionless (bundler resolution), which bare `node`
 * cannot resolve, so run it through tsx:
 *   pnpm --filter launcher-api exec tsx ../../packages/game-config/sounds.fixture.ts
 *
 * SIX claims, each of which is the reason a sound was silent or unauthorable before this block:
 *
 *  1. AN ABSENT BLOCK MEANS THE FULL DEFAULT SET, NOT SILENCE. This is the inversion that matters:
 *     every other optional block in this schema defaults to "the engine's old behaviour", and the
 *     engine's old behaviour here was NOTHING — the cascade pop played no sound at all, because no
 *     literal existed to play. So the default has to be the catalogue, or the fix ships switched off.
 *  2. THE CATALOGUE STAYS LIVE. A binding equal to the default is DROPPED on normalize rather than
 *     stored. A project that opened the panel, looked, and saved must not freeze its ladder to
 *     whatever the catalogue held that day — that freeze is exactly what `_runtime/lines`'s shared
 *     compiled config already did to every online game once.
 *  3. THE LADDER CLAMPS, IT DOES NOT WRAP OR FALL SILENT. A 6-reel board on a 5-rung reel-stop
 *     ladder plays rung 5 twice; a 9-step cascade holds on `tumble_win_5`. Wrapping would restart
 *     the escalation mid-climb, which reads as a bug; returning nothing would make the sixth reel
 *     land in silence, which reads as a worse one.
 *  4. `enabled: false` IS THE ONLY SILENCE. An empty `names` list means "give me the default back"
 *     — the far likelier accident — so the two are deliberately not the same gesture.
 *  5. A `single` SLOT STORES EXACTLY ONE NAME. The panel hands over whatever its widget held; a
 *     stored tail no consumer reads is a stored fact that can drift out of agreement with the one
 *     that is read.
 *  6. THE PICTURE-vs-ROYAL SPLIT IS BY PAYTABLE RANK, NEVER BY SYMBOL ID. `H*`/`L*` is a convention
 *     of the templates we ship, not a contract; a math team's `CHERRY`/`BELL` dictionary would fall
 *     off a prefix test in silence.
 */

import { normalizeGameConfigDoc } from './src/normalize.ts';
import {
	SOUND_SLOTS,
	SOUND_SLOT_IDS,
	landSlotForSymbol,
	normalizeSounds,
	resolveSounds,
	soundSlot,
} from './src/sounds.ts';

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

const pick = (doc: unknown, id: (typeof SOUND_SLOT_IDS)[number], index?: number) =>
	resolveSounds(doc as never).pick(id, index)?.name;

console.log('\n1. an absent block means the FULL DEFAULT SET, not silence');
check('no doc at all', pick(undefined, 'tumbleExplosion'), 'tumble_win_1');
check('a doc with no block', pick({}, 'tumbleExplosion'), 'tumble_win_1');
check('an empty block', pick({ sounds: {} }, 'tumbleExplosion'), 'tumble_win_1');
check('an empty slot entry', pick({ sounds: { tumbleExplosion: {} } }, 'tumbleExplosion'), 'tumble_win_1'); // prettier-ignore
check(
	'every slot resolves to its catalogue head',
	SOUND_SLOT_IDS.map((id) => pick(undefined, id)),
	SOUND_SLOTS.map((s) => s.defaults[0]),
);
check(
	'...and no catalogue slot ships an empty default (a slot with nothing to play is a slot that should not exist)',
	SOUND_SLOTS.filter((s) => !s.defaults.length).map((s) => s.id),
	[],
);

console.log('\n2. the catalogue stays LIVE — a default-equal binding is not stored');
check('names identical to the default', normalizeSounds({ tumbleExplosion: { names: [...soundSlot('tumbleExplosion').defaults] } }), undefined); // prettier-ignore
check('an empty names list', normalizeSounds({ reelStop: { names: [] } }), undefined);
check('a junk entry', normalizeSounds({ reelStop: 'loud' }), undefined);
check('nothing authored at all', normalizeSounds({}), undefined);
check(
	'...but a real departure IS stored',
	normalizeSounds({ tumbleExplosion: { names: ['boom_a', 'boom_b'] } }),
	{ tumbleExplosion: { names: ['boom_a', 'boom_b'] } },
);
check(
	'a shorter prefix of the default is a departure, not a match',
	normalizeSounds({ reelStop: { names: ['sfx_reel_stop_1', 'sfx_reel_stop_2'] } }),
	{ reelStop: { names: ['sfx_reel_stop_1', 'sfx_reel_stop_2'] } },
);
check(
	'a whole config that only looks at the panel normalizes to no block',
	normalizeGameConfigDoc({
		providerName: 'x',
		gameName: 'x',
		gameID: 'x',
		rtp: 0.96,
		numReels: 5,
		numRows: [3, 3, 3, 3, 3],
		betModes: {},
		paylines: { 0: [0, 0, 0, 0, 0] },
		symbols: { H1: { name: 'H1' } },
		paddingReels: { basegame: [[{ name: 'H1' }]] },
		sounds: { reelStop: { names: [...soundSlot('reelStop').defaults] } },
	} as never)?.sounds,
	undefined,
);
check(
	'...while a departing one survives the whole-doc normalize',
	normalizeGameConfigDoc({
		providerName: 'x',
		gameName: 'x',
		gameID: 'x',
		rtp: 0.96,
		numReels: 5,
		numRows: [3, 3, 3, 3, 3],
		betModes: {},
		paylines: { 0: [0, 0, 0, 0, 0] },
		symbols: { H1: { name: 'H1' } },
		paddingReels: { basegame: [[{ name: 'H1' }]] },
		sounds: { tumbleExplosion: { names: ['boom'] } },
	} as never)?.sounds,
	{ tumbleExplosion: { names: ['boom'] } },
);

console.log('\n3. the ladder CLAMPS — it does not wrap, and it does not fall silent');
check('rung 0', pick(undefined, 'reelStop', 0), 'sfx_reel_stop_1');
check('rung 4', pick(undefined, 'reelStop', 4), 'sfx_reel_stop_5');
check('a 6th reel holds on the last rung', pick(undefined, 'reelStop', 5), 'sfx_reel_stop_5');
check('a 9th cascade step holds too', pick(undefined, 'tumbleExplosion', 8), 'tumble_win_5');
check('a negative index starts at the first', pick(undefined, 'reelStop', -3), 'sfx_reel_stop_1');
check('a fractional index floors', pick(undefined, 'reelStop', 2.9), 'sfx_reel_stop_3');
check('a single slot ignores the index', pick(undefined, 'wildLand', 4), 'sfx_multiplier_landing');

console.log('\n4. `enabled: false` is the ONLY silence');
check('silenced', pick({ sounds: { tumbleExplosion: { enabled: false } } }, 'tumbleExplosion'), undefined); // prettier-ignore
check('silence round-trips through normalize', normalizeSounds({ tumbleExplosion: { enabled: false } }), { tumbleExplosion: { enabled: false } }); // prettier-ignore
check('...but `enabled: true` is the default and is not stored', normalizeSounds({ tumbleExplosion: { enabled: true } }), undefined); // prettier-ignore
check('an emptied list is NOT silence', pick({ sounds: { tumbleExplosion: { names: [] } } }, 'tumbleExplosion'), 'tumble_win_1'); // prettier-ignore

console.log('\n5. a `single` slot stores exactly one name');
check('a tail is dropped', normalizeSounds({ wildLand: { names: ['a', 'b', 'c'] } }), { wildLand: { names: ['a'] } }); // prettier-ignore
check('a ladder keeps its rungs', normalizeSounds({ reelStop: { names: ['a', 'b', 'c'] } }), { reelStop: { names: ['a', 'b', 'c'] } }); // prettier-ignore
check('blank entries never reach storage', normalizeSounds({ reelStop: { names: ['a', '', 'c'] } }), { reelStop: { names: ['a', 'c'] } }); // prettier-ignore

console.log('\n   volume is a 0..1 fraction or nothing at all');
check('in range', normalizeSounds({ reelStop: { volume: 0.4 } }), { reelStop: { volume: 0.4 } });
check('zero is a real value', normalizeSounds({ reelStop: { volume: 0 } }), { reelStop: { volume: 0 } }); // prettier-ignore
check('out of range is dropped', normalizeSounds({ reelStop: { volume: 4 } }), undefined);
check('NaN is dropped', normalizeSounds({ reelStop: { volume: Number.NaN } }), undefined);
check(
	'a resolved cue carries the authored volume',
	resolveSounds({ sounds: { reelStop: { volume: 0.25 } } }).pick('reelStop', 1),
	{ name: 'sfx_reel_stop_2', volume: 0.25 },
);
check(
	'...and an unauthored one carries undefined, not a guessed 1',
	resolveSounds(undefined).pick('reelStop', 1),
	{ name: 'sfx_reel_stop_2', volume: undefined },
);

console.log('\n6. the land ROUTING splits by paytable rank, never by symbol id');
// A deliberately UNCONVENTIONAL dictionary: no `H*`/`L*` prefixes anywhere, so a routing that
// pattern-matched ids would get every one of these wrong.
const DICT = {
	CHERRY: { paytable: [{ '5': 20 }] },
	BELL: { paytable: [{ '5': 15 }] },
	PLUM: { paytable: [{ '5': 10 }] },
	NINE: { paytable: [{ '5': 3 }] },
	TEN: { paytable: [{ '5': 2 }] },
	JACK: { paytable: [{ '5': 1 }] },
	STAR: { special_properties: ['scatter'] },
	JOKER: { paytable: null, special_properties: ['wild', 'multiplier'] },
	DECOR: {},
};
const slotFor = (name: string) => landSlotForSymbol(name, DICT as never);
check('a scatter routes by its property', slotFor('STAR'), 'scatterLand');
check('a wild routes by its property', slotFor('JOKER'), 'wildLand');
check('the top payer is a picture', slotFor('CHERRY'), 'symbolLand');
check('the mid payer is a picture', slotFor('PLUM'), 'symbolLand');
check('the low payers are royals', [slotFor('NINE'), slotFor('TEN'), slotFor('JACK')], ['royalLand', 'royalLand', 'royalLand']); // prettier-ignore
check('a symbol that pays nothing and claims nothing still gets a cue', slotFor('DECOR'), 'symbolLand'); // prettier-ignore
check('an unknown symbol still gets a cue', slotFor('NOT_IN_DICT'), 'symbolLand');
check('an empty dictionary does not throw', landSlotForSymbol('X', {}), 'symbolLand');
check('a wild outranks its own paytable', landSlotForSymbol('W', { W: { paytable: [{ '5': 1 }], special_properties: ['wild'] } } as never), 'wildLand'); // prettier-ignore

console.log(
	failures === 0 ? '\nAll sound-slot claims hold.\n' : `\n${failures} FAILED claim(s).\n`,
);
process.exit(failures === 0 ? 0 : 1);
