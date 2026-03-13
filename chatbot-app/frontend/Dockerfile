# Multi-stage build for optimized production image
# Use AWS Public ECR to avoid Docker Hub rate limits
FROM public.ecr.aws/docker/library/node:24-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
# Configure npm with increased timeout and retry logic for better reliability
RUN npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-retries 5 && \
    npm ci

FROM public.ecr.aws/docker/library/node:24-alpine AS builder
WORKDIR /app

# Build arguments for Next.js environment variables
ARG NEXT_PUBLIC_AWS_REGION
ARG NEXT_PUBLIC_COGNITO_USER_POOL_ID
ARG NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID
ARG NEXT_PUBLIC_STREAMING_API_URL
ARG NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY
ARG NEXT_PUBLIC_DEFAULT_KEYS
ARG NEXT_PUBLIC_APP_VERSION
ARG CORS_ORIGINS

# Set environment variables for build
ENV NEXT_PUBLIC_AWS_REGION=$NEXT_PUBLIC_AWS_REGION
ENV NEXT_PUBLIC_COGNITO_USER_POOL_ID=$NEXT_PUBLIC_COGNITO_USER_POOL_ID
ENV NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=$NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID
ENV NEXT_PUBLIC_STREAMING_API_URL=$NEXT_PUBLIC_STREAMING_API_URL
ENV NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY
ENV NEXT_PUBLIC_DEFAULT_KEYS=$NEXT_PUBLIC_DEFAULT_KEYS
ENV NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION
ENV CORS_ORIGINS=$CORS_ORIGINS

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Debug: Print environment variables
RUN echo "🔍 Build-time env vars:"
RUN echo "NEXT_PUBLIC_AWS_REGION=$NEXT_PUBLIC_AWS_REGION"
RUN echo "NEXT_PUBLIC_COGNITO_USER_POOL_ID=$NEXT_PUBLIC_COGNITO_USER_POOL_ID"
RUN echo "NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=$NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID"
RUN echo "NEXT_PUBLIC_STREAMING_API_URL=$NEXT_PUBLIC_STREAMING_API_URL"
RUN echo "NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY=${NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY:0:10}..." # Only show first 10 chars for security
RUN echo "NEXT_PUBLIC_DEFAULT_KEYS=$NEXT_PUBLIC_DEFAULT_KEYS"
RUN echo "NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION"
RUN echo "CORS_ORIGINS=$CORS_ORIGINS"

RUN npm run build

# Production stage with Node.js (standalone mode)
FROM public.ecr.aws/docker/library/node:24-alpine AS runner
WORKDIR /app

# Don't run production as root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy the standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir -p .next
RUN chown nextjs:nodejs .next

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
