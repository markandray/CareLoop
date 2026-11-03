FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY shared/package.json ./shared/package.json
RUN npm ci
COPY tsconfig.json ./
COPY server ./server
COPY shared ./shared
WORKDIR /app/server
EXPOSE 4000
CMD ["npm", "run", "dev"]
