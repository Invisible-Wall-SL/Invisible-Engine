<script lang="ts">
	/**
	 * The validator report of the open model: one foldable card per part (budgets, LOD chain,
	 * textures, names and sockets, tier windows), each row a fact about the master and how it
	 * stands against the class. What a part checks is its header tooltip.
	 */
	import { MODEL_CLASS_DEFAULTS, type ModelClass } from 'constants-shared/modelTiers';
	import { classLodLevels, lodLabel } from '$lib/models/modelProfile';
	import type { CheckState, ReportSection, ReportSectionId } from '$lib/models/modelReport';
	import SectionCard from '$lib/ui/SectionCard.svelte';

	interface Props {
		sections: readonly ReportSection[];
		cls: ModelClass;
	}
	const { sections, cls }: Props = $props();

	const INFO: Record<ReportSectionId, string[]> = {
		budgets: [
			'The triangles of every level in the master against its class budget. A level more than a tenth over is flagged; it still uploads and ships.',
		],
		lods: [
			'Which levels the master brings (a mesh named _LOD0, _LOD1, …) and which the export makes by simplifying the nearest richer one. An authored level always wins over a generated one.',
			'_LODU is the ultra-only top level. It is never generated: simplifying cannot add detail.',
		],
		textures: [
			'Every image in the master. Sides must be powers of two and divide by 4 (compressed textures are made of 4×4 blocks). A map above the class maximum is only resized down; one below the Full size ships at its own size.',
		],
		names: [
			'Mesh names carry the class (CH hero, WP weapon, PR prop, TL tile, FX effect). Sockets are empties named SK_ in lower snake case, where the game attaches things. Clips are named set.clip.',
		],
		tiers: [
			'The window of master levels each tier ships with the settings on this page, saved or not. Change a window under Overrides.',
		],
		other: ['What the upload reported that the parts above do not recompute.'],
	};

	const STATE_LABEL: Record<CheckState, string> = {
		ok: 'OK',
		info: 'Note',
		warning: 'Warning',
		error: 'Error',
	};

	/** The class budgets, as the Budgets tooltip lists them: `LOD0 6,000 · LOD1 3,000 · …`. */
	const budgets = $derived.by(() => {
		const gen = MODEL_CLASS_DEFAULTS[cls].lodGenerate as {
			tris: readonly number[];
			ultraTris?: number;
		};
		return classLodLevels(cls)
			.map((level) => {
				const tris = level < 0 ? gen.ultraTris : gen.tris[level];
				return `${lodLabel(level)} ${(tris ?? 0).toLocaleString('en-US')}`;
			})
			.join(' · ');
	});

	const count = (section: ReportSection, state: CheckState): number =>
		section.rows.filter((r) => r.state === state).length;

	function summary(section: ReportSection): string {
		const errors = count(section, 'error');
		const warnings = count(section, 'warning');
		if (errors) return `${errors} error${errors === 1 ? '' : 's'}`;
		if (warnings) return `${warnings} warning${warnings === 1 ? '' : 's'}`;
		return 'OK';
	}
</script>

{#each sections as section (section.id)}
	<SectionCard scope="models" id="report-{section.id}" title={section.title}>
		{#snippet info()}
			{#each INFO[section.id] as paragraph, i (i)}<p>{paragraph}</p>{/each}
			{#if section.id === 'budgets'}<p>A {cls} may have: {budgets} triangles.</p>{/if}
		{/snippet}
		{#snippet actions()}
			<span class="sum {section.state}">{summary(section)}</span>
		{/snippet}
		<table>
			<tbody>
				{#each section.rows as row, i (i)}
					<tr class={row.state}>
						<td class="mark">
							<span class="dot" title={STATE_LABEL[row.state]} aria-label={STATE_LABEL[row.state]}
							></span>
						</td>
						<th scope="row">{row.label}</th>
						<td class="value">{row.value}</td>
						<td class="note">
							{row.note ?? ''}
							{#if row.code && row.state !== 'ok'}<code>{row.code}</code>{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</SectionCard>
{/each}

<style>
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
		margin-bottom: 6px;
	}
	th,
	td {
		padding: 5px 10px 5px 0;
		border-bottom: 1px solid #1d1d26;
		text-align: left;
		vertical-align: top;
		font-weight: 400;
	}
	tr:last-child th,
	tr:last-child td {
		border-bottom: none;
	}
	th {
		width: 26%;
		color: #e8e8ee;
		font-weight: 600;
		word-break: break-word;
	}
	.mark {
		width: 14px;
		padding-right: 6px;
	}
	.dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #3d8f73;
	}
	.info .dot {
		background: #5a6a8a;
	}
	.warning .dot {
		background: #e0a94a;
	}
	.error .dot {
		background: #ff7a7a;
	}
	.value {
		width: 26%;
		color: #d8d8e2;
		font-variant-numeric: tabular-nums;
	}
	.note {
		color: #8b8b98;
		line-height: 1.5;
	}
	.warning .note {
		color: #d3b483;
	}
	.error .note {
		color: #ff9a9a;
	}
	code {
		margin-left: 6px;
		font-size: 10px;
		letter-spacing: 0.03em;
		opacity: 0.7;
	}
	.sum {
		font-size: 11px;
		padding: 1px 8px;
		border: 1px solid #2a2a35;
		border-radius: 999px;
		color: #8b8b98;
	}
	.sum.warning {
		border-color: #5a4520;
		color: #d3b483;
	}
	.sum.error {
		border-color: #6a2727;
		color: #ff9a9a;
	}
</style>
