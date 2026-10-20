import { BUILTIN_TIMELINES, type CinematicDoc } from 'engine-layout';

import { componentTimelinesOf } from '$lib/timeline/screenTimeline';
import { withEditorProject } from './editorProject.client';

/**
 * The component timelines the canvas previews a count-mode repeater's segments with
 * (`segmentPreview.ts`): the built-in ones, overridden by id by the project's, fetched once per
 * component on first ask. A load bumps {@link segmentTimelinesVersion}, which the canvas and the
 * text overlay repaint on. {@link invalidateSegmentTimelines} drops them all, so a timeline saved
 * since is read again.
 */

const version = $state({ n: 0 });
type Row = { id: string; host?: CinematicDoc['host'] };
let listing: Promise<Row[] | null> | null = null;
// Plain caches on purpose: what repaints is `version`, never a read of these.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const loaded = new Map<string, CinematicDoc[]>();
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const pending = new Set<string>();
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const merged = new Map<string, readonly CinematicDoc[]>();
let generation = 0;

export function segmentTimelinesVersion(): number {
	return version.n;
}

export function invalidateSegmentTimelines(): void {
	generation += 1;
	listing = null;
	loaded.clear();
	pending.clear();
	merged.clear();
	version.n += 1;
}

async function load(componentId: string): Promise<void> {
	const at = generation;
	pending.add(componentId);
	listing ??= fetch(withEditorProject('/api/cinematics/list'))
		.then(async (res) => (res.ok ? ((await res.json()) as { cinematics: Row[] }).cinematics : null))
		.catch(() => null);
	const rows = await listing;
	const docs = await Promise.all(
		componentTimelinesOf(rows ?? [], componentId).map(async (row) => {
			const res = await fetch(
				withEditorProject(`/api/cinematics/get?id=${encodeURIComponent(row.id)}`),
			).catch(() => null);
			if (!res?.ok) return null;
			return ((await res.json()) as { doc: CinematicDoc | null }).doc;
		}),
	);
	if (at !== generation) return;
	loaded.set(
		componentId,
		docs.filter((d): d is CinematicDoc => !!d),
	);
	pending.delete(componentId);
	merged.delete(componentId);
	version.n += 1;
}

/** `componentId`'s timelines as far as loaded — the same array until a load changes it. */
export function segmentTimelines(componentId: string): readonly CinematicDoc[] {
	const cached = merged.get(componentId);
	if (cached) return cached;
	if (!loaded.has(componentId) && !pending.has(componentId)) void load(componentId);
	const project = loaded.get(componentId) ?? [];
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const ids = new Set(project.map((d) => d.id));
	const builtin = componentTimelinesOf([...BUILTIN_TIMELINES], componentId).filter(
		(d) => !ids.has(d.id),
	);
	const docs = [...builtin, ...project];
	merged.set(componentId, docs);
	return docs;
}
