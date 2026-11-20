<script lang="ts">
	/** The validator's issues and the tool's own warnings of one card of the sheet. */
	import type { GameConfigIssue } from 'game-config';

	interface Props {
		issues?: GameConfigIssue[];
		warnings?: string[];
	}
	let { issues = [], warnings = [] }: Props = $props();
</script>

{#if issues.length || warnings.length}
	<ul class="sheet-issues" data-sheet-issues>
		{#each issues as issue (issue.path + issue.message)}
			<li class={issue.severity}>{issue.message}</li>
		{/each}
		{#each warnings as warning (warning)}
			<li class="warning">{warning}</li>
		{/each}
	</ul>
{/if}
