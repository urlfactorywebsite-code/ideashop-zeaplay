# Frontend: React + Vite + Nginx

# Build stage
FROM node:18-alpine AS build

ARG VITE_API_BASE_URL
ARG VITE_API_URL
ARG VITE_PRESENCE_URL
ARG VITE_WS_URL
ARG VITE_TICKET_CHAT_WS_URL
ARG VITE_CHAT_URL

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_API_URL=$VITE_API_URL \
    VITE_PRESENCE_URL=$VITE_PRESENCE_URL \
    VITE_WS_URL=$VITE_WS_URL \
    VITE_TICKET_CHAT_WS_URL=$VITE_TICKET_CHAT_WS_URL \
    VITE_CHAT_URL=$VITE_CHAT_URL

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the app
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built app from build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Runtime config injection for presence URL
COPY docker-entrypoint.d/99-runtime-config.sh /docker-entrypoint.d/99-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/99-runtime-config.sh

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
