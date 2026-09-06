FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node index.html multiplayer.html styles.css game.js multiplayer.js multiplayer-engine.js room-store.js server.js service-worker.js manifest.webmanifest ./
COPY --chown=node:node icons ./icons

USER node
EXPOSE 8080

CMD ["node", "server.js"]
