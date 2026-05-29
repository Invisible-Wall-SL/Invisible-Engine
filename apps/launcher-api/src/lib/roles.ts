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

/** Registry of every tool the platform knows about. */
export const TOOLS: Record<string, ToolDef> = {
	atlasTool: {
		id: 'atlasTool',
		name: 'Invisible Atlas Maker',
		description: 'Online sprite-atlas generator and inspector.',
		kind: 'online',
		url: '/atlas',
	},
	spineViewer: {
		id: 'spineViewer',
		name: 'Invisible Spine Viewer',
		description: 'Online viewer for Spine skeletons and animations.',
		kind: 'online',
		url: '/spine',
	},
	comfyui: {
		id: 'comfyui',
		name: 'ComfyUI',
		description: 'Local node-based image generation/processing (runs on your GPU).',
		kind: 'local',
		install: {
			package: 'comfyui',
			download: 'https://www.comfy.org/download',
			steps: [
				'Download the ComfyUI desktop installer for your OS.',
				'Install and launch it once so it sets up its Python environment.',
				'Note the install folder and save it below so the launcher can find it.',
			],
		},
	},
	spine: {
		id: 'spine',
		name: 'Spine Editor',
		description: 'Local Esoteric Spine editor for skeletal animation.',
		kind: 'local',
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
	},
	localization: {
		id: 'localization',
		name: 'Invisible Localization',
		description: 'Write game text and auto-translate it into many languages (Claude).',
		kind: 'online',
		url: '/localization',
	},
};

/** Which tool ids each role is entitled to. */
export const ROLE_TOOLS: Record<Role, string[]> = {
	admin: Object.keys(TOOLS),
	developer: ['atlasTool', 'spineViewer', 'comfyui', 'localization'],
	artist: ['atlasTool', 'comfyui', 'sheetMaker', 'localization'],
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
};

/** Repo-relative path to a tool's documentation (authored by the docs effort). */
export function toolDocPath(id: string): string {
	return `docs/tools/${TOOL_DOC_SLUG[id] ?? id}.md`;
}
