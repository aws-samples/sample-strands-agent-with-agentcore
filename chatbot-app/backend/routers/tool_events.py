"""
Tool Events Router

Unified SSE endpoint for all tool-related events including progress and analysis updates.
Tools can send events directly through this channel for better performance and simplicity.
"""

import asyncio
import json
import logging
from typing import Dict, Any, Set, Optional
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from datetime import datetime

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/stream", tags=["tool_events"])

# Global tool events channel for broadcasting all tool-related events
class ToolEventsChannel:
    def __init__(self):
        self.subscribers: Set[asyncio.Queue] = set()
        self.active_sessions: Dict[str, Dict[str, Any]] = {}
        # Track session ID for each subscriber queue
        self.subscriber_sessions: Dict[asyncio.Queue, str] = {}
    
    async def subscribe(self, session_id: str = None) -> asyncio.Queue:
        """Subscribe to tool events with optional session filtering"""
        queue = asyncio.Queue()
        self.subscribers.add(queue)
        
        # Associate this queue with a session ID for filtering
        if session_id:
            self.subscriber_sessions[queue] = session_id
            
        return queue
    
    async def unsubscribe(self, queue: asyncio.Queue):
        """Unsubscribe from tool events"""
        self.subscribers.discard(queue)
        # Clean up session tracking
        self.subscriber_sessions.pop(queue, None)
    
    async def broadcast(self, event: Dict[str, Any]):
        """Broadcast tool event to subscribers with session filtering"""
        event_session_id = event.get('sessionId')
        event_type = event.get('type', 'unknown')
        
        if not self.subscribers:
            return
        
        # Format as SSE event
        sse_data = f"data: {json.dumps(event)}\n\n"
        
        # Send to filtered subscribers based on session ID
        dead_queues = set()
        sent_count = 0
        
        for queue in self.subscribers:
            try:
                # Get the session ID this subscriber is interested in
                subscriber_session_id = self.subscriber_sessions.get(queue)
                
                # Send event only if session IDs match exactly
                # Global events (keepalive, tools_connected) have no sessionId and are sent to all
                should_send = (
                    event_session_id is None or  # Global events like keepalive
                    subscriber_session_id == event_session_id  # Exact session match
                )
                
                if should_send:
                    await queue.put(sse_data)
                    sent_count += 1
                    
            except Exception as e:
                logger.error(f"Failed to send tool event to subscriber: {e}")
                dead_queues.add(queue)
        
        # Clean up dead queues
        for queue in dead_queues:
            self.subscribers.discard(queue)
    
    # Progress Events (from weather tool, etc.)
    async def send_progress(self, tool_name: str, session_id: str, step: str, message: str, 
                          progress: float = None, metadata: Dict[str, Any] = None):
        """Send a tool progress update"""
        event = {
            "type": "tool_progress",
            "toolName": tool_name,
            "sessionId": session_id,
            "step": step,
            "message": message,
            "progress": progress,
            "timestamp": datetime.now().isoformat(),
            "metadata": metadata or {}
        }
        
        # Store active session info
        session_key = f"{session_id}_{tool_name}"
        if step not in ["completed", "error"]:
            self.active_sessions[session_key] = event
        
        await self.broadcast(event)
    
    async def complete_progress(self, tool_name: str, session_id: str, message: str = "Completed"):
        """Mark tool progress as completed"""
        await self.send_progress(tool_name, session_id, "completed", message, 100)
        
        # Clean up session
        session_key = f"{session_id}_{tool_name}"
        self.active_sessions.pop(session_key, None)
    
    async def error_progress(self, tool_name: str, session_id: str, message: str, error_details: str = None):
        """Mark tool progress as error"""
        metadata = {"error": error_details} if error_details else None
        await self.send_progress(tool_name, session_id, "error", message, None, metadata)
        
        # Clean up session
        session_key = f"{session_id}_{tool_name}"
        self.active_sessions.pop(session_key, None)
    
    # Analysis Events (from strands agent tool)
    async def send_analysis_start(self, session_id: str, message: str = "Starting analysis...", tool_use_id: str = None):
        """Send analysis start event"""
        event = {
            "type": "tool_analysis_start",
            "sessionId": session_id,
            "toolUseId": tool_use_id,
            "message": message,
            "step": "initializing",
            "timestamp": datetime.now().isoformat()
        }
        
        # Store active session
        self.active_sessions[session_id] = event
        await self.broadcast(event)
    
    async def send_analysis_stream(self, session_id: str, data: str, step: str = "processing", tool_use_id: str = None):
        """Send analysis streaming data"""
        event = {
            "type": "tool_analysis_stream",
            "sessionId": session_id,
            "toolUseId": tool_use_id,
            "data": data,
            "step": step,
            "timestamp": datetime.now().isoformat()
        }
        
        await self.broadcast(event)
    
    async def send_analysis_complete(self, session_id: str, final_summary: str, chart_ids: list = None, tool_use_id: str = None):
        """Send analysis completion event"""
        event = {
            "type": "tool_analysis_complete",
            "sessionId": session_id,
            "toolUseId": tool_use_id,
            "data": final_summary,
            "step": "completed",
            "timestamp": datetime.now().isoformat(),
            "metadata": {"chart_ids": chart_ids or []}
        }
        
        await self.broadcast(event)
        
        # Clean up session
        self.active_sessions.pop(session_id, None)
    
    async def send_chart_created(self, session_id: str, chart_id: str, chart_title: str = ""):
        """Send chart creation event"""
        event = {
            "type": "tool_chart_created",
            "sessionId": session_id,
            "chartId": chart_id,
            "chartTitle": chart_title,
            "step": "chart_generation",
            "timestamp": datetime.now().isoformat()
        }
        
        await self.broadcast(event)
    
    async def send_analysis_error(self, session_id: str, error_message: str, error_details: str = None):
        """Send analysis error event"""
        event = {
            "type": "tool_analysis_error",
            "sessionId": session_id,
            "message": error_message,
            "step": "error",
            "timestamp": datetime.now().isoformat(),
            "metadata": {"error": error_details} if error_details else {}
        }
        
        await self.broadcast(event)
        
        # Clean up session
        self.active_sessions.pop(session_id, None)
    
    def get_active_sessions(self) -> Dict[str, Dict[str, Any]]:
        """Get all active tool sessions"""
        return self.active_sessions.copy()
    
    def clear_session_events(self, session_id: str):
        """Clear all stored events for a specific session"""
        keys_to_remove = []
        for key in self.active_sessions.keys():
            if key == session_id or key.startswith(f"{session_id}_"):
                keys_to_remove.append(key)
        
        for key in keys_to_remove:
            self.active_sessions.pop(key, None)
            
        logger.info(f"Cleared {len(keys_to_remove)} stored events for session {session_id}")
    
    def clear_all_events(self):
        """Clear all stored events"""
        event_count = len(self.active_sessions)
        self.active_sessions.clear()
        logger.info(f"Cleared all {event_count} stored events")

# Global tool events channel instance
tool_events_channel = ToolEventsChannel()

@router.get("/tools")
async def tool_events_stream(session_id: Optional[str] = Query(None)):
    """
    Server-Sent Events endpoint for all tool-related events.
    
    Unified stream for progress updates, analysis streaming, and chart creation events.
    Supports session-based filtering via X-Session-ID header.
    """
    
    async def event_generator():
        # Subscribe to tool events channel with session filtering
        queue = await tool_events_channel.subscribe(session_id=session_id)
        
        try:
            # Send initial connection event
            initial_event = {
                "type": "tools_connected",
                "message": "Tool events stream connected",
                "timestamp": datetime.now().isoformat()
            }
            yield f"data: {json.dumps(initial_event)}\n\n"
            
            # Send any existing active sessions (filtered by session ID)
            active_sessions = tool_events_channel.get_active_sessions()
            logger.info(f"🔍 New subscriber connecting - session_id: {session_id}, active_sessions: {len(active_sessions)}")

            sent_count = 0
            for session_key, session_data in active_sessions.items():
                # Only send events matching this subscriber's session ID
                event_session_id = session_data.get('sessionId')
                should_send = (
                    session_id is None or  # No filter, send all
                    event_session_id == session_id  # Exact session match
                )

                if should_send:
                    logger.info(f"✅ Sending existing event: {session_key} (event_session={event_session_id}) to subscriber (session={session_id})")
                    yield f"data: {json.dumps(session_data)}\n\n"
                    sent_count += 1
                else:
                    logger.info(f"⏭️  Skipping event: {session_key} (event_session={event_session_id}) for subscriber (session={session_id})")

            logger.info(f"📊 Sent {sent_count}/{len(active_sessions)} existing events to subscriber {session_id}")
            
            # Listen for new tool events
            while True:
                try:
                    # Wait for tool event with timeout
                    event_data = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield event_data
                except asyncio.TimeoutError:
                    # Send keepalive
                    keepalive = {
                        "type": "keepalive",
                        "timestamp": datetime.now().isoformat()
                    }
                    yield f"data: {json.dumps(keepalive)}\n\n"
                except Exception as e:
                    logger.error(f"Error in tool events stream: {e}")
                    break
                    
        except Exception as e:
            logger.error(f"Tool events stream error: {e}")
        finally:
            # Unsubscribe when connection closes
            await tool_events_channel.unsubscribe(queue)
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
        }
    )

@router.get("/tools/status")
async def tool_events_status():
    """Get current tool events status"""
    return {
        "active_subscribers": len(tool_events_channel.subscribers),
        "active_sessions": len(tool_events_channel.active_sessions),
        "sessions": list(tool_events_channel.active_sessions.keys())
    }

@router.post("/tools/clear")
async def clear_tool_events(session_id: Optional[str] = Query(None)):
    """Clear stored tool events"""
    if session_id:
        tool_events_channel.clear_session_events(session_id)
        return {
            "success": True,
            "message": f"Cleared events for session {session_id}"
        }
    else:
        tool_events_channel.clear_all_events()
        return {
            "success": True,
            "message": "Cleared all stored events"
        }