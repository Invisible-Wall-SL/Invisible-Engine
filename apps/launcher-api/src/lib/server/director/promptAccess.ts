import { clientGrantsOf, listClients } from '../clients';
import type { PromptCaller } from './prompts';

/** The caller of a saved-prompt endpoint: their client grants and the clients that exist. */
export async function promptCaller(user: {
	id: string;
	role: PromptCaller['role'];
}): Promise<PromptCaller> {
	const [grants, clients] = await Promise.all([clientGrantsOf(user.id), listClients()]);
	return { id: user.id, role: user.role, grants, clientKeys: clients.map((c) => c.key) };
}
