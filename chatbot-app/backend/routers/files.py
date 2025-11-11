import os
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import PlainTextResponse, FileResponse
from typing import Optional, List
import logging
from config import Config
from memory_store import get_memory_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/files", tags=["files"])

def validate_safe_path(base_path: str, user_input: str) -> str:
    """
    Validate that the user input doesn't contain path traversal attempts
    and return the safe absolute path within the base directory.
    """
    import urllib.parse
    
    # Decode URL encoding first to catch encoded traversal attempts
    try:
        user_input = urllib.parse.unquote(user_input)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Invalid path: malformed URL encoding"
        )
    
    # Remove any leading/trailing whitespace and slashes
    user_input = user_input.strip().strip('/')
    
    # Check for path traversal attempts (including various encodings)
    dangerous_patterns = [
        '..',           # Standard path traversal
        '..\\',         # Windows path traversal
        '../',          # Unix path traversal
        '%2e%2e',       # URL encoded ..
        '%2f',          # URL encoded /
        '%5c',          # URL encoded \
        '\\',           # Windows separator
        chr(0),         # Null byte
    ]
    
    user_lower = user_input.lower()
    for pattern in dangerous_patterns:
        if pattern in user_lower:
            raise HTTPException(
                status_code=400,
                detail="Invalid path: path traversal attempts are not allowed"
            )
    
    # Check for absolute paths
    if user_input.startswith('/') or (len(user_input) > 1 and user_input[1] == ':'):
        raise HTTPException(
            status_code=400,
            detail="Invalid path: absolute paths are not allowed"
        )
    
    # Only block null bytes and other dangerous control characters
    if chr(0) in user_input or any(ord(c) < 32 and c not in ['\t'] for c in user_input):
        raise HTTPException(
            status_code=400,
            detail="Invalid path: contains illegal control characters"
        )
    
    # Build the full path
    full_path = os.path.join(base_path, user_input)
    
    # Get absolute paths for comparison
    abs_base_path = os.path.abspath(base_path)
    abs_full_path = os.path.abspath(full_path)
    
    # Ensure the final path is within the base directory
    if not abs_full_path.startswith(abs_base_path + os.sep) and abs_full_path != abs_base_path:
        raise HTTPException(
            status_code=403,
            detail="Access denied: path outside allowed directory"
        )
    
    return abs_full_path

def validate_filename(filename: str) -> str:
    """
    Validate that filename doesn't contain path traversal attempts
    """
    if not filename or '..' in filename or '/' in filename or '\\' in filename:
        raise HTTPException(
            status_code=400,
            detail="Invalid filename: contains illegal characters or path separators"
        )
    return filename

@router.get("/list")
async def list_tool_files(
    toolUseId: str = Query(..., description="Tool Use ID"),
    sessionId: Optional[str] = Query(None, description="Session ID")
):
    """
    List all files in a tool execution directory
    """
    try:
        # Validate inputs to prevent path traversal
        validate_filename(toolUseId)
        if sessionId:
            validate_filename(sessionId)
        
        # Determine the correct path based on session ID
        if sessionId:
            base_dir = "output/sessions"
            tool_dir_path = os.path.join(sessionId, toolUseId)
            tool_dir = validate_safe_path(base_dir, tool_dir_path)
        else:
            base_dir = "output"
            tool_dir = validate_safe_path(base_dir, toolUseId)
        
        # Check if directory exists
        if not os.path.exists(tool_dir):
            raise HTTPException(status_code=404, detail=f"Tool directory not found")
        
        # Get all files in the directory
        files = []
        try:
            for item in os.listdir(tool_dir):
                item_path = os.path.join(tool_dir, item)
                if os.path.isfile(item_path):
                    files.append(item)
        except Exception as e:
            logger.error(f"Error reading directory {tool_dir}: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to read directory: {str(e)}")
        
        return {"files": files}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing files for {toolUseId}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to list files: {str(e)}")


@router.get("/agent-result", response_class=PlainTextResponse)
async def get_agent_tool_result(
    toolUseId: str = Query(..., description="Tool Use ID"),
    toolName: str = Query(..., description="Tool Name (e.g., spending_analysis_tool, financial_narrative_tool)"),
    sessionId: str = Query(..., description="Session ID")
):
    """
    Get the saved result from an agent tool execution
    
    First tries to get from memory store, then falls back to file system
    """
    try:
        # Try to get from memory store first
        memory_store = get_memory_store()
        analysis = memory_store.get_analysis(sessionId, toolUseId)
        
        if analysis and analysis.get('content'):
            content = analysis['content']
            logger.info(f"Successfully retrieved agent tool result from memory: session={sessionId}, tool_use_id={toolUseId}")
            return content
        
        # Fallback to file system
        logger.info(f"Analysis not found in memory, trying file system: session={sessionId}, tool_use_id={toolUseId}")
        
        # Validate inputs to prevent path traversal
        validate_filename(sessionId)
        validate_filename(toolUseId)
        validate_filename(toolName)
        
        # Build the path to the agent tool result file
        session_output_dir = Config.get_session_output_dir(sessionId)
        relative_path = os.path.join(toolName, toolUseId, 'result.md')
        result_file_path = validate_safe_path(session_output_dir, relative_path)
        
        # Check if file exists
        if not os.path.exists(result_file_path):
            raise HTTPException(
                status_code=404, 
                detail=f"Agent tool result not found in memory or file system: {toolUseId}"
            )
        
        # Read and return the file content
        try:
            with open(result_file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            logger.info(f"Successfully retrieved agent tool result from file: {result_file_path}")
            return content
            
        except Exception as e:
            logger.error(f"Error reading file {result_file_path}: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to read file: {str(e)}")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting agent tool result for {toolUseId}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get agent tool result: {str(e)}")


@router.get("/agent-result/exists")
async def check_agent_tool_result_exists(
    toolUseId: str = Query(..., description="Tool Use ID"),
    toolName: str = Query(..., description="Tool Name"),
    sessionId: str = Query(..., description="Session ID")
):
    """
    Check if an agent tool result exists in memory or file system
    """
    try:
        # Check memory store first
        memory_store = get_memory_store()
        analysis = memory_store.get_analysis(sessionId, toolUseId)
        
        if analysis and analysis.get('content'):
            return {
                "exists": True,
                "source": "memory",
                "path": None
            }
        
        # Validate inputs to prevent path traversal
        validate_filename(sessionId)
        validate_filename(toolUseId)
        validate_filename(toolName)
        
        # Check file system as fallback
        session_output_dir = Config.get_session_output_dir(sessionId)
        relative_path = os.path.join(toolName, toolUseId, 'result.md')
        result_file_path = validate_safe_path(session_output_dir, relative_path)
        
        file_exists = os.path.exists(result_file_path)
        
        return {
            "exists": file_exists,
            "source": "file" if file_exists else "none",
            "path": result_file_path if file_exists else None
        }
        
    except Exception as e:
        logger.error(f"Error checking agent tool result existence: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to check file existence: {str(e)}")


@router.get("/images/{session_id}/{tool_use_id}/{filename}")
async def get_session_image(
    session_id: str,
    tool_use_id: str,
    filename: str
):
    """
    Serve images from tool_use_id-specific directories
    
    Path: output/sessions/{session_id}/{tool_use_id}/images/{filename}
    """
    try:
        # Validate inputs to prevent path traversal
        validate_filename(session_id)
        validate_filename(tool_use_id)
        validate_filename(filename)
        
        # Build the safe image path
        base_dir = "output/sessions"
        relative_path = os.path.join(session_id, tool_use_id, 'images', filename)
        image_path = validate_safe_path(base_dir, relative_path)
        
        # Check if file exists
        if not os.path.exists(image_path):
            raise HTTPException(
                status_code=404, 
                detail=f"Image not found for the specified session and tool"
            )
        
        # Check if it's actually a file (not a directory)
        if not os.path.isfile(image_path):
            raise HTTPException(
                status_code=404, 
                detail=f"Path exists but is not a file: {filename}"
            )
        
        # Determine media type based on file extension
        file_extension = filename.lower().split('.')[-1]
        media_type_map = {
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'svg': 'image/svg+xml'
        }
        
        media_type = media_type_map.get(file_extension, 'application/octet-stream')
        
        logger.info(f"Serving image: {image_path} with media type: {media_type}")
        
        return FileResponse(
            path=image_path,
            media_type=media_type,
            filename=filename
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error serving image {filename} for session {session_id}, tool_use_id {tool_use_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to serve image: {str(e)}")


@router.get("/download/{session_id}/{tool_use_id}/{filename}")
async def download_tool_file(
    session_id: str,
    tool_use_id: str,
    filename: str
):
    """
    Download files from tool execution directories
    
    Simplified path pattern: output/sessions/{session_id}/{tool_use_id}/{filename}
    """
    try:
        # Validate inputs to prevent path traversal
        validate_filename(session_id)
        validate_filename(tool_use_id)
        validate_filename(filename)
        
        # Use simplified directory structure with safe path validation
        base_dir = "output/sessions"
        relative_path = os.path.join(session_id, tool_use_id, filename)
        file_path = validate_safe_path(base_dir, relative_path)
        
        # Check if file exists
        if not os.path.exists(file_path):
            raise HTTPException(
                status_code=404, 
                detail=f"File not found for the specified session and tool"
            )
        
        # Check if it's actually a file (not a directory)
        if not os.path.isfile(file_path):
            raise HTTPException(
                status_code=404, 
                detail=f"Path exists but is not a file: {filename}"
            )
        
        # Determine media type based on file extension
        file_extension = filename.lower().split('.')[-1]
        media_type_map = {
            # Archives
            'zip': 'application/zip',
            'tar': 'application/x-tar',
            'gz': 'application/gzip',
            # Data files
            'csv': 'text/csv',
            'json': 'application/json',
            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'xls': 'application/vnd.ms-excel',
            # Images
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'svg': 'image/svg+xml',
            # Documents
            'pdf': 'application/pdf',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'doc': 'application/msword',
            'txt': 'text/plain',
            'md': 'text/markdown',
            'html': 'text/html',
            # Code files
            'py': 'text/x-python',
            'js': 'text/javascript',
            'ts': 'text/typescript',
            'sql': 'text/x-sql'
        }
        
        media_type = media_type_map.get(file_extension, 'application/octet-stream')
        
        logger.info(f"Serving download: {file_path} with media type: {media_type}")
        
        return FileResponse(
            path=file_path,
            media_type=media_type,
            filename=filename,
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error serving download {filename} for session {session_id}, tool_use_id {tool_use_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to serve download: {str(e)}")



@router.get("/download/output/{path:path}")
async def download_output_file(path: str):
    """
    Download files from the output directory using relative paths
    
    Supports files with paths like: /output/repl/bedrock_abc123/file.zip
    """
    try:
        # Remove leading slash if present
        if path.startswith('/'):
            path = path[1:]
        
        # Remove 'output/' prefix if present since we'll add it
        if path.startswith('output/'):
            path = path[7:]
        
        # Build full file path
        file_path = os.path.join('output', path)
        
        # Use existing validation function for better security
        try:
            file_path = validate_safe_path('output', path)
        except HTTPException:
            raise HTTPException(
                status_code=403,
                detail="Access denied: path outside output directory"
            )
        
        # Check if file exists
        if not os.path.exists(file_path):
            raise HTTPException(
                status_code=404, 
                detail=f"File not found: {path}"
            )
        
        # Check if it's actually a file (not a directory)
        if not os.path.isfile(file_path):
            raise HTTPException(
                status_code=404, 
                detail=f"Path exists but is not a file: {path}"
            )
        
        # Get filename for Content-Disposition
        filename = os.path.basename(file_path)
        
        # Determine media type based on file extension
        file_extension = filename.lower().split('.')[-1]
        media_type_map = {
            # Archives
            'zip': 'application/zip',
            'tar': 'application/x-tar',
            'gz': 'application/gzip',
            # Data files
            'csv': 'text/csv',
            'json': 'application/json',
            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'xls': 'application/vnd.ms-excel',
            # Images
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'svg': 'image/svg+xml',
            # Documents
            'pdf': 'application/pdf',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'doc': 'application/msword',
            'txt': 'text/plain',
            'md': 'text/markdown',
            'html': 'text/html',
            # Code files
            'py': 'text/x-python',
            'js': 'text/javascript',
            'ts': 'text/typescript',
            'sql': 'text/x-sql'
        }
        
        media_type = media_type_map.get(file_extension, 'application/octet-stream')
        
        logger.info(f"Serving output file download: {file_path} with media type: {media_type}")
        
        return FileResponse(
            path=file_path,
            media_type=media_type,
            filename=filename,
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error serving output file download {path}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to serve download: {str(e)}")
