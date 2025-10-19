"""Unified MCP Client Factory - Eliminates code duplication across the codebase."""

import logging
import re
from typing import Dict, Any
from strands.tools.mcp import MCPClient
from mcp.client.streamable_http import streamablehttp_client

logger = logging.getLogger(__name__)


class MCPClientFactory:
    """Centralized factory for creating MCP clients with all necessary features."""
    
    @staticmethod
    def create_client(server_config: Dict[str, Any]) -> MCPClient:
        """Create MCPClient with Parameter Store resolution and SigV4 authentication support.
        
        Args:
            server_config: Server configuration dict with 'type' and 'config' keys
            
        Returns:
            MCPClient: Configured MCP client ready for use
            
        Raises:
            ValueError: If server type is not supported
        """
        server_type = server_config["type"]
        config = server_config["config"]
        
        if server_type == "mcp":
            def factory():
                # Resolve Parameter Store URL if needed
                resolved_url = MCPClientFactory.resolve_url(config["url"])
                logger.info(f"🔧 MCPClientFactory - Resolved URL: {config['url']} -> {resolved_url}")
                
                # Check if this is an AWS MCP server that requires SigV4 authentication
                if MCPClientFactory.is_aws_server(resolved_url):
                    try:
                        # Use SigV4 authenticated client
                        from mcp_sigv4_client import streamablehttp_client_with_sigv4
                        
                        # Extract region from URL or use config
                        region = config.get("region", MCPClientFactory.extract_region_from_url(resolved_url))
                        
                        # Determine service based on URL pattern
                        service = "execute-api" if "execute-api" in resolved_url else "lambda"
                        
                        logger.info(f"Creating SigV4 authenticated client for AWS MCP server: {resolved_url} (service: {service}, region: {region})")
                        
                        # Create SigV4 authenticated client
                        client = streamablehttp_client_with_sigv4(
                            url=resolved_url,
                            service=service,
                            region=region
                        )
                        return client
                        
                    except ImportError as e:
                        logger.warning(f"SigV4 client not available for AWS MCP server {resolved_url}: {e}")
                        logger.info("Falling back to standard HTTP client (this may fail if the server requires authentication)")
                        client = streamablehttp_client(resolved_url)
                        return client
                else:
                    # Use standard HTTP client for non-AWS servers
                    logger.debug(f"Creating standard HTTP client for MCP server: {resolved_url}")
                    client = streamablehttp_client(resolved_url)
                    return client
            return MCPClient(factory)
        else:
            raise ValueError(f"Unsupported MCP server type: {server_type}. Only 'mcp' is supported.")
    
    @staticmethod
    def resolve_url(url: str) -> str:
        """Resolve URL with support for Parameter Store references.
        
        Args:
            url: URL string, may contain ssm:// prefix for Parameter Store references
            
        Returns:
            Resolved URL string
        """
        logger.debug(f"MCPClientFactory - Resolving URL: {url}")
        
        if not url.startswith('ssm://'):
            logger.debug(f"MCPClientFactory - URL does not use ssm:// protocol, returning as-is: {url}")
            return url
            
        # Extract parameter name from ssm://parameter-name
        parameter_name = url[6:]  # Remove 'ssm://' prefix
        logger.debug(f"MCPClientFactory - Extracting parameter name: {parameter_name}")
        
        try:
            import boto3
            from botocore.exceptions import ClientError, NoCredentialsError

            # Use us-west-2 region for SSM parameters
            ssm_client = boto3.client('ssm', region_name='us-west-2')
            response = ssm_client.get_parameter(Name=parameter_name)
            resolved_url = response['Parameter']['Value']
            logger.info(f"MCPClientFactory - Resolved parameter {parameter_name} to: {resolved_url}")
            return resolved_url
            
        except (ClientError, NoCredentialsError) as e:
            if hasattr(e, 'response') and e.response['Error']['Code'] == 'ParameterNotFound':
                logger.warning(f"MCPClientFactory - Parameter not found: {parameter_name}")
            else:
                logger.error(f"MCPClientFactory - Failed to get parameter {parameter_name}: {e}")
            return url  # Return original URL as fallback
        except ImportError:
            logger.warning("boto3 not available - cannot resolve Parameter Store URLs")
            return url
    
    @staticmethod
    def is_aws_server(url: str) -> bool:
        """Check if the URL is an AWS MCP server that requires SigV4 authentication.
        
        Args:
            url: The URL to check
            
        Returns:
            bool: True if this is an AWS server requiring SigV4
        """
        aws_patterns = [
            "execute-api.amazonaws.com",
            "lambda-url.amazonaws.com", 
            ".lambda-url.",
            ".execute-api."
        ]
        return any(pattern in url for pattern in aws_patterns)
    
    @staticmethod
    def extract_region_from_url(url: str) -> str:
        """Extract AWS region from URL.
        
        Args:
            url: AWS URL containing region information
            
        Returns:
            str: Extracted region or default fallback
        """
        # Pattern for execute-api.us-east-2.amazonaws.com or lambda-url.us-east-2.on.aws
        match = re.search(r'\.([a-z0-9-]+)\.amazonaws\.com|\.([a-z0-9-]+)\.on\.aws', url)
        if match:
            return match.group(1) or match.group(2)
        # Default fallback region
        return "us-west-2"