"""
Configuration management for AgentCore
"""
import os
from pathlib import Path


class Config:
    """Configuration class for AgentCore paths and settings"""

    @staticmethod
    def get_base_dir() -> Path:
        """Get the base directory (agentcore/)"""
        # Get path to agentcore root (parent of src/)
        return Path(__file__).parent.parent

    @staticmethod
    def get_output_dir() -> Path:
        """Get the output directory path (agentcore/output)"""
        output_dir = Config.get_base_dir() / "output"
        output_dir.mkdir(exist_ok=True)
        return output_dir

    @staticmethod
    def get_session_output_dir(session_id: str) -> Path:
        """Get the session-specific output directory (agentcore/output/session_id)"""
        session_dir = Config.get_output_dir() / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        return session_dir

    @staticmethod
    def get_uploads_dir() -> Path:
        """Get the uploads directory path (agentcore/uploads)"""
        uploads_dir = Config.get_base_dir() / "uploads"
        uploads_dir.mkdir(exist_ok=True)
        return uploads_dir

    @staticmethod
    def get_generated_images_dir() -> Path:
        """Get the generated images directory path (agentcore/generated_images)"""
        images_dir = Config.get_base_dir() / "generated_images"
        images_dir.mkdir(exist_ok=True)
        return images_dir
