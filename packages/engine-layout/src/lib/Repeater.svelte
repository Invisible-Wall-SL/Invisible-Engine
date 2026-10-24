<script lang="ts" module>
	import type { ComponentInstanceNode, RepeaterNode, Scene } from './types';

	export type Props = {
		node: RepeaterNode;
		space?: Scene['space'];
	};

	/** Count sources named but not registered: warned once per name, not per placement. */
	const warnedCountSources: Record<string, true> = {};
	/** Segment variants naming no registered def: warned once per repeater and variant. */
	const warnedMissingVariants: Record<string, true> = {};
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { Container } from 'pixi-svelte';
	import { getContextLayout } from 'utils-layout';
	import {
		REPEATER_SELECT_EVENT,
		REPEATER_SELECTED_ID,
		REPEATER_SELECTED_KEY,
		REPEATER_SELECTED_VALUE,
	} from 'constants-shared/repeater';

	import ComponentInstance from './ComponentInstance.svelte';
	import { componentDesignSize } from './componentDesignSize';
	import { getComponentParams } from './componentParamsContext';
	import { getComponentValueSource } from './registerComponentValues';
	import {
		isCountRepeater,
		missingRepeaterVariants,
		repeaterCount,
		repeaterCountOffsets,
		repeaterSegmentComponent,
		repeaterSegmentSize,
		repeaterSegmentValues,
		type RepeaterItemSize,
	} from './repeaterCount';
	import { expandSourceTemplate } from './valueBindings';
	import { getFlowPress } from './registerFlowPress';
	import { resolveComponent } from './registerComponents';
	import { resolveTransform } from './resolveTransform';
	import { getRepeaterSource, type RepeaterItem } from './registerRepeaterSources';

	const { node, space }: Props = $props();
	const layoutContext = getContextLayout();

	// Resolve the live item array (§ feature cards). Init-stable, like `ComponentInstance`'s
	// value feed: the registry is populated once at boot. The subscription lives in an
	// `$effect` so it re-binds if the registered store changes and tears down on unmount. No
	// source registered ⇒ `items` stays empty ⇒ nothing renders (parity, safe no-op).
	const source = getRepeaterSource(node.source);
	let items = $state<RepeaterItem[]>([]);
	$effect(() => {
		if (!source) return;
		return source.subscribe((next) => {
			items = next;
		});
	});

	// The per-item design size drives the layout stride. `componentDesignSize` unions the
	// def's sized leaves (the same box the editor previews); a def with only explicit
	// sizes needs no loaded textures, so a `null` intrinsic getter suffices. Unsizable ⇒
	// stride from the gap alone (items stack at the gap pitch).
	const def = resolveComponent(node.componentId).def;
	const box = $derived(
		def
			? componentDesignSize(def, () => null, layoutContext.stateLayoutDerived.layoutType())
			: null,
	);
	const itemWidth = $derived(box?.width ?? 0);
	const itemHeight = $derived(box?.height ?? 0);
	const columns = $derived(Math.max(1, node.layout.columns ?? 1));

	const offsetOf = (index: number): { x: number; y: number } => {
		if (node.layout.direction === 'grid') {
			const col = index % columns;
			const row = Math.floor(index / columns);
			return {
				x: col * (itemWidth + node.layout.gap),
				y: row * (itemHeight + node.layout.gap),
			};
		}
		if (node.layout.direction === 'column') {
			return { x: 0, y: index * (itemHeight + node.layout.gap) };
		}
		return { x: index * (itemWidth + node.layout.gap), y: 0 };
	};

	// COUNT MODE (segmented counters, `node.count`): N instances, N following a live engine number
	// (`count.source`, `{param}`-templated against the enclosing instance's params) or, with no
	// source, `count.preview`. A source named but not registered draws none. Each segment is keyed by
	// its index, N and component, so a change of N remounts them: a segment reads its `index` /
	// `count` once, at init, as every instance reads its params. The geometry is `repeaterCount.ts`,
	// shared with the editor canvas. Absent `count` ⇒ the source list below, unchanged (parity).
	const countNode = isCountRepeater(node) ? node : undefined;
	const enclosingParams = getComponentParams();
	const countTemplate = countNode?.count.source;
	const countSourceName = countTemplate
		? expandSourceTemplate(countTemplate, enclosingParams)
		: undefined;
	const countSource = countSourceName ? getComponentValueSource(countSourceName) : undefined;
	if (countTemplate && !countSource && !warnedCountSources[countSourceName ?? countTemplate]) {
		warnedCountSources[countSourceName ?? countTemplate] = true;
		console.warn(
			`[engine-layout] repeater '${node.id}': its count source '${countSourceName ?? countTemplate}' is not registered — it draws no segments.`,
		);
	}
	let countValue = $state<unknown>(countTemplate ? undefined : countNode?.count.preview);
	// Untracked: a source emits synchronously on subscribe, and its getter's reads must not become
	// this effect's dependencies (each change would resubscribe).
	$effect(() =>
		untrack(() =>
			countSource?.subscribe((value) => {
				countValue = value;
			}),
		),
	);
	// What each segment's number inputs follow, resolved here against the ENCLOSING instance's params
	// (the counter's), so a segment param of the same key cannot shadow it.
	const passedSources = countNode?.passInputs
		? Object.fromEntries(
				Object.entries(countNode.passInputs).flatMap(([input, template]) => {
					const name =
						typeof template === 'string' ? expandSourceTemplate(template, enclosingParams) : '';
					return name ? [[input, name]] : [];
				}),
			)
		: undefined;
	// A variant naming no registered def (a snapshot published before it was saved) draws the middle
	// segment in its place, as an unset variant does; the registry is filled at boot, so init-stable.
	const hasComponent = (componentId: string): boolean => !!resolveComponent(componentId).def;
	if (countNode) {
		// What a middle segment draws: the one a missing variant falls back to.
		const middle = repeaterSegmentComponent(countNode, 1, 3, hasComponent);
		for (const { slot, componentId } of missingRepeaterVariants(countNode, hasComponent)) {
			const key = `${node.id}/${slot}/${componentId}`;
			if (warnedMissingVariants[key]) continue;
			warnedMissingVariants[key] = true;
			const instead = hasComponent(middle) ? `'${middle}' draws there instead` : 'nothing draws';
			console.warn(
				`[engine-layout] repeater '${node.id}': its ${slot} segment '${componentId}' is not registered — ${instead}.`,
			);
		}
	}
	const segmentCount = $derived(countNode ? repeaterCount(countNode, countValue) : 0);
	const countLayout = $derived.by(() => {
		if (!countNode) return undefined;
		const layoutType = layoutContext.stateLayoutDerived.layoutType();
		const sizes: Record<string, RepeaterItemSize | null> = {};
		const sizeOf = (componentId: string): RepeaterItemSize | null => {
			if (!(componentId in sizes)) {
				const segmentDef = resolveComponent(componentId).def;
				sizes[componentId] = segmentDef ? repeaterSegmentSize(segmentDef, layoutType) : null;
			}
			return sizes[componentId];
		};
		return repeaterCountOffsets(countNode, segmentCount, sizeOf, hasComponent);
	});
	const segments = $derived.by(() => {
		if (!countNode || !countLayout) return [];
		return countLayout.offsets.map((offset, index) => {
			const componentId = repeaterSegmentComponent(countNode, index, segmentCount, hasComponent);
			const values = repeaterSegmentValues(index, segmentCount);
			const instance: ComponentInstanceNode = {
				kind: 'componentInstance',
				id: `${node.id}:${index}`,
				componentId,
				x: 0,
				y: 0,
				params: values,
			};
			return { key: `${index}/${segmentCount}/${componentId}`, instance, values, offset };
		});
	});

	// Anchor the WHOLE laid-out group against the node position (§ repeater centering). The node's
	// `anchor` is read against the TOTAL group footprint (item size × count + gaps, per direction),
	// so anchor `{0.5,0.5}` centres the cards on the node origin while an unset/`{0,0}` anchor keeps
	// the extend-right layout byte-identical to before (parity). The SAME rule the editor placeholder
	// applies (`repeaterBoxes`/`drawRepeater`), so preview and runtime agree pixel-for-pixel. Resolved
	// through `resolveTransform` so a per-layoutType `anchor` override is honoured like every other node.
	const anchor = $derived(
		resolveTransform(node, layoutContext.stateLayoutDerived.layoutType()).anchor ?? { x: 0, y: 0 },
	);
	const groupSize = $derived.by(() => {
		if (countLayout) return { width: countLayout.width, height: countLayout.height };
		const count = items.length;
		if (count === 0) return { width: 0, height: 0 };
		const gap = node.layout.gap;
		if (node.layout.direction === 'grid') {
			const cols = Math.max(1, Math.min(columns, count));
			const rows = Math.max(1, Math.ceil(count / cols));
			return {
				width: cols * itemWidth + (cols - 1) * gap,
				height: rows * itemHeight + (rows - 1) * gap,
			};
		}
		if (node.layout.direction === 'column') {
			return { width: itemWidth, height: count * itemHeight + (count - 1) * gap };
		}
		return { width: count * itemWidth + (count - 1) * gap, height: itemHeight };
	});
	const groupOffset = $derived({
		x: -(anchor.x * groupSize.width),
		y: -(anchor.y * groupSize.height),
	});

	// A synthetic instance node per item: the wrapping <Container> below applies the
	// per-item offset, so the instance renders at its own local origin (x/y 0) and its
	// values/press arrive via props, not via the doc.
	//
	// PER-ITEM component (distinct, authorable cards): an item may name its OWN `componentId`
	// (a bespoke card per buy-feature mode); absent ⇒ the node's shared `componentId`, so a
	// uniform repeater is byte-identical to today (parity). The stride below still measures the
	// NODE's `componentId` box — a heterogeneous set lays out on that shared pitch until the
	// config side (Phase B) also drives per-item sizing.
	const itemNode = (item: RepeaterItem, index: number): ComponentInstanceNode => ({
		kind: 'componentInstance',
		id: `${node.id}:${item.key ?? index}`,
		componentId: item.componentId ?? node.componentId,
		x: 0,
		y: 0,
	});

	// Flow press routing (Invisible Flow v2, §Part 2) — the repeater analogue of a button's fused
	// container-event pin. When the flow OWNS the repeater's `select` event (an authored exec edge from
	// this repeater NODE's fused `<node.id>.onSelect` pin), a card press routes to the flow ALONE,
	// seeding the pressed item as the trigger payload so the pin's data-outs resolve to what was
	// picked: its `key` under BOTH the legacy `betModeKey` and the generic `selectedKey`, plus its
	// `value` under `selectedValue` for the numeric actions (`setBetAmount`, `setAutoSpins`) that a
	// string key can't feed. When NOT owned (every coded game — no repeater select
	// ownership at all — and any doc that didn't author it), the coded `item.onSelect` runs EXACTLY as
	// today (parity). Consulted AT PRESS TIME so ownership reflects the LIVE v2 handle regardless of boot
	// timing (mirrors `<ComponentInstance>`'s `firePress`). `<node.id>` is the repeater's stable id — the
	// SAME `componentId` the Scene→decl projection uses (`repeaterSelectConfiguredEvent`).
	const selectHandler = (item: RepeaterItem) => () => {
		const routed = getFlowPress()?.(node.id, REPEATER_SELECT_EVENT, {
			[REPEATER_SELECTED_KEY]: item.key,
			[REPEATER_SELECTED_ID]: item.key,
			[REPEATER_SELECTED_VALUE]: item.value,
		});
		if (routed) routed();
		else item.onSelect?.();
	};
</script>

<Container x={groupOffset.x} y={groupOffset.y}>
	{#if countNode}
		{#each segments as segment (segment.key)}
			<Container x={segment.offset.x} y={segment.offset.y}>
				<ComponentInstance
					node={segment.instance}
					{space}
					inputSources={passedSources}
					inputValues={segment.values}
				/>
			</Container>
		{/each}
	{:else}
		{#each items as item, index (item.key ?? index)}
			{@const off = offsetOf(index)}
			<Container x={off.x} y={off.y}>
				<ComponentInstance
					node={itemNode(item, index)}
					{space}
					engineValues={item.values}
					onSelect={selectHandler(item)}
				/>
			</Container>
		{/each}
	{/if}
</Container>
