import type { FlowDoc } from 'engine-flow';
import type { FlowDoc as FlowDocV2, FunctionLibraryDoc as FlowV2LibraryDoc } from 'engine-flow-v2';
import type { EffectDoc } from 'engine-fx';
import type { GameConfigDoc } from 'game-config';
import type {
	ComponentDef,
	FlipbookClipEntry,
	FontCatalog,
	LayoutDoc,
	LayoutNode,
	ResolvedWinText,
	RigFlipbookBinding,
	RigFxBinding,
	SoundBindings,
	SoundCatalog,
	SymbolNameMap,
	TumblePatternConfig,
	WinTextDoc,
	CinematicDoc,
} from 'engine-layout';
import {
	editorArtNamespace,
	normalizeHudScenes,
	registerComponentDefaults,
	registerComponents,
	registerRigFx,
	registerTextResolver,
	resolveWinText,
} from 'engine-layout';
import { stateI18nDerived, stateUrlDerived } from 'state-shared';
import { setAuthoredMainSizesMap, setAuthoredLayoutProfile } from 'utils-layout';

import type { SoundEffectName } from './game/sound';
import type { MessagesMap } from 'utils-shared/i18n';

import bakedBundleJson from './baked-editor-bundle.json';
import { defaultLayout } from './game/defaultLayout';
import {
	HUD_BUTTON_INSTANCES,
	TRANSITION_INSTANCE,
	FREE_SPIN_OVERLAY_INSTANCES,
	WIN_INSTANCE,
} from './game/editorFlags';
import type { SymbolInfoMap } from './game/types';

/**
 * One authored free-spin BOOK VFX layer (Invisible Symbols State Machine output). A decorative
 * effect drawn on the book/special symbol during free spins — one behind (`background`) and one in
 * front (`foreground`) of the symbol art. Kind-tagged so each renders through the SAME path the
 * game already uses for that asset class:
 * - `sprite`   — `assetKey` is a sheet FRAME key (a single static frame).
 * - `spine`    — `assetKey` is the spine bundle key; `animationName` is the looping animation.
 * - `flipbook` — `clipId` is the Invisible Flipbook clip (`assetKey` merely its primary sheet).
 * - `fx`       — `effectId` references a baked Invisible FX effect ({@link bakedEffects}); rides the
 *                FX pipeline, so it introduces NO asset here.
 * `sizeRatios` (× cell, default {1,1}) and `offset` (× cell, default {0,0}) place + scale the layer
 * against the matching cell's live geometry. Any sprite/spine/flipbook asset it introduces travels
 * via `symbols.index` exactly like a per-cell binding, so {@link bakedBookVfxAssets} registers it.
 */
export type BookVfxLayer = {
	kind: 'sprite' | 'spine' | 'flipbook' | 'fx';
	assetKey?: string;
	animationName?: string;
	clipId?: string;
	effectId?: string;
	sizeRatios?: { width: number; height: number };
	offset?: { x: number; y: number };
};

/**
 * The explosion → intro TRANSITION (Invisible Symbols State Machine output). Structurally a
 * {@link BookVfxLayer} without the `sprite` kind (a transition has a duration; a frozen frame has
 * none) and without fit hints, plus `delayMs`: how long after a seat's `tumbleExplosion` starts before
 * this mounts there (absent ⇒ 0). Rendered by the same `SymbolLayer` the book VFX use, played ONCE.
 */
export type SymbolTransition = {
	kind: 'spine' | 'flipbook' | 'fx';
	assetKey?: string;
	animationName?: string;
	clipId?: string;
	effectId?: string;
	delayMs?: number;
};

/**
 * One reel-anticipation tier's FX override (Invisible Symbols State Machine output). The sparse twin
 * of one `codedTierFx` ramp step (`game/anticipationPresentation.ts`): every field optional so an
 * un-set one falls through to the coded value in `resolveTierFx`. `overlayTint` is a `#rrggbb` hex
 * (the tool's colour picker); the reader converts it to the `0xRRGGBB` number the code uses.
 */
export type AnticipationTierFxOverride = {
	zoom?: number;
	overlayScale?: number;
	overlayAlpha?: number;
	overlayTint?: string;
	/** Anticipation LOOP target volume (0..1). */
	soundVolume?: number;
	/** Activation STING per-play volume (0..1) — the one-shot arm cue, escalating alongside the loop. */
	stingVolume?: number;
};

/**
 * Build-time freeze (see docs/design/live-assets.md → "Layout-doc bake").
 * `bake-editor-doc.mjs` overwrites `baked-editor-bundle.json` with the frozen doc + the
 * referenced ComponentDefs. A non-null `doc` flips the game to the baked path:
 * the layout + custom component defs come from the bundle (no `/api/editor/doc`
 * fetch, no launcher dependency). The checked-in placeholder has `doc: null`, so
 * an un-baked repo (incl. `apps/lines` dev) keeps fetching live — byte-identical.
 */
type BakedBundle = {
	doc: LayoutDoc | null;
	componentDefaults?: Record<string, Record<string, unknown>>;
	componentDefs?: Record<string, ComponentDef>;
	/** Exact pinned NON-LATEST ComponentDefs (§8.9 v2 multi-version store). Registered
	 * BEFORE `componentDefs` so a `componentInstance` that pins an older version resolves
	 * the precise def it was authored against while latest still wins for unpinned ones.
	 * Absent/empty for every game with no non-latest pin — bundle byte-identical (parity). */
	componentVersions?: ComponentDef[];
	/** Art exported from the doc's references (`deploy/editor-art/`), mirrored
	 * into `static/assets/` by the deploy pull. `json`/`file` are relative to
	 * `static/assets/`. `images[].key` is the sprite node's full `assetKey`. */
	editorArt?: {
		/** `ktx2Json` (sheets) / `ktx2` (images) are the GPU-compressed KTX2 variant of the
		 * page, emitted beside the WebP/PNG by the editor-art export. Present only for a
		 * project re-exported after KTX2 encoding shipped; absent ⇒ the WebP/PNG loads as
		 * before (parity). The asset builder prefers the KTX2 variant unless `?quality=high`. */
		sheets: { key: string; json: string; ktx2Json?: string }[];
		images: { key: string; file: string; ktx2?: string }[];
		/** Spine bundles editor-placed `spine` nodes reference (atlas + skeleton +
		 * shared page). `key` is the node's full `assetKey` (the engine's lookup key);
		 * `scale` defaults to 2. */
		spines?: { key: string; atlas: string; skeleton: string; scale?: number; ktx2Atlas?: string }[];
		/** Placed region names no exported sheet packs — they render blank in-game.
		 * The dangling-binding guard warns about these at boot (see `warnMissingAssets`). */
		missing?: string[];
	};
	/** Fonts (Font Maker output) the project uses, exported to `deploy/editor-fonts/`
	 * and mirrored into `static/assets/` by the deploy pull. The catalog's `prefix`
	 * is that subtree (`editor-fonts`); each entry keeps its `folder` + file names,
	 * so a bitmap descriptor's relative page refs resolve. Registered at boot so
	 * editor-authored fonts reach the shipped game. */
	fonts?: { catalog: FontCatalog };
	/** The project's own sound library (Invisible Sound), exported to `deploy/sounds/` and
	 * mirrored into `static/assets/` by the deploy pull. The catalog's `prefix` is that subtree
	 * (`sounds`); each entry names one flat audio file plus the sprite region it becomes. Loaded
	 * at boot as extra audio BANKS, appended after the shipped audiosprite so a project sound of
	 * the same name overrides it. */
	sounds?: { catalog: SoundCatalog };
	/** Localization-tool strings (source text + REVIEWED translations) in Lingui
	 * message-map shape — merged into the game catalog so editor-authored
	 * localization keys resolve in the shipped game. */
	localization?: {
		sourceLang: string;
		messages: Record<string, Record<string, string>>;
	};
	/** Invisible FX effect index (`invisible-fx.md` §4.4/§8). The pure `EffectDoc`s authored in
	 * `/fx`, exported to `deploy/effects/` and frozen into the bundle by `bake-editor-doc.mjs`.
	 * Each plays via `<EffectPlayer doc=…>`; its `art.assetKey` references an atlas that ALREADY
	 * travels the pipeline (FX never re-packs textures). The export→bake→pull chain is wired, so
	 * this is populated for a freshly-baked project; absent/empty only for a game with no effects
	 * (parity — the checked-in placeholder bundle has none). */
	effects?: EffectDoc[];
	/** Rig-timeline direct FX bindings (`invisible-fx.md` "rig-timeline direct FX binding"). A rig's
	 * OWN animation events → effects, read from the rig `.irig`/`.json` at bake (spine-pixi discards
	 * the custom `event.fx` field, so it can't travel the event stream). Keyed by the rig's runtime
	 * assetKey (its bundle folder — the value `LayoutNodeView` passes to `<SpineProvider key=…>`); the
	 * game registers it via `registerRigFx(bakedRigFx())`, and each `<RiggedEffect>` plays its effect
	 * on the beat of the rig's event. Absent/empty ⇒ `resolveRigFx()` returns [] (parity). */
	rigFx?: Record<string, RigFxBinding[]>;
	/** Invisible Flipbook clips (`invisible-flipbook.md` §"Travel"). The authored frame animations
	 * from `/flipbook`, exported to `deploy/clips/` and frozen into the bundle by
	 * `bake-editor-doc.mjs`. Each is an ORDERED run of region names within one sheet — a sheet the
	 * editor-art export already ships, so a clip introduces no new asset. Registered at boot via
	 * `registerFlipbooks(bakedFlipbooks())`; a consumer resolves `clipId` → clip — a symbol cell, a
	 * placed `flipbook` node, or a rig-timeline binding (see {@link rigFlipbooks}). Unlike `effects`
	 * these are NOT reachability-pruned at bake.
	 * Absent/empty ⇒ `resolveFlipbook()` returns undefined and every consumer renders its static
	 * fallback (parity). */
	flipbooks?: FlipbookClipEntry[];
	/** Rig-timeline direct FLIPBOOK bindings — the frame-animation twin of {@link rigFx}. A rig's OWN
	 * animation events → clips (`event.flipbook`, read from the rig `.irig`/`.json` at bake for the
	 * same reason: spine-pixi discards the custom field). Keyed by the rig's runtime assetKey; the
	 * game registers it via `registerRigFlipbooks(bakedRigFlipbooks())`, and each `<RiggedFlipbook>`
	 * plays its clip on the beat of the rig's event. The clip itself travels in `flipbooks` — this
	 * carries only the binding. Absent/empty ⇒ `resolveRigFlipbooks()` returns [] (parity). */
	rigFlipbooks?: Record<string, RigFlipbookBinding[]>;
	/** Symbol→state asset bindings (Invisible Symbols State Machine output) + the index
	 * of any sprite sheets / images / spine bundles those bindings introduce, exported to
	 * `deploy/editor-symbols/` and mirrored into `static/assets/` by the deploy pull. The
	 * `map` is merged over the coded `SYMBOL_INFO_MAP` at first render (`game/symbolMap.ts`);
	 * the `index` registers the new assets at `createApp`. See
	 * docs/design/invisible-symbols-state-machine.md. */
	symbols?: {
		map: SymbolInfoMap;
		index: {
			/** Sprite sheets. `key` is the source manifest (kept for the exporter); the
			 * sheet's frames register under their own names — symbol bindings reference
			 * those plain frame keys (e.g. `h1.webp`). */
			sheets: { key: string; json: string }[];
			/** Standalone images, registered under the binding's full `assetKey`. */
			images: { key: string; file: string }[];
			/** Spine bundles (atlas + skeleton, shared page on disk). `key` is the
			 * binding's `assetKey`; `scale` defaults to 2 (the symbols convention). */
			spines: { key: string; atlas: string; skeleton: string; scale?: number }[];
			/** Bound sprite-frame names no exported sheet packs — they render blank
			 * in-game. The dangling-binding guard warns about these at boot. */
			missing?: string[];
		};
		/** Symbol DISPLAY NAMES (Invisible Symbols State Machine output) — the human word the game
		 * says for an id (`H1` → "Banana"), singular + plural. Pure text, no asset. Invisible Win
		 * Text interpolates them as `{symbolName}`, so renaming a symbol in `/symbols` rewrites
		 * every win sentence with no template edit. Absent → each symbol speaks as its own id. */
		names?: SymbolNameMap;
		/** PER-SYMBOL SOUND OVERRIDES (Invisible Symbols State Machine output) — symbol → state →
		 * audiosprite key, the cue that ONE symbol plays entering ONE state. Pure text, no asset:
		 * the name addresses a region of the game's own audiosprite, which ships with the game.
		 * Sparse at both levels; a symbol/state with no entry falls through to the config's
		 * game-wide sound slot for that moment (`game-config/sounds`), which is where the shipped
		 * defaults live. Absent → every symbol uses the slots. */
		symbolSounds?: Record<string, Record<string, string>>;
		/** Single GLOBAL win-highlight frame (Invisible Symbols State Machine output). `assetKey`
		 * is the engine spine-asset key the bundle registers — the highlight spine bundle is
		 * exported to `deploy/editor-symbols/` and registered via `index.spines` exactly like the
		 * per-symbol spine cells, so it is already loadable under its `assetKey`. Absent →
		 * `SymbolWinFrame.svelte` keeps the coded `anticipation`/`payframe` frame. `tintMode`/`tintColor`
		 * (both optional) are the MULTIPLY tint the frame applies to the symbols it loops over:
		 * `'fixed'` uses `tintColor`; `'winLine'` uses the paying line's authored colour, resolved at
		 * win time. Both absent → no tint. */
		highlight?: {
			assetKey: string;
			animationName: string;
			tintMode?: 'fixed' | 'winLine';
			tintColor?: string;
		};
		/** Free-spin BOARD GLOW (Invisible Symbols State Machine output) — the reel-house
		 * backdrop spine behind the reels. `assetKey` is the engine spine-asset key the bundle
		 * registers: like `highlight`, its bundle is exported to `deploy/editor-symbols/` and
		 * registered via `index.spines`, so it is already loadable (a Rigger `.irig` skeleton
		 * ships renamed to `.json` by `exportSpineBundle`, so rigs work here). `animations` and
		 * `sizeRatios` are sparse — each unset field falls through to the coded constant in
		 * `BoardFrame.svelte`. Absent → `BoardFrame` keeps the coded `reelhouse` glow. */
		boardGlow?: {
			assetKey: string;
			animations?: { start?: string; idle?: string; exit?: string };
			sizeRatios?: { width: number; height: number };
		};
		/** STACKED-PICTURE config (Invisible Symbols State Machine output, docs/design/stacked-picture-mode.md):
		 * which symbols stack, how many CELLS tall each picture is (`height`, the crop denominator), and
		 * the tall picture `art` (its assetKey rides `symbols.index` like a per-symbol binding, so it's
		 * already loadable). A stacked symbol ALWAYS shows its picture — even a lone one shows the top
		 * 1/height — and never its single icon. Absent → the coded `STACKED_PICTURE` fallback (dev parity). */
		stacked?: {
			symbols: Array<{
				name: string;
				height: number;
				art: {
					type: 'sprite' | 'spine' | 'flipbook';
					assetKey: string;
					animationName?: string;
					clipId?: string;
				};
				/** The winning variant of the tall picture — drawn while the stack is part of a paying
				 *  line (typically the spine/flipbook that animates the payout, where `art` is the still
				 *  the stack rests on). Absent → the stack keeps showing `art` through the win. */
				winArt?: {
					type: 'sprite' | 'spine' | 'flipbook';
					assetKey: string;
					animationName?: string;
					clipId?: string;
				};
			}>;
			/** When true, a tall picture shows ONLY on a full-height stack; a landed run shorter than the
			 *  symbol's `height` renders the normal single icons instead. Absent → partial runs show the
			 *  top N/height crop (the default behaviour). */
			fullHeightOnly?: boolean;
			/** When true, a partial stacked run pinned to the board's TOP or BOTTOM edge renders as a
			 *  CUT-OFF tall picture (the visible slice of a symbol scrolled partly off-screen) — top edge
			 *  shows the bottom N/height, bottom edge the top N/height — REGARDLESS of `fullHeightOnly`.
			 *  Any run length qualifies (even 1). Absent → no edge cut-off; edge partials follow
			 *  `fullHeightOnly` like any other partial. Independent of `fullHeightOnly`. */
			edgeCutoffs?: boolean;
			/** How long (ms) a stacked cell HOLDS its win beat. A covered cell mounts no `<Symbol>`, so
			 *  the game can't await a per-icon win animation there and waits a fixed beat instead; this
			 *  is what matches that beat to an authored `winArt` animation. Absent → the coded
			 *  `STACKED_WIN_HOLD_MS`. */
			winHoldMs?: number;
		};
		/** Free-spin BOOK VFX (Invisible Symbols State Machine output): a two-layer effect drawn on
		 * the book/special symbol during free spins — `background` behind the symbol art,
		 * `foreground` in front. `components/BookVfx.svelte` renders it per matching cell; any
		 * sprite/spine/flipbook asset either layer introduces rides `symbols.index` (registered by
		 * {@link bakedBookVfxAssets}), an `fx` layer rides {@link bakedEffects}. Absent ⇒ nothing
		 * renders (parity). See {@link BookVfxLayer}. */
		bookVfx?: {
			background?: BookVfxLayer;
			foreground?: BookVfxLayer;
		};
		/** The explosion → intro TRANSITION (Invisible Symbols State Machine output): one layer the
		 * cascade overlay mounts at every exploding seat under the `emerge` swap style, `delayMs` after
		 * the pop fires, so the explosion's end and the intro's start overlap. `components/TumbleBoard.svelte`
		 * schedules and tears it down; a spine/flipbook asset rides `symbols.index` (registered by
		 * {@link bakedSymbolTransitionAssets}), an `fx` rides {@link bakedEffects}. Absent ⇒ the hard cut,
		 * byte-identical to before (parity). See {@link SymbolTransition}. */
		transition?: SymbolTransition;
		/** The cascade EXPLOSION PATTERN (Invisible Symbols State Machine output) — the order the
		 * winning seats pop in and the millisecond gap between two waves of them.
		 * `components/TumbleBoard.svelte` reads it once per explode step and staggers the seats;
		 * `engine-layout/tumblePattern` owns the pattern list + the ordering both halves share.
		 * Assetless. Absent ⇒ every seat pops in the same frame, byte-identical to before (parity). */
		tumblePattern?: TumblePatternConfig;
		/** Reel-anticipation presentation FX (Invisible Symbols State Machine output) — the editable
		 * twin of the coded FX ramp (`codedTierFx`, `game/anticipationPresentation.ts`). `spineKey`
		 * optionally swaps the per-reel overlay spine (a full R2 bundle prefix registered via
		 * `index.spines` like `boardGlow`; the engine still owns the intro→loop→out chaining); `tiers`
		 * overrides the per-tier escalation FX, keyed by the config big-win tier ALIAS (one entry per
		 * configured big tier). SPARSE — every field falls through to the coded ramp in
		 * `resolveTierFx`/`resolveAnticipationSpineKey`, so an absent config is byte-identical.
		 * `overlayTint` is a `#rrggbb` hex; the reader converts it to `0xRRGGBB`. */
		anticipation?: {
			spineKey?: string;
			/** The overlay animation SET — the base name the engine appends `_intro`/`_loop`/`_out` to
			 *  (`resolveAnticipationAnimationBase`). Lets the author pick among a spine's
			 *  differently-sized anticipations (e.g. `anticipation3` → `anticipation3_intro/_loop/_out`).
			 *  Absent ⇒ the coded `anticipation` set (the unnumbered `anticipation_intro/_loop/_out`),
			 *  so an un-authored project is byte-identical. */
			animationSet?: string;
			/** The per-reel overlay box size, in CELLS (1 = one symbol). The engine scales the chosen
			 *  animation to fit this box, so a taller box renders a full-column anticipation at size
			 *  instead of squeezed into the coded beam. Absent ⇒ the coded `0.56 × 1.6` beam. */
			overlayWidthCells?: number;
			overlayHeightCells?: number;
			/** Authored activation-STING / LOOP sound names (Invisible Symbols State Machine). Global,
			 *  not per-tier — one sting + one loop for the whole mode. Absent ⇒ the coded
			 *  `sfx_anticipation_start` / `sfx_anticipation` (`resolveActivationSound`/`resolveLoopSound`),
			 *  so an un-authored project is byte-identical. */
			activationSound?: SoundEffectName;
			loopSound?: SoundEffectName;
			/** Per-tier FX overrides keyed by the config big-win tier's ALIAS (dynamic — one entry per
			 *  configured big tier, `activeBigTiers`), no longer a fixed big/mega/massive triple. */
			tiers?: Record<string, AnticipationTierFxOverride>;
		};
		/** Global win-line overlay config (Invisible Symbols State Machine output): on/off
		 * plus line + win-amount-text style. Pure config, no asset (the chosen `text.font`
		 * travels via the font pipeline). Sparse — every field falls through to the coded
		 * defaults resolved in `bakedWinLineConfig()`. The shared-engine renderer is
		 * `components/WinLine.svelte` (driven by the `winInfo` handler), so every game on
		 * the `runtime:lines` bundle draws it. */
		/** Resting-board replay of the winning SYMBOLS (Invisible Symbols State Machine output,
		 * `winSymbolCycle.ts`): keep them animating until the next spin. Deliberately NOT part of
		 * `winLine` — the line is a separate switch and the replay only draws it when
		 * `showLine` is on. Sparse; both `enabled` and `showLine` absent ⇒ on. */
		winCycle?: {
			enabled?: boolean;
			delay?: number;
			showLine?: boolean;
			showText?: boolean;
			showMessage?: boolean;
			/** Darken every NON-winning symbol from the win celebration until the next spin, so the
			 * paying line stands out (`winSymbolCycle.ts` → `stateGame.winDim` → `ReelSymbol`). Absent
			 * ⇒ off (byte-parity — the board stayed full-bright before this switch). Independent of
			 * `enabled`: the dim is a property of the board, not the replay, so it applies even with
			 * the replay cycle off. */
			dimNonWinning?: boolean;
			/** After a BIG win inside a free-spin feature, park the round on its winning board and
			 * wait for the player to press SPIN before the next free spin rolls (`freeSpinHold.ts`).
			 * Absent ⇒ off (byte-parity — the feature ran unbroken before this switch). Pairs with the
			 * replay above (which narrates the paying lines during the hold) but is independent of it:
			 * with the replay off the hold still holds, on a static board. */
			holdAfterBigWin?: boolean;
		};
		winLine?: {
			enabled?: boolean;
			line?: {
				color?: string;
				width?: number;
				glow?: boolean;
				glowColor?: string;
				animated?: boolean;
				speed?: number;
				fullPayline?: boolean;
				fullPaylineColor?: string;
				useConfigColor?: boolean;
				allAtOnce?: boolean;
				allAtOnceDelay?: number;
			};
			text?: {
				enabled?: boolean;
				font?: string;
				size?: number;
				color?: string;
				placement?: 'line' | 'boardCenter';
			};
		};
	};
	/** The authored win-text TEMPLATES (Invisible Win Text output), fetched from
	 * `/api/win-text/doc` at bake and embedded verbatim. Pure config, no assets — so like
	 * `symbols.winLine` there is no export/pull step. SPARSE: every field falls through to
	 * `WIN_TEXT_DEFAULTS` (which reproduce the engine's prior literals), so an absent doc
	 * renders byte-identically. The templates are localization KEYS — their translations ride
	 * `localization.messages`, and `formatWinText` resolves template → translation →
	 * interpolation at render. See `docs/design/invisible-win-text.md`. */
	winText?: WinTextDoc;
	/** The project's authored GAME CONFIG (Invisible Game Config output) — symbol dictionary +
	 * paytable, paylines, grid, bet modes, identity/RTP, and the cosmetic reel strips. Pure config,
	 * no assets, so like `winText` there is no export/pull step; it travels verbatim.
	 *
	 * DENSE, unlike every other doc here: it REPLACES the compiled `game/config.ts` rather than
	 * layering over it, because a half-merged config is a config with a missing symbol dictionary.
	 * Absent ⇒ `getActiveGameConfig()` resolves the compiled template and the game is byte-identical
	 * (parity). See `docs/design/invisible-game-config.md`. */
	config?: GameConfigDoc;
	/** The authored presentation graph (Invisible Flow output), exported to
	 * `deploy/flow.json` and embedded by `bake-editor-doc.mjs`. When present the
	 * runtime interpreter (engine-flow) mounts authored screens + runs authored
	 * choreography in place of the coded mounting + `bookEventHandlerMap`; the per-event
	 * fall-through still defers any un-authored screen/event to the coded path. ABSENT
	 * ⇒ the interpreter is inert ⇒ the coded path runs, byte-identical to current `main`
	 * (the §7 fall-through invariant). The FlowDoc carries NO binary assets (it
	 * references scenes the Scene Editor already exported), so there is no `pull` step. */
	flow?: FlowDoc;
	/** The authored Invisible Flow **v2** graph (`/flow-v2` output), exported to
	 * `deploy/flow-v2.json` and embedded by the bake. When present the game builds the v2
	 * interpreter from it (`flowV2Runtime`); ABSENT ⇒ v2 stays inert and the v1/coded path
	 * owns the game (parity). Like v1's `flow`, it carries no binary assets. */
	flowV2?: FlowDocV2;
	/** The shared v2 function library the `flowV2` graph's `functionCall` nodes resolve
	 * against (`_shared/flow-v2/functions.json`), embedded alongside `flowV2` at bake. */
	flowV2Library?: FlowV2LibraryDoc;
	/** The project's Invisible Cinematic documents. Absent ⇒ `bakedCinematics()` is `[]` and the
	 *  `<Cinematic>` component finds nothing to play (parity). */
	cinematics?: CinematicDoc[];
};
const bakedBundle = bakedBundleJson as unknown as BakedBundle;

/**
 * Live-runtime bundle (Invisible Game Maker, Phase 0). OPT-IN via `?runtime=1`: a
 * prebuilt generic engine bundle boots an arbitrary project by fetching ONE payload
 * from the launcher (`GET /api/editor/runtime`) — the same logical shape as
 * {@link BakedBundle} PLUS an `assetBase` (the absolute `/api/deploy?…&rel=` prefix
 * the runtime prepends to every deploy-relative asset path). When the param is
 * absent this stays `null` and EVERY function below is byte-identical to today
 * (baked-doc games and `apps/lines` live `/api/editor/doc` dev are untouched).
 */
type RuntimeBundle = BakedBundle & { assetBase: string; name?: string };
let runtimeBundle: RuntimeBundle | null = null;

/** True only when `?runtime=1` is in the game URL — the single opt-in gate. Absent
 * (or server-side) ⇒ false ⇒ the runtime path is entirely inert (strict parity). */
function runtimeModeEnabled(): boolean {
	if (typeof window === 'undefined') return false;
	return new URLSearchParams(window.location.search).get('runtime') === '1';
}

/** True once a runtime bundle has been fetched + accepted. Drives every asset/doc
 * function below to read from the live bundle instead of the baked json. Never true
 * unless `?runtime=1` AND the fetch succeeded — so off-mode is unaffected. */
function hasRuntimeBundle(): boolean {
	return runtimeBundle !== null;
}

/** ADAPTIVE texture-quality tier — one build serves every device. When a KTX2 variant was
 * baked, load it (4× less VRAM, full resolution) on memory-constrained devices, and the
 * uncompressed full-res original on high-memory ones (arcade / kiosk / desktop, best quality).
 *
 * Auto-detect: ALL mobile — iOS + Android — plus any low-`deviceMemory` (≤4 GB) device get
 * compression. It's a near-lossless VRAM win with no downside on phones, and compression is NOT
 * a resolution cut: every page ≤4096 stays full-res; only a page over the encoder's ~12 Mpix cap
 * (a rare oversized cinematic) is downscaled, and that's unavoidable, not a tier choice. Desktop
 * gets uncompressed full-res. `?quality=high` (arcade cabinets wanting pristine uncompressed) /
 * `?quality=low` force it. Read raw (like `runtime`/`project`/`k`) so it resolves at import time
 * before SvelteKit context; SSR defaults to compressed (safe). */
function preferCompressedTextures(): boolean {
	if (typeof window === 'undefined' || typeof navigator === 'undefined') return true;
	const q = new URLSearchParams(window.location.search).get('quality');
	if (q === 'high') return false;
	if (q === 'low') return true;
	const ua = navigator.userAgent || '';
	const isIOS =
		/iPad|iPhone|iPod/.test(ua) ||
		// iPadOS 13+ reports as desktop Safari; disambiguate by touch support.
		(navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1);
	const isAndroid = /Android/i.test(ua);
	const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
	const lowMem = typeof mem === 'number' && mem <= 4;
	return isIOS || isAndroid || lowMem;
}

/** Public form of {@link hasRuntimeBundle} for the boot path — true only after a
 * successful runtime fetch, so the game knows to re-merge the live asset entries
 * into `stateApp.assets` (which `createApp` built at import, before the fetch). */
export function isRuntimeBundleActive(): boolean {
	return hasRuntimeBundle();
}

/** Asset URL prefix: the launcher's absolute `/api/deploy/f/<token>/<client>/<project>/` base in
 * runtime mode (so cross-origin deploy files resolve), else the page-relative `assets/` (the deploy
 * mirror) used by the baked path. Keeps every registration KEY identical across the two modes —
 * only the resolved `src` URL differs. The runtime form is a PATH, not `?…&rel=`, and deliberately
 * so: a sub-file named inside a parent (a spine atlas page, a bitmap-font page) is loaded RELATIVE
 * to its parent's URL, and the query form would drop the token and project on that resolution. See
 * `/api/editor/runtime`. */
function srcBase(): string {
	return hasRuntimeBundle() ? runtimeBundle!.assetBase : 'assets/';
}

function hasBakedDoc(): boolean {
	const doc = bakedBundle.doc;
	return !!(doc && Array.isArray(doc.scenes) && doc.scenes.length > 0);
}

/**
 * Register the baked component defs + per-project param defaults (no-op when not
 * baked). Call at boot BEFORE the doc renders, AFTER the game's built-in
 * `registerComponents(...)`, so a baked/edited def (e.g. a customized `button`
 * with an extra background node) shadows the coded built-in.
 */
export function registerBakedComponents(): void {
	const source = hasRuntimeBundle() ? runtimeBundle! : hasBakedDoc() ? bakedBundle : null;
	if (!source) return;
	// Pinned non-latest versions FIRST (§8.9 v2): each is retained in the registry's
	// per-version map so a pinned instance resolves it, then `componentDefs` sets the
	// id's `latest` last so unpinned instances follow latest. Register one at a time so
	// two pins of the SAME id at DIFFERENT versions are both retained (a single map keyed
	// by id would collapse them). Empty/absent for unpinned games ⇒ no-op ⇒ byte-identical
	// to before history existed (parity).
	for (const def of source.componentVersions ?? []) {
		registerComponents({ [def.id]: def });
	}
	if (source.componentDefs) registerComponents(source.componentDefs);
	if (source.componentDefaults) registerComponentDefaults(source.componentDefaults);
}

/**
 * Asset entries for the spritesheets the baked doc's art references (exported to
 * `deploy/editor-art/` at bake time, mirrored into `static/assets/` by the
 * deploy pull). Spread into the game's `assets` record at `createApp` so every
 * editor-placed sprite/image resolves WITHOUT a manual `assets.ts` entry — the
 * sheet frames are keyed by the editor's region names, exactly what
 * `LayoutNodeView` looks up. Empty when un-baked (dev keeps its own assets).
 * The src is page-relative (`assets/…`), matching how the static dir is served.
 */
type EditorArtAssetEntry =
	| { type: 'sprites' | 'sprite'; src: string; preload: boolean; namespace?: string }
	| { type: 'spine'; src: { atlas: string; skeleton: string; scale: number }; preload: boolean };

/**
 * Dangling-binding guard (browser side). The exporters flag every placed region /
 * bound symbol frame that no shipped atlas packs (`editorArt.missing` /
 * `symbols.index.missing`) — those render blank in-game with a "… is not found in
 * the loadedAssets" console spam. Surface the ROOT cause once, loudly, so the author
 * knows to re-pack the atlas (or re-pick the frame) rather than chase the symptom.
 * Warns a single time per boot across both asset registrations.
 */
let warnedMissingAssets = false;
function warnMissingAssets(source: BakedBundle): void {
	if (warnedMissingAssets) return;
	const art = source.editorArt?.missing ?? [];
	const sym = source.symbols?.index?.missing ?? [];
	if (art.length === 0 && sym.length === 0) return;
	warnedMissingAssets = true;
	if (art.length) {
		console.warn(
			`[invisible] ${art.length} placed region(s) are in NO shipped atlas and will render blank: ` +
				`${art.join(', ')}. Re-pack the atlas so it contains them, or re-pick the frame in the editor.`,
		);
	}
	if (sym.length) {
		console.warn(
			`[invisible] ${sym.length} bound symbol frame(s) are in NO shipped atlas and will render blank: ` +
				`${sym.join(', ')}. Re-pack the atlas so it contains them, or re-bind the symbol.`,
		);
	}
}

export function bakedEditorArtAssets(): Record<string, EditorArtAssetEntry> {
	const out: Record<string, EditorArtAssetEntry> = {};
	// In runtime mode the live bundle supplies the same `editorArt` index; the only
	// difference is the `src` URL prefix (`srcBase()`). Registration keys + namespaces
	// stay identical so `LayoutNodeView` lookups resolve in both modes.
	const source = hasRuntimeBundle() ? runtimeBundle! : hasBakedDoc() ? bakedBundle : null;
	if (!source) return out;
	warnMissingAssets(source);
	const base = srcBase();
	// Prefer the GPU-compressed KTX2 page variant (4–8× less VRAM, transcoded per-device
	// by the KTX2 loader registered in InitialiseApplication) unless `?quality=high` asks
	// for the uncompressed full-res art. Absent variant ⇒ the WebP/PNG path (parity). The
	// registration KEY stays keyed off the WebP json/file so `LayoutNodeView` lookups are
	// identical across tiers — only the resolved `src` URL differs.
	const useKtx2 = preferCompressedTextures();
	for (const sheet of source.editorArt?.sheets ?? []) {
		// Scope each sheet's frames by its manifest key (the value sprite nodes store
		// as `assetKey`) so two sheets that reuse a region name don't collide in the
		// flat loadedAssets map. `LayoutNodeView` resolves the matching scoped key.
		const sheetPath = useKtx2 && sheet.ktx2Json ? sheet.ktx2Json : sheet.json;
		out[`editorArt/${sheet.json}`] = {
			type: 'sprites',
			src: `${base}${sheetPath}`,
			preload: true,
			namespace: editorArtNamespace(sheet.key),
		};
	}
	// Standalone images register under the sprite node's full assetKey — that IS
	// the engine's lookup key for a region-less sprite node.
	for (const image of source.editorArt?.images ?? []) {
		const imagePath = useKtx2 && image.ktx2 ? image.ktx2 : image.file;
		out[image.key] = { type: 'sprite', src: `${base}${imagePath}`, preload: true };
	}
	// Spine bundles register under the spine node's full assetKey — the value
	// `LayoutNodeView` passes to `<SpineProvider key=…>`.
	for (const spine of source.editorArt?.spines ?? []) {
		// On the compressed tier load the KTX2 atlas variant (its page-name lines point at the
		// `.ktx2` twins; spine's atlas loader loads each page by extension → our KTX2 loader
		// transcodes it). Same region coords, so the skeleton is unchanged. Absent ⇒ original.
		const atlasPath = useKtx2 && spine.ktx2Atlas ? spine.ktx2Atlas : spine.atlas;
		out[spine.key] = {
			type: 'spine',
			src: {
				atlas: `${base}${atlasPath}`,
				skeleton: `${base}${spine.skeleton}`,
				scale: spine.scale ?? 2,
			},
			preload: true,
		};
	}
	return out;
}

/**
 * The Invisible FX effects authored for this project (`invisible-fx.md` §4.4). Each `EffectDoc`
 * is played by `<EffectPlayer doc=…>`; its layers reduce to `<ParticleEmitter>` (art bound from
 * `art.assetKey` via the shared `engine-fx` `bindArt`), wrapped in `<SpineBoneAttach>` for a
 * `bone`-placed layer against the HOST game's playing rig. Mirrors `bakedEditorArtAssets`'s
 * runtime→baked→empty resolution. The full ship chain is wired (export→`deploy/effects/`→bake→
 * pull→embed), so a freshly-baked project returns its authored effects here; empty only when
 * un-baked / a project has no effects (dev parity — the checked-in placeholder has none). A
 * consuming game iterates these and mounts an `<EffectPlayer>` per effect (inside the relevant
 * `<SpineProvider>` when a layer is bone-placed — see `components/Effects.svelte`).
 */
export function bakedEffects(): EffectDoc[] {
	const source = hasRuntimeBundle() ? runtimeBundle! : hasBakedDoc() ? bakedBundle : null;
	if (!source) return [];
	return source.effects ?? [];
}

/**
 * The rig-timeline direct FX bindings baked for this project (`invisible-fx.md` "rig-timeline direct
 * FX binding"): a rig's OWN animation events → effects, keyed by the rig's runtime assetKey (its
 * bundle folder — the value a mount passes to `<SpineProvider key=…>`). Registered at boot via
 * `registerRigFx(bakedRigFx())`, which also installs the lookup `<SpineProvider>` reads to mount a
 * `<RiggedEffect>` per binding. Mirrors `bakedEffects`'s runtime→baked→empty resolution. Empty when
 * un-baked / no rig has a bound event (dev parity — the checked-in placeholder has none).
 */
export function bakedRigFx(): Record<string, RigFxBinding[]> {
	const source = hasRuntimeBundle() ? runtimeBundle! : hasBakedDoc() ? bakedBundle : null;
	if (!source) return {};
	return source.rigFx ?? {};
}

/**
 * The Invisible Flipbook clips baked for this project (`invisible-flipbook.md` §"Travel"): each an
 * ORDERED, timed run of region names within one sheet — the sheet the editor-art export already
 * ships, so a clip introduces no new asset. Registered at boot via
 * `registerFlipbooks(bakedFlipbooks())`; a consumer resolves `clipId` → clip through
 * `resolveFlipbook`. Mirrors `bakedEffects`'s runtime→baked→empty resolution. Empty when un-baked
 * / a project authored no clips (dev parity — the checked-in placeholder has none).
 */
export function bakedFlipbooks(): FlipbookClipEntry[] {
	const source = hasRuntimeBundle() ? runtimeBundle! : hasBakedDoc() ? bakedBundle : null;
	if (!source) return [];
	return source.flipbooks ?? [];
}

/**
 * The rig-timeline direct FLIPBOOK bindings baked for this project — the frame-animation twin of
 * {@link bakedRigFx}: a rig's OWN animation events → clips, keyed by the rig's runtime assetKey.
 * Registered at boot via `registerRigFlipbooks(bakedRigFlipbooks())`; `<SpineProvider>` resolves
 * `resolveRigFlipbooks(assetKey)` to mount a `<RiggedFlipbook>` per binding, for every rig wherever
 * it is mounted. Empty when un-baked / no rig has a bound clip (dev parity).
 */
export function bakedRigFlipbooks(): Record<string, RigFlipbookBinding[]> {
	const source = hasRuntimeBundle() ? runtimeBundle! : hasBakedDoc() ? bakedBundle : null;
	if (!source) return {};
	return source.rigFlipbooks ?? {};
}

/**
 * The effect ids PLACED as `effect` nodes in the baked layout (walking scenes + container children).
 * `components/Effects.svelte` skips these when auto-mounting free effects — a placed EffectNode
 * already mounts the effect at its position via `LayoutNodeView`, so an effect is never
 * double-mounted. Empty when un-baked / no placed effects (parity).
 */
export function placedEffectIds(): Set<string> {
	const source = hasRuntimeBundle() ? runtimeBundle! : hasBakedDoc() ? bakedBundle : null;
	const ids = new Set<string>();
	const scenes = source?.doc?.scenes;
	if (!Array.isArray(scenes)) return ids;
	const walk = (nodes: LayoutNode[]): void => {
		for (const n of nodes) {
			if (n.kind === 'effect' && typeof n.effectId === 'string' && n.effectId) ids.add(n.effectId);
			else if (n.kind === 'container' && Array.isArray(n.children)) walk(n.children);
		}
	};
	for (const scene of scenes) if (Array.isArray(scene.nodes)) walk(scene.nodes);
	return ids;
}

/**
 * The authored params of the `win` componentInstance in the baked/runtime layout, if one is placed —
 * the source of the per-tier PRESENTATION overrides (`docs/tools/component-editor.md`). Published to
 * `game/gameConfig.ts` at boot ({@link publishWinPresentation}) so the per-tier DURATION + SOUND reach
 * the out-of-tree consumers (`WinGate` duration, `winLevelSoundsPlay`). `undefined` when un-baked (dev)
 * or no `win` instance is placed (the coded `Win` bind path) ⇒ the overlay is empty and every field
 * falls back to the config/coded tier, byte-identical. Walks scenes + container children, returning the
 * FIRST `win` instance's `params` (a game places exactly one win overlay).
 */
export function bakedWinPresentationParams(): Record<string, unknown> | undefined {
	const source = hasRuntimeBundle() ? runtimeBundle! : hasBakedDoc() ? bakedBundle : null;
	const scenes = source?.doc?.scenes;
	if (!Array.isArray(scenes)) return undefined;
	let found: Record<string, unknown> | undefined;
	const walk = (nodes: LayoutNode[]): void => {
		for (const n of nodes) {
			if (found) return;
			if (n.kind === 'componentInstance' && n.componentId === 'win') {
				found = n.params ?? {};
				return;
			}
			if (n.kind === 'container' && Array.isArray(n.children)) walk(n.children);
		}
	};
	for (const scene of scenes) {
		if (found) break;
		if (Array.isArray(scene.nodes)) walk(scene.nodes);
	}
	return found;
}

/**
 * The effect ids referenced by a rig-timeline FX binding ({@link bakedRigFx}). `components/Effects.svelte`
 * skips these when auto-mounting free effects: a rig-bound effect is already mounted by `<RiggedEffect>`
 * on its HOST rig (by `<SpineProvider>`, so wherever that rig is mounted), firing on that rig's own
 * event at the bone. Without this exclusion such an effect ALSO auto-mounts as a
 * scene-level ambient `<EffectPlayer>` at the stage origin (0,0) — a phantom burst in the top-left corner.
 * Mirrors {@link placedEffectIds}. Empty when un-baked / no rig has a bound event (parity).
 */
export function rigFxEffectIds(): Set<string> {
	const ids = new Set<string>();
	for (const binds of Object.values(bakedRigFx())) {
		for (const b of binds) if (b.effectId) ids.add(b.effectId);
	}
	return ids;
}

/**
 * The baked symbol→state binding overrides (Invisible Symbols State Machine). Merged over
 * the coded `SYMBOL_INFO_MAP` in `game/symbolMap.ts`. Undefined when un-baked → the game
 * keeps the coded map byte-for-byte (dev parity).
 */
export function bakedSymbolMap(): SymbolInfoMap | undefined {
	if (hasRuntimeBundle()) return runtimeBundle!.symbols?.map;
	if (!hasBakedDoc()) return undefined;
	return bakedBundle.symbols?.map;
}

/**
 * The project's authored GAME CONFIG (Invisible Game Config). Resolved by `game/gameConfig.ts` as
 * `runtime → baked → compiled template`; undefined here means the last of those, so the game runs
 * `game/config.ts` byte-for-byte exactly as it did before this doc existed (dev parity).
 *
 * Deliberately NOT normalized here — `getActiveGameConfig()` owns that, so the canonicalizer runs
 * in exactly one place on exactly one path and a runtime doc cannot be treated differently from a
 * baked one.
 */
export function bakedGameConfig(): GameConfigDoc | undefined {
	if (hasRuntimeBundle()) return runtimeBundle!.config;
	if (!hasBakedDoc()) return undefined;
	return bakedBundle.config;
}

/**
 * The authored symbol DISPLAY NAMES (Invisible Symbols State Machine). `H1` → "Banana"/"Bananas",
 * the word every win sentence prints for that symbol (`{symbolName}` in Invisible Win Text).
 *
 * Returns `{}` — not undefined — when un-baked or unauthored, because `resolveSymbolName` falls
 * back to the symbol ID per-symbol anyway: there is no "the game has no names" branch to take, only
 * "this symbol isn't named yet". Mirrors `bakedSymbolMap`'s runtime→baked resolution.
 */
export function bakedSymbolNames(): SymbolNameMap {
	if (hasRuntimeBundle()) return runtimeBundle!.symbols?.names ?? {};
	if (!hasBakedDoc()) return {};
	return bakedBundle.symbols?.names ?? {};
}

/**
 * PER-SYMBOL SOUND OVERRIDES authored in the Invisible Symbols State Machine — the cue one symbol
 * plays entering one state, which wins over the config's game-wide slot for that moment.
 *
 * Mirrors `bakedSymbolNames`' runtime→baked→empty resolution, and returns `{}` rather than
 * `undefined` for the same reason: every caller wants to do one lookup and get nothing back, not to
 * null-check first. An empty map means every symbol falls through to the slots, which is the state
 * an un-authored project ships in.
 */
export function bakedSymbolSounds(): Record<string, Record<string, string>> {
	// The sound doc is the WHOLE answer when it has one — never merged with the symbols doc's own
	// map. A per-symbol merge would resurrect a cue the author deliberately cleared in the tool from
	// the old doc that still carries it, which is the one outcome a migration must not produce.
	const authored = bakedSoundBindings()?.symbols;
	if (authored) return authored;
	if (hasRuntimeBundle()) return runtimeBundle!.symbols?.symbolSounds ?? {};
	if (!hasBakedDoc()) return {};
	return bakedBundle.symbols?.symbolSounds ?? {};
}

/**
 * WHAT PLAYS WHEN, as resolved by the sound export — the choices authored in Invisible Sound, with
 * a pre-move project's config/symbols choices already migrated in (the export is the only place
 * that can see all three docs, so it settles the fallback and the bundle carries one answer).
 *
 * `undefined` for un-baked dev and for a bundle built before the move, which is exactly when every
 * reader should keep doing what it did before.
 */
export function bakedSoundBindings(): SoundBindings | undefined {
	return bakedSoundCatalog()?.bindings;
}

/**
 * The GLOBAL win-highlight frame authored in the Invisible Symbols State Machine. When set,
 * `SymbolWinFrame.svelte` draws this spine/animation for the win frame instead of the coded
 * `anticipation`/`payframe`. Its spine bundle rides `symbols.index.spines` (registered like a
 * per-symbol spine cell), so the `assetKey` is already loadable. Mirrors `bakedSymbolMap`'s
 * runtime→baked→undefined resolution; undefined → the coded default frame.
 */
export function bakedHighlight(): BakedBundle['symbols']['highlight'] {
	if (hasRuntimeBundle()) return runtimeBundle!.symbols?.highlight;
	if (!hasBakedDoc()) return undefined;
	return bakedBundle.symbols?.highlight;
}

/**
 * The free-spin BOARD GLOW authored in the Invisible Symbols State Machine — the reel-house spine
 * behind the reels. When set, `BoardFrame.svelte` plays this spine (and any renamed
 * start/idle/exit animations + fit ratio) instead of the coded `reelhouse` glow. Its bundle rides
 * `symbols.index.spines` (registered like a per-symbol spine cell), so the `assetKey` is already
 * loadable. Mirrors `bakedHighlight`'s runtime→baked→undefined resolution; undefined → the coded
 * glow, byte-identical to an un-authored game.
 */
export function bakedBoardGlow(): BakedBundle['symbols']['boardGlow'] {
	if (hasRuntimeBundle()) return runtimeBundle!.symbols?.boardGlow;
	if (!hasBakedDoc()) return undefined;
	return bakedBundle.symbols?.boardGlow;
}

/**
 * The STACKED-PICTURE config authored in the Invisible Symbols State Machine (which symbols stack +
 * per-symbol height + tall art). When set, the stacked-picture reel mode uses THIS (symbol set,
 * heights, and picture art) instead of the coded `STACKED_PICTURE` + per-symbol `stacked` fallback.
 * Each `art.assetKey` rides `symbols.index` (registered like any per-symbol binding), so it is already
 * loadable. Mirrors `bakedHighlight`'s runtime→baked→undefined resolution; undefined ⇒ the coded
 * fallback (dev parity for an un-authored game). */
export function bakedStackedConfig(): BakedBundle['symbols']['stacked'] {
	if (hasRuntimeBundle()) return runtimeBundle!.symbols?.stacked;
	if (!hasBakedDoc()) return undefined;
	return bakedBundle.symbols?.stacked;
}

/**
 * The free-spin BOOK VFX authored in the Invisible Symbols State Machine — the `background`/
 * `foreground` layers drawn on the book/special symbol during free spins. When set,
 * `components/BookVfx.svelte` mounts them per matching board cell; the asset side is registered by
 * {@link bakedBookVfxAssets}. Mirrors `bakedBoardGlow`'s runtime→baked→undefined resolution;
 * undefined ⇒ `BookVfx.svelte` renders nothing, byte-identical to an un-authored game (parity).
 */
export function bakedBookVfx(): NonNullable<BakedBundle['symbols']>['bookVfx'] | undefined {
	if (hasRuntimeBundle()) return runtimeBundle!.symbols?.bookVfx;
	if (!hasBakedDoc()) return undefined;
	return bakedBundle.symbols?.bookVfx;
}

/**
 * The explosion → intro transition authored in the Invisible Symbols State Machine. When set,
 * `components/TumbleBoard.svelte` mounts it at every exploding seat under the `emerge` swap style;
 * the asset side is registered by {@link bakedSymbolTransitionAssets}. Mirrors `bakedBookVfx`'s
 * runtime→baked→undefined resolution; undefined ⇒ the seam stays the hard cut it always was (parity).
 */
export function bakedSymbolTransition(): SymbolTransition | undefined {
	if (hasRuntimeBundle()) return runtimeBundle!.symbols?.transition;
	if (!hasBakedDoc()) return undefined;
	return bakedBundle.symbols?.transition;
}

/**
 * The cascade explosion PATTERN authored in the Invisible Symbols State Machine — the order the
 * winning seats pop in and the gap between two waves. `components/TumbleBoard.svelte` hands it to
 * `tumbleExplosionDelays` on every explode step. Mirrors `bakedBookVfx`'s runtime→baked→undefined
 * resolution; undefined ⇒ `tumbleExplosionDelays` answers all-zero and the whole board pops in one
 * frame, exactly as it always did (parity).
 */
export function bakedTumblePattern(): TumblePatternConfig | undefined {
	if (hasRuntimeBundle()) return runtimeBundle!.symbols?.tumblePattern;
	if (!hasBakedDoc()) return undefined;
	return bakedBundle.symbols?.tumblePattern;
}

/**
 * The reel-anticipation presentation FX authored in the Invisible Symbols State Machine — the
 * per-tier escalation overrides (keyed by config big-tier alias) + optional overlay spine key. When
 * set, `resolveTierFx` / `resolveAnticipationSpineKey` (`game/anticipationPresentation.ts`) merge it
 * over the coded `codedTierFx` ramp; the overlay spine bundle (if swapped) rides `symbols.index.spines`
 * like a per-symbol spine cell. Mirrors `bakedBookVfx`'s runtime→baked→undefined resolution; undefined
 * ⇒ the coded ramp, byte-identical to an un-authored game.
 */
export function bakedAnticipation():
	| NonNullable<BakedBundle['symbols']>['anticipation']
	| undefined {
	if (hasRuntimeBundle()) return runtimeBundle!.symbols?.anticipation;
	if (!hasBakedDoc()) return undefined;
	return bakedBundle.symbols?.anticipation;
}

/**
 * The anticipation tease's two CUES, from the sound doc. Separate from {@link bakedAnticipation}
 * because only the sounds moved: the tease's spine, scale, tint and per-tier ramp are still authored
 * in Invisible Symbols, and splitting the read here is what lets one field move without dragging the
 * other twenty with it. `undefined` on either field ⇒ the symbols doc, then the coded default.
 */
export function bakedAnticipationSounds(): { activation?: string; loop?: string } | undefined {
	return bakedSoundBindings()?.anticipation;
}

/**
 * Whether the win-line overlay is presented AT ALL — either half of it. The Invisible Symbols State
 * Machine authors the line and the stamped amount as two independent switches, so this is their OR:
 * with both off nothing is broadcast, with either on the overlay runs and `WinLine.svelte` decides
 * which half it draws. Defaults to `true` (un-baked or unauthored keeps showing both).
 */
export function bakedWinLineEnabled(): boolean {
	return bakedWinLineConfig().enabled;
}

/** The win-line overlay style, fully RESOLVED — every field the baked doc omits is filled
 * with the coded default (which mirror the literals `WinLine.svelte` uses), so an
 * un-baked/unauthored project renders byte-identical. `width`/`size` are multiples of
 * `SYMBOL_SIZE`; colours are CSS hex strings; `speed` scales the animated draw duration.
 * The Invisible Symbols State Machine authors the overrides. */
export type ResolvedWinLine = {
	/** Whether the overlay is presented at all — `line.enabled || text.enabled`. */
	enabled: boolean;
	line: {
		/** Whether the traced line is drawn. Independent of `text.enabled`, so a project can stamp
		 * the amount with no line under it (and vice versa). */
		enabled: boolean;
		color: string;
		width: number;
		glow: boolean;
		glowColor: string;
		animated: boolean;
		speed: number;
		/** Trace the whole payline (all reels) as an underlay, not just the winning segment. */
		fullPayline: boolean;
		/** Colour of that full-payline underlay. */
		fullPaylineColor: string;
		/** Draw the line in the config's winning-payline colour (when it has one), falling back to
		 * `color`. Default ON (config wins). OFF makes `color` authoritative and ignores config. */
		useConfigColor: boolean;
		/** Show EVERY paying line of the round at the same time — each appearing `allAtOnceDelay`
		 * after the previous one, in its own payline colour, all STAYING on screen together until the
		 * next spin — instead of narrating them one at a time. Default OFF (the one-at-a-time
		 * narration, byte-identical to before). */
		allAtOnce: boolean;
		/** The beat between two lines appearing in all-at-once mode, in SECONDS. */
		allAtOnceDelay: number;
	};
	text: {
		/** Whether the win amount is stamped. Defaults to the LINE's switch, so a doc authored
		 * before the two were split still reads as one toggle over both. */
		enabled: boolean;
		font: string;
		size: number;
		color: string;
		/** WHERE the amount is stamped: `'line'` at the winning line's end (the default), or
		 * `'boardCenter'` in the middle of the reel window — where only the most recently announced
		 * win stamps, so an all-at-once round doesn't pile every amount on one spot. */
		placement: 'line' | 'boardCenter';
	};
};

export function bakedWinLineConfig(): ResolvedWinLine {
	const w = hasRuntimeBundle()
		? runtimeBundle!.symbols?.winLine
		: hasBakedDoc()
			? bakedBundle.symbols?.winLine
			: undefined;
	const color = w?.line?.color ?? '#ffcc00';
	const lineEnabled = w?.enabled ?? true;
	const textEnabled = w?.text?.enabled ?? lineEnabled;
	return {
		enabled: lineEnabled || textEnabled,
		line: {
			enabled: lineEnabled,
			color,
			width: w?.line?.width ?? 0.03,
			glow: w?.line?.glow ?? false,
			glowColor: w?.line?.glowColor ?? color,
			animated: w?.line?.animated ?? false,
			speed: w?.line?.speed ?? 1,
			fullPayline: w?.line?.fullPayline ?? false,
			fullPaylineColor: w?.line?.fullPaylineColor ?? '#4a90d9',
			useConfigColor: w?.line?.useConfigColor ?? true,
			allAtOnce: w?.line?.allAtOnce ?? false,
			allAtOnceDelay: w?.line?.allAtOnceDelay ?? 0.12,
		},
		text: {
			enabled: textEnabled,
			font: w?.text?.font ?? 'gold',
			size: w?.text?.size ?? 0.5,
			color: w?.text?.color ?? '#ffffff',
			placement: w?.text?.placement ?? 'line',
		},
	};
}

/** The resting-board WIN-SYMBOL replay, fully RESOLVED (`winSymbolCycle.ts`): whether the round's
 * winning symbols keep animating until the next spin, the pause in SECONDS between two passes
 * (floored by the cycle's own minimum), and whether each pass ALSO redraws that win's line +
 * stamped amount. `showText` gates ONLY the stamped amount, independently of `showLine`. Defaults
 * to on / 0.4s / line drawn / text drawn. `showMessage` re-shows that win's info toast on each pass
 * and defaults to OFF — the toast never rode along with the replay before this switch, so an
 * un-authored project stays byte-identical. Sibling of {@link bakedWinLineConfig} by design — that
 * owns the line's existence and style, this owns the replay; `showLine`/`showText`/`showMessage`
 * only ask the replay to reuse the line + amount + toast, and the win-line toggle still has the
 * final say over the line. `holdAfterBigWin` (default OFF) is the replay's free-spin companion: it
 * parks the feature on that resting board after a big win until the player presses SPIN, instead of
 * rolling the next free spin on its own (`freeSpinHold.ts`). */
export function bakedWinCycleConfig(): {
	enabled: boolean;
	delay: number;
	showLine: boolean;
	showText: boolean;
	showMessage: boolean;
	dimNonWinning: boolean;
	holdAfterBigWin: boolean;
} {
	const c = hasRuntimeBundle()
		? runtimeBundle!.symbols?.winCycle
		: hasBakedDoc()
			? bakedBundle.symbols?.winCycle
			: undefined;
	return {
		enabled: c?.enabled ?? true,
		delay: c?.delay ?? 0.4,
		showLine: c?.showLine ?? true,
		showText: c?.showText ?? true,
		showMessage: c?.showMessage ?? false,
		dimNonWinning: c?.dimNonWinning ?? false,
		holdAfterBigWin: c?.holdAfterBigWin ?? false,
	};
}

/**
 * The win-text TEMPLATES authored in Invisible Win Text, fully RESOLVED — every field the
 * baked doc omits is filled with the coded default (`WIN_TEXT_DEFAULTS`, which reproduce the
 * literals the engine hardcoded before the tool existed), so an un-baked/unauthored project
 * renders byte-identically. Mirrors `bakedWinLineConfig`'s runtime→baked→undefined resolution.
 *
 * The returned strings are still TEMPLATES holding `{tokens}` and are still un-localized —
 * `formatWinText` resolves each through the catalog and interpolates, in that order. Sibling of
 * `bakedWinLineConfig` by design: that owns the win line's STYLE, this owns its TEXT.
 */
export function bakedWinText(): ResolvedWinText {
	if (hasRuntimeBundle()) return resolveWinText(runtimeBundle!.winText);
	return resolveWinText(bakedBundle.winText);
}

/**
 * The baked Invisible Flow document (the presentation graph). When present, the
 * game's `flowRuntime` builds the engine-flow interpreter from it so authored screens
 * mount + authored choreography runs in place of the coded path; the per-event
 * fall-through keeps every un-authored screen/event on the coded handler. Mirrors
 * `bakedSymbolMap`'s runtime→baked→undefined resolution; undefined ⇒ the interpreter
 * is inert ⇒ coded mounting + `bookEventHandlerMap` (the §7 fall-through invariant).
 */
export function bakedFlowDoc(): FlowDoc | undefined {
	if (hasRuntimeBundle()) return runtimeBundle!.flow;
	if (!hasBakedDoc()) return undefined;
	return bakedBundle.flow;
}

/**
 * The baked Invisible Flow **v2** graph (`/flow-v2` output). When present, the game's
 * `flowV2Runtime` builds the v2 interpreter from it so a v2 flow drives the game; undefined ⇒ v2
 * stays inert and the v1/coded path owns the game (parity, decision "ship-ready v2, keep v1").
 * Same runtime→baked→undefined resolution as `bakedFlowDoc`.
 */
export function bakedFlowV2Doc(): FlowDocV2 | undefined {
	if (hasRuntimeBundle()) return runtimeBundle!.flowV2;
	if (!hasBakedDoc()) return undefined;
	return bakedBundle.flowV2;
}

/**
 * The baked Invisible Cinematic documents (`/rigger` Cinematic mode output). A cinematic is a
 * non-linear sequencer over several rigs — the `<Cinematic>` component plays one by id.
 *
 * Returns `[]` rather than `undefined` when nothing is authored, because every consumer wants to
 * look one up by id and an empty list is the honest "no cinematics here" — same runtime→baked
 * resolution as the flow accessors above. The RIGS a cinematic casts ship through `editorArt`
 * (seeded by the export), so a returned doc's actors are always loadable.
 */
export function bakedCinematics(): CinematicDoc[] {
	if (hasRuntimeBundle()) return runtimeBundle!.cinematics ?? [];
	if (!hasBakedDoc()) return [];
	return bakedBundle.cinematics ?? [];
}

/** One baked cinematic by id, or undefined when the project never authored it. */
export function bakedCinematic(id: string): CinematicDoc | undefined {
	return bakedCinematics().find((c) => c.id === id);
}

/** The baked shared v2 function library the `flowV2` graph resolves `functionCall` nodes against
 *  (undefined ⇒ an empty library; a doc with no `functionCall` never needs it). */
export function bakedFlowV2Library(): FlowV2LibraryDoc | undefined {
	if (hasRuntimeBundle()) return runtimeBundle!.flowV2Library;
	if (!hasBakedDoc()) return undefined;
	return bakedBundle.flowV2Library;
}

type SymbolAssetEntry =
	| { type: 'sprites' | 'sprite'; src: string; preload: boolean }
	| { type: 'spine'; src: { atlas: string; skeleton: string; scale: number }; preload: boolean };

/**
 * Asset entries for any sprite sheet / image / spine bundle a baked symbol binding
 * introduces (exported to `deploy/editor-symbols/`, mirrored into `static/assets/` by the
 * deploy pull). Spread into `createApp({assets})` beside `bakedEditorArtAssets()` so a
 * rebound symbol resolves WITHOUT a manual `assets.ts` entry. The src is page-relative
 * (`assets/…`), matching how the static dir is served. Empty when un-baked (dev parity).
 *
 * Symbol sprite sheets register their frames under the sheet's OWN frame names (NOT
 * namespaced like editor-art), because a symbol binding's `assetKey` is the plain frame
 * key (e.g. `h1.webp`) that `SymbolSprite` looks up directly. The exporter therefore must
 * keep symbol frame keys unique across the project's bound sheets.
 */
export function bakedSymbolAssets(): Record<string, SymbolAssetEntry> {
	const out: Record<string, SymbolAssetEntry> = {};
	const source = hasRuntimeBundle() ? runtimeBundle! : hasBakedDoc() ? bakedBundle : null;
	if (!source) return out;
	warnMissingAssets(source);
	const index = source.symbols?.index;
	if (!index) return out;
	const base = srcBase();
	for (const sheet of index.sheets ?? []) {
		out[`editorSymbols/${sheet.json}`] = {
			type: 'sprites',
			src: `${base}${sheet.json}`,
			preload: true,
		};
	}
	for (const image of index.images ?? []) {
		out[image.key] = { type: 'sprite', src: `${base}${image.file}`, preload: true };
	}
	for (const spine of index.spines ?? []) {
		out[spine.key] = {
			type: 'spine',
			src: {
				atlas: `${base}${spine.atlas}`,
				skeleton: `${base}${spine.skeleton}`,
				scale: spine.scale ?? 2,
			},
			preload: true,
		};
	}
	return out;
}

/**
 * Asset entries for any sprite sheet / image / spine bundle the free-spin BOOK VFX
 * ({@link bakedBookVfx}) introduces that `bakedSymbolAssets()` did NOT already register. The
 * bookVfx layers reference the SAME `symbols.index` the per-cell symbol bindings do, and
 * `bakedSymbolAssets()` registers that whole index — so in practice this returns nothing and only
 * exists to keep the guarantee honest (and future-proof if that base registration ever becomes
 * selective). An `fx` layer needs nothing here: it rides {@link bakedEffects}. Empty when un-baked /
 * no bookVfx (dev parity — `bakedBookVfx()` is undefined ⇒ this returns `{}`).
 */
export function bakedBookVfxAssets(): Record<string, SymbolAssetEntry> {
	const vfx = bakedBookVfx();
	return vfx ? layerAssets([vfx.background, vfx.foreground]) : {};
}

/**
 * The same guarantee for the explosion → intro transition ({@link bakedSymbolTransition}): its spine
 * bundle / clip sheet reaches `symbols.index` through the exporter's `addLayerRefs`, so this too
 * returns nothing in practice. Empty when un-baked / no transition (parity).
 */
export function bakedSymbolTransitionAssets(): Record<string, SymbolAssetEntry> {
	const transition = bakedSymbolTransition();
	return transition ? layerAssets([transition]) : {};
}

/** What {@link layerAssets} needs of a kind-tagged layer — a book-VFX layer or the transition. */
type AssetLayer = { kind: BookVfxLayer['kind']; assetKey?: string };

/** Asset entries for the sprite sheet / image / spine bundle the given layers name that
 *  `bakedSymbolAssets()` did NOT already register. */
function layerAssets(
	layers: readonly (AssetLayer | undefined)[],
): Record<string, SymbolAssetEntry> {
	const out: Record<string, SymbolAssetEntry> = {};
	const source = hasRuntimeBundle() ? runtimeBundle! : hasBakedDoc() ? bakedBundle : null;
	const index = source?.symbols?.index;
	if (!index) return out;
	const already = bakedSymbolAssets();
	const base = srcBase();

	// The asset KEYS the layers name directly (`assetKey`). A spine layer's key IS a spine bundle
	// key / a standalone image key; a sprite/flipbook layer's key is a sheet FRAME key that lives
	// inside a sheet (handled below).
	const keys = new Set<string>();
	for (const layer of layers) if (layer?.assetKey) keys.add(layer.assetKey);

	for (const spine of index.spines ?? []) {
		if (!keys.has(spine.key) || spine.key in already || spine.key in out) continue;
		out[spine.key] = {
			type: 'spine',
			src: {
				atlas: `${base}${spine.atlas}`,
				skeleton: `${base}${spine.skeleton}`,
				scale: spine.scale ?? 2,
			},
			preload: true,
		};
	}
	for (const image of index.images ?? []) {
		if (!keys.has(image.key) || image.key in already || image.key in out) continue;
		out[image.key] = { type: 'sprite', src: `${base}${image.file}`, preload: true };
	}
	// A sprite/flipbook layer's `assetKey`/clip frame is a sheet FRAME, not a sheet key, and a frame
	// can't be mapped to its sheet without reading the sheet json — so a bg/fg sprite/flipbook needs
	// the SHEET(s) that hold its frames. Register every index sheet `bakedSymbolAssets()` didn't (it
	// registers them all, so the dedup empties this in practice; it stays correct if that changes).
	const needsSheets = layers.some(
		(layer) => layer?.kind === 'sprite' || layer?.kind === 'flipbook',
	);
	if (needsSheets) {
		for (const sheet of index.sheets ?? []) {
			const key = `editorSymbols/${sheet.json}`;
			if (key in already || key in out) continue;
			out[key] = { type: 'sprites', src: `${base}${sheet.json}`, preload: true };
		}
	}
	return out;
}

/**
 * The baked project font catalog (Font Maker output, frozen into the bundle by
 * `bake-editor-doc.mjs`). Undefined when un-baked (dev) → the game keeps only its
 * hardcoded built-in fonts. Feed it to the engine's shared `bakedFontAssets` /
 * `mergeBakedFontCatalog` / `registerBakedWebFonts` (the runtime half lives in
 * `engine-layout` so every game shares one implementation).
 */
export function bakedFontCatalog(): FontCatalog | undefined {
	if (hasRuntimeBundle()) return runtimeBundle!.fonts?.catalog;
	if (!hasBakedDoc()) return undefined;
	return bakedBundle.fonts?.catalog;
}

/**
 * The project's own SOUND LIBRARY (Invisible Sound), as exported into `deploy/sounds/`. Feed it to
 * the engine's shared `bakedSoundBanks` to get the extra audio banks `sound.load()` takes — the
 * runtime half lives in `engine-layout` so every game shares one implementation.
 *
 * Undefined when un-baked or when the project has uploaded nothing, which is what keeps a game with
 * no sounds of its own playing exactly the shipped audiosprite and nothing else (parity).
 */
export function bakedSoundCatalog(): SoundCatalog | undefined {
	if (hasRuntimeBundle()) return runtimeBundle!.sounds?.catalog;
	if (!hasBakedDoc()) return undefined;
	return bakedBundle.sounds?.catalog;
}

/**
 * The baked Localization-tool strings as a per-locale messages map, merged into
 * the game's Lingui catalog (LAST, so a project's reviewed strings override a
 * code catalog on key clash). Empty when un-baked / nothing localized — parity.
 */
export function bakedLocalizationMessagesMap(): MessagesMap {
	if (hasRuntimeBundle()) return (runtimeBundle!.localization?.messages ?? {}) as MessagesMap;
	return (bakedBundle.localization?.messages ?? {}) as MessagesMap;
}

/**
 * Register the engine's text-localization resolver (§18): any layout-doc text —
 * a text node's literal or a `textBox`'s `text` param — that matches a key in
 * the game's merged catalog renders its translation for the active language;
 * unknown strings render verbatim. Call once at boot with the SAME merged
 * `messagesMap` the game feeds `<LoadI18n>`, so the editor and code share one
 * catalog (including the baked Localization-tool strings merged above).
 */
export function registerEditorTextLocalization(messagesMap: MessagesMap): void {
	registerTextResolver((key) => {
		const lang = stateUrlDerived.lang();
		const catalog = (messagesMap[lang] ?? messagesMap['en' as keyof MessagesMap] ?? {}) as Record<
			string,
			unknown
		>;
		if (!(key in catalog)) return undefined;
		// Return the RAW catalog string, NOT `stateI18nDerived.translate()`.
		//
		// A runtime message compiler is installed (`stateI18n`), so `i18n._()` evaluates the
		// message as ICU — and `_()` with no `values` substitutes EMPTY for every `{token}`.
		// Win text is deliberately localize-THEN-interpolate (`formatWinText`), so routing its
		// template through Lingui here consumed the placeholders before the engine could fill
		// them: "You win {amount} with {count} {symbolName}" rendered as a bare "Vinci  con".
		// It also silently killed the inline symbol IMAGE, which keys off the interpolated
		// `{symbolName}`. Plain strings (every coded UI label, symbol names, text nodes) are
		// byte-identical either way — they have no tokens to evaluate.
		const message = catalog[key];
		return typeof message === 'string' ? message : stateI18nDerived.translate(key);
	});
}

/**
 * Offline fallback / checked-in stand-in for the editor document the Invisible
 * Editor would write to R2 at `editor/lines/<project>/scenes.json` (see
 * `apps/launcher-api/src/lib/server/projectPaths.ts#editorDocKey`). It is now
 * produced by the template-shaped generator `defaultLayout('lines')` rather
 * than a hand-written literal — the engine-truth "import" of the current
 * basegame (`docs/design/invisible-editor.md` §7.2) — so it round-trips cleanly
 * through `normalizeDoc` and stays in lock-step with `BoardFrame.svelte`.
 *
 * The animated reelhouse glow spine stays coded in `BoardFrame.svelte` by DEFAULT — the
 * `boardGlow` scene ships only its bind anchor, so an un-authored game keeps the coded
 * start→idle→exit chain. Put real art in that scene and the coded spine steps aside
 * (`hasAuthoredBoardGlow`); its enter/exit then rides the `boardGlowShow`/`boardGlowHide`
 * component signals. The `basegame` scene draws
 * INSIDE `<MainContainer>`; `basegameOverlays` (the coded `Win` / `Transition`
 * `mount` slots) draws OUTSIDE it, since those components self-position in
 * canvas coords.
 */
export const fallbackEditorScenes: LayoutDoc = defaultLayout('lines', {
	buttons: HUD_BUTTON_INSTANCES,
	transition: TRANSITION_INSTANCE,
	freeSpinOverlays: FREE_SPIN_OVERLAY_INSTANCES,
	winInstance: WIN_INSTANCE,
});

/**
 * Default launcher origin that serves the public layout-doc endpoint
 * (`GET /api/editor/doc?project=`). Overridable per-load with the
 * `?editorDocBase=` query param (e.g. a local launcher on :3010).
 */
const DEFAULT_DOC_BASE = 'https://app.invisiblewall.org';

/**
 * The asset-URL prefix the baked-font helpers ({@link bakedFontAssets} /
 * {@link registerBakedWebFonts}, shared in `engine-layout`) must prepend. In live
 * runtime mode the project's fonts live behind the launcher's `/api/deploy`, so the
 * game passes this absolute base instead of the default page-relative `assets/`. Off
 * mode returns `'assets/'` so the engine helpers behave exactly as before (parity).
 */
export function bakedFontSrcBase(): string {
	return srcBase();
}

/**
 * The same prefix for the project's SOUND banks, which howler fetches by URL itself (they never go
 * through the pixi asset loader). Read in `EnableSound`'s `onMount` — i.e. after `+layout.ts`'s
 * `load()` has settled the runtime bundle — so runtime mode returns the launcher's absolute base
 * rather than the page-relative default.
 */
export function bakedSoundSrcBase(): string {
	return srcBase();
}

/**
 * The same prefix for the BOOT SPLASH, which resolves `_boot/boot.json` + its spine bundles
 * out of the deploy tree. Read at layout mount — i.e. AFTER `+layout.ts`'s `load()` has
 * settled the runtime bundle — so runtime mode returns the launcher's absolute base rather
 * than the page-relative default. Both forms preserve file extensions, which `Assets.load`
 * needs to pick a spine parser.
 */
export function bootSplashAssetBase(): string {
	return srcBase();
}

/**
 * URL flag the LAUNCHER adds to its own "launch game" links. It marks a boot as an
 * AUTHORING boot, which is the only case that gets the on-screen stale-data banner —
 * the same published URL is what players load, and a player who hits a transient launcher
 * hiccup should get the (working) stale game, not a red developer warning. The console
 * error + `window.__IE_RUNTIME_STALE__` below are set for everyone regardless.
 */
const AUTHORING_PARAM = 'ie_authoring';

declare global {
	/** Set on any boot that renders something OTHER than the project's live authoring —
	 *  readable from the console / debug menu to tell "the tool didn't save it" apart from
	 *  "the game never received it". Undefined on a healthy boot. */

	var __IE_RUNTIME_STALE__: { reason: string; at: string } | undefined;
	/** Boot loading-screen handle defined in the static HTML shell (`app.html`). Drives the
	 *  pre-mount splash (phase text, progress %, game name) that covers the black window before
	 *  Pixi + the in-canvas `LoadingBar` exist. Optional-chained everywhere — undefined in
	 *  Storybook / SSR / any host without the shell overlay. */

	var __ieBoot:
		| {
				title: (text: string) => void;
				phase: (text: string) => void;
				progress: (pct: number) => void;
				done: () => void;
				/** Run `cb` once the overlay has cleared (immediately if it already has). The
				 *  boot-splash sequence waits on this so its spine marks aren't played beneath
				 *  an opaque overlay. */
				whenDone: (cb: () => void) => void;
		  }
		| undefined;
}

/** Backoff before each retry. See {@link fetchRuntimeWithRetry} for why retrying pays. */
const RUNTIME_RETRY_DELAYS_MS = [1_000, 3_000];

/**
 * Per-attempt cap. Must comfortably exceed a cold assemble or we abort runs that were about to
 * succeed, but must exist at all: boot AWAITS this fetch, so a hung request with no timeout is
 * an indefinitely black screen.
 *
 * ⚠️ RAISING THIS IS USUALLY THE WRONG FIX. Measured 2026-08-20 against `bookofborutremake` over
 * three requests: the assemble takes **34-38s**, and this 60s cap was never reached in any of them.
 * One request still 502'd (at 33.5s) while two LONGER ones succeeded (36.3s, 38.5s) — so the
 * endpoint fails INTERMITTENTLY upstream of us rather than at a fixed threshold, and no value of
 * this constant prevents that. The boot survives a 502 only because the retry joins the in-flight
 * assemble.
 *
 * What actually helps is making `/api/editor/runtime` cheaper, and its `Server-Timing` header now
 * names the target precisely: `art` (~34s) and `symbols` (~30s) run in parallel and are essentially
 * the WHOLE assemble — every other step combined is under 5s. Both have to move off the read path
 * to gain anything, since dropping one leaves the other on the critical path. Doing so would take
 * the assemble to roughly 8s. The cost scales with project CONTENT (a near-empty project answers in
 * under 5s), so it returns as any project fills up.
 *
 * ⚠️ This number ROTS as a project grows — it was 30s against a then-measured ~17-19s assemble,
 * and by 2026-08 Book of Borut Remake was answering in 29.6-34.2s (183 KB bundle, measured over
 * three fetches). The cap sat *inside* that spread, so the first attempt aborted at the moment
 * the response was about to land and the game silently dropped to STALE BAKED data — the exact
 * failure `markRuntimeStale` exists to expose. Retrying usually rescued it (the endpoint
 * single-flights, so attempt 2 joins the run in flight), which is why it read as "flaky" rather
 * than broken. {@link fetchRuntimeWithRetry} now warns whenever an attempt spends most of its
 * budget, so the next time this rots it says so BEFORE it starts failing.
 */
const RUNTIME_ATTEMPT_TIMEOUT_MS = 60_000;

/** Warn once an attempt exceeds this share of its cap — the early signal that the assemble has
 *  grown back into the timeout. */
const RUNTIME_SLOW_ATTEMPT_RATIO = 0.6;

/**
 * Total budget across all attempts. Bounds the worst case for a PLAYER: on a hard launcher
 * outage they wait this long at most before getting the (working) baked game, instead of
 * three full attempt timeouts stacked back to back. Enforced as a real deadline — each
 * attempt's timeout is clamped to the budget REMAINING, so this can't be overrun by an
 * attempt that starts just before the deadline.
 */
const RUNTIME_FETCH_BUDGET_MS = 90_000;

/**
 * GET the runtime bundle, retrying a FAILED response (5xx / network error) a couple of
 * times before giving up and letting the caller fall back to stale baked data.
 *
 * Retrying is worth it because of how the launcher assembles this: a bundle costs tens of seconds
 * (it re-runs every exporter), and the endpoint single-flights + briefly caches the result
 * (`runtimeBundleCache.ts`). So when the gateway 502s a slow assemble, the server is usually
 * still finishing it — a retry JOINS that same run (or hits the warm cache) instead of
 * starting another cold one. Without the server-side single-flight this retry would just
 * pile on more load and lose the same race, so the two changes only work as a pair.
 *
 * A 4xx is NOT retried: a bad/expired `?k=` token will fail identically every time, and
 * retrying only delays the (correct, loud) console error.
 */
async function fetchRuntimeWithRetry(url: string): Promise<Response> {
	const deadline = Date.now() + RUNTIME_FETCH_BUDGET_MS;
	for (let attempt = 0; ; attempt++) {
		const last = attempt >= RUNTIME_RETRY_DELAYS_MS.length;
		let failure: string;
		// Clamp to the budget REMAINING so a late attempt can't run past the deadline. Never
		// below 1s — a sliver of budget should fail fast, not fire a request doomed to abort.
		const attemptCap = Math.max(1_000, Math.min(RUNTIME_ATTEMPT_TIMEOUT_MS, deadline - Date.now()));
		const startedAt = Date.now();
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(attemptCap) });
			// A near-miss is the warning shot for the rot described on RUNTIME_ATTEMPT_TIMEOUT_MS:
			// the fetch SUCCEEDED, so nothing is broken yet, but the cap is no longer comfortable.
			const elapsed = Date.now() - startedAt;
			if (res.ok && elapsed > attemptCap * RUNTIME_SLOW_ATTEMPT_RATIO) {
				console.warn(
					`[runtime] live data fetch took ${elapsed}ms of a ${attemptCap}ms cap — the bundle ` +
						`assemble is slow enough to be at risk. NOTE: raising RUNTIME_ATTEMPT_TIMEOUT_MS is ` +
						`usually the WRONG fix — measured 2026-08-20 the assemble runs 34-38s and this cap ` +
						`was never reached, yet the endpoint still 502s intermittently upstream of us. ` +
						`Speed up /api/editor/runtime instead: its Server-Timing header shows 'art' and ` +
						`'symbols' are essentially the whole cost.`,
				);
			}
			// Client errors are deterministic — fail fast rather than retry a bad token.
			if (res.ok || (res.status >= 400 && res.status < 500)) return res;
			// On the last attempt return the response itself, so the caller reports the REAL status.
			if (last) return res;
			failure = `${res.status} ${res.statusText}`;
		} catch (err) {
			// A network failure on the last attempt must surface as a throw, so the caller logs the
			// real message rather than a synthesized response.
			if (last) throw err;
			failure = err instanceof Error ? err.message : String(err);
		}
		const delay = RUNTIME_RETRY_DELAYS_MS[attempt];
		if (Date.now() + delay >= deadline) {
			throw new Error(
				`live data fetch gave up after ${RUNTIME_FETCH_BUDGET_MS}ms — last: ${failure}`,
			);
		}
		console.warn(
			`[runtime] live data fetch failed (${failure}) — ` +
				`retry ${attempt + 1}/${RUNTIME_RETRY_DELAYS_MS.length} in ${delay}ms`,
		);
		await new Promise((resolve) => setTimeout(resolve, delay));
	}
}

/** Why the live-runtime fetch failed this boot, if it did — the REASON reported if we then
 *  end up on stale data. Recorded rather than acted on, because a failed runtime fetch does
 *  NOT by itself mean stale: boot falls through to the live `/api/editor/doc` path, which
 *  often succeeds with the author's real data. Only {@link loadEditorScenes} knows which
 *  source actually won, so only it decides whether to call {@link markRuntimeStale}. */
let runtimeFetchFailure: string | undefined;

const STALE_BANNER_ID = 'ie-stale-data-banner';

/**
 * Record that this boot is rendering data that is NOT the project's live authoring, and —
 * for an authoring boot only — say so on screen.
 *
 * This exists because the silent version of this fallback is genuinely expensive: a game
 * that quietly renders a pre-edit snapshot looks completely healthy, so the missing edit
 * gets blamed on the tool that authored it. (A duplicated FX node was debugged as an
 * "editor publishing bug" for an hour; it had saved and published correctly — the game had
 * simply never received the live doc.) The global flag is always set so a console probe or
 * the debug menu can read it.
 *
 * Call this ONLY once the losing data source is known — never on a fetch failure alone.
 */
function markRuntimeStale(reason: string): void {
	if (typeof window === 'undefined') return;
	// First reason wins: it is the proximate cause (e.g. the 502), whereas a later call
	// reports only the downstream consequence (e.g. "bundled fallback").
	if (window.__IE_RUNTIME_STALE__) return;
	window.__IE_RUNTIME_STALE__ = { reason, at: new Date().toISOString() };

	const params = new URLSearchParams(window.location.search);
	if (params.get(AUTHORING_PARAM) !== '1') return;

	const show = () => {
		if (document.getElementById(STALE_BANNER_ID)) return;
		const banner = document.createElement('div');
		banner.id = STALE_BANNER_ID;
		banner.textContent =
			`⚠ STALE DATA — this game is NOT showing your live authoring, so recent edits are ` +
			`missing. Reason: ${reason}. Reload to retry.`;
		banner.setAttribute(
			'style',
			'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#b3261e;color:#fff;' +
				'font:600 13px/1.4 system-ui,sans-serif;padding:10px 40px 10px 14px;cursor:pointer;' +
				'box-shadow:0 2px 8px rgba(0,0,0,.4)',
		);
		banner.title = 'Click to dismiss';
		banner.onclick = () => banner.remove();
		document.body.appendChild(banner);
	};
	// This can run from `load()`, which may resolve before <body> exists.
	if (document.body) show();
	else window.addEventListener('DOMContentLoaded', show, { once: true });
}

/**
 * Fetch the live runtime bundle (Invisible Game Maker, Phase 0) ONCE, before
 * `createApp` registers assets, and stash it module-level so every `baked*` function
 * above reads from it. OPT-IN: a no-op unless `?runtime=1` is in the game URL. On any
 * failure (no `k`, non-200, bad shape) it leaves `runtimeBundle` null and returns
 * false, so boot transparently falls back to the live `/api/editor/doc` path (and
 * ultimately {@link fallbackEditorScenes}) — never a black screen.
 *
 * Call + AWAIT this from `+layout.ts`'s client `load()`, which SvelteKit resolves
 * before the page component (and therefore `AssetsLoader`) mounts, so the runtime
 * assets are present when the game re-merges them into `stateApp.assets`.
 */
export async function prepareRuntimeBundle(): Promise<boolean> {
	if (!runtimeModeEnabled()) return false;
	try {
		const params = new URLSearchParams(window.location.search);
		const base = params.get('editorDocBase') || DEFAULT_DOC_BASE;
		const project = params.get('project') || 'lines';
		const token = params.get('k');
		if (!token) {
			console.warn('[runtime] ?runtime=1 but no ?k= token — falling back to live doc fetch');
			runtimeFetchFailure = 'no ?k= token in the game URL';
			return false;
		}
		// An AUTHORING boot additionally receives UNREVIEWED translations, so a translator
		// can see machine output in the running game before vetting it. A published player
		// URL never carries `ie_authoring=1`, so players — and the build-time bake — keep
		// getting reviewed text only.
		const authoring = params.get(AUTHORING_PARAM) === '1' ? '&authoring=1' : '';
		const url =
			`${base}/api/editor/runtime?project=${encodeURIComponent(project)}` +
			`&k=${encodeURIComponent(token)}${authoring}`;
		// The boot splash (app.html) is already painting; name the phase the player is
		// waiting on — this fetch is the long cross-origin call that used to be a black screen.
		window.__ieBoot?.phase('Fetching from R2…');
		const res = await fetchRuntimeWithRetry(url);
		if (!res.ok) {
			console.error(
				`[runtime] LIVE DATA FETCH FAILED — ${res.status} ${res.statusText}. The game is now ` +
					`showing STALE BAKED assets, NOT your live authoring.` +
					(res.status === 401
						? ` A 401 almost always means the ?k= read token in the game URL is wrong/expired ` +
							`(watch for l/I/O/0 look-alikes) — reopen the game from the launcher for a fresh URL.`
						: '') +
					` (${url})`,
			);
			runtimeFetchFailure = `${res.status} ${res.statusText} from /api/editor/runtime`;
			return false;
		}
		const data = (await res.json()) as Partial<RuntimeBundle>;
		const doc = data.doc;
		const valid =
			typeof data.assetBase === 'string' &&
			!!doc &&
			Array.isArray(doc.scenes) &&
			doc.scenes.some((scene) => scene.id === 'basegame');
		if (!valid) {
			console.warn('[runtime] bundle shape invalid (no assetBase / basegame scene) — falling back');
			runtimeFetchFailure = 'runtime bundle shape invalid (no assetBase / basegame scene)';
			return false;
		}
		runtimeBundle = data as RuntimeBundle;
		// Boot splash: reveal the game name (the launcher's project display name) and move to
		// the asset phase. Real 0–100 progress takes over from here (Game.svelte feeds
		// `stateApp.loadingProgress` into `__ieBoot.progress`).
		if (typeof data.name === 'string' && data.name) window.__ieBoot?.title(data.name);
		window.__ieBoot?.phase('Loading assets…');
		if (__IE_DEBUG__) {
			console.info(
				`[runtime] live runtime bundle ready for "${project}" — generic-bundle boot active`,
			);
		}
		return true;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(
			`[runtime] LIVE DATA FETCH THREW: ${message}. The ` +
				`game is showing STALE BAKED assets, NOT your live authoring. A "Failed to fetch" here is ` +
				`often a CORS-masked 401 or 502 — the browser reports the missing CORS header, not the real ` +
				`status, because an error response from the edge carries no CORS headers. Check the Network ` +
				`tab for the actual status before believing "CORS".`,
		);
		runtimeFetchFailure = message;
		return false;
	}
}

/**
 * Fetch the project's editor `LayoutDoc` from the launcher at game boot. The
 * launcher appends `?project=<active>` to the game URL; the endpoint resolves
 * the client itself. Falls back to {@link fallbackEditorScenes} on any failure
 * or when the fetched doc has no `basegame` scene, so the game still runs
 * offline / before any doc has been authored in the editor.
 */
function fellBack(reason: string): LayoutDoc {
	// Loud, single-line signal so a live game that is NOT honouring editor edits is
	// diagnosable from the browser console (the silent fallback was the #1 cause of
	// "my editor resize didn't reach the game"). The bundled layout still renders.
	console.warn(
		`[editor] using bundled fallback layout — editor edits will NOT show. Reason: ${reason}`,
	);
	// The bundled layout is nobody's authoring, so this is always stale. Prefer the runtime
	// fetch's reason when there was one — it's the proximate cause; `reason` is its consequence.
	markRuntimeStale(runtimeFetchFailure ?? `bundled fallback layout — ${reason}`);
	return fallbackEditorScenes;
}

export async function loadEditorScenes(): Promise<LayoutDoc> {
	const doc = await resolveEditorDoc();
	// The doc's Canvas Size IS the box the Scene Editor laid every `game`-space node out
	// against, so it must be the box `<MainContainer>` scales to the window — otherwise the
	// game renders the authored nodes at a different size AND position than the editor
	// showed (while `canvas`-space screens, which never use this box, stay pixel-perfect).
	// The coded `stateLayout.ts` map stays the fallback for a doc that declares no box.
	setAuthoredMainSizesMap(doc.mainSizesMap);
	// The doc's layout PROFILE (bucket set + selection rules) drives which bucket the live
	// window falls into and each bucket's frame box — the runtime twin of the editor's device
	// bar. The bundle bakes the effective profile (project override, else pipeline default)
	// onto the doc; absent ⇒ the coded DEFAULT_LAYOUT_PROFILE (byte-identical to before).
	setAuthoredLayoutProfile(doc.layoutProfile);
	if (__IE_DEBUG__) {
		console.info('[layout] main box adopted from the editor doc:', doc.mainSizesMap);
		if (doc.layoutProfile) console.info('[layout] layout profile adopted:', doc.layoutProfile);
	}
	// Default-HUD fallback: rewrite a legacy coded-`bind` `hudBar` (seeded `UiLabel*`/`UiButton*`
	// nodes) into the parametric `componentInstance` HUD, so the bottom bar renders under a
	// flow-v2-driven game too (where the coded `<UI>` — the binds' only renderer — is suppressed).
	// A no-op for a doc already seeded parametric or with no `hudBar` (returns the same object).
	return normalizeHudScenes(doc);
}

async function resolveEditorDoc(): Promise<LayoutDoc> {
	// Live runtime (Game Maker, Phase 0): `prepareRuntimeBundle()` already fetched +
	// validated the doc (it has a `basegame` scene), so render it directly. The asset
	// registrations above are already reading from the same bundle. Off mode (no
	// `?runtime=1` / failed fetch) leaves `runtimeBundle` null and this is skipped.
	if (hasRuntimeBundle()) {
		if (__IE_DEBUG__)
			console.info('[runtime] using live runtime bundle doc — editor edits are active');
		return runtimeBundle!.doc as LayoutDoc;
	}
	// Build-time freeze: a baked doc is the authored layout snapshotted into the
	// bundle, so production renders it instantly with no fetch + no launcher
	// dependency. `registerBakedComponents()` (boot) has already registered its defs.
	if (hasBakedDoc()) {
		// A baked doc is the INTENDED source for a normal build (frozen at build time, no fetch).
		// But when `?runtime=1` asked for live authoring and the fetch failed, this same branch is
		// the silent stale fallback — the game renders a pre-edit snapshot and looks healthy. That
		// is the exact failure this reports; it is decided HERE, not at fetch-failure time, because
		// a failed runtime fetch alone can still end on live data via `/api/editor/doc` below.
		if (runtimeFetchFailure) markRuntimeStale(runtimeFetchFailure);
		if (__IE_DEBUG__)
			console.info('[editor] using baked layout doc (frozen at build) — live fetch skipped');
		return bakedBundle.doc as LayoutDoc;
	}
	if (typeof window === 'undefined') return fallbackEditorScenes;
	try {
		const params = new URLSearchParams(window.location.search);
		const base = params.get('editorDocBase') || DEFAULT_DOC_BASE;
		const project = params.get('project') || 'lines';
		// Shared read token the launcher appends to the game URL (`?k=`); the
		// doc endpoint is token-gated. Without it the fetch 401s -> fallback.
		const token = params.get('k');
		if (!token) return fellBack('no ?k= token in the game URL (launcher must append it)');
		const docUrl =
			`${base}/api/editor/doc?project=${encodeURIComponent(project)}` +
			`&k=${encodeURIComponent(token)}`;
		const res = await fetch(docUrl);
		if (!res.ok) return fellBack(`doc fetch ${res.status} ${res.statusText} (${docUrl})`);
		const data = (await res.json()) as {
			doc?: LayoutDoc;
			componentDefaults?: Record<string, Record<string, unknown>>;
		};
		// Register the project's author-set component param defaults (§14.2 B4.5)
		// before the doc renders, so a `componentInstance` (e.g. a HUD readout) picks
		// up per-project appearance defaults. Absent/empty ⇒ def defaults apply (parity).
		registerComponentDefaults(data.componentDefaults ?? {});
		const doc = data.doc;
		if (doc && Array.isArray(doc.scenes) && doc.scenes.some((scene) => scene.id === 'basegame')) {
			if (__IE_DEBUG__)
				console.info(`[editor] loaded live layout doc for "${project}" — editor edits are active`);
			return doc;
		}
		return fellBack('fetched doc has no `basegame` scene (schema/validation rejected)');
	} catch (err) {
		return fellBack(`fetch threw: ${err instanceof Error ? err.message : String(err)}`);
	}
}
