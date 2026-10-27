/**
 * Timeline SOUND CUES — a cue's options, from the editor to the game's sound player:
 *   pnpm --filter launcher-api check:timeline-cue-sound
 *
 *  1. `readCueSound` keeps only the fields of the cue's kind, clamps every number into
 *     `CUE_SOUND_RANGES`, drops unknown fields, and reads a key without options as no options;
 *  2. the editor's copy of the ranges and fields (`timeline.js`, which cannot import) equals the
 *     runtime's;
 *  3. A PLAIN CUE IS UNCHANGED: a string-only `sfx:` / `music:` key makes exactly the one call a
 *     screen timeline always made (`once.play({ name })` / `music.play({ name })`), and a name the
 *     game has no region for warns and plays nothing;
 *  4. THE SHIP CHAIN (rule 8): a component timeline whose `sfx:` key carries options is saved,
 *     loaded, exported to `deploy/` and embedded for the game with its options intact; the game's
 *     component player crosses it WITH them, routes it to the registered sound sink, and the sink
 *     calls the player with those options;
 *  5. each option lands as the call that honours it: a random `pick`, the jitters, a stop with a
 *     fade, a music crossfade.
 *
 * Runs the real `cueSound.ts`, `componentEvents.ts`, `componentTimelines.ts` and the real
 * `cinematicStorage` / `cinematicExport` over an in-memory R2. The player is a recorder: that the
 * real `utils-sound` players turn these calls into howler calls is `banks.fixture.ts` claim 10.
 */
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import type { CinematicDoc, LayoutNode } from 'engine-layout';

const bucket = new Map<string, string>();
const server = (path: string): string => new URL(`../src/lib/server/${path}`, import.meta.url).href;
mock.module(server('r2.ts'), {
	namedExports: {
		ConflictError: class extends Error {},
		precondition: () => undefined,
		getObjectTextWithEtag: async (key: string) => {
			const text = bucket.get(key);
			return text === undefined ? null : { text, etag: '"e"' };
		},
		getObjectText: async (key: string) => bucket.get(key) ?? null,
		putObjectText: async (key: string, text: string) => {
			bucket.set(key, text);
			return '"e"';
		},
		deleteObject: async (key: string) => void bucket.delete(key),
		deleteObjects: async (keys: string[]) => keys.forEach((k) => bucket.delete(k)),
		listAllObjects: async (prefix: string) =>
			[...bucket.keys()]
				.filter((key) => key.startsWith(prefix))
				.map((key) => ({ key, size: 0, lastModified: 0 })),
	},
});

const S = await import('../../../packages/engine-layout/src/lib/cueSound.ts');
const E = await import('../../../packages/engine-layout/src/lib/componentEvents.ts');
const L = await import('../../../packages/engine-layout/src/lib/componentTimelines.ts');
const { saveCinematic } = await import('../src/lib/server/cinematicStorage.ts');
const { exportCinematics, loadAuthoredCinematics } =
	await import('../src/lib/server/cinematicExport.ts');
const T = await import('../src/lib/timeline/timeline.js');

let failures = 0;
let passes = 0;
function eq(name: string, actual: unknown, expected: unknown): void {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		passes++;
		return;
	}
	failures++;
	console.error(`✗ ${name}\n    expected ${e}\n    got      ${a}`);
}

/** A sound player that records every call, carrying the regions `names` lists. */
function recorder(names: string[]) {
	const calls: [string, unknown][] = [];
	const playing = new Map<string, number>();
	const channel = (id: string) => ({
		play: (o: { name: string; volume?: number }) => {
			calls.push([`${id}.play`, o]);
			playing.set(`${id}:${o.name}`, o.volume ?? 1);
		},
		stop: (o: { name: string }) => {
			calls.push([`${id}.stop`, o]);
			playing.delete(`${id}:${o.name}`);
		},
		fade: (o: { name: string; to: number }) => {
			calls.push([`${id}.fade`, o]);
			if (playing.has(`${id}:${o.name}`)) playing.set(`${id}:${o.name}`, o.to);
		},
		rate: (o: unknown) => void calls.push([`${id}.rate`, o]),
		pan: (o: unknown) => void calls.push([`${id}.pan`, o]),
		loop: (o: unknown) => void calls.push([`${id}.loop`, o]),
		seek: (o: unknown) => void calls.push([`${id}.seek`, o]),
		level: (name: string) => playing.get(`${id}:${name}`),
	});
	return {
		calls,
		target: {
			hasSound: (name: string) => names.includes(name),
			players: { once: channel('once'), loop: channel('loop'), music: channel('music') },
		},
	};
}

// ---- 1. reading the options ----------------------------------------------------------------------

eq('no options read as none', S.readCueSound('sfx', undefined), undefined);
eq('an empty object reads as none', S.readCueSound('sfx', {}), undefined);
eq('a non-object reads as none', S.readCueSound('sfx', 'loud'), undefined);
eq(
	'numbers clamp into range, unknown fields and wrong types drop',
	S.readCueSound('sfx', {
		volume: 3,
		rate: 0.1,
		pan: -4,
		fadeIn: -5,
		offset: 'x',
		loop: 'yes',
		reverb: 0.4,
		pick: ['b', '', 'b', 3, 'c'],
	}),
	{ volume: 1, rate: 0.5, pan: -1, fadeIn: 0, pick: ['b', 'c'] },
);
eq(
	'music keeps only its own fields',
	S.readCueSound('music', { volume: 0.5, rate: 2, pan: 1, loop: false, fadeIn: 800, pick: ['x'] }),
	{ volume: 0.5, loop: false, fadeIn: 800 },
);
eq('`action` is not an option (a stop is in the cue string)', S.readCueSound('sfx', { action: 'stop' }), undefined); // prettier-ignore
eq(
	'a stop cue keeps only its fade-out',
	S.readCueSound('sfx', { fadeOut: 300, volume: 0.5, loop: true }, true),
	{ fadeOut: 300 },
);
eq('a play cue drops a fade-out', S.readCueSound('sfx', { fadeOut: 300 }), undefined);
eq('an SFX `loop: false` is no option (only a loop is)', S.readCueSound('sfx', { loop: false }), undefined); // prettier-ignore
eq('a music `loop: false` is kept (it overrides the track’s own)', S.readCueSound('music', { loop: false }), { loop: false }); // prettier-ignore
eq('cueSoundOf: a stop', S.cueSoundOf('stop:music:bgm'), {
	kind: 'music',
	name: 'bgm',
	stop: true,
});
eq('cueSoundOf: a bare stop is no sound', S.cueSoundOf('stop:sfx:'), undefined);
eq(
	'a stop cue routes to the sound sink on a component, and fires no signal on a screen',
	[E.routeComponentCue('stop:sfx:pop', true), E.screenCueSignal('stop:sfx:pop')],
	[{ kind: 'sound', cue: 'stop:sfx:pop' }, undefined],
);
eq(
	'a pick list is capped',
	S.readCueSound('sfx', { pick: Array.from({ length: 20 }, (_, i) => `s${i}`) })?.pick?.length,
	S.CUE_SOUND_MAX_PICK,
);
eq('cueSoundOf: sfx', S.cueSoundOf('sfx:pop'), { kind: 'sfx', name: 'pop', stop: false });
eq('cueSoundOf: a bare kind is no sound', S.cueSoundOf('sfx:'), undefined);
eq('cueSoundOf: signal is no sound', S.cueSoundOf('signal:pop'), undefined);

// ---- 2. the editor's copy ----------------------------------------------------------------------

eq('the editor clamps into the same ranges', T.CUE_SOUND_RANGES, S.CUE_SOUND_RANGES);
eq('the editor offers the same fields per kind', T.CUE_SOUND_FIELDS, S.CUE_SOUND_FIELDS);
eq('the editor caps the pick list the same', T.CUE_SOUND_MAX_PICK, S.CUE_SOUND_MAX_PICK);

// ---- 3. a plain cue is unchanged ---------------------------------------------------------------

{
	const r = recorder(['pop', 'bgm_main']);
	S.playCueSound(r.target, 'sfx:pop');
	S.playCueSound(r.target, 'music:bgm_main');
	eq('a string-only cue makes exactly the call it always made', r.calls, [
		['once.play', { name: 'pop' }],
		['music.play', { name: 'bgm_main' }],
	]);
	const warned: unknown[] = [];
	const warn = console.warn;
	console.warn = (...args: unknown[]) => void warned.push(args[0]);
	S.playCueSound(r.target, 'sfx:missing');
	S.playCueSound(r.target, 'sfx:missing', { volume: 0.5 });
	console.warn = warn;
	eq('a name with no region plays nothing', r.calls.length, 2);
	eq('…and warns', warned.length, 2);
	S.playCueSound(r.target, 'signal:pop');
	eq('a non-sound cue is not a sound', r.calls.length, 2);
}

// ---- 4. the ship chain -------------------------------------------------------------------------

const coinNodes: LayoutNode[] = [{ id: 'n_glow', kind: 'sprite', label: 'Glow', x: 0, y: 0 }];
const OPTIONS = { volume: 0.6, rate: 1.25, pan: 0.5, fadeIn: 120, offset: 40, overlap: true };
const timeline: CinematicDoc = {
	schemaVersion: 1,
	id: 'c_coin_pop',
	name: 'Coin pop',
	duration: 1,
	fps: 30,
	stage: { sceneId: null, cast: [{ actorId: 'a_glow', kind: 'node', target: 'Glow', place: {} }] },
	host: { kind: 'component', componentId: 'coin' },
	playOn: 'enter',
	tracks: [
		{
			id: 'p',
			kind: 'property',
			actorId: 'a_glow',
			channels: {
				alpha: [
					{ time: 0, value: 0 },
					{ time: 1, value: 1 },
				],
			},
		},
		{
			id: 'cues',
			kind: 'cue',
			actorId: null,
			keys: [
				{ time: 0.2, cue: 'sfx:coin_pop', sound: OPTIONS },
				{ time: 0.4, cue: 'sfx:coin_tick' },
			],
		},
	],
	markers: [],
};

await saveCinematic('acme', 'borut', timeline, null);
const authored = await loadAuthoredCinematics('acme', 'borut');
const index = await exportCinematics('acme', 'borut', authored);
const deployed = JSON.parse(bucket.get('acme/borut/deploy/cinematics/c_coin_pop.json') ?? 'null');
const cueKeys = (doc: CinematicDoc | undefined) =>
	(doc?.tracks.find((t) => t.kind === 'cue') as { keys?: unknown[] } | undefined)?.keys;
eq('the save keeps the options on the key', cueKeys(authored[0]), cueKeys(timeline));
eq('the deploy/ copy keeps them', cueKeys(deployed), cueKeys(timeline));
eq('the copy embedded for the game keeps them', cueKeys(index.cinematics?.[0]), cueKeys(timeline));

{
	// The game's side: the embedded doc, through JSON as the bundle carries it.
	const shipped = JSON.parse(JSON.stringify(index.cinematics?.[0])) as CinematicDoc;
	const player = new L.ComponentTimelinePlayer([shipped], coinNodes);
	player.trigger('enter');
	// Frame-sized steps: one step longer than `cuesCrossed`'s seek guard crosses nothing.
	const crossed = Array.from({ length: 5 }, () => player.advance(0.1).cues).flat();
	eq('the component player crosses the cue with its options', crossed, [
		{ cue: 'sfx:coin_pop', timeline: 'c_coin_pop', sound: OPTIONS },
		{ cue: 'sfx:coin_tick', timeline: 'c_coin_pop' },
	]);

	const r = recorder(['coin_pop', 'coin_tick']);
	eq('no sink registered (an editor preview): nothing to call', S.getCueSound(), undefined);
	const unregister = S.registerCueSound((cue, options) => S.playCueSound(r.target, cue, options));
	// As `ComponentInstance` routes a crossed cue: a sound goes to the registered sink.
	for (const c of crossed) {
		const route = E.routeComponentCue(c.cue, false);
		if (route.kind === 'sound') S.getCueSound()?.(route.cue, c.sound);
	}
	eq('the sink calls the game’s player with the cue’s options', r.calls, [
		['once.play', { name: 'coin_pop', volume: 0.6, forcePlay: true }],
		['once.seek', { name: 'coin_pop', offset: 40 }],
		['once.rate', { name: 'coin_pop', rate: 1.25 }],
		['once.pan', { name: 'coin_pop', pan: 0.5 }],
		['once.fade', { name: 'coin_pop', from: 0, to: 0.6, duration: 120 }],
		['once.play', { name: 'coin_tick' }],
	]);
	unregister();
	eq('unregistering clears the sink', S.getCueSound(), undefined);
}

// The wiring the gate cannot run (Svelte components), held by their source.
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const instance = read('packages/engine-layout/src/lib/ComponentInstance.svelte');
eq(
	'ComponentInstance hands a sound cue and its options to the registered sink',
	[
		instance.includes("route.kind === 'sound'") &&
			instance.includes('getCueSound()?.(route.cue, sound)'),
		/for \(const \{ cue, timeline, sound \} of step\.cues\)/.test(instance),
		/const \{ cue, timeline, sound \} of timelinePlayer\?\.drive/.test(instance),
	],
	[true, true, true],
);
eq(
	'the game registers the sink on its own player, and a screen timeline plays through the same call',
	[
		read('apps/lines/src/components/Sound.svelte').includes(
			'registerCueSound((cue, options) => playCueSound(sound, cue, options))',
		),
		read('apps/lines/src/components/FlowV2Cinematics.svelte').includes(
			'playCueSound(sound, cue, options)',
		),
	],
	[true, true],
);

// An OLDER runtime reads only `cue` (its `routeCue`, as on main before this change): it must never
// PLAY a stop cue. It broadcasts the cue's text after the first colon, and plays sfx:/music: only.
{
	const oldRouteCue = (cue: string): string => {
		const sep = cue.indexOf(':');
		const ns = sep > 0 ? cue.slice(0, sep) : '';
		const name = sep > 0 ? cue.slice(sep + 1) : cue;
		if (!name) return 'nothing';
		return ns === 'sfx' || ns === 'music' ? `play ${name}` : `broadcast ${name}`;
	};
	eq(
		'an older runtime broadcasts a stop cue under a namespaced type, never plays it',
		[oldRouteCue('stop:sfx:coin'), oldRouteCue('stop:music:bgm_main')],
		['broadcast sfx:coin', 'broadcast music:bgm_main'],
	);
}

// ---- 5. each option as its call ----------------------------------------------------------------

{
	const r = recorder(['a', 'b', 'c']);
	const picks = [0, 0.5, 0.99].map((roll) => {
		r.calls.length = 0;
		S.playCueSound(r.target, 'sfx:a', { pick: ['b', 'c'], overlap: true }, () => roll);
		return (r.calls[0][1] as { name: string }).name;
	});
	eq('a pick draws from the cue’s own name and its alternates', picks, ['a', 'b', 'c']);

	const j = recorder(['b']);
	const rolls = [1, 0];
	S.playCueSound(j.target, 'sfx:b', { volume: 0.5, volumeJitter: 0.2, rateJitter: 0.1 }, () =>
		rolls.length ? rolls.shift()! : 0.5,
	);
	eq('the jitters move the level and the rate by up to ± their spread', j.calls, [
		['once.play', { name: 'b', volume: 0.6 }],
		['once.rate', { name: 'b', rate: 0.9 }],
	]);

	const l = recorder(['c']);
	S.playCueSound(l.target, 'sfx:c', { loop: true });
	S.playCueSound(l.target, 'stop:sfx:c');
	eq('a loop cue starts on the loop player; a stop cue ends it', l.calls, [
		['loop.play', { name: 'c' }],
		['loop.loop', { name: 'c', loop: true }],
		['loop.stop', { name: 'c' }],
	]);

	l.calls.length = 0;
	S.playCueSound(l.target, 'sfx:c', { loop: true, volume: 0.8 });
	S.playCueSound(l.target, 'stop:sfx:c', { fadeOut: 10 });
	await new Promise((done) => setTimeout(done, 30));
	eq('a stop with a fade fades from its level, then stops', l.calls.slice(2), [
		['loop.fade', { name: 'c', from: 0.8, to: 0, duration: 10 }],
		['loop.stop', { name: 'c' }],
	]);

	l.calls.length = 0;
	S.playCueSound(l.target, 'stop:sfx:c');
	eq('a stop for a sound that is not playing calls nothing', l.calls, []);

	const o = recorder(['coin']);
	S.playCueSound(o.target, 'sfx:coin', { offset: 200, fadeIn: 150 });
	o.calls.length = 0;
	S.playCueSound(o.target, 'sfx:coin', { offset: 200, fadeIn: 150 });
	eq('a re-fire while the copy still sounds is skipped whole (no seek / fade of that copy)', o.calls, []); // prettier-ignore

	const lo = recorder(['amb']);
	S.playCueSound(lo.target, 'sfx:amb', { loop: true, overlap: true, offset: 500, fadeIn: 1000 });
	lo.calls.length = 0;
	S.playCueSound(lo.target, 'sfx:amb', { loop: true, overlap: true, offset: 500, fadeIn: 1000 });
	eq('a loop never overlaps: its re-fire while it plays is skipped whole too', lo.calls, []);

	const m = recorder(['bgm_a']);
	S.playCueSound(m.target, 'music:bgm_a', { fadeIn: 700, volume: 0.4, loop: true });
	S.playCueSound(m.target, 'stop:music:bgm_a');
	eq('music: a crossfade at a level, looped; a stop', m.calls, [
		['music.play', { name: 'bgm_a', volume: 0.4, fade: 700 }],
		['music.loop', { name: 'bgm_a', loop: true }],
		['music.stop', { name: 'bgm_a' }],
	]);
}

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
