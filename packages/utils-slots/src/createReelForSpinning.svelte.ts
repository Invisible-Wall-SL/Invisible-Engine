import _ from 'lodash';
import { Tween } from 'svelte/motion';
import { sineOut, backIn, linear } from 'svelte/easing';

import { stateBet } from 'state-shared';
import { waitForTimeout } from 'utils-shared/wait';
import { createInterruptible } from 'utils-shared/interruptible';

import type { SpinningReelCreateOptions, SpinningReelSpinOptions, SpinType } from './types';

export type SpinningReelMotion = 'spinning' | 'bouncing' | 'stopped';
export type SpinningReelSymbolState = 'static' | 'land' | 'spin';

export function createReelForSpinning<TRawSymbol extends object, TSymbolState extends string>(
	reelOptions: SpinningReelCreateOptions<TRawSymbol, TSymbolState>,
) {
	// reelSymbols
	const createReelSymbol = (reelSymbolOptions: { rawSymbol: TRawSymbol; symbolIndex: number }) => {
		const rawSymbol = reelSymbolOptions.rawSymbol;
		const symbolIndex = reelSymbolOptions.symbolIndex;
		const symbolState = reelOptions.initialSymbolState;
		const symbolY = () => reelY.current + (reelSymbol.symbolIndex + 0.5) * getSymbolHeight();
		const oncomplete = () => {};

		const reelSymbol = $state({
			id: {},
			rawSymbol,
			symbolIndex,
			symbolState,
			symbolY,
			oncomplete,
		});

		return reelSymbol;
	};

	type ReelSymbol = ReturnType<typeof createReelSymbol>;

	const createReelSymbols: (value: TRawSymbol[]) => ReelSymbol[] = (rawSymbols) => {
		const reelSymbols = rawSymbols.map((rawSymbol, symbolIndex) =>
			createReelSymbol({ rawSymbol, symbolIndex }),
		);

		return reelSymbols;
	};

	const updateAllReelSymbolState = (value: SpinningReelSymbolState) => {
		reelState.symbols.forEach((reelSymbol) => {
			reelSymbol.symbolState = value as TSymbolState;
			if (value === 'land') {
				reelOptions.onSymbolLand({ rawSymbol: reelSymbol.rawSymbol });
			}
		});
	};

	// constants
	// Row pitch may be a getter (reactive override). Resolve lazily everywhere so a
	// plain number stays byte-identical; `homeY()` (the reel's resting Y) tracks it.
	const isReactiveHeight = typeof reelOptions.symbolHeight === 'function';
	const getSymbolHeight = () =>
		typeof reelOptions.symbolHeight === 'function'
			? reelOptions.symbolHeight()
			: reelOptions.symbolHeight;
	const homeY = () => -getSymbolHeight();
	const reelLength = reelOptions.initialSymbols.length;

	// interruptible
	const interruptible = createInterruptible();

	// reactive states
	const reelY = new Tween(homeY());
	// Height the reel was last HOMED to. Seeded here (reel-creation time) — NOT in
	// `readyToSpinEffect` — so a reactive pitch change that lands BEFORE the board
	// mounts (the editor's reelGrid override resolves while the loading screen is up,
	// so `readyToSpinEffect` runs after the height already changed) is still detected
	// and re-homed. Capturing the baseline at effect-setup missed that change, leaving
	// the reel parked at the doc-less home (`-SYMBOL_SIZE`) — a padding row leaked until
	// the first spin re-homed it.
	let homedHeight = getSymbolHeight();
	const reelState = $state({
		symbols: createReelSymbols(reelOptions.initialSymbols),
		motion: 'stopped' as SpinningReelMotion,
		spinType: 'normal' as SpinType,
		anticipating: false,
		readyToSpin: () => {},
		spinOptions: () => ({}) as SpinningReelSpinOptions,
	});
	const basePaddingSize = () => reelLength * reelState.spinOptions().reelPaddingMultiplierNormal;
	const anticipatedPaddingSize = () =>
		reelLength * reelState.spinOptions().reelPaddingMultiplierAnticipated;

	// internal states
	let isPreSpinning = false;
	let targetPaddingPosition = reelLength - 1;
	let prevSymbols: ReelSymbol[] = createReelSymbols(reelOptions.initialSymbols);
	let targetSymbols: ReelSymbol[] = createReelSymbols(reelOptions.initialSymbols);
	let paddingRawReel: TRawSymbol[] = reelOptions.initialSymbols;
	let onSpinFinishing: () => void = () => {};
	let noStop = false;
	let paddingSize = 0;

	const getPaddingRawSymbol = ({
		paddingRawReel,
		index,
	}: {
		paddingRawReel: TRawSymbol[];
		index: number;
	}) => {
		const length = paddingRawReel.length;
		if (index >= length) return paddingRawReel[index % length];
		if (index <= -1) return paddingRawReel[length + index];
		return paddingRawReel[index];
	};

	const getPaddingRawSymbols = ({
		paddingRawReel,
		start,
		length,
	}: {
		paddingRawReel: TRawSymbol[];
		start: number;
		length: number;
	}) =>
		_.range(length).map((index) => {
			const targetIndex = start + index;
			return getPaddingRawSymbol({ paddingRawReel, index: targetIndex });
		});

	const addPadding = async (paddingSizeValue: number) => {
		const paddingRawSymbols = getPaddingRawSymbols({
			paddingRawReel,
			start: targetPaddingPosition,
			length: paddingSizeValue,
		});
		const paddingSymbols = createReelSymbols(paddingRawSymbols);
		const symbolsForSpin: ReelSymbol[] = [...targetSymbols, ...paddingSymbols, ...prevSymbols];
		symbolsForSpin.forEach((symbol, newSymbolIndex) => (symbol.symbolIndex = newSymbolIndex));
		reelState.symbols = [...symbolsForSpin];

		const topY =
			homeY() - symbolsForSpin.length * getSymbolHeight() + reelLength * getSymbolHeight();
		return topY;
	};

	const slideY = async ({
		reelY: targetY,
		speed,
		easing = undefined,
	}: {
		reelY: number;
		speed: number;
		easing?: (value: number) => number;
	}) => {
		const currentY = reelY.current;
		const distance = Math.abs(targetY - currentY);
		const duration = distance / speed; // (speed unit: pixel / ms)

		await reelY.set(targetY, { duration, easing });
	};

	const placeY = (targetY: number) => reelY.set(targetY, { duration: 0 });

	const removePaddingAndBounceBack = async () => {
		reelState.symbols = [...targetSymbols];
		placeY(homeY() + getSymbolHeight() * reelState.spinOptions().reelBounceSizeMulti);
		await slideY({
			reelY: homeY(),
			speed: reelState.spinOptions().reelBounceBackSpeed,
			easing: sineOut,
		});
		setSymbolsWithReelSymbols(targetSymbols);
	};

	const preSpinPadding = async ({
		preSpinPaddingRawReel,
	}: {
		preSpinPaddingRawReel: TRawSymbol[];
	}) => {
		const randomStart = Math.floor(Math.random() * preSpinPaddingRawReel.length);
		prevSymbols = targetSymbols;
		const targetRawSymbols = getPaddingRawSymbols({
			paddingRawReel: preSpinPaddingRawReel,
			start: randomStart,
			length: reelLength,
		});
		targetSymbols = createReelSymbols(targetRawSymbols);
		const topY = await addPadding(0);
		await placeY(topY);
	};

	const preSpinSlideDownLoop = async ({
		isTurboBeforeAll,
		preSpinPaddingRawReel,
	}: {
		isTurboBeforeAll: boolean;
		preSpinPaddingRawReel: TRawSymbol[];
	}) => {
		let started = false;
		while (isPreSpinning) {
			const speed = started
				? reelState.spinOptions().reelSpinSpeed
				: reelState.spinOptions().reelPreSpinSpeed;
			const easing = started || isTurboBeforeAll ? linear : backIn;
			await slideY({ reelY: homeY(), speed, easing });
			await preSpinPadding({ preSpinPaddingRawReel });
			if (!started) {
				reelState.motion = 'spinning';
				updateAllReelSymbolState('spin');
				started = true;
			}
		}
	};

	const delaySpinByReelIndex = async () => {
		await waitForTimeout(reelState.spinOptions().reelSpinDelay * reelOptions.reelIndex);
	};

	const preSpin = async ({
		isTurboBeforeAll,
		preSpinPaddingReel,
	}: {
		isTurboBeforeAll: boolean; // To avoid previous spinType has effect on "getSpinOption" in "preSpinSlideDownLoop"
		preSpinPaddingReel: TRawSymbol[];
	}) => {
		const preSpinPaddingRawReel = preSpinPaddingReel;

		isPreSpinning = true;
		reelState.spinType = isTurboBeforeAll ? 'fast' : 'normal';
		await preSpinPadding({ preSpinPaddingRawReel });
		if (!isTurboBeforeAll) await delaySpinByReelIndex();
		preSpinSlideDownLoop({ isTurboBeforeAll, preSpinPaddingRawReel });
	};

	const generalSpinWith = async ({ slideDown }: { slideDown: () => Promise<void> }) => {
		const isSpinning = reelState.motion === 'spinning';

		const topY = await addPadding(paddingSize);
		await placeY(topY);

		if (!isSpinning) {
			reelState.motion = 'spinning';
			updateAllReelSymbolState('spin');
		}

		// Q: When to skip the slideDown?
		// A: When it's preSpinning(isSpinning) and stop button is clicked(isTurbo) and is noStop is false
		if (noStop) {
			await slideDown();
		} else if (stateBet.isTurbo && isSpinning) {
			// skip
		} else {
			await interruptible.add(slideDown);
		}

		reelState.motion = 'bouncing';
		onSpinFinishing();
		await removePaddingAndBounceBack();
		reelState.motion = 'stopped';
		updateAllReelSymbolState('land');
	};

	const fastSpin = () =>
		generalSpinWith({
			slideDown: async () => {
				const bounceSize = getSymbolHeight() * reelState.spinOptions().reelBounceSizeMulti;

				await slideY({
					reelY: homeY() + bounceSize,
					speed: reelState.spinOptions().reelSpinSpeed,
				});
			},
		});

	const normalSpin = () =>
		generalSpinWith({
			slideDown: async () => {
				const bounceSize = getSymbolHeight() * reelState.spinOptions().reelBounceSizeMulti;

				await slideY({
					reelY: homeY() * basePaddingSize(),
					speed: reelState.spinOptions().reelSpinSpeed,
				});
				await slideY({
					reelY: homeY() + bounceSize,
					speed: reelState.spinOptions().reelSpinSpeedBeforeBounce,
				});
			},
		});

	const anticipatedSpin = () =>
		generalSpinWith({
			slideDown: async () => {
				const bounceSize = getSymbolHeight() * reelState.spinOptions().reelBounceSizeMulti;

				await slideY({
					reelY: homeY() * basePaddingSize(),
					speed: reelState.spinOptions().reelSpinSpeed,
				});
				await slideY({
					reelY: homeY() + bounceSize,
					speed: reelState.spinOptions().reelSpinSpeedBeforeBounce,
				});
			},
		});

	const SPIN_MAP = {
		fast: fastSpin,
		normal: normalSpin,
		anticipated: anticipatedSpin,
	};

	const prepareToSpin = (prepareToSpinOptions: {
		noStop: boolean;
		spinType: SpinType;
		symbols: TRawSymbol[];
		paddingPosition: number;
		paddingReel: TRawSymbol[];
		onSpinFinishing: () => void;
		previousPaddingSize: number;
	}) => {
		reelState.spinType = prepareToSpinOptions.spinType;

		noStop = prepareToSpinOptions.noStop;
		prevSymbols = targetSymbols;
		targetPaddingPosition = prepareToSpinOptions.paddingPosition;
		targetSymbols = createReelSymbols(prepareToSpinOptions.symbols);
		paddingRawReel = prepareToSpinOptions.paddingReel;
		onSpinFinishing = prepareToSpinOptions.onSpinFinishing;

		const GET_PADDING_SIZE_MAP = {
			fast: prepareToSpinOptions.previousPaddingSize + 0,
			normal: prepareToSpinOptions.previousPaddingSize + basePaddingSize(),
			anticipated: prepareToSpinOptions.previousPaddingSize + anticipatedPaddingSize(),
		};

		paddingSize = GET_PADDING_SIZE_MAP[prepareToSpinOptions.spinType];

		return paddingSize;
	};

	const spin = async () => {
		isPreSpinning = false;

		await SPIN_MAP[reelState.spinType]();

		interruptible.clear();
	};

	const setSymbolsWithReelSymbols = (reelSymbols?: ReelSymbol[]) => {
		reelState.motion = 'stopped';
		placeY(homeY());
		if (reelSymbols) {
			prevSymbols = [...reelSymbols];
			targetSymbols = [...reelSymbols];
			paddingRawReel = reelOptions.initialSymbols;
			reelState.symbols = [...reelSymbols];
		}
	};

	const setSymbolsWithRawSymbols = (rawSymbols?: TRawSymbol[]) => {
		const newSymbols = rawSymbols ? createReelSymbols(rawSymbols) : undefined;
		setSymbolsWithReelSymbols(newSymbols);
	};

	const stop = () => {
		interruptible.interrupt();
	};

	const readyToSpinEffect = () => {
		// Re-home a settled reel when a REACTIVE row pitch CHANGES (e.g. the editor's
		// reelGrid cell-height/gap override loads after module init). Keyed off the
		// height VALUE alone — never `reelY.current` — so it can't fire while a spin or
		// pre-spin has deliberately parked the reel off-home. (Depending on reelY made
		// it snap the reel back to homeY mid pre-spin setup, landing the window straight
		// on the new symbols instead of sliding into them.) Inert for a static number.
		// `homedHeight` is seeded at reel creation so a change that already happened
		// before this effect was set up is still caught (see its declaration).
		$effect(() => {
			const height = getSymbolHeight();
			if (!isReactiveHeight || height === homedHeight) return;
			homedHeight = height;
			if (reelState.motion === 'stopped') placeY(homeY());
		});
		$effect(() => {
			if (reelY.current === homeY()) {
				reelState.readyToSpin();
			}
		});
	};

	return {
		// from options
		reelIndex: reelOptions.reelIndex,
		symbolHeight: getSymbolHeight(),
		onReelStopping: reelOptions.onReelStopping,
		reelLength,
		// reactive states
		reelState,
		// methods
		preSpin,
		prepareToSpin,
		spin,
		stop,
		setSymbolsWithRawSymbols,
		readyToSpinEffect,
	};
}
