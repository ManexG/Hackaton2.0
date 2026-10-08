FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && mkdir -p /data && chown node:node /data
ENV NODE_ENV=production PORT=8787 DATABASE_PATH=/data/cerca.sqlite
USER node
EXPOSE 8787
CMD ["npm", "run", "server"]
