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

# Copy example env for reference (actual .env is provided via env_file or volumes)
COPY .env.example .env.example

ENV NODE_ENV=production

# Run as non-root user for security
RUN addgroup -S agent && adduser -S agent -G agent
USER agent

CMD ["node", "dist/index.js"]
