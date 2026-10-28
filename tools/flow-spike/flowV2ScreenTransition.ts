/**
 * Invisible Flow v2 — SCREEN TRANSITION harness (Invisible Shader Graph step 8e.4,
 * `docs/design/shader-graph-screens.md` §6.2, §9.1).
 *
 *   pnpm --filter flow-spike run v2screentransition
 *
 * Runs `screenTransition` → Hide → Show → `waitForScreenTransition` through the REAL interpreter
 * (`runFlowEvent` over `createFlowV2Env` and a real container mount model), with the game's REAL
 * action implementations (`apps/lines/src/game/screenTransitions.ts`, what `flowEffects.ts` maps
 * both actions to) bound to a STUB `ScreenTransitionsApi` whose capture and end the harness
 * releases by hand.
 *
 * Asserts:
 *   1. The standard vocabulary declares both actions and the `ScreenTransitionKind` enum (the
 *      built-in exit kinds), the `stage` Element FX target first, and the flow validates clean.
 *   2. Non-blocking, the order of resolution: the transition starts and NOTHING after it runs until
 *      the stub reports the capture; then the Hide and the Show run (the screen changes under the
 *      still) and the chain holds at `waitForScreenTransition` until the stub reports the end.
 *   3. Blocking: the Hide waits for the END, not the capture.
 *   4. The payload the runtime gets: kind, length, strength, `color` as a param, `reverse`; the
 *      length and strength clamped; a kind that is no transition plays nothing and goes on at once.
 *   5. No runtime bound (today's game): the transition is a cut — the chain runs straight through
 *      in one turn, with no play — and `waitForScreenTransition` resolves at once; the walk is the
 *      same as the doc with both actions removed; `?fxdebug=1` warns of the cut once.
 *
 * Prints PASS/FAIL per assertion + a final `V2 SCREEN TRANSITION HARNESS: PASSED`.
 */

import {
	createContainerMountModel,
	createFlowV2Env,
	runFlowEvent,
	templateVocabulary,
	validateFlowDoc,
	type DataSource,
	type ExecEdge,
	type FlowDoc,
	type FlowV2Effect,
	type Node,
	type RunContext,
	type TypeRef,
} from 'engine-flow-v2';
import { SCREEN_TRANSITION_KINDS } from 'constants-shared/screenTransition';

import {
	bindScreenTransitions,
	screenTransitionEffect,
	waitForScreenTransitionEffect,
	type ScreenTransitionPlay,
} from '../../apps/lines/src/game/screenTransitions';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};
const same = (label: string, actual: unknown, expected: unknown) =>
	assert(
		label,
		JSON.stringify(actual) === JSON.stringify(expected),
		`got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`,
	);

const VOCAB = templateVocabulary('lines');
const LIBRARY = { version: 2 as const, functions: [] };

const literal = (type: TypeRef, value: unknown): DataSource => ({ kind: 'literal', type, value });
const kindLit = (value: string): DataSource =>
	literal({ t: 'enum', name: 'ScreenTransitionKind' }, value);
const lit = (t: 'ms' | 'float' | 'string' | 'bool', value: unknown): DataSource =>
	literal({ t }, value);

/** load → screenTransition → hide basegame → show freeSpins → waitForScreenTransition → uiShow. */
const docWith = (transition: Record<string, DataSource> | null, wait = true): FlowDoc => {
	const chain: Node[] = [
		...(transition
			? [
					{
						id: 'freeze',
						kind: 'action',
						pos: { x: 200, y: 0 },
						ref: 'screenTransition',
						inputs: transition,
					} as Node,
				]
			: []),
		{ id: 'hideBase', kind: 'hideContainer', pos: { x: 400, y: 0 }, ref: 'basegame' } as Node,
		{ id: 'showFs', kind: 'showContainer', pos: { x: 600, y: 0 }, ref: 'freeSpins' } as Node,
		...(wait
			? [
					{
						id: 'wait',
						kind: 'action',
						pos: { x: 800, y: 0 },
						ref: 'waitForScreenTransition',
					} as Node,
				]
			: []),
		{ id: 'after', kind: 'fireCue', pos: { x: 1000, y: 0 }, ref: 'uiShow' } as Node,
	];
	const nodes: Node[] = [
		{ id: 'onLoad', kind: 'event', pos: { x: 0, y: 0 }, ref: 'load' },
		...chain,
	];
	const exec: ExecEdge[] = nodes.slice(1).map((node, i) => ({
		from: { node: nodes[i].id, pin: 'exec' },
		to: { node: node.id, pin: 'exec' },
	}));
	return {
		version: 2,
		templateId: 'lines',
		graph: { nodes, exec, data: [] },
		containers: [
			{ id: 'basegame', sceneId: 'basegame', z: 0 },
			{ id: 'freeSpins', sceneId: 'freeSpins', z: 10 },
		],
	};
};

const TRANSITION = {
	kind: kindLit('dissolveOut'),
	durationMs: lit('ms', 900),
	intensity: lit('float', 1.5),
	color: lit('string', '#ff0000'),
	reverse: lit('bool', true),
};

const EFFECTS: Record<string, FlowV2Effect> = {
	screenTransition: screenTransitionEffect,
	waitForScreenTransition: () => waitForScreenTransitionEffect(),
};

const makeRun = (doc: FlowDoc) => {
	const log: string[] = [];
	const mount = createContainerMountModel(doc.containers);
	const env = createFlowV2Env({
		mount,
		effect: (name) => {
			const effect = EFFECTS[name];
			return effect
				? (payload) => {
						log.push(`effect ${name}`);
						return effect(payload);
					}
				: undefined;
		},
		broadcast: (cue) => {
			log.push(`cue ${cue}`);
		},
		waitForTimeout: () => Promise.resolve(),
		timeScale: () => 1,
		engineRead: () => undefined,
	});
	const recordingEnv = {
		...env,
		showContainer: (id: string, z: number) => {
			log.push(`show ${id}`);
			return env.showContainer(id, z);
		},
		hideContainer: (id: string) => {
			log.push(`hide ${id}`);
			return env.hideContainer(id);
		},
	};
	const ctx: RunContext = { vocab: VOCAB, library: LIBRARY, env: recordingEnv };
	let finished = false;
	const run = runFlowEvent(doc, ctx, 'load', {}).then(() => {
		finished = true;
	});
	return { log, run, isFinished: () => finished };
};

const deferred = () => {
	let resolve = () => {};
	const promise = new Promise<void>((r) => (resolve = r));
	return { promise, resolve };
};
/** Let every pending microtask (and the interpreter's awaits) settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A stub runtime: records each play; the harness releases its capture and its end. */
const stubApi = () => {
	const plays: ScreenTransitionPlay[] = [];
	let captured = deferred();
	let done = deferred();
	let playing = false;
	bindScreenTransitions({
		play: (transition) => {
			plays.push(transition);
			captured = deferred();
			done = deferred();
			playing = true;
			void done.promise.then(() => (playing = false));
			return { captured: captured.promise, done: done.promise };
		},
		wait: () => (playing ? done.promise : Promise.resolve()),
	});
	return {
		plays,
		capture: () => captured.resolve(),
		end: () => done.resolve(),
	};
};

const main = async () => {
	console.log('Invisible Flow v2 — screen transition harness\n');

	console.log('1. the vocabulary:');
	{
		const actions = VOCAB.actions.map((a) => a.name);
		same(
			'both actions follow the camera effect, in the effect category',
			actions
				.slice(actions.indexOf('cameraEffect'), actions.indexOf('cameraEffect') + 3)
				.concat(
					VOCAB.actions
						.filter((a) => a.name.includes('ScreenTransition') || a.name === 'screenTransition')
						.map((a) => a.category),
				),
			['cameraEffect', 'screenTransition', 'waitForScreenTransition', 'effect', 'effect'],
		);
		same(
			'ScreenTransitionKind holds the built-in exit kinds',
			VOCAB.enums.find((e) => e.name === 'ScreenTransitionKind')?.values,
			[...SCREEN_TRANSITION_KINDS],
		);
		same('the ten built-in exits', SCREEN_TRANSITION_KINDS, [
			'popOut',
			'fadeOut',
			'melt',
			'burn',
			'dissolveOut',
			'crash',
			'crumble',
			'shatter',
			'crystallize',
			'disintegrate',
		]);
		same(
			'the Element FX targets: the stage first',
			VOCAB.enums.find((e) => e.name === 'ElementFxTarget')?.values,
			['stage', 'reels'],
		);
		const errors = validateFlowDoc(docWith(TRANSITION), VOCAB, LIBRARY).filter(
			(i) => i.severity === 'error',
		);
		same('the flow validates with no error', errors, []);
	}

	console.log('\n2. non-blocking: freeze, change the screen under it, then wait:');
	{
		const api = stubApi();
		const { log, run, isFinished } = makeRun(docWith(TRANSITION));
		await settle();
		same('the transition starts; nothing after it runs before the capture', log, [
			'effect screenTransition',
		]);
		api.capture();
		await settle();
		same('once captured: the hide and the show run, and the chain holds at the wait', log, [
			'effect screenTransition',
			'hide basegame',
			'show freeSpins',
			'effect waitForScreenTransition',
		]);
		assert('…and the event has not finished', !isFinished());
		api.end();
		await run;
		same('once it ends: the chain goes on', log.at(-1), 'cue uiShow');
		same('one play', api.plays.length, 1);
	}

	console.log('\n3. blocking: the hide waits for the end, not the capture:');
	{
		const api = stubApi();
		const { log, run } = makeRun(docWith({ ...TRANSITION, blocking: lit('bool', true) }, false));
		await settle();
		api.capture();
		await settle();
		same('captured, not ended: nothing after it has run', log, ['effect screenTransition']);
		api.end();
		await run;
		same('ended: the rest runs', log, [
			'effect screenTransition',
			'hide basegame',
			'show freeSpins',
			'cue uiShow',
		]);
	}

	console.log('\n4. what the runtime is asked to play:');
	{
		const api = stubApi();
		const first = makeRun(docWith(TRANSITION));
		await settle();
		api.capture();
		api.end();
		await first.run;
		same('kind, length, strength, colour as a param, reverse', api.plays[0], {
			kind: 'dissolveOut',
			durationMs: 900,
			intensity: 1.5,
			params: { color: '#ff0000' },
			reverse: true,
		});
		const clamped = makeRun(
			docWith({
				kind: kindLit('custom:swirl'),
				durationMs: lit('ms', 60_000),
				intensity: lit('float', 9),
			}),
		);
		await settle();
		api.capture();
		api.end();
		await clamped.run;
		same(
			'a custom kind passes through (the runtime falls back if it is missing); length and strength clamped',
			api.plays[1],
			{ kind: 'custom:swirl', durationMs: 5000, intensity: 4 },
		);
		const wrong = makeRun(docWith({ kind: kindLit('shake') }));
		await settle();
		assert('a kind that is no transition plays nothing and goes on at once', wrong.isFinished());
		same('…two plays in all', api.plays.length, 2);
	}

	console.log('\n5. no runtime bound (today): a cut, and the wait returns at once:');
	{
		bindScreenTransitions(null);
		const cut = makeRun(docWith(TRANSITION));
		await settle();
		assert('the whole chain ran in one turn, with nothing to release', cut.isFinished());
		const bare = makeRun(docWith(null, false));
		await bare.run;
		same(
			'the same walk as the doc without the two actions',
			cut.log.filter((line) => !line.startsWith('effect ')),
			bare.log,
		);
		same('…both actions were still called, and returned at once', cut.log, [
			'effect screenTransition',
			'hide basegame',
			'show freeSpins',
			'effect waitForScreenTransition',
			'cue uiShow',
		]);
		same(
			'the implementations return nothing to await',
			[screenTransitionEffect({ kind: 'dissolveOut' }), waitForScreenTransitionEffect()],
			[undefined, undefined],
		);
		const warnings: unknown[] = [];
		const warn = console.warn;
		console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
		const page = globalThis as { location?: { search: string } };
		page.location = { search: '?fxdebug=1' };
		screenTransitionEffect({ kind: 'dissolveOut' });
		screenTransitionEffect({ kind: 'burn' });
		delete page.location;
		console.warn = warn;
		assert(
			'under ?fxdebug=1 the cut is warned once (and never without it)',
			warnings.length === 1 && String(warnings[0]).startsWith('[fxdebug] screenTransition'),
			JSON.stringify(warnings),
		);
	}

	console.log(`\nV2 SCREEN TRANSITION HARNESS: ${failed ? 'FAILED' : 'PASSED'}`);
	if (failed) process.exit(1);
};

void main();
