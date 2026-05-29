import { error } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { objectExists } from './r2';

/** R2 key prefix where the HotFruits spine assets + skeletons.json live. */
export const SPINE_PREFIX = 'spines/hotfruits';

export function requireSpineAccess(locals: App.Locals): void {
	if (!locals.user) throw error(401, 'Not authenticated');
	if (!roleHasTool(locals.user.role, 'spineViewer')) {
		throw error(403, 'Your role does not have access to the Invisible Spine Viewer.');
	}
}

const PAGE_LINE = /^(.+)\.(webp|jpg|jpeg)\s*$/i;

/** Rewrite atlas page refs (`foo.webp`) to a `.png` sibling when it exists in R2
 * (avoids lossy-WebP alpha — mirrors the local tool's _atlas_prefer_png). */
export async function atlasPreferPng(text: string, folder: string): Promise<string> {
	const out: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const m = line.match(PAGE_LINE);
		if (m && (await objectExists(`${SPINE_PREFIX}/${folder}/${m[1]}.png`))) {
			out.push(`${m[1]}.png`);
		} else {
			out.push(line);
		}
	}
	return out.join('\n');
}
