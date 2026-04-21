FROM public.ecr.aws/docker/library/node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM public.ecr.aws/docker/library/node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM public.ecr.aws/docker/library/node:24-alpine AS runner
WORKDIR /app
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1
CMD ["node", "dist/index.js"]
