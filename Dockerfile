# Libar Zendesk Bot v2 — Production Docker Image
# Skill §16 — Deployment & Containerization

FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

FROM node:20-slim AS runner

WORKDIR /app

# Create non-root user for security
RUN groupadd -r bot && useradd -r -g bot bot

# Copy dependencies and app files
COPY --from=builder /app/node_modules ./node_modules
COPY --chown=bot:bot . .

USER bot

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

CMD ["node", "index.js"]
