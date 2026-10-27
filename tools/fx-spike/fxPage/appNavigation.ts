/** `$app/navigation` for the `/fx` page played outside SvelteKit (`fxPage.mjs`). */
/** The page keeps `?effect=` in the address bar; a file:// page cannot take the launcher's path. */
export const replaceState = (): void => {};
export const goto = async (url: string): Promise<void> => void (location.href = url);
export const beforeNavigate = (): void => {};
export const afterNavigate = (): void => {};
export const invalidateAll = async (): Promise<void> => {};
