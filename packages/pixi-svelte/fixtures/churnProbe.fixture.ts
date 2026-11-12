/**
 * Offline fixture for the `?perf=1` churn counts (`src/lib/churnProbe.ts`), against the real
 * pixi.js, engine-rig and particle-emitter classes:
 *
 *   pnpm check:all --only churnProbe
 *
 * Pins: every display object built while the probe is on counts once under its kind (a `RigView`
 * as a rig, an emitter's `Particle` as a particle sprite, `Text` / `BitmapText` / `HTMLText` as
 * texts, other drawn views as other), and every one destroyed counts once (twice destroyed, once;
 * a parent destroyed with its children, each); an object built under the probe is the object built
 * without it (the same own keys in the same order, an own enumerable writable `uid` continuing
 * Pixi's sequence), and off, the prototype is left exactly as Pixi made it; a frame's churn is the
 * frame's whose callbacks run, kept for the frame before; text renders count each canvas texture
 * drawn through the system's own `getTexture` (a cache hit draws none) and each `HTMLText` build,
 * and the undo restores the systems; the readout's texture list skips the `null` Pixi leaves where a
 * texture was unloaded; a DOM node counts with every node under it (a container's element mounted
 * with its children's anchors inside), and its own siblings do not.
 */
import { Emitter, Particle } from '@barvynkoa/particle-emitter';
import { SkeletonData } from 'engine-rig';
import { RigView } from 'engine-rig/pixi';
import {
	AbstractTextSystem,
	AnimatedSprite,
	BitmapText,
	CanvasTextSystem,
	Container,
	Graphics,
	HTMLText,
	HTMLTextSystem,
	MeshSimple,
	ParticleContainer,
	Sprite,
	Text,
	Texture,
	type Renderer,
} from 'pixi.js';

import {
	churnFrameStarts,
	churnKind,
	emptyChurnCounts,
	frameChurn,
	nodesIn,
	observeDomChurn,
	probeTextRenders,
	resetChurn,
	trackDisplayObjects,
	type ChurnCounts,
} from '../src/lib/churnProbe';
import { textureFormats } from '../src/lib/glCounters';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};

const proto = Container.prototype as unknown as Record<string, unknown>;
const nativeDestroy = proto.destroy;
const mesh = () =>
	new MeshSimple({
		texture: Texture.WHITE,
		vertices: new Float32Array([0, 0, 1, 0, 1, 1]),
		uvs: new Float32Array([0, 0, 1, 0, 1, 1]),
		indices: new Uint32Array([0, 1, 2]),
	});
const rig = () => new RigView({ skeletonData: new SkeletonData(), autoUpdate: false });
// Node loads the emitter's CommonJS build, over a second copy of Pixi. Its Sprite is rebased onto
// this Pixi's, so an emitter particle is this Pixi's Sprite and Container, as in a game's bundle
// (which takes the emitter's ES module, over the one Pixi).
Object.setPrototypeOf(Object.getPrototypeOf(Particle.prototype), Sprite.prototype);
const emitter = new Emitter(new Container(), {
	lifetime: { min: 1, max: 1 },
	frequency: 1,
	pos: { x: 0, y: 0 },
	behaviors: [],
});

const only = (counts: ChurnCounts | undefined, expected: Partial<ChurnCounts>): string => {
	const want = { ...emptyChurnCounts(), ...expected };
	const wrong = Object.entries(want).filter(
		([key, value]) => counts?.[key as keyof ChurnCounts] !== value,
	);
	return wrong
		.map(([key, value]) => `${key} ${counts?.[key as keyof ChurnCounts]} ≠ ${value}`)
		.join(', ');
};

console.log('kinds');
{
	const cases: [string, () => object, string][] = [
		['Container', () => new Container(), 'container'],
		['Sprite', () => new Sprite(Texture.WHITE), 'sprite'],
		['AnimatedSprite', () => new AnimatedSprite([Texture.WHITE]), 'sprite'],
		['emitter Particle', () => new Particle(emitter), 'particle'],
		['Text', () => new Text({ text: '1' }), 'text'],
		['BitmapText', () => new BitmapText({ text: '1' }), 'text'],
		['HTMLText', () => new HTMLText({ text: '1' }), 'text'],
		['Graphics', () => new Graphics(), 'graphics'],
		['Mesh', mesh, 'mesh'],
		['ParticleContainer', () => new ParticleContainer(), 'other'],
		['RigView', rig, 'rig'],
	];
	for (const [name, make, kind] of cases)
		check(`${name} counts as ${kind}`, churnKind(make()) === kind, churnKind(make()));
}

console.log('built and destroyed');
{
	check('off: Container.prototype has no uid', !Object.getOwnPropertyDescriptor(proto, 'uid'));
	const before = new Sprite(Texture.WHITE);
	check('the probe can count builds on this Pixi', trackDisplayObjects(true));
	resetChurn();
	churnFrameStarts(100);
	const after = new Sprite(Texture.WHITE);
	check(
		'a sprite built under the probe has the same own keys, in the same order',
		JSON.stringify(Object.keys(after)) === JSON.stringify(Object.keys(before)),
		`${Object.keys(after).length} vs ${Object.keys(before).length}`,
	);
	const uid = Object.getOwnPropertyDescriptor(after, 'uid');
	check(
		'…an own, enumerable, writable uid, next in the sequence',
		!!uid?.enumerable && !!uid.writable && uid.value === before.uid + 1,
		JSON.stringify(uid),
	);
	check(
		'one sprite built, nothing else',
		only(frameChurn(100), { created: 1, createdSprites: 1 }) === '',
		only(frameChurn(100), { created: 1, createdSprites: 1 }),
	);

	churnFrameStarts(116);
	const parent = new Container();
	parent.addChild(new Sprite(Texture.WHITE), new Text({ text: 'x' }), new Graphics(), mesh());
	parent.addChild(new BitmapText({ text: '2' }), new HTMLText({ text: '3' }), new Container());
	parent.addChild(new Particle(emitter), new ParticleContainer(), rig());
	const built = {
		created: 10 + 1 + 1, // the ten above, the rig's measuring Graphics, the parent
		createdContainers: 2,
		createdSprites: 1,
		createdParticles: 1,
		createdTexts: 3,
		createdGraphics: 2,
		createdMeshes: 1,
		createdOther: 1,
		rigsBuilt: 1,
	};
	check(
		'every kind built is counted under it',
		only(frameChurn(116), built) === '',
		only(frameChurn(116), built),
	);
	check(
		'the frame before keeps its own counts',
		only(frameChurn(100), { created: 1, createdSprites: 1 }) === '',
	);

	churnFrameStarts(133);
	after.destroy();
	after.destroy();
	parent.destroy({ children: true });
	const destroyed = {
		destroyed: 1 + 12,
		destroyedContainers: 2,
		destroyedSprites: 2,
		destroyedParticles: 1,
		destroyedTexts: 3,
		destroyedGraphics: 2,
		destroyedMeshes: 1,
		destroyedOther: 1,
		rigsDestroyed: 1,
	};
	check(
		'destroyed once each: twice destroyed is one, a parent with its children is each',
		only(frameChurn(133), destroyed) === '',
		only(frameChurn(133), destroyed),
	);
	check('two frames back is gone', frameChurn(100) === undefined);

	trackDisplayObjects(false);
	check(
		'off again: no uid on the prototype, the native destroy back',
		!Object.getOwnPropertyDescriptor(proto, 'uid') && proto.destroy === nativeDestroy,
	);
	churnFrameStarts(150);
	new Sprite(Texture.WHITE).destroy();
	check('off: nothing is counted', only(frameChurn(150), {}) === '', only(frameChurn(150), {}));
}

console.log('text renders');
{
	check(
		"Pixi's text systems draw through the methods the probe wraps",
		typeof AbstractTextSystem.prototype.getTexture === 'function' &&
			Object.getPrototypeOf(CanvasTextSystem.prototype) === AbstractTextSystem.prototype &&
			typeof (HTMLTextSystem.prototype as unknown as Record<string, unknown>)
				._buildTexturePromise === 'function',
	);
	const drawn: string[] = [];
	const canvasText = new CanvasTextSystem({ resolution: 1 } as unknown as Renderer);
	const own = canvasText as unknown as { getTexture: (o: { text: string }) => Texture };
	const draw = (options: { text: string }) => {
		drawn.push(options.text);
		return Texture.WHITE;
	};
	own.getTexture = draw;
	const build = () => Promise.resolve(Texture.WHITE);
	const htmlText = { _buildTexturePromise: build };
	const renderer = { canvasText, htmlText } as unknown as Renderer;
	resetChurn();
	churnFrameStarts(200);
	const undo = probeTextRenders(renderer);
	const label = (text: string) =>
		({ text, styleKey: `${text}-style`, style: {}, _autoResolution: true }) as unknown as Text;
	canvasText.getManagedTexture(label('1.00'));
	canvasText.getManagedTexture(label('1.00'));
	canvasText.getManagedTexture(label('2.00'));
	void htmlText._buildTexturePromise();
	const counts = frameChurn(200);
	check(
		'a label drawn twice and a new one: two canvas renders, one HTML build',
		counts?.textRenders === 3 && drawn.join() === '1.00,2.00',
		`${counts?.textRenders} ${drawn.join()}`,
	);
	undo();
	canvasText.getManagedTexture(label('3.00'));
	check(
		'the undo puts the systems back, and nothing more is counted',
		own.getTexture === draw &&
			htmlText._buildTexturePromise === build &&
			frameChurn(200)?.textRenders === 3,
	);
}

console.log("the readout's textures");
{
	// Pixi's managed list keeps a null where a texture was unloaded or destroyed (GCManagedHash).
	const source = Texture.WHITE.source;
	const formats = textureFormats([source, null, undefined]);
	check(
		"an unloaded texture's null slot is skipped, not read",
		formats.length === 1 && formats[0].count === 1,
		JSON.stringify(formats),
	);
}

console.log('DOM nodes');
{
	type FakeNode = { firstChild: FakeNode | null; nextSibling: FakeNode | null };
	const tree = (children: FakeNode[] = []): FakeNode => {
		children.forEach((child, i) => (child.nextSibling = children[i + 1] ?? null));
		return { firstChild: children[0] ?? null, nextSibling: null };
	};
	const node = (n: FakeNode) => n as unknown as Node;
	check('an anchor alone is one node', nodesIn(node(tree())) === 1);
	check(
		'an element with three anchors is four',
		nodesIn(node(tree([tree(), tree(), tree()]))) === 4,
	);
	const container = tree([tree(), tree([tree(), tree([tree()])]), tree()]);
	check(
		'a container mounted with its children counts every node under it',
		nodesIn(node(container)) === 7,
	);
	const sibling = tree();
	const first = tree([tree()]);
	first.nextSibling = sibling;
	check("a node's own siblings are not under it", nodesIn(node(first)) === 2);

	// The browser's observer, stood in for: the probe's callback, handed a frame's records.
	type Records = { addedNodes: FakeNode[]; removedNodes: FakeNode[] }[];
	let deliver: ((records: Records) => void) | undefined;
	let watched: unknown;
	const native = globalThis.MutationObserver;
	globalThis.MutationObserver = class {
		constructor(callback: (records: Records) => void) {
			deliver = callback;
		}
		observe(target: unknown, options: unknown) {
			watched = { target, options };
		}
		disconnect() {
			deliver = undefined;
		}
	} as unknown as typeof MutationObserver;
	const host = tree();
	const undo = observeDomChurn(node(host));
	check(
		'the host is observed with everything under it',
		JSON.stringify(watched) ===
			JSON.stringify({ target: host, options: { childList: true, subtree: true } }),
	);
	resetChurn();
	churnFrameStarts(300);
	deliver?.([
		{ addedNodes: [container, tree()], removedNodes: [] },
		{ addedNodes: [], removedNodes: [tree([tree(), tree()])] },
	]);
	const frame = frameChurn(300);
	check(
		"a frame's records count each node added or removed with every node under it",
		frame?.domAdded === 8 && frame.domRemoved === 3,
		JSON.stringify({ added: frame?.domAdded, removed: frame?.domRemoved }),
	);
	undo();
	check('the undo disconnects the observer', deliver === undefined);
	globalThis.MutationObserver = native;
}

if (failures) throw new Error(`churnProbe.fixture: ${failures} FAILED`);
console.log('\nchurnProbe.fixture: all ok');
