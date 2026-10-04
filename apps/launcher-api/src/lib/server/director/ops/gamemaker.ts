import { DEFAULT_GAME_KIND } from 'constants-shared/gameKinds';
import { duplicateProject } from '../../duplicateProject';
import { loadGameConfigDocWithEtag } from '../../gameConfigStorage';
import { UNASSIGNED_CLIENT } from '../../projectPaths';
import { canAccessProject, listDirectorTemplateProjects, listProjects } from '../../projects';
import { setRunConfigEtags } from '../store';
import { AdapterError, defineOp, type AdapterContext } from '../adapter';
import { loadSummaryContext, summarizeProject, type ProjectSummary } from '../templates';

/**
 * Game Maker adapters (PLAN 2.3). Templates are PUBLISHED projects an admin marked as Director
 * templates (Q1). A Director project is created through Game Maker's own duplicate path, so its
 * `projects` row and R2 tree are the ones a person's "Duplicate · full" makes.
 */

const PROJECT_KEY = '^[a-z0-9][a-z0-9_-]{0,63}$';

/** A live Director template the owner can access, or a 404 that does not say which it failed. */
async function requireTemplate(ctx: AdapterContext, key: string) {
	const template = (await listDirectorTemplateProjects()).find((p) => p.key === key);
	if (!template || !(await canAccessProject(ctx.owner.id, ctx.owner.role, key))) {
		throw new AdapterError(404, 'unknown_template', `"${key}" is not a Director template.`);
	}
	return template;
}

export const listTemplates = defineOp<{ gameType: string }, { templates: ProjectSummary[] }>({
	tool: 'gamemaker',
	name: 'list_templates',
	description:
		'The Director templates for a game type: each with its GAME / USING chips, the items it locks, and region counts per Atlas Maker atlas.',
	inputSchema: {
		type: 'object',
		properties: {
			gameType: { type: 'string', description: 'A game kind id, e.g. "lines".', maxLength: 64 },
		},
		required: ['gameType'],
		additionalProperties: false,
	},
	agents: ['worker'],
	scope: 'owner',
	write: false,
	handler: async (ctx, { gameType }) => {
		const marked = (await listDirectorTemplateProjects()).filter(
			(p) => (p.gameType || DEFAULT_GAME_KIND) === gameType,
		);
		const reachable = [];
		for (const p of marked) {
			if (await canAccessProject(ctx.owner.id, ctx.owner.role, p.key)) reachable.push(p);
		}
		const summaryCtx = await loadSummaryContext();
		const templates = await Promise.all(reachable.map((p) => summarizeProject(p, summaryCtx)));
		return { templates: templates.filter((t) => t.published) };
	},
});

export const getTemplate = defineOp<{ key: string }, ProjectSummary>({
	tool: 'gamemaker',
	name: 'get_template',
	description:
		'One Director template: its GAME / USING chips, the items it locks (math, paytable, bet modes, paylines, feature rules), and region counts per atlas.',
	inputSchema: {
		type: 'object',
		properties: {
			key: { type: 'string', description: "The template's project key.", pattern: PROJECT_KEY },
		},
		required: ['key'],
		additionalProperties: false,
	},
	agents: ['coordinator', 'mockup-analyst', 'worker'],
	scope: 'input',
	write: false,
	handler: async (ctx, { key }) =>
		summarizeProject(await requireTemplate(ctx, key), await loadSummaryContext()),
});

export interface CreateFromTemplateResult {
	projectKey: string;
	clientKey: string | null;
	templateKey: string;
	copied: number;
	rebased: number;
	skipped: number;
	templateConfigEtag: string | null;
	projectConfigEtag: string | null;
}

export const createFromTemplate = defineOp<{ name: string }, CreateFromTemplateResult>({
	tool: 'gamemaker',
	name: 'create_from_template',
	description:
		"Create the run's project from its template through Game Maker's duplicate path (scope full), and record the template's config ETag for the math-lock check.",
	inputSchema: {
		type: 'object',
		properties: {
			name: {
				type: 'string',
				description: 'Display name of the new game.',
				minLength: 1,
				maxLength: 120,
			},
		},
		required: ['name'],
		additionalProperties: false,
	},
	agents: ['worker'],
	scope: 'template',
	write: true,
	createsProject: true,
	handler: async (ctx, { name }) => {
		const { run } = ctx;
		const template = await requireTemplate(ctx, run.templateProjectKey);
		const templateClient = template.clientKey ?? UNASSIGNED_CLIENT;
		const before = await loadGameConfigDocWithEtag(templateClient, template.key);

		const outcome = await duplicateProject(ctx.owner, {
			source: template.key,
			key: run.projectKey,
			name: name.trim(),
			clientKey: run.clientKey,
			scope: 'full',
		});
		if (!outcome.ok) {
			const code = outcome.status === 409 ? 'project_exists' : 'create_failed';
			throw new AdapterError(outcome.status, code, outcome.error);
		}

		const [after, copy] = await Promise.all([
			loadGameConfigDocWithEtag(templateClient, template.key),
			loadGameConfigDocWithEtag(run.clientKey ?? UNASSIGNED_CLIENT, run.projectKey),
		]);
		// The template's math moved while it was being copied: the copy may hold either version, so
		// the lock would vouch for a config nobody chose. Recorded as unknown; QA fails the run.
		const templateConfigEtag = before.etag === after.etag ? before.etag : null;
		await setRunConfigEtags(run.id, { template: templateConfigEtag, project: copy.etag });
		return {
			projectKey: outcome.key,
			clientKey: run.clientKey,
			templateKey: template.key,
			copied: outcome.copied,
			rebased: outcome.rebased,
			skipped: outcome.skipped,
			templateConfigEtag,
			projectConfigEtag: copy.etag,
		};
	},
});

export const getProject = defineOp<Record<string, never>, ProjectSummary & { templateKey: string }>(
	{
		tool: 'gamemaker',
		name: 'get_project',
		description:
			"The run's project as Game Maker shows it: GAME / USING chips, locked items, region counts per atlas, and the config ETag.",
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		agents: ['coordinator', 'worker'],
		scope: 'project',
		write: false,
		handler: async (ctx) => {
			const project = (await listProjects()).find((p) => p.key === ctx.run.projectKey);
			if (!project) {
				throw new AdapterError(404, 'unknown_project', `No live project "${ctx.run.projectKey}".`);
			}
			return {
				...(await summarizeProject(project, await loadSummaryContext())),
				templateKey: ctx.run.templateProjectKey,
			};
		},
	},
);

export const GAMEMAKER_OPS = [listTemplates, getTemplate, createFromTemplate, getProject];
