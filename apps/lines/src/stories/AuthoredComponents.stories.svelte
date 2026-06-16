<script lang="ts" module>
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const { Story } = defineMeta({
		title: 'COMPONENTS/Authored (live)',
	});
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	import { App, Container, Text } from 'pixi-svelte';
	import { StoryLocale } from 'components-storybook';
	import {
		ButtonFrame,
		ButtonLabel,
		HudReadout,
		HudTicker,
		HudCaption,
		HudValue,
	} from 'components-ui-pixi';
	import { ComponentInstance } from 'engine-layout/svelte';
	import { registerBoundComponents, registerComponents, type ComponentDef } from 'engine-layout';

	import { setContext } from '../game/context';

	setContext();

	// Live gallery of EVERY component authored in the Component Editor — across all
	// projects + the shared library — fetched from the launcher and rendered as live
	// `ComponentInstance`s. The hardcoded ENGINE-LAYOUT/Button stories prove the
	// engine path with sample defs; THIS story shows the author's real saved
	// components, which no other Storybook surface did (see docs/STATUS.md).
	//
	// The published engine Storybook is served same-origin from the launcher
	// (`/storybook/view/...`, auth-gated), so a same-origin fetch carries the session
	// cookie and the `/api/editor/components/all` gate passes. In local dev (port 6001,
	// no launcher session) the fetch fails → a clear message, never a blank canvas.
	//
	// CAVEAT: a component's project-specific ART (atlas regions) only resolves if that
	// asset is in THIS (lines) bundle, so a button from another project renders its
	// structure + text + engine-asset parts but may show empty art. Each tile is
	// isolated in a `<svelte:boundary>`, so a component that references a missing
	// spine/bitmap-font degrades to a "render failed" tile instead of blanking the
	// gallery.

	// The coded parts authored defs may MOUNT via a `bind` node — register them so the
	// def expansion resolves (mirrors the game's `registerBoundComponents`).
	registerBoundComponents({
		ButtonFrame,
		ButtonLabel,
		HudReadout,
		HudTicker,
		HudCaption,
		HudValue,
	});

	type Entry = { projectKey: string | null; def: ComponentDef };

	const COLS = 4;
	const CELL_W = 460;
	const CELL_H = 420;
	const START_X = 260;
	const START_Y = 240;

	let status = $state<'loading' | 'ok' | 'empty' | 'error'>('loading');
	let message = $state('Loading authored components…');
	let items = $state<Entry[]>([]);

	const tileX = (i: number) => START_X + (i % COLS) * CELL_W;
	const tileY = (i: number) => START_Y + Math.floor(i / COLS) * CELL_H;

	onMount(async () => {
		// `?componentsBase=`/`?editorDocBase=` point at a launcher origin (e.g. a local
		// `:3010`); default is same-origin (`''`) — correct for the published Storybook.
		const params = new URLSearchParams(window.location.search);
		const base = params.get('componentsBase') || params.get('editorDocBase') || '';
		try {
			const res = await fetch(`${base}/api/editor/components/all`, { credentials: 'include' });
			if (!res.ok) {
				status = 'error';
				message =
					res.status === 401 || res.status === 403
						? 'Sign in on the launcher (Invisible Editor access) to load authored components — open this Storybook from app.invisiblewall.org.'
						: `Could not load components: ${res.status} ${res.statusText}`;
				return;
			}
			const data = (await res.json()) as Entry[];
			// Register every fetched def BEFORE rendering so each `ComponentInstance`
			// resolves its `componentId` at init (project shadows shared by load order).
			const defs: Record<string, ComponentDef> = {};
			for (const entry of data) defs[entry.def.id] = entry.def;
			registerComponents(defs);
			items = data;
			status = data.length ? 'ok' : 'empty';
			if (!data.length)
				message = 'No authored components yet — create one in the Component Editor.';
		} catch (err) {
			status = 'error';
			message = `Fetch failed (likely cross-origin in local dev): ${
				err instanceof Error ? err.message : String(err)
			}`;
		}
	});
</script>

<Story name="all authored components">
	<StoryLocale lang="en">
		{#if status !== 'ok'}
			<div class="status" data-status={status}>{message}</div>
		{/if}
		<App>
			{#each items as item, i (item.def.id + ':' + i)}
				<Container x={tileX(i)} y={tileY(i)}>
					<Text
						anchor={{ x: 0.5, y: 1 }}
						y={-150}
						text={`${item.def.name}  ·  ${item.projectKey ?? 'shared'}`}
						style={{ fontFamily: 'proxima-nova', fontSize: 22, fontWeight: '600', fill: 0xffffff }}
					/>
					<svelte:boundary>
						<ComponentInstance
							node={{
								id: `gallery-${item.def.id}-${i}`,
								kind: 'componentInstance',
								componentId: item.def.id,
								x: 0,
								y: 0,
							}}
							space="canvas"
						/>
						{#snippet failed()}
							<Text
								anchor={0.5}
								text="⚠ render failed"
								style={{
									fontFamily: 'proxima-nova',
									fontSize: 20,
									fontWeight: '600',
									fill: 0xff6b6b,
								}}
							/>
						{/snippet}
					</svelte:boundary>
				</Container>
			{/each}
		</App>
	</StoryLocale>
</Story>

<style>
	.status {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		z-index: 999;
		padding: 10px 14px;
		background-color: #1b1b1f;
		color: #ffd479;
		font-family: sans-serif;
		font-size: 14px;
		line-height: 1.4;
	}
	.status[data-status='error'] {
		color: #ff9b9b;
	}
</style>
