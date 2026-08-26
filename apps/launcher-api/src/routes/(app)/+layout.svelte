<script lang="ts">
	import type { Snippet } from 'svelte';
	import { navigating } from '$app/state';
	import BootSplash from '$lib/BootSplash.svelte';
	import { bootPhrases } from '$lib/bootPhrases';

	let {
		children,
		data,
	}: {
		children: Snippet;
		data?: { tools?: { id: string; name: string; url: string; handsOff?: boolean }[] };
	} = $props();

	// Heavy tool routes (FX, Flow, Editor…) ship large JS chunks (PixiJS, Spine,
	// particle-emitter) that download AFTER the click but BEFORE the page renders —
	// so the launcher looks frozen for a few seconds. `navigating.to` is set for that
	// whole client-side-navigation window, so the CRT boot splash gives instant feedback.
	//
	// One loading screen, everywhere: this is the same screen the Python tools
	// (Atlas / Sheet Maker) and the static apps (Rigger / Spine) boot with — see
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
	// A `handsOff` tool (Spine/Rigger's static `view.html`, Atlas/Sheet Maker's Python
	// origin) is NOT splashed here: its route redirects out of the app, SvelteKit finishes
	// that redirect with a full page load, and the destination document boots the very same
	// CRT itself — so splashing the hop plays the screen twice, ours and then theirs from
	// the top. The destination owns the one loading screen.
	const SPLASH_DELAY_MS = 200;

	let boot = $state<{ id: string; name: string } | null>(null);
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

{@render children()}

{#if boot}
	<BootSplash
		tool={boot.name}
		phrases={bootPhrases(boot.id)}
		ready={navDone}
		onfinished={() => (boot = null)}
	/>
{/if}

<style>
	:global(body) {
		margin: 0;
		background: #0b0b0f;
		color: #eee;
		font-family: system-ui, sans-serif;
	}
</style>
