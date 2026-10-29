/**
 * The flow on stdin through Publish's flow gate, as `publishGame` runs it: the real
 * `validateFlowV2Against` over the lines scenes with the project's compiled shader kinds, then
 * `flowGateRefusal` for a lines project. Prints the refusal (or `null`) and the issues by severity.
 * Run with the launcher's scripts tsconfig (`$env` stubbed), by `screenFxFlow.mjs`.
 */
import { readFileSync } from 'node:fs';
import type { FlowDoc } from '../../../packages/engine-flow-v2/index';
import { getFullSceneSet, type LayoutDoc } from '../../../packages/engine-layout/src/lib/index';
import { REFERENCE_GRAPHS, compileShaderEffect } from '../../../packages/engine-shadergraph/index';
import {
	flowGateRefusal,
	validateFlowV2Against,
} from '../../../apps/launcher-api/src/lib/server/flowV2Validation';

const doc = JSON.parse(readFileSync(0, 'utf8')) as FlowDoc;
const scenes = (getFullSceneSet('lines') as LayoutDoc).scenes;
const kinds = REFERENCE_GRAPHS.flatMap((graph) => {
	const result = compileShaderEffect(graph);
	return result.ok ? [result.effect.spec.kind] : [];
});
const issues = validateFlowV2Against(
	doc,
	scenes,
	null,
	{ version: 2, functions: [] },
	[],
	undefined,
	kinds,
);
const errors = issues.filter((i) => i.severity === 'error');
const refusal = flowGateRefusal(
	errors.length
		? { status: 'invalid', templateId: doc.templateId, errors }
		: { status: 'valid', templateId: doc.templateId },
	'lines',
);
process.stdout.write(
	JSON.stringify({
		refusal,
		issues: issues.map((i) => ({ code: i.code, severity: i.severity, at: i.at })),
	}),
);
