FROM node:18-alpine

RUN apk add --no-cache git tini curl

WORKDIR /app

# Clone NeteaseCloudMusicApiEnhanced
# Source: https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced
RUN git clone --depth 1 https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced.git
WORKDIR /app/api-enhanced
RUN npm install --production

# Install frontend dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --production

# Copy frontend source
COPY server.js .
COPY public/ ./public/
COPY start.sh .
RUN chmod +x start.sh

# Create data volume directory
RUN mkdir -p /app/data

EXPOSE 3000 8080

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["./start.sh"]
