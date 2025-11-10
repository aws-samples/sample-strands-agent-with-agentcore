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
                logger.debug(f"MCPClientFactory - Resolved URL: {config['url']} -> {resolved_url}")

                # Check if this is an AWS MCP server that requires SigV4 authentication
                if MCPClientFactory.is_aws_server(resolved_url):
                    try:
                        # Use SigV4 authenticated client
                        from mcp_sigv4_client import streamablehttp_client_with_sigv4

                        # Extract region from URL or use config
                        region = config.get("region", MCPClientFactory.extract_region_from_url(resolved_url))

                        # Determine service based on URL pattern
                        if "bedrock-agentcore" in resolved_url:
                            service = "bedrock-agentcore"
                        elif "execute-api" in resolved_url:
                            service = "execute-api"
                        else:
                            service = "lambda"

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
            from urllib.parse import quote

            # Create boto3 session to auto-discover region from ECS environment
            session = boto3.Session()
            region = session.region_name or 'us-west-2'  # Fallback to us-west-2 if region detection fails
            logger.debug(f"MCPClientFactory - Auto-discovered SSM region: {region}")
            ssm_client = boto3.client('ssm', region_name=region)
            response = ssm_client.get_parameter(Name=parameter_name)
            resolved_value = response['Parameter']['Value']
            logger.info(f"MCPClientFactory - Resolved parameter {parameter_name} to: {resolved_value}")

            # Check if this is an AgentCore Runtime Endpoint ARN
            if resolved_value.startswith('arn:aws:bedrock-agentcore:'):
                # Extract region from ARN: arn:aws:bedrock-agentcore:REGION:...
                arn_parts = resolved_value.split(':')
                agentcore_region = arn_parts[3] if len(arn_parts) > 3 else region

                # Extract runtime ARN (remove /runtime-endpoint/... suffix if present)
                # ARN format: arn:aws:bedrock-agentcore:region:account:runtime/name/runtime-endpoint/endpoint-name
                # We want: arn:aws:bedrock-agentcore:region:account:runtime/name
                if '/runtime-endpoint/' in resolved_value:
                    runtime_arn = resolved_value.split('/runtime-endpoint/')[0]
                else:
                    runtime_arn = resolved_value

                # URL-encode the runtime ARN
                encoded_arn = quote(runtime_arn, safe='')

                # Construct AgentCore invocation URL with DEFAULT qualifier
                agentcore_url = f"https://bedrock-agentcore.{agentcore_region}.amazonaws.com/runtimes/{encoded_arn}/invocations?qualifier=DEFAULT"
                logger.info(f"MCPClientFactory - Converted AgentCore ARN to invocation URL: {agentcore_url}")
                return agentcore_url

            return resolved_value

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
        """Check if the URL is an AWS MCP server that requires authentication.

        Args:
            url: The URL to check

        Returns:
            bool: True if this is an AWS server requiring authentication
        """
        # Check for SSM parameter paths that point to AgentCore
        if MCPClientFactory.is_agentcore_server(url):
            return True

        aws_patterns = [
            "execute-api.amazonaws.com",
            "lambda-url.amazonaws.com",
            ".lambda-url.",
            ".execute-api.",
            "bedrock-agentcore.amazonaws.com"  # AgentCore Runtime
        ]
        return any(pattern in url for pattern in aws_patterns)

    @staticmethod
    def is_agentcore_server(url: str) -> bool:
        """Check if the URL is an AgentCore Runtime endpoint.

        Args:
            url: The URL to check (can be SSM parameter path or HTTPS URL)

        Returns:
            bool: True if this is an AgentCore Runtime endpoint
        """
        # Check for SSM parameter path containing 'agentcore'
        # e.g., ssm:///mcp/endpoints/agentcore/s3-iceberg
        if url.startswith('ssm://') and '/agentcore/' in url:
            return True

        # Check for bedrock-agentcore with region-specific domains
        # e.g., bedrock-agentcore.ap-southeast-2.amazonaws.com
        import re
        return bool(re.search(r'bedrock-agentcore\.[a-z0-9-]+\.amazonaws\.com', url))
    
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