FROM node:20-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates bash \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Cursor CLI (provides the `agent` command)
RUN curl https://cursor.com/install -fsS | bash \
 && ln -sf /root/.local/bin/agent /usr/local/bin/agent

ENV PATH="/usr/local/bin:/root/.local/bin:${PATH}"

# Fail build if agent isn't callable
RUN agent --version

COPY server/package*.json ./
RUN npm ci --only=production
COPY server/ ./
EXPOSE 3000
CMD ["node", "index.js"]
