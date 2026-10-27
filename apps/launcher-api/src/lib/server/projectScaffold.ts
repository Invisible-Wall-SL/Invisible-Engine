/**
 * Writes the canonical per-project R2 skeleton for a `(client, project)` pair.
 * Idempotent: every key is `HEAD`-checked first and only created when missing
 * (`If-None-Match: *`), so calling `scaffoldProject` repeatedly safely backfills new seed files
 * without trampling existing data. The one exception is a flow or layout provably left by ANOTHER
 * kind (a kind changed in `/admin`), which is backed up and replaced — see `replaceOtherKindDocs`.
 */
import {
	flowTemplateMismatch,
	freshDrivenSeedDoc,
	MATCH3_RGS_DRIVEN_SEED_DOC,
	type FlowDoc,
	type Graph,
} from 'engine-flow-v2';
import { familyOfKind } from 'constants-shared/gameKinds';
import {
	resolveFamily,
	resolveOutcome,
	type GameConfigDoc,
	type GameOutcome,
	type HoldAndWinPresetId,
	type HoldAndWinTemplateBase,
	type HoldAndWinTemplateJackpots,
} from 'game-config';
import type { LayoutDoc } from 'engine-layout';
import {
	ARCADE_SAMPLE_COMPONENTS,
	CARD_FRAME_PLACEHOLDER_DEF,
	engineOwnedOnly,
	getFullSceneSet,
	POTS_SCREEN,
	referenceLoadsAs,
} from 'engine-layout';
import { sceneSetOptionsFor } from '$lib/addOns';
import {
	gameConfigSeedFor,
	holdAndWinCoinBoardSeed,
	holdAndWinTemplateSeed,
	type LinesPresetId,
} from './gameConfigDefaults';
import { ConflictError, loadGameConfigDocWithEtag, saveGameConfigDoc } from './gameConfigStorage';
import { saveDoc } from './editorStorage';
import { loadFlowV2DocWithEtag, saveFlowV2Doc } from './flowV2Storage';
import { normalizeDoc } from './localization';
import { loadKind } from './kindStorage';
import {
	SUB,
	atlasConfigKey,
	editorDocKey,
	flowV2DocKey,
	gameConfigDocKey,
	localizationDocKey,
	sheetConfigKey,
	symbolsDocKey,
} from './projectPaths';
import { projectGameType } from './projects';
import { getObjectTextWithEtag, objectExists, putObjectText } from './r2';
import { holdAndWinSymbolsSeed } from './symbolDefaults';
import { saveSymbolsDoc } from './symbolsStorage';

interface Seed {
	key: string;
	body: string;
	contentType: string;
}

/**
 * §19.3 / §21.6: the editor doc a project is seeded with — the engine-owned projection of the kind's
 * full scene set (correct screens + engine pieces, no artist art). The `reference` is resolved by the
 * caller from the built-in registry first, then the custom-kind store; no reference (an unknown or
 * legacy type that resolves to neither) seeds no screens.
 */
export function scaffoldLayoutDoc(
	project: string,
	gameType: string,
	reference: LayoutDoc | undefined,
): Pick<LayoutDoc, 'version' | 'projectKey' | 'gameType' | 'scenes'> {
	return {
		version: 1,
		projectKey: project,
		gameType,
		scenes: reference ? engineOwnedOnly(reference).scenes : [],
	};
}

/**
 * A graph without the Show / Hide Container nodes of `screens`: each removed node's incoming exec
 * edges are joined to its outgoing ones, so the chain it sat in runs on as before, and its data
 * edges go with it.
 */
function graphWithoutScreens(graph: Graph, screens: ReadonlySet<string>): Graph {
	let { nodes, exec, data } = graph;
	for (const node of graph.nodes) {
		if (node.kind !== 'showContainer' && node.kind !== 'hideContainer') continue;
		if (!screens.has(node.ref)) continue;
		const into = exec.filter((e) => e.to.node === node.id);
		const out = exec.filter((e) => e.from.node === node.id);
		exec = [
			...exec.filter((e) => e.to.node !== node.id && e.from.node !== node.id),
			...into.flatMap((i) => out.map((o) => ({ from: i.from, to: o.to }))),
		];
		data = data.filter((e) => e.to.node !== node.id && e.from.node !== node.id);
		nodes = nodes.filter((n) => n.id !== node.id);
	}
	return { ...graph, nodes, exec, data };
}

/** The starter flow without `screens` — the screens the plain Hold and Win template does not seed. */
function flowWithoutScreens(flow: FlowDoc, screens: readonly string[]): FlowDoc {
	if (!screens.length) return flow;
	const drop = new Set(screens);
	return {
		...flow,
		graph: graphWithoutScreens(flow.graph, drop),
		containers: flow.containers.filter((c) => !drop.has(c.id)),
		...(flow.modes && {
			modes: Object.fromEntries(
				Object.entries(flow.modes).map(([id, scope]) => [
					id,
					{ ...scope, graph: graphWithoutScreens(scope.graph, drop) },
				]),
			),
		}),
	};
}

/**
 * The screens the plain Hold and Win template leaves out of the kind's set (bonus-games §0): the
 * pots, which only a coin overlay brings ("＋ Coin overlay…" merges them back), and with jackpots
 * off the jackpot bar.
 */
const plainHoldAndWinDropped = (jackpots: HoldAndWinTemplateJackpots): string[] => [
	POTS_SCREEN,
	...(jackpots === 'off' ? ['jackpotBar'] : []),
];

type SeedLayout = ReturnType<typeof scaffoldLayoutDoc>;

function buildSeeds(client: string, project: string, scenes: SeedLayout, flow: FlowDoc): Seed[] {
	const atlasConfig = { version: 1, output_prefix: project };
	const sheetConfig = { version: 1 };
	const strings = normalizeDoc({});

	return [
		{
			key: atlasConfigKey(client, project),
			body: JSON.stringify(atlasConfig, null, 2),
			contentType: 'application/json',
		},
		{
			key: `${SUB.manifests(client, project)}/.keep`,
			body: '',
			contentType: 'text/plain; charset=utf-8',
		},
		{
			key: `${SUB.input(client, project)}/refs/.keep`,
			body: '',
			contentType: 'text/plain; charset=utf-8',
		},
		{
			key: sheetConfigKey(client, project),
			body: JSON.stringify(sheetConfig, null, 2),
			contentType: 'application/json',
		},
		{
			key: localizationDocKey(client, project),
			body: JSON.stringify(strings, null, 2),
			contentType: 'application/json',
		},
		{
			key: editorDocKey(client, project),
			body: JSON.stringify(scenes, null, 2),
			contentType: 'application/json',
		},
		// The game type's starter flow (a coin board's own) — the SAME doc `/flow-v2` opens an unsaved
		// project on. It has to be STORED, not just offered by the editor: the free-spin intro/outro
		// are the flow's screens now, so a project nobody opened in Invisible Flow would publish
		// without them.
		{
			key: flowV2DocKey(client, project),
			body: JSON.stringify(flow, null, 2),
			contentType: 'application/json',
		},
	];
}

/**
 * The reference scene set a LINES preset scaffolds from, when it is not the lines kind's own: the
 * Book of Thermopylae starts from the Book-of reference layout (Borut's look, saved as a lines
 * layout), so a new Book-of game opens on the screens a Book-of game has always had.
 */
const LINES_PRESET_SCENE_SET: Record<LinesPresetId, string> = { bookOfThermopylae: 'bookOf' };

/**
 * Who decides a `match3` project's rounds (`docs/design/game-families.md` §6.1): the outcome asked
 * for (Game Maker's "Who decides the result?"), else the stored match-3 config's (a re-scaffold),
 * else `undefined` — the rules game, what every caller that asks nothing has always got. Every other
 * kind: `undefined`.
 */
function match3Outcome(
	gameType: string,
	asked: GameOutcome | undefined,
	stored: GameConfigDoc | null,
): GameOutcome | undefined {
	if (gameType !== 'match3') return undefined;
	if (asked) return asked;
	return stored && resolveFamily(stored) === 'match3' ? resolveOutcome(stored) : undefined;
}

/** A doc {@link scaffoldProject} replaced, and the kind that had left it. */
export interface ReplacedDoc {
	doc: 'flow' | 'scenes';
	from: string;
}

const REPLACED_IN: Record<ReplacedDoc['doc'], { what: string; tool: string }> = {
	flow: { what: 'flow', tool: 'Invisible Flow' },
	scenes: { what: 'scenes', tool: 'Invisible Scene Editor' },
};

/**
 * The `/admin` Re-scaffold note: what was replaced, and where the old doc can be restored — the
 * tool's History…, which lists the backups the replacing save took.
 */
export function rescaffoldMessage(
	project: string,
	gameType: string,
	replaced: readonly ReplacedDoc[],
): string {
	const done = `Rescaffolded ${project}.`;
	if (!replaced.length) return done;
	const docs = replaced.map((r) => `${r.from} ${REPLACED_IN[r.doc].what}`).join(' and ');
	const tools = replaced.map((r) => `${REPLACED_IN[r.doc].tool}'s`).join(' and ');
	const one = replaced.length === 1;
	return (
		`${done} Replaced its ${docs} with the ${gameType} starter${one ? '' : 's'} ` +
		`(the old ${one ? 'one is' : 'ones are'} in ${tools} History…).`
	);
}

/**
 * Whether a stored layout was laid out for ANOTHER kind than the project's: both kinds ship a full
 * scene set, of different families, and the stored one is not a reference for the project's (a
 * Book-of layout in a lines project — the Book of Thermopylae preset — is the lines project's own).
 * Two slot kinds share a family, and one's layout in the other's project is a gray area (the screens
 * overlap), so it is kept, like a Book-of flow in a project scaffolded before its kind had a starter.
 */
function layoutKindMismatch(stored: string, gameType: string): boolean {
	if (!getFullSceneSet(stored) || !getFullSceneSet(gameType)) return false;
	if (familyOfKind(stored) === familyOfKind(gameType)) return false;
	return referenceLoadsAs(stored, gameType) !== gameType;
}

/** The stored layout's `gameType`; `undefined` when it is unparseable, not a layout, or names none. */
function storedLayoutKind(text: string): string | undefined {
	let doc: unknown;
	try {
		doc = JSON.parse(text);
	} catch {
		return undefined;
	}
	const layout = doc as Partial<LayoutDoc> | null;
	if (!layout || typeof layout !== 'object' || !Array.isArray(layout.scenes)) return undefined;
	return typeof layout.gameType === 'string' && layout.gameType ? layout.gameType : undefined;
}

/**
 * Replace the flow and the layout a kind change left behind with the project's kind's seeds. The
 * create-only seeds keep them, so a project switched from Book of to arcade in `/admin` kept its
 * Book-of flow through Re-scaffold and published an arcade game driven by a slot flow
 * (`invisible_wall/salmons`, 2026-10-26). Only a doc PROVABLY of another family's built-in kind is
 * replaced — a same-kind doc is the author's work, a same-family one may be what the project has
 * always played (an older Hold and Win project's Book-of flow), and a corrupt one or one naming no
 * kind proves nothing. The write is backed up `'always'` (restorable from the tool's History…) and
 * CAS'd on the ETag read here, so an author's save that lands in between wins.
 */
async function replaceOtherKindDocs(
	client: string,
	project: string,
	gameType: string,
	scenes: SeedLayout,
	flow: FlowDoc,
): Promise<ReplacedDoc[]> {
	const replaced: ReplacedDoc[] = [];
	const stored = await loadFlowV2DocWithEtag(client, project);
	if (stored.doc && stored.etag && flowTemplateMismatch(stored.doc.templateId, gameType)) {
		try {
			await saveFlowV2Doc(client, project, flow, stored.etag, 'always');
			replaced.push({ doc: 'flow', from: stored.doc.templateId });
		} catch (e) {
			if (!(e instanceof ConflictError)) throw e;
		}
	}
	const layout = await getObjectTextWithEtag(editorDocKey(client, project));
	const from = layout && storedLayoutKind(layout.text);
	if (layout && from && layoutKindMismatch(from, gameType)) {
		try {
			await saveDoc(client, project, scenes as LayoutDoc, layout.etag, 'always');
			replaced.push({ doc: 'scenes', from });
		} catch (e) {
			if (!(e instanceof ConflictError)) throw e;
		}
	}
	return replaced;
}

/**
 * Write any missing seed files for `(client, project)` into R2. A `holdAndWin` project's Game Config
 * is seeded from `holdAndWinJackpots`, the plain template (bonus-games §0) with jackpots on or off,
 * or with `holdAndWinBase: 'coinBoard'` the template with no line game (hold-and-win-coin-board);
 * else from `holdAndWinPreset`, one of the three reference games (the samples and the gates); else
 * from the kind's default, the config an un-authored project already plays. `linesPreset` seeds a
 * `lines` project from a lines preset (the Book of Thermopylae) and its scenes from the preset's own
 * reference set — without one a lines project stays un-authored, as before. `outcome: 'rgs'` makes a
 * `match3` project the RGS-decided game — its config, its scene set (moves readout + slot HUD) and
 * its starter flow; without it a new match-3 project is the rules game, as before. Returns the docs
 * another kind left behind that it replaced (see {@link replaceOtherKindDocs}), with the kind.
 */
export async function scaffoldProject(
	client: string,
	project: string,
	opts: {
		holdAndWinJackpots?: HoldAndWinTemplateJackpots;
		holdAndWinBase?: HoldAndWinTemplateBase;
		holdAndWinPreset?: HoldAndWinPresetId;
		linesPreset?: LinesPresetId;
		outcome?: GameOutcome;
	} = {},
): Promise<{ gameType: string; replaced: ReplacedDoc[] }> {
	const gameType = await projectGameType(project);
	const linesPreset = gameType === 'lines' ? opts.linesPreset : undefined;
	const sceneSet = (linesPreset && LINES_PRESET_SCENE_SET[linesPreset]) || gameType;
	// Resolve the reference `LayoutDoc` from the built-in registry first, then the
	// custom-kind store (§21.6). `loadKind` is async, so resolve here (already async)
	// and hand the result to the sync `buildSeeds`.
	// The STORED Game Config shapes the set (a re-scaffold, or a config written before the layout): a
	// respin board that expands reserves the grown area, and an add-on merges in its screens.
	const { doc: stored } = await loadGameConfigDocWithEtag(client, project);
	const outcome = match3Outcome(gameType, opts.outcome, stored);
	const plain = gameType === 'holdAndWin' ? opts.holdAndWinJackpots : undefined;
	const coinBoard = plain !== undefined && opts.holdAndWinBase === 'coinBoard';
	const config = coinBoard
		? holdAndWinCoinBoardSeed()
		: plain
			? holdAndWinTemplateSeed(plain)
			: gameConfigSeedFor(gameType, linesPreset ?? opts.holdAndWinPreset, outcome);
	// A coin board's screens and Flow are its own template's, so a new one (nothing stored yet) is
	// shaped by the config about to be seeded.
	const shapedBy = stored ?? (coinBoard ? config : null);
	const reference =
		getFullSceneSet(sceneSet, {
			...sceneSetOptionsFor(gameType, shapedBy),
			...(outcome === 'rgs' ? { outcome } : {}),
		}) ?? (await loadKind(gameType))?.doc;
	// The plain game's screens and Flow are never written without its config.
	if (plain && !config) {
		throw new Error(
			coinBoard
				? 'No Hold and Win coin board template default.'
				: `No Hold and Win template default for jackpots ${plain}.`,
		);
	}
	const dropped = plain ? plainHoldAndWinDropped(plain) : [];
	const flow = flowWithoutScreens(
		outcome === 'rgs'
			? structuredClone(MATCH3_RGS_DRIVEN_SEED_DOC)
			: freshDrivenSeedDoc(gameType, { coinBoard: Boolean(shapedBy?.coinBoard) }),
		dropped,
	);
	const scenes = scaffoldLayoutDoc(project, gameType, reference);
	scenes.scenes = scenes.scenes.filter((scene) => !dropped.includes(scene.id));
	// The HEAD skips the PUT in the common case; `If-None-Match: *` closes the window between the two,
	// so an author's first save that lands in it (a re-scaffold of a live project) is never replaced.
	for (const seed of buildSeeds(client, project, scenes, flow)) {
		if (await objectExists(seed.key)) continue;
		try {
			await putObjectText(seed.key, seed.body, seed.contentType, { ifNoneMatch: '*' });
		} catch (e) {
			if (!(e instanceof ConflictError)) throw e;
		}
	}
	const replaced = await replaceOtherKindDocs(client, project, gameType, scenes, flow);
	// The kind's default Game Config, written through the config store (validated, backed up,
	// `If-None-Match: *`) so a concurrent first save in `/config` wins rather than being clobbered.
	// In the split form (`docs/design/bonus-games.md` §1): a lines base game, its coin trigger and one
	// `holdAndWin` respin mode.
	if (config && !(await objectExists(gameConfigDocKey(client, project)))) {
		try {
			await saveGameConfigDoc(client, project, config, null);
		} catch (e) {
			if (!(e instanceof ConflictError)) throw e;
		}
	}
	// An arcade project's sample spawns placeholder components (game-families P10.8): its own, so an
	// author re-skins them in the Component Editor. Create-only, like every other seed.
	// Loaded only for those projects, so scaffolding every other kind keeps its import graph.
	// A card project's cards are drawn in the placeholder card frame (card-games §6), the same way.
	const sampleComponents =
		gameType === 'arcade'
			? ARCADE_SAMPLE_COMPONENTS
			: gameType === 'card'
				? [CARD_FRAME_PLACEHOLDER_DEF]
				: [];
	if (sampleComponents.length) {
		const { saveComponent } = await import('./componentStorage');
		for (const def of sampleComponents) {
			try {
				await saveComponent(structuredClone(def), project, null);
			} catch (e) {
				if (!(e instanceof ConflictError)) throw e;
			}
		}
	}
	// Its symbols, from the STORED config — the preset just seeded, or what an older project authored
	// (the /admin Re-scaffold backfill) — create-only, like the config.
	if (gameType === 'holdAndWin' && !(await objectExists(symbolsDocKey(client, project)))) {
		const { doc } = await loadGameConfigDocWithEtag(client, project);
		const symbols = holdAndWinSymbolsSeed(doc);
		if (symbols) {
			try {
				await saveSymbolsDoc(client, project, symbols, null);
			} catch (e) {
				if (!(e instanceof ConflictError)) throw e;
			}
		}
	}
	return { gameType, replaced };
}
