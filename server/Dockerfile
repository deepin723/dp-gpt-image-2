FROM node:20-slim

# Install system deps for Cursor CLI (glibc binary, needs curl + bash)
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates bash \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Cursor CLI; symlink to /usr/local/bin so PATH is guaranteed
RUN curl https://cursor.com/install -fsS | bash \
 && ln -sf /root/.local/bin/agent /usr/local/bin/agent

ENV PATH="/usr/local/bin:/root/.local/bin:${PATH}"

# Build-time gate: fail loudly if agent isn't callable
RUN agent --version

COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
