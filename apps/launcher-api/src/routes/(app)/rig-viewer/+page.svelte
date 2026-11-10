<script lang="ts">
	import { asset } from '$app/paths';
</script>

<svelte:head><title>Invisible Rig Viewer — Invisible Wall</title></svelte:head>

<!-- The load fn always redirects to /rig-viewer/view.html (full-page, no iframe);
	 this renders only if a redirect somehow doesn't occur. -->
<p style="font-family: system-ui, sans-serif; color: #cfcfd6; text-align: center; margin-top: 16vh;">
	Opening the Invisible Rig Viewer… <a href={asset('/rig-viewer/view.html')} style="color: #5db0ff;">continue</a>
</p>
