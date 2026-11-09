import { error, redirect } from '@sveltejs/kit';
import { ENV } from '$lib/server/env';
import { toolGuide } from '$lib/server/toolGuides';
import { renderToolDoc } from '$lib/server/toolDocLinks';
import type { PageServerLoad } from './$types';

/** Turn a `<slug>` into a readable page title (e.g. `atlas-maker` → `Atlas Maker`). */
function titleFromSlug(slug: string): string {
	return slug
		.split('-')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) throw redirect(303, '/login');

	const source = toolGuide(params.slug);
	if (source === undefined) {
		throw error(404, `No guide found for “${params.slug}”.`);
	}

	const html = await renderToolDoc(source, `https://github.com/${ENV.GITHUB_ENGINE_REPO}`);
	return { slug: params.slug, title: titleFromSlug(params.slug), html };
};
