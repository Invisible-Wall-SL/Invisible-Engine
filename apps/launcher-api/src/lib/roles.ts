export type Role = 'admin' | 'developer' | 'artist' | 'animator';

export const ROLES: Role[] = ['admin', 'developer', 'artist', 'animator'];

export type ToolKind = 'online' | 'local';

/**
 * Placeholder used where a real download URL for a local tool is not yet known.
 * TODO(owner): replace each `download: DOWNLOAD_TODO` below with the real
 * installer/download URL. The UI renders these as "coming soon" rather than a
 * live link, so we never ship a fabricated URL.
 */
export const DOWNLOAD_TODO = '';

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
		/** Public download/installer URL. Empty (`DOWNLOAD_TODO`) until the owner supplies it. */
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
	testServer: {
		id: 'testServer',
		name: 'Invisible Test Server',
		description: 'Local RGS lookup/test server for running games offline.',
		kind: 'local',
		install: {
			package: 'test-server',
			download: DOWNLOAD_TODO,
			steps: [
				'Download the Invisible Test Server bundle (ask an admin until the link is live).',
				'Unzip it somewhere stable on your machine.',
				'Save the folder path below so the launcher can start it.',
			],
		},
	},
	sheetMaker: {
		id: 'sheetMaker',
		name: 'Invisible Sheet Maker',
		description: 'Local sprite-sheet packer for game-ready atlases.',
		kind: 'local',
		install: {
			package: 'sheet-maker',
			download: DOWNLOAD_TODO,
			steps: [
				'Download the Invisible Sheet Maker bundle (ask an admin until the link is live).',
				'Unzip it somewhere stable on your machine.',
				'Save the folder path below.',
			],
		},
	},
};

/** Which tool ids each role is entitled to. */
const ROLE_TOOLS: Record<Role, string[]> = {
	admin: Object.keys(TOOLS),
	developer: ['atlasTool', 'spineViewer', 'testServer', 'comfyui'],
	artist: ['atlasTool', 'comfyui', 'sheetMaker'],
	animator: ['spineViewer', 'spine'],
};

export function manifestForRole(role: Role): ToolDef[] {
	return (ROLE_TOOLS[role] ?? []).map((id) => TOOLS[id]).filter(Boolean);
}

export function roleHasTool(role: Role, id: string): boolean {
	return (ROLE_TOOLS[role] ?? []).includes(id);
}

/** Local tools the given role is entitled to (those with an install path). */
export function localToolsForRole(role: Role): ToolDef[] {
	return manifestForRole(role).filter((t) => t.kind === 'local');
}

/** Doc slug per tool. Docs live in-repo under `docs/tools/<slug>.md`. */
const TOOL_DOC_SLUG: Record<string, string> = {
	atlasTool: 'atlas-maker',
	spineViewer: 'spine-viewer',
	comfyui: 'comfyui',
	spine: 'spine-editor',
	testServer: 'test-server',
	sheetMaker: 'sheet-maker',
};

/** Repo-relative path to a tool's documentation (authored by the docs effort). */
export function toolDocPath(id: string): string {
	return `docs/tools/${TOOL_DOC_SLUG[id] ?? id}.md`;
}
