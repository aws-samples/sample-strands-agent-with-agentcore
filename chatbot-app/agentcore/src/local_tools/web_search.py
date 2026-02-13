"""
Simple Web Search Tool - Strands Native
Uses DuckDuckGo for web search without external dependencies
"""

import json
import logging
from strands import tool
from skill import skill

logger = logging.getLogger(__name__)


@skill("web-search")
@tool
async def ddg_web_search(query: str, max_results: int = 5) -> str:
    """
    Search the web using DuckDuckGo for general information, news, and research.
    Returns search results with titles, snippets, and links.

    Args:
        query: Search query string (e.g., "Python programming tutorial", "AWS Lambda pricing")
        max_results: Maximum number of results to return (default: 5, max: 10)

    Returns:
        JSON string containing search results with title, snippet, and link

    Examples:
        # General search
        ddg_web_search("latest AI developments 2025")

        # Company research
        ddg_web_search("Amazon company culture interview")

        # Technical documentation
        ddg_web_search("React hooks tutorial")
    """
    try:
        # Import ddgs here to avoid import errors if not installed
        from ddgs import DDGS

        # Limit max_results to prevent abuse
        max_results = min(max_results, 10)

        # Perform search
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))

        # Format results
        formatted_results = []
        for idx, result in enumerate(results):
            formatted_results.append({
                "index": idx + 1,
                "title": result.get("title", "No title"),
                "snippet": result.get("body", "No snippet"),
                "link": result.get("href", "No link")
            })

        logger.info(f"Web search completed: {len(formatted_results)} results for '{query}'")

        return json.dumps({
            "success": True,
            "query": query,
            "result_count": len(formatted_results),
            "results": formatted_results
        }, indent=2)

    except ImportError:
        error_msg = "ddgs library not installed. Please install it with: pip install ddgs"
        logger.error(error_msg)
        return json.dumps({
            "success": False,
            "error": error_msg,
            "query": query
        })

    except Exception as e:
        logger.error(f"Error performing web search: {e}")
        return json.dumps({
            "success": False,
            "error": str(e),
            "query": query
        })
