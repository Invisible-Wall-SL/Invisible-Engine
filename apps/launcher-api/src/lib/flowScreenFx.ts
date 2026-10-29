import { ELEMENT_FX_STAGE_TARGET, type ElementFxKindId } from 'constants-shared/elementFx';
import { flattenGroups, flowGraphs, type FlowDoc, type FlowIssue, type Node } from 'engine-flow-v2';
import { stageFxRefusal } from 'pixi-svelte/elementFx';

/**
 * Screen FX in `/flow-v2` (Shader Graph 8e, `shader-graph-screens.md` §9.1): what the Flow editor
 * says about an `elementEffect` on the whole stage. The runtime's own rule (`stageFxRefusal`)
 * decides, so the editor warns on exactly the kinds the game will not play there.
 */

/** The `elementEffect` action. */
const ELEMENT_EFFECT_ACTION = 'elementEffect';

/** A node's literal input `pin`, when it is one. */
const literalOf = (node: Node, pin: string): unknown => {
	const source = node.inputs?.[pin];
	return source?.kind === 'literal' ? source.value : undefined;
};

/** Whether `node` is an `elementEffect` aimed at the whole stage (by literal). */
export const isStageEffect = (node: Node): boolean =>
	node.kind === 'action' &&
	node.ref === ELEMENT_EFFECT_ACTION &&
	literalOf(node, 'target') === ELEMENT_FX_STAGE_TARGET;

/** Why `kind` plays nothing on the whole stage, or `undefined` when it plays (or is unknown). */
export const stageKindRefusal = (kind: unknown): string | undefined =>
	typeof kind === 'string' && kind ? stageFxRefusal(kind as ElementFxKindId) : undefined;

/**
 * `stage-fx-refused` — a warning on every `elementEffect` on `stage` whose literal kind the stage
 * refuses (an exit, an enter, a motion-only or a break kind): the game plays nothing there.
 */
export function stageEffectIssues(doc: FlowDoc): FlowIssue[] {
	const issues: FlowIssue[] = [];
	for (const { modeId, graph } of flowGraphs(doc)) {
		for (const node of flattenGroups(graph).nodes) {
			if (!isStageEffect(node)) continue;
			const kind = literalOf(node, 'kind');
			const refusal = stageKindRefusal(kind);
			if (!refusal) continue;
			issues.push({
				code: 'stage-fx-refused',
				severity: 'warning',
				message: `element effect '${node.id}' plays ${String(kind)} on the whole stage, which plays nothing there: ${refusal}. On the stage, pick a light, distortion or loop kind with a pixel pass`,
				at: { on: 'node', node: node.id },
				...(modeId === undefined ? {} : { mode: modeId }),
			});
		}
	}
	return issues;
}
