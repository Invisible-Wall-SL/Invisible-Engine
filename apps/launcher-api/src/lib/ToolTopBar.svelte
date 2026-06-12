<script lang="ts">
	// Shared top-bar chrome for every launcher tool: the Invisible emblem (→ home),
	// the current tool's name, and a horizontal switcher of every OTHER online tool
	// the user can see. The look here is the source of truth; the Python tools
	// (atlas/sheet) render a visually identical HTML twin fed by the launcher.
	// See docs/design/unified-tool-bar.md.
	import Emblem from '$lib/Emblem.svelte';
	import { TOOLS, toolBarItems, type ToolDef } from '$lib/roles';

	let { current, tools }: { current: string; tools: ToolDef[] } = $props();

	const name = $derived(TOOLS[current]?.name ?? '');
	const items = $derived(toolBarItems(tools, current));
</script>

<a class="brand" href="/" title="Invisible Launcher">
	<Emblem height={18} />
	<span class="brand-name">{name}</span>
</a>

{#if items.length}
	<nav class="switcher" aria-label="Switch tool">
		{#each items as tool (tool.id)}
			<a class="tool" href={tool.url} title={tool.name}>
				{#if tool.icon}<span class="ic">{@html tool.icon}</span>{/if}
				<span class="label">{tool.barName ?? tool.name.replace(/^Invisible /, '')}</span>
			</a>
		{/each}
	</nav>
{/if}

<style>
	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
		flex: none;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: #7ee0c0;
		font-size: 15px;
		text-decoration: none;
		white-space: nowrap;
	}
	.switcher {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		flex: 1 1 auto;
		overflow: hidden;
	}
	.tool {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex: none;
		padding: 5px 9px;
		border-radius: 8px;
		border: 1px solid transparent;
		color: #b9b9c4;
		text-decoration: none;
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
		transition:
			background 0.14s,
			border-color 0.14s,
			color 0.14s;
	}
	.tool:hover {
		background: #1b1b22;
		border-color: #2c2c38;
		color: #e8e8ee;
	}
	.ic {
		display: inline-flex;
		width: 16px;
		height: 16px;
	}
	.ic :global(svg) {
		width: 16px;
		height: 16px;
	}
	.label {
		display: inline;
	}
	/* Icon-only when the row gets tight: drop labels before anything collapses. */
	@media (max-width: 1100px) {
		.label {
			display: none;
		}
		.tool {
			padding: 6px;
		}
	}
</style>
