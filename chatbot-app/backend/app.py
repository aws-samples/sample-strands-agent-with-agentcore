from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import sys
import asyncio
import threading
import logging
# Ensure backend directory is in Python path for absolute imports
backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)
from config import Config
from agent import ChatbotAgent
from services.storage import StorageManager
from routers import chat, tools, conversation, files, mcp, model, customer, analysis, tool_events, chat_suggestions, charts, session, debug
from utils.server import start_server_with_port_management
from middleware.domain_validation import DomainValidationMiddleware

# Set up logging
logger = logging.getLogger(__name__)


# Custom exception hook to suppress OpenTelemetry context errors
def custom_excepthook(exc_type, exc_value, exc_traceback):
    """Custom exception handler to suppress OpenTelemetry context errors"""
    if exc_type is ValueError and "was created in a different Context" in str(exc_value):
        # Suppress OpenTelemetry context errors - they don't affect functionality
        return
    
    # For all other exceptions, use the default handler
    sys.__excepthook__(exc_type, exc_value, exc_traceback)

# Custom asyncio exception handler
def asyncio_exception_handler(loop, context):
    """Custom asyncio exception handler to suppress OpenTelemetry context errors"""
    exception = context.get('exception')
    if isinstance(exception, ValueError) and "was created in a different Context" in str(exception):
        # Suppress OpenTelemetry context errors
        return
    
    # For all other exceptions, use the default handler
    loop.default_exception_handler(context)

# Custom threading exception handler
def threading_excepthook(args):
    """Custom threading exception handler to suppress OpenTelemetry context errors"""
    if isinstance(args.exc_value, ValueError) and "was created in a different Context" in str(args.exc_value):
        # Suppress OpenTelemetry context errors
        return
    
    # For all other exceptions, use the default handler
    sys.__excepthook__(args.exc_type, args.exc_value, args.exc_traceback)

# Install the custom exception hooks
sys.excepthook = custom_excepthook
threading.excepthook = threading_excepthook

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    # Startup
    try:
        loop = asyncio.get_running_loop()
        loop.set_exception_handler(asyncio_exception_handler)
        
        # MCP session cleanup task - skip if not available
        print("ℹ️ MCP cleanup task initialization skipped")
        
    except RuntimeError:
        # No event loop running, skip setup
        pass
    except Exception as e:
        print(f"⚠️ Failed to start cleanup task: {e}")
    
    yield
    
    # MCP cleanup task shutdown - skip if not available
    print("ℹ️ MCP cleanup task shutdown skipped")

app = FastAPI(title="Strands Agent Chatbot API", version="1.0.0", lifespan=lifespan)

# Ensure all required directories exist
Config.ensure_directories()

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=Config.get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Session-ID"],  # Expose session ID header to frontend
)

# Domain validation middleware for embed endpoints
app.add_middleware(DomainValidationMiddleware)

# Initialize storage manager - Fixed to local storage
storage_manager = StorageManager(
    storage_type="local",
    base_path=".",
    base_url=f"http://{Config.HOST}:{Config.PORT}"
)

# Initialize session registry for session-based agent management
from session.global_session_registry import global_session_registry

# Set storage manager for routers that need it
chat.storage_manager = storage_manager
tools.storage_manager = storage_manager
conversation.storage_manager = storage_manager
files.storage_manager = storage_manager

# Mount static files for serving uploaded images
app.mount("/uploads", StaticFiles(directory=Config.UPLOAD_DIR), name="uploads")

# Mount static files for generated images
if os.path.exists(Config.GENERATED_IMAGES_DIR):
    app.mount("/generated_images", StaticFiles(directory=Config.GENERATED_IMAGES_DIR), name="generated_images")

# Mount static files for serving exported conversations
app.mount("/output", StaticFiles(directory=Config.OUTPUT_DIR), name="output")

# Mount static files for serving Python REPL execution results
repl_state_dir = os.path.join(os.getcwd(), "repl_state")
if os.path.exists(repl_state_dir):
    app.mount("/repl_state", StaticFiles(directory=repl_state_dir), name="repl_state")

# Additional mounts for /api prefix
app.mount("/api/uploads", StaticFiles(directory=Config.UPLOAD_DIR), name="api_uploads")

if os.path.exists(Config.GENERATED_IMAGES_DIR):
    app.mount("/api/generated_images", StaticFiles(directory=Config.GENERATED_IMAGES_DIR), name="api_generated_images")

app.mount("/api/output", StaticFiles(directory=Config.OUTPUT_DIR), name="api_output")

if os.path.exists(repl_state_dir):
    app.mount("/api/repl_state", StaticFiles(directory=repl_state_dir), name="api_repl_state")

# Session-specific static file mounts for isolated file access
sessions_dir = os.path.join(Config.OUTPUT_DIR, "sessions")
if os.path.exists(sessions_dir):
    app.mount("/output/sessions", StaticFiles(directory=sessions_dir), name="session_output")
    app.mount("/api/output/sessions", StaticFiles(directory=sessions_dir), name="api_session_output")

# Health endpoint - available both with and without /api prefix
@app.get("/health")
async def health_check():
    try:
        # Get registry stats instead of individual agent stats
        registry_stats = global_session_registry.get_registry_stats()
        
        return {
            "status": "healthy", 
            "registry_available": True,
            "total_sessions": registry_stats["total_sessions"],
            "total_messages": registry_stats["total_messages"]
        }
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return {
            "status": "unhealthy",
            "error": "Service unavailable"
        }

@app.get("/api/health")
async def health_check_api():
    try:
        # Get registry stats instead of individual agent stats
        registry_stats = global_session_registry.get_registry_stats()
        
        return {
            "status": "healthy", 
            "registry_available": True,
            "total_sessions": registry_stats["total_sessions"],
            "total_messages": registry_stats["total_messages"]
        }
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return {
            "status": "unhealthy",
            "error": "Service unavailable"
        }

# Include routers with environment-specific prefixes
deployment_env = os.getenv('DEPLOYMENT_ENV', 'development')

if deployment_env == 'production':
    # Cloud deployment: Add /api prefix for ALB routing
    app.include_router(chat.router, prefix="/api")
    app.include_router(tools.router, prefix="/api")
    app.include_router(conversation.router, prefix="/api")
    app.include_router(files.router, prefix="/api")
    app.include_router(mcp.router, prefix="/api")
    app.include_router(model.router, prefix="/api")
    app.include_router(customer.router, prefix="/api")
    app.include_router(analysis.router, prefix="/api")
    app.include_router(tool_events.router, prefix="/api")
    app.include_router(chat_suggestions.router, prefix="/api")
    app.include_router(charts.router, prefix="/api")
    app.include_router(session.router, prefix="/api")
    app.include_router(debug.router, prefix="/api")
else:
    # Local development: No prefix (existing behavior)
    app.include_router(chat.router)
    app.include_router(tools.router)
    app.include_router(conversation.router)
    app.include_router(files.router)
    app.include_router(mcp.router)
    app.include_router(model.router)
    app.include_router(customer.router)
    app.include_router(analysis.router)
    app.include_router(tool_events.router)
    app.include_router(chat_suggestions.router)
    app.include_router(charts.router)
    app.include_router(session.router)
    app.include_router(debug.router)

if __name__ == "__main__":
    start_server_with_port_management("app:app")
