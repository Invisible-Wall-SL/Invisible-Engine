/**
 * A SCREEN timeline's cue plays the _On cue_ Element FX it names, headless:
 *   pnpm --filter launcher-api check:screen-cue-fx
 *
 * Reported: a cue on a screen timeline never played the Element FX set to _On cue_ with that name.
 * The game routed a screen timeline's cues onto the game event bus only, and _On cue_ Element FX
 * listen on the component-signal bus (`ElementFxPlayer` → `getComponentSignal`), which only a Flow
 * `fireCue` and a component's own timelines fed. The editor's ▶ fired no cues at all.
 *
 *  1. in game: stepping the owner's Reel_Intro at 30 fps through `cuesCrossed` and routing each cue
 *     as `FlowV2Cinematics` does (`screenCueSignal` → `emitComponentSignal`) fires the Element FX's
 *     subscription once, at 1.0 s; a bare, `fx:` or `sfx:` cue fires none (they keep their
 *     game-bus broadcast), and `FlowV2Cinematics` does this for screen-hosted timelines only;
 *  2. in the editor: `screenCueFx` finds the screen's and its nodes' _On cue_ entries for a cue,
 *     `playbackCuesCrossed` steps as the game's `<Cinematic>` does (one-shot, loop, ping-pong),
 *     and the Timeline panel plays what they find through ▶'s stage preview;
 *  3. the cue inspector suggests the screen's _On cue_ Element FX names as `signal:` cues, and
 *     `/rigger` (no hook) draws the inspector exactly as before.
 */
import { readFileSync } from 'node:fs';
import {
	clearComponentSignals,
	emitComponentSignal,
	getComponentSignal,
	screenCueSignal,
	type CinematicDoc,
	type Scene,
} from 'engine-layout';
import * as EV from '../../../packages/engine-cinematic/src/cinematicEval.js';
import { mount } from '../src/lib/timeline/timeline.js';
import * as S from '../src/lib/timeline/screenTimeline.ts';

let failures = 0;
const eq = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.error(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
	}
};
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

Object.assign(globalThis, {
	window: { addEventListener: () => {}, removeEventListener: () => {} },
	document: { activeElement: null },
});

const CUE = 'FX_Intro_reel_Particles';
const assemble = { id: 'efx1', kind: 'assemble', trigger: 'cue', cue: CUE, durationMs: 2200, intensity: 0.3 }; // prettier-ignore
const SCENE: Scene = {
	id: 'base',
	name: 'Base game',
	elementFx: [assemble, { id: 'efx2', kind: 'shake', trigger: 'enter' }],
	nodes: [
		{ id: 'bg', kind: 'sprite', label: 'Reel_Background', x: 0, y: 0 },
		{
			id: 'grid',
			kind: 'reelGrid',
			label: 'Reel grid',
			x: 0,
			y: 0,
			elementFx: [
				{ id: 'efx3', kind: 'shake', trigger: 'cue', cue: CUE },
				{ id: 'efx4', kind: 'glow', trigger: 'cue', cue: CUE, disabled: true },
				{ id: 'efx5', kind: 'glow', trigger: 'cue', cue: 'other' },
			],
		},
	],
} as unknown as Scene;
const reelIntro = (cue: string, loop?: CinematicDoc['loop']): CinematicDoc =>
	({
		schemaVersion: 1,
		id: 'base_reel_intro',
		name: 'Reel_Intro',
		duration: 2,
		fps: 30,
		...(loop && { loop }),
		host: { kind: 'screen', sceneId: 'base' },
		stage: { sceneId: null, cast: [] },
		tracks: [{ id: 'cues', kind: 'cue', keys: [{ time: 1, cue }] }],
	}) as unknown as CinematicDoc;
const cueKeys = (doc: CinematicDoc) =>
	(doc.tracks.find((t) => t.kind === 'cue') as unknown as { keys: { time: number; cue: string }[] })
		.keys;

console.log('1. in game: a screen timeline’s signal: cue fires the On-cue Element FX at its time');
{
	/** The game's `<Cinematic>` one-shot clock at 30 fps, each crossed cue routed as
	 *  `FlowV2Cinematics.routeCue` routes a screen timeline's. Returns when the FX heard it. */
	const play = (cue: string): number[] => {
		clearComponentSignals();
		const heard: number[] = [];
		let time = 0;
		const unsub = getComponentSignal(CUE).subscribe(() => heard.push(+time.toFixed(4)));
		const keys = cueKeys(reelIntro(cue));
		while (time < 2) {
			const prev = time;
			time += 1 / 30;
			for (const k of EV.cuesCrossed(keys, prev, time)) {
				const signal = screenCueSignal(k.cue);
				if (signal) emitComponentSignal(signal);
			}
		}
		unsub();
		return heard;
	};
	const heard = play(`signal:${CUE}`);
	eq(`signal:${CUE} fires the Element FX once`, heard.length, 1);
	eq('…on the first frame at or past 1.0 s', heard[0] >= 1 && heard[0] < 1 + 1 / 30 + 1e-6, true);
	eq(`a bare ${CUE} is not a signal (game-bus broadcast only)`, play(CUE), []);
	eq('an fx: cue is not a signal', play(`fx:${CUE}`), []);
	eq('an sfx: cue is not a signal', play(`sfx:${CUE}`), []);

	const cinematics = read('../../lines/src/components/FlowV2Cinematics.svelte');
	eq('FlowV2Cinematics fires a signal: cue on the component-signal bus', /screenCueSignal\(cue\)[\s\S]{0,80}emitComponentSignal\(signal\)/.test(cinematics), true); // prettier-ignore
	eq('…for a screen-hosted timeline only', /routeCue\(cue, entry\.doc\?\.host\?\.kind === 'screen', options\)/.test(cinematics), true); // prettier-ignore
	eq('…after its game-bus broadcast, which stays', /eventEmitter\?\.broadcast\(\{ type: name \}\);\s*const signal = onScreen/.test(cinematics), true); // prettier-ignore
	const player = read('../../../packages/engine-layout/src/lib/ElementFxPlayer.svelte');
	eq('ElementFxPlayer hears an On-cue entry on getComponentSignal(cue)', /if \(entry\.cue\) listen\(entry\.cue/.test(player) && /getComponentSignal\(cue\)\.subscribe/.test(player), true); // prettier-ignore
}

console.log('2. in the editor: ▶ plays what the cue reaches, on the game’s clock');
{
	eq(
		'screenCueFx: the screen’s entry and the node’s, skipping disabled and other cues',
		S.screenCueFx(SCENE, `signal:${CUE}`).map((f) => [f.target, f.entry.id]),
		[
			[{ kind: 'screen', sceneId: 'base' }, 'efx1'],
			[{ kind: 'node', id: 'grid' }, 'efx3'],
		],
	);
	eq('a bare cue reaches none (as in game)', S.screenCueFx(SCENE, CUE), []);
	const keys = cueKeys(reelIntro(`signal:${CUE}`));
	const steps = (loop: CinematicDoc['loop'], until: number): number[] => {
		const out: number[] = [];
		for (let e = 0; e < until - 1e-9; e += 1 / 30) {
			if (S.playbackCuesCrossed(keys, loop, e, e + 1 / 30, 2).length) out.push(Math.round(e * 30));
		}
		return out;
	};
	eq('one-shot: once, on the frame that reaches 1.0 s', steps(undefined, 2), [30]);
	eq('loop: every lap', steps('loop', 6), [30, 90, 150]);
	eq('ping-pong: on the way out only', steps('pingPong', 8), [30, 150]);
	eq('a seek (a big jump) fires nothing, as cuesCrossed', S.playbackCuesCrossed(keys, undefined, 0, 1.5, 2), []); // prettier-ignore
	const panel = read('../src/routes/(app)/editor/EditorTimelinePanel.svelte');
	eq('the panel routes each frame’s crossed cues', /playCrossedCues\(open, before, elapsed\)/.test(panel), true); // prettier-ignore
	eq('…through screenCueFx into the ▶ preview', /playbackCuesCrossed\([\s\S]{0,120}screenCueFx\(scene, k\.cue\)[\s\S]{0,160}playElementFxPreview\(last\.target, last\.entry\)/.test(panel), true); // prettier-ignore
}

console.log('3. the cue inspector suggests the screen’s On-cue Element FX');
{
	eq('elementFxCueSuggestions', S.elementFxCueSuggestions(SCENE), [
		{ cue: `signal:${CUE}`, label: 'Assemble from particles on screen, Shake on Reel grid' },
		{ cue: 'signal:other', label: 'Glow on Reel grid' },
	]);
	const inspector = (host?: object): string => {
		const el = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
		const tl = mount(null, {
			doc: reelIntro('signal:'),
			ev: EV,
			inspector: el as unknown as HTMLElement,
			...(host && { host }),
		});
		tl.setTime(1);
		tl.addCue('signal:');
		const html = el.innerHTML;
		tl.destroy();
		return html;
	};
	const rigger = inspector();
	const editor = inspector({ cueSuggestions: () => S.elementFxCueSuggestions(SCENE) });
	eq('the picker lists the Element FX cue', editor.includes(`<option value="signal:${CUE}">signal:${CUE} — Assemble from particles on screen, Shake on Reel grid</option>`), true); // prettier-ignore
	eq('…in its own group', editor.includes('<optgroup label="Element FX (On cue)">'), true);
	eq('…and the note names Element FX', /Element FX<\/b>[^<]*<i>On cue<\/i>/.test(editor), true);
	eq('/rigger (no hook): no Element FX group or note', /Element FX/.test(rigger), false);
	eq('a screen with no On-cue Element FX draws the inspector as /rigger does', inspector({ cueSuggestions: () => [] }), rigger); // prettier-ignore
	const panel = read('../src/routes/(app)/editor/EditorTimelinePanel.svelte');
	eq('the editor panel passes cueSuggestions for a screen', /cueSuggestions: \(\) => \(!component && scene \? elementFxCueSuggestions\(scene\) : \[\]\)/.test(panel), true); // prettier-ignore
}

if (failures) {
	console.error(`\n${failures} check(s) failed.`);
	process.exit(1);
}
console.log('\nAll screen-cue Element FX checks passed.');
