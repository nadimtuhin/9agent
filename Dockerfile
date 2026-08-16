FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install && npm run build
# Deliberately NOT a model the mock router serves: if anything falls back to the
# cache, --print-only output shows a wrong model id instead of quietly passing.
RUN mkdir -p ~/.config/9agent && echo '[{"id":"stale/never-use-me","owned_by":"stale"}]' > ~/.config/9agent/models.json
ENTRYPOINT ["node", "dist/index.js"]
