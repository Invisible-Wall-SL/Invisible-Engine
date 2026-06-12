import { toolBarItems, type ToolDef } from '$lib/roles';
import { ENV } from './env';

/**
 * The redirect params that feed the shared tool bar (`ToolTopBar` on the launcher;
 * the HTML twin in the Python tools + the Spine viewer). The launcher is the
 * single source of truth for the role-gated tool list:
 *
 * - `home` — the emblem target (back to the launcher).
 * - `tools` — url-encoded `[{ id, name, url }]` for every ONLINE tool the user
 *   has, in `TOOL_BAR_ORDER`, with the current tool removed. Every `url` points
 *   back through the launcher origin (e.g. `…/editor`, `…/sheet`); the launcher
 *   re-gates the role and redirects with the right secret + active project, so
 *   no per-tool secret is ever baked into the link (simpler + secrets stay
 *   server-side). See `docs/design/unified-tool-bar.md`.
 *
 * Pass the params straight onto the tool's redirect URL.
 */
export function toolBarParams(tools: ToolDef[], currentId: string): URLSearchParams {
	const origin = ENV.ORIGIN.replace(/\/$/, '');
	const items = toolBarItems(tools, currentId).map((t) => ({
		id: t.id,
		// Bake the short bar label so the Python/Spine HTML twin matches the Svelte bar
		// (it strips a leading "Invisible " itself; an explicit `barName` has none).
		name: t.barName ?? t.name,
		url: origin + (t.url ?? '/'),
	}));
	const params = new URLSearchParams();
	params.set('home', origin);
	params.set('tools', JSON.stringify(items));
	return params;
}
