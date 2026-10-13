import { json } from '@sveltejs/kit';
import type { FlowDoc } from 'engine-flow-v2';
import {
	instanceDefResolver,
	projectFlowInstances,
	syncFlowContainers,
} from '$lib/flowV2Projection';
import { listComponents } from '$lib/server/componentStorage';
import { loadDoc } from '$lib/server/editorStorage';
import { loadFlowV2Doc } from '$lib/server/flowV2Storage';
import { withPlacedComponentVersions } from '$lib/server/flowV2Validation';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * The placed, named component instances of the session's project as Flow sees them
 * (`projectFlowInstances`, keyed by placed node id) — what the `/flow-v2` loader returns at page
 * load, re-read on demand so the open editor follows a component edited in `/editor` meanwhile:
 * the page refetches when its tab is shown again, the instance nodes re-derive their pins, and a
 * wire to a pin that is gone turns red. Same auth + scope as the flow save (`gate`, the `flow`
 * tool). Containers are the stored flow's, synced with every screen, as the loader does.
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'flow',
		forbiddenMessage: 'Your role does not have access to Invisible Flow.',
	});
	const [layout, components, stored] = await Promise.all([
		loadDoc(clientKey, projectKey),
		listComponents({ projectKey }),
		loadFlowV2Doc(clientKey, projectKey),
	]);
	const scenes = layout.scenes ?? [];
	const doc: FlowDoc = stored
		? (JSON.parse(JSON.stringify(stored)) as FlowDoc)
		: {
				version: 2,
				templateId: layout.gameType ?? '',
				graph: { nodes: [], exec: [], data: [] },
				containers: [],
			};
	syncFlowContainers(doc, scenes);
	const instances = projectFlowInstances(
		doc.containers,
		scenes,
		instanceDefResolver(await withPlacedComponentVersions(projectKey, scenes, components)),
	);
	return json({ projectKey, instances });
};
