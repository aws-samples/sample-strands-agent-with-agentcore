# Research Agent A2A Server - AgentCore Runtime Container
# Base: Python 3.13 slim
# Architecture: ARM64 (AgentCore Runtime default)

FROM public.ecr.aws/docker/library/python:3.13-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY src/ ./src/

# Expose port 9000 (A2A protocol requires port 9000)
EXPOSE 9000

# Health check endpoint for AgentCore Runtime
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:9000/ping')"

# Run the FastAPI A2A server
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "9000", "--log-level", "info"]
