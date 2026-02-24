FROM node:20-slim

# Install build tools for better-sqlite3 native module
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy application code
COPY . .

# Create data and uploads directories
RUN mkdir -p /data uploads/blueprints

EXPOSE 3000

CMD ["node", "server.js"]
