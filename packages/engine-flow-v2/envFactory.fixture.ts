/**
 * Offline fixture for `createFlowV2Env` — does every capability the interpreter calls reach the game?
 * Run with tsx:
 *   pnpm --filter launcher-api exec tsx ../../packages/engine-flow-v2/envFactory.fixture.ts
 *
 * The game never hands the interpreter its primitives directly: it passes them to this factory, and
 * the interpreter calls the env the factory returns. A capability the factory leaves out is therefore
 * a node that silently does nothing in every game, however well the game implements it. Three did:
 * `playCinematic` / `stopCinematic` (no timeline or cinematic ever played from Flow, and an awaited
 * one never waited) and `containerAnimationMs` (a Show node's `durationMs` pin read 0). FOUR claims:
 *
 *  1. EVERY ENV CALL THE INTERPRETER MAKES EXISTS ON THE FACTORY'S ENV — read off `runtime.ts`, so a
 *     capability added to the interpreter later is held to this without editing the fixture.
 *  2. EVERY OPTIONAL CAPABILITY REACHES THE GAME with its arguments and its answer.
 *  3. AN AWAITED `playCinematic` HOLDS THE CHAIN until the game's play settles, through the real
 *     factory and interpreter; a looping one and a recorder env without the capability do not.
 *  4. A SHOW NODE'S `durationMs` FEEDS A DELAY the game's measured length; without it, 0.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFlowV2Env, type FlowV2EnvDeps } from './src/env.ts';
import { createContainerMountModel } from './src/mount.ts';
import { runFlowEvent, type FlowV2Env, type RunContext } from './src/runtime.ts';
import type { FlowDoc, Node, TemplateVocabulary } from './src/types.ts';

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

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTAINERS = [{ id: 'intro', sceneId: 'intro', z: 10 }];
const VOCAB: TemplateVocabulary = {
	templateId: 'fixture',
	structs: [],
	enums: [],
	events: [{ name: 'go', payload: [] }],
	actions: [{ name: 'after', params: [], category: 'effect' }],
	cues: [],
	collections: [],
	values: [],
};

const baseDeps = (log: string[]): FlowV2EnvDeps => ({
	mount: createContainerMountModel(CONTAINERS),
	effect: (name) => () => {
		log.push(`effect ${name}`);
	},
	broadcast: () => undefined,
	waitForTimeout: (ms) => {
		log.push(`wait ${ms}`);
		return Promise.resolve();
	},
	timeScale: () => 1,
	engineRead: () => undefined,
});

const flush = async (): Promise<void> => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};

async function main(): Promise<void> {
	// 1. Every `env.<name>` the interpreter calls is on the factory's env.
	console.log('1. every env call the interpreter makes exists on the factory env');
	const source = readFileSync(join(HERE, 'src/runtime.ts'), 'utf8');
	const called = [...new Set([...source.matchAll(/\benv\.(\w+)/g)].map((m) => m[1]))].sort();
	const built = createFlowV2Env(baseDeps([]));
	check('the interpreter calls a dozen or more env capabilities', called.length >= 12, true);
	check(
		'none is missing from createFlowV2Env',
		called.filter((name) => typeof built[name as keyof FlowV2Env] !== 'function'),
		[],
	);

	// 2. Each optional capability reaches the game's implementation, arguments and answer intact.
	console.log('2. every optional capability reaches the game');
	const seen: string[] = [];
	const ref = { container: 'intro', instance: 'banner' };
	const env = createFlowV2Env({
		...baseDeps([]),
		containerAnimationMs: (id) => (seen.push(`duration ${id}`), 1234),
		setMessageShown: (id, shown) => void seen.push(`message ${id} ${shown}`),
		enterMode: (id, opts) => void seen.push(`enter ${id} ${opts.policy}`),
		exitMode: (id, total) => void seen.push(`exit ${id} ${total}`),
		playCinematic: (id, opts) => void seen.push(`play ${id} ${opts.loop} ${opts.speed}`),
		stopCinematic: (id) => void seen.push(`stop ${id}`),
		fireInstanceTrigger: (r, trigger) => void seen.push(`fire ${r.instance} ${trigger}`),
		setInstanceInput: (r, input, value) => void seen.push(`set ${r.instance} ${input}=${value}`),
		readInstanceValue: (r, value) => (seen.push(`read ${r.instance} ${value}`), 7),
		awaitInstanceState: async (r, layer, state) => void seen.push(`state ${layer}=${state}`),
	});
	check('containerAnimationMs answers', env.containerAnimationMs?.('intro'), 1234);
	env.setMessageShown?.('msg', true);
	void env.enterMode?.('holdAndWin', { policy: 'nest' });
	void env.exitMode?.('holdAndWin', 5);
	void env.playCinematic?.('featureintro_intro', { loop: false, speed: 2 });
	env.stopCinematic?.('featureintro_intro');
	void env.fireInstanceTrigger?.(ref, 'win');
	env.setInstanceInput?.(ref, 'lit', true);
	check('readInstanceValue answers', env.readInstanceValue?.(ref, 'amount'), 7);
	await env.awaitInstanceState?.(ref, 'main', 'idle');
	check('each call landed, in order', seen, [
		'duration intro',
		'message msg true',
		'enter holdAndWin nest',
		'exit holdAndWin 5',
		'play featureintro_intro false 2',
		'stop featureintro_intro',
		'fire banner win',
		'set banner lit=true',
		'read banner amount',
		'state main=idle',
	]);

	// 3. playCinematic { awaitComplete } through the real factory + interpreter.
	console.log('3. an awaited playCinematic holds the chain until the game settles it');
	const playDoc = (cinematic: Partial<Node>): FlowDoc => ({
		version: 2,
		templateId: 'fixture',
		containers: CONTAINERS,
		graph: {
			nodes: [
				{ id: 'ev', kind: 'event', pos: { x: 0, y: 0 }, ref: 'go' },
				{
					id: 'cine',
					kind: 'playCinematic',
					pos: { x: 1, y: 0 },
					ref: 'featureintro_intro',
					...cinematic,
				} as Node,
				{ id: 'after', kind: 'action', pos: { x: 2, y: 0 }, ref: 'after' },
			],
			exec: [
				{ from: { node: 'ev', pin: 'exec' }, to: { node: 'cine', pin: 'play' } },
				{ from: { node: 'cine', pin: 'exec' }, to: { node: 'after', pin: 'exec' } },
			],
			data: [],
		},
	});
	const play = async (cinematic: Partial<Node>, withPlay: boolean) => {
		const log: string[] = [];
		let settle: (() => void) | undefined;
		const deps: FlowV2EnvDeps = {
			...baseDeps(log),
			...(withPlay
				? {
						playCinematic: (id: string, opts: { loop?: boolean }) => {
							log.push(`play ${id}`);
							// A loop's play never settles: only the interpreter's own guard keeps it from holding.
							if (opts.loop) return new Promise<void>(() => undefined);
							return new Promise<void>((resolve) => (settle = resolve));
						},
					}
				: {}),
		};
		const ctx: RunContext = {
			vocab: VOCAB,
			library: { version: 2, functions: [] },
			env: createFlowV2Env(deps),
		};
		const run = runFlowEvent(playDoc(cinematic), ctx, 'go', {});
		await flush();
		const before = [...log];
		settle?.();
		await run;
		return { before, after: log };
	};
	const awaited = await play({ awaitComplete: true }, true);
	check('the game is asked to play it', awaited.before, ['play featureintro_intro']);
	check('the chain continues only once the play settles', awaited.after, [
		'play featureintro_intro',
		'effect after',
	]);
	const free = await play({}, true);
	check('without awaitComplete the chain runs on at once', free.before, [
		'play featureintro_intro',
		'effect after',
	]);
	const looping = await play({ awaitComplete: true, loop: true }, true);
	check('an awaited loop never holds', looping.before, ['play featureintro_intro', 'effect after']);
	const recorder = await play({ awaitComplete: true }, false);
	check('a recorder env without playCinematic never holds', recorder.before, ['effect after']);

	// 4. Show.durationMs → Delay.ms.
	console.log("4. a Show node's durationMs feeds a Delay the game's measured length");
	const durationDoc: FlowDoc = {
		version: 2,
		templateId: 'fixture',
		containers: CONTAINERS,
		graph: {
			nodes: [
				{ id: 'ev', kind: 'event', pos: { x: 0, y: 0 }, ref: 'go' },
				{ id: 'show', kind: 'showContainer', pos: { x: 1, y: 0 }, ref: 'intro' },
				{ id: 'wait', kind: 'delay', pos: { x: 2, y: 0 } },
			],
			exec: [
				{ from: { node: 'ev', pin: 'exec' }, to: { node: 'show', pin: 'exec' } },
				{ from: { node: 'show', pin: 'exec' }, to: { node: 'wait', pin: 'exec' } },
			],
			data: [{ from: { node: 'show', pin: 'durationMs' }, to: { node: 'wait', pin: 'ms' } }],
		},
	};
	const waits = async (measured?: number): Promise<string[]> => {
		const log: string[] = [];
		const deps: FlowV2EnvDeps = {
			...baseDeps(log),
			...(measured === undefined ? {} : { containerAnimationMs: () => measured }),
		};
		const ctx: RunContext = {
			vocab: VOCAB,
			library: { version: 2, functions: [] },
			env: createFlowV2Env(deps),
		};
		await runFlowEvent(durationDoc, ctx, 'go', {});
		return log;
	};
	check('the delay waits the measured 1500 ms', await waits(1500), ['wait 1500']);
	check('a recorder env without the measure waits 0', await waits(), ['wait 0']);

	console.log(failures ? `\n${failures} FAILED` : '\nall claims hold');
	if (failures) process.exit(1);
}

void main();
