# Invisible Director worker (ADR-0001). Build context = repo root (Railway Root Directory = repo root,
# Dockerfile Path = services/director-worker/Dockerfile), like the other repo-root services.
#
# Node 22 runs the TypeScript directly (type stripping), so there is no build step and no dist/: the
# image holds the service's own folder — source, agent definitions and pricing.json — its pinned
# npm dependencies, and the one workspace package it uses, `director-costs`.
#
# The npm dependencies are installed with npm, so the image needs none of the rest of the pnpm
# workspace; the `workspace:*` entry npm cannot read is dropped first. `director-costs` is copied to
# /packages and linked into node_modules: Node strips types only OUTSIDE node_modules, and it
# resolves the link to its real path, as pnpm's own link does in the repo.
FROM node:22-slim

WORKDIR /app
COPY services/director-worker/package.json ./
RUN npm pkg delete dependencies.director-costs \
	&& npm install --omit=dev --no-audit --no-fund --no-package-lock
COPY packages/director-costs/package.json /packages/director-costs/package.json
COPY packages/director-costs/src /packages/director-costs/src
RUN ln -s /packages/director-costs node_modules/director-costs
COPY services/director-worker/src ./src
COPY services/director-worker/agents ./agents
COPY services/director-worker/pricing.json ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "--experimental-strip-types", "--no-warnings=ExperimentalWarning", "src/main.ts"]
