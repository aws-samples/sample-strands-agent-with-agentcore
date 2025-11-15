# Dockerfile for Agent Core - AWS Bedrock AgentCore Runtime
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install AgentCore Memory integration (cloud deployment only)
RUN pip install --no-cache-dir "bedrock-agentcore[strands-agents]>=0.1.0"

# Copy application code
COPY src/ ./src/

# Expose port (AgentCore Runtime will map this)
EXPOSE 8080

# Health check endpoint for AgentCore Runtime
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')"

# Run the FastAPI application
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8080", "--log-level", "info"]
