# build stage
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web ./web
COPY src ./src
RUN npm run build

# runtime stage
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=9990 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/web/dist ./web/dist
COPY src ./src

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 9990

CMD ["node", "src/server.js"]
