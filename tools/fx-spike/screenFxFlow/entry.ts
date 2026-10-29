/**
 * `/flow-v2` as `screenFxFlow.mjs` plays it: the real `+page.svelte` mounted outside SvelteKit,
 * with `$app/*` stubbed (`fxPage/app*.ts`) and every request answered here, in memory. The flow
 * it opens is the lines starter, or `localStorage['screenFxFlow.doc']` when the driver put one
 * there; the project's compiled shader effects are the reference graphs;
 * `localStorage['screenFxFlow.cueOn']` says whether Game Settings → Screen FX plays a screen
 * transition on the `transition` cue.
 *
 * A save (`POST /api/flow-v2/save`) answers as the endpoint does, and keeps the doc it was sent in
 * `window.flowPage.saved`. Every other request is a 404 the page already copes with.
 */
import { mount } from 'svelte';
import { freshDrivenSeedDoc, type FlowDoc } from '@fxroot/packages/engine-flow-v2/index';
import { getFullSceneSet, type LayoutDoc } from '@fxroot/packages/engine-layout/src/lib/index';
import { REFERENCE_GRAPHS, compileShaderEffect } from '@fxroot/packages/engine-shadergraph/index';
import { TOOLS } from '@fxroot/apps/launcher-api/src/lib/roles';
import { soundOptionsFor } from '@fxroot/apps/launcher-api/src/lib/soundOptions';
import { collectElementFxTargets } from '@fxroot/apps/launcher-api/src/lib/elementFxTargets';
import DialogHost from '@fxroot/apps/launcher-api/src/lib/DialogHost.svelte';
import Page from '@fxroot/apps/launcher-api/src/routes/(app)/flow-v2/+page.svelte';

const STORED = 'screenFxFlow.doc';
const stored = localStorage.getItem(STORED);
const doc: FlowDoc = stored ? (JSON.parse(stored) as FlowDoc) : freshDrivenSeedDoc('lines');
const layout = getFullSceneSet('lines') as LayoutDoc;

const customElementFx = REFERENCE_GRAPHS.flatMap((graph) => {
	const result = compileShaderEffect(graph);
	return result.ok ? [result.effect] : [];
});

const saved: unknown[] = [];
let etags = 0;
const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
	const url = new URL(typeof input === 'string' ? input : String(input), location.href);
	const method = init?.method ?? 'GET';
	if (url.protocol === 'file:' && !url.pathname.startsWith('/api')) return realFetch(input, init);
	if (method === 'POST' && url.pathname === '/api/flow-v2/save') {
		saved.push((JSON.parse(String(init?.body)) as { doc: unknown }).doc);
		return json({ ok: true, etag: `"e${++etags}"` });
	}
	if (url.pathname === '/api/lease') return json({ held: true, heartbeatMs: 600_000 });
	return json({ message: `screenFxFlow: nothing answers ${method} ${url.pathname}` }, 404);
};

Object.assign(window, { flowPage: { saved } });

mount(DialogHost, { target: document.body });
mount(Page, {
	target: document.body,
	props: {
		data: {
			clientKey: 'client',
			projectKey: 'project',
			tools: [TOOLS.flow, TOOLS.shaders],
			doc,
			docEtag: '"e0"',
			seeded: !stored,
			library: null,
			libraryEtag: null,
			sceneNames: Object.fromEntries(layout.scenes.map((s) => [s.id, s.name ?? s.id])),
			sceneCues: [],
			fxTargets: collectElementFxTargets(layout.scenes),
			customFxKinds: customElementFx.map((e) => e.spec.kind),
			customElementFx,
			shaderGraphs: customElementFx.map((e) => ({
				id: e.spec.kind.slice('custom:'.length),
				shared: false,
			})),
			transitionCueOn: localStorage.getItem('screenFxFlow.cueOn') === '1',
			containerEvents: {},
			instances: {},
			spawnLayers: {},
			containerTaps: {},
			armedTaps: {},
			gameModes: [],
			outcome: 'rgs',
			wrongKind: null,
			symbols: [],
			soundOptions: soundOptionsFor(null),
			cinematicOptions: [],
			timelineIssues: {},
		},
	},
});
