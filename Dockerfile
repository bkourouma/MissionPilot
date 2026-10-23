# Image de production unique de MissionPilot (API Fastify + web Next.js).
# Les deux services du compose (deploy/docker-compose.prod.yml) la partagent et ne diffèrent
# que par leur commande. Le web est construit ici : `API_URL` est figée dans le manifeste de
# routes de Next (voir apps/web/next.config.mjs), donc l'API doit se trouver à cette adresse
# au moment de l'exécution (le web partage l'espace réseau du conteneur de l'API).
FROM node:22-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1 \
    CI=true

# Chromium pour les rapports PDF (CHROMIUM_PATH) ; corepack pour la version de pnpm figée
# par le champ packageManager du package.json racine.
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-liberation \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /app

# Dépendances d'abord : cette couche ne change que si un manifeste ou le verrou change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts ./scripts
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/engines/package.json packages/engines/package.json
COPY packages/shared/package.json packages/shared/package.json
# Les devDependencies restent : l'API démarre avec tsx, et le web a besoin de typescript au build.
RUN pnpm install --frozen-lockfile

COPY . .

ARG API_URL=http://127.0.0.1:4100
ENV API_URL=${API_URL}
RUN pnpm --filter @missionpilot/web build

# Stockage des fichiers téléversés : volume nommé, propriété de l'utilisateur non root.
RUN mkdir -p /data/stockage && chown -R node:node /data /app/apps/web/.next
ENV NODE_ENV=production \
    STORAGE_DIR=/data/stockage \
    CHROMIUM_PATH=/usr/bin/chromium
USER node
