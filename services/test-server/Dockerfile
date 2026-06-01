# Build context = repo root (Railway Root Directory = repo root, Dockerfile Path
# = services/test-server/Dockerfile) so the shared mock RGS modules under
# scripts/ can be COPY'd in — server.mjs imports them via ../../scripts/.
FROM node:22-slim

WORKDIR /app

# App code + the shared mock modules (imported as ../../scripts/...).
COPY services/test-server/ ./services/test-server/
COPY scripts/mock-rgs-server.mjs scripts/mock-rgs-server-book.mjs ./scripts/

# Install the service's own deps (not a pnpm workspace member — standalone).
RUN cd services/test-server && npm install --omit=dev --no-audit --no-fund

ENV PORT=8080
EXPOSE 8080

CMD ["node", "services/test-server/server.mjs"]
