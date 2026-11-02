import { error, json } from '@sveltejs/kit';
import { getDeployToken } from '$lib/server/appSettings';
import { exportEditorFlowV2 } from '$lib/server/flowV2Export';
import {
	checkFlowV2ForPublish,
	describeFlowErrors,
	flowGateRefusal,
} from '$lib/server/flowV2Validation';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey, projectGameType } from '$lib/server/projects';
import { withDeployWrite } from '$lib/server/runtimeBundleCache';
import type { RequestHandler } from './$types';

/**
 * Build-time trigger: export the project's Invisible Flow v2 graph + shared function library into
 * `deploy/` so the bake can embed them (see `$lib/server/flowV2Export.ts`). Called by
 * `bake-editor-doc.mjs` right before the deploy mirror runs, gated by the same shared read token as
 * `/api/editor/doc` (`?k=` vs `EDITOR_DOC_SECRET`) — a build runner has the token, no launcher
 * session. Idempotent; safe to re-run per build. An un-authored project exports nothing (parity).
 *
 * The v2 flow is VALIDATED first — the desktop half of the online publish's flow gate — and a flow
 * with errors is refused with a 409 `{ error, reason: 'invalid-flow', details }` before anything is
 * written. `&allowInvalidFlow=1` is the explicit override (the bake's `--allow-invalid-flow`). This
 * route has no user session, only the deploy token, so the override is as restricted as that token
 * (a publisher credential), not to the owner role like the online Publish. A flow of another
 * family than the project's kind (`reason: 'flow-wrong-kind'`) is refused with no override.
 */
export const POST: RequestHandler = async ({ url }) => {
	const secret = await getDeployToken();
	if (!secret) throw error(503, 'Editor flow export is not configured.');
	if (url.searchParams.get('k') !== secret) throw error(401, 'Invalid or missing token.');

	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;

	try {
		const flowCheck = await checkFlowV2ForPublish(clientKey, projectKey);
		const refusal = flowGateRefusal(
			flowCheck,
			await projectGameType(projectKey),
			url.searchParams.get('allowInvalidFlow') === '1',
		);
		if (refusal) {
			return json(
				{ error: refusal.message, reason: refusal.reason, details: refusal.details },
				{ status: 409 },
			);
		}
		if (flowCheck.status === 'invalid') {
			console.warn(
				`[export-flow] ${projectKey}: baked with ${flowCheck.errors.length} flow error(s) by ` +
					`override: ${describeFlowErrors(flowCheck.errors).join(' | ')}`,
			);
		}

		// The export self-gates on "authored", so an un-authored project contributes nothing
		// (parity). Mirrors what the online runtime bundle assembles (`runtimeBundle.ts`).
		const index = await withDeployWrite(projectKey, () =>
			exportEditorFlowV2(clientKey, projectKey),
		);
		return json({ clientKey, projectKey, ...index });
	} catch (e) {
		console.error('export-flow failed:', e);
		throw error(502, 'Failed to export the project flow.');
	}
};
