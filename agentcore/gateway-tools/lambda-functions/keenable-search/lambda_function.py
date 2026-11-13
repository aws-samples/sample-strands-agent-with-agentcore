"""
Keenable Search Lambda for AgentCore Gateway

Optional web search tool. A key is not required; the public endpoint is used
until KEENABLE_API_KEY (or a Secrets Manager secret) is set.
"""
import json  # noqa: E402
import os  # noqa: E402
import logging  # noqa: E402
from typing import Dict, Any, Optional  # noqa: E402

logger = logging.getLogger()
logger.setLevel(logging.INFO)

import requests  # noqa: E402
import boto3  # noqa: E402
from botocore.exceptions import ClientError  # noqa: E402

KEENABLE_PUBLIC_URL = "https://api.keenable.ai/v1/search/public"
KEENABLE_KEYED_URL = "https://api.keenable.ai/v1/search"
KEENABLE_TITLE = "sample-strands-agent-with-agentcore"

_api_key_cache: Optional[str] = None
_api_key_loaded = False


def lambda_handler(event, context):
    """Lambda handler for Keenable search via AgentCore Gateway."""
    try:
        logger.info(f"Event: {json.dumps(event)}")

        tool_name = "unknown"
        if hasattr(context, "client_context") and context.client_context:
            if hasattr(context.client_context, "custom"):
                tool_name = context.client_context.custom.get("bedrockAgentCoreToolName", "")
                if "___" in tool_name:
                    tool_name = tool_name.split("___")[-1]

        logger.info(f"Tool name: {tool_name}")

        if tool_name == "keenable_search":
            return keenable_search(event)
        return error_response(f"Unknown tool: {tool_name}")

    except Exception as e:
        logger.error(f"Error: {str(e)}", exc_info=True)
        return error_response(str(e))


def get_keenable_api_key() -> Optional[str]:
    """Optional API key from env or Secrets Manager. Missing key is valid (public endpoint)."""
    global _api_key_cache, _api_key_loaded

    if _api_key_loaded:
        return _api_key_cache

    api_key = os.getenv("KEENABLE_API_KEY")
    if api_key:
        _api_key_cache = api_key
        _api_key_loaded = True
        return api_key

    secret_name = os.getenv("KEENABLE_API_KEY_SECRET_NAME")
    if not secret_name:
        _api_key_loaded = True
        return None

    try:
        session = boto3.session.Session()
        client = session.client(service_name="secretsmanager")
        get_secret_value_response = client.get_secret_value(SecretId=secret_name)
        secret = get_secret_value_response["SecretString"]
        _api_key_cache = secret
        _api_key_loaded = True
        logger.info("Keenable API key loaded from Secrets Manager")
        return secret
    except ClientError as e:
        logger.error(f"Failed to get Keenable API key from Secrets Manager: {e}")
        _api_key_loaded = True
        return None


def keenable_search(params: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a Keenable web search. Keyless when no API key is configured."""
    query = params.get("query")
    num_results = params.get("num_results", 5)

    if not query:
        return error_response("query parameter required")

    try:
        num_results = int(num_results)
    except (TypeError, ValueError):
        num_results = 5
    if num_results < 1:
        num_results = 1
    if num_results > 10:
        num_results = 10

    api_key = get_keenable_api_key()
    url = KEENABLE_KEYED_URL if api_key else KEENABLE_PUBLIC_URL
    headers = {
        "Content-Type": "application/json",
        "X-Keenable-Title": KEENABLE_TITLE,
    }
    if api_key:
        headers["X-API-Key"] = api_key

    logger.info(f"Keenable search: query={query}, num_results={num_results}, keyed={bool(api_key)}")

    try:
        response = requests.post(
            url,
            json={"query": query, "max_results": num_results},
            headers=headers,
            timeout=30,
        )

        if response.status_code == 401:
            return error_response("Invalid Keenable API key")
        if response.status_code == 429:
            return error_response("Keenable API rate limit exceeded")
        if response.status_code != 200:
            error_details = response.text
            logger.error(f"Keenable API error {response.status_code}: {error_details}")
            return error_response(f"Keenable API error: {response.status_code} - {error_details}")

        payload = response.json()
        formatted_results = []
        for idx, item in enumerate(payload.get("results") or [], 1):
            formatted_results.append({
                "index": idx,
                "title": item.get("title") or "",
                "url": item.get("url") or "",
                "snippet": item.get("snippet") or "",
            })

        result_data = {
            "query": payload.get("query") or query,
            "results_count": len(formatted_results),
            "results": formatted_results,
        }
        return success_response(json.dumps(result_data, indent=2))

    except requests.exceptions.Timeout:
        return error_response("Keenable API request timed out")
    except Exception as e:
        return error_response(f"Keenable search error: {str(e)}")


def success_response(content: str) -> Dict[str, Any]:
    """Format successful MCP response."""
    return {
        "statusCode": 200,
        "body": json.dumps({
            "content": [{
                "type": "text",
                "text": content,
            }]
        }),
    }


def error_response(message: str) -> Dict[str, Any]:
    """Format error response."""
    logger.error(f"Error response: {message}")
    return {
        "statusCode": 400,
        "body": json.dumps({
            "error": message,
        }),
    }
