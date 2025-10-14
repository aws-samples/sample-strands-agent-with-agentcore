import logging
from typing import List
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from config import Config

# Set up logging
logger = logging.getLogger(__name__)

class DomainValidationMiddleware(BaseHTTPMiddleware):
    """Middleware to validate domain origins for embedded chatbot requests"""
    
    def __init__(self, app, embed_paths: List[str] = None):
        super().__init__(app)
        self.embed_paths = embed_paths or ["/embed"]
    
    async def dispatch(self, request: Request, call_next):
        # Check if this is a request to an embed path
        if any(request.url.path.startswith(path) for path in self.embed_paths):
            # Get allowed domains from config
            allowed_domains = Config.get_embed_allowed_domains()
            
            # If no domains are configured, allow all requests (development mode)
            if not allowed_domains:
                logger.info("No embed domains configured - allowing all embed requests (development mode)")
                return await call_next(request)
            
            # Get the origin header
            origin = request.headers.get("origin")
            referer = request.headers.get("referer")
            
            # For iframe requests, we might not have origin but have referer
            request_domain = None
            if origin:
                # Extract domain from origin (e.g., "https://example.com" -> "example.com")
                try:
                    from urllib.parse import urlparse
                    parsed = urlparse(origin)
                    request_domain = parsed.netloc.lower()
                except Exception:
                    request_domain = None
            elif referer:
                # Extract domain from referer as fallback
                try:
                    from urllib.parse import urlparse
                    parsed = urlparse(referer)
                    request_domain = parsed.netloc.lower()
                except Exception:
                    request_domain = None
            
            # If we have a request domain, validate it
            if request_domain:
                # Normalize allowed domains (remove protocol, convert to lowercase)
                normalized_allowed = []
                for domain in allowed_domains:
                    try:
                        # Handle domains that might include protocol
                        if domain.startswith(('http://', 'https://')):
                            from urllib.parse import urlparse
                            parsed = urlparse(domain)
                            normalized_allowed.append(parsed.netloc.lower())
                        else:
                            normalized_allowed.append(domain.lower())
                    except Exception:
                        # If parsing fails, use the domain as-is
                        normalized_allowed.append(domain.lower())
                
                # Check if request domain is in allowed list
                if request_domain not in normalized_allowed:
                    # Log unauthorized access attempt
                    logger.warning(f"Unauthorized embed access attempt from domain: {request_domain}")
                    logger.info(f"Allowed domains: {normalized_allowed}")
                    
                    # Return 403 Forbidden
                    return Response(
                        content="Embedding not allowed from this domain",
                        status_code=403,
                        headers={"Content-Type": "text/plain"}
                    )
                else:
                    logger.info(f"Authorized embed access from domain: {request_domain}")
            else:
                # No origin or referer header - this might be a direct access
                # Log this but allow it (could be development or direct testing)
                logger.info("Embed request without origin/referer headers - allowing (might be direct access)")
        
        # Continue with the request
        return await call_next(request)