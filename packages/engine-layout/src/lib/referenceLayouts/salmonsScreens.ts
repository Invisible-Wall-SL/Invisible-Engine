/**
 * SALMONS' SCREENS DRAWN IN CODE, by the node each is drawn in place of: the layout
 * (`./salmons.ts`) places the nodes on its screens and the Flow shows those screens; the online
 * runtime publishes the art (`engine-layout/salmons-art` `screens`) once the room's art loads.
 * Pure, so the layout, the art and the gates share one list without importing Pixi.
 *
 * The words are the original game's (`GuiltyForever/Salmon-` `client/src/components/StartMenu.svelte`,
 * `LoadingScreen.svelte`).
 */

/** The node each code-drawn screen part replaces. */
export const SALMONS_SCREEN_ART = {
	/** The win animation (round end): overlay, big fish, titles, eggs, the next-game button. */
	won: 'sm-won-art',
	/** The death screen: "You have been caught / by NAME", what to respawn as, Respawn. */
	caught: 'sm-caught-art',
	/** The lobby's note: the room's river, the people in it, who the device plays and, until round
	 *  1 starts, what else it may play. The node's id is the published layout's, from when the
	 *  start menu was drawn here (until 2026-11-20). */
	lobby: 'sm-lobby-menu',
	/** The loading screen's phrases. */
	phrases: 'sm-loading-phrases',
	/** Salmons' own backdrop (owner, 2026-11-27: "give Salmons its own loading background"): behind
	 *  every screen, the loading and tap-to-start screen above all, in place of the slot sample's
	 *  background. Not a node: the arcade runtime's backdrop draws it (`ArcadeBackdrop.svelte`), so
	 *  a layout published before it shows it too. */
	backdrop: 'sm-backdrop',
	/** The lobby's clock: the seconds to round 1, red and pulsing in the last
	 *  {@link SALMONS_CLOCK_URGENT} of them. Drawn in place of the countdown screen's seconds, a
	 *  text node every published layout has, which shows the plain number until the art is in. */
	clock: 'sm-countdown-seconds',
} as const;

/** The seconds of the lobby's clock it shows red and pulsing (owner, 2026-11-26: "blink in red
 *  with a pulse the last 10 seconds"). */
export const SALMONS_CLOCK_URGENT = 10;

/** What a caught player may respawn as (owner decision 4, 2026-11-18) and a person waiting in the
 *  lobby may change to (owner, 2026-11-25), in the order offered. */
export const SALMONS_RESPAWN_CHARACTERS = ['salmon', 'fisherman', 'bear'] as const;

/** The original's river names, hashed from a room's id. */
export const RIVER_NAMES: readonly string[] = [
	'DownTown',
	'Sucker Punch',
	'Your Mom',
	'Salty Tears',
	'Lazy Trout',
	'Wet Sock',
	'Soggy Bottom',
	'Murky Depths',
	'Old Sneaker',
	'Crusty Bait',
	'Slippery Eel',
	'Last Cast',
	'Drunken Bear',
	'Foggy Bottom',
	'Boiling Pot',
	'Mossy Rock',
	'Rusty Hook',
	'Fishstick',
	'Burnt Toast',
	'Sleepy Salmon',
	'Tipsy Trout',
	"Grandpa's Beard",
	'Backyard Pond',
	'Forgotten Sock',
	'Whiskey Falls',
	'Mystery Sauce',
	'Leaky Bucket',
	"Goblin's Gulch",
	'Cold Coffee',
	'Wonky Tonk',
];

/** A room's river name, as the original hashed it. */
export function riverNameFor(roomId: string): string {
	let h = 0;
	for (let i = 0; i < roomId.length; i++) h = (h * 31 + roomId.charCodeAt(i)) >>> 0;
	return RIVER_NAMES[h % RIVER_NAMES.length];
}

/** The loading screen's phrases, one every {@link LOADING_PHRASE_MS}. */
export const LOADING_PHRASES: readonly string[] = [
	'Placing rocks...',
	'Warming up the water...',
	'Brushing the sand...',
	'Polishing salmon scales...',
	'Teaching bears to fish...',
	'Stocking the river...',
	'Tying fishing lines...',
	'Spawning whirlpools...',
	'Painting riverbeds...',
	'Greasing the waterfall...',
	'Counting the salmons...',
	'Sharpening hooks...',
	'Combing the seaweed...',
	'Convincing fish to swim upstream...',
	'Skipping stones...',
	'Untangling nets...',
	'Negotiating with otters...',
	'Hatching tiny eggs...',
	'Filling buckets of bait...',
	'Dusting off the bridge...',
	'Briefing the fishermen...',
	'Letting the river run...',
	'Translating fish gossip...',
	'Carving fresh pebbles...',
	'Setting the current...',
	'Polishing golden scales...',
	'Tuning the splash sounds...',
	'Telling the bears to behave...',
];
export const LOADING_PHRASE_MS = 1600;
