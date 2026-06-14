<script lang="ts">
	type Props = {
		// `fixed` renders the always-on tiny build stamp pinned to the screen corner;
		// omitted/false renders inline (the in-modal footer use).
		fixed?: boolean;
	};

	const { fixed = false }: Props = $props();

	const build =
		typeof __IE_BUILD__ !== 'undefined' ? __IE_BUILD__ : { version: '', builtAt: '', debug: false };

	const shortTime = (iso: string) => {
		if (!iso) return '';
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return '';
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
	};

	const label = $derived.by(() => {
		const parts: string[] = [];
		if (build.version) parts.push(`v${build.version}`);
		const time = shortTime(build.builtAt);
		if (time) parts.push(time);
		let text = parts.join(' ');
		if (text && build.debug) text += ' 🐞';
		return text;
	});
</script>

{#if label}
	{#if fixed}
		<span class="ie-build-stamp">{label}</span>
	{:else}
		{label}
	{/if}
{/if}

<style>
	.ie-build-stamp {
		position: fixed;
		right: 4px;
		bottom: 2px;
		z-index: 9999;
		font-family: monospace;
		font-size: 9px;
		line-height: 1;
		color: #ffffff;
		opacity: 0.5;
		pointer-events: none;
		user-select: none;
	}
</style>
