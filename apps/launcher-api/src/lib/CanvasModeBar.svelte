<script lang="ts" generics="T extends string">
	// Universal floating mode/device switcher — a segmented control that floats at the
	// top-centre of a canvas (the parent must be `position: relative`). One source of
	// truth for every tool's on-canvas mode bar (editor device selector, rigger mode
	// switcher, …): change the chrome here and every consumer follows. Mirrors the
	// rigger's `#modeBar`/`.seg` look. See docs/ui-inventory.md §9.
	interface Option {
		value: T;
		label: string;
		title?: string;
		/** Marks a non-base selection (e.g. an override layout) for accent styling. */
		flagged?: boolean;
	}

	let {
		options,
		value = $bindable(),
		onChange,
		ariaLabel = 'Mode',
	}: {
		options: Option[];
		value: T;
		onChange?: (value: T) => void;
		ariaLabel?: string;
	} = $props();

	function select(v: T): void {
		value = v;
		onChange?.(v);
	}
</script>

<div class="mode-bar">
	<span class="seg" role="tablist" aria-label={ariaLabel}>
		{#each options as opt (opt.value)}
			<button
				type="button"
				role="tab"
				aria-selected={value === opt.value}
				class="seg-btn"
				class:active={value === opt.value}
				class:flagged={value === opt.value && opt.flagged}
				title={opt.title ?? opt.label}
				onclick={() => select(opt.value)}
			>
				{opt.label}
			</button>
		{/each}
	</span>
</div>

<style>
	.mode-bar {
		position: absolute;
		top: 10px;
		left: 50%;
		transform: translateX(-50%);
		/* Above any in-canvas overlay (the editor's HUD layers reach z-index 1001 in the
		   same stacking context); still harmless for tools with a flat canvas. */
		z-index: 2000;
		pointer-events: none;
	}
	.seg {
		display: inline-flex;
		border: 1px solid #2a2a33;
		border-radius: 8px;
		overflow: hidden;
		background: rgba(20, 23, 28, 0.85);
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
		backdrop-filter: blur(3px);
		pointer-events: auto;
	}
	.seg-btn {
		border: none;
		border-right: 1px solid #2a2a33;
		border-radius: 0;
		background: transparent;
		color: #9a9aa6;
		padding: 7px 14px;
		font-size: 12px;
		font-family: inherit;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		cursor: pointer;
		transition:
			background 0.14s,
			color 0.14s;
	}
	.seg-btn:last-child {
		border-right: none;
	}
	.seg-btn:hover {
		color: #d8d8e0;
	}
	.seg-btn.active {
		background: #7ee0c0;
		color: #0c0f14;
		font-weight: 700;
	}
	.seg-btn.flagged {
		background: #c8a3ff;
	}
</style>
