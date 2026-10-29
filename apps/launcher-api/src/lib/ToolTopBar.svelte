<script lang="ts">
	// Shared top-bar chrome for every launcher tool: the Invisible emblem (→ home),
	// the current tool's name, and a "Tools" dropdown of every OTHER online tool the
	// user can see, grouped by stage. The look here is the source of truth; the Python tools
	// (atlas/sheet) render a visually identical HTML twin fed by the launcher.
	// See docs/design/unified-tool-bar.md.
	import { page } from '$app/state';
	import AskAiPanel from '$lib/AskAiPanel.svelte';
	import { BUG_TOOL } from '$lib/bugReports';
	import Emblem from '$lib/Emblem.svelte';
	import { TOOL_STAGES, TOOLS, toolBarItems, type ToolDef } from '$lib/roles';
	import { reportBugHref, withProject } from '$lib/toolLinks';
	import type { Snippet } from 'svelte';

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

	// "Ask the AI": a movable chat about this tool, for anyone who has it open.
	const canAsk = $derived(current in TOOLS);
	let asking = $state(false);

	const groups = $derived(
		TOOL_STAGES.map((stage) => ({
			stage,
			tools: items.filter((t) => stage.tools.includes(t.id)),
		})).filter((g) => g.tools.length),
	);

	let open = $state(false);
	let switcher = $state<HTMLElement | null>(null);
	let toggle = $state<HTMLButtonElement | null>(null);

	function close(refocus = false): void {
		open = false;
		if (refocus) toggle?.focus();
	}

	$effect(() => {
		if (!open) return;
		const onPointer = (e: PointerEvent) => {
			if (switcher && !switcher.contains(e.target as Node)) close();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') close(true);
		};
		window.addEventListener('pointerdown', onPointer);
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('pointerdown', onPointer);
			window.removeEventListener('keydown', onKey);
		};
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

	<div class="switcher" bind:this={switcher}>
		{#if items.length}
			<button
				type="button"
				class="switch-btn"
				class:on={open}
				aria-haspopup="true"
				aria-expanded={open}
				title="Switch to another tool"
				bind:this={toggle}
				onclick={() => (open = !open)}
			>
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
						<rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
						<rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
						<rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
						<rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
					</svg>
				</span>
				<span class="label">Tools</span>
				<svg class="chev" viewBox="0 0 12 12" aria-hidden="true">
					<path
						d="M3 4.5 6 7.5 9 4.5"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</button>
			{#if open}
				<nav class="menu" aria-label="Switch tool">
					{#each groups as g (g.stage.id)}
						<section class="stage" style="--accent:{g.stage.accent}">
							<h3>{g.stage.label}</h3>
							{#each g.tools as tool (tool.id)}
								<!-- Carries the shown project, so a tool opens what this bar says is open even
								     after another tab moved the session (`resolveToolScope` reads `?project=`). -->
								<a
									class="tool"
									href={tool.url && withProject(tool.url, projectKey)}
									title={tool.name}
									onclick={() => close()}
								>
									{#if tool.icon}<span class="ic">{@html tool.icon}</span>{/if}
									<span>{tool.barName ?? tool.name.replace(/^Invisible /, '')}</span>
								</a>
							{/each}
						</section>
					{/each}
				</nav>
			{/if}
		{/if}
	</div>

	{#if meta}<div class="meta">{@render meta()}</div>{/if}

	{#if canAsk}
		<button
			type="button"
			class="ask"
			class:on={asking}
			title={`Ask the AI how to do something in ${name}`}
			onclick={() => (asking = true)}
		>
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
					<path d="M20 14a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
					<path d="M9.5 8.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.4" />
					<path d="M12 14.2v.01" />
				</svg>
			</span>
			<span class="label">Ask the AI</span>
		</button>
	{/if}

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

{#if asking}
	<AskAiPanel tool={current} toolName={name} {projectKey} onclose={() => (asking = false)} />
{/if}

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
	/* The switcher is a "Tools" dropdown: one button, and a stage-grouped panel under it
	   (the HTML twins in atlas/sheet/rig/rigger mirror this as .iw-switcher). The wrapper
	   still takes the free width so the meta/Ask/Report controls stay right-aligned. */
	.switcher {
		position: relative;
		display: flex;
		align-items: center;
		min-width: 0;
		flex: 1 1 auto;
	}
	.switch-btn {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		flex: none;
		padding: 5px 9px 5px 10px;
		border-radius: 8px;
		border: 1px solid #2c2c38;
		background: #15151c;
		color: #b9b9c4;
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background 0.14s,
			border-color 0.14s,
			color 0.14s;
	}
	.switch-btn:hover,
	.switch-btn.on {
		background: #1b1b22;
		border-color: #3a3a4a;
		color: #e8e8ee;
	}
	.switch-btn .ic {
		color: #7ee0c0;
	}
	.chev {
		width: 12px;
		height: 12px;
		color: #6f6f7c;
		transition: transform 0.14s;
	}
	.switch-btn.on .chev {
		transform: rotate(180deg);
	}
	.menu {
		position: absolute;
		top: calc(100% + 8px);
		left: 0;
		z-index: 1000;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
		gap: 6px 10px;
		width: min(920px, calc(100vw - 32px));
		max-height: calc(100vh - 90px);
		overflow-y: auto;
		padding: 12px;
		border-radius: 12px;
		border: 1px solid #2c2c38;
		background: #121218;
		box-shadow:
			0 18px 48px rgba(0, 0, 0, 0.55),
			0 0 0 1px rgba(0, 0, 0, 0.4);
	}
	/* Narrow window: span the whole bar instead of hanging off the button's left edge. */
	@media (max-width: 1000px) {
		.switcher {
			position: static;
		}
		.iw-toolbar {
			position: relative;
		}
		.menu {
			top: 100%;
			left: 12px;
			right: 12px;
			width: auto;
		}
	}
	.stage {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.stage h3 {
		margin: 0 0 4px;
		padding: 2px 8px 6px;
		border-bottom: 2px solid color-mix(in srgb, var(--accent) 45%, transparent);
		color: var(--accent);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.tool {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 6px 8px;
		border-radius: 7px;
		color: #b9b9c4;
		text-decoration: none;
		font-size: 12.5px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition:
			background 0.12s,
			color 0.12s;
	}
	.tool .ic {
		flex: none;
		color: var(--accent);
	}
	.tool:hover,
	.tool:focus-visible {
		background: color-mix(in srgb, var(--accent) 12%, #1b1b22);
		color: #f2f2f6;
		outline: none;
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
	.ask {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex: none;
		padding: 5px 10px;
		border-radius: 8px;
		border: 1px solid #2a3150;
		background: none;
		color: #9ab8ff;
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
	}
	.ask:hover,
	.ask.on {
		background: #1a2038;
		border-color: #3b5290;
	}
</style>
