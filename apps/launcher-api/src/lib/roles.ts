export type Role =
	| 'admin'
	| 'developer'
	| 'artist'
	| 'animator'
	| 'pipelineTester'
	| 'localizationReviewer'
	| 'audio';

export const ROLES: Role[] = [
	'admin',
	'developer',
	'artist',
	'animator',
	'pipelineTester',
	'localizationReviewer',
	'audio',
];

/**
 * Human labels for the role ids. Role ids are camelCase like tool ids, so the
 * UI must never print them raw (a `text-transform: capitalize` renders
 * `pipelineTester` as "PipelineTester"). Every surface that shows a role goes
 * through `roleLabel`.
 */
export const ROLE_LABELS: Record<Role, string> = {
	admin: 'Admin',
	developer: 'Developer',
	artist: 'Artist',
	animator: 'Animator',
	pipelineTester: 'Pipeline Tester',
	localizationReviewer: 'Localization Reviewer',
	audio: 'Music / SFX',
};

export function roleLabel(role: string): string {
	return ROLE_LABELS[role as Role] ?? role;
}

/**
 * The game kinds a project can target — mirrors the Invisible Editor's
 * `GAME_TYPES` (and game-spec's `GameTypeSchema`). A project's recorded kind
 * picks its editor template + scaffold projection. Defined ONCE here so the
 * admin create/edit selects and `projectGameType` validation share it. The
 * default when unset is `'lines'`.
 */
export type GameKind = 'lines' | 'ways' | 'cluster' | 'scatter' | 'bookOf';

export const GAME_KINDS: GameKind[] = ['lines', 'ways', 'cluster', 'scatter', 'bookOf'];

export const DEFAULT_GAME_KIND: GameKind = 'lines';

export function isGameKind(value: unknown): value is GameKind {
	return typeof value === 'string' && (GAME_KINDS as string[]).includes(value);
}

export type ToolKind = 'online' | 'local';

export interface ToolDef {
	id: string;
	name: string;
	/** Short label for the cross-tool switcher bar. Defaults to `name` minus the
	 *  "Invisible " prefix; set explicitly when the full name is too long for the bar. */
	barName?: string;
	description: string;
	kind: ToolKind;
	/** Online tools: the private-area URL the launcher opens with the session token. */
	url?: string;
	/**
	 * The `url` REDIRECTS to another document that boots its own CRT splash (the static
	 * `view.html` twin, or a Python tool's `splash_html`). SvelteKit finishes such a
	 * redirect with a full page load, so the launcher must NOT play `<BootSplash>` for
	 * the hop — the screen would run twice, ours and then theirs from the top.
	 * See docs/ui-inventory.md §12.
	 */
	handsOff?: true;
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
	// armature with an edit-handle (rigging)
	rigger: I(
		'<circle cx="5" cy="19" r="1.8"/><line x1="6.3" y1="17.7" x2="11.5" y2="12.5"/>' +
			'<circle cx="13" cy="11" r="1.8"/><line x1="14.3" y1="9.7" x2="17" y2="7"/>' +
			'<rect x="16" y="4" width="3.5" height="3.5" rx="0.6"/>',
	),
	// rocket / launch glyph
	invisibleLauncher: I('<path d="M12 3l4 6h-3v7h-2v-7H8z"/><line x1="7" y1="20" x2="17" y2="20"/>'),
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
	editor: I(
		'<rect x="4" y="4" width="11" height="11" rx="1"/><rect x="9" y="9" width="11" height="11" rx="1"/>',
	),
	// nested squares (a component containing its elements)
	componentEditor: I(
		'<rect x="3" y="3" width="18" height="18" rx="2"/>' +
			'<rect x="7" y="7" width="6" height="6" rx="1"/><rect x="13" y="11" width="4" height="6" rx="1"/>',
	),
	// open book (storybook)
	storybook: I(
		'<path d="M12 6c-1.5-1.6-3.8-2.5-6.5-2.5H4v14h1.5c2.7 0 5 .9 6.5 2.5 1.5-1.6 3.8-2.5 6.5-2.5H20v-14h-1.5c-2.7 0-5 .9-6.5 2.5z"/>' +
			'<line x1="12" y1="6" x2="12" y2="20"/>',
	),
	// browse list (bulleted rows)
	ftpBrowser: I(
		'<circle cx="5" cy="6" r="1"/><line x1="9" y1="6" x2="20" y2="6"/>' +
			'<circle cx="5" cy="12" r="1"/><line x1="9" y1="12" x2="20" y2="12"/>' +
			'<circle cx="5" cy="18" r="1"/><line x1="9" y1="18" x2="20" y2="18"/>',
	),
	// glyph "A" on a baseline (type/font)
	fontMaker: I(
		'<path d="M5 17 9.5 6h1L15 17"/><line x1="6.7" y1="13" x2="13.3" y2="13"/>' +
			'<line x1="4" y1="20" x2="20" y2="20"/>',
	),
	// grid of cells with one highlighted (a symbol×state matrix)
	symbols: I(
		'<rect x="3" y="3" width="18" height="18" rx="2"/>' +
			'<line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>' +
			'<line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>' +
			'<rect x="9.6" y="9.6" width="4.8" height="4.8" rx="0.6" fill="currentColor" stroke="none"/>',
	),
	// connected nodes (a presentation flow graph)
	flow: I(
		'<rect x="3" y="4" width="6" height="5" rx="1"/><rect x="15" y="9" width="6" height="5" rx="1"/>' +
			'<rect x="3" y="15" width="6" height="5" rx="1"/><path d="M9 6.5h3a2 2 0 0 1 2 2v1"/>' +
			'<path d="M9 17.5h3a2 2 0 0 0 2-2v-1"/>',
	),
	// radiating spark burst (particle effect)
	fx: I(
		'<path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/>' +
			'<path d="M5.6 5.6l2.8 2.8"/><path d="M15.6 15.6l2.8 2.8"/>' +
			'<path d="M18.4 5.6l-2.8 2.8"/><path d="M8.4 15.6l-2.8 2.8"/><circle cx="12" cy="12" r="1.6"/>',
	),
	// film strip with sprocket holes (frame-by-frame animation)
	flipbook: I(
		'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>' +
			'<path d="M7 5v4"/><path d="M11 5v4"/><path d="M15 5v4"/><path d="M7 15v4"/>' +
			'<path d="M11 15v4"/><path d="M15 15v4"/>',
	),
	// speech bubble over a coin (what the game SAYS about a win)
	winText: I(
		'<path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2z"/>' +
			'<line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="11.5" x2="13" y2="11.5"/>',
	),
	// game controller / play (create + publish a playable game)
	gameMaker: I(
		'<rect x="2" y="7" width="20" height="10" rx="4"/><line x1="7" y1="12" x2="9" y2="12"/>' +
			'<line x1="8" y1="11" x2="8" y2="13"/><circle cx="15.5" cy="11" r="0.9" fill="currentColor" stroke="none"/>' +
			'<circle cx="17.5" cy="13" r="0.9" fill="currentColor" stroke="none"/>',
	),
	// three round nodes wired together (a ComfyUI generation graph)
	comfyui: I(
		'<circle cx="5" cy="7" r="2"/><circle cx="5" cy="17" r="2"/><circle cx="17" cy="12" r="2"/>' +
			'<path d="M7 7.6l8 3.2"/><path d="M7 16.4l8-3.2"/><path d="M19 12h2"/>',
	),
	// reel grid with a sliders overlay (the game's math contract: symbols, paylines, strips)
	gameConfig: I(
		'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="M15 4v16"/>' +
			'<path d="M3 9.5h18"/><path d="M3 14.5h18"/>',
	),
};

/** Registry of every tool the platform knows about. */
export const TOOLS: Record<string, ToolDef> = {
	atlasTool: {
		id: 'atlasTool',
		name: 'Invisible Atlas Maker',
		description:
			"AI-generate a game's atlas art region by region — prompts, seeds and variants — then pack and deploy the sheet.",
		kind: 'online',
		url: '/atlas',
		handsOff: true,
		icon: TOOL_ICONS.atlasTool,
	},
	spineViewer: {
		id: 'spineViewer',
		name: 'Invisible Spine Viewer',
		description: 'Online viewer for Spine skeletons and animations.',
		kind: 'online',
		url: '/spine',
		handsOff: true,
		icon: TOOL_ICONS.spineViewer,
	},
	rigger: {
		id: 'rigger',
		name: 'Invisible Rigger',
		description:
			'Online rig editor — build bones, meshes and weights over your art, animate them on a dopesheet, and save a Spine-compatible rig the game plays.',
		kind: 'online',
		url: '/rigger',
		handsOff: true,
		icon: TOOL_ICONS.rigger,
	},
	invisibleLauncher: {
		id: 'invisibleLauncher',
		name: 'Invisible Launcher',
		description:
			'Desktop app that installs/updates ComfyUI + starts the Cloudflare tunnel for the cloud pipeline.',
		kind: 'local',
		icon: TOOL_ICONS.invisibleLauncher,
		install: {
			package: 'invisible-launcher',
			download: '/api/launcher/download',
			steps: [
				'Download and run the Invisible Launcher (Windows .exe — no install needed).',
				'In the launcher, click “Install / Update ComfyUI” to fetch the correct portable ComfyUI build automatically.',
				'Click “Start tunnel” so the cloud Atlas Maker can reach your GPU.',
			],
		},
	},
	comfyui: {
		id: 'comfyui',
		name: 'ComfyUI',
		description:
			'Cloud ComfyUI on a RunPod GPU — build and test generation networks, then export them as Atlas Maker blueprints.',
		kind: 'online',
		url: '/comfyui',
		icon: TOOL_ICONS.comfyui,
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
		handsOff: true,
		icon: TOOL_ICONS.sheetMaker,
	},
	localization: {
		id: 'localization',
		name: 'Invisible Localization',
		description:
			'Write game text, auto-translate it into many languages with Claude, and review each line before it ships.',
		kind: 'online',
		url: '/localization',
		icon: TOOL_ICONS.localization,
	},
	winText: {
		id: 'winText',
		name: 'Invisible Win Text',
		description: 'Author what the game says about a win — per symbol and match count.',
		kind: 'online',
		url: '/win-text',
		icon: TOOL_ICONS.winText,
	},
	gameConfig: {
		id: 'gameConfig',
		name: 'Invisible Game Config',
		description:
			"The game's math contract: symbols and paytable, win model (lines/ways/cluster/scatter), grid, paylines, bet modes, big-win tiers.",
		kind: 'online',
		url: '/config',
		icon: TOOL_ICONS.gameConfig,
	},
	editor: {
		id: 'editor',
		name: 'Invisible Scene Editor',
		description:
			'Place art, spine, text and components on game screens and export the layout the engine renders.',
		kind: 'online',
		url: '/editor',
		icon: TOOL_ICONS.editor,
	},
	ftpBrowser: {
		id: 'ftpBrowser',
		name: 'Invisible FTP Browser',
		description:
			"Browse and manage the project's cloud asset storage (upload, download, move, delete).",
		kind: 'online',
		url: '/files',
		icon: TOOL_ICONS.ftpBrowser,
	},
	storybook: {
		id: 'storybook',
		name: 'Invisible Storybook',
		description: 'Browse published Storybook builds — engine reference and per-project.',
		kind: 'online',
		url: '/storybook',
		icon: TOOL_ICONS.storybook,
	},
	componentEditor: {
		id: 'componentEditor',
		name: 'Invisible Component Editor',
		description:
			'Author reusable game components — edit their elements and bind the engine variables.',
		kind: 'online',
		url: '/components',
		icon: TOOL_ICONS.componentEditor,
	},
	fontMaker: {
		id: 'fontMaker',
		name: 'Invisible Font Maker',
		description:
			'Import a BMFont or bake one from a TTF/OTF, preview it live, and save the fonts your games use.',
		kind: 'online',
		url: '/fonts',
		icon: TOOL_ICONS.fontMaker,
	},
	symbols: {
		id: 'symbols',
		name: 'Invisible Symbols State Machine',
		barName: 'Symbols SM',
		description:
			'Rebind each symbol×state to a sprite frame, a spine animation or a flipbook clip from R2.',
		kind: 'online',
		url: '/symbols',
		icon: TOOL_ICONS.symbols,
	},
	gameMaker: {
		id: 'gameMaker',
		name: 'Invisible Game Maker',
		barName: 'Game Maker',
		description: 'Create a project from a game-type template and publish it as a playable game.',
		kind: 'online',
		url: '/game-maker',
		icon: TOOL_ICONS.gameMaker,
	},
	flow: {
		id: 'flow',
		name: 'Invisible Flow',
		barName: 'Flow',
		description:
			"Author a game's presentation flow as a node graph — events, actions, cues, delays and screens wired with exec + data pins — that drives the game at runtime.",
		kind: 'online',
		url: '/flow-v2',
		icon: TOOL_ICONS.flow,
	},
	fx: {
		id: 'fx',
		name: 'Invisible FX',
		barName: 'FX',
		description:
			'Author particle effects — tune emitter layers live in a WebGL preview, draw particle art from project atlases, pin a layer to a Spine bone, and save an effect the game can fire.',
		kind: 'online',
		url: '/fx',
		icon: TOOL_ICONS.fx,
	},
	flipbook: {
		id: 'flipbook',
		name: 'Invisible Flipbook',
		barName: 'Flipbook',
		description:
			'Author frame animations from an atlas sheet — order the frames, set the rate, preview it playing, and save a clip that FX and the Symbols State Machine can reference.',
		kind: 'online',
		url: '/flipbook',
		icon: TOOL_ICONS.flipbook,
	},
};

export type ToolStage = {
	id: string;
	/** Section heading in the home grid. */
	label: string;
	/** Accent colour: the home section's border/header, and the tool's icon tint in the top bar. */
	accent: string;
	/** Online tool ids in this stage, in display order. */
	tools: string[];
};

/**
 * Online tools grouped by game-making stage. This is the SINGLE source of truth for
 * both grouping and ordering: the home grid renders one labelled, colour-accented
 * section per stage, and the top-bar switcher colour-codes each tool's icon by its
 * stage accent (no section chrome in the bar itself — just the tint; stages sit
 * adjacent so the colours read as bands). `TOOL_BAR_ORDER` is DERIVED from this, so
 * a tool is placed, ordered, and coloured by editing ONE list. Any online tool
 * missing from every stage falls into a synthetic "Other" bucket at the end (see the
 * home grid) so it can never silently vanish. See `docs/design/unified-tool-bar.md`.
 */
export const TOOL_STAGES: ToolStage[] = [
	{ id: 'create', label: 'Create', accent: '#7ee787', tools: ['gameMaker', 'gameConfig'] },
	{
		id: 'assets',
		label: 'Assets',
		accent: '#f5b95c',
		tools: ['atlasTool', 'comfyui', 'sheetMaker', 'fontMaker', 'rigger', 'flipbook', 'fx'],
	},
	{
		id: 'build',
		label: 'Build',
		accent: '#6ea8ff',
		tools: ['editor', 'flow', 'symbols', 'componentEditor', 'winText', 'localization'],
	},
	{
		id: 'reference',
		label: 'Files & Reference',
		accent: '#9aa4b8',
		tools: ['spineViewer', 'storybook', 'ftpBrowser'],
	},
];

/** The stage a tool belongs to, or `undefined` if it isn't placed in one. */
export function stageOfTool(id: string): ToolStage | undefined {
	return TOOL_STAGES.find((s) => s.tools.includes(id));
}

/** Stage accent colour for a tool — used to tint the top-bar switcher icon. */
export function toolAccent(id: string): string {
	return stageOfTool(id)?.accent ?? '#8a8a93';
}

/**
 * Order of the cross-tool switcher in the shared top bar (`ToolTopBar`). Derived
 * from `TOOL_STAGES` (stage order, then within-stage order) so it stays a single
 * source with the home grid; lists ONLY online tools (local installs have no
 * in-browser URL). The Python tools mirror this order via the launcher-baked
 * `tools=` redirect param.
 */
export const TOOL_BAR_ORDER: string[] = TOOL_STAGES.flatMap((s) => s.tools);

/**
 * The switcher items for the top bar: the user's online tools in
 * `TOOL_BAR_ORDER`, with the current tool removed. `tools` is the effective
 * manifest (`data.tools` from the authed layout). `currentId` is the tool the
 * bar is rendered inside (omit on the launcher home).
 */
export function toolBarItems(tools: ToolDef[], currentId?: string): ToolDef[] {
	const have = new Map(tools.filter((t) => t.kind === 'online').map((t) => [t.id, t]));
	return TOOL_BAR_ORDER.map((id) => have.get(id)).filter(
		(t): t is ToolDef => !!t && t.id !== currentId,
	);
}

/** Which tool ids each role is entitled to. */
export const ROLE_TOOLS: Record<Role, string[]> = {
	admin: Object.keys(TOOLS),
	developer: [
		'gameMaker',
		'atlasTool',
		'comfyui',
		'spineViewer',
		'rigger',
		'invisibleLauncher',
		'localization',
		'winText',
		'gameConfig',
		'editor',
		'flow',
		'fx',
		'flipbook',
		'symbols',
		'componentEditor',
		'fontMaker',
		'ftpBrowser',
		'storybook',
	],
	artist: [
		'atlasTool',
		'comfyui',
		'invisibleLauncher',
		'sheetMaker',
		'localization',
		'winText',
		'gameConfig',
		'editor',
		'flow',
		'fx',
		'flipbook',
		'symbols',
		'componentEditor',
		'fontMaker',
	],
	animator: ['spineViewer', 'rigger', 'spine'],
	pipelineTester: [
		'gameMaker',
		'gameConfig',
		'editor',
		'flow',
		'fx',
		'flipbook',
		'symbols',
		'componentEditor',
		'atlasTool',
		'sheetMaker',
		'fontMaker',
		'spineViewer',
		'localization',
		'winText',
		'ftpBrowser',
		'storybook',
		'invisibleLauncher',
	],
	localizationReviewer: ['localization', 'winText'],
	audio: ['ftpBrowser', 'storybook', 'invisibleLauncher'],
};

/**
 * Managed capability key for access to the `/admin` panel. It is NOT a tool in
 * `TOOLS` — it never appears in a tool manifest — but it lives in the same
 * override matrix so admins can grant `/admin` access per role. The built-in
 * `admin` role always has it (see `roleHasCapability`) and it can never be revoked.
 */
export const ADMIN_PANEL_CAPABILITY = 'adminPanel';

/**
 * Managed capability key for publishing to the shared Invisible Blueprints
 * library (`_shared/blueprints/` in R2). Like `adminPanel` it is NOT a tool in
 * `TOOLS`; it lives in the same override matrix so admins can grant publish
 * rights per role. Default-ON for `admin` only — every authed user can still
 * READ the shared library (that gate lives in `toolScope.ts`), but only holders
 * of this capability may WRITE/overwrite/delete a blueprint.
 */
export const BLUEPRINT_PUBLISH_CAPABILITY = 'blueprintPublish';

/**
 * Managed capability key for publishing to the shared Invisible Font library
 * (`_shared/fonts/` in R2). Like `blueprintPublish` it is NOT a tool in `TOOLS`;
 * it lives in the same override matrix so admins can grant publish rights per
 * role. Default-ON for `admin` only — every Font Maker user can still READ the
 * shared library (that gate lives in `toolScope.ts` via `includeSharedFonts`),
 * but only holders of this capability may WRITE/overwrite/delete a shared font.
 * `includeSharedFonts` alone is NOT a write gate (it only widens the read/PUT
 * allow-list), so the font endpoints check this capability explicitly.
 */
export const FONT_PUBLISH_CAPABILITY = 'fontPublish';

/**
 * Managed capability key for fetching the shared build/deploy token from
 * `GET /api/launcher/deploy-token` (used by the desktop launcher to authenticate
 * game builds: `bake:doc` / `pull:assets` / editor exports). Like `fontPublish`
 * it is NOT a tool in `TOOLS`; it lives in the same override matrix. Default-ON
 * for `admin` only. NOTE: this capability GATES an endpoint that previously every
 * signed-in user could read — granting build/publish power is now explicit.
 */
export const GAME_PUBLISH_CAPABILITY = 'gamePublish';

/**
 * Managed capability key for publishing to the shared Invisible Component library
 * (`_shared/editor-components/` in R2). Like `fontPublish`/`blueprintPublish` it is
 * NOT a tool in `TOOLS`; it lives in the same override matrix so admins can grant
 * publish rights per role. Default-ON for `admin` only — every Component Editor user
 * still READS the shared library (`toolScope.gate('editor')`), and PROJECT-scoped
 * saves stay open to that gate, but only holders of this capability may WRITE/
 * overwrite/delete a SHARED component (promote it repo-wide). The `editor` tool gate
 * alone is NOT a shared-write gate; the component endpoint checks this explicitly.
 */
export const COMPONENT_PUBLISH_CAPABILITY = 'componentPublish';

/** Capabilities managed by the role matrix that are not entries in `TOOLS`. */
export const CAPABILITIES: { key: string; name: string }[] = [
	{ key: ADMIN_PANEL_CAPABILITY, name: 'Admin panel' },
	{ key: BLUEPRINT_PUBLISH_CAPABILITY, name: 'Publish blueprints' },
	{ key: FONT_PUBLISH_CAPABILITY, name: 'Publish shared fonts' },
	{ key: GAME_PUBLISH_CAPABILITY, name: 'Build & publish games' },
	{ key: COMPONENT_PUBLISH_CAPABILITY, name: 'Publish shared components' },
];

/**
 * `ROLE_TOOLS` baseline for a capability key. Admin-only capabilities
 * (`adminPanel`, `blueprintPublish`, `fontPublish`, `gamePublish`,
 * `componentPublish`) default ON for `admin` and OFF elsewhere.
 */
function capabilityDefault(role: Role, key: string): boolean {
	if (key === ADMIN_PANEL_CAPABILITY) return role === 'admin';
	if (key === BLUEPRINT_PUBLISH_CAPABILITY) return role === 'admin';
	if (key === FONT_PUBLISH_CAPABILITY) return role === 'admin';
	if (key === GAME_PUBLISH_CAPABILITY) return role === 'admin';
	if (key === COMPONENT_PUBLISH_CAPABILITY) return role === 'admin';
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
	comfyui: 'comfyui',
	spineViewer: 'spine-viewer',
	rigger: 'rigger',
	invisibleLauncher: 'invisible-launcher',
	spine: 'spine-editor',
	sheetMaker: 'sheet-maker',
	localization: 'localization',
	winText: 'win-text',
	gameConfig: 'game-config',
	editor: 'invisible-editor',
	ftpBrowser: 'ftp-browser',
	componentEditor: 'component-editor',
	fontMaker: 'font-maker',
	storybook: 'storybook',
	symbols: 'symbols-state-machine',
	gameMaker: 'game-maker',
	flow: 'flow',
	fx: 'fx',
	flipbook: 'flipbook',
};

/**
 * Launcher route that renders a tool's documentation. The guide markdown is
 * authored in-repo under `docs/tools/<slug>.md`; `/docs/<slug>` serves it as a
 * full page behind the auth gate (see `src/routes/(app)/docs/[slug]`).
 */
export function toolDocPath(id: string): string {
	return `docs/${TOOL_DOC_SLUG[id] ?? id}`;
}
