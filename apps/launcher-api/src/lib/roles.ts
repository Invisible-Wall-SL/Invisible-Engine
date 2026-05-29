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
		install: { package: 'comfyui' },
	},
	spine: {
		id: 'spine',
		name: 'Spine Editor',
		description: 'Local Esoteric Spine editor for skeletal animation.',
		kind: 'local',
		install: { package: 'spine' },
	},
	testServer: {
		id: 'testServer',
		name: 'Invisible Test Server',
		description: 'Local RGS lookup/test server for running games offline.',
		kind: 'local',
		install: { package: 'test-server' },
	},
};

/** Which tool ids each role is entitled to. */
const ROLE_TOOLS: Record<Role, string[]> = {
	admin: Object.keys(TOOLS),
	developer: ['atlasTool', 'spineViewer', 'testServer', 'comfyui'],
	artist: ['atlasTool', 'comfyui'],
	animator: ['spineViewer', 'spine'],
};

export function manifestForRole(role: Role): ToolDef[] {
	return (ROLE_TOOLS[role] ?? []).map((id) => TOOLS[id]).filter(Boolean);
}

export function roleHasTool(role: Role, id: string): boolean {
	return (ROLE_TOOLS[role] ?? []).includes(id);
}
