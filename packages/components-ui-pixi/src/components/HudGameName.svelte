<script lang="ts">
	import type { HudTextOverride } from 'engine-layout';

	import UiGameName from './UiGameName.svelte';

	/**
	 * The HUD game-name corner (clock + game name) as a REGISTERED bound component, so a
	 * flow-v2-driven game — where the coded `<UI>` chrome that used to draw this corner is
	 * suppressed — still renders it: `<FlowV2Mount>` mounts the `hudCorners` scene and
	 * `LayoutNodeView` resolves the `HudGameName` `bind` through `getBoundComponent`. It is
	 * ALSO the one home the coded `<UI>` `gameName` snippet renders through, so the two paths
	 * can't drift (§ default-HUD initiative, Phase 2 — corners).
	 *
	 * `LayoutNodeView` spreads the node's `bind.props` (a {@link HudTextOverride}) + `transform`
	 * onto this component; the coded snippet passes the same shape plus the game's default `name`.
	 * We rebuild the `{ name, override }` `UiGameName` expects so the corner renders byte-for-byte
	 * either way. `name` is the coded fallback shown ONLY when no `text` is set — online games get
	 * their project name injected into `bind.props.text` (`applyHudGameNameDefault`), so it wins.
	 * (`apps/lines` under `?flowV2` has no such injection ⇒ it falls back to the generic `'GAME'`.)
	 *
	 * We extract `text`/`style` explicitly because that is the whole of {@link HudTextOverride}; a
	 * NEW field on that type must be threaded HERE and in the coded `<UI>` `gameName` snippet, else
	 * it's silently dropped. `UiGameName` anchors its `<Text>` at the default `{0,0}` (matching the
	 * seeded `hud-gamename` node) and does not follow an author-changed node anchor on the flow path.
	 */
	type Props = HudTextOverride & {
		/** Coded fallback game name (coded snippet only); bound path has none ⇒ generic default. */
		name?: string;
		/** Placement transform LayoutNodeView passes to every bound component; unused (the wrapping
		 * Container already positions us, and `UiGameName` renders at local origin). */
		transform?: unknown;
	};

	const { name, text, style }: Props = $props();
</script>

<UiGameName name={name ?? 'GAME'} override={{ text, style }} />
