# Invisible Director worker (ADR-0001). Build context = repo root (Railway Root Directory = repo root,
# Dockerfile Path = services/director-worker/Dockerfile), like the other repo-root services.
#
# Node 22 runs the TypeScript directly (type stripping), so there is no build step and no dist/: the
# image holds the service's own folder — source, agent definitions and pricing.json — and its two
# runtime dependencies (`postgres`, `@anthropic-ai/sdk`), both pinned. Installed with npm because
# the service has no workspace dependencies, so it does not need the rest of the pnpm workspace in
# the image.
FROM node:22-slim

WORKDIR /app
COPY services/director-worker/package.json ./
RUN npm install --omit=dev --no-audit --no-fund --no-package-lock
COPY services/director-worker/src ./src
COPY services/director-worker/agents ./agents
COPY services/director-worker/pricing.json ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "--experimental-strip-types", "--no-warnings=ExperimentalWarning", "src/main.ts"]
