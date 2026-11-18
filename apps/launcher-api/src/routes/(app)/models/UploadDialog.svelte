<script lang="ts">
	/**
	 * Upload one master GLB: a new model (its id and class read off the file name, both editable)
	 * or a new master for the open one (id and class fixed). The file goes straight to R2 by a
	 * presigned PUT; the launcher then validates it and commits it, and a refusal is shown here
	 * with the validator's issues.
	 */
	import { untrack } from 'svelte';
	import { MODEL_CLASSES, type ModelClass } from 'constants-shared/modelTiers';
	import ConfirmDialog from '$lib/ConfirmDialog.svelte';
	import { MODEL_ID_RULE, modelIdRefusal } from '$lib/models/modelId';
	import type { ModelDoc, ModelValidatorIssue } from '$lib/server/modelStorage';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import { formatBytes, modelIdFromFile, uploadMaster, type UploadPhase } from './models.client';

	interface Props {
		open: boolean;
		project: string;
		/** The model whose master is replaced, or `null` to add a new model. Its `cls` is `null`
		 *  when its model.json cannot be read: the class is then asked for again. */
		replace: { id: string; cls: ModelClass | null; etag: string | null } | null;
		/** Ids the project already has: a new model may not take one. */
		taken: readonly string[];
		maxBytes: number;
		onclose: () => void;
		ondone: (id: string, doc: ModelDoc, etag: string | null) => void;
	}
	const { open, project, replace, taken, maxBytes, onclose, ondone }: Props = $props();

	let file = $state<File | null>(null);
	let id = $state('');
	let cls = $state<ModelClass>('prop');
	let busy = $state(false);
	let phase = $state<UploadPhase>('preparing');
	let fraction = $state(0);
	let failure = $state('');
	let issues = $state.raw<ModelValidatorIssue[]>([]);
	let over = $state(false);

	// A dialog reopened starts empty. Only on the opening edge: `replace` is rebuilt by the page
	// while the dialog is open, and that must not drop the chosen file.
	let wasOpen = false;
	$effect(() => {
		const opening = open && !wasOpen;
		wasOpen = open;
		if (!opening) return;
		untrack(() => {
			file = null;
			id = replace?.id ?? '';
			cls = replace?.cls ?? 'prop';
			failure = '';
			issues = [];
		});
	});

	const problem = $derived.by(() => {
		if (!file) return '';
		if (!/\.glb$/i.test(file.name)) return 'A master is a .glb file.';
		if (file.size > maxBytes) return `That file is over ${formatBytes(maxBytes)}.`;
		if (file.size === 0) return 'That file is empty.';
		if (replace) return '';
		if (taken.includes(id))
			return `This project already has "${id}". Open it and use Replace master.`;
		// The register step's own refusal: not an id, or one that differs from a model's only in case.
		return modelIdRefusal(id, taken) ?? '';
	});
	const busyLabel = $derived(
		phase === 'uploading'
			? `Uploading… ${Math.round(fraction * 100)}%`
			: phase === 'validating'
				? 'Validating…'
				: 'Preparing…',
	);

	function choose(next: File | null | undefined) {
		if (!next) return;
		file = next;
		failure = '';
		issues = [];
		const read = modelIdFromFile(next.name);
		if (!replace) id = read.id;
		if (read.cls && !replace?.cls) cls = read.cls;
	}

	async function upload() {
		if (!file || problem) return;
		busy = true;
		failure = '';
		issues = [];
		const answer = await uploadMaster({
			project,
			id,
			cls,
			baseEtag: replace ? replace.etag : null,
			file,
			onPhase: (next, done = 0) => {
				phase = next;
				fraction = done;
			},
		});
		busy = false;
		if (answer.ok) {
			ondone(id, answer.doc, answer.etag);
			return;
		}
		failure = answer.message;
		issues = answer.issues;
	}
</script>

<ConfirmDialog
	{open}
	title={replace ? `Replace the master of ${replace.id}` : 'Upload a model'}
	confirmLabel="Upload"
	{busy}
	{busyLabel}
	blocked={!file || !!problem}
	error={failure}
	onconfirm={() => void upload()}
	oncancel={onclose}
>
	{#snippet body()}
		<label
			class="drop"
			class:over
			ondragover={(e) => {
				e.preventDefault();
				over = true;
			}}
			ondragleave={() => (over = false)}
			ondrop={(e) => {
				e.preventDefault();
				over = false;
				choose(e.dataTransfer?.files[0]);
			}}
		>
			<input
				type="file"
				accept=".glb,model/gltf-binary"
				disabled={busy}
				onchange={(e) => choose(e.currentTarget.files?.[0])}
			/>
			{#if file}
				<span class="name">{file.name}</span>
				<span class="dim">{formatBytes(file.size)}</span>
			{:else}
				<span class="name">Choose a master GLB, or drop it here</span>
				<span class="dim">Up to {formatBytes(maxBytes)}</span>
			{/if}
		</label>

		{#if !replace?.cls}
			<div class="fields" class:one={!!replace}>
				{#if !replace}<label>
						<span
							>Id <InfoTip
								>The name the game uses for this model: the master's own asset id, as the Blender
								export names the file, kept exactly (case included). It is {MODEL_ID_RULE}. It
								cannot be changed later.</InfoTip
							></span
						>
						<input type="text" bind:value={id} disabled={busy} spellcheck="false" />
					</label>{/if}
				<label>
					<span
						>Class <InfoTip
							>Decides the triangle budgets, the largest map and which LOD levels each tier ships.
							Read off the file's prefix (CH, WP, PR, TL, FX) when it has one.</InfoTip
						></span
					>
					<select bind:value={cls} disabled={busy}>
						{#each MODEL_CLASSES as option (option)}
							<option value={option}>{option}</option>
						{/each}
					</select>
				</label>
			</div>
		{/if}

		{#if problem}<p class="problem">{problem}</p>{/if}
		{#if issues.length}
			<ul class="issues">
				{#each issues as issue, i (i)}
					<li class={issue.level}><code>{issue.code}</code> {issue.message}</li>
				{/each}
			</ul>
		{/if}
	{/snippet}
</ConfirmDialog>

<style>
	.drop {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 22px 16px;
		border: 1px dashed #3a3a48;
		border-radius: 8px;
		background: #101016;
		cursor: pointer;
		text-align: center;
	}
	.drop.over,
	.drop:hover {
		border-color: #7ee0c0;
	}
	.drop input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}
	.drop:focus-within {
		outline: 1px solid #7ee0c0;
	}
	.name {
		font-size: 13px;
		color: #e8e8ee;
		word-break: break-all;
	}
	.dim {
		font-size: 11px;
		color: #8b8b98;
	}
	.fields {
		display: grid;
		grid-template-columns: 1fr 140px;
		gap: 12px;
		margin-top: 14px;
	}
	.fields.one {
		grid-template-columns: 140px;
	}
	.fields label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: #b9b9c4;
	}
	.fields input,
	.fields select {
		font: inherit;
		font-size: 12px;
		padding: 5px 8px;
		border: 1px solid #2a2a35;
		border-radius: 6px;
		background: #14141a;
		color: #e8e8ee;
	}
	.problem {
		margin: 12px 0 0;
		font-size: 12px;
		color: #d3b483;
	}
	.issues {
		margin: 12px 0 0;
		padding: 8px 12px 8px 26px;
		border: 1px solid #3a2a2a;
		border-radius: 8px;
		background: #171113;
		font-size: 12px;
		line-height: 1.6;
	}
	.issues .error {
		color: #ff9a9a;
	}
	.issues .warning {
		color: #d3b483;
	}
	.issues code {
		font-size: 11px;
		opacity: 0.8;
	}
</style>
