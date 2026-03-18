FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY projects/core/ projects/core/
COPY projects/serve/ projects/serve/
RUN npm ci -w @megatest/core -w @megatest/serve \
    && npm run build -w @megatest/core \
    && npm run build -w @megatest/serve \
    && npm prune --production -w @megatest/core -w @megatest/serve
ENTRYPOINT ["node", "projects/serve/bin/megatest-serve.js"]
CMD ["--config", "/app/serve.config.yml"]
