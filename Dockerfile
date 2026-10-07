FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/ ./apps/
COPY sandbox/ ./sandbox/
COPY packages/ ./packages/
COPY docs/ ./docs/
COPY api/ ./api/

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

EXPOSE 8080

CMD ["node", "sandbox/server.mjs"]
