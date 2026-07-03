FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN mkdir -p data
RUN npm prune --omit=dev
ENV NODE_ENV=production
ENV PORT=8000
EXPOSE 8000
CMD ["node", "server/index.js"]
