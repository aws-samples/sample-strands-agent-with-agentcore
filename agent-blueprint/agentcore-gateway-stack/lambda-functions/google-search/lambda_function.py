"""
Google Custom Search Lambda for AgentCore Gateway
Provides web search and image search
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

# Cache for API credentials
_credentials_cache: Optional[Dict[str, str]] = None

def lambda_handler(event, context):
    """
    Lambda handler for Google Search tools via AgentCore Gateway

    Gateway unwraps tool arguments and passes them directly to Lambda
    """
    try:
        logger.info(f"Event: {json.dumps(event)}")

        # Get tool name from context (set by AgentCore Gateway)
        tool_name = 'unknown'
        if hasattr(context, 'client_context') and context.client_context:
            if hasattr(context.client_context, 'custom'):
                tool_name = context.client_context.custom.get('bedrockAgentCoreToolName', '')
                if '___' in tool_name:
                    tool_name = tool_name.split('___')[-1]

        logger.info(f"Tool name: {tool_name}")

        # Route to appropriate tool
        if tool_name == 'google_web_search':
            return google_web_search(event)
        else:
            return error_response(f"Unknown tool: {tool_name}")

    except Exception as e:
        logger.error(f"Error: {str(e)}", exc_info=True)
        return error_response(str(e))


def get_google_credentials() -> Optional[Dict[str, str]]:
    """
    Get Google API credentials from Secrets Manager (with caching)

    Returns dict with 'api_key' and 'search_engine_id'
    """
    global _credentials_cache

    # Return cached credentials if available
    if _credentials_cache:
        return _credentials_cache

    # Check environment variables first (for local testing)
    api_key = os.getenv("GOOGLE_API_KEY")
    search_engine_id = os.getenv("GOOGLE_SEARCH_ENGINE_ID")

    if api_key and search_engine_id:
        _credentials_cache = {
            'api_key': api_key,
            'search_engine_id': search_engine_id
        }
        return _credentials_cache

    # Get from Secrets Manager
    secret_name = os.getenv("GOOGLE_CREDENTIALS_SECRET_NAME")
    if not secret_name:
        logger.error("GOOGLE_CREDENTIALS_SECRET_NAME not set")
        return None

    try:
        session = boto3.session.Session()
        client = session.client(service_name='secretsmanager')

        get_secret_value_response = client.get_secret_value(SecretId=secret_name)

        # Parse secret (stored as JSON)
        secret_str = get_secret_value_response['SecretString']
        credentials = json.loads(secret_str)

        # Cache for future calls
        _credentials_cache = credentials
        logger.info("✅ Google credentials loaded from Secrets Manager")

        return credentials

    except ClientError as e:
        logger.error(f"Failed to get Google credentials from Secrets Manager: {e}")
        return None


def google_web_search(params: Dict[str, Any]) -> Dict[str, Any]:
    """Execute Google web search with optional image results"""

    # Check for user-provided API keys first (from __user_api_keys)
    user_api_keys = params.pop('__user_api_keys', None)
    credentials = None

    if user_api_keys:
        user_api_key = user_api_keys.get('google_api_key')
        user_search_engine_id = user_api_keys.get('google_search_engine_id')
        if user_api_key and user_search_engine_id:
            credentials = {
                'api_key': user_api_key,
                'search_engine_id': user_search_engine_id
            }
            logger.info("Using user-provided Google API credentials")

    # Fall back to default credentials from Secrets Manager
    if not credentials:
        credentials = get_google_credentials()

    if not credentials:
        return error_response("Failed to get Google API credentials")

    # Extract parameters (Gateway unwraps them)
    query = params.get('query')
    num_results = 5
    include_images = params.get('include_images', True)  # Default: include images

    if not query:
        return error_response("query parameter required")

    logger.info(f"Google web search: query={query}, include_images={include_images}")

    try:
        # Web search API request
        url = "https://www.googleapis.com/customsearch/v1"
        request_params = {
            'key': credentials['api_key'],
            'cx': credentials['search_engine_id'],
            'q': query,
            'num': num_results,
            'safe': 'active'
        }

        response = requests.get(url, params=request_params, timeout=30)

        if response.status_code == 400:
            return error_response("Invalid Google API request")
        elif response.status_code == 403:
            return error_response("Google API key invalid or quota exceeded")
        elif response.status_code != 200:
            return error_response(f"Google API error: {response.status_code}")

        data = response.json()

        # Format web results
        results = []
        if 'items' in data:
            for idx, item in enumerate(data['items'], 1):
                results.append({
                    "index": idx,
                    "title": item.get('title', 'No title'),
                    "link": item.get('link', 'No link'),
                    "snippet": item.get('snippet', 'No snippet')
                })

        # Image search (if enabled)
        images = []
        if include_images:
            try:
                image_params = {
                    'key': credentials['api_key'],
                    'cx': credentials['search_engine_id'],
                    'q': query,
                    'searchType': 'image',
                    'num': 3,  # Get 3 images (limited to reduce clutter)
                    'safe': 'active'
                }

                image_response = requests.get(url, params=image_params, timeout=30)

                if image_response.status_code == 200:
                    image_data = image_response.json()

                    if 'items' in image_data:
                        for idx, item in enumerate(image_data['items'][:3], 1):
                            images.append({
                                "index": idx,
                                "title": item.get('title', 'Untitled'),
                                "link": item.get('link', ''),
                                "thumbnail": item.get('image', {}).get('thumbnailLink', ''),
                                "context_link": item.get('image', {}).get('contextLink', ''),
                                "width": item.get('image', {}).get('width', 0),
                                "height": item.get('image', {}).get('height', 0)
                            })
                else:
                    logger.warning(f"Image search failed: {image_response.status_code}")
            except Exception as e:
                logger.warning(f"Image search error (non-fatal): {str(e)}")

        result_data = {
            "query": query,
            "results_count": len(results),
            "results": results,
            "images_count": len(images),
            "images": images
        }

        return success_response(json.dumps(result_data, indent=2))

    except requests.exceptions.Timeout:
        return error_response("Google API request timed out")
    except Exception as e:
        return error_response(f"Google web search error: {str(e)}")


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
