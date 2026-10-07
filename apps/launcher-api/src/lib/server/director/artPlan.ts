import type { DirectorPricing } from 'director-costs';
import {
	approvalProblem,
	floorOf,
	project,
	type Card,
	type ProjectionFloor,
	type CatalogueEntry,
	type StoredRecipe,
	type Timing,
} from 'director-costs/recipe';
import { getDirectorPricing } from '../costs/pricingConfig';
import type { DirectorRun } from '../db/schema';
import { UNASSIGNED_CLIENT } from '../projectPaths';
import { AdapterError } from './adapter';
import { catalogue } from './ops/atlasSetup';
import { blueprintTimings, latestPlanRegions, runRecipes } from './store';

/**
 * The owner's view of a run's art (ADR-0008 §5, §7; card 8E): the technician's stored recipes, the
 * coordinator's plan they answer to, the reviewed cards they name and what a GPU second costs, so
 * the Live run screen can show the Art plan checkpoint, check an edit with the same rules the
 * worker stores it with (`director-costs/recipe`), list licence-flagged steps before publishing,
 * and say how each region was made. Read-only: an owner's edit travels as a checkpoint payload the
 * worker applies, never as a write from here.
 */

type User = NonNullable<App.Locals['user']>;

export interface ArtPlanCatalogue {
	gpu: string;
	/** USD per second of `gpu` in `pricing.json`, or null when it has no price. */
	usdPerSecond: number | null;
	blueprints: CatalogueEntry[];
}

export interface ArtPlanAnswer {
	/** Every stored recipe of the run; `planned` says which the latest plan names. */
	recipes: (StoredRecipe & { planned: boolean })[];
	/** The latest plan's regions in order, each with its batch. */
	plan: { region: string; group: string }[];
	/** The reviewed cards, or null when atlas-tool could not be read (`catalogueError` says why). */
	catalogue: ArtPlanCatalogue | null;
	catalogueError: string | null;
	timings: Timing[];
	/** What a projection never goes below (`pricing.json`): the seed seconds and the seed delay. */
	floor: ProjectionFloor;
}

export const usdPerSecondOf = (pricing: DirectorPricing, gpu: string): number | null =>
	gpu && Object.hasOwn(pricing.runpod.perSecondByGpu, gpu)
		? pricing.runpod.perSecondByGpu[gpu]
		: null;

/**
 * The reviewed catalogue as `user` may read it for `scope`, priced: through the same cached
 * atlas-tool read the adapter serves to agents (`atlas.list_blueprints`). Null with the reason
 * when it cannot be read, so a caller prices nothing rather than guessing.
 */
export async function pricedCatalogue(
	user: User,
	scope: { clientKey: string; projectKey: string },
	runId: string,
): Promise<{ catalogue: ArtPlanCatalogue | null; error: string | null }> {
	try {
		const read = await catalogue({ run: { id: runId }, owner: user, agent: 'worker', scope });
		const { pricing } = await getDirectorPricing();
		return {
			catalogue: { ...read, usdPerSecond: usdPerSecondOf(pricing, read.gpu) },
			error: null,
		};
	} catch (e) {
		if (e instanceof AdapterError) {
			return { catalogue: null, error: `The blueprint catalogue could not be read (${e.code}).` };
		}
		throw e;
	}
}

const isRecipe = (value: unknown): value is StoredRecipe =>
	typeof value === 'object' &&
	value !== null &&
	typeof (value as StoredRecipe).region === 'string' &&
	Array.isArray((value as StoredRecipe).steps);

async function plannedRecipes(runId: string) {
	const [rows, plan] = await Promise.all([runRecipes(runId), latestPlanRegions(runId)]);
	return { recipes: rows.filter(isRecipe), plan };
}

const runScope = (run: DirectorRun) => ({
	clientKey: run.clientKey ?? UNASSIGNED_CLIENT,
	projectKey: run.projectKey,
});

export async function artPlanOf(user: User, run: DirectorRun): Promise<ArtPlanAnswer> {
	const [{ recipes, plan }, timings, priced, { pricing }] = await Promise.all([
		plannedRecipes(run.id),
		blueprintTimings(),
		pricedCatalogue(user, runScope(run), run.id),
		getDirectorPricing(),
	]);
	const order = [...plan.keys()];
	const rank = (region: string) => {
		const i = order.indexOf(region);
		return i === -1 ? Number.MAX_SAFE_INTEGER : i;
	};
	return {
		recipes: recipes
			.map((r) => ({ ...r, planned: plan.has(r.region) }))
			.sort((a, b) => rank(a.region) - rank(b.region) || a.region.localeCompare(b.region)),
		plan: order.map((region) => ({ region, group: plan.get(region)! })),
		catalogue: priced.catalogue,
		catalogueError: priced.error,
		timings,
		floor: floorOf(pricing.runpod),
	};
}

/**
 * Why the owner's approval of the Art plan would be refused by the worker, or null: the same rule,
 * every recipe priced again now on the catalogue, the GPU's rate and the timings. No catalogue,
 * no price: the approval waits for one (money fails closed).
 */
export async function artPlanApprovalRefusal(
	user: User,
	run: DirectorRun,
	seen: unknown,
): Promise<string | null> {
	const [{ recipes, plan }, timings, priced, { pricing }] = await Promise.all([
		plannedRecipes(run.id),
		blueprintTimings(),
		pricedCatalogue(user, runScope(run), run.id),
		getDirectorPricing(),
	]);
	if (!priced.catalogue) {
		const why = priced.error ?? 'The blueprint catalogue could not be read.';
		return `${why} The plan cannot be priced now, so it cannot be approved`;
	}
	const basis = {
		cards: new Map<string, Card>(priced.catalogue.blueprints.map((b) => [b.id, b.card])),
		usdPerSecond: priced.catalogue.usdPerSecond,
		timings,
		floor: floorOf(pricing.runpod),
	};
	return approvalProblem(recipes, new Set(plan.keys()), seen, (r) => project(r.steps, basis));
}
