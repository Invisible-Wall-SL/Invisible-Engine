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
	/** The lobby's start menu: name, faction and class, Join River, the live river list. */
	menu: 'sm-lobby-menu',
	/** The loading screen's phrases. */
	phrases: 'sm-loading-phrases',
} as const;

/** What a caught player may respawn as (owner decision 4, 2026-11-18), in the order offered. */
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
