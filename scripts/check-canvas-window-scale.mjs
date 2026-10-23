// Offline gate: a `canvas` screen ticked "Scale with the window" (`Scene.scaleWithWindow`) draws in
// game what the Scene Editor shows, on any window, and an unticked one draws as before.
//
//   pnpm check:canvas-window-scale
//
// THE BUG (reported on `commonoverlayproject`, 2026-10-23): the Hold and Win feature intro ended
// differently on two computers. Its screen is `canvas` space, which the game draws one window pixel
// per unit while the editor frames it at the 1920×1080 design box. Its curtains (a 20 px wide rect at
// each window edge, keyed to ×60) cover 1200 px each: the whole of a 1920 px window, but a window
// about 2850 px wide kept a strip of reels open in the middle, and the rockets keyed to fly 2123 px
// right ended on screen instead of past the edge. The reels, in `game` space, scaled to the window
// as usual. Ticked, the screen scales by the fit the design box gets in the window and its content
// reads a window shrunk by the same factor (`scaleLayout`), so each node stays pinned to its window
// edge while its offsets, size and timeline keys scale.
//
// HOW: the REAL `LayoutScene.svelte`, `MainContainer.svelte` and `CanvasSizeRectangle.svelte` are
// compiled by Svelte's compiler and mounted through its client runtime on a DOM shim, inside the
// REAL `createLayout` (its window read from this harness) and the real layout profile. What draws is
// a stand-in: pixi-svelte's `Container` / `Rectangle` record their transforms, so each rectangle's
// window box is folded from the actual container chain. `<LayoutNodeView>` is a stand-in that places
// a node as the real one does: the node fold over the timeline's node actor (as `<BoardDrive>` runs
// it), then `anchoredPosition` against the window its layout context reports. It also registers a
// tap dim with the REAL tap portal, as `<ComponentInstance>` does.

import { readFileSync, realpathSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Element } from './lib/svelte-dom-shim.mjs';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
	const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type;
	if (type === 'ExperimentalWarning' && String(warning).includes('stripTypeScriptTypes')) return;
	emitWarning(warning, ...rest);
};

const repoFile = (path) => new URL(`../${path}`, import.meta.url).href;
const ROOT = repoFile('');
const LAYOUT_SCENE = repoFile('packages/engine-layout/src/lib/LayoutScene.svelte');
const MAIN_CONTAINER = repoFile('packages/components-layout/src/components/MainContainer.svelte');
const CANVAS_RECT = repoFile(
	'packages/components-layout/src/components/CanvasSizeRectangle.svelte',
);
const UTILS_LAYOUT = repoFile('packages/utils-layout/index.ts');
const LAYOUT_PROFILE = repoFile('packages/constants-shared/layoutProfile.ts');
const ELEMENT_FX = repoFile('packages/constants-shared/elementFx.ts');
const RESOLVE_TRANSFORM = repoFile('packages/engine-layout/src/lib/resolveTransform.ts');
const VALUE_BINDINGS = repoFile('packages/engine-layout/src/lib/valueBindings.ts');
const CINEMATIC_NODES = repoFile('packages/engine-layout/src/lib/cinematicNodes.ts');
const NODE_CONTEXT = repoFile('packages/engine-layout/src/lib/cinematicNodeContext.ts');
const TAP_PORTAL = repoFile('packages/engine-layout/src/lib/tapPortalContext.ts');
const ENGINE_CINEMATIC = repoFile('packages/engine-cinematic/index.ts');

const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const harness = 'globalThis.__canvasScaleHarness';
const { compile } = createRequire(import.meta.url)('svelte/compiler');
const component = (name, source) =>
	moduleUrl(compile(source, { filename: `${name}.svelte`, generate: 'client' }).js.code);

// pixi-svelte's containers: each records its transform (live, through the props' getters) and its
// parent, so a rectangle's window box is folded from the chain it actually mounted in.
const recordingContainer = component(
	'container',
	`<script>
		import { getContext, setContext } from 'svelte';
		const props = $props();
		const point = (value, fallback) =>
			typeof value === 'number'
				? { x: value, y: value }
				: { x: value?.x ?? fallback, y: value?.y ?? fallback };
		const self = {
			parent: getContext('rec:parent'),
			get x() { return props.x ?? 0; },
			get y() { return props.y ?? 0; },
			get scale() { return point(props.scale, 1); },
			get pivot() { return point(props.pivot, 0); },
		};
		setContext('rec:parent', self);
	</script>
	{@render props.children?.()}`,
);
const recordingRectangle = component(
	'rectangle',
	`<script>
		import { getContext, onMount } from 'svelte';
		const props = $props();
		const entry = {
			parent: getContext('rec:parent'),
			get label() { return props.label; },
			get x() { return props.x ?? 0; },
			get y() { return props.y ?? 0; },
			get width() { return props.width ?? 0; },
			get height() { return props.height ?? 0; },
			get anchor() { return props.anchor ?? 0; },
		};
		onMount(() => {
			${harness}.rects.add(entry);
			return () => ${harness}.rects.delete(entry);
		});
	</script>`,
);
const PIXI_SVELTE = moduleUrl(`
	import { getContext } from 'svelte';
	export { default as Container } from ${JSON.stringify(recordingContainer)};
	export { default as Rectangle } from ${JSON.stringify(recordingRectangle)};
	export const Text = () => {};
	export const Anchor = () => {};
	export const registerAnchor = () => () => {};
	export const getContextParent = () => ({ parent: getContext('rec:parent') });
	export const anchorToPivot = ({ anchor, sizes }) => {
		const a = typeof anchor === 'number' ? { x: anchor, y: anchor } : anchor;
		return { x: sizes.width * (a?.x ?? 0), y: sizes.height * (a?.y ?? 0) };
	};
`);
const COMPONENTS_LAYOUT = moduleUrl(`
	export { default as MainContainer } from '${MAIN_CONTAINER}';
	export { default as CanvasSizeRectangle } from '${CANVAS_RECT}';
`);

// `<LayoutNodeView>`: the node fold over the timeline's node actor, then `anchoredPosition` against
// the window its layout context reports, then a container at that position and scale holding the
// node's rect. The `Dim` node registers a full-window tap dim with the scene's tap portal, as a
// tap-to-continue instance does; the `Board` node draws the game box inside a nested
// `<MainContainer>`, as a board-relative overlay on a canvas screen is framed.
const nodeView = component(
	'node-view',
	`<script>
		import { getContextLayout } from '${UTILS_LAYOUT}';
		import { anchoredPosition, resolveTransform } from '${RESOLVE_TRANSFORM}';
		import { foldBoundTransform } from '${VALUE_BINDINGS}';
		import { nodeActorBindings, nodeActorOutputs } from '${CINEMATIC_NODES}';
		import { getCinematicNodeDriver } from '${NODE_CONTEXT}';
		import { getTapPortal } from '${TAP_PORTAL}';
		import { Container, Rectangle } from ${JSON.stringify(PIXI_SVELTE)};
		import { CanvasSizeRectangle, MainContainer } from ${JSON.stringify(COMPONENTS_LAYOUT)};
		const props = $props();
		const node = props.node;
		const layout = getContextLayout().stateLayoutDerived;
		const drive = getCinematicNodeDriver()?.(node.id);
		const bindings = drive ? nodeActorBindings(drive.channels) : undefined;
		const transform = $derived(
			foldBoundTransform(
				resolveTransform(node, layout.layoutType()),
				bindings,
				drive ? nodeActorOutputs(bindings, drive.sample()) : undefined,
			),
		);
		const canvas = $derived(layout.canvasSizes());
		const pos = $derived(anchoredPosition(transform, props.space, canvas.width, canvas.height));
		const portal = getTapPortal();
		$effect(() => {
			if (node.label !== 'Dim' || !portal) return;
			portal.register(node.id, { dim, tap });
			return () => portal.unregister(node.id);
		});
	</script>
	{#snippet dim(zIndex)}
		<CanvasSizeRectangle label="dim" {zIndex} />
	{/snippet}
	{#snippet tap()}
		<CanvasSizeRectangle label="tap" />
	{/snippet}
	<Container x={pos.x} y={pos.y} scale={transform.scale}>
		{#if node.kind === 'rect'}
			<Rectangle label={node.label} width={node.width} height={node.height} anchor={transform.anchor} />
		{/if}
	</Container>
	{#if node.label === 'Board'}
		<MainContainer>
			<Rectangle label="board" width={layout.mainLayout().width} height={layout.mainLayout().height} />
		</MainContainer>
	{/if}`,
);

const STUBS = {
	[LAYOUT_SCENE]: {
		'./LayoutNodeView.svelte': nodeView,
		'./ElementFxPlayer.svelte': moduleUrl('export default () => {};'),
	},
	[repoFile('packages/utils-layout/src/createLayout.svelte.ts')]: {
		'svelte/reactivity/window': moduleUrl(`
			export const innerWidth = { get current() { return ${harness}.window.get('width'); } };
			export const innerHeight = { get current() { return ${harness}.window.get('height'); } };
		`),
	},
};
const PACKAGES = {
	'pixi-svelte': PIXI_SVELTE,
	'components-layout': COMPONENTS_LAYOUT,
	'utils-layout': UTILS_LAYOUT,
	'constants-shared/layoutProfile': LAYOUT_PROFILE,
	'constants-shared/elementFx': ELEMENT_FX,
};

register(
	moduleUrl(`
		import { readFile } from 'node:fs/promises';
		import { createRequire, stripTypeScriptTypes } from 'node:module';
		import { fileURLToPath } from 'node:url';

		const STUBS = ${JSON.stringify(STUBS)};
		const PACKAGES = ${JSON.stringify(PACKAGES)};
		const ROOT = ${JSON.stringify(ROOT)};

		// The browser build of every \`svelte\` entry; a data: module's own imports resolve from the root.
		// \`./createLayout.svelte\` names a runes module, \`createLayout.svelte.ts\`, as Vite resolves it.
		export async function resolve(specifier, context, next) {
			const stub = STUBS[context.parentURL]?.[specifier] ?? PACKAGES[specifier];
			if (stub) return { url: stub, shortCircuit: true };
			const parentURL = context.parentURL?.startsWith('data:') ? ROOT : context.parentURL;
			const options = { ...context, parentURL, conditions: [...context.conditions, 'browser'] };
			try {
				return await next(specifier, options);
			} catch (err) {
				if (!(specifier.startsWith('.') && specifier.endsWith('.svelte'))) throw err;
				return next(specifier + '.ts', options);
			}
		}

		// A \`.svelte\` component and a \`.svelte.ts\` runes module go through Svelte's compiler, as Vite runs them.
		export async function load(url, context, next) {
			if (!url.startsWith('file:')) return next(url, context);
			const path = fileURLToPath(url);
			if (url.endsWith('.svelte')) {
				const { compile } = createRequire(path)('svelte/compiler');
				const { js } = compile(await readFile(path, 'utf8'), { filename: path, generate: 'client' });
				return { format: 'module', source: js.code, shortCircuit: true };
			}
			if (url.endsWith('.svelte.ts')) {
				const { compileModule } = createRequire(path)('svelte/compiler');
				const source = stripTypeScriptTypes(await readFile(path, 'utf8'));
				const { js } = compileModule(source, { filename: path, generate: 'client' });
				return { format: 'module', source: js.code, shortCircuit: true };
			}
			return next(url, context);
		}
	`),
	pathToFileURL('./'),
);

const svelteCopies = new Set(
	['package.json', 'packages/engine-layout/package.json', 'packages/utils-layout/package.json'].map(
		(pkg) =>
			realpathSync(createRequire(fileURLToPath(repoFile(pkg))).resolve('svelte/package.json')),
	),
);
if (svelteCopies.size !== 1) {
	console.log(`FAIL  one Svelte runtime — found ${[...svelteCopies].join(', ')}`);
	process.exit(1);
}

const { flushSync, mount, unmount } = await import('svelte');
const { SvelteMap } = await import('svelte/reactivity');
const { createLayout, setAuthoredLayoutProfile, setContextLayout } = await import(UTILS_LAYOUT);
const { resolveNodeActors, keyedNodeChannels } = await import(CINEMATIC_NODES);
const { sampleNodeActor } = await import(ENGINE_CINEMATIC);

const state = {
	window: new SvelteMap([
		['width', 1920],
		['height', 1080],
	]),
	rects: new Set(),
};
globalThis.__canvasScaleHarness = state;

let failures = 0;
const check = (name, ok, extra = '') => {
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

// The reporting project's layout profile and its Feature intro, trimmed to the nodes that showed it:
// the two curtains and one rocket per side as authored (a rocket is a rig; its origin is what
// matters, drawn here as a box), and the centred title. `Dim` stands in for the tap-to-continue
// instance's dim, `Board` for a board-relative overlay.
const PROFILE = {
	buckets: [
		{
			id: 'portrait',
			label: 'Portrait',
			box: { width: 1080, height: 1920 },
			rule: { maxRatio: 0.8 },
			stacked: true,
		},
		{ id: 'tablet', label: 'Tablet', box: { width: 1024, height: 1366 }, rule: { maxRatio: 1.3 } },
		{ id: 'desktop', label: 'Desktop', box: { width: 1920, height: 1080 }, rule: {} },
	],
	fallbackBucketId: 'desktop',
};
setAuthoredLayoutProfile(PROFILE);
const MAIN_SIZES = {
	desktop: { width: 1920, height: 1080 },
	portrait: { width: 576, height: 1024 },
};

const CURTAIN = { kind: 'rect', width: 400, height: 400, color: 0, x: 0, y: 0 };
const curtainScale = { x: 0.05, y: 2.7178025963655084 };
const rocket = (id, x, y, portrait) => ({
	id,
	label: id,
	kind: 'rect',
	width: 120,
	height: 60,
	x,
	y,
	anchor: { x: 0.5, y: 0.5 },
	scale: { x: 0.5776009203505176, y: 0.5776009203505176 },
	overrides: { portrait },
});
const featureIntro = (flags = {}) => ({
	id: 'featureIntro',
	name: 'Feature intro',
	space: 'canvas',
	role: 'mode',
	modeId: 'holdAndWin',
	alwaysOnTop: true,
	...flags,
	nodes: [
		{
			id: 'n_jc60ta0t',
			label: 'CurtainLeft',
			...CURTAIN,
			anchor: { x: 0, y: 0.5 },
			scale: curtainScale,
			screenAnchor: { x: 0, y: 0.5 },
		},
		{
			id: 'n_wo0awimz',
			label: 'CurtainRight',
			...CURTAIN,
			anchor: { x: 1, y: 0.5 },
			scale: curtainScale,
			screenAnchor: { x: 1, y: 0.5 },
		},
		rocket('R_RocketRed1', 1860.9096977794093, 1014.4596235678268, {
			x: 1304.270885353699,
			y: 1378.1393823615704,
		}),
		rocket('R_RocketRed2', 49.090302220588235, 912.5207736400049, {
			x: -224.27088535369904,
			y: 1406.033482804088,
		}),
		{
			id: 'feature-intro-title',
			label: 'Title',
			kind: 'rect',
			width: 484,
			height: 85,
			x: 0,
			y: 248.91239504367866,
			anchor: { x: 0.5, y: 0.5 },
			screenAnchor: { x: 0.5, y: 0 },
		},
		{ id: 'dim', label: 'Dim', kind: 'container', x: 0, y: 0, children: [] },
		{ id: 'board', label: 'Board', kind: 'container', x: 0, y: 0, children: [] },
	],
});
const key = (time, value) => ({ time, value, ease: 'linear' });
const actor = (target) => ({ actorId: `node_${target}`, kind: 'node', target, place: {}, z: 0 });
/** `featureintro_intro` as published: 0.5 s, curtains ×60, the rockets flying across. */
const INTRO = {
	schemaVersion: 1,
	id: 'featureintro_intro',
	duration: 0.5,
	fps: 30,
	host: { kind: 'screen', sceneId: 'featureIntro' },
	stage: {
		sceneId: null,
		cast: ['CurtainLeft', 'CurtainRight', 'R_RocketRed1', 'R_RocketRed2'].map(actor),
	},
	tracks: [
		{
			id: 'l',
			actorId: 'node_CurtainLeft',
			kind: 'property',
			channels: { scale: [key(0, 1), key(0.5, 60), key(2.033333333333333, 1)] },
		},
		{
			id: 'r',
			actorId: 'node_CurtainRight',
			kind: 'property',
			channels: { scale: [key(0, 1), key(0.5, 60)] },
		},
		{
			id: 'r1',
			actorId: 'node_R_RocketRed1',
			kind: 'property',
			channels: {
				x: [key(0, 562.7625903256317), key(0.5, -2218.333363115914)],
				y: [key(0, -24.593951733533572), key(0.5, -33.67589138074152)],
			},
		},
		{
			id: 'r2',
			actorId: 'node_R_RocketRed2',
			kind: 'property',
			channels: {
				x: [key(0, -485.4611760770795), key(0.5, 2123.321693051269)],
				y: [key(0, -11.993106516411217), key(0.5, 8.036292261313292)],
			},
		},
	],
	markers: [],
};
/** The node driver `<Cinematic>` provides, at a fixed playhead. */
const driverAt = (scene, time) => {
	const actors = resolveNodeActors(INTRO, scene);
	return (nodeId) => {
		const found = actors.get(nodeId);
		return found
			? {
					channels: keyedNodeChannels(found.tracks),
					sample: () => sampleNodeActor(found.tracks, time),
				}
			: undefined;
	};
};

// The game's root: the real layout, as `createLayout` derives it from the window.
const root = component(
	'root',
	`<script>
		import { setContextLayout } from '${UTILS_LAYOUT}';
		import LayoutScene from '${LAYOUT_SCENE}';
		const props = $props();
		setContextLayout(props.layout);
	</script>
	<LayoutScene scene={props.scene} nodeDriver={props.driver} />`,
);
const { default: Root } = await import(root);
const layout = createLayout({
	backgroundRatio: { normal: 2039 / 1000, portrait: 1242 / 2208 },
	mainSizesMap: MAIN_SIZES,
});

const toWorld = (container, point) =>
	container
		? toWorld(container.parent, {
				x: container.x + container.scale.x * (point.x - container.pivot.x),
				y: container.y + container.scale.y * (point.y - container.pivot.y),
			})
		: point;
/** Every recorded rectangle's window box, by label. */
const boxes = () => {
	const out = {};
	for (const rect of state.rects) {
		const a = typeof rect.anchor === 'number' ? { x: rect.anchor, y: rect.anchor } : rect.anchor;
		const left = rect.x - (a?.x ?? 0) * rect.width;
		const top = rect.y - (a?.y ?? 0) * rect.height;
		const p = toWorld(rect.parent, { x: left, y: top });
		const q = toWorld(rect.parent, { x: left + rect.width, y: top + rect.height });
		out[rect.label] = { left: p.x, top: p.y, right: q.x, bottom: q.y, depth: depth(rect.parent) };
	}
	return out;
};
const depth = (container) => (container ? 1 + depth(container.parent) : 0);
const at = (width, height) => {
	state.window.set('width', width);
	state.window.set('height', height);
	flushSync();
};
/** Mount the screen at the intro's last frame on a `width × height` window; its boxes. */
const frame = (scene, width, height, time = INTRO.duration) => {
	at(width, height);
	const app = mount(Root, {
		target: new Element(),
		props: { layout, scene, driver: driverAt(scene, time) },
	});
	flushSync();
	const out = boxes();
	unmount(app);
	return out;
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
const sameBox = (a, b, k = 1) =>
	!!a && !!b && ['left', 'top', 'right', 'bottom'].every((side) => near(a[side], b[side] * k));
const fmt = (box) =>
	box
		? `[${box.left.toFixed(1)}, ${box.right.toFixed(1)}] × [${box.top.toFixed(1)}, ${box.bottom.toFixed(1)}]`
		: 'missing';
/** How much of the window's width the two curtains leave open in the middle. */
const curtainGap = (b) => Math.max(0, b.CurtainRight.left - b.CurtainLeft.right);
const onScreen = (box, width) => box.right > 0 && box.left < width;

const EDITOR = [1920, 1080];
/** The report's window, about 2850 px wide; exactly 16:9, the design box's shape. */
const WIDE = [2848, 1602];

console.log('\n1. The report: the intro as published (window pixels)');
const authored = frame(featureIntro(), ...EDITOR);
check(
	'on the editor frame (1920×1080) the curtains meet',
	curtainGap(authored) === 0,
	`gap ${curtainGap(authored)}`,
);
check(
	'...and the right rocket ends past the right edge',
	!onScreen(authored.R_RocketRed2, 1920),
	fmt(authored.R_RocketRed2),
);
const reported = frame(featureIntro(), ...WIDE);
check(
	'on a 2848 px window the curtains leave the reels open in the middle (the report)',
	near(curtainGap(reported), 2848 - 2400),
	`gap ${curtainGap(reported).toFixed(1)} px`,
);
check(
	'...and the right rocket ends on screen (the report)',
	onScreen(reported.R_RocketRed2, 2848),
	fmt(reported.R_RocketRed2),
);
check(
	'an unticked canvas screen mounts no scaling container',
	reported.CurtainLeft.depth === 1,
	`depth ${reported.CurtainLeft.depth}`,
);

console.log('\n2. Ticked: the window shows the editor frame, scaled');
const ticked = featureIntro({ scaleWithWindow: true });
const atEditor = frame(ticked, ...EDITOR);
check(
	'on the design box itself it draws exactly as unticked',
	['CurtainLeft', 'CurtainRight', 'R_RocketRed1', 'R_RocketRed2', 'Title'].every((id) =>
		sameBox(atEditor[id], authored[id]),
	),
);
for (const [width, height] of [WIDE, [1280, 720], [3840, 2160]]) {
	const k = width / 1920;
	const got = frame(ticked, width, height);
	check(
		`${width}×${height}: every node lands where the editor frame puts it, ×${k.toFixed(3)}`,
		['CurtainLeft', 'CurtainRight', 'R_RocketRed1', 'R_RocketRed2', 'Title'].every((id) =>
			sameBox(got[id], atEditor[id], k),
		),
		`right curtain ${fmt(got.CurtainRight)}`,
	);
	check(`${width}×${height}: the curtains meet`, curtainGap(got) === 0, `gap ${curtainGap(got)}`);
	check(
		`${width}×${height}: the right rocket ends past the edge`,
		!onScreen(got.R_RocketRed2, width),
		fmt(got.R_RocketRed2),
	);
	check(
		`${width}×${height}: one scaling container`,
		got.CurtainLeft.depth === 2,
		`depth ${got.CurtainLeft.depth}`,
	);
}

console.log('\n3. What fills the window still fills it');
for (const [width, height] of [EDITOR, WIDE, [2560, 1080], [390, 844]]) {
	const plain = frame(featureIntro(), width, height);
	const got = frame(ticked, width, height);
	const window = { left: 0, top: 0, right: width, bottom: height };
	check(
		`${width}×${height}: the hoisted tap dim and hit area cover the window`,
		sameBox(got.dim, window) && sameBox(got.tap, window),
		`dim ${fmt(got.dim)}`,
	);
	check(
		`${width}×${height}: a nested game box draws as on an unticked screen`,
		sameBox(got.board, plain.board),
		`${fmt(got.board)} vs ${fmt(plain.board)}`,
	);
}

console.log('\n4. Other shapes: pinned to the window edges');
const ultra = frame(ticked, 2560, 1080);
check(
	'2560×1080 (fit 1): the left curtain starts at the left edge',
	near(ultra.CurtainLeft.left, 0),
	fmt(ultra.CurtainLeft),
);
check(
	'...the right curtain ends at the right edge',
	near(ultra.CurtainRight.right, 2560),
	fmt(ultra.CurtainRight),
);
check(
	'...and the title stays centred',
	near((ultra.Title.left + ultra.Title.right) / 2, 1280),
	fmt(ultra.Title),
);
const phone = frame(ticked, 390, 844);
const phonePlain = frame(featureIntro(), 390, 844);
const fit = Math.min(390 / 1080, 844 / 1920);
check(
	`390×844 (portrait box, fit ${fit.toFixed(3)}): the title keeps its offset from the top edge, scaled`,
	near(phone.Title.top, phonePlain.Title.top * fit),
	`${phone.Title.top.toFixed(2)} vs ${(phonePlain.Title.top * fit).toFixed(2)}`,
);
check(
	'...and the rocket its portrait position, scaled',
	sameBox(phone.R_RocketRed1, phonePlain.R_RocketRed1, fit),
	fmt(phone.R_RocketRed1),
);

console.log('\n5. Live resize, and the tick only on a canvas screen');
at(...EDITOR);
const live = mount(Root, {
	target: new Element(),
	props: { layout, scene: ticked, driver: driverAt(ticked, INTRO.duration) },
});
flushSync();
const before = boxes();
at(...WIDE);
const after = boxes();
unmount(live);
check(
	'turning the window bigger rescales a mounted screen',
	sameBox(after.CurtainRight, before.CurtainRight, 2848 / 1920) &&
		sameBox(after.dim, { left: 0, top: 0, right: 2848, bottom: 1602 }),
	fmt(after.CurtainRight),
);
const gameSpace = frame({ ...featureIntro({ scaleWithWindow: true }), space: undefined }, ...WIDE);
const gamePlain = frame({ ...featureIntro(), space: undefined }, ...WIDE);
check(
	'a stray tick on a game-space screen changes nothing',
	['CurtainLeft', 'R_RocketRed2', 'dim', 'board'].every((id) =>
		sameBox(gameSpace[id], gamePlain[id]),
	),
);

console.log('\n6. Wiring');
const read = (path) => readFileSync(fileURLToPath(repoFile(path)), 'utf8');
const scene = read('packages/engine-layout/src/lib/LayoutScene.svelte');
check(
	'LayoutScene scales only a ticked canvas screen, the tap surfaces and screen FX inside it',
	/scene\.space === 'canvas' && scene\.scaleWithWindow === true/.test(scene) &&
		/<Container scale=\{windowScale\(\)\}>\s*\{@render withScreenFx\(\)\}/.test(scene),
);
check(
	'...by the design box the editor frames a canvas screen at',
	/mainLayoutStandard\(\)\.scale/.test(scene) &&
		/resolveBucketBox\(activeProfile, currentLayoutType\)/.test(
			read('apps/launcher-api/src/routes/(app)/editor/+page.svelte'),
		) &&
		/resolveBucketBox\(profile, layoutType\(\)\)/.test(
			read('packages/utils-layout/src/createLayout.svelte.ts'),
		),
);
check(
	'the save keeps the tick on a canvas screen only',
	/scene\.space === 'canvas' && input\.scaleWithWindow === true/.test(
		read('apps/launcher-api/src/lib/server/editorStorage.ts'),
	),
);

console.log(failures ? `\n${failures} FAILED` : '\nAll canvas window-scale checks passed.');
process.exit(failures ? 1 : 0);
