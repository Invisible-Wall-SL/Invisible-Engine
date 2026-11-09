import { EXPORTERS, exportBody } from '../../src/lib/server/exporters.ts';

/**
 * Whether `/api/editor/export/symbols` carries `field` of the symbol export's result into the body
 * the bake reads — run through the real registry entry's body, not read off its source text.
 */
export function symbolsRouteCarries(field: string): boolean {
	const symbols = EXPORTERS.find((e) => e.id === 'symbols');
	if (!symbols) return false;
	const marker = { field };
	const body = exportBody(symbols, { [field]: marker }) as Record<string, unknown>;
	return body[field] === marker;
}
