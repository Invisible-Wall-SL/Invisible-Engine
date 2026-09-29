import { error, json } from '@sveltejs/kit';
import { getDeployToken } from '$lib/server/appSettings';
import { exportEditorFlow } from '$lib/server/flowExport';
import { exportEditorFlowV2 } from '$lib/server/flowV2Export';
import {
	checkFlowV2ForPublish,
	describeFlowErrors,
	invalidFlowMessage,
} from '$lib/server/flowV2Validation';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import { withDeployWrite } from '$lib/server/runtimeBundleCache';
import type { RequestHandler } from './$types';

/**
 * Build-time trigger: export the project's Invisible Flow document into
 * `deploy/flow.json` so the bake can embed it (see `$lib/server/flowExport.ts`).
 * Called by `bake-editor-doc.mjs` right before the deploy mirror runs, gated by
 * the same shared read token as `/api/editor/doc` (`?k=` vs `EDITOR_DOC_SECRET`)
 * — a build runner has the token, no launcher session. The FlowDoc carries no
 * binary assets, so this is a single JSON copy + normalize. Idempotent; safe to
 * re-run per build. An un-authored project exports an empty doc (parity, §7).
 *
 * The v2 flow is VALIDATED first — the desktop half of the online publish's flow gate — and a flow
 * with errors is refused with a 409 `{ error, reason: 'invalid-flow', details }` before anything is
 * written. `&allowInvalidFlow=1` is the explicit override (the bake's `--allow-invalid-flow`). This
 * route has no user session, only the deploy token, so the override is as restricted as that token
 * (a publisher credential), not to the owner role like the online Publish.
 */
export const POST: RequestHandler = async ({ url }) => {
	const secret = await getDeployToken();
	if (!secret) throw error(503, 'Editor flow export is not configured.');
	if (url.searchParams.get('k') !== secret) throw error(401, 'Invalid or missing token.');

	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	try {
		const flowCheck = await checkFlowV2ForPublish(clientKey, projectKey);
		if (flowCheck.status === 'invalid') {
			const details = describeFlowErrors(flowCheck.errors);
			if (url.searchParams.get('allowInvalidFlow') !== '1') {
				return json(
					{ error: invalidFlowMessage(flowCheck.errors), reason: 'invalid-flow', details },
					{ status: 409 },
				);
			}
			console.warn(
				`[export-flow] ${projectKey}: baked with ${flowCheck.errors.length} flow error(s) by ` +
					`override: ${details.join(' | ')}`,
			);
		}

		// v1 flow + v2 flow are both exported here so ONE bake call covers both. The v2
		// pair (`flowV2` / `flowV2Library`) is what a flow-v2 game needs to drive its
		// screens; without it the desktop bake embedded only v1 and a v2-authored game
		// ran inert (static scene-editor placement, no flow). Each export self-gates on
		// "authored", so an un-authored side contributes nothing (parity). Mirrors what
		// the online runtime bundle already assembles (`runtimeBundle.ts`).
		const [index, indexV2] = await withDeployWrite(
			projectKey,
			async () =>
				[
					await exportEditorFlow(clientKey, projectKey),
					await exportEditorFlowV2(clientKey, projectKey),
				] as const,
		);
		return json({ clientKey, projectKey, ...index, ...indexV2 });
	} catch (e) {
		console.error('export-flow failed:', e);
		throw error(502, 'Failed to export the project flow.');
	}
};
