FROM node:20 AS builder

WORKDIR /app

# Install deps first (cached layer)
COPY package.json package-lock.json ./
RUN npm install

# Copy source
COPY . .

# Build with backend URL for rewrites
ARG BACKEND_URL=http://backend:8000
ENV BACKEND_URL=$BACKEND_URL
RUN npm run build

# --- Production stage ---
FROM node:20-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

# Copy only what's needed to run
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/tsconfig.json ./

# Next.js rewrites need BACKEND_URL at runtime too
ARG BACKEND_URL=http://backend:8000
ENV BACKEND_URL=$BACKEND_URL

EXPOSE 3000

CMD ["node", "node_modules/.bin/next", "start", "-p", "3000"]
