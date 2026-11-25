import { MENU, riverRows, type RiverListing, type SalmonsScreenHost } from './screens';
import { BUTTON, PIXEL_FONT } from './winAnimation';

/**
 * SALMONS' START MENU BEFORE THE JOIN, where the original has it (`GuiltyForever/Salmon-`
 * `client/src/components/StartMenu.svelte`: Join River is what joins a room). The online runtime
 * shows it to a launch that carries no character (`apps/lines` `game/online.ts`), over the boot
 * screen, and joins a room only with its answer, so a person is never put in play as a class they
 * did not pick, and while they choose their device is in no room at all. DOM, as the original's:
 * nothing of the game is mounted before the join. It is the only place a name and a class are
 * asked for on the way in: a new room's lobby (`screens.ts`) shows who waits, and lets a person
 * change its class there, in the room it is in.
 */

/** What the player picked at Join River. */
export type StartChoice = { name: string; character: string };

export type SalmonsStartHost = {
	/** The name the launch carries, if any; else the one this device kept, else `Guest`. */
	name?: string;
	rivers: SalmonsScreenHost['rivers'];
};

/**
 * A white-noise splash through a falling low-pass (the menu's sound when the rivers fill). Its
 * audio is made on a press of the player's ({@link Splash.unlock}); until then it plays nothing.
 */
type Splash = { unlock: () => void; play: () => void; close: () => void };
function createSplash(): Splash {
	let audio: AudioContext | undefined;
	return {
		unlock: () => {
			try {
				audio ??= new AudioContext();
				if (audio.state === 'suspended') void audio.resume();
			} catch {
				// No audio on this device: the menu is the same without its splash.
			}
		},
		close: () => {
			void audio?.close().catch(() => {});
			audio = undefined;
		},
		play: () => {
			if (!audio || audio.state !== 'running') return;
			const length = Math.floor(audio.sampleRate * 0.2);
			const buffer = audio.createBuffer(1, length, audio.sampleRate);
			const data = buffer.getChannelData(0);
			for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
			const noise = audio.createBufferSource();
			noise.buffer = buffer;
			const filter = audio.createBiquadFilter();
			filter.type = 'lowpass';
			const now = audio.currentTime;
			filter.frequency.setValueAtTime(1000, now);
			filter.frequency.exponentialRampToValueAtTime(300, now + 0.2);
			const gain = audio.createGain();
			gain.gain.setValueAtTime(0.1, now);
			gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
			noise.connect(filter).connect(gain).connect(audio.destination);
			noise.start(now);
			noise.stop(now + 0.2);
		},
	};
}

const NAME_KEY = 'salmon:playerName';

/** The name stored on this device from the last Join River, if any. */
const storedName = () => {
	try {
		return localStorage.getItem(NAME_KEY) ?? '';
	} catch {
		return '';
	}
};

/** What the menu's name field joins as: trimmed, `Guest` when empty, kept on this device for the
 *  next menu (a device that keeps nothing is asked again). */
const joinName = (typed: string | undefined) => {
	const name = (typed?.trim() || 'Guest').slice(0, 40);
	try {
		localStorage.setItem(NAME_KEY, name);
	} catch {
		// Nothing kept: the next menu starts from the launch's name.
	}
	return name;
};

const css = (colour: number) => `#${colour.toString(16).padStart(6, '0')}`;

const styled = <K extends keyof HTMLElementTagNameMap>(
	tag: K,
	style: Partial<CSSStyleDeclaration>,
	text = '',
) => {
	const node = document.createElement(tag);
	Object.assign(node.style, style);
	if (text) node.textContent = text;
	return node;
};

const ROW: Partial<CSSStyleDeclaration> = {
	display: 'flex',
	flexWrap: 'wrap',
	justifyContent: 'center',
	gap: '16px',
};

/** A button in the original's style (`winAnimation.ts` `pixelButton`), as an element. */
function menuButton(label: string, fontSize: number, type: 'button' | 'submit' = 'button') {
	const button = styled(
		'button',
		{
			font: `${fontSize}px ${PIXEL_FONT}`,
			color: '#ffffff',
			background: css(BUTTON.fill),
			border: `4px solid ${css(BUTTON.stroke)}`,
			borderRadius: `${BUTTON.radius}px`,
			padding: `${BUTTON.padding}px`,
			cursor: 'pointer',
			transition: 'transform 0.1s',
		},
		label,
	);
	button.type = type;
	button.onpointerenter = () => (button.style.transform = 'scale(1.05)');
	button.onpointerleave = () => (button.style.transform = '');
	return button;
}

/** One-of buttons in a row; `select` shows the chosen one (its rim yellow, as `pixelButton`). */
function choiceRow(
	options: readonly { id: string; label: string }[],
	fontSize: number,
	onPick: (id: string) => void,
) {
	const row = styled('div', ROW);
	const buttons = options.map((option) => {
		const button = menuButton(option.label, fontSize);
		button.onclick = () => onPick(option.id);
		row.appendChild(button);
		return { id: option.id, button };
	});
	return {
		row,
		select: (id: string) => {
			for (const { id: own, button } of buttons) {
				button.style.borderColor = css(own === id ? BUTTON.selected : BUTTON.stroke);
				button.setAttribute('aria-pressed', String(own === id));
			}
		},
	};
}

/**
 * Show the start menu over the page and resolve with what the player picks at Join River: the
 * name (kept on this device for next time) and `salmon`, `fisherman` or `bear`. The river list
 * (the original's): asked every 3 s, the most players first, each named from its room id, a splash
 * and a pop when they rise; a server that lists none, or does not answer within 5 s, shows none
 * and is asked again every 15 s.
 */
export function chooseSalmonsStart(host: SalmonsStartHost): Promise<StartChoice> {
	return new Promise((resolve) => {
		let faction: 'salmon' | 'catcher' = 'salmon';
		let catcher = 'fisherman';
		let total: number | undefined;
		let asking: AbortController | undefined;
		let next: ReturnType<typeof setTimeout> | undefined;
		let closed = false;
		const splash = createSplash();

		const root = styled('div', {
			position: 'fixed',
			inset: '0',
			// Over the boot screen (`app.html` `#ie-boot`), which is back once the menu goes.
			zIndex: '100000',
			display: 'flex',
			overflow: 'auto',
			background: '#1a1c2c',
			color: '#ffffff',
			fontFamily: PIXEL_FONT,
			textAlign: 'center',
		});
		root.id = 'sm-start-menu';
		root.setAttribute('role', 'dialog');
		root.setAttribute('aria-label', 'Salmons: choose who you play and join a river');
		const form = styled('form', {
			margin: 'auto',
			padding: '16px',
			display: 'flex',
			flexDirection: 'column',
			alignItems: 'center',
			gap: '16px',
		});
		const title = styled(
			'h1',
			{ margin: '0', fontSize: 'clamp(22px, 6vw, 40px)', textShadow: '4px 4px 0 #000000' },
			'Salmons!!!',
		);
		const tagline = styled(
			'p',
			{ margin: '0', fontSize: '12px', lineHeight: '1.6' },
			'A massively multiplayer river survival game',
		);
		const input = styled('input', {
			width: '280px',
			maxWidth: '80vw',
			padding: '8px',
			font: `14px ${PIXEL_FONT}`,
			textAlign: 'center',
			color: '#ffffff',
			background: '#1a1c2c',
			border: `3px solid ${css(BUTTON.stroke)}`,
			borderRadius: '6px',
		});
		input.type = 'text';
		input.maxLength = 40;
		input.value = host.name || storedName() || 'Guest';
		input.setAttribute('aria-label', 'Your name');

		const pick = () => {
			factions.select(faction);
			classes.select(catcher);
			classes.row.style.visibility = faction === 'catcher' ? 'visible' : 'hidden';
		};
		const factions = choiceRow(
			[
				{ id: 'salmon', label: '🐟 Salmon' },
				{ id: 'catcher', label: '🎣 Catcher' },
			],
			14,
			(id) => {
				faction = id === 'catcher' ? 'catcher' : 'salmon';
				pick();
			},
		);
		const classes = choiceRow(
			[
				{ id: 'fisherman', label: 'Fisherman' },
				{ id: 'bear', label: 'Bear' },
			],
			12,
			(id) => {
				catcher = id;
				pick();
			},
		);
		pick();
		const join = menuButton('🌊 Join River', 16, 'submit');
		const rivers = styled('div', {
			minHeight: '1em',
			fontSize: '12px',
			lineHeight: '1.8',
			whiteSpace: 'pre-line',
		});
		form.append(title, tagline, input, factions.row, classes.row, join, rivers);
		root.appendChild(form);

		/** Ask for the rivers; no answer in time, or none listed, shows none and asks again later. */
		const poll = () => {
			const ask = new AbortController();
			asking = ask;
			const timeout = setTimeout(() => ask.abort(), MENU.timeoutMs);
			const done = (rooms: readonly RiverListing[] | undefined) => {
				clearTimeout(timeout);
				if (closed) return;
				const sum = rooms?.reduce((n, r) => n + r.players, 0);
				if (sum !== undefined && total !== undefined && sum > total) {
					splash.play();
					rivers.animate(
						[{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }],
						MENU.popMs,
					);
				}
				total = sum;
				rivers.textContent = riverRows([...(rooms ?? [])].sort((a, b) => b.players - a.players));
				next = setTimeout(poll, rooms ? MENU.pollMs : MENU.retryMs);
			};
			host.rivers(ask.signal).then(done, () => done(undefined));
		};

		root.addEventListener('pointerdown', splash.unlock);
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			closed = true;
			clearTimeout(next);
			asking?.abort();
			splash.close();
			root.remove();
			resolve({
				name: joinName(input.value),
				character: faction === 'salmon' ? 'salmon' : catcher,
			});
		});
		document.body.appendChild(root);
		poll();
	});
}
