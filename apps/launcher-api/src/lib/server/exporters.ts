/**
 * The deploy EXPORTERS — every asset class a game ships from R2, in one list (CLAUDE.md rule 8).
 *
 * An exporter turns what an author made into the project's `deploy/<subtree>/` (which
 * `pull-project-assets.mjs` mirrors into a game's `static/assets/`) and returns the index the game
 * registers. It runs on two paths, and this list is what keeps them the same set:
 *   - the online runtime assemble (`runtimeBundle.ts`) runs EVERY entry, in one pass that shares a
 *     page store and the authored cinematics;
 *   - the desktop/standalone bake (`scripts/bake-editor-doc.mjs`) POSTs each entry's id to
 *     `/api/editor/export/<id>` (`exportRoute.ts`), one exporter per request, and embeds the body.
 * The old per-class URLs (`/api/editor/export-<id>`) stay as stubs over the same handler: an older
 * engine submodule in a game repo still calls them.
 *
 * Adding an asset class = one entry here, plus its line in `scripts/lib/bakeExports.mjs` (and a
 * reader in the bake) and the game's runtime register. `check:exporter-registry` fails until the
 * registry, the bake and the runtime assemble agree. See `docs/design/live-assets.md`.
 */
import { json } from '@sveltejs/kit';
import { normalizeResolutionTiers } from 'engine-layout';
import type { BootSplashIndex } from 'constants-shared/bootSplash';
import { exportBootSplashes } from './bootSplashExport';
import {
	cinematicRigNames,
	exportCinematics,
	loadAuthoredCinematics,
	type AuthoredCinematics,
	type CinematicExportIndex,
} from './cinematicExport';
import { exportEditorArt, type EditorArtIndex } from './editorArtExport';
import { loadDoc } from './editorStorage';
import { exportEffects, type EffectExportIndex } from './effectExport';
import { exportClips, type FlipbookExportIndex } from './flipbookExport';
import { exportEditorFlowV2, type FlowV2ExportIndex } from './flowV2Export';
import { checkFlowV2ForPublish, describeFlowErrors, flowGateRefusal } from './flowV2Validation';
import { exportEditorFonts, type FontExportIndex } from './fontExport';
import { PageStore } from './pageStore';
import { SUB } from './projectPaths';
import { projectGameType } from './projects';
import { exportRigFlipbooks, type RigFlipbookManifest } from './rigFlipbookExport';
import { exportRigFx, type RigFxManifest } from './rigFxExport';
import { exportShaders, type ShaderExportIndex } from './shaderExport';
import { exportProjectSounds, type SoundExportIndex } from './soundExport';
import { exportEditorSymbols, type SymbolExportResult } from './symbolExport';

/** What one exporter run is given. */
export interface ExportContext {
	clientKey: string;
	projectKey: string;
	/** Per-step milliseconds (`/api/editor/runtime`'s `Server-Timing`); absent ⇒ untimed. */
	timings?: Record<string, number>;
	/** Set by the runtime assemble only. A route call runs ONE exporter and has no pass to share. */
	pass?: ExportPass;
}

/** What the exporters of one runtime assemble share. Promises, so nothing waits that need not. */
export interface ExportPass {
	/**
	 * ONE content-addressed page store for the pass. `art` and `symbols` both export rig bundles
	 * side by side, and a page used by both must be written — and loaded on the GPU — once. The
	 * pass owner prunes `_pages/` after every {@link Exporter.claimsPages} entry has finished.
	 */
	pageStore: Promise<PageStore>;
	/** The authored cinematics, loaded once: `cinematics` ships them and `art` ships their rigs. */
	cinematics: Promise<AuthoredCinematics>;
}

export interface Exporter<Id extends string, R> {
	/** `/api/editor/export/<id>` (and the legacy `/api/editor/export-<id>`), and the bake's key. */
	readonly id: Id;
	/** The runtime assemble's timing step for this exporter. */
	readonly label: string;
	/** Export fresh into `deploy/`, pruning what no longer ships; return what the bundle embeds. */
	readonly run: (ctx: ExportContext) => Promise<R>;
	/**
	 * What {@link run} returns for a project that authored none of this class. The bake must embed
	 * nothing for it — a never-authored project's bundle stays byte-identical (parity).
	 */
	readonly emptyResult: R;
	/** The route's JSON body beside `{ clientKey, projectKey }`; absent ⇒ the result's own fields. */
	body?(result: R): object;
	/** A refusal the route answers before anything is written (the flow gate). */
	gate?(ctx: ExportContext, url: URL): Promise<Response | null>;
	/** The route's 503 text while no deploy token is configured. */
	readonly notConfigured: string;
	/** The route's 502 text when the export throws. */
	readonly failed: string;
	/** Writes into {@link ExportPass.pageStore}: the `_pages/` prune waits for it. */
	readonly claimsPages?: true;
}

const define = <const Id extends string, R>(exporter: Exporter<Id, R>): Exporter<Id, R> => exporter;

const tiersOf = async (clientKey: string, projectKey: string) =>
	normalizeResolutionTiers((await loadDoc(clientKey, projectKey)).resolutionTiers);

/** The pass's authored cinematics; a route call, which has no pass, loads its own. */
const authoredCinematics = ({ clientKey, projectKey, pass }: ExportContext) =>
	pass ? pass.cinematics : loadAuthoredCinematics(clientKey, projectKey);

/** Time `run` into `ctx.timings` under `label`, or just run it. */
export async function timed<T>(
	ctx: Pick<ExportContext, 'timings'>,
	label: string,
	run: () => Promise<T>,
): Promise<T> {
	if (!ctx.timings) return run();
	const t0 = Date.now();
	try {
		return await run();
	} finally {
		ctx.timings[label] = Date.now() - t0;
	}
}

const art = define({
	id: 'art',
	label: 'art',
	notConfigured: 'Editor art export is not configured.',
	failed: 'Failed to export the layout-referenced art.',
	claimsPages: true,
	// A cinematic casts rigs no scene places, so the art walk is seeded with them — on the route too,
	// or a rig only a cinematic casts is missing from every baked build.
	run: async (ctx) =>
		exportEditorArt(ctx.clientKey, ctx.projectKey, {
			extraRigNames: cinematicRigNames(await authoredCinematics(ctx)),
			timings: ctx.timings,
			pageStore: ctx.pass ? await ctx.pass.pageStore : undefined,
		}),
	emptyResult: {
		sheets: [],
		images: [],
		spines: [],
		spinesMissing: [],
		collisions: [],
		missing: [],
		clipMissing: [],
	} satisfies EditorArtIndex,
});

const fonts = define({
	id: 'fonts',
	label: 'fonts',
	notConfigured: 'Editor font export is not configured.',
	failed: 'Failed to export the project fonts.',
	run: ({ clientKey, projectKey }) => exportEditorFonts(clientKey, projectKey),
	emptyResult: { catalog: { prefix: 'editor-fonts', fonts: [] } } satisfies FontExportIndex,
});

/**
 * The DEPLOY-TOKEN gate on the route, deliberately not the `sound` tool entitlement that
 * `/api/sounds*` uses: a build runner is not a logged-in author.
 */
const sounds = define({
	id: 'sounds',
	label: 'sounds',
	notConfigured: 'Sound export is not configured.',
	failed: 'Failed to export the project sounds.',
	run: ({ clientKey, projectKey }) => exportProjectSounds(clientKey, projectKey),
	emptyResult: { catalog: { prefix: 'sounds', sounds: [] } } satisfies SoundExportIndex,
});

const symbols = define({
	id: 'symbols',
	label: 'symbols',
	notConfigured: 'Editor symbols export is not configured.',
	failed: 'Failed to export the symbol-bound assets.',
	claimsPages: true,
	// A route call gets a store of its own. Without one the export took the per-bundle copy branch,
	// so every baked/delivery build (every standalone game repo) shipped its symbol sheet pages
	// uncompressed and undeduped while Publish shipped them compressed — and symbol pages are the
	// LARGEST textures a board holds. No prune of that store: `_pages/` is pruned only by an owner
	// that has seen EVERY exporter that could claim a page (`runtimeBundle.ts`'s `prune:pages`).
	run: async ({ clientKey, projectKey, timings, pass }) =>
		exportEditorSymbols(clientKey, projectKey, {
			timings,
			pageStore: pass
				? await pass.pageStore
				: new PageStore(
						`${SUB.deploy(clientKey, projectKey)}/`,
						await tiersOf(clientKey, projectKey),
					),
		}),
	emptyResult: {
		map: {},
		index: { sheets: [], images: [], spines: [], collisions: [], missing: [], spinesMissing: [] },
	} satisfies SymbolExportResult,
	// The WHOLE result's config fields: the bake reads each one off this body, so a field missing
	// here ships on Publish and not in a baked game (the "reach both" rule — `winCycle` and `names`
	// were once dropped exactly so). The list is explicit, not a spread, so the body is the fields
	// the bake knows and nothing a future result field drags in unread.
	body: ({
		map,
		index,
		names,
		symbolSounds,
		symbolFx,
		highlight,
		boardGlow,
		winLine,
		winCycle,
		winExplode,
		winBeat,
		arrivalRelease,
		respinLandOnStop,
		bookVfx,
		transition,
		tumblePattern,
		anticipation,
		stacked,
		coinLabel,
		flights,
	}) => ({
		map,
		index,
		names,
		symbolSounds,
		symbolFx,
		highlight,
		boardGlow,
		winLine,
		winCycle,
		winExplode,
		winBeat,
		arrivalRelease,
		respinLandOnStop,
		bookVfx,
		transition,
		tumblePattern,
		anticipation,
		stacked,
		coinLabel,
		flights,
	}),
});

/**
 * The v2 flow is VALIDATED before a route call writes anything — the desktop half of the online
 * publish's flow gate: a flow with errors is refused with a 409 `{ error, reason: 'invalid-flow',
 * details }`, and `&allowInvalidFlow=1` (the bake's `--allow-invalid-flow`) is the override. A route
 * has the deploy token and no session, so the override is as restricted as that token, not to the
 * owner role like the online Publish. A flow of another family than the project's kind
 * (`reason: 'flow-wrong-kind'`) is refused with no override.
 */
const flow = define({
	id: 'flow',
	label: 'flowV2',
	notConfigured: 'Editor flow export is not configured.',
	failed: 'Failed to export the project flow.',
	// Self-gates on "authored": an un-authored project exports nothing (parity).
	run: ({ clientKey, projectKey }) => exportEditorFlowV2(clientKey, projectKey),
	emptyResult: {} satisfies FlowV2ExportIndex,
	gate: async ({ clientKey, projectKey }, url) => {
		const flowCheck = await checkFlowV2ForPublish(clientKey, projectKey);
		const refusal = flowGateRefusal(
			flowCheck,
			await projectGameType(projectKey),
			url.searchParams.get('allowInvalidFlow') === '1',
		);
		if (refusal) {
			return json(
				{ error: refusal.message, reason: refusal.reason, details: refusal.details },
				{ status: 409 },
			);
		}
		if (flowCheck.status === 'invalid') {
			console.warn(
				`[export-flow] ${projectKey}: baked with ${flowCheck.errors.length} flow error(s) by ` +
					`override: ${describeFlowErrors(flowCheck.errors).join(' | ')}`,
			);
		}
		return null;
	},
});

/**
 * Boot splashes ship as a SIDE EFFECT: the splash paints before the bundle is fetched, so it reads
 * `deploy/_boot/boot.json` itself and the bundle embeds nothing. The pass still runs it, as the one
 * path both Publish and the live assemble share; without the route an offline build shipped
 * whatever the last online publish had left in `_boot/`, or nothing.
 */
const boot = define({
	id: 'boot',
	label: 'bootSplash',
	notConfigured: 'Boot splash export is not configured.',
	failed: 'Failed to export the boot splash.',
	run: ({ clientKey, projectKey }) => exportBootSplashes(clientKey, projectKey),
	emptyResult: {} satisfies BootSplashIndex,
	body: (index) => ({ index }),
});

/** A cinematic carries no binary assets of its own — its RIGS ride `art` — so this is a JSON copy. */
const cinematics = define({
	id: 'cinematics',
	label: 'cinematics',
	notConfigured: 'Cinematic export is not configured.',
	failed: 'Failed to export the project cinematics.',
	run: async (ctx) =>
		exportCinematics(ctx.clientKey, ctx.projectKey, await authoredCinematics(ctx)),
	emptyResult: {} satisfies CinematicExportIndex,
});

/**
 * An EffectDoc carries no binary assets (its particle art is an atlas `art` ships), so this is a JSON
 * copy + normalize per effect. `rigFx` — a rig's own animation events → effects, read from the rig
 * `.irig`/`.json` — ships no assets either, so it rides this entry.
 */
const effects = define({
	id: 'effects',
	label: 'effects',
	notConfigured: 'Editor effects export is not configured.',
	failed: 'Failed to export the project effects.',
	run: async (ctx) => {
		const [index, rigFx] = await Promise.all([
			exportEffects(ctx.clientKey, ctx.projectKey),
			timed(ctx, 'rigFx', () => exportRigFx(ctx.clientKey, ctx.projectKey)),
		]);
		return { index, rigFx };
	},
	emptyResult: {
		index: { effects: [], referencedAssetKeys: [], referencedSkeletonKeys: [], staleBakes: [] },
		rigFx: {},
	} satisfies { index: EffectExportIndex; rigFx: RigFxManifest },
	body: ({ index, rigFx }) => ({ ...index, rigFx }),
});

/**
 * Compiles the project's shader graphs into `deploy/editor-shaders/`; the game registers them with
 * `setCustomElementFx` so an entry naming `custom:<id>` plays. A project with no graphs exports none.
 */
const shaders = define({
	id: 'shaders',
	label: 'shaders',
	notConfigured: 'Editor shader export is not configured.',
	failed: 'Failed to export the project shader effects.',
	run: ({ clientKey, projectKey }) => exportShaders(clientKey, projectKey),
	emptyResult: { shaderEffects: [], skipped: [] } satisfies ShaderExportIndex,
});

/**
 * A clip carries no binary assets (its frames are regions of an atlas `art` ships), so this is a
 * JSON copy + normalize per clip. `rigFlipbooks` — a rig's own animation events → clips — rides it,
 * as `rigFx` rides `effects`.
 */
const clips = define({
	id: 'clips',
	label: 'flipbooks',
	notConfigured: 'Editor clips export is not configured.',
	failed: 'Failed to export the project clips.',
	run: async (ctx) => {
		const [index, rigFlipbooks] = await Promise.all([
			exportClips(ctx.clientKey, ctx.projectKey, { timings: ctx.timings }),
			timed(ctx, 'rigFlipbooks', () => exportRigFlipbooks(ctx.clientKey, ctx.projectKey)),
		]);
		return { index, rigFlipbooks };
	},
	emptyResult: {
		index: { clips: [], referencedAssetKeys: [] },
		rigFlipbooks: {},
	} satisfies { index: FlipbookExportIndex; rigFlipbooks: RigFlipbookManifest },
	body: ({ index, rigFlipbooks }) => ({ ...index, rigFlipbooks }),
});

/** Every exporter, in the order the bake runs them. */
export const EXPORTERS = [
	art,
	fonts,
	sounds,
	symbols,
	flow,
	boot,
	cinematics,
	effects,
	shaders,
	clips,
] as const;

type AnyExporter = (typeof EXPORTERS)[number];
export type ExporterId = AnyExporter['id'];
type ResultOf<E> = E extends Exporter<string, infer R> ? R : never;
/** Each exporter's result, by id. */
export type ExportResults = { [E in AnyExporter as E['id']]: ResultOf<E> };

export function findExporter(id: string): AnyExporter | undefined {
	return EXPORTERS.find((e) => e.id === id);
}

/** The route body an exporter's result becomes. */
export function exportBody(exporter: AnyExporter, result: unknown): object {
	const shape = exporter as Exporter<string, unknown>;
	return shape.body ? shape.body(result) : (result as object);
}

/**
 * Start EVERY exporter at once, each timed under its label. Returns one promise per id so the caller
 * can join what it needs first (the `_pages/` prune waits for the page claimers only); the caller
 * must still await them all.
 */
export function startExports(ctx: ExportContext): {
	[K in ExporterId]: Promise<ExportResults[K]>;
} {
	const started: Record<string, Promise<unknown>> = {};
	for (const exporter of EXPORTERS) {
		const run = exporter.run as (ctx: ExportContext) => Promise<unknown>;
		started[exporter.id] = timed(ctx, exporter.label, () => run(ctx));
	}
	return started as { [K in ExporterId]: Promise<ExportResults[K]> };
}

/** Await every started exporter; rejects with the first failure, like `Promise.all`. */
export async function settleExports(
	started: ReturnType<typeof startExports>,
): Promise<ExportResults> {
	const entries = await Promise.all(
		Object.entries(started).map(async ([id, result]) => [id, await result] as const),
	);
	return Object.fromEntries(entries) as ExportResults;
}
