import { createHash } from 'node:crypto';
import { unplayableFamilyMessage } from '../../familyGate';
import { checkShippedFlowV2, describeFlowErrors } from '../../flowV2Validation';
import { loadGameConfigDocWithEtag } from '../../gameConfigStorage';
import { mockContractOfBundle } from '../../mockContract';
import { protocolFor } from '../../mockProtocol';
import { projectClientKey, projectGameType } from '../../projects';
import { hasOwnBuiltBundle } from '../../publishGame';
import {
	copyDeployTree,
	currentPointer,
	isSnapshotId,
	newSnapshotId,
	readSnapshotBundle,
} from '../../publishedRuntime';
import {
	deleteObjects,
	getObjectText,
	listAllKeys,
	listFolder,
	objectExists,
	putObjectText,
} from '../../r2';
import { buildRuntimeBundle } from '../../runtimeBundle';
import { withDeployWrite } from '../../runtimeBundleCache';
import { SHARED_RUNTIME_ID, runtimePointer } from '../../testServerManifest';
import { SUB, UNASSIGNED_CLIENT } from '../../projectPaths';
import { AdapterError, defineOp, type AdapterContext } from '../adapter';
import {
	DRAFT_ID,
	RETAINED_DRAFTS,
	SCENARIO,
	NO_PLAYER_RESULT,
	draftPrefix,
	draftsPrefix,
	newDraftJobRef,
	type DraftMeta,
} from '../drafts';
import { activeDraftPlayer, armDraftWatch } from '../draftJobs';
import { getDraftJob, insertDraftJob, queuedDraftJobs, settleDraftJob } from '../store';

/**
 * Build adapters (ADR-0010): QA freezes the run's game as a draft and plays it with forced
 * outcomes. A draft is what Publish would ship today, frozen under the run's own `director/drafts/`
 * folder; nothing here touches `published/**`, the pointer, `test_server/**` or Game Config.
 */

const scope = (ctx: AdapterContext) => ctx.scope!;

/** Every folder under the run's `drafts/`, newest first. */
async function draftFolders(client: string, project: string): Promise<string[]> {
	const prefix = draftsPrefix(client, project);
	const ids: string[] = [];
	let token: string | undefined;
	do {
		const page = await listFolder(prefix, token);
		for (const folder of page.folders) {
			const id = folder.slice(prefix.length).replace(/\/$/, '');
			if (isSnapshotId(id)) ids.push(id);
		}
		token = page.nextToken;
	} while (token);
	return ids.sort().reverse();
}

/** The contract's hash as `draft.json` records it, and as the template's snapshot is compared. */
const contractHashOf = (contract: unknown) =>
	createHash('sha256').update(JSON.stringify(contract)).digest('hex');

/**
 * ADR-0010 §1, third refusal: when the run's template is published, its snapshot's contract must be
 * the draft's. The same derivation on both sides (`mockContractOfBundle`); an unpublished template
 * has nothing to compare and is skipped.
 */
async function assertTemplateContract(templateKey: string, draftHash: string): Promise<void> {
	const client = (await projectClientKey(templateKey)) ?? UNASSIGNED_CLIENT;
	const pointer = await currentPointer(client, templateKey);
	if (!pointer) return;
	const bundle = await readSnapshotBundle(client, templateKey, pointer.current);
	if (!bundle) {
		throw new AdapterError(
			409,
			'math_unproven',
			"The template is published but its snapshot cannot be read, so the draft's contract cannot be compared with it. Report this as a fail; nothing is fixed.",
		);
	}
	const gameType = await projectGameType(templateKey);
	const published = mockContractOfBundle(protocolFor(gameType), bundle, templateKey, gameType);
	if (contractHashOf(published) !== draftHash) {
		throw new AdapterError(
			409,
			'contract_drifted',
			"The draft's mock contract (protocol, grid, cascade) differs from the one the template's published game deals. The math is locked: report this as a fail; nothing is fixed.",
		);
	}
}

export interface RequestDraftResult {
	draftId: string;
	runtime: { id: string; version: string; commit: string };
	files: number;
	bytes: number;
	flow: { status: 'absent' | 'valid' | 'invalid'; errors: string[] };
	contractHash: string;
}

export const requestDraft = defineOp<Record<string, never>, RequestDraftResult>({
	tool: 'build',
	name: 'request_draft',
	description:
		"Freeze the run's game as a draft QA can play: assemble the runtime bundle as Publish does and copy it under the run's own drafts folder. Refuses, with the reason, when the template's math cannot be proven unchanged, the project's config moved since the run recorded it, the project has a desktop build or its family cannot be played. An invalid flow is returned as a finding, not refused. Nothing is published.",
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	agents: ['qa'],
	scope: 'project',
	write: true,
	// `buildRuntimeBundle` rewrites the project's `deploy/` (as Publish does), then it is copied.
	writes: (_input, s) => [
		`${SUB.deploy(s.clientKey, s.projectKey)}/`,
		draftsPrefix(s.clientKey, s.projectKey),
	],
	handler: async (ctx) => {
		const { clientKey, projectKey } = scope(ctx);
		const { run } = ctx;
		// An ETag, or NO_CONFIG (the template had none before and after), is proven; null is not.
		if (run.templateConfigEtag === null) {
			throw new AdapterError(
				409,
				'math_unproven',
				"The template's config ETag was not recorded for this run (the template's config moved while the project was copied), so the math cannot be proven unchanged. Report this as a fail; nothing is fixed.",
			);
		}
		const config = await loadGameConfigDocWithEtag(clientKey, projectKey);
		if (config.etag !== run.projectConfigEtag) {
			throw new AdapterError(
				409,
				'config_drifted',
				"The project's Game Config changed since the run recorded it. The math is locked: report this as a fail.",
			);
		}
		if (await hasOwnBuiltBundle(projectKey)) {
			throw new AdapterError(
				409,
				'own_bundle',
				'This project has its own desktop build, which the online runtime must not stand in for. A draft is not made.',
			);
		}
		const unplayable = unplayableFamilyMessage(config.doc);
		if (unplayable) throw new AdapterError(409, 'unplayable_family', unplayable);
		const engine = await runtimePointer(SHARED_RUNTIME_ID);
		if (!engine) {
			throw new AdapterError(
				503,
				'no_runtime',
				'The shared runtime has no released version, so a draft has nothing to be played on.',
			);
		}
		const gameType = await projectGameType(projectKey);
		const draftId = newSnapshotId();
		const prefix = draftPrefix(clientKey, projectKey, draftId);
		try {
			const outcome = await withDeployWrite(projectKey, async () => {
				const assembled = await buildRuntimeBundle(projectKey, false);
				const shipped = await checkShippedFlowV2(clientKey, projectKey, {
					flowV2: assembled.flowV2,
					flowV2Library: assembled.flowV2Library,
					scenes: assembled.doc.scenes,
					components: [
						...Object.values(assembled.componentDefs),
						...(assembled.componentVersions ?? []),
					],
					config: assembled.config,
					shaderEffects: assembled.shaderEffects,
				});
				const contract = mockContractOfBundle(
					protocolFor(gameType),
					assembled,
					projectKey,
					gameType,
				);
				const contractHash = contractHashOf(contract);
				await assertTemplateContract(run.templateProjectKey, contractHash);
				const objects = await copyDeployTree(
					`${SUB.deploy(clientKey, projectKey)}/`,
					`${prefix}deploy/`,
				);
				const meta: DraftMeta = {
					draftId,
					runId: run.id,
					runtime: { id: SHARED_RUNTIME_ID, version: engine.version, commit: engine.commit },
					contractHash,
					contract,
					projectConfigEtag: config.etag,
					flow: shipped.status,
					createdAt: new Date().toISOString(),
				};
				await putObjectText(`${prefix}draft.json`, JSON.stringify(meta), 'application/json');
				// Written LAST: a draft without its `runtime.json` is never played, so a crash mid-copy
				// leaves an orphan, never a half-populated draft.
				await putObjectText(`${prefix}runtime.json`, JSON.stringify(assembled), 'application/json');
				return { meta, shipped, objects };
			});
			// A draft a queued play references is never deleted under it.
			const playing = new Set((await queuedDraftJobs()).map((j) => j.draftId));
			for (const old of (await draftFolders(clientKey, projectKey)).slice(RETAINED_DRAFTS)) {
				if (playing.has(old)) continue;
				await deleteObjects(await listAllKeys(draftPrefix(clientKey, projectKey, old)));
			}
			return {
				draftId,
				runtime: outcome.meta.runtime,
				files: outcome.objects.length,
				bytes: outcome.objects.reduce((sum, o) => sum + o.size, 0),
				flow: {
					status: outcome.shipped.status,
					errors:
						outcome.shipped.status === 'invalid' ? describeFlowErrors(outcome.shipped.errors) : [],
				},
				contractHash: outcome.meta.contractHash,
			};
		} catch (e) {
			await deleteObjects(await listAllKeys(prefix)).catch(() => undefined);
			throw e;
		}
	},
});

export interface PlayDraftResult {
	jobRef: string;
	status: 'queued' | 'finished' | 'failed' | 'cancelled';
	/** True when this call queued the play; false when it returned the run's queued one. */
	queued: boolean;
	result?: unknown;
}

export const playDraft = defineOp<{ draftId: string; scenarios?: string[] }, PlayDraftResult>({
	tool: 'build',
	name: 'play_draft',
	description:
		"Play one of this run's drafts in the draft player with forced outcomes, and return a jobRef at once. The default is every scenario of the game kind's script. Never wait or poll for it: the run is told, with the report, when the play is done. One play per run is queued at a time; a second call returns the queued one. When no draft player is deployed the play fails at once as no_player: report the draft as not played.",
	inputSchema: {
		type: 'object',
		properties: {
			draftId: {
				type: 'string',
				description: 'A draftId request_draft returned.',
				pattern: DRAFT_ID,
			},
			scenarios: {
				type: 'array',
				description: "Scenario names to play; omit for every scenario of the kind's script.",
				items: { type: 'string', pattern: SCENARIO },
				maxItems: 20,
			},
		},
		required: ['draftId'],
		additionalProperties: false,
	},
	agents: ['qa'],
	scope: 'project',
	write: true,
	writes: () => [],
	handler: async (ctx, { draftId, scenarios }) => {
		const { clientKey, projectKey } = scope(ctx);
		const prefix = draftPrefix(clientKey, projectKey, draftId);
		const raw = await getObjectText(`${prefix}draft.json`);
		let meta: Partial<DraftMeta> | null = null;
		try {
			meta = raw ? (JSON.parse(raw) as Partial<DraftMeta>) : null;
		} catch {
			meta = null;
		}
		// The same answer for a missing draft and another run's, so a draftId proves nothing.
		if (!meta || meta.runId !== ctx.run.id || !(await objectExists(`${prefix}runtime.json`))) {
			throw new AdapterError(404, 'unknown_draft', `This run has no complete draft ${draftId}.`);
		}
		const player = activeDraftPlayer();
		const jobRef = newDraftJobRef();
		const { job, queued } = await insertDraftJob({
			jobRef,
			runId: ctx.run.id,
			agent: ctx.agent,
			draftId,
			scenarios: scenarios ?? null,
			...(player ? {} : { settleNow: { status: 'failed' as const, result: NO_PLAYER_RESULT } }),
		});
		// The job row is committed: nothing below may throw. A throw would release the op, and a
		// retry would insert a second job (a settled `no_player` one leaves no open play to return).
		let now = job;
		try {
			if (queued && player && job.status === 'queued') {
				try {
					await player.submit({
						jobRef: job.jobRef,
						runId: ctx.run.id,
						clientKey,
						projectKey,
						gameType: await projectGameType(projectKey),
						draftId,
						scenarios: scenarios ?? null,
					});
					armDraftWatch(job, player, job);
				} catch (e) {
					console.error(`director draft job ${job.jobRef}: the player refused it:`, e);
					await settleDraftJob({
						jobRef: job.jobRef,
						runId: ctx.run.id,
						status: 'failed',
						result: { reason: 'submit_failed', message: 'The draft player did not take the play.' },
						via: 'inline',
					});
				}
			}
			now = (await getDraftJob(job.jobRef)) ?? job;
		} catch (e) {
			console.error(`director draft job ${job.jobRef}: read-back after queueing failed:`, e);
		}
		return {
			jobRef: now.jobRef,
			status: now.status,
			queued,
			...(now.status === 'queued' ? {} : { result: now.result }),
		};
	},
});

export const BUILD_OPS = [requestDraft, playDraft];
