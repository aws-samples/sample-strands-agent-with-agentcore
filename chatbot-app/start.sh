#!/bin/bash

echo "Starting Agent Chatbot Template..."

# Check if frontend dependencies are installed
if [ ! -d "frontend/node_modules" ] || [ ! -f "frontend/node_modules/lucide-react/package.json" ]; then
    echo "WARNING: Frontend dependencies not found. Please run setup first:"
    echo "  ./setup.sh"
    exit 1
fi

# Function to cleanup background processes
cleanup() {
    echo ""
    echo "Shutting down services..."
    if [ ! -z "$AGENTCORE_PID" ]; then
        kill $AGENTCORE_PID 2>/dev/null
        sleep 1
        # Force kill if still running
        kill -9 $AGENTCORE_PID 2>/dev/null || true
    fi
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null
        sleep 1
        kill -9 $FRONTEND_PID 2>/dev/null || true
    fi
    # Also clean up any remaining processes on ports
    lsof -ti:8080 2>/dev/null | xargs kill -9 2>/dev/null || true
    lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null || true
    # Clean up log file
    if [ -f "agentcore.log" ]; then
        rm agentcore.log
    fi
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

echo "Starting AgentCore Runtime server..."

# Clean up any existing AgentCore and frontend processes
echo "Checking for existing processes on ports 8080 and 3000..."
if lsof -Pi :8080 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "Killing process on port 8080..."
    lsof -ti:8080 | xargs kill -9 2>/dev/null || true
fi
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "Killing process on port 3000..."
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
fi
# Wait for OS to release ports
if lsof -Pi :8080 -sTCP:LISTEN -t >/dev/null 2>&1 || lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "Waiting for ports to be released..."
    sleep 2
fi
echo "Ports cleared successfully"

# Get absolute path to project root and master .env file
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MASTER_ENV_FILE="$PROJECT_ROOT/agent-blueprint/.env"
CHATBOT_APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd agentcore
source venv/bin/activate

# Load environment variables from master .env file
if [ -f "$MASTER_ENV_FILE" ]; then
    echo "Loading environment variables from: $MASTER_ENV_FILE"
    set -a
    source "$MASTER_ENV_FILE"
    set +a
    echo "Environment variables loaded"
else
    echo "WARNING: Master .env file not found at $MASTER_ENV_FILE, using defaults"
    echo "Setting up local development defaults..."
fi

# Start AgentCore Runtime (port 8080)
cd src
env $(grep -v '^#' "$MASTER_ENV_FILE" 2>/dev/null | xargs) ../venv/bin/python main.py > "$CHATBOT_APP_ROOT/agentcore.log" 2>&1 &
AGENTCORE_PID=$!

# Wait for AgentCore to start
sleep 3

echo "AgentCore Runtime is running on port: 8080"

# Update environment variable for frontend
export NEXT_PUBLIC_AGENTCORE_URL="http://localhost:8080"

echo "Starting frontend server..."
cd "$CHATBOT_APP_ROOT/frontend"
# Unset PORT to let Next.js use default port 3000
unset PORT
NODE_NO_WARNINGS=1 npx next dev &
FRONTEND_PID=$!

echo ""
echo "Services started successfully!"
echo ""
echo "Frontend: http://localhost:3000"
echo "AgentCore Runtime: http://localhost:8080"
echo "API Docs: http://localhost:8080/docs"
echo ""
echo "Embedding Test Pages:"
echo "  - Interactive Examples: http://localhost:3000/embed-example.html"
echo "  - Local Test Page: file://$(pwd)/test-embedding-local.html"
echo "  - Auth Testing: http://localhost:3000/iframe-test.html"
echo ""
echo "Embed URL: http://localhost:3000/embed"
echo ""
echo "Frontend is configured to use AgentCore at: http://localhost:8080"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for background processes
wait
