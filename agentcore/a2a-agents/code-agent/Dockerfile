# Code Agent A2A Server - AgentCore Runtime Container
# Architecture: ARM64 (AgentCore Runtime default)

FROM public.ecr.aws/docker/library/python:3.13-slim

WORKDIR /app

# Install system dependencies + Node.js
# git is required for Claude Agent SDK's Bash tool (git operations)
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    ca-certificates \
    git \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY src/ ./src/

# Create non-root user (required: claude CLI refuses --dangerously-skip-permissions as root)
RUN useradd -m -u 1000 -s /bin/bash agent

# Workspace directory for per-session file operations
RUN mkdir -p /tmp/workspaces && chown -R agent:agent /tmp/workspaces && chown -R agent:agent /app

USER agent

# Expose port 9000 (A2A protocol)
EXPOSE 9000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:9000/ping')"

# Run the A2A server
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "9000", "--log-level", "info"]
