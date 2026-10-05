import type { GameConfigDoc } from 'game-config';
import { mapWithConcurrency } from '../concurrency';
import type { Project } from '../db/schema';
import { resolveGameConfig } from '../gameConfigDefaults';
import { selectableGameKinds } from '../gameKinds';
import { buildGameProfile, type ProfileChip } from '../gameProfile';
import { listGamesOwnedByProject } from '../games';
import { SUB, UNASSIGNED_CLIENT } from '../projectPaths';
import { getObjectText, listAllKeys } from '../r2';
import { loadSymbolsDoc } from '../symbolsStorage';
import { loadTestServerManifest, type TestServerManifest } from '../testServerManifest';
import { DEFAULT_GAME_KIND } from 'constants-shared/gameKinds';

/**
 * What Invisible Director reads about a template or a project: the GAME / USING chips Game Maker
 * shows on its card (`buildGameProfile`), the items Director may never change, and how many regions
 * each Atlas Maker atlas holds. Read-only; every loader below degrades rather than throws, the way
 * the Game Maker page does, so one unreadable doc costs a field, not the answer.
 */

/** One item locked by the template (ADR-0002 "Locked items"). Read-only for every agent. */
export interface LockedItem {
	id: 'math' | 'paytable' | 'bet_modes' | 'paylines' | 'feature_rules';
	label: string;
	/** What the template's config says today, for the Mockup analyst to compare against. */
	detail: string;
	/**
	 * The same facts as data, for the worker's code rules (ADR-0005 "Conflict handling"): a rule
	 * decides on these, never on the wording of `detail` or on a mode's name. `bet_modes` carries
	 * each mode's `buyBonus` flag — `scatter.json` buys through a mode called `bonus`.
	 */
	facts?: { betModes: { id: string; buyBonus: boolean }[] };
}

/** Regions in one Atlas Maker atlas (`manifests/atlas_manifest_<atlas>.json`). */
export interface RegionGroup {
	atlas: string;
	manifestKey: string;
	regions: number;
}

export interface ProjectSummary {
	key: string;
	name: string;
	clientKey: string | null;
	gameType: string;
	gameTypeName: string;
	published: boolean;
	/** Game Maker's GAME row (`facts`) and USING row (`features`). */
	chips: { game: ProfileChip[]; using: ProfileChip[] };
	lockedItems: LockedItem[];
	regionGroups: RegionGroup[];
	/** ETag of `config/config.json`; null when the project runs on its kind's committed template. */
	configEtag: string | null;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The template items no agent may change, described from the config the game actually runs. */
export function lockedItemsOf(config: GameConfigDoc | null): LockedItem[] {
	const betModes = Object.entries(config?.betModes ?? {}).map(([id, mode]) => ({
		id,
		buyBonus: Boolean(mode.buyBonus),
	}));
	const paying = Object.values(config?.symbols ?? {}).filter((s) => (s.paytable ?? []).length > 0);
	const lines = config?.paylines ? Object.keys(config.paylines).length : 0;
	const features = [
		config?.cascade ? 'cascade' : null,
		config?.holdAndWin ? 'Hold and Win' : null,
		config?.potsOverlay ? 'pots overlay' : null,
		...(config?.modes ?? []).map((m) => `mode ${m.id}`),
	].filter((f): f is string => f !== null);
	const grid = config ? `${config.numReels} reels × ${config.numRows.join('/')} rows` : 'unknown';
	return [
		{
			id: 'math',
			label: 'Math contract',
			detail: config ? `RTP ${config.rtp}, ${grid}` : 'no config found',
		},
		{ id: 'paytable', label: 'Paytable', detail: plural(paying.length, 'paying symbol') },
		{
			id: 'bet_modes',
			label: 'Bet modes',
			detail: betModes.length
				? betModes.map((m) => (m.buyBonus ? `${m.id} (buy)` : m.id)).join(', ')
				: 'none',
			facts: { betModes },
		},
		{ id: 'paylines', label: 'Paylines', detail: plural(lines, 'payline') },
		{
			id: 'feature_rules',
			label: 'Feature rules',
			detail: features.length ? features.join(', ') : 'none',
		},
	];
}

const ATLAS_MANIFEST = /\/atlas_manifest_([^/]+)\.json$/;
const MANIFEST_READ_CONCURRENCY = 8;

/** Region counts per Atlas Maker atlas, sorted by atlas name. An unreadable manifest counts 0. */
export async function regionGroupsOf(
	clientKey: string,
	projectKey: string,
): Promise<RegionGroup[]> {
	const keys = (await listAllKeys(`${SUB.manifests(clientKey, projectKey)}/`)).filter((k) =>
		ATLAS_MANIFEST.test(k),
	);
	const groups = await mapWithConcurrency(keys, MANIFEST_READ_CONCURRENCY, async (manifestKey) => {
		let regions = 0;
		try {
			const parsed: unknown = JSON.parse((await getObjectText(manifestKey)) ?? 'null');
			const list = (parsed as { regions?: unknown } | null)?.regions;
			regions = Array.isArray(list) ? list.length : 0;
		} catch {
			regions = 0;
		}
		return { atlas: ATLAS_MANIFEST.exec(manifestKey)![1], manifestKey, regions };
	});
	return groups.sort((a, b) => a.atlas.localeCompare(b.atlas));
}

/** Shared per-call lookups, loaded once however many projects are summarised. */
export interface SummaryContext {
	kindNames: Map<string, string>;
	manifest: TestServerManifest;
}

export async function loadSummaryContext(): Promise<SummaryContext> {
	const [kinds, manifest] = await Promise.all([selectableGameKinds(), loadTestServerManifest()]);
	return { kindNames: new Map(kinds.map((k) => [k.id, k.name])), manifest };
}

/** A project's summary, built from the same signals the Game Maker card uses. */
export async function summarizeProject(
	project: Project,
	ctx: SummaryContext,
): Promise<ProjectSummary> {
	const clientKey = project.clientKey ?? UNASSIGNED_CLIENT;
	const gameType = project.gameType || DEFAULT_GAME_KIND;
	const [config, symbols, owned, regionGroups] = await Promise.all([
		resolveGameConfig(clientKey, project.key, gameType),
		loadSymbolsDoc(clientKey, project.key),
		listGamesOwnedByProject(project.key),
		regionGroupsOf(clientKey, project.key).catch(() => []),
	]);
	const entry = ctx.manifest.games[project.key];
	const profile = buildGameProfile({
		gameTypeId: gameType,
		gameTypeName: ctx.kindNames.get(gameType) ?? gameType,
		config: config.doc,
		configSource: config.source,
		symbols,
		runtimeId: entry?.runtime ?? null,
		protocol: entry?.protocol ?? null,
	});
	return {
		key: project.key,
		name: project.name,
		clientKey: project.clientKey,
		gameType,
		gameTypeName: ctx.kindNames.get(gameType) ?? gameType,
		published: owned.length > 0,
		chips: { game: profile.facts, using: profile.features },
		lockedItems: lockedItemsOf(config.doc),
		regionGroups,
		configEtag: config.source === 'authored' ? config.etag : null,
	};
}
