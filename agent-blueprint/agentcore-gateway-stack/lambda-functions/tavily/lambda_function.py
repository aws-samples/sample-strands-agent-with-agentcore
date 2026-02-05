"""
Tavily Search Lambda for AgentCore Gateway
Provides AI-powered web search and content extraction
"""
import json
import os
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Import after logger setup
import requests
import boto3
from botocore.exceptions import ClientError

# Cache for API key (avoid repeated Secrets Manager calls)
_api_key_cache: Optional[str] = None

def lambda_handler(event, context):
    """
    Lambda handler for Tavily tools via AgentCore Gateway

    Gateway unwraps tool arguments and passes them directly to Lambda
    """
    try:
        logger.info(f"Event: {json.dumps(event)}")

        # Get tool name from context (set by AgentCore Gateway)
        tool_name = 'unknown'
        if hasattr(context, 'client_context') and context.client_context:
            tool_name = context.client_context.custom.get('bedrockAgentCoreToolName', '')
            if '___' in tool_name:
                tool_name = tool_name.split('___')[-1]

        logger.info(f"Tool name: {tool_name}")

        # Route to appropriate tool
        if tool_name == 'tavily_search':
            return tavily_search(event)
        elif tool_name == 'tavily_extract':
            return tavily_extract(event)
        else:
            return error_response(f"Unknown tool: {tool_name}")

    except Exception as e:
        logger.error(f"Error: {str(e)}", exc_info=True)
        return error_response(str(e))


def get_tavily_api_key() -> Optional[str]:
    """
    Get Tavily API key from Secrets Manager (with caching)

    Returns cached key if available, otherwise fetches from Secrets Manager
    """
    global _api_key_cache

    # Return cached key if available
    if _api_key_cache:
        return _api_key_cache

    # Check environment variable first (for local testing)
    api_key = os.getenv("TAVILY_API_KEY")
    if api_key:
        _api_key_cache = api_key
        return api_key

    # Get from Secrets Manager
    secret_name = os.getenv("TAVILY_API_KEY_SECRET_NAME")
    if not secret_name:
        logger.error("TAVILY_API_KEY_SECRET_NAME not set")
        return None

    try:
        session = boto3.session.Session()
        client = session.client(service_name='secretsmanager')

        get_secret_value_response = client.get_secret_value(SecretId=secret_name)

        # Parse secret (it's stored as plain string, not JSON)
        secret = get_secret_value_response['SecretString']

        # Cache for future calls
        _api_key_cache = secret
        logger.info("✅ Tavily API key loaded from Secrets Manager")

        return secret

    except ClientError as e:
        logger.error(f"Failed to get Tavily API key from Secrets Manager: {e}")
        return None


def tavily_search(params: Dict[str, Any]) -> Dict[str, Any]:
    """Execute Tavily web search"""

    # Check for user-provided API key first (from __user_api_keys)
    user_api_keys = params.pop('__user_api_keys', None)
    api_key = None

    if user_api_keys and user_api_keys.get('tavily_api_key'):
        api_key = user_api_keys['tavily_api_key']
        logger.info("Using user-provided Tavily API key")

    # Fall back to default API key from Secrets Manager
    if not api_key:
        api_key = get_tavily_api_key()

    if not api_key:
        return error_response("Failed to get Tavily API key")

    # Extract parameters (Gateway unwraps them)
    query = params.get('query')
    search_depth = params.get('search_depth', 'basic')
    topic = params.get('topic', 'general')
    max_results = 5

    if not query:
        return error_response("query parameter required")

    logger.info(f"Tavily search: query={query}, depth={search_depth}, topic={topic}")

    # Prepare API request
    search_params = {
        "api_key": api_key,
        "query": query,
        "search_depth": search_depth,
        "topic": topic,
        "max_results": max_results,
        "include_images": False,
        "include_raw_content": False
    }

    try:
        response = requests.post(
            "https://api.tavily.com/search",
            json=search_params,
            headers={"Content-Type": "application/json"},
            timeout=30
        )

        # Handle response codes with detailed error messages
        if response.status_code == 401:
            return error_response("Invalid Tavily API key")
        elif response.status_code == 429:
            return error_response("Tavily API rate limit exceeded")
        elif response.status_code != 200:
            error_details = response.text
            logger.error(f"Tavily API error {response.status_code}: {error_details}")
            return error_response(f"Tavily API error: {response.status_code} - {error_details}")

        search_results = response.json()

        # Format results
        formatted_results = []
        for idx, result in enumerate(search_results.get('results', []), 1):
            formatted_results.append({
                "index": idx,
                "title": result.get('title', 'No title'),
                "url": result.get('url', 'No URL'),
                "content": result.get('content', 'No content'),
                "score": result.get('score', 0),
                "published_date": result.get('published_date', '')
            })

        result_data = {
            "query": query,
            "search_depth": search_depth,
            "topic": topic,
            "results_count": len(formatted_results),
            "results": formatted_results
        }

        return success_response(json.dumps(result_data, indent=2))

    except requests.exceptions.Timeout:
        return error_response("Tavily API request timed out")
    except Exception as e:
        return error_response(f"Tavily search error: {str(e)}")


def tavily_extract(params: Dict[str, Any]) -> Dict[str, Any]:
    """Extract content from URLs using Tavily"""

    # Check for user-provided API key first (from __user_api_keys)
    user_api_keys = params.pop('__user_api_keys', None)
    api_key = None

    if user_api_keys and user_api_keys.get('tavily_api_key'):
        api_key = user_api_keys['tavily_api_key']
        logger.info("Using user-provided Tavily API key")

    # Fall back to default API key from Secrets Manager
    if not api_key:
        api_key = get_tavily_api_key()

    if not api_key:
        return error_response("Failed to get Tavily API key")

    # Extract parameters
    urls = params.get('urls', '')
    extract_depth = params.get('extract_depth', 'basic')

    if not urls:
        return error_response("urls parameter required")

    # Parse comma-separated URLs
    url_list = [url.strip() for url in urls.split(',') if url.strip()]

    logger.info(f"Tavily extract: {len(url_list)} URLs, depth={extract_depth}")

    extract_params = {
        "api_key": api_key,
        "urls": url_list,
        "extract_depth": extract_depth
    }

    try:
        response = requests.post(
            "https://api.tavily.com/extract",
            json=extract_params,
            headers={"Content-Type": "application/json"},
            timeout=30
        )

        # Handle response codes with detailed error messages
        if response.status_code == 401:
            return error_response("Invalid Tavily API key")
        elif response.status_code == 429:
            return error_response("Tavily API rate limit exceeded")
        elif response.status_code != 200:
            error_details = response.text
            logger.error(f"Tavily API error {response.status_code}: {error_details}")
            return error_response(f"Tavily API error: {response.status_code} - {error_details}")

        extract_results = response.json()

        # Format results
        formatted_results = []
        for idx, result in enumerate(extract_results.get('results', []), 1):
            content = result.get('raw_content', result.get('content', 'No content'))

            # Truncate long content
            if len(content) > 5000:
                content = content[:5000] + "... [Content truncated]"

            formatted_results.append({
                "index": idx,
                "url": result.get('url', 'No URL'),
                "content": content,
                "content_length": len(result.get('raw_content', result.get('content', '')))
            })

        result_data = {
            "extract_depth": extract_depth,
            "urls_count": len(url_list),
            "results_count": len(formatted_results),
            "results": formatted_results
        }

        return success_response(json.dumps(result_data, indent=2))

    except requests.exceptions.Timeout:
        return error_response("Tavily API request timed out")
    except Exception as e:
        return error_response(f"Tavily extraction error: {str(e)}")


def success_response(content: str) -> Dict[str, Any]:
    """Format successful MCP response"""
    return {
        'statusCode': 200,
        'body': json.dumps({
            'content': [{
                'type': 'text',
                'text': content
            }]
        })
    }


def error_response(message: str) -> Dict[str, Any]:
    """Format error response"""
    logger.error(f"Error response: {message}")
    return {
        'statusCode': 400,
        'body': json.dumps({
            'error': message
        })
    }
