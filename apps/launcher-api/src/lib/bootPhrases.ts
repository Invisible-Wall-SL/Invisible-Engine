/**
 * WORK phrase pools for the CRT boot splash (`BootSplash.svelte`).
 *
 * Each line is typed as `> <phrase> ....... [ OK ]` while a tool boots. The pool
 * is shuffled and looped, so it only needs to be long enough to feel varied —
 * never long enough to "cover" a slow boot.
 *
 * Mirrors `services/_shared/iw_common/splash.py`'s `DEFAULT_PHRASES` idea for
 * the Python tools (Atlas / Sheet Maker keep their own pool over there — the two
 * origins can't share code, same as the tool-bar and colour-field twins).
 */

/** Lines that fit ANY tool — appended to every per-tool pool. */
const SHARED: readonly string[] = [
	'Heating cathode-ray tube',
	'Allocating phosphor buffer',
	'Calibrating scanlines',
	'Resolving active project',
	'Checking session token',
	'Mounting cloud asset store',
	'Hydrating UI state',
	'Defragmenting pixel cache',
	'Brewing fresh phosphor green',
	'Reticulating splines',
	'Annealing the random generator',
];

/** Fallback pool for a tool with no bespoke lines. */
export const DEFAULT_BOOT_PHRASES: readonly string[] = [
	'Waking the Invisible Wall',
	'Reading tool manifest',
	'Negotiating with the launcher',
	'Warming the render surface',
	...SHARED,
];

/** Bespoke lines per tool id (`ToolDef.id` in `roles.ts`). */
const TOOL_PHRASES: Record<string, readonly string[]> = {
	editor: [
		'Loading scene document',
		'Walking the node tree',
		'Resolving layout profiles',
		'Snapping coordinate boxes',
		'Measuring text boxes',
		'Indexing atlases and sheets',
		'Binding spine skeletons',
		'Acquiring the edit lease',
	],
	flow: [
		'Loading flow graph',
		'Tracing exec wires',
		'Resolving node pins',
		'Sorting z-banded containers',
		'Checking for dangling edges',
		'Compiling the presentation machine',
	],
	fx: [
		'Loading effect document',
		'Spawning particle emitters',
		'Blending additive layers',
		'Seeding the emission curve',
		'Priming the sprite atlas',
	],
	symbols: [
		'Loading symbol map',
		'Wiring symbol states',
		'Fetching win-frame spines',
		'Aligning highlight overlays',
		'Counting paying symbols',
	],
	componentEditor: [
		'Loading component library',
		'Unpacking component definitions',
		'Resolving authored params',
		'Rebuilding nested instances',
	],
	fontMaker: [
		'Loading font library',
		'Rasterising glyph pages',
		'Measuring kerning pairs',
		'Baking the font descriptor',
	],
	localization: [
		'Loading string table',
		'Counting untranslated keys',
		'Waking the translator',
		'Checking review status',
	],
	winText: ['Loading win-text templates', 'Resolving symbol names', 'Expanding match-count rows'],
	gameConfig: [
		'Loading game configuration',
		'Reading bet modes',
		'Unrolling payline definitions',
		'Verifying win tiers',
	],
	gameMaker: [
		'Loading project scaffold',
		'Polling the build queue',
		'Checking the engine runtime',
		'Reading publish history',
	],
	ftpBrowser: [
		'Mounting project bucket',
		'Listing remote directory',
		'Counting objects',
		'Checking write scope',
	],
	flipbook: ['Loading flipbook document', 'Decoding frame sequence', 'Timing the playhead'],
	comfyui: [
		'Pinging the GPU pod',
		'Probing GPU memory',
		'Warming up Stable Diffusion',
		'Opening the tunnel',
	],
	rigger: [
		'Loading rig library',
		'Assembling bone hierarchy',
		'Triangulating meshes',
		'Binding vertex weights',
		'Rewinding the dopesheet',
	],
	spineViewer: [
		'Loading skeleton index',
		'Parsing atlas pages',
		'Warming the WebGL context',
		'Rewinding animation tracks',
	],
	atlasTool: ['Reading atlas config', 'Negotiating with ComfyUI', 'Walking manifest directory'],
	sheetMaker: [
		'Greasing the atlas packer',
		'Packing sprite rectangles',
		'Trimming transparent gutters',
	],
	storybook: ['Loading component stories', 'Building the story index'],
};

/** The WORK pool for a tool id — bespoke lines first, shared flavour after. */
export function bootPhrases(toolId: string | null | undefined): readonly string[] {
	const own = toolId ? TOOL_PHRASES[toolId] : undefined;
	return own ? [...own, ...SHARED] : DEFAULT_BOOT_PHRASES;
}
