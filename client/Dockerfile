FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
COPY shared/package.json ./shared/package.json
RUN npm ci
COPY tsconfig.json ./
COPY client ./client
COPY shared ./shared
WORKDIR /app/client
EXPOSE 3000
CMD ["npm", "run", "dev"]
