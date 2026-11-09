import { error, json } from '@sveltejs/kit';
import { requireDeployToken } from './deployToken';
import { exportBody, findExporter } from './exporters';
import { UNASSIGNED_CLIENT } from './projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from './projects';
import { withDeployWrite } from './runtimeBundleCache';

/**
 * `POST /api/editor/export/<id>` — the build-time trigger for ONE exporter (`exporters.ts`): write
 * the project's `deploy/<subtree>/` so the deploy pull that runs next carries it, and answer the
 * index the bake embeds. Gated by the shared deploy token (`?k=`), because a build runner has the
 * token and no launcher session. Idempotent; safe to re-run per build. The legacy
 * `/api/editor/export-<id>` routes are stubs over this.
 */
export async function handleExport(id: string, url: URL): Promise<Response> {
	const exporter = findExporter(id);
	if (!exporter) throw error(404, `No exporter '${id}'.`);
	await requireDeployToken(url, exporter.notConfigured);

	const projectKey = url.searchParams.get('project') || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	const ctx = { clientKey, projectKey };

	try {
		const refusal = await exporter.gate?.(ctx, url);
		if (refusal) return refusal;
		const run = exporter.run as (c: typeof ctx) => Promise<unknown>;
		const result = await withDeployWrite(projectKey, () => run(ctx));
		return json({ clientKey, projectKey, ...exportBody(exporter, result) });
	} catch (e) {
		console.error(`export-${exporter.id} failed:`, e);
		throw error(502, exporter.failed);
	}
}
