/**
 * localStorage-backed store for which left-panel sections (Screens, Elements,
 * Atlases, Spines, Sheets, …) the author has collapsed, so the open/closed state
 * survives reloads. Editor view state only — never written to the doc. Keyed by a
 * stable section id. Default = OPEN (a key is present only when collapsed).
 *
 * Mirrors `groupCollapse.client.ts` (param groups). Native `<details>` manages the
 * show/hide itself, so no reactive state is needed — we only read the initial
 * `open` and persist on `ontoggle`.
 */
const KEY = 'iw-editor-collapsed-panel-sections';

function load(): Set<string> {
	if (typeof localStorage === 'undefined') return new Set();
	try {
		const raw = localStorage.getItem(KEY);
		return new Set(raw ? (JSON.parse(raw) as string[]) : []);
	} catch {
		return new Set();
	}
}

const collapsed = load();

/** True when the section should render OPEN (the default for an untouched section). */
export function isSectionOpen(key: string): boolean {
	return !collapsed.has(key);
}

/** Persist a section's open/closed state — call from the `<details>` `ontoggle`. */
export function setSectionOpen(key: string, open: boolean): void {
	if (open) collapsed.delete(key);
	else collapsed.add(key);
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(KEY, JSON.stringify([...collapsed]));
	} catch {
		/* quota / disabled — ignore */
	}
}
