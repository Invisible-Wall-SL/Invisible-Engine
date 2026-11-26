import { Container, Graphics, Text, type Application, type Texture, type Ticker } from 'pixi.js';

import type { ArtMount } from '../arcadeArt.svelte';
import {
	LOADING_PHRASES,
	LOADING_PHRASE_MS,
	riverNameFor,
	SALMONS_CLOCK_URGENT,
	SALMONS_RESPAWN_CHARACTERS,
	SALMONS_SCREEN_ART,
} from '../referenceLayouts/salmonsScreens';
import {
	createWinAnimation,
	onScreen,
	PIXEL_FONT,
	pixelButton,
	type PixelButton,
	type WinShown,
} from './winAnimation';

/**
 * SALMONS' SCREENS DRAWN IN CODE, as the original's Svelte client drew them
 * (`GuiltyForever/Salmon-` `client/src/components/*.svelte`, `client/style.css`), each in place of
 * its node on a screen the Flow shows (`referenceLayouts/salmonsScreens.ts`): the win animation,
 * the death screen (with what to respawn as, owner decision 4), the lobby's note (with what to
 * play as, owner 2026-11-25), the lobby's clock and the loading phrases. The runtime says what each shows (`show`),
 * and does what their buttons ask through its {@link SalmonsScreenHost}: nothing here talks to the
 * room. The start menu is not one of them: it comes before the join, over the page
 * (`startMenu.ts`).
 */

/** A room of the game, as the server lists it: its id and the people in it. */
export type RiverListing = { roomId: string; players: number };

/** What the screens' buttons ask the runtime to do. */
export type SalmonsScreenHost = {
	/** Respawn the own caught player as `character`. */
	respawn: (character: string) => void;
	/** Ask the room to let the own player play `character` from now on (the lobby's pick). */
	pick: (character: string) => void;
	/** Leave for a new room of the game, as the player is now. */
	rejoin: () => void;
	/** The game's rooms now, or `undefined` when the server lists none. */
	rivers: (signal: AbortSignal) => Promise<readonly RiverListing[] | undefined>;
};

export type CaughtShown = { by: string; character: string };
/** The waiting room and who the device plays in it. `picking`: the room lets its people change
 *  what they play now; `refused`: the class this device last picked had no place left. */
export type LobbyShown = {
	roomId: string;
	name: string;
	character: string;
	picking: boolean;
	refused: boolean;
};

export type SalmonsScreens = {
	/** Each code-drawn part, by the node it is drawn in place of. */
	mounts: ReadonlyMap<string, ArtMount>;
	won: (shown: WinShown | undefined) => void;
	caught: (shown: CaughtShown | undefined) => void;
	/** The room refused the Respawn (the class picked is full): the death screen says so. */
	refused: () => void;
	lobby: (shown: LobbyShown | undefined) => void;
	/** The whole seconds to round 1 on the lobby's clock, `undefined` when none runs. */
	clock: (seconds: number | undefined) => void;
	/** Whether a press at a point of the canvas is given to a button a screen offers over the game
	 *  in play (the lobby's classes): that press is the screen's, not the game's. */
	takes: (x: number, y: number) => boolean;
	/** What each draws now (the probe's). */
	drawn: () => Record<string, unknown>;
	destroy: () => void;
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

/** What a person is told when the class it picked is full (the death screen, the lobby). */
const NO_PLACE = 'No place left for that one: pick another';

/** One-of buttons in a row, centred on the view's place. */
function choiceRow(
	options: readonly { id: string; label: string }[],
	onPick: (id: string) => void,
) {
	const view = new Container();
	const gap = 16;
	const buttons = options.map((o) => ({
		id: o.id,
		button: pixelButton(o.label, () => onPick(o.id), 14),
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
		width: total,
		height: Math.max(0, ...buttons.map((b) => b.button.height)),
		select: (id: string) => buttons.forEach((b) => b.button.select(b.id === id)),
		/** Whether a view is one of the buttons. */
		has: (target: Container) => buttons.some(({ button }) => button.view === target),
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
		const full = label(NO_PLACE, 12, 0xffaaaa);
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

/** How a river list is asked for and shown (the start menu's, and the lobby's own river): how often,
 *  how long after no answer, how long an answer may take, how long a risen count pops, and the most
 *  rivers listed. */
export const MENU = { pollMs: 3000, retryMs: 15000, timeoutMs: 5000, popMs: 400, rows: 5 };

/** A river list: the first {@link MENU.rows} of `sorted`, each named from its room id. */
export const riverRows = (sorted: readonly RiverListing[]) =>
	sorted
		.slice(0, MENU.rows)
		.map(
			(r) =>
				`${r.players} ${r.players === 1 ? 'player' : 'players'} in ${riverNameFor(r.roomId)} River`,
		)
		.join('\n');

/** The lobby's note: where each line's middle sits from the canvas's (px), the row's top, how far
 *  under the row the refusal's middle sits, the least margin the row and the refusal keep to the
 *  canvas's sides, and the lines' colours. */
const LOBBY = {
	riverY: -60,
	youY: -20,
	promptY: 14,
	rowY: 34,
	fullGap: 20,
	margin: 12,
	river: 0xffffff,
	you: 0xffdd57,
	full: 0xffaaaa,
};

/** A line of the lobby's note: outlined, so it reads over whatever the river shows behind it. */
const noteLine = (fontSize: number, fill: number, text = '') =>
	new Text({
		text,
		style: {
			fontFamily: PIXEL_FONT,
			fontSize,
			fill,
			align: 'center',
			stroke: { color: 0x000000, width: 4 },
		},
	});

/** Centre a line on a point of the canvas, on whole px (a line an odd number of px wide, centred
 *  by its anchor, is drawn half a px off and blurred). */
const centreLine = (line: Text, x: number, y: number) =>
	line.position.set(Math.round(x - line.width / 2), Math.round(y - line.height / 2));

/** The scale at which `width` px fit between the note's margins on a canvas `w` px wide: 1, or
 *  less on a canvas narrower than that (a phone, with the pixel font). */
const fitTo = (w: number, width: number) => Math.min(1, (w - 2 * LOBBY.margin) / width);

/**
 * The lobby's note, where a new room waits for its players, under the layout's own title: the
 * room's river with the people in it, as the start menu listed it (the server's listing, asked
 * every 3 s while the lobby shows; the count pops when it rises; a server that does not list the
 * room leaves the river's name alone and is asked again every 15 s), and who this device plays.
 * While the room lets its people change that (`picking`: until round 1 starts), a row of the
 * classes under it, the one the ROOM has the device as lit: a press asks the room at once
 * (`onPick`), and the row follows what the room answers; a pick it refused (`refused`) says so
 * under the row, in the death screen's words, until the next press. The note's lines, the row and
 * the refusal are drawn smaller on a canvas narrower than they are. Nothing here leaves the room or
 * types a name: that was the start menu's, before the join (`startMenu.ts`).
 */
function createLobbyNote(rivers: SalmonsScreenHost['rivers'], onPick: (character: string) => void) {
	const root = new Container();
	const river = noteLine(18, LOBBY.river);
	const you = noteLine(14, LOBBY.you);
	const prompt = noteLine(12, LOBBY.river, 'Play as');
	const row = choiceRow(
		SALMONS_RESPAWN_CHARACTERS.map((id) => ({ id, label: CHARACTER_NAMES[id] })),
		onPick,
	);
	const full = noteLine(12, LOBBY.full, NO_PLACE);
	const fullWidth = full.width;
	root.addChild(river, you, prompt, row.view, full);
	let shown: LobbyShown | undefined;
	let players: number | undefined;
	let clock = 0;
	let polledAt = -Infinity;
	let pollMs: number = MENU.pollMs;
	let popAt = -Infinity;
	let asking: AbortController | undefined;
	let destroyed = false;
	const write = () => {
		if (!shown) return;
		river.text =
			players === undefined
				? `${riverNameFor(shown.roomId)} River`
				: riverRows([{ roomId: shown.roomId, players }]);
		const playing = `a ${CHARACTER_NAMES[shown.character] ?? shown.character}`;
		you.text = shown.name ? `You are ${shown.name}, ${playing}` : `You are ${playing}`;
		row.select(shown.character);
	};
	/** Ask how many people the room holds; no answer in time, or the room not listed, shows none. */
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
			const now = rooms?.find((r) => r.roomId === shown?.roomId)?.players;
			pollMs = now === undefined ? MENU.retryMs : MENU.pollMs;
			if (now !== undefined && players !== undefined && now > players) popAt = clock;
			players = now;
			write();
		};
		rivers(ask.signal).then(done, () => done(undefined));
	};
	const part = screenPart(root, (dtMs, w, h) => {
		clock += dtMs;
		root.visible = shown !== undefined;
		const pop = (clock - popAt) / MENU.popMs;
		const popScale = pop >= 0 && pop < 1 ? 1 + Math.sin(pop * Math.PI) * 0.15 : 1;
		river.scale.set(fitTo(w, river.width / river.scale.x) * popScale);
		you.scale.set(fitTo(w, you.width / you.scale.x));
		centreLine(river, w / 2, h / 2 + LOBBY.riverY);
		centreLine(you, w / 2, h / 2 + LOBBY.youY);
		const picking = shown?.picking === true;
		prompt.visible = picking;
		row.view.visible = picking;
		full.visible = picking && shown?.refused === true;
		const fit = fitTo(w, row.width);
		const rowHeight = row.height * fit;
		centreLine(prompt, w / 2, h / 2 + LOBBY.promptY);
		row.view.scale.set(fit);
		row.view.position.set(Math.round(w / 2), Math.round(h / 2 + LOBBY.rowY + rowHeight / 2));
		full.scale.set(fitTo(w, fullWidth));
		centreLine(full, w / 2, h / 2 + LOBBY.rowY + rowHeight + LOBBY.fullGap);
		if (shown && onScreen(root) && clock - polledAt >= pollMs) poll();
	});
	return {
		mount: part.mount,
		show: (next: LobbyShown | undefined) => {
			if (
				next?.roomId === shown?.roomId &&
				next?.name === shown?.name &&
				next?.character === shown?.character &&
				next?.picking === shown?.picking &&
				next?.refused === shown?.refused
			)
				return;
			if (next?.roomId !== shown?.roomId) players = undefined;
			shown = next;
			write();
		},
		/** Whether Pixi gives a press at this point of the canvas to one of the classes. Its own hit
		 *  test answers (a button's rim and round corners, the row hidden or under another screen),
		 *  so what takes the press here is what gets its tap there. */
		takes: (x: number, y: number) => {
			const target = part.app()?.renderer.events.rootBoundary.hitTest(x, y);
			return !!target && row.has(target);
		},
		drawn: () => ({
			shown: shown !== undefined,
			river: shown ? river.text : '',
			you: shown ? you.text : '',
			players: players ?? null,
			...(shown?.picking
				? { choice: shown.character, refused: shown.refused, buttons: row.centres() }
				: {}),
		}),
		destroy: () => {
			destroyed = true;
			asking?.abort();
			part.stop();
			root.destroy({ children: true });
		},
	};
}

/** The lobby's clock: its middle under the canvas's (the published node's place), its size, and
 *  in its last {@link SALMONS_CLOCK_URGENT} seconds its red, how much a new second grows it and
 *  how fast that eases back, and how long of each second it is drawn faint. */
const CLOCK = {
	y: 250,
	fontSize: 36,
	fill: 0xffffff,
	urgent: 0xff3333,
	pulse: 0.45,
	pulseMs: 450,
	blinkFrom: 650,
	faint: 0.45,
};

/**
 * The lobby's clock (owner, 2026-11-26: "have the all countdown showing up, and just blink in red
 * with a pulse the last 10 seconds"): the seconds the room says are left to round 1, still and
 * white, then red, each new second growing it and easing back, drawn faint for the end of each.
 * The second's beat is the number's own change (the room's clock), timed on the frames.
 */
function createLobbyClock() {
	const root = new Container();
	const number = noteLine(CLOCK.fontSize, CLOCK.fill);
	number.anchor.set(0.5);
	root.addChild(number);
	let seconds: number | undefined;
	let clock = 0;
	let changedAt = 0;
	const urgent = () => seconds !== undefined && seconds <= SALMONS_CLOCK_URGENT;
	const part = screenPart(root, (dtMs, w, h) => {
		clock += dtMs;
		root.visible = seconds !== undefined;
		if (seconds === undefined) return;
		const age = clock - changedAt;
		const beat = Math.max(0, 1 - age / CLOCK.pulseMs);
		number.scale.set(urgent() ? 1 + CLOCK.pulse * beat * beat : 1);
		number.alpha = urgent() && age >= CLOCK.blinkFrom ? CLOCK.faint : 1;
		number.tint = urgent() ? CLOCK.urgent : CLOCK.fill;
		// On whole px at its own size (an odd width centred by its anchor is drawn half a px off).
		const width = number.width / number.scale.x;
		const height = number.height / number.scale.y;
		number.position.set(
			Math.round(w / 2 - width / 2) + width / 2,
			Math.round(h / 2 + CLOCK.y - height / 2) + height / 2,
		);
	});
	return {
		mount: part.mount,
		show: (next: number | undefined) => {
			const now = next !== undefined && next > 0 ? next : undefined;
			if (now === seconds) return;
			seconds = now;
			changedAt = clock;
			if (now !== undefined) number.text = String(now);
		},
		drawn: () => ({
			seconds: seconds ?? null,
			urgent: urgent(),
			shown: seconds !== undefined && onScreen(root),
			scale: Math.round(number.scale.x * 100) / 100,
			tint: number.tint,
		}),
		destroy: () => {
			part.stop();
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
	const lobby = createLobbyNote(host.rivers, host.pick);
	const clock = createLobbyClock();
	const phrases = createLoadingPhrases();
	return {
		mounts: new Map([
			[SALMONS_SCREEN_ART.won, won.mount],
			[SALMONS_SCREEN_ART.caught, caught.mount],
			[SALMONS_SCREEN_ART.lobby, lobby.mount],
			[SALMONS_SCREEN_ART.phrases, phrases.mount],
			[SALMONS_SCREEN_ART.clock, clock.mount],
		]),
		won: won.show,
		caught: caught.show,
		refused: caught.refused,
		lobby: lobby.show,
		clock: clock.show,
		takes: lobby.takes,
		drawn: () => ({
			won: won.drawn(),
			caught: caught.drawn(),
			lobby: lobby.drawn(),
			clock: clock.drawn(),
			phrases: phrases.drawn(),
		}),
		destroy: () => {
			won.destroy();
			caught.destroy();
			lobby.destroy();
			clock.destroy();
			phrases.destroy();
		},
	};
}
