// Invisible Debug — per-game tool registration (docs/design/invisible-debug-framework.md).
// number-picker is a pure-HTML game with no Pixi board / symbol grid, so no
// `surface:'pixi'` symbol overlay is registered. The framework (menu + registry) is
// still mounted via `<DebugMenu />` so future tools can register here with a single
// `registerDebugTool(...)` call. Imported only under `__IE_DEBUG__`, so this module
// tree-shakes out of a player build.
export {};
