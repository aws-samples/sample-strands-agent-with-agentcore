import json
import logging
from typing import Dict, List, Any, Optional
from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/model", tags=["model"])

# Import session registry
from session.global_session_registry import global_session_registry

class CachingConfig(BaseModel):
    enabled: bool

class ModelConfig(BaseModel):
    model_id: str
    temperature: float
    caching: Optional[CachingConfig] = None

class SystemPrompt(BaseModel):
    id: str
    name: str
    prompt: str
    active: bool

class UpdateSystemPromptRequest(BaseModel):
    name: str
    prompt: str

class CreateSystemPromptRequest(BaseModel):
    name: str
    prompt: str

CONFIG_FILE = "model_config.json"

# Available models - could be loaded from config or defined here
AVAILABLE_MODELS = [
    {
        "id": "us.anthropic.claude-sonnet-4-20250514-v1:0",
        "name": "Claude 4 Sonnet",
        "provider": "Anthropic",
        "description": "Anthropic's most advanced reasoning model"
    },
    {
        "id": "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
        "name": "Claude 3.5 Sonnet v2",
        "provider": "Anthropic",
        "description": "Fast, intelligent model for complex tasks"
    },
    {
        "id": "anthropic.claude-3-5-haiku-20241022-v1:0",
        "name": "Claude 3.5 Haiku",
        "provider": "Anthropic",
        "description": "Fast and affordable model for simple tasks"
    },
    {
        "id": "openai.gpt-oss-120b-1:0",
        "name": "GPT OSS 120B",
        "provider": "OpenAI",
        "description": "Large open-source GPT model with 120B parameters"
    },
    {
        "id": "openai.gpt-oss-20b-1:0",
        "name": "GPT OSS 20B",
        "provider": "OpenAI",
        "description": "Medium open-source GPT model with 20B parameters"
    }
]


@router.get("/config")
async def get_model_config(x_session_id: Optional[str] = Header(None)):
    """Get current model configuration from session"""
    try:
        # Get or create session for consistency
        session_id, session_manager, agent = global_session_registry.get_or_create_session(x_session_id)
        
        # Use session-specific model configuration
        config = session_manager.get_model_config()
        response_data = {
            "success": True,
            "config": config,
            "session_id": session_id
        }
        response = JSONResponse(content=response_data)
        response.headers["X-Session-ID"] = session_id
        return response
    except Exception as e:
        logger.error(f"Error getting model config from session: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get model config: {str(e)}")

@router.post("/config/update")
async def update_model_config(model_config: ModelConfig, x_session_id: Optional[str] = Header(None)):
    """Update model configuration for session"""
    try:
        # Get or create session-specific agent
        session_id, session_manager, agent = global_session_registry.get_or_create_session(x_session_id)
        
        # Update session-specific model configuration (exactly like tool toggle)
        caching_dict = None
        if model_config.caching is not None:
            caching_dict = {"enabled": model_config.caching.enabled}
        
        success = session_manager.update_model_config(
            model_id=model_config.model_id,
            temperature=model_config.temperature,
            caching=caching_dict
        )
        
        if success:
            logger.info(f"Model config updated for session {session_id}: {model_config.model_id}")
        else:
            raise HTTPException(status_code=500, detail="Failed to update session model config")
        
        # Get updated config
        config = session_manager.get_model_config()
        
        response_data = {
            "success": True,
            "message": "Model configuration updated successfully for session",
            "config": config,
            "session_id": session_id
        }
        response = JSONResponse(content=response_data)
        response.headers["X-Session-ID"] = session_id
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating session model config: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update model config: {str(e)}")

@router.get("/prompts")
async def get_system_prompts(x_session_id: Optional[str] = Header(None)):
    """Get all system prompts from session"""
    try:
        # Get or create session for consistency
        session_id, session_manager, agent = global_session_registry.get_or_create_session(x_session_id)
        
        # Use session-specific model configuration
        config = session_manager.get_model_config()
        prompts = config.get("system_prompts", [])
        
        response_data = {
            "success": True,
            "prompts": prompts,
            "session_id": session_id
        }
        response = JSONResponse(content=response_data)
        response.headers["X-Session-ID"] = session_id
        return response
    except Exception as e:
        logger.error(f"Error getting system prompts from session: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get system prompts: {str(e)}")

@router.post("/prompts")
async def create_system_prompt(prompt_request: CreateSystemPromptRequest, x_session_id: Optional[str] = Header(None)):
    """Create a new system prompt in session"""
    try:
        # Get or create session-specific agent
        session_id, session_manager, agent = global_session_registry.get_or_create_session(x_session_id)
        
        # Add system prompt to session
        new_id = session_manager.add_system_prompt(
            name=prompt_request.name,
            prompt=prompt_request.prompt,
            active=False  # New prompts start inactive
        )
        
        if not new_id:
            raise HTTPException(status_code=500, detail="Failed to create system prompt in session")
        
        # Get the created prompt from session
        config = session_manager.get_model_config()
        new_prompt = next((p for p in config.get("system_prompts", []) if p["id"] == new_id), None)
        
        response_data = {
            "success": True,
            "message": "System prompt created successfully in session",
            "prompt": new_prompt,
            "session_id": session_id
        }
        response = JSONResponse(content=response_data)
        response.headers["X-Session-ID"] = session_id
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating system prompt in session: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create system prompt: {str(e)}")

@router.put("/prompts/{prompt_id}")
async def update_system_prompt(prompt_id: str, prompt_request: UpdateSystemPromptRequest, x_session_id: Optional[str] = Header(None)):
    """Update an existing system prompt in session"""
    try:
        # Get or create session-specific agent
        session_id, session_manager, agent = global_session_registry.get_or_create_session(x_session_id)
        
        # Update system prompt in session
        success = session_manager.update_system_prompt(
            prompt_id=prompt_id,
            name=prompt_request.name,
            prompt=prompt_request.prompt
        )
        
        if not success:
            raise HTTPException(status_code=404, detail=f"System prompt not found: {prompt_id}")
        
        # Check if this is the active prompt and recreate agent if needed
        config = session_manager.get_model_config()
        active_prompt = next((p for p in config.get("system_prompts", []) if p["active"] and p["id"] == prompt_id), None)
        if active_prompt:
            await agent.create_agent_with_all_tools()
        
        response_data = {
            "success": True,
            "message": "System prompt updated successfully in session",
            "session_id": session_id
        }
        response = JSONResponse(content=response_data)
        response.headers["X-Session-ID"] = session_id
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating system prompt in session: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update system prompt: {str(e)}")

@router.post("/prompts/{prompt_id}/activate")
async def activate_system_prompt(prompt_id: str, x_session_id: Optional[str] = Header(None)):
    """Activate a system prompt in session (deactivates others)"""
    try:
        # Get or create session-specific agent
        session_id, session_manager, agent = global_session_registry.get_or_create_session(x_session_id)
        
        # Activate system prompt in session (this will deactivate others automatically)
        success = session_manager.update_system_prompt(
            prompt_id=prompt_id,
            active=True
        )
        
        if not success:
            raise HTTPException(status_code=404, detail=f"System prompt not found: {prompt_id}")
        
        # Recreate agent with new active prompt
        await agent.create_agent_with_all_tools()
        
        response_data = {
            "success": True,
            "message": "System prompt activated successfully in session",
            "session_id": session_id
        }
        response = JSONResponse(content=response_data)
        response.headers["X-Session-ID"] = session_id
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error activating system prompt in session: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to activate system prompt: {str(e)}")

@router.delete("/prompts/{prompt_id}")
async def delete_system_prompt(prompt_id: str, x_session_id: Optional[str] = Header(None)):
    """Delete a system prompt from session"""
    try:
        # Get or create session-specific agent
        session_id, session_manager, agent = global_session_registry.get_or_create_session(x_session_id)
        
        # Delete system prompt from session
        success = session_manager.delete_system_prompt(prompt_id)
        
        if not success:
            raise HTTPException(status_code=404, detail=f"System prompt not found: {prompt_id}")
        
        # Recreate agent if needed
        await agent.create_agent_with_all_tools()
        
        response_data = {
            "success": True,
            "message": "System prompt deleted successfully from session",
            "session_id": session_id
        }
        response = JSONResponse(content=response_data)
        response.headers["X-Session-ID"] = session_id
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting system prompt from session: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete system prompt: {str(e)}")

@router.get("/available-models")
async def get_available_models(x_session_id: Optional[str] = Header(None)):
    """Get list of available models"""
    try:
        # Get or create session for consistency
        session_id, session_manager, agent = global_session_registry.get_or_create_session(x_session_id)
        
        response_data = {
            "success": True,
            "models": AVAILABLE_MODELS,
            "session_id": session_id
        }
        response = JSONResponse(content=response_data)
        response.headers["X-Session-ID"] = session_id
        return response
        
    except Exception as e:
        logger.error(f"Error getting available models: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get available models: {str(e)}")