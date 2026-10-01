<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { updated } from '$app/state';

	let { children }: { children: Snippet } = $props();

	// Hand-off from the shell's CRT boot splash: on a HARD load of a tool page (typed URL,
	// refresh, a link out of a static tool, or an in-tool full navigation like Flipbook's
	// open-a-clip) `hooks.server.ts` injects `/shared/boot-splash.js` into the shell, because
	// there is no app running yet to mount <BootSplash>. This is the root layout, so it mounts
	// for every page INCLUDING an error page — the splash can never outlive a failed boot.
	// Client-side navigation between tools is handled by `(app)/+layout.svelte` instead.
	onMount(() => window.IWBoot?.done());

	// A deploy replaces the hashed route chunks, so an open tab's next client-side navigation
	// asks for a chunk that no longer exists ("Failed to fetch dynamically imported module").
	// Once SvelteKit sees a newer build (`version.pollInterval`), navigate with a full load.
	beforeNavigate(({ willUnload, to }) => {
		if (updated.current && !willUnload && to?.url) location.href = to.url.href;
	});
</script>

{@render children()}
