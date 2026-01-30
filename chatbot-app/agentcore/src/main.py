"""
Agent Core Service

Handles:
1. Strands Agent execution
2. Session management (agent pool)
3. Tool execution (MCP clients)
4. SSE streaming
"""

import os
import sys
from pathlib import Path

# Add src directory to Python path
src_path = Path(__file__).parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

# Import authentication middleware
from middleware.auth_middleware import AuthMiddleware, AuthConfig

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Filter out /ping and /health from access logs
class HealthCheckFilter(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        return '/ping' not in msg and '/health' not in msg

logging.getLogger("uvicorn.access").addFilter(HealthCheckFilter())

# Suppress verbose logging from various modules
logging.getLogger("strands.experimental.bidi").setLevel(logging.WARNING)

# Suppress detailed streaming logs (too verbose during normal operation)
# Set to DEBUG level to reduce noise; change to INFO for debugging streaming issues
logging.getLogger("streaming.event_processor").setLevel(logging.WARNING)

# Suppress Gateway MCP client detailed logs (tool listing, filtering)
logging.getLogger("agent.gateway_mcp_client").setLevel(logging.WARNING)

# Suppress Strands SDK internal logs (model calls, tool execution details)
logging.getLogger("strands.agent.agent").setLevel(logging.WARNING)
logging.getLogger("strands.tools.mcp").setLevel(logging.WARNING)

# Lifespan event handler (replaces on_event)
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("=== Agent Core Service Starting ===")
    logger.info("Agent execution engine initialized")

    # Create sessions directory for local development (FileSessionManager)
    # Workspace files are stored in S3, not local directories
    base_dir = Path(__file__).parent.parent
    sessions_dir = os.path.join(base_dir, "sessions")
    os.makedirs(sessions_dir, exist_ok=True)
    logger.info("Sessions directory ready")

    yield  # Application is running

    # Shutdown
    logger.info("=== Agent Core Service Shutting Down ===")
    # TODO: Cleanup agent pool, MCP clients, etc.

# Create FastAPI app with lifespan
app = FastAPI(
    title="Strands Agent Chatbot - Agent Core",
    version="2.0.0",
    description="Agent execution and tool orchestration service",
    lifespan=lifespan
)

# Add CORS middleware for local development
# In production (AWS), CloudFront handles routing so CORS is not needed
if os.getenv('ENVIRONMENT', 'development') == 'development':
    logger.info("Adding CORS middleware for local development")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:3000",  # Frontend dev server
            "http://localhost:3001",
            "http://127.0.0.1:3000",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Add authentication middleware
# In production, this validates headers from Lambda@Edge
# In development, it can be disabled via AUTH_REQUIRE_AUTH=false
auth_config = AuthConfig.from_env()
app.add_middleware(AuthMiddleware, config=auth_config)
logger.info(f"Authentication middleware added: require_auth={auth_config.require_auth}")

# Import routers
from routers import health, chat, gateway_tools, tools, browser_live_view, stop, voice, auth, users

# Include routers
app.include_router(health.router)
app.include_router(chat.router)
app.include_router(gateway_tools.router)
app.include_router(tools.router)
app.include_router(browser_live_view.router)
app.include_router(stop.router)
app.include_router(voice.router)  # Voice chat WebSocket
app.include_router(auth.router)   # SSO authentication endpoints
app.include_router(users.router)  # User management endpoints

if __name__ == "__main__":
    import uvicorn
    # Use '::' to listen on both IPv4 and IPv6
    # This fixes connection issues when Node.js prefers IPv6 (::1) over IPv4 (127.0.0.1)
    uvicorn.run(
        "main:app",
        host="::",
        port=8080,
        reload=True,
        log_level="info"
    )
