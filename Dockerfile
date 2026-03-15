FROM node:22-slim
WORKDIR /app
COPY cli/ cli/
RUN cd cli && npm ci && npm run build && npm prune --production
ENTRYPOINT ["node", "cli/bin/megatest.js"]
CMD ["serve", "--config", "/app/serve.config.yml"]
