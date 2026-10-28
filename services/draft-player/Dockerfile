# The draft-player service (ADR-0010). Build context = repo root (Railway Root Directory = repo root,
# Dockerfile Path = services/draft-player/Dockerfile): the harness libraries, the test server and the
# mock RGS modules live outside this folder and are copied in unchanged, at the same relative paths
# their imports use. No pnpm install and no node_modules: everything is plain Node 22 ESM
# (`@aws-sdk/client-s3`, which the test server imports, is loaded only in its R2 mode, never here).
FROM node:22-bookworm-slim

# The same browser CI renders with (scripts/current-games/headless-shell.sh: `playwright install
# --with-deps chromium-headless-shell`, Playwright 1.63.0), at a fixed path the service finds through
# PLAYWRIGHT_BROWSERS_PATH. Keep the version in step with that script.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx --yes playwright@1.63.0 install --with-deps chromium-headless-shell \
	&& rm -rf /var/lib/apt/lists/* /root/.npm

WORKDIR /app

# The harness's libraries and the screen scripts, as the harness has them (never edited here).
COPY scripts/current-games/lib/ ./scripts/current-games/lib/
COPY scripts/current-games/screens/ ./scripts/current-games/screens/
COPY scripts/current-games/costs.json ./scripts/current-games/costs.json
COPY scripts/playtest/headless-shell.mjs ./scripts/playtest/headless-shell.mjs
# play.mjs imports the match-3 board rules (with the package.json that makes board.js an ES module).
COPY packages/engine-mechanics/package.json ./packages/engine-mechanics/
COPY packages/engine-mechanics/src/board.js ./packages/engine-mechanics/src/
# The test server a play deals from, and the mock modules it imports as ../../scripts/…
COPY services/test-server/server.mjs services/test-server/makeMock.mjs services/test-server/openRounds.mjs services/test-server/hostSettings.mjs ./services/test-server/
COPY services/test-server/package.json ./services/test-server/
COPY scripts/mock-rgs-server.mjs scripts/mock-rgs-server-book.mjs scripts/mock-rgs-server-holdandwin.mjs scripts/mock-holdandwin-engine.mjs scripts/mock-pots-overlay.mjs scripts/mock-platform-jackpot.mjs scripts/mock-rgs-server-match3.mjs ./scripts/
# The service itself.
COPY services/draft-player/src/ ./services/draft-player/src/

ENV PORT=8080
EXPOSE 8080

# DRAFT_PLAYER_SECRET is the only setting, a Railway variable. No R2 or database credential.
CMD ["node", "services/draft-player/src/server.mjs"]
