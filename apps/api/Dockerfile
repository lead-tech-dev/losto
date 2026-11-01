# Image de production de l'API (Render, ou plus tard un VPS). Construite depuis la racine du dépôt :
#   docker build -f apps/api/Dockerfile -t proche-sante-api .

# ─── Construction ───
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/api --include-workspace-root
COPY apps/api apps/api
RUN npm run build -w apps/api

# ─── Exécution : dépendances de production seulement ───
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace apps/api && npm cache clean --force
COPY --from=builder /app/apps/api/dist apps/api/dist
COPY apps/api/drizzle apps/api/drizzle
WORKDIR /app/apps/api
USER node
EXPOSE 10000
# Migrations, premier admin (si SEED_ADMIN_* est renseigné), puis l'API
CMD ["npm", "run", "start:prod"]
