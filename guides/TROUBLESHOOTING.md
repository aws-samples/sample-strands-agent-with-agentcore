# Strands Agent Chatbot

A full-stack chatbot application built with FastAPI backend and Next.js frontend, featuring AI-powered conversations using AWS Bedrock and Strands Agents framework.

## Quick Start

1. **Setup**: `./setup.sh`
2. **Start**: `./start.sh`
3. **Access**: Frontend at http://localhost:3000, Backend at http://localhost:8000

## Troubleshooting

### Backend Not Starting

**Symptoms:**
- Backend starts but immediately shuts down
- OpenTelemetry errors in logs: `Transient error StatusCode.UNAVAILABLE encountered while exporting metrics to localhost:4317`

**Solution:**
Create `backend/.env` file with OpenTelemetry configuration:

```bash
# OpenTelemetry Configuration
OTEL_PYTHON_DISTRO=opentelemetry-distro
OTEL_PYTHON_CONFIGURATOR=opentelemetry_configurator
OTEL_METRICS_EXPORTER=none
OTEL_TRACES_EXPORTER=none
OTEL_LOGS_EXPORTER=none

# Application Configuration
DEPLOYMENT_ENV=development
```

### CORS Issues

**Symptoms:**
- Frontend shows "Backend disconnected" 
- Browser console errors: `Access to fetch at 'http://localhost:8000' from origin 'http://localhost:3001' has been blocked by CORS policy`
- OPTIONS preflight requests failing

**Root Cause:**
The backend CORS configuration only allows `http://localhost:3000` by default, but the frontend might run on different ports (3001, 3002, etc.) due to port conflicts.

**Solution:**
Add multiple localhost ports to CORS configuration in `backend/.env`:

```bash
# CORS Configuration - Add all potential frontend ports
CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3002
```

**Alternative Solutions:**

1. **Force specific frontend port:**
   ```bash
   cd frontend
   PORT=3001 npx next dev
   ```

2. **Check which port frontend is using:**
   - Look for "Local: http://localhost:XXXX" in start script output
   - Ensure that port is included in CORS_ORIGINS

3. **Verify CORS headers:**
   ```bash
   curl -X OPTIONS -H "Origin: http://localhost:3001" \
        -H "Access-Control-Request-Method: POST" \
        http://localhost:8000/stream/chat -v
   ```

**Common CORS Scenarios:**

| Frontend Port | Backend CORS Setting Required |
|---------------|-------------------------------|
| 3000 | `http://localhost:3000` (default) |
| 3001 | Add `http://localhost:3001` |
| 3002 | Add `http://localhost:3002` |

### Port Conflicts

**Symptoms:**
- Warning: "Port 3000 is in use, using available port 3002 instead"
- Frontend accessible on unexpected port

**Solution:**
The start script automatically detects available ports. Update CORS configuration to include the detected port, or kill the process using the desired port:

```bash
# Find process using port 3000
lsof -ti:3000 | xargs kill -9

# Or include multiple ports in CORS config
CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3002
```

### API Endpoint Issues

**Important:** The chat endpoint is `/stream/chat`, not `/chat`. Verify frontend is calling the correct endpoint.

**Test backend connectivity:**
```bash
# Health check
curl http://localhost:8000/health

# Chat endpoint test
curl -X POST -H "Content-Type: application/json" \
     -d '{"message":"test"}' \
     http://localhost:8000/stream/chat
```

## Architecture

- **Backend**: FastAPI with Strands Agents framework
- **Frontend**: Next.js with TypeScript
- **AI**: AWS Bedrock integration
- **Communication**: Server-Sent Events (SSE) for streaming responses

## Environment Variables

### Backend (.env)
```bash
# OpenTelemetry
OTEL_METRICS_EXPORTER=none
OTEL_TRACES_EXPORTER=none
OTEL_LOGS_EXPORTER=none

# CORS
CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3002

# Application
DEPLOYMENT_ENV=development
DEBUG=false
```

### Frontend
Environment variables are automatically set by the start script based on detected backend port.

## Development

- Backend runs on port 8000
- Frontend auto-detects available port (3000, 3001, 3002, etc.)
- API documentation: http://localhost:8000/docs
- Health check: http://localhost:8000/health
