<script lang="ts">
	import { onMount, type Snippet } from 'svelte';

	import { requestAuthenticate, requestReplay } from 'rgs-requests';
	import { getDeliveryProfile, loadDeliveryProfile } from 'delivery-profile';
	import { stateUrlDerived, stateBet, stateConfig, stateModal, stateUi } from 'state-shared';
	import { API_AMOUNT_MULTIPLIER, MOST_USED_BET_INDEXES } from 'constants-shared/bet';

	type Props = { children: Snippet };

	const props: Props = $props();

	let authenticated = $state(false);

	/** Currency declared by the launch URL (`?currency=EUR`). It WINS over the code the
	 *  RGS echoes back: the URL is the platform's own declaration of what the player is
	 *  playing in, and against the mock RGS — whose wallet is currency-agnostic and always
	 *  answers `USD` — it's the only way to preview the HUD in another currency. Empty
	 *  (no/invalid param) falls back to the RGS value, i.e. the old behaviour. */
	const launchCurrency = stateUrlDerived.currency();

	const authenticate = async () => {
		try {
			// A delivery build whose host page passed no session token gets '' from `sessionID()`
			// instead of the minted demo session an internal build falls back to. Refuse HERE, where
			// EVERY transport is gated (the RGS facade is only one of them) and where the throw is
			// already rendered by `ModalError`. A mis-wired embed has to look broken — the alternative
			// is a game playing convincingly against a session the operator never issued.
			const profile = getDeliveryProfile();
			if (profile.session.required && !stateUrlDerived.sessionID()) {
				throw {
					error: 'Missing session token',
					message:
						`This game must be launched with a session token in the ` +
						`"${profile.session.param}" query parameter (profile "${profile.id}").`,
				};
			}

			const authenticateData = await requestAuthenticate({
				rgsUrl: stateUrlDerived.rgsUrl(),
				sessionID: stateUrlDerived.sessionID(),
				language: stateUrlDerived.lang(),
			});

			// error
			if (authenticateData?.error) throw authenticateData;

			// balance
			if (authenticateData?.balance) {
				// Example of authenticateData.balance
				// {
				// 		"amount": 10000000000000000,
				// 		"currency": "USD"
				// },
				stateBet.currency = launchCurrency || authenticateData.balance.currency;
				stateBet.balanceAmount = authenticateData.balance.amount / API_AMOUNT_MULTIPLIER;
			}

			// config
			if (authenticateData?.config) {
				// Example of authenticateData.config
				// {
				// 	"gameID": "37_test-lines",
				// 	"minBet": 100000,
				// 	"maxBet": 1000000000,
				// 	"stepBet": 10000,
				// 	"defaultBetLevel": 1000000,
				// 	"betLevels": [100000, 200000, ..., 1000000000],
				// 	"betModes": {},
				// 	"jurisdiction": {
				// 			"socialCasino": false,
				// 			"disabledFullscreen": false,
				// 			"disabledTurbo": false,
				// 			"disabledSuperTurbo": false,
				// 			"disabledAutoplay": false,
				// 			"disabledSlamstop": false,
				// 			"disabledSpacebar": false,
				// 			"disabledBuyFeature": false,
				// 			"displayNetPosition": false,
				// 			"displayRTP": false,
				// 			"displaySessionTimer": false,
				// 			"minimumRoundDuration": 0
				// 	}
				// }
				stateConfig.jurisdiction = authenticateData?.config?.jurisdiction;
				stateConfig.betAmountOptions = (authenticateData.config?.betLevels || []).map(
					(level) => level / API_AMOUNT_MULTIPLIER,
				);
				stateConfig.betMenuOptions = stateConfig.betAmountOptions.filter((_, index) =>
					MOST_USED_BET_INDEXES.includes(index),
				);
			}

			// round
			if (authenticateData?.round) {
				// Example of authenticateData.round
				// {
				// 	"betID": 62277967,
				// 	"amount": 1000000,
				// 	"payout": 33400000,
				// 	"payoutMultiplier": 33.4,
				// 	"active": true,
				// 	"state": [...],
				// 	"mode": "BONUS",
				// 	"event": null
				// }

				if (authenticateData.round?.state) {
					// @ts-ignore
					stateBet.betToResume = authenticateData.round;
				}

				if (authenticateData.round?.amount) {
					const betAmountValue =
						authenticateData.round.amount > 0
							? authenticateData.round.amount / API_AMOUNT_MULTIPLIER
							: 0;
					stateBet.betAmount = betAmountValue;
					stateBet.wageredBetAmount = betAmountValue;
				}

				if (authenticateData.round?.mode) {
					stateBet.activeBetModeKey = authenticateData.round.mode;
				}
			}
		} catch (error) {
			console.error(error);
			stateModal.modal = { name: 'error', error };
		}
	};

	const handleReplay = async () => {
		stateBet.betAmount = stateUrlDerived.amount() / API_AMOUNT_MULTIPLIER || 0;
		stateBet.wageredBetAmount = stateUrlDerived.amount() / API_AMOUNT_MULTIPLIER || 0;
		stateBet.activeBetModeKey = stateUrlDerived.mode();

		const data = await requestReplay({
			rgsUrl: stateUrlDerived.rgsUrl(),
			game: stateUrlDerived.game(),
			mode: stateUrlDerived.mode(),
			version: stateUrlDerived.version(),
			event: stateUrlDerived.event(),
		});

		if (data) {
			// @ts-ignore
			stateBet.betToResume = {
				...data,
				event: '0',
				active: true,
				mode: stateUrlDerived.mode(),
			};
		}
	};

	onMount(async () => {
		// Resolve the delivery profile before ANYTHING reads `rgsUrl()`/`sessionID()`. It is awaited
		// here rather than in an app's `+layout.ts` because every app mounts <Authenticate> while only
		// `apps/lines` has a layout `load` — a game repo scaffolded by `new-game.mjs` has none, and a
		// delivery cut from one would bake a profile whose `config.json` was then never applied.
		// A build with no baked profile resolves instantly and changes nothing.
		await loadDeliveryProfile();

		// Seeded before either branch: replay never calls `authenticate`, so this is the
		// only place a replay link's currency can land.
		if (launchCurrency) stateBet.currency = launchCurrency;

		if (stateUrlDerived.replay()) {
			stateUi.config.mode = 'replay';
			await handleReplay();
		} else {
			stateUi.config.mode = 'default';
			await authenticate();
		}

		authenticated = true;
	});
</script>

{#if authenticated}
	{@render props.children()}
{/if}
