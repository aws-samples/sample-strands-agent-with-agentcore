# Multi-stage Dockerfile for S3 Iceberg MCP Server on AgentCore Runtime
# Optimized for ARM64 architecture

FROM --platform=linux/arm64 python:3.11-slim AS base

# No build arguments needed - configuration is auto-discovered at runtime via boto3

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -r mcpuser && useradd -r -g mcpuser mcpuser

# Set working directory
WORKDIR /app

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
# Note: No config files needed - auto-discovery happens at runtime
COPY mcp_server.py .

# Change ownership to non-root user
RUN chown -R mcpuser:mcpuser /app

# Switch to non-root user
USER mcpuser

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Start MCP server
CMD ["python3", "mcp_server.py"]
