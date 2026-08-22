FROM node:24-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile

COPY . .

ENV HOST=0.0.0.0
ENV PORT=3002

EXPOSE 3002

CMD ["node", "server.js"]
