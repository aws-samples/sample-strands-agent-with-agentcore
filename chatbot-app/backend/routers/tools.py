from fastapi import APIRouter, HTTPException, Header, Response
from typing import Optional
from pydantic import BaseModel
import asyncio
import aiohttp
from urllib.parse import urlparse
import time
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tools", tags=["tools"])

# Cache for MCP URL status checks (avoid checking same URL too frequently)
_mcp_status_cache = {}
_cache_duration = 60  # Cache for 1 minute


# Import session registry
from session.global_session_registry import global_session_registry

class AddMcpServerRequest(BaseModel):
    id: str
    name: str
    description: str
    type: str
    config: dict
    category: str
    icon: str
    enabled: bool = False

def is_safe_url(url: str) -> bool:
    """Check if URL is safe from SSRF attacks"""
    import ipaddress
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname
        
        if not hostname:
            return False
            
        # Only allow HTTPS and specific domains
        if parsed.scheme not in ['https']:
            return False
            
        # Allowlist of safe domains for MCP endpoints
        allowed_domains = [
            'execute-api.us-west-2.amazonaws.com',
            'execute-api.us-east-1.amazonaws.com', 
            'execute-api.eu-west-1.amazonaws.com',
            'execute-api.ap-northeast-2.amazonaws.com'
        ]
        
        # Check if hostname is in allowlist
        if not any(hostname.endswith(domain) for domain in allowed_domains):
            return False
            
        # Additional IP-based checks for bypasses
        try:
            ip = ipaddress.ip_address(hostname)
            # Block all private/reserved ranges
            if ip.is_private or ip.is_loopback or ip.is_reserved:
                return False
        except ValueError:
            # Not an IP address, continue with hostname validation
            pass
            
        return True
    except Exception:
        return False

async def check_mcp_url_validity(url: str) -> str:
    """Check if MCP URL is valid and reachable
    Returns: 'connected', 'disconnected', or 'invalid'
    """
    print(f"🔍 MCP URL validation started for: {url}")
    if not url or url == "https://{your-mcp-endpoint}/mcp":
        print(f"🔍 MCP URL validation - Empty or placeholder URL: {url}")
        return 'invalid'
    
    # Parameter Store URLs are always considered valid
    if url.startswith("ssm://"):
        # Cache Parameter Store URLs as valid to avoid repeated checks
        _mcp_status_cache[url] = ('connected', time.time())
        return 'connected'
    
    # Check for SSRF vulnerabilities
    if not is_safe_url(url):
        return 'invalid'
    
    # Check cache first
    now = time.time()
    # Temporarily disable cache for debugging
    # if url in _mcp_status_cache:
    #     cached_result, cached_time = _mcp_status_cache[url]
    #     if now - cached_time < _cache_duration:
    #         print(f"🔍 MCP URL validation - Using cached result: {url} -> {cached_result}")
    #         return cached_result
    
    try:
        # Parse URL to validate format
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            print(f"🔍 MCP URL validation - Invalid format: {url} (scheme: {parsed.scheme}, netloc: {parsed.netloc})")
            result = 'invalid'
        else:
            # Try to connect with timeout
            timeout = aiohttp.ClientTimeout(total=3)  # Reduced timeout for faster response
            headers = {}
            
            # Special handling for MCP servers that require SSE headers
            if '/mcp' in url.lower():
                headers = {
                    'Accept': 'text/event-stream',
                    'X-Session-ID': 'health-check'
                }
                print(f"🔍 MCP URL validation - Testing {url} with SSE headers")
            else:
                print(f"🔍 MCP URL validation - Testing {url} with standard headers")
            
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url, headers=headers) as response:
                    print(f"🔍 MCP URL validation - Response: {url} -> {response.status}")
                    # Consider 2xx, 3xx, and even some 4xx as "connected" 
                    # since the server is responding
                    if response.status < 500:
                        result = 'connected'
                    else:
                        result = 'disconnected'
                        
    except (aiohttp.ClientError, asyncio.TimeoutError, Exception) as e:
        print(f"🔍 MCP URL validation - Exception: {url} -> {type(e).__name__}: {e}")
        result = 'disconnected'
    
    # Cache the result
    _mcp_status_cache[url] = (result, now)
    return result

async def check_all_mcp_urls(mcp_tools: list) -> dict:
    """Check all MCP URLs concurrently and return status mapping"""
    if not mcp_tools:
        return {}
    
    # Create tasks for concurrent checking
    tasks = []
    tool_ids = []
    
    for tool in mcp_tools:
        if tool.get("type") == "mcp" and tool.get("config", {}).get("url"):
            url = tool["config"]["url"]
            tasks.append(check_mcp_url_validity(url))
            tool_ids.append(tool["id"])
    
    if not tasks:
        return {}
    
    # Run all checks concurrently
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Map results back to tool IDs
    status_map = {}
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            status_map[tool_ids[i]] = 'disconnected'
        else:
            status_map[tool_ids[i]] = result
    
    return status_map

@router.get("")
async def get_tools(response: Response, x_session_id: Optional[str] = Header(None)):
    """Get list of available tools with session-specific enabled status"""
    try:
        # Get or create session-specific agent
        session_id, session_manager, agent = global_session_registry.get_or_create_session(x_session_id)
        
        # Set session ID in response header for frontend to use
        response.headers["X-Session-ID"] = session_id
        
        # Get session-specific tool config
        tool_config = session_manager.get_tool_config()
        all_tools = tool_config.get("tools", [])
        
        # Add tool_type field based on type
        for tool in all_tools:
            tool_type = tool.get("type", "built-in")
            if tool_type == "strands_tools":
                tool["tool_type"] = "built-in"
            elif tool_type == "strands_tools_wrapper":
                tool["tool_type"] = "built-in"
            elif tool_type == "custom_tools":
                tool["tool_type"] = "custom"
            elif tool_type == "agent":
                tool["tool_type"] = "agent"
            elif tool_type == "mcp":
                tool["tool_type"] = "mcp"
            else:
                tool["tool_type"] = "built-in"
        
        # Calculate summary
        enabled_count = sum(1 for tool in all_tools if tool.get("enabled", False))
        summary = {
            "total_tools": len(all_tools),
            "enabled_tools": enabled_count,
            "disabled_tools": len(all_tools) - enabled_count
        }
        
        # Get MCP servers from the same session
        mcp_servers = [tool for tool in all_tools if tool.get("type") == "mcp"]
        regular_tools = [tool for tool in all_tools if tool.get("type") != "mcp"]
        
        # Check MCP URL validity
        mcp_status_map = await check_all_mcp_urls(mcp_servers)
        
        # Add connection status to MCP servers
        for mcp_server in mcp_servers:
            server_id = mcp_server["id"]
            connection_status = mcp_status_map.get(server_id, 'unknown')
            mcp_server["connection_status"] = connection_status
        
        return {
            "success": True,
            "tools": regular_tools,        # Regular tools
            "mcp_servers": mcp_servers,     # MCP servers with connection status
            "summary": summary,
            "session_id": session_id
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get tools: {str(e)}")

@router.post("/{tool_id}/toggle")
async def toggle_tool(tool_id: str, response: Response, x_session_id: Optional[str] = Header(None)):
    """Toggle tool enabled/disabled status with session support"""
    try:
        # Get or create session-specific agent
        session_id, session_manager, agent = global_session_registry.get_or_create_session(x_session_id)
        
        # Set session ID in response header for frontend to use
        response.headers["X-Session-ID"] = session_id
        
        # Find the tool in session config
        tool_config = session_manager.get_tool_config()
        tool_found = None
        for tool in tool_config.get("tools", []):
            if tool.get("id") == tool_id:
                tool_found = tool
                break
        
        if not tool_found:
            raise HTTPException(status_code=404, detail=f"Tool {tool_id} not found")
        
        # Toggle status in session
        current_status = tool_found.get("enabled", False)
        new_status = not current_status
        
        success = session_manager.update_tool_enabled(tool_id, new_status)
        
        if success:
            enabled_tools = session_manager.get_enabled_tools()
            logger.info(f"Tool {tool_id} toggled to {new_status} for session {session_id}. Enabled tools: {len(enabled_tools)}")
            
            return {
                "success": True,
                "tool_id": tool_id,
                "enabled": new_status,
                "session_id": session_id,
                "message": f"Tool {tool_found['name']} {'enabled' if new_status else 'disabled'}"
            }
        else:
            raise HTTPException(status_code=500, detail=f"Failed to update tool {tool_id}")
                
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to toggle tool: {str(e)}")

@router.post("/reload")
async def reload_tools(x_session_id: Optional[str] = Header(None)):
    """Reload tools configuration and recreate agent"""
    try:
        # Get or create session-specific agent
        session_id, session_manager, agent = global_session_registry.get_or_create_session(x_session_id)
        
        success = await agent.reload_tools()
        if success:
            tool_config = session_manager.get_tool_config()
            all_tools = tool_config.get("tools", [])
            enabled_count = sum(1 for tool in all_tools if tool.get("enabled", False))
            
            summary = {
                "total_tools": len(all_tools),
                "enabled_tools": enabled_count,
                "disabled_tools": len(all_tools) - enabled_count
            }
            
            return {
                "success": True,
                "message": "Tools reloaded successfully",
                "summary": summary
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to reload tools")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reload tools: {str(e)}")


@router.get("/summary")
async def get_tools_summary(x_session_id: Optional[str] = Header(None)):
    """Get unified tools summary"""
    try:
        # Get or create session-specific agent
        session_id, session_manager, agent = global_session_registry.get_or_create_session(x_session_id)
        
        # Get tool config and calculate summary
        tool_config = session_manager.get_tool_config()
        all_tools = tool_config.get("tools", [])
        
        # Calculate summary by type
        summary_by_type = {}
        total_enabled = 0
        
        for tool in all_tools:
            tool_type = tool.get("type", "built-in")
            if tool_type not in summary_by_type:
                summary_by_type[tool_type] = {"total": 0, "enabled": 0}
            
            summary_by_type[tool_type]["total"] += 1
            if tool.get("enabled", False):
                summary_by_type[tool_type]["enabled"] += 1
                total_enabled += 1
        
        return {
            "total_tools": len(all_tools),
            "enabled_tools": total_enabled,
            "disabled_tools": len(all_tools) - total_enabled,
            "summary_by_type": summary_by_type,
            "session_id": session_id
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get tools summary: {str(e)}")

@router.post("/mcp")
async def add_mcp_server(request: AddMcpServerRequest, response: Response, x_session_id: Optional[str] = Header(None)):
    """Add a new MCP server to session tools configuration"""
    try:
        # Get or create session-specific agent
        session_id, session_manager, agent = global_session_registry.get_or_create_session(x_session_id)
        
        # Set session ID in response header
        response.headers["X-Session-ID"] = session_id
        
        # Check if server ID already exists
        tool_config = session_manager.get_tool_config()
        existing_tool = None
        for tool in tool_config.get("tools", []):
            if tool.get("id") == request.id:
                existing_tool = tool
                break
        
        if existing_tool:
            raise HTTPException(status_code=400, detail=f"MCP server with ID '{request.id}' already exists")
        
        # Create new MCP server configuration
        new_mcp_server = {
            "id": request.id,
            "name": request.name,
            "description": request.description,
            "type": "mcp",  # Force type to be "mcp" regardless of input
            "config": request.config,
            "category": request.category,
            "icon": request.icon,
            "enabled": request.enabled,
            "tool_type": "mcp"
        }
        
        # Add server to session configuration
        success = session_manager.add_tool_to_config(new_mcp_server)
        
        if success:
            # Check connection status for the new server
            connection_status = await check_mcp_url_validity(request.config.get("url", ""))
            new_mcp_server["connection_status"] = connection_status
            
            print(f"✅ Session {session_id}: Added MCP server '{request.name}' with ID '{request.id}'")
            
            return {
                "success": True,
                "message": f"MCP server '{request.name}' added successfully",
                "server": new_mcp_server,
                "session_id": session_id
            }
        else:
            raise HTTPException(status_code=500, detail=f"Failed to add MCP server '{request.name}'")
                
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to add MCP server: {str(e)}")
