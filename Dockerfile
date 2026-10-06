# ---------- Build: typecheck + bundle do frontend (Vite -> dist/) ----------
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

# ---------- Runtime: Express servindo dist/ + proxies (Ollama, Zen, providers) ----------
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
# arquivos gerados pelos agentes no modo tarefa (montado como volume no compose)
RUN mkdir -p workspace

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/api/health > /dev/null || exit 1

CMD ["node", "--import", "tsx", "server/index.ts"]
