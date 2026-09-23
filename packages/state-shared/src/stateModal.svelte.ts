type ModalEmpty = null;

type ModalError = {
	name: 'error';
	error: any;
};

type ModalBetMenu = {
	name: 'betAmountMenu';
};

type ModalBuyBonus = {
	name: 'buyBonus';
};

type ModalBuyBonusConfirm = {
	name: 'buyBonusConfirm';
};

type ModalAutoSpin = {
	name: 'autoSpin';
};

type ModalAutoSpinMessage = {
	name: 'autoSpinMessage';
	message: 'insufficientFunds' | 'lossLimitReached' | 'singleWinLimitReached';
};

type ModalPayTable = {
	name: 'payTable';
};

type ModalGameRules = {
	name: 'gameRules';
};

type ModalSettings = {
	name: 'settings';
};

type Modal =
	| ModalEmpty
	| ModalError
	| ModalBetMenu
	| ModalBuyBonus
	| ModalBuyBonusConfirm
	| ModalAutoSpin
	| ModalAutoSpinMessage
	| ModalPayTable
	| ModalGameRules
	| ModalSettings;

export const stateModal = $state({
	modal: null as Modal,
});

/** Open the coded bet-amount menu — the one body behind the HUD bet readout's press, the registered
 *  `betMenu` action, and the flow's `openBetMenu` command, so the three can't drift. */
export const openBetMenu = (): void => {
	stateModal.modal = { name: 'betAmountMenu' };
};

/** Close whatever coded modal is open. Inert when none is. */
export const closeModal = (): void => {
	stateModal.modal = null;
};
