"""
Simple Web Search Tool - Strands Native
Uses DuckDuckGo for web search without external dependencies
"""

import asyncio
import concurrent.futures
import threading
import json
import logging
from strands import tool
from skill import skill

logger = logging.getLogger(__name__)

# Use threading.Semaphore (not asyncio) — each skill_executor call runs asyncio.run()
# in its own thread, so asyncio primitives are not shared across calls.
_SEARCH_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=3, thread_name_prefix="ddg_search")
_SEARCH_LOCK = threading.Semaphore(1)

_TIMEOUT_SECONDS = 15.0


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

        def _search():
            with _SEARCH_LOCK:
                with DDGS() as ddgs:
                    return list(ddgs.text(query, max_results=max_results))

        loop = asyncio.get_event_loop()
        future = loop.run_in_executor(_SEARCH_EXECUTOR, _search)
        results = await asyncio.wait_for(future, timeout=_TIMEOUT_SECONDS)

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

    except asyncio.TimeoutError:
        logger.warning(f"Web search timed out after {_TIMEOUT_SECONDS}s for query: '{query}'")
        return json.dumps({
            "success": False,
            "error": f"Search timed out after {int(_TIMEOUT_SECONDS)} seconds",
            "query": query
        })

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
