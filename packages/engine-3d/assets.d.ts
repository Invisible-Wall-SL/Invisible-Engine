/** A file the bundler emits beside the chunk, imported as its URL (`Vite` `?url`). */
declare module '*?url' {
	const url: string;
	export default url;
}
