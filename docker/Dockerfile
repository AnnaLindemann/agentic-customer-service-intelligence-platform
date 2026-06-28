# Phase 1 backend image.
#
# Builds the TypeScript application and runs the Express server. Kept intentionally
# minimal; later phases extend the application, not the build shape.

FROM node:20-alpine

WORKDIR /app

# Install dependencies first so Docker can cache this layer independently of source.
COPY package.json package-lock.json ./
RUN npm ci

# Build the TypeScript sources to dist/.
COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
