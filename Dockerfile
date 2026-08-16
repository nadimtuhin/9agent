FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install && npm run build
RUN mkdir -p ~/.config/9agent && echo '[{"id":"mock/claude-sonnet-4-6","owned_by":"mock"}]' > ~/.config/9agent/models.json
ENTRYPOINT ["node", "dist/index.js"]
