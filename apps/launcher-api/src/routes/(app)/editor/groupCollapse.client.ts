/**
 * Tiny localStorage-backed store for which param-group `<details>` sections the
 * author has collapsed, so the open/closed state survives reloads. Editor view
 * state only — never written to the doc. Keyed by `<componentId>:<group>` so the
 * same group name in two components is tracked separately. Default = OPEN (a key
 * is present only when collapsed).
 */
const KEY = 'iw-editor-collapsed-param-groups';

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

/** True when the group should render OPEN (the default for an untouched group). */
export function isParamGroupOpen(key: string): boolean {
	return !collapsed.has(key);
}

/** Persist a group's open/closed state — call from the `<details>` `ontoggle`. */
export function setParamGroupOpen(key: string, open: boolean): void {
	if (open) collapsed.delete(key);
	else collapsed.add(key);
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(KEY, JSON.stringify([...collapsed]));
	} catch {
		/* quota / disabled — ignore */
	}
}
