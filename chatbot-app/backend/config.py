import os
from typing import List, Optional

class Config:
    """Application configuration class"""
    
    # Server settings
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    
    # CORS settings
    CORS_ORIGINS: List[str] = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    
    # File storage settings
    UPLOAD_DIR: str = os.getenv("UPLOAD_DIR", "uploads")
    OUTPUT_DIR: str = os.getenv("OUTPUT_DIR", "output")
    GENERATED_IMAGES_DIR: str = os.getenv("GENERATED_IMAGES_DIR", "generated_images")
    DIAGRAMS_DIR: str = os.path.join(OUTPUT_DIR, "diagrams")
    CHARTS_DIR: str = os.path.join(OUTPUT_DIR, "charts")
    
    # External URLs (for future cloud deployment)
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:3000")
    
    # Storage settings - Fixed to local storage
    STORAGE_TYPE: str = "local"
    
    # Development settings
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"
    RELOAD: bool = os.getenv("RELOAD", "false").lower() == "true"
    
    # Embedding settings - dynamically loaded to support testing
    @classmethod
    def _get_embed_allowed_domains_env(cls) -> List[str]:
        """Get embed allowed domains from environment variable"""
        env_value = os.getenv("EMBED_ALLOWED_DOMAINS", "")
        return env_value.split(",") if env_value else []
    
    @classmethod
    def get_cors_origins(cls) -> List[str]:
        """Get CORS origins, filtering out empty strings"""
        return [origin.strip() for origin in cls.CORS_ORIGINS if origin.strip()]
    
    @classmethod
    def get_embed_allowed_domains(cls) -> List[str]:
        """Get allowed domains for embedding, filtering out empty strings"""
        domains = cls._get_embed_allowed_domains_env()
        return [domain.strip() for domain in domains if domain.strip()]
    
    @classmethod
    def ensure_directories(cls) -> None:
        """Ensure all required directories exist"""
        directories = [cls.UPLOAD_DIR, cls.OUTPUT_DIR, cls.GENERATED_IMAGES_DIR, cls.DIAGRAMS_DIR, cls.CHARTS_DIR]
        for directory in directories:
            os.makedirs(directory, exist_ok=True)
    
    @classmethod
    def get_session_output_dir(cls, session_id: str) -> str:
        """Get session-specific output directory.
        
        Args:
            session_id: Unique session identifier
            
        Returns:
            Path to session's isolated output directory
        """
        # Validate session_id to prevent path traversal
        import re
        if not re.match(r'^[a-zA-Z0-9_-]+$', session_id):
            raise ValueError(f"Invalid session_id format: {session_id}")
        
        session_output = os.path.join(cls.OUTPUT_DIR, "sessions", session_id)
        os.makedirs(session_output, exist_ok=True)
        return session_output
    
    @classmethod
    def get_session_repl_dir(cls, session_id: str) -> str:
        """Get session-specific Python REPL directory.
        
        Args:
            session_id: Unique session identifier
            
        Returns:
            Path to session's isolated REPL directory (simplified to sessions/{session_id})
        """
        session_dir = cls.get_session_output_dir(session_id)
        os.makedirs(session_dir, exist_ok=True)
        return session_dir
    
    @classmethod
    def get_session_analysis_dir(cls, session_id: str) -> str:
        """Get session-specific analysis directory.
        
        Args:
            session_id: Unique session identifier
            
        Returns:
            Path to session's isolated analysis directory
        """
        analysis_dir = os.path.join(cls.get_session_output_dir(session_id), "analysis")
        os.makedirs(analysis_dir, exist_ok=True)
        return analysis_dir
    
    @classmethod
    def get_session_charts_dir(cls, session_id: str) -> str:
        """Get session-specific charts directory.
        
        Args:
            session_id: Unique session identifier
            
        Returns:
            Path to session's isolated charts directory
        """
        charts_dir = os.path.join(cls.get_session_output_dir(session_id), "charts")
        os.makedirs(charts_dir, exist_ok=True)
        return charts_dir
    
    @classmethod
    def get_session_diagrams_dir(cls, session_id: str) -> str:
        """Get session-specific diagrams directory.
        
        Args:
            session_id: Unique session identifier
            
        Returns:
            Path to session's isolated diagrams directory
        """
        diagrams_dir = os.path.join(cls.get_session_output_dir(session_id), "diagrams")
        os.makedirs(diagrams_dir, exist_ok=True)
        return diagrams_dir
    
    @classmethod
    def get_output_dir(cls) -> str:
        """Get the base output directory.
        
        Returns:
            Path to the base output directory
        """
        return cls.OUTPUT_DIR
