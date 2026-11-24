import { mechanicFor } from 'engine-game/src/game/mechanic';
import type { GameConfigDoc } from 'game-config';
import { ENV } from './env';
import { loadGameConfigDoc } from './gameConfigStorage';
import { publishedGameConfig } from './gameServerConfig';
import { gameServerLink } from './onlineLaunch';
import { clientKeyOf } from './projectLookup';

type Card = { url: string; projectKey: string | null };

type ProjectRooms = { config: GameConfigDoc | null; published: boolean };

async function projectRooms(projectKey: string): Promise<ProjectRooms> {
	const config = await loadGameConfigDoc(await clientKeyOf(projectKey), projectKey);
	if (!mechanicFor(config).room) return { config, published: false };
	const published = await publishedGameConfig(projectKey);
	return { config, published: published.found && Boolean(mechanicFor(published.doc).room) };
}

/**
 * Game cards with the link a person is handed: an online game's carries the game server address
 * (`gameServerLink`), built here at display so a card stored before it (a desktop standalone build
 * registers its own URL) works too, and `launchRefusal` says why one cannot be played instead.
 * Every other card is returned exactly as stored. A project whose config cannot be read keeps its
 * stored link: the boot then reports what it lacks on its own error screen.
 */
export async function withGameServerLinks<T extends Card>(
	cards: readonly T[],
): Promise<(T & { launchRefusal: string | null })[]> {
	const rooms = new Map<string, Promise<ProjectRooms | null>>();
	const roomsOf = (projectKey: string) => {
		let found = rooms.get(projectKey);
		if (!found) {
			found = projectRooms(projectKey).catch((e) => {
				console.warn(`[game links] ${projectKey}: config unreadable — ${String(e)}`);
				return null;
			});
			rooms.set(projectKey, found);
		}
		return found;
	};
	return Promise.all(
		cards.map(async (card) => {
			const project = card.projectKey ? await roomsOf(card.projectKey) : null;
			if (!project) return { ...card, launchRefusal: null };
			const link = gameServerLink(
				card.url,
				project.config,
				card.projectKey,
				project.published,
				ENV.GAME_SERVER_URL,
			);
			return { ...card, url: link.url, launchRefusal: link.refusal };
		}),
	);
}
