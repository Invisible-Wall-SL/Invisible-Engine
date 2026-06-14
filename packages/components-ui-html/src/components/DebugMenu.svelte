<script lang="ts">
	import { stateDebug } from 'state-shared';

	let panelOpen = $state(false);

	const htmlTools = $derived(
		stateDebug.tools.filter((tool) => tool.surface === 'html' && stateDebug.active[tool.id]),
	);

	// Inline styles (no scoped `<style>` block) so that when `__IE_DEBUG__` is a
	// static false the whole component — including its CSS — is dead-code-eliminated.
	// Svelte extracts a `<style>` block at compile time regardless of `{#if}` gating,
	// which would otherwise leave the debug class names in a player bundle.
	const FONT = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
	const rootStyle = `position:fixed;inset:0;pointer-events:none;z-index:2147483646;font-family:${FONT};`;
	const toggleStyle =
		'position:absolute;right:12px;bottom:12px;pointer-events:auto;padding:8px 12px;font-size:12px;font-weight:700;letter-spacing:0.08em;color:#fff;background:#1a1a24;border:1px solid #3a3a4a;border-radius:6px;opacity:0.85;cursor:pointer;';
	const panelStyle =
		'position:absolute;right:12px;bottom:52px;pointer-events:auto;width:240px;max-height:60vh;overflow-y:auto;padding:8px;color:#fff;background:rgba(10,10,18,0.95);border:1px solid #3a3a4a;border-radius:8px;';
	const headerStyle =
		'padding:4px 4px 8px;font-size:11px;font-weight:700;letter-spacing:0.1em;color:#9fd3ff;';
	const emptyStyle = 'padding:4px;font-size:12px;opacity:0.6;';
	const rowStyle =
		'display:flex;align-items:center;gap:8px;padding:6px 4px;font-size:12px;cursor:pointer;';
	const groupStyle = 'font-size:10px;opacity:0.5;';
	const layerStyle = 'position:absolute;inset:0;pointer-events:none;';
</script>

{#if __IE_DEBUG__}
	<div style={rootStyle}>
		<button
			style={toggleStyle}
			aria-label="Toggle debug menu"
			onclick={() => (panelOpen = !panelOpen)}
		>
			DEBUG
		</button>

		{#if panelOpen}
			<div style={panelStyle}>
				<div style={headerStyle}>Invisible Debug</div>
				{#if stateDebug.tools.length === 0}
					<div style={emptyStyle}>No debug tools registered.</div>
				{/if}
				{#each stateDebug.tools as tool (tool.id)}
					<label style={rowStyle}>
						<input
							type="checkbox"
							checked={Boolean(stateDebug.active[tool.id])}
							onchange={() => stateDebug.toggle(tool.id)}
						/>
						<span style="flex:1;">{tool.label}</span>
						{#if tool.group}
							<span style={groupStyle}>{tool.group}</span>
						{/if}
					</label>
				{/each}
			</div>
		{/if}

		<div style={layerStyle}>
			{#each htmlTools as tool (tool.id)}
				<tool.component />
			{/each}
		</div>
	</div>
{/if}
