from fastapi import APIRouter, File, UploadFile, Form, Header
from fastapi.responses import StreamingResponse
import os
import shutil
import logging
import base64
from typing import Dict, Any, Optional, List
router = APIRouter(prefix="/stream", tags=["chat"])

# Upload directory
UPLOAD_DIR = "uploads"

# Ensure upload directory exists
os.makedirs(UPLOAD_DIR, exist_ok=True)


# Import session registry
from session.global_session_registry import global_session_registry

@router.post("/chat")
async def stream_chat(request: dict, x_session_id: Optional[str] = Header(None)):
    """Stream chat responses using Server-Sent Events with session management"""
    user_message = request.get("message", "")

    if not user_message.strip():
        return {"error": "Message cannot be empty"}

    try:
        # Get session ID from header or request body, or generate new one
        session_id = x_session_id or request.get("session_id")

        # Get or create session-specific agent
        session_id, session_manager, agent = global_session_registry.get_or_create_session(session_id)

        # Use session-specific agent for streaming
        return StreamingResponse(
            agent.stream_async(user_message, session_id=session_id),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
                "X-Session-ID": session_id,  # Return session ID to client
            }
        )
        
    except Exception as e:
        logging.error(f"Error in stream_chat: {str(e)}")
        raise ValueError(f"Chat streaming failed: {str(e)}")

@router.post("")
async def chat_endpoint(request: dict, x_session_id: Optional[str] = Header(None)):
    """Non-streaming chat endpoint"""
    user_message = request.get("message", "")
    
    if not user_message.strip():
        return {"error": "Message cannot be empty"}
    
    try:
        # Get session ID from header or request body
        session_id = x_session_id or request.get("session_id")
        
        # Get or create session-specific agent
        session_id, session_manager, agent = global_session_registry.get_or_create_session(session_id)
        
        response = await agent.invoke_async(user_message)
        return {
            "message": response,
            "tool_used": None,
            "session_id": session_id
        }
    except Exception as e:
        logging.error(f"Error in chat_endpoint: {str(e)}")
        return {
            "error": "Sorry, I encountered an internal error. Please try again."
        }

@router.post("/multimodal")
async def multimodal_stream_chat(
    message: str = Form(...),
    files: List[UploadFile] = File(default=[]),
    x_session_id: Optional[str] = Header(None)
):
    """Streaming chat endpoint with optional multiple file upload - native vision support"""
    try:
        # Get session ID from header
        session_id = x_session_id
        
        # Get or create session-specific agent
        session_id, session_manager, agent = global_session_registry.get_or_create_session(session_id)
        
        # Handle multiple file uploads if provided
        file_paths = []
        if files:
            for file in files:
                # Support both images and PDFs
                if file.content_type and (file.content_type.startswith('image/') or file.content_type == 'application/pdf'):
                    file_path = os.path.join(UPLOAD_DIR, file.filename)
                    with open(file_path, "wb") as buffer:
                        shutil.copyfileobj(file.file, buffer)
                    file_paths.append(file_path)
        
        # Use native multimodal capabilities with streaming
        return StreamingResponse(
            agent.stream_async(message, file_paths if file_paths else None, session_id=session_id),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
                "X-Session-ID": session_id,  # Return session ID to client
            }
        )
    except Exception as e:
        logging.error(f"Error in multimodal_stream_chat: {str(e)}")
        logging.error(f"Chat error: {str(e)}")
        return {"error": "Sorry, I encountered an error processing your request"}

@router.post("/content-blocks")
async def content_blocks_chat(request: Dict[str, Any], x_session_id: Optional[str] = Header(None)):
    """Chat endpoint that accepts ContentBlock structure for multimodal messages"""
    try:
        # Get session ID from header or request body
        session_id = x_session_id or request.get("session_id")
        
        # Get or create session-specific agent
        session_id, session_manager, agent = global_session_registry.get_or_create_session(session_id)
        
        content_blocks = request.get("content", [])
        
        if not content_blocks:
            return {"error": "Content blocks cannot be empty"}
        
        # Process content blocks to convert base64 data to bytes
        processed_content = []
        for block in content_blocks:
            processed_block = block.copy()
            
            # Handle image content blocks
            if "image" in block:
                image_data = block["image"]
                if "source" in image_data and "bytes" in image_data["source"]:
                    # Convert base64 string to bytes if needed
                    bytes_data = image_data["source"]["bytes"]
                    if isinstance(bytes_data, str):
                        # Assume it's base64 encoded
                        try:
                            processed_block["image"]["source"]["bytes"] = base64.b64decode(bytes_data)
                        except Exception:
                            # If not base64, assume it's already bytes
                            processed_block["image"]["source"]["bytes"] = bytes_data.encode() if isinstance(bytes_data, str) else bytes_data
                    elif isinstance(bytes_data, list):
                        # Convert list of integers to bytes
                        processed_block["image"]["source"]["bytes"] = bytes(bytes_data)
            
            # Handle document content blocks
            if "document" in block:
                document_data = block["document"]
                if "source" in document_data and "bytes" in document_data["source"]:
                    # Convert base64 string to bytes if needed
                    bytes_data = document_data["source"]["bytes"]
                    if isinstance(bytes_data, str):
                        # Assume it's base64 encoded
                        try:
                            processed_block["document"]["source"]["bytes"] = base64.b64decode(bytes_data)
                        except Exception:
                            # If not base64, assume it's already bytes
                            processed_block["document"]["source"]["bytes"] = bytes_data.encode() if isinstance(bytes_data, str) else bytes_data
                    elif isinstance(bytes_data, list):
                        # Convert list of integers to bytes
                        processed_block["document"]["source"]["bytes"] = bytes(bytes_data)
            
            processed_content.append(processed_block)
        
        # Use Strands Agent's native ContentBlock support
        response = await agent.invoke_async(processed_content)
        return {
            "message": response,
            "content_blocks_processed": len(processed_content),
            "session_id": session_id
        }
        
    except Exception as e:
        logging.error(f"Error in content_blocks_chat: {str(e)}")
        logging.error(f"Chat error: {str(e)}")
        return {"error": "Sorry, I encountered an error processing your request"}

@router.post("/content-blocks/stream")
async def content_blocks_stream_chat(request: Dict[str, Any], x_session_id: Optional[str] = Header(None)):
    """Streaming chat endpoint that accepts ContentBlock structure for multimodal messages"""
    try:
        # Get session ID from header or request body
        session_id = x_session_id or request.get("session_id")
        
        # Get or create session-specific agent
        session_id, session_manager, agent = global_session_registry.get_or_create_session(session_id)
        
        content_blocks = request.get("content", [])
        
        if not content_blocks:
            return {"error": "Content blocks cannot be empty"}
        
        # Process content blocks to convert base64 data to bytes
        processed_content = []
        for block in content_blocks:
            processed_block = block.copy()
            
            # Handle image content blocks
            if "image" in block:
                image_data = block["image"]
                if "source" in image_data and "bytes" in image_data["source"]:
                    # Convert base64 string to bytes if needed
                    bytes_data = image_data["source"]["bytes"]
                    if isinstance(bytes_data, str):
                        # Assume it's base64 encoded
                        try:
                            processed_block["image"]["source"]["bytes"] = base64.b64decode(bytes_data)
                        except Exception:
                            # If not base64, assume it's already bytes
                            processed_block["image"]["source"]["bytes"] = bytes_data.encode() if isinstance(bytes_data, str) else bytes_data
                    elif isinstance(bytes_data, list):
                        # Convert list of integers to bytes
                        processed_block["image"]["source"]["bytes"] = bytes(bytes_data)
            
            # Handle document content blocks
            if "document" in block:
                document_data = block["document"]
                if "source" in document_data and "bytes" in document_data["source"]:
                    # Convert base64 string to bytes if needed
                    bytes_data = document_data["source"]["bytes"]
                    if isinstance(bytes_data, str):
                        # Assume it's base64 encoded
                        try:
                            processed_block["document"]["source"]["bytes"] = base64.b64decode(bytes_data)
                        except Exception:
                            # If not base64, assume it's already bytes
                            processed_block["document"]["source"]["bytes"] = bytes_data.encode() if isinstance(bytes_data, str) else bytes_data
                    elif isinstance(bytes_data, list):
                        # Convert list of integers to bytes
                        processed_block["document"]["source"]["bytes"] = bytes(bytes_data)
            
            processed_content.append(processed_block)
        
        # Use Strands Agent's native ContentBlock support with streaming
        return StreamingResponse(
            agent.stream_async(processed_content, session_id=session_id),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
                "X-Session-ID": session_id,  # Return session ID to client
            }
        )
        
    except Exception as e:
        logging.error(f"Error in content_blocks_stream_chat: {str(e)}")
        logging.error(f"Chat error: {str(e)}")
        return {"error": "Sorry, I encountered an error processing your request"}
