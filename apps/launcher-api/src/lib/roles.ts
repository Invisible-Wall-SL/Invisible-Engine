export type Role = 'admin' | 'developer' | 'artist' | 'animator';

export const ROLES: Role[] = ['admin', 'developer', 'artist', 'animator'];

export type ToolKind = 'online' | 'local';

export interface ToolDef {
	id: string;
	name: string;
	description: string;
	kind: ToolKind;
	/** Online tools: the private-area URL the launcher opens with the session token. */
	url?: string;
	/** Inline, stroke-based SVG (currentColor) shown on the tool card + onboarding. */
	icon?: string;
	/** Local tools: metadata the launcher uses to download + install on the machine. */
	install?: {
		/** Identifier the launcher knows how to fetch/install (resolved against the shared repo). */
		package: string;
		version?: string;
		/** Public download/installer URL. */
		download: string;
		/** Short, human-readable install steps shown in onboarding. */
		steps: string[];
	};
}

/**
 * Per-tool icons: minimal, stroke-based SVG using `currentColor` so they inherit
 * the card's accent. ~22px, single colour, no fills. Keyed by tool id so the home
 * grid and `/onboarding` render the same mark.
 */
const I = (body: string): string =>
	`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ` +
	`stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const TOOL_ICONS: Record<string, string> = {
	// square grid
	atlasTool: I(
		'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>' +
			'<rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
	),
	// jointed armature segment
	spineViewer: I(
		'<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/>' +
			'<line x1="7.6" y1="16.4" x2="16.4" y2="7.6"/><circle cx="12" cy="12" r="1.3"/>',
	),
	// node graph: two nodes + edge
	comfyui: I(
		'<rect x="3" y="5" width="7" height="5" rx="1"/><rect x="14" y="14" width="7" height="5" rx="1"/>' +
			'<path d="M10 7.5h2.5a2 2 0 0 1 2 2v4"/>',
	),
	// bone (two lobes each end)
	spine: I(
		'<circle cx="6" cy="9" r="1.9"/><circle cx="9" cy="6" r="1.9"/>' +
			'<circle cx="18" cy="15" r="1.9"/><circle cx="15" cy="18" r="1.9"/><line x1="8" y1="8" x2="16" y2="16"/>',
	),
	// packed rectangles
	sheetMaker: I(
		'<rect x="3" y="3" width="9" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/>' +
			'<rect x="14" y="10" width="7" height="4" rx="1"/><rect x="3" y="14" width="13" height="7" rx="1"/>',
	),
	// globe
	localization: I(
		'<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/>' +
			'<path d="M12 3c2.6 2.6 2.6 15.4 0 18"/><path d="M12 3c-2.6 2.6-2.6 15.4 0 18"/>',
	),
	// overlapping shapes (place/arrange)
	editor: I('<rect x="4" y="4" width="11" height="11" rx="1"/><rect x="9" y="9" width="11" height="11" rx="1"/>'),
	// browse list (bulleted rows)
	ftpBrowser: I(
		'<circle cx="5" cy="6" r="1"/><line x1="9" y1="6" x2="20" y2="6"/>' +
			'<circle cx="5" cy="12" r="1"/><line x1="9" y1="12" x2="20" y2="12"/>' +
			'<circle cx="5" cy="18" r="1"/><line x1="9" y1="18" x2="20" y2="18"/>',
	),
};

/** Registry of every tool the platform knows about. */
export const TOOLS: Record<string, ToolDef> = {
	atlasTool: {
		id: 'atlasTool',
		name: 'Invisible Atlas Maker',
		description: 'Online sprite-atlas generator and inspector.',
		kind: 'online',
		url: '/atlas',
		icon: TOOL_ICONS.atlasTool,
	},
	spineViewer: {
		id: 'spineViewer',
		name: 'Invisible Spine Viewer',
		description: 'Online viewer for Spine skeletons and animations.',
		kind: 'online',
		url: '/spine',
		icon: TOOL_ICONS.spineViewer,
	},
	comfyui: {
		id: 'comfyui',
		name: 'ComfyUI',
		description: 'Local node-based image generation/processing (runs on your GPU).',
		kind: 'local',
		icon: TOOL_ICONS.comfyui,
		install: {
			package: 'comfyui',
			download: 'https://github.com/comfyanonymous/ComfyUI/releases/latest',
			steps: [
				'Download the Windows portable build (ComfyUI_windows_portable_nvidia.7z) from the latest release — this is the build the Invisible pipeline uses, not the ComfyUI Desktop app.',
				'Extract the .7z with 7-Zip (https://www.7-zip.org) — Windows cannot open .7z archives on its own.',
				'Run it once so it sets up its embedded Python environment.',
				'Save the path to the extracted ComfyUI folder below (e.g. C:\\…\\ComfyUI_windows_portable\\ComfyUI) so it can be wired up later.',
			],
		},
	},
	spine: {
		id: 'spine',
		name: 'Spine Editor',
		description: 'Local Esoteric Spine editor for skeletal animation.',
		kind: 'local',
		icon: TOOL_ICONS.spine,
		install: {
			package: 'spine',
			download: 'https://esotericsoftware.com/spine-download',
			steps: [
				'Download the Spine installer (a licence is required to launch the editor).',
				'Install Spine and sign in with the studio licence.',
				'Save the install path below.',
			],
		},
	},
	sheetMaker: {
		id: 'sheetMaker',
		name: 'Invisible Sheet Maker',
		description: 'Online sprite-sheet packer for game-ready atlases.',
		kind: 'online',
		url: '/sheet',
		icon: TOOL_ICONS.sheetMaker,
	},
	localization: {
		id: 'localization',
		name: 'Invisible Localization',
		description: 'Write game text and auto-translate it into many languages (Claude).',
		kind: 'online',
		url: '/localization',
		icon: TOOL_ICONS.localization,
	},
	editor: {
		id: 'editor',
		name: 'Invisible Editor',
		description: 'Place images/spine on game screens and export the layout the engine renders.',
		kind: 'online',
		url: '/editor',
		icon: TOOL_ICONS.editor,
	},
	ftpBrowser: {
		id: 'ftpBrowser',
		name: 'Invisible FTP Browser',
		description: "Browse and manage the project's cloud asset storage (upload, move, delete).",
		kind: 'online',
		url: '/files',
		icon: TOOL_ICONS.ftpBrowser,
	},
};

/** Which tool ids each role is entitled to. */
export const ROLE_TOOLS: Record<Role, string[]> = {
	admin: Object.keys(TOOLS),
	developer: ['atlasTool', 'spineViewer', 'comfyui', 'localization', 'editor', 'ftpBrowser'],
	artist: ['atlasTool', 'comfyui', 'sheetMaker', 'localization', 'editor'],
	animator: ['spineViewer', 'spine'],
};

/**
 * Managed capability key for access to the `/admin` panel. It is NOT a tool in
 * `TOOLS` — it never appears in a tool manifest — but it lives in the same
 * override matrix so admins can grant `/admin` access per role. The built-in
 * `admin` role always has it (see `roleHasCapability`) and it can never be revoked.
 */
export const ADMIN_PANEL_CAPABILITY = 'adminPanel';

/** Capabilities managed by the role matrix that are not entries in `TOOLS`. */
export const CAPABILITIES: { key: string; name: string }[] = [
	{ key: ADMIN_PANEL_CAPABILITY, name: 'Admin panel' },
];

/** `ROLE_TOOLS` baseline for a capability key (only `admin` gets `adminPanel`). */
function capabilityDefault(role: Role, key: string): boolean {
	if (key === ADMIN_PANEL_CAPABILITY) return role === 'admin';
	return false;
}

/**
 * Tool/capability overrides: `key -> granted`. A `true` grants something the
 * baseline lacks; a `false` revokes a default. Missing keys defer to the next
 * layer down (role overrides defer to `ROLE_TOOLS`; user overrides defer to role).
 */
export type ToolOverrides = Record<string, boolean>;

/** Apply an override map onto a working id set, ignoring unknown keys. */
function applyOverrides(ids: Set<string>, overrides: ToolOverrides): void {
	for (const [id, granted] of Object.entries(overrides)) {
		if (!TOOLS[id]) continue;
		if (granted) ids.add(id);
		else ids.delete(id);
	}
}

/**
 * The effective set of tool ids for a role, resolved in three layers:
 * `ROLE_TOOLS[role]` defaults → role-level overrides → user-level overrides.
 */
export function effectiveToolIds(
	role: Role,
	roleOverrides: ToolOverrides = {},
	userOverrides: ToolOverrides = {},
): string[] {
	const ids = new Set(ROLE_TOOLS[role] ?? []);
	applyOverrides(ids, roleOverrides);
	applyOverrides(ids, userOverrides);
	return Object.keys(TOOLS).filter((id) => ids.has(id));
}

export function manifestForRole(
	role: Role,
	roleOverrides: ToolOverrides = {},
	userOverrides: ToolOverrides = {},
): ToolDef[] {
	return effectiveToolIds(role, roleOverrides, userOverrides)
		.map((id) => TOOLS[id])
		.filter(Boolean);
}

export function roleHasTool(
	role: Role,
	id: string,
	roleOverrides: ToolOverrides = {},
	userOverrides: ToolOverrides = {},
): boolean {
	return effectiveToolIds(role, roleOverrides, userOverrides).includes(id);
}

/**
 * Effective state of a managed capability (e.g. `adminPanel`) for a role + its
 * role/user overrides. The `admin` role always keeps `adminPanel` — a revoke row
 * is ignored — so admins can never be locked out of `/admin`.
 */
export function roleHasCapability(
	role: Role,
	key: string,
	roleOverrides: ToolOverrides = {},
	userOverrides: ToolOverrides = {},
): boolean {
	if (key === ADMIN_PANEL_CAPABILITY && role === 'admin') return true;
	let granted = capabilityDefault(role, key);
	if (key in roleOverrides) granted = roleOverrides[key];
	if (key in userOverrides) granted = userOverrides[key];
	return granted;
}

/** Local tools the given role is entitled to (those with an install path). */
export function localToolsForRole(
	role: Role,
	roleOverrides: ToolOverrides = {},
	userOverrides: ToolOverrides = {},
): ToolDef[] {
	return manifestForRole(role, roleOverrides, userOverrides).filter((t) => t.kind === 'local');
}

/** Doc slug per tool. Docs live in-repo under `docs/tools/<slug>.md`. */
const TOOL_DOC_SLUG: Record<string, string> = {
	atlasTool: 'atlas-maker',
	spineViewer: 'spine-viewer',
	comfyui: 'comfyui',
	spine: 'spine-editor',
	sheetMaker: 'sheet-maker',
	localization: 'localization',
	editor: 'invisible-editor',
	ftpBrowser: 'ftp-browser',
};

/** Repo-relative path to a tool's documentation (authored by the docs effort). */
export function toolDocPath(id: string): string {
	return `docs/tools/${TOOL_DOC_SLUG[id] ?? id}.md`;
}
