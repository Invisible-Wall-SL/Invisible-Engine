<script lang="ts">
	import { VERDICT_TEXT, type Verdict } from '$lib/profilerBudgets';

	/** A budget verdict as a small pill; `label` replaces the verdict's own word (a device name). */
	interface Props {
		verdict: Verdict;
		label?: string;
		title?: string;
	}
	const { verdict, label, title }: Props = $props();
</script>

<span class="badge {verdict}" title={title ?? VERDICT_TEXT[verdict]}
	>{label ?? VERDICT_TEXT[verdict]}</span
>

<style>
	.badge {
		display: inline-block;
		font-size: 11px;
		line-height: 16px;
		padding: 0 6px;
		border-radius: 8px;
		border: 1px solid transparent;
		white-space: nowrap;
		margin-right: 3px;
	}
	.pass {
		color: #7ee787;
		background: rgba(126, 231, 135, 0.1);
	}
	.warn {
		color: #ffb347;
		background: rgba(255, 179, 71, 0.12);
	}
	.fail {
		color: #ff7b7b;
		background: rgba(255, 123, 123, 0.14);
	}
	.nodata {
		color: #a9a9b8;
		border-style: dashed;
		border-color: #3a3a48;
	}
	.none {
		color: #6c6c7a;
		border-color: #2c2c38;
	}
</style>
