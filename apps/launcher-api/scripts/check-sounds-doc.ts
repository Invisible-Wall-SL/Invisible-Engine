/**
 * Contract check for the Invisible Sound LIBRARY — what a project's `sounds.json` may hold and what
 * it silently must not (§1–8), plus the rules the audio FILES behind it obey (§9–12).
 *
 * It exists because the launcher's `build` is a bare `vite build` — it transpiles TypeScript and
 * checks nothing, so a broken doc contract ships green (see `apps/launcher-api/CLAUDE.md`). And
 * because `normalizeSoundsDoc` is unusually destructive by design: unlike every other doc here it
 * DROPS entries rather than merely pruning fields, since an entry that cannot name a playable sound
 * is not an incomplete record but one that would reach a player as silence — and howler produces
 * silence without an error.
 *
 * Every claim below is therefore either a drop that must happen or a value that must survive.
 *
 * Run:  pnpm --filter launcher-api check:sounds-doc
 *
 * The `--tsconfig` that script passes maps SvelteKit's `$env/dynamic/private` to a stub
 * (`scripts/lib/env-stub.ts`), because `soundsStorage.ts` reaches R2 → `env.ts` → that virtual
 * module, which only exists inside a SvelteKit build. Nothing the app builds uses that mapping.
 */

import {
	bakedSoundBanks,
	findSoundByName,
	isValidSoundFile,
	isValidSoundName,
	soundCatalogEntries,
	soundNames,
	effectiveSoundBindings,
	legacySoundBindings,
	type SoundEntry,
	type SoundsDoc,
} from 'engine-layout';
import {
	checkSoundLibrary,
	flowSoundBindings,
	slotSoundBindings,
	summariseSoundLicences,
	symbolSoundBindings,
	winTierSoundBindings,
} from '../src/lib/soundUsage.ts';
import {
	BUILTIN_SOUND_OPTIONS,
	soundOptionsFor,
	withProjectSounds,
} from '../src/lib/soundOptions.ts';
import { soundFileKey } from '../src/lib/server/projectPaths.ts';
import {
	mintSoundId,
	parseRange,
	soundContentType,
	soundExtension,
	soundFileName,
} from '../src/lib/server/soundFiles.ts';
import { emptySoundsDoc, normalizeSoundsDoc } from '../src/lib/server/soundsStorage.ts';

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

/** A minimal entry that SURVIVES — the baseline every rejection below departs from by one field. */
const good = (over: Partial<SoundEntry> = {}): Record<string, unknown> => ({
	id: 'snd_1',
	name: 'tumble_pop',
	kind: 'sfx',
	file: 'tumble_pop.mp3',
	durationMs: 420,
	...over,
});

/** The same baseline as a fully-typed {@link SoundEntry} — for the helpers that take a real doc
 *  rather than arbitrary posted input. */
const entry = (over: Partial<SoundEntry> = {}): SoundEntry => ({
	id: 'snd_1',
	name: 'tumble_pop',
	kind: 'sfx',
	file: 'tumble_pop.mp3',
	durationMs: 420,
	status: 'draft',
	origin: 'library',
	...over,
});

const norm = (input: unknown): SoundsDoc => normalizeSoundsDoc(input);
const names = (input: unknown): string[] => soundNames(norm(input));
const first = (input: unknown): SoundEntry | undefined => norm(input).entries?.[0];

console.log('\n1. an un-authored project is an EMPTY LIBRARY, never a missing one');
check('nothing at all', norm(undefined), { version: 1, entries: [] });
check('an empty object', norm({}), { version: 1, entries: [] });
check('an empty list', norm({ entries: [] }), { version: 1, entries: [] });
check('the empty doc helper agrees', emptySoundsDoc(), { version: 1, entries: [] });

console.log('\n2. a complete entry round-trips field for field');
{
	const full = good({
		section: 'Reels',
		volume: 0.8,
		loop: true,
		status: 'approved',
		reviewedBy: 'gualtiero',
		reviewedAt: '2026-08-26T00:00:00.000Z',
		notes: 'second take',
		origin: 'commissioned',
		author: 'A Composer',
		license: 'CC-BY-4.0',
		licenseUrl: 'https://example.invalid/licence',
	});
	check('every authored field survives', first({ entries: [full] }), {
		id: 'snd_1',
		name: 'tumble_pop',
		kind: 'sfx',
		file: 'tumble_pop.mp3',
		durationMs: 420,
		status: 'approved',
		origin: 'commissioned',
		section: 'Reels',
		volume: 0.8,
		loop: true,
		reviewedBy: 'gualtiero',
		reviewedAt: '2026-08-26T00:00:00.000Z',
		notes: 'second take',
		author: 'A Composer',
		license: 'CC-BY-4.0',
		licenseUrl: 'https://example.invalid/licence',
	});
}

console.log('\n3. an entry that could not name a playable sound is DROPPED');
check('no id', names({ entries: [good({ id: '' })] }), []);
check('whitespace id', names({ entries: [good({ id: '   ' })] }), []);
check('empty name', names({ entries: [good({ name: '' })] }), []);
check('a name with a space', names({ entries: [good({ name: 'tumble pop' })] }), []);
check('a name with a dot', names({ entries: [good({ name: 'tumble.pop' })] }), []);
check('a name over 64 chars', names({ entries: [good({ name: 'a'.repeat(65) })] }), []);
check('a name of exactly 64 chars survives', names({ entries: [good({ name: 'a'.repeat(64) })] }).length, 1); // prettier-ignore
check('a file in a subdirectory', names({ entries: [good({ file: 'sfx/pop.mp3' })] }), []);
check('a file escaping the folder', names({ entries: [good({ file: '../../secret.mp3' })] }), []);
check('a backslash path', names({ entries: [good({ file: 'sfx\\pop.mp3' })] }), []);
check('a file with no extension', names({ entries: [good({ file: 'pop' })] }), []);
check('a non-audio extension', names({ entries: [good({ file: 'pop.txt' })] }), []);
check('an uppercase extension is fine', names({ entries: [good({ file: 'pop.MP3' })] }), ['tumble_pop']); // prettier-ignore
check('a zero-length sound', names({ entries: [good({ durationMs: 0 })] }), []);
check('a negative length', names({ entries: [good({ durationMs: -5 })] }), []);
// A drop must not take the rest of the library with it — one bad row is one bad row.
check('a bad entry does not drop its neighbours', names({ entries: [good({ file: 'pop.txt' }), good({ id: 'snd_2', name: 'reel_stop' })] }), ['reel_stop']); // prettier-ignore

console.log('\n4. the two defaults that must never read as a claim');
check('an unreviewed sound is a DRAFT', first({ entries: [good()] })?.status, 'draft');
check('an unstated provenance is LIBRARY', first({ entries: [good()] })?.origin, 'library');
// The point of the status field is that it can be revoked. A reviewer surviving a demotion back to
// draft would make an approval permanent, which is the one thing a sign-off must not be.
check('a draft carries no reviewer', first({ entries: [good({ status: 'draft', reviewedBy: 'someone', reviewedAt: 'then' })] })?.reviewedBy, undefined); // prettier-ignore
check('…nor a review date', first({ entries: [good({ status: 'draft', reviewedAt: 'then' })] })?.reviewedAt, undefined); // prettier-ignore
check('an approved sound keeps its reviewer', first({ entries: [good({ status: 'approved', reviewedBy: 'gualtiero' })] })?.reviewedBy, 'gualtiero'); // prettier-ignore

console.log('\n5. volume is a real 0..1 fraction or it is not stored at all');
check('0 is a legitimate level', first({ entries: [good({ volume: 0 })] })?.volume, 0);
check('1 is a legitimate level', first({ entries: [good({ volume: 1 })] })?.volume, 1);
check('above 1 is not clamped, it is dropped', first({ entries: [good({ volume: 4 })] })?.volume, undefined); // prettier-ignore
check('below 0 is dropped', first({ entries: [good({ volume: -1 })] })?.volume, undefined);
check('absent stays absent', first({ entries: [good()] })?.volume, undefined);
check('loop is stored only when ON', first({ entries: [good({ loop: false })] })?.loop, undefined);

console.log('\n6. duplicates collapse LAST-WINS — the rule the player already applies');
// `buildSoundBankIndex` resolves a name to the LAST bank declaring it. A doc that kept both would
// describe a library whose second file is unreachable, and the tool would list a sound that can
// never play.
check('same name → the later entry wins', norm({ entries: [good({ id: 'a', file: 'old.mp3' }), good({ id: 'b', file: 'new.mp3' })] }).entries?.map((e) => e.file), ['new.mp3']); // prettier-ignore
check('same id → the later entry wins', norm({ entries: [good({ id: 'a', name: 'old_name' }), good({ id: 'a', name: 'new_name' })] }).entries?.map((e) => e.name), ['new_name']); // prettier-ignore
check('order among survivors is preserved', names({ entries: [good({ id: 'a', name: 'one' }), good({ id: 'b', name: 'two' }), good({ id: 'c', name: 'three' })] }), ['one', 'two', 'three']); // prettier-ignore
check('a duplicate keeps the LATER position', names({ entries: [good({ id: 'a', name: 'dup' }), good({ id: 'b', name: 'two' }), good({ id: 'c', name: 'dup' })] }), ['two', 'dup']); // prettier-ignore
check('findSoundByName agrees with the bank rule', findSoundByName({ entries: [entry({ id: 'a' }), entry({ id: 'b' })] }, 'tumble_pop')?.id, 'b'); // prettier-ignore

console.log('\n7. unknown fields are stripped, not carried');
check('a top-level stowaway', Object.keys(norm({ entries: [], bogus: 1 })).sort(), ['entries', 'version']); // prettier-ignore
check('an entry stowaway', Object.keys(first({ entries: [good({ bogus: 1 } as never)] }) ?? {}).includes('bogus'), false); // prettier-ignore
check('version is always stamped to 1', norm({ entries: [] }).version, 1);
// A field the save WRITES must survive the READ. Dropping it here would half-persist it — present in
// R2, invisible to every reader — which is the exact trap this module warns about.
check('updatedAt survives a read', norm({ entries: [], updatedAt: '2026-08-26T00:00:00.000Z' }).updatedAt, '2026-08-26T00:00:00.000Z'); // prettier-ignore
check('a blank updatedAt is not stored', 'updatedAt' in norm({ entries: [], updatedAt: '  ' }), false); // prettier-ignore

console.log('\n8. the filename rule has ONE home, and the path builder asserts it');
// `isValidSoundFile` is the traversal guard, and `soundFileKey` re-asserts it rather than trusting
// that its caller checked — a path builder that only works on pre-validated input is one that will
// eventually be called with unvalidated input.
check('a good key', soundFileKey('borut', 'bookofborut', 'pop.mp3'), 'borut/bookofborut/sounds/files/pop.mp3'); // prettier-ignore
let threw = false;
try {
	soundFileKey('borut', 'bookofborut', '../../../etc/passwd.mp3');
} catch {
	threw = true;
}
check('a traversal filename throws rather than building a key', threw, true);
check('the predicate and the builder agree', isValidSoundFile('../x.mp3'), false);
check('a bare audio filename is valid', isValidSoundFile('x.ogg'), true);
check('a valid name is valid', isValidSoundName('sfx_reel_stop_1'), true);
check('a name with a slash is not', isValidSoundName('a/b'), false);

console.log('\n9. the upload accepts a format by its EXTENSION, not by what the browser claims');
// `File.type` is client-supplied and varies by OS for the same file (`audio/mp3` vs `audio/mpeg` vs
// empty), so the extension is the only thing worth trusting — and it is already whitelisted.
check('mp3', soundExtension('pop.mp3'), 'mp3');
check('an uppercase extension is normalized', soundExtension('POP.MP3'), 'mp3');
check('a dotted name keeps its LAST extension', soundExtension('my.best.pop.ogg'), 'ogg');
check('a path is reduced to its basename', soundExtension('a/b/pop.wav'), 'wav');
check('an unsupported format', soundExtension('pop.aiff'), undefined);
check('no extension at all', soundExtension('pop'), undefined);

console.log('\n10. what we SERVE a file as is derived from the stored name');
check('mp3 → audio/mpeg', soundContentType('x.mp3'), 'audio/mpeg');
check('ogg → audio/ogg', soundContentType('x.ogg'), 'audio/ogg');
check('m4a → audio/mp4', soundContentType('x.m4a'), 'audio/mp4');
check('wav → audio/wav', soundContentType('x.wav'), 'audio/wav');
check('webm → audio/webm', soundContentType('x.webm'), 'audio/webm');
check('anything else stays opaque', soundContentType('x.bin'), 'application/octet-stream');

console.log('\n11. a minted id yields a filename the doc will accept');
{
	const id = mintSoundId();
	check('the id is prefixed and fixed-length', /^snd_[0-9a-f]{16}$/.test(id), true);
	check('its filename passes the doc validator', isValidSoundFile(soundFileName(id, 'mp3')), true);
	check('…and builds a key inside the project', soundFileKey('c', 'p', soundFileName(id, 'mp3')), `c/p/sounds/files/${id}.mp3`); // prettier-ignore
	// Uniqueness is the whole reason the SERVER mints this: two authors uploading `pop.mp3` on the
	// same day must not land on one key, and a client-chosen id could overwrite another's audio.
	const many = new Set(Array.from({ length: 500 }, () => mintSoundId()));
	check('500 mints are 500 distinct ids', many.size, 500);
}

console.log('\n12. Range requests are honoured — an <audio> element scrubbing sends them');
// Answering 200-with-everything is legal but makes the player re-download the file on every seek.
check('no header ⇒ send the whole body', parseRange(null, 1000), null);
check('an open-ended range', parseRange('bytes=0-', 1000), { start: 0, end: 999 });
check('a closed range', parseRange('bytes=10-20', 1000), { start: 10, end: 20 });
// `bytes=-500` is the LAST 500 bytes, not "0 to 500" — the one form that reads backwards.
check('a suffix range is the TAIL', parseRange('bytes=-500', 1000), { start: 500, end: 999 });
check('a suffix longer than the file clamps to the start', parseRange('bytes=-5000', 1000), { start: 0, end: 999 }); // prettier-ignore
check('an end past the file is clamped', parseRange('bytes=900-5000', 1000), { start: 900, end: 999 }); // prettier-ignore
check('the last byte', parseRange('bytes=999-999', 1000), { start: 999, end: 999 });
check('a start past the end is unsatisfiable', parseRange('bytes=1000-', 1000), null);
check('a backwards range is unsatisfiable', parseRange('bytes=20-10', 1000), null);
check('a bare dash means nothing', parseRange('bytes=-', 1000), null);
check('a multi-range is declined, not mis-read', parseRange('bytes=0-10,20-30', 1000), null);
check('a malformed unit', parseRange('items=0-10', 1000), null);
check('whitespace is tolerated', parseRange('  bytes=0-9  ', 1000), { start: 0, end: 9 });

console.log('\n13. what SHIPS is stripped of everything authoring-only');
{
	const doc = norm({
		entries: [
			good({
				volume: 0.6,
				loop: true,
				section: 'Wins',
				status: 'approved',
				reviewedBy: 'gualtiero',
				reviewedAt: 'then',
				notes: 'take 3',
				origin: 'ai',
				model: 'some-model',
				author: 'A Composer',
				license: 'CC-BY-4.0',
				licenseUrl: 'https://example.invalid',
			}),
		],
	});
	const shipped = soundCatalogEntries(doc);
	// Provenance and review state are internal records about who we owe and what we checked. A
	// shipped bundle is the one place they have no business being — the same reason `fontExport`
	// strips a font's `recipe`.
	check('only the fields a player needs survive', shipped, [
		{ name: 'tumble_pop', file: 'tumble_pop.mp3', durationMs: 420, volume: 0.6, loop: true },
	]);
	check('an absent volume is not invented', soundCatalogEntries(norm({ entries: [good()] })), [
		{ name: 'tumble_pop', file: 'tumble_pop.mp3', durationMs: 420 },
	]);
	check('an empty library ships nothing', soundCatalogEntries(norm({})), []);
}

console.log('\n14. the catalog becomes one BANK per file');
{
	const catalog = {
		prefix: 'sounds',
		sounds: [
			{ name: 'pop', file: 'snd_a.mp3', durationMs: 420 },
			{ name: 'theme', file: 'snd_b.ogg', durationMs: 90000, volume: 0.5, loop: true },
		],
	};
	const banks = bakedSoundBanks(catalog, 'assets/');
	check('one bank per sound', banks.length, 2);
	check('src is <base><prefix>/<file>', banks[0].src, 'assets/sounds/snd_a.mp3');
	// The region's length IS the duration, and the third element is the ONLY place looping is
	// expressed in this engine — the players carry no loop flag of their own.
	check('the sprite region is [0, durationMs]', banks[0].sprite, { pop: [0, 420] });
	check('a looping sound gets the third element', banks[1].sprite, { theme: [0, 90000, true] });
	check('an absent volume becomes full', banks[0].config, { pop: { volume: 1 } });
	check('an authored volume rides along', banks[1].config, { theme: { volume: 0.5 } });
	// Declared, not sniffed: howler strips the query string before looking for an extension and then
	// fails silently through a `loaderror` nobody listens for.
	check('the container is declared from the filename', [banks[0].format, banks[1].format], [['mp3'], ['ogg']]); // prettier-ignore

	const live = bakedSoundBanks(catalog, 'https://app.invisiblewall.org/api/deploy/f/tok/c/p/');
	check('the live-runtime base is prepended verbatim', live[0].src, 'https://app.invisiblewall.org/api/deploy/f/tok/c/p/sounds/snd_a.mp3'); // prettier-ignore

	// PARITY: a project that has uploaded nothing must contribute no banks at all, so the game loads
	// exactly the shipped audiosprite and behaves as it did before this pipeline existed.
	check('no catalog ⇒ no banks', bakedSoundBanks(undefined), []);
	check('an empty catalog ⇒ no banks', bakedSoundBanks({ prefix: 'sounds', sounds: [] }), []);
	// A doc row whose upload never landed is skipped by the exporter, but a hand-edited catalog can
	// still carry one — a zero-length region would be a name that plays nothing.
	check('a zero-duration entry is skipped', bakedSoundBanks({ prefix: 'sounds', sounds: [{ name: 'x', file: 'x.mp3', durationMs: 0 }] }), []); // prettier-ignore
	check('a nameless entry is skipped', bakedSoundBanks({ prefix: 'sounds', sounds: [{ name: '', file: 'x.mp3', durationMs: 5 }] }), []); // prettier-ignore
}

console.log('\n15. the usage index reads every surface that can bind a sound');
{
	// A flow cue is identified by its literal's ENUM TYPE, not by the node's `ref` — so a new cue,
	// an action or a function call taking a sound is found without touching the collector.
	const flow = {
		nodes: [
			{ id: 'n1', kind: 'fireCue', ref: 'soundOnce', inputs: { name: { kind: 'literal', type: { t: 'enum', name: 'SoundEffectName' }, value: 'jng_intro_fs' } } }, // prettier-ignore
			{ id: 'n2', kind: 'fireCue', ref: 'soundMusic', inputs: { name: { kind: 'literal', type: { t: 'enum', name: 'MusicName' }, value: 'bgm_freespin' } } }, // prettier-ignore
			// A literal of some OTHER enum is not a sound, however sound-shaped its value looks.
			{ id: 'n3', kind: 'fireCue', ref: 'symbolShow', inputs: { name: { kind: 'literal', type: { t: 'enum', name: 'SymbolName' }, value: 'bgm_main' } } }, // prettier-ignore
			// A wired input carries no name to read.
			{ id: 'n4', kind: 'fireCue', ref: 'soundOnce', inputs: { name: { kind: 'wire' } } },
			// THE CASE THAT MATTERS: a node whose `ref` says nothing about sound, carrying a sound
			// literal anyway. Matching on the node's name instead of its literal's TYPE would miss it —
			// and would keep missing every future node kind that happens to take a sound.
			{ id: 'n5', kind: 'functionCall', ref: 'playFanfare', inputs: { cue: { kind: 'literal', type: { t: 'enum', name: 'SoundEffectName' }, value: 'sfx_youwon_panel' } } }, // prettier-ignore
		],
	};
	const flowNames = flowSoundBindings(flow).map((b) => b.name);
	check('a cue literal is a binding', flowNames, ['jng_intro_fs', 'bgm_freespin', 'sfx_youwon_panel']); // prettier-ignore
	check('a non-sound enum is not', flowNames.includes('bgm_main'), false);
	check('a sound-taking node that is not a sound cue still counts', flowNames.includes('sfx_youwon_panel'), true); // prettier-ignore
	check('a garbage graph yields nothing', flowSoundBindings(null), []);

	// The slot defaults ARE bindings — an un-authored project still plays the whole catalogue, which
	// is the inversion `game-config/sounds.ts` exists for.
	const slots = slotSoundBindings(null);
	check('an un-authored config still binds the catalogue', slots.some((b) => b.name === 'tumble_win_1'), true); // prettier-ignore
	check('a ladder rung is labelled', slots.find((b) => b.name === 'tumble_win_2')?.where, 'Tumble explosion · rung 2'); // prettier-ignore
	// `enabled: false` is the ONE gesture meaning "play nothing here", so its names are not bound.
	const silenced = slotSoundBindings({ sounds: { tumbleExplosion: { enabled: false } } } as never);
	check('a silenced slot binds nothing', silenced.some((b) => b.name.startsWith('tumble_win')), false); // prettier-ignore

	check('a win tier binds its cue and its bed', winTierSoundBindings({ winLevels: [{ alias: 'big', name: 'BIG WIN', threshold: 10, type: 'big', sound: { sfx: 'sfx_winlevel_nice', bgm: 'bgm_winlevel_big' } }] } as never).map((b) => b.name), ['sfx_winlevel_nice', 'bgm_winlevel_big']); // prettier-ignore
	check('per-symbol and anticipation cues', symbolSoundBindings({ symbolSounds: { H1: { land: 'my_land' } }, anticipation: { activationSound: 'my_sting', loopSound: 'my_loop' } }).map((b) => b.name), ['my_land', 'my_sting', 'my_loop']); // prettier-ignore
}

console.log('\n16. the three checks');
{
	const BUILTIN = ['sfx_reel_stop_1', 'bgm_main'];
	const run = (lib: unknown, bound: Record<string, boolean> = {}) =>
		checkSoundLibrary(
			lib as SoundsDoc,
			(n) => bound[n] === true,
			Object.keys(bound).filter((n) => bound[n]),
			BUILTIN,
		);

	const lib = norm({
		entries: [
			good({ id: 'a', name: 'used_one' }),
			good({ id: 'b', name: 'lonely' }),
			good({ id: 'c', name: 'sfx_reel_stop_1' }),
		],
	});

	const r = run(lib, { used_one: true, ghost_sound: true });
	// UNBOUND — the `tumble_win_*` class: a sound that exists and nothing asks for.
	check('a sound nothing plays is unbound', r.unbound, ['lonely']);
	// A name matching a shipped region is NOT unbound: the engine plays that region from its own
	// code and the upload replaces it. Calling it unused would contradict the override feature.
	check('a built-in override is not unbound', r.unbound.includes('sfx_reel_stop_1'), false);
	check('…it is reported as an override instead', r.overridesBuiltin, ['sfx_reel_stop_1']);
	// MISSING — a binding naming a sound nothing declares. Howler declines an unknown sprite key
	// silently, so this check is the only thing standing between a typo and an inaudible gap.
	check('a binding with no sound behind it', r.missing, ['ghost_sound']);
	check('a binding satisfied by a BUILT-IN is not missing', run(lib, { bgm_main: true }).missing, []); // prettier-ignore
	// UNAPPROVED-BUT-BOUND — the publish gate's list, shown before you reach publish.
	check('a played draft is flagged', r.unapprovedBound.sort(), ['sfx_reel_stop_1', 'used_one']);
	check('an UNplayed draft is not', r.unapprovedBound.includes('lonely'), false);
	const approved = norm({ entries: [good({ id: 'a', name: 'used_one', status: 'approved' })] });
	check('an approved sound is not flagged', run(approved, { used_one: true }).unapprovedBound, []);

	// NOT REBINDABLE — shipped sounds no authorable surface names. Derived, never scanned: an
	// earlier cut searched engine sources for literals and counted the `SoundName` union's own
	// declaration, the slot catalogue's defaults, and names inside comments.
	check('a built-in nothing binds', run(lib, {}).notRebindable, ['bgm_main', 'sfx_reel_stop_1']);
	check('…drops out once something binds it', run(lib, { bgm_main: true }).notRebindable, ['sfx_reel_stop_1']); // prettier-ignore

	check('an empty library is all-clear', run(norm({}), {}).unbound, []);
}

console.log('\n17. the publish gate — what blocks a release, and what only warns');
{
	const played = (names: string[]) => (n: string) => names.includes(n);

	// The GATE itself is `checkSoundLibrary().unapprovedBound` (§16). What matters here is the rule
	// around it: only a PLAYED draft blocks, and an override counts as played.
	const lib = norm({
		entries: [
			good({ id: 'a', name: 'bound_draft' }),
			good({ id: 'b', name: 'idle_draft' }),
			good({ id: 'c', name: 'bound_ok', status: 'approved' }),
		],
	});
	const gate = checkSoundLibrary(lib, played(['bound_draft', 'bound_ok']), ['bound_draft', 'bound_ok'], []); // prettier-ignore
	check('a played draft blocks', gate.unapprovedBound, ['bound_draft']);
	check('an unused draft does not', gate.unapprovedBound.includes('idle_draft'), false);
	check('an approved sound does not', gate.unapprovedBound.includes('bound_ok'), false);
	// A re-skin of a built-in is played by the engine's own code with no doc naming it. Judged by
	// bindings alone it would look idle, and an unapproved override would sail straight past the one
	// check meant to catch it.
	const skin = norm({ entries: [good({ id: 'x', name: 'sfx_btn_spin' })] });
	check('an unapproved built-in override blocks too', checkSoundLibrary(skin, () => false, [], ['sfx_btn_spin']).unapprovedBound, ['sfx_btn_spin']); // prettier-ignore

	console.log('  — licences');
	const licLib = norm({
		entries: [
			good({ id: 'a', name: 'paid', license: 'Commissioned — full buyout' }),
			good({ id: 'b', name: 'nc', license: 'CC-BY-NC-4.0' }),
			good({ id: 'c', name: 'bare' }),
			good({ id: 'd', name: 'unused_nc', license: 'CC-BY-NC-4.0' }),
		],
	});
	const lic = summariseSoundLicences(licLib, played(['paid', 'nc', 'bare']));
	check('only PLAYED sounds are counted', lic.bound, 3);
	check('an unused sound owes nobody', lic.nonCommercial.includes('unused_nc'), false);
	check('a non-commercial licence is flagged', lic.nonCommercial, ['nc']);
	check('a missing licence is named', lic.missingLicence, ['bare']);
	check('licences are grouped', lic.byLicence.map((g) => g.licence).sort(), ['CC-BY-NC-4.0', 'Commissioned — full buyout']); // prettier-ignore
	// The flag is a HEURISTIC over free text, so it must not fire on the word it is a negation of —
	// blocking would be wrong for the same reason, which is why it only ever warns.
	const commercial = summariseSoundLicences(norm({ entries: [good({ id: 'a', name: 'ok', license: 'Royalty-free, commercial use permitted' })] }), () => true); // prettier-ignore
	check('"commercial use permitted" is not non-commercial', commercial.nonCommercial, []);
	check('an empty library owes nothing', summariseSoundLicences(norm({}), () => true).bound, 0);
}

console.log("\n18. every picker offers the project's own sounds, not just the engine's");
{
	const lib = norm({
		entries: [
			good({ id: 'a', name: 'my_pop', kind: 'sfx' }),
			good({ id: 'b', name: 'my_theme', kind: 'music' }),
			// An upload REPLACING a shipped sound must not appear twice in the list.
			good({ id: 'c', name: 'sfx_btn_spin', kind: 'sfx' }),
		],
	});
	const opts = soundOptionsFor(lib);

	// A library sound's `kind` finally does something load-bearing: it decides which list it joins.
	check('a project sfx lands in sfx', opts.sfx.includes('my_pop'), true);
	check('…and not in music', opts.music.includes('my_pop'), false);
	check('a project music bed lands in music', opts.music.includes('my_theme'), true);
	// Project first: a dropdown opening on 53 engine names with your five below them is one that
	// gets scrolled past, and your own audio is what you are reaching for.
	check('project sounds come first', opts.sfx.slice(0, 2), ['my_pop', 'sfx_btn_spin']);
	check('the engine set is still there', opts.sfx.includes('sfx_reel_stop_1'), true);
	check('an override is listed once', opts.sfx.filter((n) => n === 'sfx_btn_spin').length, 1);
	check('project names are reported for labelling', opts.project.sort(), ['my_pop', 'my_theme', 'sfx_btn_spin']); // prettier-ignore

	// PARITY: a project that uploaded nothing sees exactly what it saw before this existed.
	const bare = soundOptionsFor(norm({}));
	check('no library ⇒ the engine set unchanged', bare.sfx, BUILTIN_SOUND_OPTIONS.sfx);
	check('…music too', bare.music, BUILTIN_SOUND_OPTIONS.music);
	check('…and nothing to label', bare.project, []);

	console.log('  — the flow vocabulary');
	const vocab = {
		enums: [
			{ name: 'MusicName', values: ['bgm_main'] },
			{ name: 'SoundEffectName', values: ['sfx_btn_spin'] },
			{ name: 'SoundName', values: ['bgm_main', 'sfx_btn_spin'] },
			{ name: 'SymbolName', values: ['H1'] },
		],
	} as never as Parameters<typeof withProjectSounds>[0];
	const widened = withProjectSounds(vocab, opts);
	const values = (name: string) => widened.enums.find((e) => e.name === name)?.values ?? [];
	check('the cue enum offers project sfx', values('SoundEffectName').includes('my_pop'), true);
	check('the music enum offers project beds', values('MusicName').includes('my_theme'), true);
	check('the combined enum offers both', ['my_pop', 'my_theme'].every((n) => values('SoundName').includes(n)), true); // prettier-ignore
	// Widening must not reach past the three sound enums.
	check('a non-sound enum is untouched', values('SymbolName'), ['H1']);
	// Identity, not just equality: a project with no sounds must leave the editor's vocabulary exactly
	// as it found it.
	check('no project sounds ⇒ the SAME object back', withProjectSounds(vocab, bare) === vocab, true);
}

console.log('\n19. WHAT PLAYS WHEN survives the round trip, and only what departs is stored');
{
	const round = (bindings: SoundsDoc['bindings']) =>
		normalizeSoundsDoc({ version: 1, entries: [], bindings }).bindings;

	check('a slot choice survives', round({ slots: { reelStop: { names: ['a', 'b'] } } }), { slots: { reelStop: { names: ['a', 'b'] } } }); // prettier-ignore
	// The whole point of the sparse form: an empty level and an absent level must READ the same, or
	// a cleared cue becomes "authored, plays nothing" — which is silence, not a default.
	check('an empty slot entry is dropped', round({ slots: { reelStop: {} } }), undefined);
	check('an empty names list is dropped', round({ slots: { reelStop: { names: [] } } }), undefined);
	check(
		'blank names are dropped',
		round({ slots: { reelStop: { names: ['  ', ''] } } }),
		undefined,
	);
	// …but SILENCE is a real choice, and the only one that can stand alone.
	check('enabled:false stands on its own', round({ slots: { reelStop: { enabled: false } } }), { slots: { reelStop: { enabled: false } } }); // prettier-ignore
	check('enabled:true is not stored', round({ slots: { reelStop: { enabled: true } } }), undefined);

	check('a per-symbol cue survives', round({ symbols: { H1: { land: 'my_land' } } }), { symbols: { H1: { land: 'my_land' } } }); // prettier-ignore
	check('an empty symbol is dropped', round({ symbols: { H1: {} } }), undefined);
	check('anticipation cues survive', round({ anticipation: { activation: 'sting' } }), { anticipation: { activation: 'sting' } }); // prettier-ignore
	check('an empty anticipation block is dropped', round({ anticipation: {} }), undefined);
	check('a tier cue survives', round({ winTiers: { big: { bgm: 'bed' } } }), { winTiers: { big: { bgm: 'bed' } } }); // prettier-ignore
	check('an empty tier is dropped', round({ winTiers: { big: {} } }), undefined);
	check('an entirely empty block is dropped', round({}), undefined);
	check('no block at all round-trips to nothing', normalizeSoundsDoc({ version: 1, entries: [] }).bindings, undefined); // prettier-ignore
}

console.log('\n20. the migration out of /config and /symbols is WHOLE-DOC, and one-way');
{
	const legacy = {
		configSounds: { reelStop: { names: ['old_stop'] } },
		symbolSounds: { H1: { land: 'old_land' } },
		anticipation: { activationSound: 'old_sting', loopSound: 'old_loop' },
		winLevels: [{ alias: 'big', sound: { bgm: 'old_bed' } }],
	} as Parameters<typeof legacySoundBindings>[0];

	const read = legacySoundBindings(legacy);
	check('the config slots come across', read.slots, { reelStop: { names: ['old_stop'] } });
	check('the per-symbol cues come across', read.symbols, { H1: { land: 'old_land' } });
	check('the anticipation cues are RENAMED to the new field names', read.anticipation, { activation: 'old_sting', loop: 'old_loop' }); // prettier-ignore
	check('the tier beds come across keyed by alias', read.winTiers, { big: { bgm: 'old_bed' } });

	// A project that has never opened the tool reads through to the old docs …
	check('no bindings block ⇒ the legacy read', effectiveSoundBindings({ version: 1 }, legacy), read); // prettier-ignore
	check('no doc at all ⇒ the legacy read', effectiveSoundBindings(null, legacy), read);
	check('neither ⇒ nothing', effectiveSoundBindings(null), {});

	// … and the FIRST save ends that, wholesale. This is the claim that matters: a per-field merge
	// would resurrect a cue the author deliberately cleared here from the config doc that still holds
	// it, and the author would have no way to tell the tool "no, really, nothing".
	const authored: SoundsDoc = { version: 1, bindings: { slots: { reelStop: { names: ['new_stop'] } } } }; // prettier-ignore
	check('a bindings block is the WHOLE answer', effectiveSoundBindings(authored, legacy), authored.bindings); // prettier-ignore
	check('…so a legacy symbol cue does NOT leak through', effectiveSoundBindings(authored, legacy).symbols, undefined); // prettier-ignore
	// An EMPTY block is still a block: "I cleared everything" must not read as "I have not started".
	check('an empty authored block still wins', effectiveSoundBindings({ version: 1, bindings: {} }, legacy), {}); // prettier-ignore
}

console.log(
	failures === 0
		? '\nAll sound-library claims hold.\n'
		: `\n${failures} FAILED sound-library claim(s).\n`,
);
process.exit(failures === 0 ? 0 : 1);
