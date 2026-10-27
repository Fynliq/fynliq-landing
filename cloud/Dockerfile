FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY gateway.mjs server.mjs ./
USER node
EXPOSE 8787
CMD ["node", "server.mjs"]
