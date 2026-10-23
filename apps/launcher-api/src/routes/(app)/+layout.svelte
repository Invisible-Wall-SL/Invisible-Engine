<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { GameFamily } from 'constants-shared/gameKinds';
	import { resolve } from '$app/paths';
	import { navigating, page } from '$app/state';
	import BootSplash from '$lib/BootSplash.svelte';
	import DialogHost from '$lib/DialogHost.svelte';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import { bootPhrases } from '$lib/bootPhrases';
	import { FAMILY_LABELS, familyHiddenToolAt, type ToolDef } from '$lib/roles';

	let {
		children,
		data,
	}: {
		children: Snippet;
		data?: { tools?: ToolDef[]; family?: GameFamily };
	} = $props();

	// A direct link to a tool the project's family does not use gets a notice instead of the tool
	// (game-families.md §6.5): one guard here, not one per tool.
	const hiddenTool = $derived.by(() => {
		const family = data?.family;
		const tool = family && familyHiddenToolAt(page.url.pathname, family);
		return tool && family ? { tool, family } : undefined;
	});

	// Heavy tool routes (FX, Flow, Editor…) ship large JS chunks (PixiJS, rig,
	// particle-emitter) that download AFTER the click but BEFORE the page renders —
	// so the launcher looks frozen for a few seconds. `navigating.to` is set for that
	// whole client-side-navigation window, so the CRT boot splash gives instant feedback.
	//
	// One loading screen, everywhere: this is the same screen the Python tools
	// (Atlas / Sheet Maker) and the static apps (Rigger / rig) boot with — see
	// `$lib/BootSplash.svelte`. Loading something INSIDE an already-open tool uses
	// `<BusyOverlay>` instead.
	//
	// We gate visibility behind a JS timer (not a CSS fade-delay, which is fragile under
	// production CSS minification/keyframe-pruning): the splash only appears once a
	// navigation has been in-flight ~200ms, so quick routes (home, login) never flash it.
	// Only TOOL routes boot-splash; home/admin/onboarding just navigate.
	// A HARD load of a tool page is covered by the shell's vanilla twin instead (injected by
	// `hooks.server.ts`, lifted from the ROOT `+layout.svelte`) — there is no app running to
	// mount <BootSplash> at that point.
	//
	// A `handsOff` tool (rig/Rigger's static `view.html`, Atlas/Sheet Maker's Python
	// origin) is NOT splashed here: its route redirects out of the app, SvelteKit finishes
	// that redirect with a full page load, and the destination document boots the very same
	// CRT itself — so splashing the hop plays the screen twice, ours and then theirs from
	// the top. The destination owns the one loading screen.
	const SPLASH_DELAY_MS = 200;

	// Never null while the splash can still read it: <BootSplash> reads its props after
	// `onfinished` clears the flag, so a nulled `boot` threw "reading 'id'" on teardown.
	let boot = $state({ id: '', name: '' });
	let booting = $state(false);
	let navDone = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const to = navigating.to;
		if (to) {
			const target = data?.tools?.find((t) => t.url === to.url.pathname);
			if (!target || target.handsOff) return;
			navDone = false;
			if (timer === undefined) {
				timer = setTimeout(() => {
					timer = undefined;
					boot = { id: target.id, name: target.name };
					booting = true;
				}, SPLASH_DELAY_MS);
			}
		} else {
			if (timer !== undefined) {
				clearTimeout(timer);
				timer = undefined;
			}
			// The splash owns its own exit: it finishes the line it is typing (and
			// its minimum airtime) and then calls `onfinished`.
			navDone = true;
		}
	});
</script>

{#if hiddenTool}
	<div class="family-notice">
		<ToolTopBar current="" tools={data?.tools ?? []} />
		<main>
			<h1>{hiddenTool.tool.name} is not used by {FAMILY_LABELS[hiddenTool.family]} games</h1>
			<p>
				The active project's kind of game does not use this tool, so the launcher does not offer it.
			</p>
			<a href={resolve('/')}>Back to the launcher</a>
		</main>
	</div>
{:else}
	{@render children()}
{/if}

<!--
	The single modal host for `askConfirm()` / `askMessage()` / `askText()` (see
	`$lib/dialogs.svelte.ts`). Mounted here, once, so no tool page has to own a dialog just to
	ask a yes/no — and so the `showModal()` inertness covers the whole authed shell.
-->
<DialogHost />

{#if booting}
	<BootSplash
		tool={boot.name}
		phrases={bootPhrases(boot.id)}
		ready={navDone}
		onfinished={() => (booting = false)}
	/>
{/if}

<style>
	.family-notice {
		width: 100%;
		box-sizing: border-box;
		padding: 24px clamp(20px, 3vw, 40px);
		color: #e8e8ee;
	}
	.family-notice main {
		max-width: 640px;
		margin: 48px auto;
	}
	.family-notice h1 {
		font-size: 20px;
		margin: 0 0 12px;
	}
	.family-notice p {
		color: #aaa;
	}
	.family-notice a {
		color: #c8a3ff;
	}
	:global(body) {
		margin: 0;
		background: #0b0b0f;
		color: #eee;
		font-family: system-ui, sans-serif;
	}
</style>
