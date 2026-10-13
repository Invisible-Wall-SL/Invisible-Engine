/**
 * Offline check that the Localization harvest reads a placed component's text in EVERY ratio, over
 * the REAL `harvestSceneText`.
 *
 *   pnpm exec tsx --tsconfig tsconfig.scripts.json localizationHarvest.fixture.ts
 *
 * A componentInstance renders its base `params` with `overrides[layoutType].params` merged on top
 * (`resolveLayoutInstanceParams`). A caption an author sets only for portrait is text the portrait
 * game shows, so it must be offered for translation. A `source` feed, though, is bound from the
 * BASE params only (`ComponentInstance`), so it suppresses `text` in every ratio or in none.
 */

import type { CinematicDoc, ComponentDef, LayoutDoc } from 'engine-layout';
import { normalizeDoc } from './src/lib/server/localization.ts';
import {
	harvestSceneText,
	harvestTimelineText,
	reconcileWithEditor,
} from './src/lib/server/localizationHarvest.ts';

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

const panel = {
	id: 'panel',
	name: 'Panel',
	version: 1,
	scope: 'project',
	category: 'ui',
	params: [{ key: 'title', kind: 'string', default: 'Default Title' }],
	root: {
		id: 'root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [{ id: 't', kind: 'text', x: 0, y: 0, text: '', paramBindings: { text: 'title' } }],
	},
} as unknown as ComponentDef;
const resolveDef = async (id: string): Promise<ComponentDef | undefined> =>
	id === 'panel' ? panel : undefined;

const instance = (id: string, rest: Record<string, unknown>) => ({
	id,
	kind: 'componentInstance',
	componentId: 'panel',
	x: 0,
	y: 0,
	...rest,
});
const harvest = async (nodes: Record<string, unknown>[]): Promise<string[]> => {
	const doc = { scenes: [{ id: 'base', name: 'Base', nodes }] } as unknown as LayoutDoc;
	return (await harvestSceneText(doc, resolveDef)).flatMap((s) => s.items.map((i) => i.key));
};

console.log('base params only (parity)');
check(
	'label, text, then the def’s text, in that order',
	await harvest([instance('a', { params: { label: 'BALANCE', text: 'Hello' } })]),
	['BALANCE', 'Hello', 'Default Title'],
);

console.log('per-ratio overrides');
check(
	'a label set only for portrait is harvested',
	await harvest([
		instance('a', {
			params: { label: 'BALANCE' },
			overrides: { portrait: { params: { label: 'CREDIT' } }, landscape: { x: 5 } },
		}),
	]),
	['BALANCE', 'Default Title', 'CREDIT'],
);
check(
	'a bound def text set only for portrait is harvested',
	await harvest([
		instance('a', { overrides: { portrait: { params: { title: 'Portrait Title' } } } }),
	]),
	['Default Title', 'Portrait Title'],
);
check(
	'a base `source` feed still suppresses a `text` only portrait patches in',
	await harvest([
		instance('a', {
			params: { source: 'balance' },
			overrides: { portrait: { params: { text: 'Fed anyway' } } },
		}),
	]),
	['Default Title'],
);
check(
	'a `source` patched into one ratio binds no feed, so that ratio’s `text` is harvested',
	await harvest([
		instance('a', {
			params: { text: 'Hello' },
			overrides: { portrait: { params: { source: 'balance', text: 'CREDIT' } } },
		}),
	]),
	['Hello', 'Default Title', 'CREDIT'],
);

// Rive plan §8: the keys a timeline switches a text node to get rows — in their own `timeline`
// section, only when the target node DECLARES them (the runtime shows nothing else), and never a
// key another section already owns (the node's own `text` stays the scene section's).
const sceneDoc = {
	version: 1,
	scenes: [
		{
			id: 'base',
			name: 'Base',
			nodes: [
				{
					id: 'n',
					kind: 'text',
					label: 'title',
					x: 0,
					y: 0,
					text: 'GOOD LUCK',
					switchKeys: ['BIG WIN', 'MEGA WIN', '777'],
				},
			],
		},
	],
} as unknown as LayoutDoc;
const sceneSections = await harvestSceneText(sceneDoc, async () => undefined);
check(
	'the scene section lists the node’s own text, not its switchKeys',
	sceneSections[0]?.items.map((i) => i.key),
	['GOOD LUCK'],
);
const timeline = (id: string, keys: string[], sceneId = 'base'): CinematicDoc =>
	({
		schemaVersion: 1,
		id,
		name: id,
		duration: 2,
		fps: 30,
		host: { kind: 'screen', sceneId },
		stage: {
			sceneId: null,
			cast: [
				{ actorId: 'a', kind: 'node', target: 'title', place: {} },
				{ actorId: 'r', rigFolder: 'bigwin', place: {} },
			],
		},
		tracks: [
			{
				id: 't',
				kind: 'text',
				actorId: 'a',
				mode: 'switchKey',
				keys: keys.map((key, i) => ({ time: i, key })),
			},
			{ id: 'x', kind: 'text', actorId: 'r', mode: 'switchKey', keys: [{ time: 0, key: 'RIG' }] },
		],
		markers: [],
	}) as CinematicDoc;
const owned = new Set(sceneSections.flatMap((sec) => sec.items.map((i) => i.key)));
const sections = harvestTimelineText(
	[
		timeline('intro', ['GOOD LUCK', 'BIG WIN', 'UNDECLARED']),
		timeline('outro', ['BIG WIN', 'MEGA WIN', '777']),
		timeline('elsewhere', ['MEGA WIN'], 'missing'),
	],
	sceneDoc,
	owned,
);
check(
	'timelines: declared keys only, deduped, owned keys / numbers / rig actors / other hosts skipped',
	sections.map((sec) => [sec.sceneId, sec.origin, sec.items.map((i) => `${i.key}@${i.label}`)]),
	[['__timelines', 'timeline', ['BIG WIN@intro — title', 'MEGA WIN@outro — title']]],
);
check('timelines: no cinematic ⇒ no section', harvestTimelineText([], sceneDoc), []);
const merged = reconcileWithEditor(normalizeDoc({ entries: [] }), [...sceneSections, ...sections]);
check(
	'reconcile: the node’s own text stays `editor`; timeline rows are `timeline`, and persist so',
	normalizeDoc({ entries: merged.entries }).entries.map((e) => `${e.key}:${e.origin}`),
	['GOOD LUCK:editor', 'BIG WIN:timeline', 'MEGA WIN:timeline'],
);

console.log(failures === 0 ? '\nAll assertions passed.' : `\n${failures} assertion(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
