FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies first (layer-cached unless package.json changes)
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copy source and compile TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ──────────────────────────────────────────────
# Production image
# ──────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Copy compiled output from builder stage
COPY --from=builder /app/dist ./dist

# Install go2rtc static binary for optional LAN WebRTC/MSE camera streaming
ARG TARGETARCH
RUN apk add --no-cache curl && \
    GO2RTC_ARCH=$([ "$TARGETARCH" = "arm64" ] && echo "arm64" || echo "amd64") && \
    curl -fsSL "https://github.com/AlexxIT/go2rtc/releases/download/v1.9.4/go2rtc_linux_${GO2RTC_ARCH}" -o /usr/local/bin/go2rtc && \
    chmod +x /usr/local/bin/go2rtc && \
    apk del curl

# Copy example env for reference (actual .env is provided via env_file or volumes)
COPY .env.example .env.example

ENV NODE_ENV=production

# Run as non-root user for security
RUN mkdir -p /app/data && addgroup -S agent && adduser -S agent -G agent && chown -R agent:agent /app
USER agent

EXPOSE 8080

CMD ["node", "dist/index.js"]
