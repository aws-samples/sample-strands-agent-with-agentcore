import logging
import time
import asyncio
from typing import Dict, Optional, List, Any
from threading import Lock

from strands.tools.mcp import MCPClient

logger = logging.getLogger(__name__)

class MCPSessionManager:
    """Session-aware MCP client manager using Strands SDK"""
    
    def __init__(self):
        # Session-based client management
        self.session_clients = {}          # backend_session_id -> {server_id: MCPClient}
        self.session_contexts = {}         # backend_session_id -> [context_managers]
        self.session_metadata = {}         # backend_session_id -> metadata
        
        # Client state management for suspend/resume
        self.client_states = {}            # backend_session_id -> {server_id: 'active'|'suspended'}
        self.suspended_tools = {}          # backend_session_id -> {server_id: [tools]}
        
        # Concurrency control
        self._lock = Lock()
        
        # Cleanup settings - optimized for better resource management
        self.cleanup_interval = 120        # 2 minutes (more frequent)
        self.session_timeout = 300         # 5 minutes (efficient timeout)
        self.cleanup_task_running = False
    
    def get_tools_for_session(self, backend_session_id: str, enabled_servers: List[Dict[str, Any]]) -> List[Any]:
        """Get MCP tools for a specific backend session with dynamic suspend/resume"""
        with self._lock:
            try:
                # Get currently enabled server IDs
                current_enabled = {s["id"] for s in enabled_servers}
                
                # Get existing clients and states
                existing_clients = self.session_clients.get(backend_session_id, {})
                client_states = self.client_states.get(backend_session_id, {})
                
                session_tools = []
                
                # Process existing clients
                for server_id, client in existing_clients.items():
                    if server_id in current_enabled:
                        # Server should be active
                        if client_states.get(server_id) == 'suspended':
                            # Resume suspended client
                            tools = self._resume_client(backend_session_id, server_id)
                            session_tools.extend(tools)
                        else:
                            # Already active client
                            try:
                                tools = client.list_tools_sync()
                                session_tools.extend(tools)
                                logger.info(f"✓ Loaded {len(tools)} tools from {server_id} (active)")
                            except Exception as e:
                                logger.warning(f"✗ Failed to get tools from {server_id}: {e}")
                    else:
                        # Server should be suspended
                        if client_states.get(server_id) == 'active':
                            self._suspend_client(backend_session_id, server_id)
                
                # Create new clients for new servers
                for server_config in enabled_servers:
                    server_id = server_config["id"]
                    if server_id not in existing_clients:
                        client = self._create_and_activate_client(backend_session_id, server_config)
                        if client:
                            try:
                                tools = client.list_tools_sync()
                                session_tools.extend(tools)
                                logger.info(f"✓ Loaded {len(tools)} tools from {server_id} (new)")
                            except Exception as e:
                                logger.warning(f"✗ Failed to get tools from new {server_id}: {e}")
                
                # Update session metadata
                self._update_session_metadata(backend_session_id)
                
                logger.info(f"Session {backend_session_id}: {len(session_tools)} MCP tools available")
                return session_tools
                
            except Exception as e:
                logger.error(f"❌ Failed to get tools for session {backend_session_id}: {e}")
                return []
    
    def _create_mcp_client(self, server_config: Dict[str, Any]) -> MCPClient:
        """Create MCPClient using existing unified_tool_manager logic"""
        # Import here to avoid circular import
        from unified_tool_manager import UnifiedToolManager
        temp_manager = UnifiedToolManager()
        return temp_manager._create_mcp_client(server_config)
    
    def _suspend_client(self, backend_session_id: str, server_id: str):
        """Suspend MCP client (keep connection, hide tools)"""
        try:
            client = self.session_clients[backend_session_id][server_id]
            
            # Backup current tools
            tools = client.list_tools_sync()
            if backend_session_id not in self.suspended_tools:
                self.suspended_tools[backend_session_id] = {}
            self.suspended_tools[backend_session_id][server_id] = tools
            
            # Update state to suspended
            if backend_session_id not in self.client_states:
                self.client_states[backend_session_id] = {}
            self.client_states[backend_session_id][server_id] = 'suspended'
            
            logger.info(f"⏸️ Suspended MCP client {server_id} for session {backend_session_id} ({len(tools)} tools)")
            
        except Exception as e:
            logger.error(f"❌ Failed to suspend client {server_id}: {e}")
    
    def _resume_client(self, backend_session_id: str, server_id: str) -> List[Any]:
        """Resume suspended MCP client"""
        try:
            # Update state to active
            self.client_states[backend_session_id][server_id] = 'active'
            
            # Get fresh tools (connection was maintained)
            client = self.session_clients[backend_session_id][server_id]
            tools = client.list_tools_sync()
            
            logger.info(f"▶️ Resumed MCP client {server_id} for session {backend_session_id} ({len(tools)} tools)")
            return tools
            
        except Exception as e:
            logger.error(f"❌ Failed to resume client {server_id}: {e}")
            # Fallback to cached tools if available
            if (backend_session_id in self.suspended_tools and 
                server_id in self.suspended_tools[backend_session_id]):
                cached_tools = self.suspended_tools[backend_session_id][server_id]
                logger.info(f"▶️ Resumed {server_id} using cached tools ({len(cached_tools)} tools)")
                return cached_tools
            return []
    
    def _create_and_activate_client(self, backend_session_id: str, server_config: Dict[str, Any]) -> Optional:
        """Create new MCP client and activate it"""
        server_id = server_config["id"]
        
        try:
            client = self._create_mcp_client(server_config)
            client_context = client.__enter__()
            
            # Initialize session storage if needed
            if backend_session_id not in self.session_clients:
                self.session_clients[backend_session_id] = {}
                self.session_contexts[backend_session_id] = []
                self.client_states[backend_session_id] = {}
            
            # Register client
            self.session_clients[backend_session_id][server_id] = client_context
            self.session_contexts[backend_session_id].append(client)
            self.client_states[backend_session_id][server_id] = 'active'
            
            logger.info(f"✅ Created and activated MCP client {server_id} for session {backend_session_id}")
            return client_context
            
        except Exception as e:
            logger.error(f"❌ Failed to create client {server_id}: {e}")
            return None
    
    def _update_session_metadata(self, backend_session_id: str):
        """Update session last used time"""
        if backend_session_id in self.session_metadata:
            self.session_metadata[backend_session_id]["last_used"] = time.time()
    
    def cleanup_session(self, backend_session_id: str):
        """Clean up session and all associated MCP clients"""
        with self._lock:
            try:
                if backend_session_id in self.session_contexts:
                    # Close all context managers (SDK handles cleanup)
                    for client in self.session_contexts[backend_session_id]:
                        try:
                            client.__exit__(None, None, None)
                        except Exception as e:
                            logger.warning(f"Error closing MCP client: {e}")
                    
                    # Clean up tracking data
                    del self.session_contexts[backend_session_id]
                
                if backend_session_id in self.session_clients:
                    del self.session_clients[backend_session_id]
                
                if backend_session_id in self.session_metadata:
                    del self.session_metadata[backend_session_id]
                
                # Clean up new state management data
                if backend_session_id in self.client_states:
                    del self.client_states[backend_session_id]
                
                if backend_session_id in self.suspended_tools:
                    del self.suspended_tools[backend_session_id]
                
                logger.info(f"🧹 Cleaned up session: {backend_session_id}")
                
            except Exception as e:
                logger.error(f"❌ Failed to cleanup session {backend_session_id}: {e}")
    
    async def start_cleanup_task(self):
        """Start background cleanup task"""
        if self.cleanup_task_running:
            return
            
        self.cleanup_task_running = True
        logger.info("🚀 Starting MCP session cleanup task")
        
        try:
            while self.cleanup_task_running:
                await asyncio.sleep(self.cleanup_interval)
                await self._cleanup_expired_sessions()
        except Exception as e:
            logger.error(f"❌ Cleanup task error: {e}")
        finally:
            self.cleanup_task_running = False
    
    async def _cleanup_expired_sessions(self):
        """Clean up expired sessions"""
        try:
            current_time = time.time()
            expired_sessions = []
            
            with self._lock:
                for backend_session_id, metadata in self.session_metadata.items():
                    if current_time - metadata["last_used"] > self.session_timeout:
                        expired_sessions.append(backend_session_id)
            
            for session_id in expired_sessions:
                logger.info(f"🕐 Cleaning up expired session: {session_id}")
                self.cleanup_session(session_id)
                
            if expired_sessions:
                logger.info(f"🧹 Cleaned up {len(expired_sessions)} expired sessions")
                
        except Exception as e:
            logger.error(f"❌ Failed to cleanup expired sessions: {e}")
    
    def stop_cleanup_task(self):
        """Stop cleanup task"""
        self.cleanup_task_running = False
        logger.info("🛑 Stopping MCP session cleanup task")
    
    def get_session_stats(self) -> Dict[str, Any]:
        """Get session statistics"""
        with self._lock:
            return {
                "backend_sessions": len(self.session_metadata),
                "total_clients": sum(len(clients) for clients in self.session_clients.values()),
                "cleanup_running": self.cleanup_task_running
            }
    
