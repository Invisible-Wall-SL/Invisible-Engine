import { Container, Graphics, Text, type Application, type Texture, type Ticker } from 'pixi.js';

import type { ArtMount } from '../arcadeArt.svelte';
import {
	LOADING_PHRASES,
	LOADING_PHRASE_MS,
	riverNameFor,
	SALMONS_RESPAWN_CHARACTERS,
	SALMONS_SCREEN_ART,
} from '../referenceLayouts/salmonsScreens';
import {
	createWinAnimation,
	PIXEL_FONT,
	pixelButton,
	type PixelButton,
	type WinShown,
} from './winAnimation';

/**
 * SALMONS' SCREENS DRAWN IN CODE, as the original's Svelte client drew them
 * (`GuiltyForever/Salmon-` `client/src/components/*.svelte`, `client/style.css`), each in place of
 * its node on a screen the Flow shows (`referenceLayouts/salmonsScreens.ts`): the win animation,
 * the death screen (with what to respawn as, owner decision 4), the lobby's start menu and the
 * loading phrases. The runtime says what each shows (`show`), and does what their buttons ask
 * through its {@link SalmonsScreenHost}: nothing here talks to the room.
 */

/** A room of the game, as the server lists it: its id and the people in it. */
export type RiverListing = { roomId: string; players: number };

/** What the screens' buttons ask the runtime to do. */
export type SalmonsScreenHost = {
	/** Respawn the own caught player as `character`. */
	respawn: (character: string) => void;
	/** Leave for a room of the game, as `choice` (a name and a character), or as now. */
	rejoin: (choice?: { name: string; character: string }) => void;
	/** The game's rooms now, or `undefined` when the server lists none. */
	rivers: (signal: AbortSignal) => Promise<readonly RiverListing[] | undefined>;
};

export type CaughtShown = { by: string; character: string };
export type MenuShown = { name: string; character: string };

export type SalmonsScreens = {
	/** Each code-drawn part, by the node it is drawn in place of. */
	mounts: ReadonlyMap<string, ArtMount>;
	won: (shown: WinShown | undefined) => void;
	caught: (shown: CaughtShown | undefined) => void;
	/** The room refused the Respawn (the class picked is full): the death screen says so. */
	refused: () => void;
	lobby: (shown: MenuShown | undefined) => void;
	/** What each draws now (the probe's). */
	drawn: () => Record<string, unknown>;
	destroy: () => void;
};

/** Whether a container is drawn: it and every parent visible (its screen is shown). */
const onScreen = (view: Container) => {
	for (let at: Container | null = view; at; at = at.parent) if (!at.visible) return false;
	return true;
};

/** A part drawn into the node's place with its own frame clock; `tick` gets ms and the canvas
 *  size. */
function screenPart(root: Container, tick: (dtMs: number, w: number, h: number) => void) {
	let app: Application | undefined;
	const run = (ticker: Ticker) => {
		if (app) tick(Math.min(50, ticker.deltaMS), app.screen.width, app.screen.height);
	};
	const stop = () => {
		app?.ticker.remove(run);
		app = undefined;
	};
	const mount: ArtMount = (into, pixi) => {
		stop();
		app = pixi;
		into.addChild(root);
		pixi.ticker.add(run);
		return () => {
			stop();
			into.removeChild(root);
		};
	};
	return { mount, stop, app: () => app };
}

const label = (text: string, fontSize: number, fill: number) =>
	new Text({ text, style: { fontFamily: PIXEL_FONT, fontSize, fill, align: 'center' } });

const CHARACTER_NAMES: Readonly<Record<string, string>> = {
	salmon: 'Salmon',
	fisherman: 'Fisherman',
	bear: 'Bear',
};

/** One-of buttons in a row, centred on the view's place. */
function choiceRow(
	options: readonly { id: string; label: string }[],
	onPick: (id: string) => void,
	fontSize = 14,
) {
	const view = new Container();
	const gap = 16;
	const buttons = options.map((o) => ({
		id: o.id,
		button: pixelButton(o.label, () => onPick(o.id), fontSize),
	}));
	const total = buttons.reduce((sum, b) => sum + b.button.width, 0) + gap * (buttons.length - 1);
	let x = -total / 2;
	for (const { button } of buttons) {
		button.view.x = x + button.width / 2;
		x += button.width + gap;
		view.addChild(button.view);
	}
	return {
		view,
		height: Math.max(0, ...buttons.map((b) => b.button.height)),
		select: (id: string) => buttons.forEach((b) => b.button.select(b.id === id)),
		/** Each button's centre on the canvas (the probe's). */
		centres: () => Object.fromEntries(buttons.map((b) => [b.id, centreOf(b.button.view)])),
		destroy: () => view.destroy({ children: true }),
	};
}

/** Where a view's place is on the canvas, whole px. */
const centreOf = (view: Container) => {
	const at = view.toGlobal({ x: 0, y: 0 });
	return { x: Math.round(at.x), y: Math.round(at.y) };
};

const DEATH = { dim: 0.45, pulseMs: 2000 };

/**
 * The death screen (`App.svelte` `#death-screen`, `style.css`): the screen dimmed, "You have been
 * caught" pulsing in red at 44 % down, "by NAME" at 56 %, then what to respawn as (salmon,
 * fisherman or bear; the character it was, to start with) and the Respawn button.
 */
function createCaughtScreen(onRespawn: (character: string) => void) {
	const root = new Container();
	let shown: CaughtShown | undefined;
	let choice = 'salmon';
	let refused = false;
	let clock = 0;
	let size = { w: 0, h: 0 };
	let parts:
		| {
				dim: Graphics;
				glow: Text;
				title: Text;
				by: Text;
				ask: Text;
				full: Text;
				row: ReturnType<typeof choiceRow>;
				respawn: PixelButton;
		  }
		| undefined;
	const clear = () => {
		if (!parts) return;
		for (const view of [parts.dim, parts.glow, parts.title, parts.by, parts.ask, parts.full])
			view.destroy();
		parts.row.destroy();
		parts.respawn.destroy();
		parts = undefined;
	};
	const build = (now: CaughtShown, w: number, h: number) => {
		clear();
		size = { w, h };
		const dim = new Graphics().rect(0, 0, w, h).fill({ color: 0x000000, alpha: DEATH.dim });
		dim.eventMode = 'static';
		const titleStyle = {
			fontFamily: PIXEL_FONT,
			fontSize: 40,
			fill: 0xff3333,
			align: 'center' as const,
			wordWrap: true,
			wordWrapWidth: w * 0.9,
		};
		const glow = new Text({
			text: 'You have been caught',
			style: {
				...titleStyle,
				dropShadow: { color: 0xff0000, alpha: 1, blur: 20, distance: 0, angle: 0 },
			},
		});
		const title = new Text({
			text: 'You have been caught',
			style: {
				...titleStyle,
				dropShadow: {
					color: 0x000000,
					alpha: 1,
					blur: 0,
					distance: 4 * Math.SQRT2,
					angle: Math.PI / 4,
				},
			},
		});
		for (const t of [glow, title]) {
			t.anchor.set(0.5);
			t.position.set(w / 2, h * 0.44);
		}
		const by = label(`by ${now.by}`, 22, 0xffaaaa);
		by.anchor.set(0.5);
		by.position.set(w / 2, h * 0.56);
		const ask = label('Respawn as', 14, 0xffffff);
		ask.anchor.set(0.5);
		ask.position.set(w / 2, h * 0.64);
		const row = choiceRow(
			SALMONS_RESPAWN_CHARACTERS.map((id) => ({ id, label: CHARACTER_NAMES[id] })),
			(id) => {
				choice = id;
				refused = false;
				row.select(id);
			},
		);
		row.view.position.set(w / 2, h * 0.64 + 22 + row.height / 2);
		row.select(choice);
		const respawn = pixelButton('Respawn', () => {
			refused = false;
			onRespawn(choice);
		});
		respawn.view.position.set(w / 2, row.view.y + row.height / 2 + 24 + respawn.height / 2);
		const full = label('No place left for that one: pick another', 12, 0xffaaaa);
		full.anchor.set(0.5, 0);
		full.position.set(w / 2, respawn.view.y + respawn.height / 2 + 16);
		root.addChild(dim, glow, title, by, ask, row.view, respawn.view, full);
		parts = { dim, glow, title, by, ask, full, row, respawn };
	};
	const part = screenPart(root, (dtMs, w, h) => {
		clock += dtMs;
		if (!shown) return;
		if (!parts || size.w !== w || size.h !== h) build(shown, w, h);
		if (!parts) return;
		const pulse = 0.85 + 0.15 * Math.cos((clock / DEATH.pulseMs) * Math.PI * 2);
		parts.title.alpha = pulse;
		parts.glow.alpha = pulse;
		parts.full.visible = refused;
	});
	return {
		mount: part.mount,
		show: (next: CaughtShown | undefined) => {
			if (next?.by === shown?.by && next?.character === shown?.character) return;
			clear();
			shown = next;
			refused = false;
			if (next && (SALMONS_RESPAWN_CHARACTERS as readonly string[]).includes(next.character))
				choice = next.character;
		},
		refused: () => {
			refused = true;
		},
		drawn: () => ({
			shown: parts !== undefined,
			by: shown?.by ?? '',
			choice,
			refused,
			buttons: parts
				? { ...parts.row.centres(), respawn: centreOf(parts.respawn.view) }
				: undefined,
		}),
		destroy: () => {
			part.stop();
			clear();
			root.destroy({ children: true });
		},
	};
}

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
const MENU = { pollMs: 3000, retryMs: 15000, timeoutMs: 5000, popMs: 400, rows: 5 };

/** The name stored on this device from the last Join River, if any. */
const storedName = () => {
	try {
		return localStorage.getItem(NAME_KEY) ?? '';
	} catch {
		return '';
	}
};

/** A `<input>` over the canvas for the player's name (a typed field the canvas cannot be). */
function nameField(initial: string) {
	const input = document.createElement('input');
	input.type = 'text';
	input.maxLength = 40;
	input.value = initial;
	input.setAttribute('aria-label', 'Your name');
	Object.assign(input.style, {
		position: 'fixed',
		transform: 'translate(-50%, -50%)',
		width: '280px',
		padding: '8px',
		font: `14px ${PIXEL_FONT}`,
		textAlign: 'center',
		color: '#ffffff',
		background: '#1a1c2c',
		border: '3px solid #b13e53',
		borderRadius: '6px',
		zIndex: '10',
		display: 'none',
	});
	document.body.appendChild(input);
	return input;
}

/**
 * The start menu (`StartMenu.svelte`), in the lobby where the room waits for its players (owner
 * decision 1): the player's name, Salmon or Catcher and a catcher's class (Fisherman or Bear),
 * Join River (which takes the room again as that), and the live list of the game's rivers, polled
 * every 3 s and sorted by players, each named from its room id; a splash (once the player has
 * pressed something on the menu) and a pop when the count rises. A server that lists no rooms, or
 * does not answer within 5 s, shows no list and is asked again every 15 s.
 */
function createStartMenu(host: SalmonsScreenHost) {
	const root = new Container();
	let shown: MenuShown | undefined;
	let input: HTMLInputElement | undefined;
	let faction: 'salmon' | 'catcher' = 'salmon';
	let catcher = 'fisherman';
	let clock = 0;
	let polledAt = -Infinity;
	let pollMs: number = MENU.pollMs;
	let listed: readonly RiverListing[] | undefined;
	let asking: AbortController | undefined;
	let destroyed = false;
	let total: number | undefined;
	let popAt = -Infinity;
	const splash = createSplash();
	const factions = choiceRow(
		[
			{ id: 'salmon', label: '🐟 Salmon' },
			{ id: 'catcher', label: '🎣 Catcher' },
		],
		(id) => {
			splash.unlock();
			faction = id === 'catcher' ? 'catcher' : 'salmon';
			pick();
		},
	);
	const classes = choiceRow(
		[
			{ id: 'fisherman', label: 'Fisherman' },
			{ id: 'bear', label: 'Bear' },
		],
		(id) => {
			splash.unlock();
			catcher = id;
			pick();
		},
		12,
	);
	const join = pixelButton('🌊 Join River', () => {
		splash.unlock();
		const name = (input?.value.trim() || 'Guest').slice(0, 40);
		try {
			localStorage.setItem(NAME_KEY, name);
		} catch {
			// A device that keeps nothing asks for the name again next time.
		}
		const character = faction === 'salmon' ? 'salmon' : catcher;
		if (shown && (name !== shown.name || character !== shown.character))
			host.rejoin({ name, character });
	});
	const rivers = label('', 12, 0xffffff);
	rivers.anchor.set(0.5, 0);
	root.addChild(factions.view, classes.view, join.view, rivers);
	const pick = () => {
		factions.select(faction);
		classes.select(catcher);
		classes.view.visible = faction === 'catcher';
	};
	pick();
	const characterOf = (character: string) => {
		if (character === 'bear' || character === 'fisherman') {
			faction = 'catcher';
			catcher = character;
		} else faction = 'salmon';
		pick();
	};
	/** Ask for the rivers; no answer in time, or none listed, shows none and asks again later. */
	const poll = () => {
		if (asking) return;
		const ask = new AbortController();
		asking = ask;
		polledAt = clock;
		const timer = setTimeout(() => ask.abort(), MENU.timeoutMs);
		const done = (rooms: readonly RiverListing[] | undefined) => {
			clearTimeout(timer);
			if (asking === ask) asking = undefined;
			if (destroyed) return;
			pollMs = rooms ? MENU.pollMs : MENU.retryMs;
			listed = rooms && [...rooms].sort((a, b) => b.players - a.players);
			const sum = rooms?.reduce((n, r) => n + r.players, 0);
			if (sum !== undefined && total !== undefined && sum > total) {
				splash.play();
				popAt = clock;
			}
			total = sum;
			rivers.text = (listed ?? [])
				.slice(0, MENU.rows)
				.map((r) => `${r.players} players in ${riverNameFor(r.roomId)} River`)
				.join('\n');
		};
		host.rivers(ask.signal).then(done, () => done(undefined));
	};
	const part = screenPart(root, (dtMs, w, h) => {
		clock += dtMs;
		const cx = w / 2;
		const cy = h / 2;
		const visible = shown !== undefined && onScreen(root);
		root.visible = shown !== undefined;
		factions.view.position.set(cx, cy - 70);
		classes.view.position.set(cx, cy - 20);
		join.view.position.set(cx, cy + 35);
		rivers.position.set(cx, cy + 75);
		const pop = (clock - popAt) / MENU.popMs;
		rivers.scale.set(pop >= 0 && pop < 1 ? 1 + Math.sin(pop * Math.PI) * 0.15 : 1);
		const app = part.app();
		if (input && app) {
			input.style.display = visible ? 'block' : 'none';
			if (visible) {
				const box = app.canvas.getBoundingClientRect();
				const k = box.width / w || 1;
				const at = root.toGlobal({ x: cx, y: cy - 125 });
				input.style.left = `${box.left + at.x * k}px`;
				input.style.top = `${box.top + at.y * k}px`;
			}
		}
		if (visible && clock - polledAt >= pollMs) poll();
	});
	return {
		mount: (into: Container, app: Application) => {
			if (!input) {
				input = nameField(storedName() || shown?.name || 'Guest');
				input.addEventListener('pointerdown', splash.unlock);
			}
			const unmount = part.mount(into, app);
			return () => {
				unmount();
				input?.remove();
				input = undefined;
			};
		},
		show: (next: MenuShown | undefined) => {
			if (next?.name === shown?.name && next?.character === shown?.character) return;
			const first = !shown;
			shown = next;
			if (!next) {
				if (input) input.style.display = 'none';
				return;
			}
			if (first) {
				characterOf(next.character);
				if (input && !input.value) input.value = storedName() || next.name || 'Guest';
			}
		},
		drawn: () => ({
			shown: shown !== undefined,
			faction,
			catcher,
			rivers: listed === undefined ? null : listed.length,
		}),
		destroy: () => {
			destroyed = true;
			asking?.abort();
			splash.close();
			part.stop();
			input?.remove();
			input = undefined;
			factions.destroy();
			classes.destroy();
			join.destroy();
			root.destroy({ children: true });
		},
	};
}

/** The loading screen's phrase (`LoadingScreen.svelte`): a new one every 1.6 s, faded over 0.25 s. */
function createLoadingPhrases() {
	const root = new Container();
	const phrase = label('', 14, 0x9ad8ff);
	phrase.anchor.set(0.5);
	root.addChild(phrase);
	let clock = 0;
	let changedAt = -Infinity;
	let index = -1;
	const fadeMs = 250;
	const part = screenPart(root, (dtMs, w, h) => {
		clock += dtMs;
		phrase.position.set(w / 2, h * 0.72);
		if (clock - changedAt >= LOADING_PHRASE_MS) {
			changedAt = clock;
			let next = Math.floor(Math.random() * LOADING_PHRASES.length);
			if (next === index) next = (next + 1) % LOADING_PHRASES.length;
			index = next;
			phrase.text = LOADING_PHRASES[index];
		}
		const age = clock - changedAt;
		phrase.alpha = Math.min(1, age / fadeMs, (LOADING_PHRASE_MS - age) / fadeMs);
	});
	return {
		mount: part.mount,
		drawn: () => ({ phrase: phrase.text }),
		destroy: () => {
			part.stop();
			root.destroy({ children: true });
		},
	};
}

/** Salmons' code-drawn screens, the win animation's big fish in `fish`. */
export function createSalmonsScreens(
	fish: { golden: Texture; pink: Texture },
	host: SalmonsScreenHost,
): SalmonsScreens {
	const won = createWinAnimation(fish, () => host.rejoin());
	const caught = createCaughtScreen(host.respawn);
	const menu = createStartMenu(host);
	const phrases = createLoadingPhrases();
	return {
		mounts: new Map([
			[SALMONS_SCREEN_ART.won, won.mount],
			[SALMONS_SCREEN_ART.caught, caught.mount],
			[SALMONS_SCREEN_ART.menu, menu.mount],
			[SALMONS_SCREEN_ART.phrases, phrases.mount],
		]),
		won: won.show,
		caught: caught.show,
		refused: caught.refused,
		lobby: menu.show,
		drawn: () => ({
			won: won.drawn(),
			caught: caught.drawn(),
			menu: menu.drawn(),
			phrases: phrases.drawn(),
		}),
		destroy: () => {
			won.destroy();
			caught.destroy();
			menu.destroy();
			phrases.destroy();
		},
	};
}
