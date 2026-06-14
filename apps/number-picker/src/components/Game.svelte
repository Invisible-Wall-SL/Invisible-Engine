<script lang="ts">
	  import './app.css';
		import { getContext } from '../game/context';
		import EnableGameActor from './EnableGameActor.svelte';
		import { DebugMenu } from 'components-ui-html';
		import { waitForTimeout } from 'utils-shared/wait';

		// Invisible Debug — register this game's debug tools. number-picker has no Pixi
		// board, so no `surface:'pixi'` symbol overlay is registered; the menu is still
		// mounted so future tools can register. Dynamic-imported only under the build
		// switch (docs/design/invisible-debug-framework.md).
		if (__IE_DEBUG__) {
			void import('../game/debugTools');
		}

		const context = getContext();

    type State = 'start' | 'playing' | 'won' | 'lost';

    let gameState: State = 'start';
    let isProcessing = false;
    let won = false;
    let eventDict: mainEvent | null = null;
    let winDict: winEvent | null = null;
    let targetValue: number = 10;
    let currentValue: number | null = null;

    interface mainEvent {
        index: number
        type: string,
        numberRolled: number,
        totalWin: number 
    }
    interface winEvent {
        index: number,
        type: string,
        amount: number
    }

		let flickering = false;

		const flicker = async () => {
			if(!flickering) return;

			currentValue = Math.floor(Math.random() * (10+1));
			
			await waitForTimeout(80);

			flicker();
		};

    function playGame() {
        if(isProcessing) return;

        isProcessing = true;
        gameState = 'playing';
        currentValue = null;
        eventDict = null;
        winDict = null;
        won = false;

        // let result = getResult(); // result AKA a book
				context.eventEmitter.broadcast({ type: 'bet' });

				flickering = true;
				flicker();
    }

		context.eventEmitter.subscribeOnMount({
			winInfo: ({ data }) => {
				flickering = false;

			 	eventDict = data
				currentValue = eventDict.numberRolled;
			},
			finalWin: ({ data }) => {
				winDict = data
				won = winDict.amount > 0;

				gameState = won ? 'won' : 'lost';
        isProcessing = false;
			},
		});
</script>

<EnableGameActor />

{#if gameState === 'start'}
	<h1>Number Picker</h1>
	<button class="play-style" on:click={playGame}>Play</button>
{/if}

{#if gameState == 'playing'}
	<div class="game-container">
		<div class="target box">
			<h2>Target</h2>
			<p>{targetValue}</p>
		</div>
		<div class="reveal box">
			<h2>Rolled</h2>
			<p>{currentValue !== null ? currentValue : '-'}</p>
		</div>
	</div>
{/if}

{#if gameState == 'won'}
	<div class="game-container">
		<div class="target box">
			<h2>Target</h2>
			<p>{targetValue}</p>
		</div>
		<div class="reveal box">
			<h2>Rolled</h2>
			<p>{currentValue !== null ? currentValue : '-'}</p>
		</div>
	</div>
	<h2>You Won!</h2>
	<button class="play-style" on:click={playGame}>Bet Again?</button>
{/if}

{#if gameState == 'lost'}
	<div class="game-container">
		<div class="target box">
			<h2>Target</h2>
			<p>{targetValue}</p>
		</div>
		<div class="reveal box">
			<h2>Rolled</h2>
			<p>{currentValue !== null ? currentValue : '-'}</p>
		</div>
	</div>
	<h2>You Lost</h2>
	<button class="play-style" on:click={playGame} disabled={isProcessing}> Bet Again? </button>
{/if}

<DebugMenu />
