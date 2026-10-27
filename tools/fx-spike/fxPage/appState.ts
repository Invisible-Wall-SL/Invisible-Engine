/** `$app/state` for the `/fx` page played outside SvelteKit (`fxPage.mjs`). */
export const page = {
	get url(): URL {
		return new URL(location.href);
	},
	params: {},
	data: {},
};
