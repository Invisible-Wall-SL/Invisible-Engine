<script lang="ts">
	import { Text, REM } from 'pixi-svelte';
	import type { HudTextOverride } from 'engine-layout';

	/**
	 * The HUD logo corner (top-right styled text) as a REGISTERED bound component — the logo
	 * twin of {@link HudGameName}. Registered so a flow-v2-driven game renders it (the coded
	 * `<UI>` chrome that used to draw it is suppressed; `<FlowV2Mount>` mounts the `hudCorners`
	 * scene and `LayoutNodeView` resolves this `HudLogo` `bind` via `getBoundComponent`). It is
	 * also the one home the coded `<UI>` `logo` snippet renders through, so the two can't drift.
	 *
	 * `LayoutNodeView` spreads the node's `bind.props` (a {@link HudTextOverride}) + `transform`;
	 * we render the SAME `<Text>` the coded snippet did (top-right anchor, coded base style merged
	 * under the author override), so the corner is byte-for-byte identical on both paths. Renders
	 * at local origin — the wrapping Container carries the placement.
	 *
	 * KNOWN LIMITATIONS: (a) the `{ x: 1, y: 0 }` anchor is HARDCODED to the seeded `hud-logo`
	 * node's anchor (mirroring the coded snippet, which also ignored the node anchor), so an author
	 * re-anchoring the node in the editor is NOT followed on the flow path — unlike the general
	 * bound-component contract (`LayoutNodeView` "SHOULD read transform.anchor"); revisit if authored
	 * corner anchoring becomes a need. (b) We extract `text`/`style` explicitly because that is the
	 * whole of {@link HudTextOverride}; a NEW field on that type must be threaded HERE and in the
	 * coded `<UI>` `logo` snippet, else it's silently dropped.
	 */
	type Props = HudTextOverride & { transform?: unknown };

	const { text, style }: Props = $props();

	const baseStyle = {
		fontFamily: 'proxima-nova',
		fontSize: REM * 1.5,
		fontWeight: '600',
		lineHeight: REM * 2,
		fill: 0xffffff,
	} as const;
</script>

<Text anchor={{ x: 1, y: 0 }} text={text ?? 'ADD YOUR LOGO'} style={{ ...baseStyle, ...style }} />
