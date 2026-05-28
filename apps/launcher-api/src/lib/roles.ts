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
		name: 'Atlas Tool',
		description: 'Online sprite-atlas packer and inspector.',
		kind: 'online',
		url: 'https://atlas.invisiblewall.org',
	},
	spineViewer: {
		id: 'spineViewer',
		name: 'Spine Viewer',
		description: 'Online viewer for Spine skeletons and animations.',
		kind: 'online',
		url: 'https://spine.invisiblewall.org',
	},
	pipelineUI: {
		id: 'pipelineUI',
		name: 'Pipeline',
		description: 'Online pipeline dashboard: jobs, assets, game specs.',
		kind: 'online',
		url: 'https://app.invisiblewall.org/pipeline',
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
		name: 'Local Test Server',
		description: 'Local RGS lookup/test server for running games offline.',
		kind: 'local',
		install: { package: 'test-server' },
	},
};

/** Which tool ids each role is entitled to. */
const ROLE_TOOLS: Record<Role, string[]> = {
	admin: Object.keys(TOOLS),
	developer: ['pipelineUI', 'atlasTool', 'spineViewer', 'testServer', 'comfyui'],
	artist: ['pipelineUI', 'atlasTool', 'comfyui'],
	animator: ['pipelineUI', 'spineViewer', 'spine'],
};

export function manifestForRole(role: Role): ToolDef[] {
	return (ROLE_TOOLS[role] ?? []).map((id) => TOOLS[id]).filter(Boolean);
}
