<script lang="ts">
	// Shared top-bar chrome for every launcher tool: the Invisible emblem (→ home),
	// the current tool's name, and a horizontal switcher of every OTHER online tool
	// the user can see. The look here is the source of truth; the Python tools
	// (atlas/sheet) render a visually identical HTML twin fed by the launcher.
	// See docs/design/unified-tool-bar.md.
	import Emblem from '$lib/Emblem.svelte';
	import { TOOLS, toolBarItems, type ToolDef } from '$lib/roles';
	import { untrack } from 'svelte';

	// `clientKey`/`projectKey` are the loudly-shown active project (project-explicit
	// scoping). Optional so a page that doesn't resolve a project can omit them; when
	// present the bar shows `<client> / <project>` so the target is never invisible.
	let {
		current,
		tools,
		clientKey,
		projectKey,
	}: {
		current: string;
		tools: ToolDef[];
		clientKey?: string;
		projectKey?: string;
	} = $props();

	const name = $derived(TOOLS[current]?.name ?? '');
	const items = $derived(toolBarItems(tools, current));

	// Drop the tool labels (icon-only) only when the labelled row would actually
	// overflow its track — not on a blunt viewport breakpoint. We watch the nav with a
	// ResizeObserver and remember the labelled "natural" width so we can re-expand with
	// hysteresis once the room comes back (in icon-only mode the row no longer overflows,
	// so `scrollWidth` alone can't tell us whether expanding would fit again).
	let nav = $state<HTMLElement | null>(null);
	let compact = $state(false);
	let naturalWidth = 0;

	function measure(): void {
		const el = nav;
		if (!el) return;
		if (untrack(() => compact)) {
			// Labels hidden: re-expand only if the remembered full width fits with slack.
			if (naturalWidth && el.clientWidth >= naturalWidth + 8) compact = false;
		} else {
			naturalWidth = el.scrollWidth;
			if (el.scrollWidth > el.clientWidth + 1) compact = true;
		}
	}

	$effect(() => {
		const el = nav;
		if (!el) return;
		const ro = new ResizeObserver(() => measure());
		ro.observe(el);
		measure();
		return () => ro.disconnect();
	});
</script>

<a class="brand" href="/" title="Invisible Launcher">
	<Emblem height={18} />
	<span class="brand-name">{name}</span>
</a>

{#if projectKey}
	<div class="scope" title="Current project — every action on this page targets it">
		<span class="scope-label">Project</span>
		{#if clientKey}<span class="scope-client">{clientKey}</span><span class="scope-sep">/</span>{/if}
		<span class="scope-project">{projectKey}</span>
	</div>
{/if}

{#if items.length}
	<nav class="switcher" class:compact bind:this={nav} aria-label="Switch tool">
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
	.scope {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex: none;
		padding: 4px 10px;
		border-radius: 8px;
		border: 1px solid #2b6f5a;
		background: #14241d;
		white-space: nowrap;
	}
	.scope-label {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #5f8f7c;
	}
	.scope-client {
		font-size: 13px;
		font-weight: 600;
		color: #b9b9c4;
	}
	.scope-sep {
		color: #4a6357;
	}
	.scope-project {
		font-size: 13px;
		font-weight: 700;
		color: #7ee0c0;
		font-family: ui-monospace, monospace;
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
	/* Icon-only when the labelled row would overflow its track (driven by the
	   ResizeObserver above): drop labels before anything else collapses. */
	.switcher.compact .label {
		display: none;
	}
	.switcher.compact .tool {
		padding: 6px;
	}
</style>
