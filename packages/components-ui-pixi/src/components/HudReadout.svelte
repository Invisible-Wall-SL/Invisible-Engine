<script lang="ts">
	import { Tween } from 'svelte/motion';

	import { Container } from 'pixi-svelte';
	import { stateBet, stateBetDerived, stateI18nDerived, stateModal } from 'state-shared';
	import { getComponentParams } from 'engine-layout/svelte';
	import { resolveLocalizedText, type TextStyle } from 'engine-layout';
	import { numberToCurrencyString, bookEventAmountToCurrencyString } from 'utils-shared/amount';

	import UiLabel from './UiLabel.svelte';
	import { getContext } from '../context';
	import { i18nDerived } from '../i18n/i18nDerived';

	/**
	 * Parametric HUD readout (§14 B4.4, owner-chosen MOUNT path). The `HudReadout`
	 * `ComponentDef` mounts THIS coded component (via a `bind` node inside its
	 * `def.root`) so the readout keeps the PROVEN coded label rendering — the same
	 * localized caption, the same `UiLabel` stacked caption+value, the same
	 * per-source currency formatting, and the same count-up — rather than
	 * re-implementing them as engine text nodes. One def, instanced three ways by
	 * its `source` param (`'balance' | 'win' | 'bet'`).
	 *
	 * It reads the engine param context `<ComponentInstance>` provides:
	 * - `source` — which live value/caption to render (the data binding).
	 * - `value` (engineProvided) — the RAW live number fed by `registerComponentValues`
	 *   (`stateBet.balanceAmount` / `stateBet.winBookEventAmount` / `betCost()`).
	 * - `label` — optional caption override; absent ⇒ the localized caption.
	 * - `countUp` — tween the value on change (win) instead of snapping.
	 * - `fill`/`fontSize`/`fontFamily` — text-style overrides merged over `UiLabel`'s
	 *   base, mirroring the §12 `bind.props.style` appearance path.
	 *
	 * Parity: each `source` reproduces its coded `Label*` sibling exactly — same
	 * caption selector, same currency formatter, same count-up. The `bet` source
	 * additionally reproduces `LabelBet`'s tap-to-open-bet-menu interactivity.
	 */
	const context = getContext();

	const numberParam = (key: string): number | undefined => {
		const params = getComponentParams();
		return typeof params[key] === 'number' ? (params[key] as number) : undefined;
	};
	const stringParam = (key: string): string | undefined => {
		const params = getComponentParams();
		return typeof params[key] === 'string' ? (params[key] as string) : undefined;
	};
	const boolParam = (key: string): boolean => getComponentParams()[key] === true;

	const source = $derived(stringParam('source'));
	const labelOverride = $derived(stringParam('label'));
	const countUp = $derived(boolParam('countUp'));
	// The RAW live number from the engine value feed (undefined before the first
	// emit / when no source store is registered → render an empty value).
	const liveValue = $derived(numberParam('value'));

	// Localized caption per source — the EXACT selector each coded label uses
	// (`LabelBalance`/`LabelWin`: `i18nDerived.*`; `LabelBet`: the active bet mode's
	// label, falling back to `i18nDerived.bet()`). `label` overrides when set.
	const codedCaption = $derived.by(() => {
		switch (source) {
			case 'win':
				return i18nDerived.win();
			case 'bet': {
				// The authored bet-mode badge (Invisible Game Config) is a SOURCE string, harvested by
				// `/localization` — translate it, exactly as `HudCaption`/`LabelBet` do. Left raw it
				// showed English under every locale while the sibling captions localized.
				const betLabel = stateBetDerived.activeBetMode()?.text.betAmountLabel;
				return betLabel ? stateI18nDerived.translate(betLabel) : i18nDerived.bet();
			}
			case 'balance':
			default:
				return i18nDerived.balance();
		}
	});
	// An AUTHORED caption is a localization KEY, exactly like a text node's literal —
	// the Localization tool harvests these `label` params, so leaving them unresolved
	// meant a fully-translated project still showed English HUD captions. Unknown
	// strings render verbatim (the `resolveLocalizedText` contract), so parity holds.
	// The coded caption is already translated by `i18nDerived`.
	const caption = $derived(
		labelOverride === undefined ? codedCaption : resolveLocalizedText(labelOverride),
	);

	// Per-source currency formatting — `win` is a BOOK-EVENT amount (bet-multiplier
	// normalised, like `LabelWin`); balance/bet are plain currency amounts. This is
	// why the readout reuses the coded formatter rather than the engine's generic
	// `Intl.NumberFormat` integer path (which would break currency parity).
	const formatValue = (value: number): string =>
		source === 'win' ? bookEventAmountToCurrencyString(value) : numberToCurrencyString(value);

	// Count-up via the SAME `svelte/motion` Tween primitive `LabelWin` uses (no GSAP
	// dep). `countUp` off ⇒ snap (`duration: 0`), so balance/bet behave as today.
	// Init to a literal 0 (not the `$derived` `liveValue`, which is `undefined` at
	// init anyway and trips Svelte's `state_referenced_locally`); the effect below
	// immediately sets it to the live value.
	const valueTween = new Tween(0, { duration: 0 });
	$effect(() => {
		valueTween.set(liveValue ?? 0, { duration: countUp ? 500 : 0 });
	});
	const value = $derived(liveValue === undefined ? '' : formatValue(valueTween.current));

	const style = $derived.by(() => {
		const overrides: Partial<TextStyle> = {};
		const fontFamily = stringParam('fontFamily');
		const fontSize = numberParam('fontSize');
		const fill = numberParam('fill');
		if (fontFamily !== undefined) overrides.fontFamily = fontFamily;
		if (fontSize !== undefined) overrides.fontSize = fontSize;
		if (fill !== undefined) overrides.fill = fill;
		return Object.keys(overrides).length > 0 ? overrides : undefined;
	});

	// `bet` reproduces `LabelBet`'s interactivity: tap opens the bet-amount menu
	// (disabled mid-spin). Other sources are non-interactive, exactly like
	// `LabelBalance`/`LabelWin`.
	const isBet = $derived(source === 'bet');
	const disabled = $derived(!context.stateXstateDerived.isIdle());
	const onpress = () => {
		if (disabled) return;
		context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
		stateModal.modal = { name: 'betAmountMenu' };
	};
</script>

{#if isBet}
	<!-- `none` while DISABLED so an inert surface does not SWALLOW the pointer — see the note in
		 `components-pixi/Button.svelte`. -->
	<Container
		eventMode={disabled ? 'none' : 'static'}
		cursor={disabled ? 'not-allowed' : 'pointer'}
		onpointerup={onpress}
	>
		<UiLabel tiled stacked label={caption} {value} {style} />
	</Container>
{:else}
	<UiLabel tiled stacked label={caption} {value} {style} />
{/if}
