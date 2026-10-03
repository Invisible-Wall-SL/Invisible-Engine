/**
 * Offline check that the Localization harvest reads a placed component's text in EVERY ratio, over
 * the REAL `harvestSceneText`.
 *
 *   pnpm exec tsx --tsconfig tsconfig.scripts.json localizationHarvest.fixture.ts
 *
 * A componentInstance renders its base `params` with `overrides[layoutType].params` merged on top
 * (`resolveLayoutInstanceParams`). A caption an author sets only for portrait is text the portrait
 * game shows, so it must be offered for translation; and because the merge is what renders, a
 * `source` feed bound in the base still suppresses a `text` that only one ratio patches in.
 */

import type { ComponentDef, LayoutDoc } from 'engine-layout';
import { harvestSceneText } from './src/lib/server/localizationHarvest.ts';

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
	'a feed bound only for portrait leaves the base `text` harvested',
	await harvest([
		instance('a', {
			params: { text: 'Hello' },
			overrides: { portrait: { params: { source: 'balance' } } },
		}),
	]),
	['Hello', 'Default Title'],
);

console.log(failures === 0 ? '\nAll assertions passed.' : `\n${failures} assertion(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
