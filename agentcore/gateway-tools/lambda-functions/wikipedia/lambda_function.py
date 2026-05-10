"""
Wikipedia Lambda for AgentCore Gateway
Provides Wikipedia search and article retrieval
"""
import json
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Import after logger setup
import wikipediaapi

def lambda_handler(event, context):
    """
    Lambda handler for Wikipedia tools via AgentCore Gateway

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
        if tool_name == 'wikipedia_search':
            return wikipedia_search(event)
        elif tool_name == 'wikipedia_get_article':
            return wikipedia_get_article(event)
        else:
            return error_response(f"Unknown tool: {tool_name}")

    except Exception as e:
        logger.error(f"Error: {str(e)}", exc_info=True)
        return error_response(str(e))


def wikipedia_search(params: Dict[str, Any]) -> Dict[str, Any]:
    """Execute Wikipedia search"""

    # Extract parameters (Gateway unwraps them)
    query = params.get('query')

    if not query:
        return error_response("query parameter required")

    logger.info(f"Wikipedia search: query={query}")

    try:
        wiki = wikipediaapi.Wikipedia(
            user_agent='ResearchGatewayLambda/1.0',
            language='en'
        )

        # Search by trying to get the page
        search_page = wiki.page(query)

        results = []

        # Add the main search result if it exists
        if search_page.exists():
            summary = search_page.summary
            snippet = summary[:200] + "..." if len(summary) > 200 else summary

            results.append({
                "title": search_page.title,
                "snippet": snippet,
                "url": search_page.fullurl
            })

        if not results:
            result_data = {
                "status": "no_results",
                "query": query,
                "message": f"No Wikipedia articles found for query: {query}",
                "results": []
            }
        else:
            result_data = {
                "status": "success",
                "query": query,
                "count": len(results),
                "results": results
            }

        return success_response(json.dumps(result_data, indent=2))

    except Exception as e:
        return error_response(f"Wikipedia search error: {str(e)}")


def wikipedia_get_article(params: Dict[str, Any]) -> Dict[str, Any]:
    """Retrieve content from a Wikipedia article"""

    # Extract parameters
    title = params.get('title')
    summary_only = params.get('summary_only', False)

    if not title:
        return error_response("title parameter required")

    logger.info(f"Wikipedia get article: title={title}, summary_only={summary_only}")

    try:
        wiki = wikipediaapi.Wikipedia(
            user_agent='ResearchGatewayLambda/1.0',
            language='en'
        )

        page = wiki.page(title)

        if not page.exists():
            result_data = {
                "status": "not_found",
                "message": f"Wikipedia article not found: {title}",
                "suggestion": "Try using wikipedia_search to find the correct article title"
            }
            return success_response(json.dumps(result_data, indent=2))

        # Get content based on summary_only flag
        if summary_only:
            content = page.summary
            content_type = "summary"
        else:
            # Limit full text to 5000 characters
            content = page.text[:5000]
            content_type = "full_text"
            if len(page.text) > 5000:
                content += "\n\n[... Content truncated at 5000 characters]"

        # Get categories for context
        categories = list(page.categories.keys())[:5]  # Limit to 5 categories

        result_data = {
            "status": "success",
            "title": page.title,
            "content_type": content_type,
            "content": content,
            "url": page.fullurl,
            "categories": categories,
            "character_count": len(content)
        }

        return success_response(json.dumps(result_data, indent=2))

    except Exception as e:
        return error_response(f"Wikipedia article retrieval error: {str(e)}")


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
