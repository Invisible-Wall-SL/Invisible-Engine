/**
 * Writes the canonical per-project R2 skeleton for a `(client, project)` pair.
 * Idempotent: every key is `HEAD`-checked first and only created when missing
 * (`If-None-Match: *`), so calling `scaffoldProject` repeatedly safely backfills new seed files
 * without trampling existing data.
 */
import { freshDrivenSeedDoc, type FlowDoc, type Graph } from 'engine-flow-v2';
import { splitFormOf, type HoldAndWinPresetId, type HoldAndWinTemplateJackpots } from 'game-config';
import type { LayoutDoc } from 'engine-layout';
import { engineOwnedOnly, getFullSceneSet, POTS_SCREEN } from 'engine-layout';
import { sceneSetOptionsFor } from '$lib/addOns';
import {
	gameConfigSeedFor,
	holdAndWinTemplateSeed,
	type LinesPresetId,
} from './gameConfigDefaults';
import { ConflictError, loadGameConfigDocWithEtag, saveGameConfigDoc } from './gameConfigStorage';
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
import { objectExists, putObjectText } from './r2';
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

function buildSeeds(
	client: string,
	project: string,
	gameType: string,
	reference: LayoutDoc | undefined,
	dropped: readonly string[],
): Seed[] {
	const atlasConfig = { version: 1, output_prefix: project };
	const sheetConfig = { version: 1 };
	const strings = normalizeDoc({});
	const scenes = scaffoldLayoutDoc(project, gameType, reference);
	scenes.scenes = scenes.scenes.filter((scene) => !dropped.includes(scene.id));

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
		// The game type's starter flow — the SAME doc `/flow-v2` opens an unsaved project on. It has to
		// be STORED, not just offered by the editor: the free-spin intro/outro are the flow's screens
		// now, so a project nobody opened in Invisible Flow would publish without them.
		{
			key: flowV2DocKey(client, project),
			body: JSON.stringify(flowWithoutScreens(freshDrivenSeedDoc(gameType), dropped), null, 2),
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
 * Write any missing seed files for `(client, project)` into R2. A `holdAndWin` project's Game Config
 * is seeded from `holdAndWinJackpots`, the plain template (bonus-games §0) with jackpots on or off;
 * else from `holdAndWinPreset`, one of the three reference games (the samples and the gates); else
 * from the kind's default, the config an un-authored project already plays. `linesPreset` seeds a
 * `lines` project from a lines preset (the Book of Thermopylae) and its scenes from the preset's own
 * reference set — without one a lines project stays un-authored, as before.
 */
export async function scaffoldProject(
	client: string,
	project: string,
	opts: {
		holdAndWinJackpots?: HoldAndWinTemplateJackpots;
		holdAndWinPreset?: HoldAndWinPresetId;
		linesPreset?: LinesPresetId;
	} = {},
): Promise<void> {
	const gameType = await projectGameType(project);
	const linesPreset = gameType === 'lines' ? opts.linesPreset : undefined;
	const sceneSet = (linesPreset && LINES_PRESET_SCENE_SET[linesPreset]) || gameType;
	// Resolve the reference `LayoutDoc` from the built-in registry first, then the
	// custom-kind store (§21.6). `loadKind` is async, so resolve here (already async)
	// and hand the result to the sync `buildSeeds`.
	// The STORED Game Config shapes the set (a re-scaffold, or a config written before the layout): a
	// respin board that expands reserves the grown area, and an add-on merges in its screens.
	const { doc: stored } = await loadGameConfigDocWithEtag(client, project);
	const reference =
		getFullSceneSet(sceneSet, sceneSetOptionsFor(gameType, stored)) ??
		(await loadKind(gameType))?.doc;
	const plain = gameType === 'holdAndWin' ? opts.holdAndWinJackpots : undefined;
	const config = plain
		? holdAndWinTemplateSeed(plain)
		: gameConfigSeedFor(gameType, linesPreset ?? opts.holdAndWinPreset);
	// The plain game's screens and Flow are never written without its config.
	if (plain && !config) throw new Error(`No Hold and Win template default for jackpots ${plain}.`);
	const dropped = plain ? plainHoldAndWinDropped(plain) : [];
	// The HEAD skips the PUT in the common case; `If-None-Match: *` closes the window between the two,
	// so an author's first save that lands in it (a re-scaffold of a live project) is never replaced.
	for (const seed of buildSeeds(client, project, gameType, reference, dropped)) {
		if (await objectExists(seed.key)) continue;
		try {
			await putObjectText(seed.key, seed.body, seed.contentType, { ifNoneMatch: '*' });
		} catch (e) {
			if (!(e instanceof ConflictError)) throw e;
		}
	}
	// The kind's default Game Config, written through the config store (validated, backed up,
	// `If-None-Match: *`) so a concurrent first save in `/config` wins rather than being clobbered.
	// In the split form (`docs/design/bonus-games.md` §1): a lines base game, its coin trigger and one
	// `holdAndWin` respin mode; the save regenerates the compat mirror.
	if (config && !(await objectExists(gameConfigDocKey(client, project)))) {
		try {
			await saveGameConfigDoc(client, project, splitFormOf(config), null);
		} catch (e) {
			if (!(e instanceof ConflictError)) throw e;
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
}
