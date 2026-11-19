FROM node:22-alpine AS build
WORKDIR /usr/src/app
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npm run build
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /usr/src/app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && addgroup -S app && adduser -S -u 10001 app -G app
COPY --from=build /usr/src/app/dist ./dist
USER app
CMD ["node", "dist/main.js"]
