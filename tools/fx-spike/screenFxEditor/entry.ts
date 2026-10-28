/**
 * The Scene Editor as `screenFxEditor.mjs` plays it: the real `/editor` `+page.svelte` mounted
 * outside SvelteKit, with `$app/*` stubbed (`fxPage/app*.ts`) and every request answered here, in
 * memory. The layout doc it opens is the lines scene set, or `localStorage['screenFxEditor.doc']`
 * when the driver put one there (a reopen: the saved doc, normalized by the real server reader).
 * The project's compiled shader effects are the reference graphs, plus one compiled with a cost.
 *
 * A save (`POST ?/save`) answers as the action does, and keeps the doc it was sent in
 * `window.editorPage.saved`. Every other request is a 404 the page already copes with.
 */
import { mount } from 'svelte';
import {
	DEFAULT_LAYOUT_PROFILE,
	getFullSceneSet,
	type LayoutDoc,
} from '@fxroot/packages/engine-layout/src/lib/index';
import { REFERENCE_GRAPHS, compileShaderEffect } from '@fxroot/packages/engine-shadergraph/index';
import { TOOLS } from '@fxroot/apps/launcher-api/src/lib/roles';
import { soundOptionsFor } from '@fxroot/apps/launcher-api/src/lib/soundOptions';
import DialogHost from '@fxroot/apps/launcher-api/src/lib/DialogHost.svelte';
import Page from '@fxroot/apps/launcher-api/src/routes/(app)/editor/+page.svelte';

const STORED = 'screenFxEditor.doc';
const reference = getFullSceneSet('lines') as LayoutDoc;
const stored = localStorage.getItem(STORED);
const doc: LayoutDoc = stored
	? (JSON.parse(stored) as LayoutDoc)
	: { ...reference, projectKey: 'project', updatedAt: '2026-10-28T00:00:00.000Z' };

/** The reference graphs as the project compiled them; Ripple compiled with its cost (`madeFor`). */
const customElementFx = REFERENCE_GRAPHS.flatMap((graph) => {
	const result = compileShaderEffect(
		graph.id === 'ripple' ? { ...graph, madeFor: 'particles' } : graph,
	);
	return result.ok ? [result.effect] : [];
});

const requests: string[] = [];
const saved: unknown[] = [];
let etags = 0;

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** A form action's answer, as SvelteKit serializes it (`devalue`'s flat form). */
const actionAnswer = (data: Record<string, unknown>): Response => {
	const keys = Object.keys(data);
	const root = Object.fromEntries(keys.map((k, i) => [k, i + 1]));
	return json({
		type: 'success',
		status: 200,
		data: JSON.stringify([root, ...keys.map((k) => data[k])]),
	});
};

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
	const url = new URL(typeof input === 'string' ? input : String(input), location.href);
	const method = init?.method ?? 'GET';
	const local =
		url.protocol === 'file:' && !url.pathname.startsWith('/api') && !url.search.startsWith('?/');
	if (local && !url.pathname.startsWith('/rig')) return realFetch(input, init);
	requests.push(`${method} ${url.pathname}${url.search}`);
	if (method === 'POST' && url.search.startsWith('?/save')) {
		const form = init?.body as FormData;
		saved.push(JSON.parse(String(form.get('doc'))));
		return actionAnswer({
			action: 'save',
			saved: true,
			updatedAt: new Date().toISOString(),
			etag: `"e${++etags}"`,
			warnings: [],
		});
	}
	if (url.pathname === '/api/lease') return json({ held: true, heartbeatMs: 600_000 });
	return json({ message: `screenFxEditor: nothing answers ${method} ${url.pathname}` }, 404);
};

Object.assign(window, { editorPage: { requests, saved, opened: doc } });

mount(DialogHost, { target: document.body });
mount(Page, {
	target: document.body,
	props: {
		data: {
			clientKey: 'client',
			projectKey: 'project',
			projectKind: 'lines',
			tools: [TOOLS.editor, TOOLS.shaders],
			doc,
			docEtag: '"e0"',
			assets: { atlases: [], spines: [], sheets: [] },
			template: undefined,
			templateEtag: null,
			warnings: [],
			gameName: 'Screen FX demo',
			components: [],
			componentEtags: {},
			canPublishShared: false,
			flowVariables: [],
			cueLists: { ...soundOptionsFor(null), auditions: {}, flowCues: [] },
			componentDefaults: {},
			customKinds: [],
			customElementFx,
			symbolDefaults: null,
			symbolsDoc: null,
			referenceMainSizes: reference.mainSizesMap,
			inheritedLayoutProfile: DEFAULT_LAYOUT_PROFILE,
			inheritedLayoutSource: 'default',
			gridDimensions: null,
			winTiers: null,
			expansionMaxRows: null,
			respinModes: [],
			spinsModes: [],
			modeGridDimensions: {},
			noJackpotTiers: false,
			coinBoard: false,
			addOns: { holdAndWin: false, potsOverlay: false, expandingSymbol: false },
			potIds: null,
			repeaterSources: {},
			gameModeLabels: {},
		},
	},
});
