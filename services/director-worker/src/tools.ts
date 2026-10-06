/**
 * Every tool an agent definition may name (ADR-0002). The agent loader rejects any other.
 *
 * - `ADAPTER_OPS` are served by the launcher at `POST /api/director/adapter/<tool>/<op>`. The ones
 *   already built are in its registry (`apps/launcher-api/src/lib/server/director/registry.ts`);
 *   `check:director-adapters` fails if the registry holds an op this list lacks. The `build.*` ops
 *   are not served yet.
 * - `WORKER_TOOLS` are served by the worker itself, from the run tables: run state, checkpoints,
 *   the owner conversation and the spend ledger. There is no tool that submits a mockup breakdown:
 *   the worker's own code produces it (`mockups/analyze.ts`), so no model output ever sets an
 *   element's status.
 *
 * Plain data with no imports, so the launcher's fixture can read it.
 */
export const ADAPTER_OPS = [
	'gamemaker.list_templates',
	'gamemaker.get_template',
	'gamemaker.create_from_template',
	'gamemaker.get_project',
	'atlas.list_regions',
	'atlas.get_region',
	'atlas.set_region_prompt',
	'atlas.queue_variants',
	'atlas.list_variants',
	'atlas.get_variant_image',
	'atlas.choose_variant',
	'atlas.pack_sheet',
	'atlas.sheet_stats',
	'comfyui.job_status',
	'mockups.list',
	'mockups.get_image',
	'mockups.get_crop',
	'mockups.save_crops',
	'rigger.list_rigs',
	'rigger.rebind_attachments',
	'flipbook.list_clips',
	'flipbook.save_clip',
	'symbols.get_map',
	'symbols.set_state',
	'scene.get_layout',
	'scene.update_nodes',
	'wintext.get_doc',
	'wintext.update_doc',
	'localization.get_strings',
	'localization.update_strings',
	'fonts.list',
	'fonts.bake_from_ttf',
	'build.request_draft',
	'build.play_draft',
] as const;

export const WORKER_TOOLS = [
	'run.get_state',
	'run.set_plan',
	'run.request_checkpoint',
	'run.post_activity',
	'run.ask_owner',
	'run.assign_task',
	'run.request_pipeline_change',
	'run.submit_review',
	'run.submit_qa',
	'costs.get_run_spend',
] as const;

export const KNOWN_TOOLS: ReadonlySet<string> = new Set([...ADAPTER_OPS, ...WORKER_TOOLS]);
