<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let regionName = $state(data.regions[0]?.name ?? '');
	let prompt = $state(data.regions[0]?.prompt ?? '');
	let busy = $state(false);
	let err = $state('');
	let resultKey = $state('');
	let resultSeed = $state<number | null>(null);

	function onRegionChange() {
		const r = data.regions.find((x) => x.name === regionName);
		prompt = r?.prompt ?? '';
	}

	async function generate() {
		if (!prompt.trim()) {
			err = 'Enter a prompt first.';
			return;
		}
		busy = true;
		err = '';
		resultKey = '';
		try {
			const res = await fetch('/atlas/generate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ regionName, prompt }),
			});
			const body = await res.json();
			if (!res.ok) {
				err = body.message ?? 'Generation failed.';
			} else {
				resultKey = body.r2_key;
				resultSeed = body.seed ?? null;
			}
		} catch (e) {
			err = String(e);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Atlas Maker — Invisible Wall</title></svelte:head>

<div class="shell">
	<header>
		<div class="brand">INVISIBLE WALL · ATLAS MAKER</div>
		<a class="ghost" href="/">‹ Launcher</a>
	</header>

	{#if data.missing}
		<p class="err">No manifest found in R2 at <code>{data.manifestKey}</code>.</p>
	{:else}
		<div class="grid">
			<div class="controls">
				<label>Region
					<select bind:value={regionName} onchange={onRegionChange}>
						{#each data.regions as r (r.name)}
							<option value={r.name}>{r.name}</option>
						{/each}
					</select>
				</label>

				<label>Prompt
					<textarea bind:value={prompt} rows="5" placeholder="e.g. a glossy golden gemstone, shiny game icon, isolated subject"></textarea>
				</label>

				<button onclick={generate} disabled={busy}>
					{busy ? 'Generating…' : 'Generate'}
				</button>

				{#if err}<p class="err">{err}</p>{/if}
				<p class="muted">{data.regions.length} regions · manifest <code>{data.manifestKey}</code></p>
			</div>

			<div class="preview">
				{#if busy}
					<div class="placeholder">Generating on the local GPU via ComfyUI…</div>
				{:else if resultKey}
					<img src={`/atlas/image?key=${encodeURIComponent(resultKey)}`} alt="generated region" />
					<p class="muted">seed {resultSeed} · <code>{resultKey}</code></p>
				{:else}
					<div class="placeholder">The generated region will appear here.</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.shell {
		max-width: 1100px;
		margin: 0 auto;
		padding: 28px 24px;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 24px;
	}
	.brand {
		font-weight: 700;
		letter-spacing: 0.12em;
		color: #7ee0c0;
		font-size: 14px;
	}
	.ghost {
		border: 1px solid #333;
		color: #aaa;
		padding: 6px 12px;
		border-radius: 8px;
		text-decoration: none;
		font-size: 13px;
	}
	.grid {
		display: grid;
		grid-template-columns: 340px 1fr;
		gap: 20px;
	}
	.controls {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 13px;
		color: #9a9aa5;
	}
	select,
	textarea {
		background: #0e0e12;
		color: #eee;
		border: 1px solid #333;
		border-radius: 8px;
		padding: 10px;
		font-size: 14px;
		font-family: inherit;
		resize: vertical;
	}
	button {
		background: #6b5bff;
		color: #fff;
		border: none;
		padding: 11px;
		border-radius: 8px;
		font-size: 15px;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.preview {
		min-height: 60vh;
		border: 1px solid #222;
		border-radius: 12px;
		background: #16161c;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 16px;
	}
	.preview img {
		max-width: 100%;
		max-height: 70vh;
		border-radius: 8px;
		background:
			repeating-conic-gradient(#2a2a32 0% 25%, #20202700 0% 50%) 50% / 24px 24px;
	}
	.placeholder {
		color: #6a6a76;
		font-size: 14px;
	}
	.muted {
		color: #888;
		font-size: 12px;
	}
	.err {
		color: #ff7b72;
		font-size: 13px;
	}
	code {
		background: #1c1c24;
		padding: 1px 5px;
		border-radius: 4px;
		font-size: 11px;
	}
</style>
