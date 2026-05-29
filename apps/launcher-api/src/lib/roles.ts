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
};

/** Which tool ids each role is entitled to. */
export const ROLE_TOOLS: Record<Role, string[]> = {
	admin: Object.keys(TOOLS),
	developer: ['atlasTool', 'spineViewer', 'comfyui'],
	artist: ['atlasTool', 'comfyui', 'sheetMaker'],
	animator: ['spineViewer', 'spine'],
};

/**
 * Per-user tool overrides: `toolKey -> granted`. A `true` grants a tool the role
 * lacks; a `false` revokes a role default. Missing keys defer to the role.
 */
export type ToolOverrides = Record<string, boolean>;

/** The effective set of tool ids for a role + per-user overrides. */
export function effectiveToolIds(role: Role, overrides: ToolOverrides = {}): string[] {
	const ids = new Set(ROLE_TOOLS[role] ?? []);
	for (const [id, granted] of Object.entries(overrides)) {
		if (!TOOLS[id]) continue;
		if (granted) ids.add(id);
		else ids.delete(id);
	}
	return Object.keys(TOOLS).filter((id) => ids.has(id));
}

export function manifestForRole(role: Role, overrides: ToolOverrides = {}): ToolDef[] {
	return effectiveToolIds(role, overrides)
		.map((id) => TOOLS[id])
		.filter(Boolean);
}

export function roleHasTool(role: Role, id: string, overrides: ToolOverrides = {}): boolean {
	return effectiveToolIds(role, overrides).includes(id);
}

/** Local tools the given role is entitled to (those with an install path). */
export function localToolsForRole(role: Role, overrides: ToolOverrides = {}): ToolDef[] {
	return manifestForRole(role, overrides).filter((t) => t.kind === 'local');
}

/** Doc slug per tool. Docs live in-repo under `docs/tools/<slug>.md`. */
const TOOL_DOC_SLUG: Record<string, string> = {
	atlasTool: 'atlas-maker',
	spineViewer: 'spine-viewer',
	comfyui: 'comfyui',
	spine: 'spine-editor',
	sheetMaker: 'sheet-maker',
};

/** Repo-relative path to a tool's documentation (authored by the docs effort). */
export function toolDocPath(id: string): string {
	return `docs/tools/${TOOL_DOC_SLUG[id] ?? id}.md`;
}
