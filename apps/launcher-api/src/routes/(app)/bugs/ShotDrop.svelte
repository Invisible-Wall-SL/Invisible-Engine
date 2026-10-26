<script lang="ts">
	import { MAX_SCREENSHOT_BYTES } from '$lib/bugReports';

	let {
		onfiles,
		disabled = false,
		room,
	}: {
		/** The images picked, dropped or pasted, already checked for type and size. */
		onfiles: (files: File[]) => void;
		disabled?: boolean;
		/** How many more the bug may take; past it the rest are refused here. */
		room: number;
	} = $props();

	const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

	let input = $state<HTMLInputElement | null>(null);
	let over = $state(false);
	let refusal = $state<string | null>(null);

	function take(list: FileList | File[] | null | undefined): void {
		const files = [...(list ?? [])];
		if (!files.length || disabled) return;
		const ok = files.filter((f) => TYPES.includes(f.type) && f.size <= MAX_SCREENSHOT_BYTES);
		const kept = ok.slice(0, Math.max(0, room));
		const refused: string[] = [];
		if (ok.length < files.length) refused.push('only PNG, JPEG or WebP images up to 10 MB');
		if (kept.length < ok.length) refused.push(`room for ${Math.max(0, room)} more`);
		refusal = refused.length ? `Some files were left out: ${refused.join('; ')}.` : null;
		if (kept.length) onfiles(kept);
	}

	/** A pasted screenshot is taken from anywhere on the page; pasted text is left alone. */
	function onpaste(e: ClipboardEvent): void {
		const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
		if (!files.length || disabled) return;
		e.preventDefault();
		take(files);
	}
</script>

<svelte:window {onpaste} />

<div
	class="drop"
	class:over
	class:disabled
	role="group"
	aria-label="Add screenshots"
	ondragover={(e) => {
		e.preventDefault();
		over = !disabled;
	}}
	ondragleave={() => (over = false)}
	ondrop={(e) => {
		e.preventDefault();
		over = false;
		take(e.dataTransfer?.files);
	}}
>
	<span>Drop screenshots here, paste one (Ctrl+V), or</span>
	<button type="button" class="btn" {disabled} onclick={() => input?.click()}>choose files</button>
	<input
		bind:this={input}
		type="file"
		accept={TYPES.join(',')}
		multiple
		hidden
		onchange={(e) => {
			take(e.currentTarget.files);
			e.currentTarget.value = '';
		}}
	/>
</div>
{#if refusal}<p class="refusal" role="status">{refusal}</p>{/if}

<style>
	.drop {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 16px;
		border: 1px dashed #3a3a48;
		border-radius: 10px;
		background: #121218;
		color: #9a9aa6;
		font-size: 12px;
		text-align: center;
	}
	.drop.over {
		border-color: #6ea8ff;
		background: #17212a;
	}
	.drop.disabled {
		opacity: 0.55;
	}
	.refusal {
		margin: 0;
		font-size: 12px;
		color: #f5b95c;
	}
</style>
