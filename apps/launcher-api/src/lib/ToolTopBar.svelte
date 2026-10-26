<script lang="ts">
	// Shared top-bar chrome for every launcher tool: the Invisible emblem (→ home),
	// the current tool's name, and a horizontal switcher of every OTHER online tool
	// the user can see. The look here is the source of truth; the Python tools
	// (atlas/sheet) render a visually identical HTML twin fed by the launcher.
	// See docs/design/unified-tool-bar.md.
	import { page } from '$app/state';
	import { BUG_TOOL } from '$lib/bugReports';
	import Emblem from '$lib/Emblem.svelte';
	import { TOOLS, toolBarItems, toolAccent, type ToolDef } from '$lib/roles';
	import { reportBugHref, withProject } from '$lib/toolLinks';
	import { untrack, type Snippet } from 'svelte';

	// `clientKey`/`projectKey` are the loudly-shown active project (project-explicit
	// scoping). Optional so a page that doesn't resolve a project can omit them; when
	// present the bar shows `<client> / <project>` so the target is never invisible.
	// `meta` is an optional snippet for the page's own right-aligned header content
	// (counters, save pill, etc.) — render it through the bar so the chrome (height,
	// background, divider) stays identical on every tool instead of each page rolling
	// its own <header>.
	let {
		current,
		tools,
		clientKey,
		projectKey,
		meta,
	}: {
		current: string;
		tools: ToolDef[];
		clientKey?: string;
		projectKey?: string;
		meta?: Snippet;
	} = $props();

	const name = $derived(TOOLS[current]?.name ?? '');
	const items = $derived(toolBarItems(tools, current));
	// "Report bug": Pipeline Bug Reports' form with this tool filled in, for whoever has that tool
	// (not on the two bug tools themselves).
	const reportHref = $derived(
		tools.some((t) => t.id === BUG_TOOL.pipeline) &&
			current in TOOLS &&
			!Object.values(BUG_TOOL).includes(current)
			? reportBugHref('/bugs', current, page.url.origin + page.url.pathname, projectKey)
			: null,
	);

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

<header class="iw-toolbar">
	<a class="brand" href="/" title="Invisible Launcher">
		<Emblem height={18} />
		<span class="brand-name">{name}</span>
	</a>

	{#if projectKey}
		<div class="scope" title="Current project — every action on this page targets it">
			<span class="scope-label">Project</span>
			{#if clientKey}<span class="scope-client">{clientKey}</span><span class="scope-sep">/</span
				>{/if}
			<span class="scope-project">{projectKey}</span>
		</div>
	{/if}

	{#if items.length}
		<nav class="switcher" class:compact bind:this={nav} aria-label="Switch tool">
			{#each items as tool (tool.id)}
				<!-- Carries the shown project, so a tool opens what this bar says is open even after
				     another tab moved the session (`resolveToolScope` reads `?project=`). -->
				<a class="tool" href={tool.url && withProject(tool.url, projectKey)} title={tool.name}>
					{#if tool.icon}<span class="ic" style="color:{toolAccent(tool.id)}"
							>{@html tool.icon}</span
						>{/if}
					<span class="label">{tool.barName ?? tool.name.replace(/^Invisible /, '')}</span>
				</a>
			{/each}
		</nav>
	{/if}

	{#if meta}<div class="meta">{@render meta()}</div>{/if}

	{#if reportHref}
		<!-- Another tool's form, with this tool filled in: `resolve()` cannot carry a query. -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a class="report" href={reportHref} title={`Report a bug in ${name}`}>
			<span class="ic">
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<!-- The Pipeline Bug Reports icon (`TOOL_ICONS.pipelineBugs`). -->
					<path d="M9 7.5a3 3 0 0 1 6 0" />
					<rect x="7" y="7.5" width="10" height="12.5" rx="5" />
					<path d="M12 11v9" />
					<path d="M7 12H3.5" />
					<path d="M17 12h3.5" />
					<path d="M7.5 16.5 4 18.5" />
					<path d="M16.5 16.5l3.5 2" />
					<path d="M9.5 5 8 3" />
					<path d="M14.5 5 16 3" />
				</svg>
			</span>
			<span class="label">Report bug</span>
		</a>
	{/if}
</header>

<style>
	/* The single source of truth for tool-bar chrome. Every launcher tool renders
	   this wrapper so the bar's height, padding, background and divider are identical
	   tool to tool — pages no longer roll their own <header>. The Python tools
	   (atlas/sheet) mirror this in their HTML twin (.iw-toolbar). */
	.iw-toolbar {
		display: flex;
		align-items: center;
		gap: 16px;
		flex: none;
		padding: 14px 24px;
		border-bottom: 1px solid #1c1c24;
		background: #0f0f14;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: none;
		font-size: 12px;
		color: #888;
	}
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
	/* The HTML twins (atlas/sheet/rig/rigger) carry the same button as `.iw-report`. */
	.report {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex: none;
		padding: 5px 10px;
		border-radius: 8px;
		border: 1px solid #3a2a33;
		color: #f778ba;
		text-decoration: none;
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
	}
	.report:hover {
		background: #2a1a22;
		border-color: #6b3550;
	}
	/* Icon-only when the labelled row would overflow its track (driven by the
	   ResizeObserver above): drop labels before anything else collapses. */
	.switcher.compact .label {
		display: none;
	}
	.switcher.compact .tool {
		padding: 6px;
	}
	/* If even the icon-only row can't fit, scroll it rather than clipping tools
	   off the end (the HTML twins in atlas/sheet/rig/rigger mirror this). */
	.switcher.compact {
		overflow-x: auto;
		overflow-y: hidden;
	}
</style>
