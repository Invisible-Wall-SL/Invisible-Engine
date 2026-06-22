/**
 * Shared category metadata + grouping for the component lists rendered by the
 * editor-family tools (the Scene Editor's component picker and the Component
 * Editor's home Library). One source of truth for the category order so the two
 * lists can't drift.
 */
import type { ComponentCategory, ComponentDef } from 'engine-layout';

export const CATEGORIES: { id: ComponentCategory; label: string }[] = [
	{ id: 'ui', label: 'UI' },
	{ id: 'overlay', label: 'Overlay' },
	{ id: 'scenery', label: 'Scenery' },
];

export interface ComponentGroup {
	id: ComponentCategory;
	label: string;
	items: ComponentDef[];
}

/** Components grouped by category, in `CATEGORIES` order, skipping empty groups. */
export function groupComponents(components: ComponentDef[]): ComponentGroup[] {
	return CATEGORIES.map((c) => ({
		...c,
		items: components.filter((d) => d.category === c.id),
	})).filter((g) => g.items.length > 0);
}
