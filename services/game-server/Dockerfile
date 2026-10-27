# Invisible Game Server (docs/design/realtime-multiplayer.md §9). Build context = repo root (Railway
# Root Directory = repo root, Dockerfile Path = services/game-server/Dockerfile), like the other
# repo-root services.
#
# Node 22 runs the TypeScript directly (type stripping), so there is no build step. The image keeps
# the repo's layout for the three things the server reads: its own folder, the two workspace
# packages it steps and resolves configs with (`engine-mechanics`, `game-config`), and the resolve
# hook that lets Node import their extensionless TypeScript (`scripts/ts-loader.mjs`).
#
# The npm dependencies are installed with npm, so the image needs none of the rest of the pnpm
# workspace; the `workspace:*` entries npm cannot read are dropped first and the two packages are
# linked into node_modules. Node strips types only OUTSIDE node_modules, and it resolves the links
# to their real paths, as pnpm's own links do in the repo.
FROM node:22-slim

WORKDIR /app/services/game-server
COPY services/game-server/package.json ./
RUN npm pkg delete dependencies.engine-mechanics dependencies.game-config devDependencies \
	&& npm install --omit=dev --no-audit --no-fund --no-package-lock
COPY scripts/ts-loader.mjs /app/scripts/ts-loader.mjs
COPY packages/engine-mechanics/package.json packages/engine-mechanics/index.ts /app/packages/engine-mechanics/
COPY packages/engine-mechanics/src /app/packages/engine-mechanics/src
COPY packages/game-config/package.json packages/game-config/index.ts /app/packages/game-config/
COPY packages/game-config/src /app/packages/game-config/src
RUN ln -s /app/packages/engine-mechanics node_modules/engine-mechanics \
	&& ln -s /app/packages/game-config node_modules/game-config
COPY services/game-server/src ./src

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "--experimental-strip-types", "--no-warnings=ExperimentalWarning", "--import", "../../scripts/ts-loader.mjs", "src/main.ts"]
