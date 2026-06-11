import {
	ENGINE_STORYBOOK_SEGMENT,
	PROJECT_STORYBOOK_SEGMENT,
	projectStorybookPrefix,
	requireStorybookAccess,
	sharedEngineStorybookPrefix,
	storybookExists,
} from '$lib/server/storybooks';
import type { PageServerLoad } from './$types';

export interface StorybookEntry {
	id: string;
	name: string;
	/** Secondary line on the card (client/project, or "engine reference"). */
	detail: string;
	/** The build's index.html under the gated view route. */
	href: string;
	shared: boolean;
}

/**
 * The picker lists every PUBLISHED storybook the user may open: the shared
 * engine reference (when `_shared/storybook/engine/index.html` exists) plus each
 * accessible project with a `<client>/<project>/storybook/index.html`. The
 * accessible-project set comes from the layout's already-resolved `projects`
 * (the same `accessibleProjects` data every page inherits).
 */
export const load: PageServerLoad = async ({ locals, parent }) => {
	await requireStorybookAccess(locals);
	const { projects } = await parent();

	const [sharedPublished, projectPublished] = await Promise.all([
		storybookExists(sharedEngineStorybookPrefix),
		Promise.all(projects.map((p) => storybookExists(projectStorybookPrefix(p.clientKey, p.key)))),
	]);

	const entries: StorybookEntry[] = [];

	if (sharedPublished) {
		entries.push({
			id: ENGINE_STORYBOOK_SEGMENT,
			name: 'Invisible Engine',
			detail: 'engine reference (apps/lines)',
			href: `/storybook/view/${ENGINE_STORYBOOK_SEGMENT}/index.html`,
			shared: true,
		});
	}

	for (const [i, p] of projects.entries()) {
		if (!projectPublished[i]) continue;
		entries.push({
			id: p.key,
			name: p.name,
			detail: p.clientName ? `${p.clientName} · ${p.key}` : p.key,
			href: `/storybook/view/${PROJECT_STORYBOOK_SEGMENT}/${p.key}/index.html`,
			shared: false,
		});
	}

	return { entries };
};
