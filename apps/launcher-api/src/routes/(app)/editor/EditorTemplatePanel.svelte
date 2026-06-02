<script lang="ts">
	import type { GameTemplate, LayoutNode, Scene } from 'engine-layout';

	interface Props {
		/** The loaded template (R2 override or built-in fallback), or undefined. */
		template: GameTemplate | undefined;
		/** Current editor scenes — used to mark which slots are filled. */
		scenes: Scene[];
	}
	let { template, scenes }: Props = $props();

	function collectFilled(nodes: LayoutNode[], into: Set<string>): Set<string> {
		for (const n of nodes) {
			if (n.slotId) into.add(n.slotId);
			if (n.kind === 'container') collectFilled(n.children, into);
		}
		return into;
	}

	function filledFor(sceneId: string): Set<string> {
		const sc = scenes.find((s) => s.id === sceneId);
		return sc ? collectFilled(sc.nodes, new Set()) : new Set<string>();
	}
</script>

{#if !template}
	<p class="muted">
		No template for this game type yet. Tag nodes with a <strong>slotId</strong> in Properties, then
		click <strong>Save template</strong> to create it.
	</p>
{:else}
	<section class="tpl">
		<h3>{template.gameType} <span class="count">template</span></h3>
		{#each template.scenes as scene (scene.id)}
			{@const filled = filledFor(scene.id)}
			<div class="scene">
				<h4>{scene.name} <span class="count">{scene.slots.length}</span></h4>
				<ul class="slot-list">
					{#each scene.slots as slot (slot.slotId)}
						{@const isFilled = filled.has(slot.slotId)}
						<li class="slot" class:missing={!isFilled && slot.required}>
							<span class="dot" class:filled={isFilled}></span>
							<span class="label">{slot.name}</span>
							<span class="kind">{slot.kind}</span>
							{#if slot.required}<span class="req">required</span>{/if}
							<span class="status" class:missing={!isFilled && slot.required}>
								{isFilled ? 'filled' : 'empty'}
							</span>
						</li>
					{:else}
						<li class="muted">No slots in this scene.</li>
					{/each}
				</ul>
			</div>
		{/each}
	</section>
{/if}

<style>
	.muted {
		color: #777;
		font-size: 12px;
		padding: 8px;
		line-height: 1.5;
	}
	h3 {
		font-size: 13px;
		margin: 0 0 10px;
		color: #c8a3ff;
		text-transform: capitalize;
	}
	h4 {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #aaa;
		margin: 0 0 6px;
	}
	.count {
		color: #666;
		font-size: 11px;
	}
	.scene {
		margin: 0 0 14px;
	}
	.slot-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.slot {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 8px;
		font-size: 12px;
		border-radius: 6px;
		border: 1px solid transparent;
		color: #c8c8d0;
	}
	.slot.missing {
		border-color: #4a2a30;
		background: #1f1418;
		color: #ff9a9a;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 999px;
		border: 1px solid #444;
		flex: none;
	}
	.dot.filled {
		background: #7ee0c0;
		border-color: #234038;
	}
	.kind {
		color: #888;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.req {
		color: #c8a3ff;
		font-size: 10px;
		text-transform: uppercase;
	}
	.status {
		margin-left: auto;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #666;
	}
	.status.missing {
		color: #ff9a9a;
	}
</style>
