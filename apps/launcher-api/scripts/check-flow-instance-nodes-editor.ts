/**
 * Flow instance nodes in the editors (Rive plan §6.2, Phase 7b):
 *   pnpm --filter launcher-api check:flow-instance-nodes-editor
 *
 *  1. the palette's Components section groups every named placement per screen, in the doc's
 *     container order, instances by name;
 *  2. a wire to a pin the component no longer has is a STALE pin the node renders red (so the wire
 *     stays visible); a clean node has none; the stale caption reads the pin form;
 *  3. every jump between Flow and the Scene Editor carries the project pin, the Flow page reads
 *     its deep link, and `nodeNamingInstance` finds a top-level or grouped node;
 *  4. the node factory builds both kinds from a palette ref; the wait-for-state setter edits the
 *     layer and state;
 *  5. the Flow Preview → stage bridge: one message shape, one channel name per project, no bridge
 *     without `BroadcastChannel`, and a post reaches a subscriber on the same project only;
 *  6. the Svelte wiring this gate cannot mount, source-scanned: the palette drags both kinds, the
 *     node paints stale pins, the inspector's pickers, the page's deep link + re-projection +
 *     double-click, the editor's *Show in Flow* (button + context menu, closed menu captures
 *     nothing), the State Machine panel's subscription, the preview's toggle, the endpoint's gate.
 */
import { readFileSync } from 'node:fs';
import type { FlowDoc, FlowInstanceDecl, Graph, Pin } from 'engine-flow-v2';
import type { ComponentDef } from 'engine-layout';

const U = await import('../src/lib/flowInstanceUi.ts');
const P = await import('../src/lib/flowV2Projection.ts');
const B = await import('../src/lib/flowStageBridge.ts');
const G = await import('../src/routes/(app)/flow-v2/graphOps.ts');
const { deriveInstancePins, instanceNodeRef } =
	await import('../../../packages/engine-flow-v2/src/instanceNodes.ts');

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
const source = (path: string): string =>
	readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const has = (text: string, lines: string[]): boolean[] => lines.map((l) => text.includes(l));

// ---- fixtures ----------------------------------------------------------------------------------

const decl = (
	instance: string,
	container: string,
	name: string,
	extra: Partial<FlowInstanceDecl> = {},
): FlowInstanceDecl => ({
	instance,
	container,
	name,
	componentId: 'banner',
	version: 2,
	interface: {
		inputs: [
			{ id: 'win', kind: 'trigger' },
			{ id: 'amount', kind: 'number' },
		],
		events: [{ id: 'done' }],
		values: [{ id: 'main.state', layer: 'main', states: ['idle', 'win', 'exit'] }],
	},
	...extra,
});
const INSTANCES: Record<string, FlowInstanceDecl> = {
	c_z: decl('c_z', 'basegame', 'zebra'),
	c_a: decl('c_a', 'basegame', 'apple'),
	c_h: decl('c_h', 'hud', 'hudBanner'),
	c_x: decl('c_x', 'gone', 'orphan'),
};
const at = { x: 0, y: 0 };

// ---- 1. palette groups -------------------------------------------------------------------------
{
	const groups = U.paletteInstanceGroups(INSTANCES, ['hud', 'basegame'], (c) => `Screen ${c}`);
	eq(
		'1. per screen in container order (an unknown screen last), instances by name',
		groups.map((g) => [g.container, g.label, g.instances.map((i) => i.name)]),
		[
			['hud', 'Screen hud', ['hudBanner']],
			['basegame', 'Screen basegame', ['apple', 'zebra']],
			['gone', 'Screen gone', ['orphan']],
		],
	);
	eq(
		'1. no instances ⇒ no groups',
		U.paletteInstanceGroups({}, ['basegame'], (c) => c),
		[],
	);
}

// ---- 2. stale pins -----------------------------------------------------------------------------
{
	const pins: Pin[] = deriveInstancePins(INSTANCES.c_a);
	const graph: Graph = {
		nodes: [],
		exec: [
			{ from: { node: 'n1', pin: 'event:gone' }, to: { node: 'p', pin: 'exec' } },
			{ from: { node: 'n1', pin: 'event:done' }, to: { node: 'q', pin: 'exec' } },
			{ from: { node: 'e', pin: 'exec' }, to: { node: 'n1', pin: 'fire:lost' } },
			{ from: { node: 'e', pin: 'exec' }, to: { node: 'n1', pin: 'fire:win' } },
			{ from: { node: 'n1', pin: 'event:gone' }, to: { node: 'r', pin: 'exec' } },
		],
		data: [
			{ from: { node: 'e', pin: 'x' }, to: { node: 'n1', pin: 'in:title' } },
			{ from: { node: 'n1', pin: 'value:other.state' }, to: { node: 'q', pin: 'a' } },
			{ from: { node: 'n1', pin: 'value:main.state' }, to: { node: 'q', pin: 'b' } },
		],
	};
	eq(
		'2. the pins wires name but the node lacks, each once, by direction',
		U.stalePinsOf(graph, 'n1', pins),
		{
			in: [
				{ id: 'fire:lost', kind: 'exec' },
				{ id: 'in:title', kind: 'data' },
			],
			out: [
				{ id: 'event:gone', kind: 'exec' },
				{ id: 'value:other.state', kind: 'data' },
			],
		},
	);
	eq('2. a clean node has none', U.stalePinsOf(graph, 'n9', pins), { in: [], out: [] });
	eq(
		'2. the stale caption reads the pin form',
		['fire:win', 'in:title', 'event:done', 'event:done.amount', 'value:main.state', 'exec'].map(
			U.stalePinLabel,
		),
		['▸ win', 'title', 'done', 'done.amount', 'main.state', 'exec'],
	);
}

// ---- 3. jumps ----------------------------------------------------------------------------------
{
	eq(
		'3. every jump carries the project pin',
		[U.flowHrefForInstance('proj', 'c_a'), U.editorHrefForComponent('proj', 'banner')],
		['/flow-v2?project=proj&instance=c_a', '/editor?project=proj&component=banner'],
	);
	const clean = { what: 'flow', status: 'saved' as const, dirty: false };
	eq(
		'3. a hop is refused from anything but clean, idle docs, naming each pill’s own way out; a read-only tab with a clean doc may leave',
		[
			U.hopRefusal(clean),
			U.hopRefusal({ ...clean, status: 'idle' }),
			U.hopRefusal({ ...clean, readOnly: true }),
			U.hopRefusal({ ...clean, readOnly: true, dirty: true })?.includes('Take over'),
			U.hopRefusal({ ...clean, status: 'saving', dirty: true })?.startsWith(
				'Still saving the flow',
			),
			U.hopRefusal({ ...clean, dirty: true })?.includes('not saved yet'),
			U.hopRefusal({ ...clean, status: 'conflict', dirty: true })?.includes(
				'Reload theirs or Overwrite',
			),
			U.hopRefusal({ ...clean, status: 'error', dirty: true })?.includes('Retry in its save pill'),
			U.hopRefusal({ ...clean, status: 'error', dirty: true, manual: 'save' })?.includes(
				'press Save',
			),
			U.hopRefusal({ ...clean, status: 'scope-mismatch' })?.includes('another project'),
			U.hopRefusal({ ...clean, dirty: true, manual: 'cross-type' })?.includes(
				'Save as, or Discard',
			),
			U.hopRefusal({ ...clean, dirty: true, manual: 'drift' })?.includes('Reload (the banner)'),
			U.hopRefusal({ ...clean, dirty: true, manual: 'save' })?.includes('press Save'),
			U.hopRefusal(clean, { what: 'function library', status: 'saving', dirty: true })?.includes(
				'function library',
			),
			U.hopRefusal(clean, { what: 'function library', status: 'conflict', dirty: true })?.includes(
				'function library',
			),
		],
		[null, null, null, true, true, true, true, true, true, true, true, true, true, true, true],
	);
	eq(
		'3. the Flow page reads its deep link',
		[
			U.flowDeepLink(new URLSearchParams('project=proj&instance=c_a')),
			U.flowDeepLink(new URLSearchParams('node=n1')),
			U.flowDeepLink(new URLSearchParams('instance=%20')),
		],
		[{ instance: 'c_a' }, {}, {}],
	);
	const graph: Graph = {
		nodes: [
			{ id: 'n1', kind: 'componentInstance', pos: at, container: 'basegame', instance: 'c_z' },
			{
				id: 'g',
				kind: 'group',
				pos: at,
				label: 'g',
				boundary: [],
				body: {
					nodes: [
						{
							id: 'n2',
							kind: 'componentInstance',
							pos: at,
							container: 'basegame',
							instance: 'c_a',
						},
					],
					exec: [],
					data: [],
				},
			},
		],
		exec: [],
		data: [],
	};
	eq(
		'3. the node naming a placement: top-level, grouped (with its group), none',
		[
			U.nodeNamingInstance(graph, 'c_z'),
			U.nodeNamingInstance(graph, 'c_a'),
			U.nodeNamingInstance(graph, 'c_h'),
		],
		[{ node: 'n1' }, { node: 'n2', group: 'g' }, undefined],
	);
}

// ---- 4. the node factory and the wait setter ---------------------------------------------------
{
	const ref = instanceNodeRef('basegame', 'c_a');
	eq(
		'4. both kinds build from the palette ref',
		[G.makeNode('componentInstance', 'i1', at, ref), G.makeNode('waitForState', 'w1', at, ref)],
		[
			{ id: 'i1', kind: 'componentInstance', pos: at, container: 'basegame', instance: 'c_a' },
			{
				id: 'w1',
				kind: 'waitForState',
				pos: at,
				container: 'basegame',
				instance: 'c_a',
				layer: '',
				state: '',
			},
		],
	);
	const doc: FlowDoc = {
		version: 2,
		templateId: 't',
		containers: [],
		graph: { nodes: [G.makeNode('waitForState', 'w1', at, ref)], exec: [], data: [] },
	};
	const withLayer = G.setWaitForStateFields(doc, 'w1', { layer: 'main', state: '' });
	const withState = G.setWaitForStateFields(withLayer, 'w1', { state: 'win' });
	eq(
		'4. the wait setter edits the layer and the state, nothing else',
		[withLayer.graph.nodes[0], withState.graph.nodes[0]],
		[
			{
				id: 'w1',
				kind: 'waitForState',
				pos: at,
				container: 'basegame',
				instance: 'c_a',
				layer: 'main',
				state: '',
			},
			{
				id: 'w1',
				kind: 'waitForState',
				pos: at,
				container: 'basegame',
				instance: 'c_a',
				layer: 'main',
				state: 'win',
			},
		],
	);
}

// ---- 5. the stage bridge -----------------------------------------------------------------------
{
	eq('5. one channel per project', B.flowStageChannelName('proj'), 'ie-flow-stage:proj');
	eq(
		'5. the message shape',
		[
			B.isFlowStageMessage({
				v: 1,
				componentId: 'banner',
				instance: 'c_a',
				op: 'fire',
				name: 'win',
			}),
			B.isFlowStageMessage({
				v: 1,
				componentId: 'banner',
				instance: 'c_a',
				op: 'set',
				name: 'amount',
				value: 3,
			}),
			B.isFlowStageMessage({ v: 1, componentId: 'banner', instance: 'c_a', op: 'wait', name: 'x' }),
			B.isFlowStageMessage({
				v: 2,
				componentId: 'banner',
				instance: 'c_a',
				op: 'fire',
				name: 'win',
			}),
			B.isFlowStageMessage({
				v: 1,
				componentId: 'banner',
				instance: 'c_a',
				op: 'set',
				name: 'a',
				value: {},
			}),
			B.isFlowStageMessage(null),
		],
		[true, true, false, false, false, false],
	);
	const nativeChannel = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
	delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
	eq('5. no BroadcastChannel ⇒ no bridge', B.openFlowStageChannel('proj'), null);
	// A stub BroadcastChannel: every instance with the same name shares one bus.
	const buses = new Map<string, Set<(e: MessageEvent) => void>>();
	class StubChannel {
		private readonly listeners: Set<(e: MessageEvent) => void>;
		constructor(public readonly name: string) {
			let set = buses.get(name);
			if (!set) buses.set(name, (set = new Set()));
			this.listeners = set;
		}
		postMessage(data: unknown): void {
			for (const l of [...this.listeners]) l({ data } as MessageEvent);
		}
		addEventListener(_type: string, l: (e: MessageEvent) => void): void {
			this.listeners.add(l);
		}
		removeEventListener(_type: string, l: (e: MessageEvent) => void): void {
			this.listeners.delete(l);
		}
		close(): void {}
	}
	(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = StubChannel;
	const got: string[] = [];
	const a = B.openFlowStageChannel('proj')!;
	const other = B.openFlowStageChannel('other')!;
	const unsubscribe = a.subscribe((m) => got.push(`${m.op} ${m.name}`));
	other.subscribe((m) => got.push(`other ${m.op}`));
	a.post({ v: 1, componentId: 'banner', instance: 'c_a', op: 'fire', name: 'win' });
	a.post({ v: 1, componentId: 'banner', instance: 'c_a', op: 'set', name: 'amount', value: 2 });
	new StubChannel('ie-flow-stage:proj').postMessage({ junk: true });
	unsubscribe();
	a.post({ v: 1, componentId: 'banner', instance: 'c_a', op: 'fire', name: 'late' });
	eq(
		'5. a post reaches a subscriber on the same project only; junk is dropped; unsubscribe stops it',
		got,
		['fire win', 'set amount'],
	);
	(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = nativeChannel;
}

// ---- 6. wiring guards --------------------------------------------------------------------------
{
	const palette = source('src/routes/(app)/flow-v2/AddNodePalette.svelte');
	eq(
		'6. the palette drags a componentInstance and a waitForState per named placement, lit when sent from the editor',
		has(palette, [
			"onDragStart(ev, 'componentInstance', instanceNodeRef(g.container, i.instance))",
			"onDragStart(ev, 'waitForState', instanceNodeRef(g.container, i.instance))",
			'class:lit={i.instance === highlightInstance}',
			"(key === 'components' && !!highlightInstance)",
		]),
		[true, true, true, true],
	);
	const node = source('src/routes/(app)/flow-v2/FlowV2Node.svelte');
	eq(
		'6. the node paints stale pins with a handle, and names the placement',
		has(node, [
			"{#each d.stalePins?.in ?? [] as stale (stale.id + ':stale-in')}",
			"{#each d.stalePins?.out ?? [] as stale (stale.id + ':stale-out')}",
			'id={stale.id}',
			"case 'componentInstance': {",
			"componentInstance: '#34d399'",
		]),
		[true, true, true, true, true],
	);
	const inspector = source('src/routes/(app)/flow-v2/NodeInspector.svelte');
	eq(
		'6. the inspector picks a wait’s layer and state, and links the component with the project pinned',
		has(inspector, [
			"setWaitForStateFields(doc, node.id, { layer: e.currentTarget.value, state: '' })",
			'setWaitForStateFields(doc, node.id, { state: e.currentTarget.value })',
			'onclick={() => oneditcomponent?.(node.instance)}',
		]),
		[true, true, true],
	);
	const page = source('src/routes/(app)/flow-v2/+page.svelte');
	eq(
		'6. the page opens its deep link, re-projects when shown again, double-clicks to the component after saving, paints broken wires',
		has(page, [
			'openDeepLink();',
			"document.addEventListener('visibilitychange', onVisible);",
			'`/api/flow-v2/instances?project=${encodeURIComponent(data.projectKey)}`',
			'if (body.projectKey !== data.projectKey || !body.instances) return;',
			'void editComponentOf(model.instance);',
			'if (await refuseHop()) return;\n\t\twindow.location.assign(href);',
			"{ what: 'function library', status: libraryState.status, dirty: libraryState.dirty },",
			'if (await refuseHop()) return;\n\t\tconst ok = await askConfirm({',
			'if (wasReadOnly && !readOnly && saveState.dirty) saveState.rearmAutosave();',
			'if (ok) await hopTo(editorHrefForComponent(data.projectKey, decl.componentId));',
			'oneditcomponent={(instanceId) => void editComponentOf(instanceId)}',
			'.filter((issue) => !touchesUnpinned(issue)),',
			"n.kind === 'componentInstance' && !instances[n.instance]?.unpinned",
			'instancesError = `Could not load the component pins (HTTP ${res.status}).`;',
			'onclick={() => void refreshInstances()}',
			'parseInstanceNodeRef(ref).instance === highlightInstance',
			'if (names && !namedInstance) void refreshInstances();',
			"class: broken ? 'v2-exec v2-bad' : 'v2-exec',",
			'stalePinsOf(activeGraph, n.id, graphPins.pins.get(n.id) ?? [])',
			'{instanceGroups}',
			'<PreviewPanelV2\n\t\t\t\t\t{doc}\n\t\t\t\t\t{library}\n\t\t\t\t\t{vocab}\n\t\t\t\t\t{instances}\n\t\t\t\t\t{spawnLayers}\n\t\t\t\t\tprojectKey={data.projectKey}\n\t\t\t\t/>',
		]),
		[
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
			true,
		],
	);
	const preview = source('src/routes/(app)/flow-v2/PreviewPanelV2.svelte');
	eq(
		'6. the preview posts fired triggers and set inputs only when the author ticks it, each at its timeline time, and clears them on a new run or the tick going off',
		has(preview, [
			'if (driveStage && result) sendToStage(result.timeline);',
			"if (e.kind !== 'instance' || e.op === 'wait') return [];",
			'<input type="checkbox" bind:checked={driveStage} />',
			'Math.max(0, at),',
			'if (!driveStage) clearStagePosts();',
			'onDestroy(clearStagePosts);',
		]),
		[true, true, true, true, true, true],
	);
	const iface = { inputs: [], events: [], values: [] };
	eq(
		'6. a projection read without the pinned snapshots marks a placement pinned below latest as unpinned, with the latest interface standing in, never lost',
		P.unpinnedProjection(
			{
				a: {
					container: 'c',
					instance: 'a',
					name: 'A',
					componentId: 'x',
					version: 1,
					missing: 'version',
					interface: iface,
				},
				b: {
					container: 'c',
					instance: 'b',
					name: 'B',
					componentId: 'y',
					missing: 'def',
					interface: iface,
				},
				c: {
					container: 'c',
					instance: 'c',
					name: 'C',
					componentId: 'z',
					version: 2,
					interface: iface,
				},
			},
			(id) =>
				id === 'x'
					? ({
							id: 'x',
							name: 'X',
							inputs: [{ id: 'lit', kind: 'bool' }],
						} as unknown as ComponentDef)
					: undefined,
		),
		{
			a: {
				container: 'c',
				instance: 'a',
				name: 'A',
				componentId: 'x',
				version: 1,
				interface: { inputs: [{ id: 'lit', kind: 'bool' }], events: [], values: [] },
				unpinned: true,
			},
			b: {
				container: 'c',
				instance: 'b',
				name: 'B',
				componentId: 'y',
				missing: 'def',
				interface: iface,
			},
			c: {
				container: 'c',
				instance: 'c',
				name: 'C',
				componentId: 'z',
				version: 2,
				interface: iface,
			},
		},
	);
	eq(
		'6. the loader takes the unpinned projection for a flow naming no instance; the node and inspector say the pins are loading',
		has(source('src/routes/(app)/flow-v2/+page.server.ts'), [
			'const instances = docNamesInstance(doc)\n\t\t? projected\n\t\t: unpinnedProjection(projected, (id) => components.find((def) => def.id === id));',
		]).concat(
			has(source('src/routes/(app)/flow-v2/FlowV2Node.svelte'), [
				'if (decl.unpinned) return `${decl.name} · ${at} · loading pins…`;',
			]),
			has(inspector, ['{#if instanceDecl.unpinned}']),
		),
		[true, true, true],
	);
	const props = source('src/routes/(app)/editor/EditorProperties.svelte');
	const canvas = source('src/routes/(app)/editor/EditorCanvas.svelte');
	const editor = source('src/routes/(app)/editor/+page.svelte');
	eq(
		'6. the editor offers Show in Flow from Properties and a right-click menu that is rendered only while open',
		has(props, ['onclick={() => onShowInFlow?.(node.id)}', '↗ Show in Flow']).concat(
			has(canvas, [
				'oncontextmenu={(e) => e.preventDefault()}',
				'if (e.button === 2) openInstanceMenuAt(e);',
				'{#if instanceMenu}',
				'if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;',
				"window.addEventListener('mousedown', closeInstanceMenu);",
				'const onKey = (): void => closeInstanceMenu();',
			]),
			has(editor, [
				"await askMessage({ title: 'Not yet', message: why });",
				"manual: crossTypeLoaded\n\t\t\t\t? 'cross-type'\n\t\t\t\t: projectDrift\n\t\t\t\t\t? 'drift'\n\t\t\t\t\t: saveState.status === 'error'\n\t\t\t\t\t\t? 'save'\n\t\t\t\t\t\t: undefined,",
				'if (wasReadOnly && !readOnly && saveState.dirty && !crossTypeLoaded && !projectDrift)',
				'window.location.assign(flowHrefForInstance(loadedProjectKey, nodeId));',
				'onShowInFlow={animating ? undefined : (node) => showInFlow(node.id)}',
				'onShowInFlow={showInFlow}',
			]),
		),
		[true, true, true, true, true, true, true, true, true, true, true, true, true, true],
	);
	const panel = source('src/routes/(app)/editor/EditorStateMachinePanel.svelte');
	eq(
		'6. the State Machine panel plays the bridge through its own fire / setPreviewInput',
		has(panel, [
			'const channel = openFlowStageChannel(projectKey);',
			'if (m.componentId !== id) return;',
			'if (!id || !active) return;',
			"if (m.op === 'fire') fire(m.name);",
			'setPreviewInput(m.name, m.value);',
		]),
		[true, true, true, true, true],
	);
	const endpoint = source('src/routes/api/flow-v2/instances/+server.ts');
	eq(
		'6. the instances endpoint gates on the flow tool and syncs every screen in',
		has(endpoint, [
			"tool: 'flow',",
			'syncFlowContainers(doc, scenes);',
			'withPlacedComponentVersions(projectKey, scenes, components)',
			'throw error(409, `This tab is on "${pinned}" but your active project is "${projectKey}".`);',
		]),
		[true, true, true, true],
	);
}

console.log(`flow instance nodes editor: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
