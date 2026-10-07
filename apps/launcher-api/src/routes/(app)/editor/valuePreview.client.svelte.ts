import {
	evaluateBinding,
	foldBoundTransform,
	resolveTransform,
	type LayoutNode,
	type LayoutType,
	type ResolvedTransform,
} from 'engine-layout';

/**
 * The editor's VALUE-BINDING PREVIEW (Hold and Win Phase 12b): a test input per binding, set by
 * scrubbing in the Properties panel's "Bind to value" section, that the canvas, the text overlay and
 * the rig overlay draw with — so an author sees what the number does before the game ever feeds
 * it. Editor-only and never saved. A binding with no test value draws as authored, exactly as the
 * game draws a node whose source has not reported yet.
 *
 * The inputs are a PLAIN object on purpose: `EditorCanvas.draw()` runs inside several redraw
 * effects, and a reactive read there would make each of them depend on every scrub. The one
 * reactive value is {@link previewVersion}, which the redraw effects read explicitly.
 *
 * Applied in the DRAW paths only — never in the drag / scale / rotate / snap math, which keep
 * reading the authored transform, so a scrubbed offset can never be written into the doc.
 */
const inputs: Record<string, number> = {};
const version = $state({ n: 0 });

const keyOf = (nodeId: string, index: number): string => `${nodeId}#${index}`;

/** Bumped on every preview change — read it in a redraw effect to repaint on a scrub. */
export function previewVersion(): number {
	return version.n;
}

/** The test input of binding `index` on node `nodeId`; `undefined` ⇒ not previewing it. */
export function previewInput(nodeId: string, index: number): number | undefined {
	return inputs[keyOf(nodeId, index)];
}

/** Set (or with `undefined`, clear) one binding's test input. */
export function setPreviewInput(nodeId: string, index: number, value: number | undefined): void {
	const key = keyOf(nodeId, index);
	if (value === undefined || !Number.isFinite(value)) delete inputs[key];
	else inputs[key] = value;
	version.n += 1;
}

/** Clear every test input of a node — its bindings were reordered or removed. */
export function clearNodePreview(nodeId: string): void {
	const prefix = `${nodeId}#`;
	for (const key of Object.keys(inputs)) if (key.startsWith(prefix)) delete inputs[key];
	version.n += 1;
}

/** Each binding's preview output for `node` (`undefined` where nothing is being previewed). */
export function previewOutputs(node: LayoutNode, frameCount?: number): (number | undefined)[] {
	const bindings = node.valueBindings;
	if (!bindings?.length) return [];
	return bindings.map((binding, i) => {
		const input = inputs[keyOf(node.id, i)];
		return input === undefined ? undefined : evaluateBinding(binding, input, frameCount);
	});
}

/** `resolveTransform` with the previewed transform targets folded on — for the draw paths. */
export function previewResolveTransform(
	node: LayoutNode,
	layoutType: LayoutType,
): ResolvedTransform {
	return foldBoundTransform(
		resolveTransform(node, layoutType),
		node.valueBindings,
		previewOutputs(node),
	);
}
